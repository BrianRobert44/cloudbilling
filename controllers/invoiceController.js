
const db = require("../config/db");

// GET BUSINESS ID (AUTO-CREATE IF NOT EXISTS)
const getBusinessId = async (userId) => {
  const [rows] = await db.query(
    "SELECT id FROM businesses WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (rows.length) {
    return rows[0].id;
  }

  const [userRows] = await db.query(
    "SELECT name, email FROM users WHERE id = ? LIMIT 1",
    [userId]
  );

  if (userRows.length) {
    const user = userRows[0];
    const [createResult] = await db.query(
      `INSERT INTO businesses (
        user_id, business_name, owner_name, email,
        mobile, business_type, state, invoice_prefix, invoice_next_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        `${user.name || "My"} Business`,
        user.name || "Owner",
        user.email || "billing@example.com",
        "9876543210",
        "Retail",
        "Tamil Nadu",
        "INV",
        1,
      ]
    );
    return createResult.insertId;
  }

  return null;
};

// CREATE INVOICE
const createInvoice = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const userId = req.user.id || req.user.userId;
    const {
      customerId,
      items,
      invoiceDiscount = 0,
      discountAmount,
      paymentMode = "Cash",
      notes = "",
      counterName,
      counter_name,
      splitDetails,
      split_details,
    } = req.body;

    const invoiceDate = req.body.invoiceDate || new Date().toISOString().slice(0, 10);
    const assignedCounter = (counterName || counter_name || "Main Counter").trim();

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one product is required.",
      });
    }

    await connection.beginTransaction();

    // Get business
    const [businessRows] = await connection.query(
      `SELECT id, invoice_prefix, invoice_next_number, state
       FROM businesses
       WHERE user_id = ?
       LIMIT 1 FOR UPDATE`,
      [userId]
    );

    if (!businessRows.length) {
      throw new Error("Business details not found.");
    }

    const business = businessRows[0];
    const businessId = business.id;
    const prefix = business.invoice_prefix || "INV";
    const nextNumber = Number(business.invoice_next_number || 1);

    const invoiceNumber =
      `${prefix}-${String(nextNumber).padStart(5, "0")}`;

    // Validate customer (optional)
    let validCustomerId = null;
    let customerState = null;
    if (customerId) {
      const [customerRows] = await connection.query(
        `SELECT id, state FROM customers
         WHERE id = ? AND business_id = ?
         LIMIT 1`,
        [customerId, businessId]
      );

      if (customerRows.length) {
        validCustomerId = customerRows[0].id;
        customerState = customerRows[0].state;
      }
    }

    let subtotal = 0;
    let gstTotal = 0;
    const invoiceItems = [];

    // Calculate products
    for (const item of items) {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);

      if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        throw new Error("Invalid product or quantity.");
      }

      const [productRows] = await connection.query(
        `SELECT id, product_name, sku, hsn_sac, unit,
                selling_price, gst, discount, stock_quantity
         FROM products
         WHERE id = ? AND business_id = ?
         LIMIT 1 FOR UPDATE`,
        [productId, businessId]
      );

      if (!productRows.length) {
        throw new Error(`Product not found: ${productId}`);
      }

      const product = productRows[0];

      if (Number(product.stock_quantity || 0) < quantity) {
        throw new Error(
          `Insufficient stock for ${product.product_name}.`
        );
      }

      const unitPrice = Number(product.selling_price || 0);
      const gstPercent = Number(product.gst || 0);
      const discountPercent = Number(
        item.discountPercent ?? product.discount ?? 0
      );

      if (
        unitPrice < 0 ||
        gstPercent < 0 ||
        gstPercent > 100 ||
        discountPercent < 0 ||
        discountPercent > 100
      ) {
        throw new Error("Invalid price, GST, or discount.");
      }

      const baseAmount = quantity * unitPrice;
      const itemDiscount = baseAmount * discountPercent / 100;
      const taxableAmount = baseAmount - itemDiscount;
      const gstAmount = taxableAmount * gstPercent / 100;
      const lineTotal = taxableAmount + gstAmount;

      subtotal += taxableAmount;
      gstTotal += gstAmount;

      invoiceItems.push({
        productId: product.id,
        productName: product.product_name,
        sku: product.sku,
        hsnSac: product.hsn_sac,
        unit: product.unit,
        quantity,
        unitPrice,
        discountPercent,
        discountAmount: itemDiscount,
        taxableAmount,
        gstPercent,
        gstAmount,
        lineTotal,
      });
    }

    // Invoice discount
    const discount = Number(
      discountAmount ?? invoiceDiscount
    );

    if (!Number.isFinite(discount) || discount < 0) {
      throw new Error("Invalid invoice discount.");
    }

    const grandTotal = Math.max(
      0,
      subtotal + gstTotal - discount
    );

    const validPaymentModes = [
      "Cash",
      "UPI",
      "Card",
      "Bank Transfer",
      "Credit",
      "Split",
      "Split Payment",
      "Other",
    ];

    if (!validPaymentModes.includes(paymentMode)) {
      throw new Error("Invalid payment mode.");
    }

    const normalizedPaymentMode = paymentMode === "Split Payment" ? "Split" : paymentMode;

    const paymentStatus =
      normalizedPaymentMode === "Credit" ? "UNPAID" : "PAID";

    // GST Tax Split: Intra-State (CGST + SGST) vs. Inter-State (IGST)
    const businessState = String(business.state || "").trim().toLowerCase();
    const custStateClean = String(customerState || "").trim().toLowerCase();
    const isInterstate = Boolean(
      custStateClean && businessState && custStateClean !== businessState
    );

    const cgstAmount = isInterstate ? 0 : Number((gstTotal / 2).toFixed(2));
    const sgstAmount = isInterstate ? 0 : Number((gstTotal / 2).toFixed(2));
    const igstAmount = isInterstate ? Number(gstTotal.toFixed(2)) : 0;

    const finalSplit = splitDetails || split_details || null;
    const splitDetailsStr = finalSplit ? JSON.stringify(finalSplit) : null;

    // Insert invoice
    const [invoiceResult] = await connection.query(
      `INSERT INTO invoices (
        business_id, customer_id, invoice_number,
        invoice_date, subtotal, discount_amount,
        gst_amount, cgst_amount, sgst_amount,
        igst_amount, is_interstate, grand_total,
        payment_mode, payment_status, notes,
        counter_name, split_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        validCustomerId || null,
        invoiceNumber,
        invoiceDate,
        subtotal,
        discount,
        gstTotal,
        cgstAmount,
        sgstAmount,
        igstAmount,
        isInterstate ? 1 : 0,
        grandTotal,
        normalizedPaymentMode,
        paymentStatus,
        notes || null,
        assignedCounter,
        splitDetailsStr,
      ]
    );

    const invoiceId = invoiceResult.insertId;

    // Insert invoice items and update stock
    for (const item of invoiceItems) {
      await connection.query(
        `INSERT INTO invoice_items (
          invoice_id, product_id, product_name,
          sku, hsn_sac, unit, quantity, unit_price,
          discount_percent, discount_amount,
          taxable_amount, gst_percent, gst_amount,
          line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          item.productId,
          item.productName,
          item.sku || null,
          item.hsnSac || null,
          item.unit || "PCS",
          item.quantity,
          item.unitPrice,
          item.discountPercent,
          item.discountAmount,
          item.taxableAmount,
          item.gstPercent,
          item.gstAmount,
          item.lineTotal,
        ]
      );

      await connection.query(
        `UPDATE products
         SET stock_quantity = stock_quantity - ?
         WHERE id = ? AND business_id = ?`,
        [item.quantity, item.productId, businessId]
      );
    }

    // Update next invoice number
    await connection.query(
      `UPDATE businesses
       SET invoice_next_number = invoice_next_number + 1
       WHERE id = ?`,
      [businessId]
    );

    // Record payment for non-credit invoices
    if (paymentStatus === "PAID") {
      if (normalizedPaymentMode === "Split" && finalSplit && typeof finalSplit === "object") {
        const cashAmt = Number(finalSplit.cash || 0);
        const upiAmt = Number(finalSplit.upi || 0);
        const cardAmt = Number(finalSplit.card || 0);

        if (cashAmt > 0) {
          await connection.query(
            `INSERT INTO payments_received (
              business_id, invoice_id, payment_mode,
              amount, payment_date
            ) VALUES (?, ?, ?, ?, ?)`,
            [businessId, invoiceId, "Cash", cashAmt, invoiceDate]
          );
        }
        if (upiAmt > 0) {
          await connection.query(
            `INSERT INTO payments_received (
              business_id, invoice_id, payment_mode,
              amount, payment_date
            ) VALUES (?, ?, ?, ?, ?)`,
            [businessId, invoiceId, "UPI", upiAmt, invoiceDate]
          );
        }
        if (cardAmt > 0) {
          await connection.query(
            `INSERT INTO payments_received (
              business_id, invoice_id, payment_mode,
              amount, payment_date
            ) VALUES (?, ?, ?, ?, ?)`,
            [businessId, invoiceId, "Card", cardAmt, invoiceDate]
          );
        }
      } else {
        await connection.query(
          `INSERT INTO payments_received (
            business_id, invoice_id, payment_mode,
            amount, payment_date
          ) VALUES (?, ?, ?, ?, ?)`,
          [
            businessId,
            invoiceId,
            normalizedPaymentMode,
            grandTotal,
            invoiceDate,
          ]
        );
      }
    }

    await connection.commit();

    return res.status(201).json({
      message: "Invoice created successfully.",
      invoiceId,
      invoiceNumber,
      subtotal,
      discountAmount: discount,
      gstAmount: gstTotal,
      cgstAmount,
      sgstAmount,
      igstAmount,
      isInterstate,
      grandTotal,
      paymentMode: normalizedPaymentMode,
      paymentStatus,
      splitDetails: finalSplit,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError.message);
      }
    }

    console.error("CREATE INVOICE ERROR:", {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      sql: error.sql,
    });

    return res.status(500).json({
      message: error.message || "Unable to create invoice.",
      code: error.code || "UNKNOWN_ERROR",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// GET ALL INVOICES
const getInvoices = async (req, res) => {
  try {
    const businessId = await getBusinessId(req.user.id);

    if (!businessId) {
      return res.status(404).json({
        message: "Business details not found.",
      });
    }

    const [invoices] = await db.query(
      `SELECT i.*, c.customer_name, c.mobile, c.email
       FROM invoices i
       LEFT JOIN customers c
         ON c.id = i.customer_id
        AND c.business_id = i.business_id
       WHERE i.business_id = ?
       ORDER BY i.id DESC`,
      [businessId]
    );

    return res.status(200).json(invoices);
  } catch (error) {
    console.error("GET INVOICES ERROR:", error);

    return res.status(500).json({
      message: "Unable to load invoices.",
      error: error.message,
    });
  }
};

// GET SINGLE INVOICE
const getInvoiceById = async (req, res) => {
  try {
    const businessId = await getBusinessId(req.user.id);

    if (!businessId) {
      return res.status(404).json({
        message: "Business details not found.",
      });
    }

    const invoiceId = Number(req.params.id);

    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return res.status(400).json({
        message: "Invalid invoice ID.",
      });
    }

    const [invoiceRows] = await db.query(
      `SELECT i.*, c.customer_name, c.mobile, c.email,
              c.address, c.gstin, c.state
       FROM invoices i
       LEFT JOIN customers c
         ON c.id = i.customer_id
        AND c.business_id = i.business_id
       WHERE i.id = ? AND i.business_id = ?
       LIMIT 1`,
      [invoiceId, businessId]
    );

    if (!invoiceRows.length) {
      return res.status(404).json({
        message: "Invoice not found.",
      });
    }

    const [items] = await db.query(
      `SELECT * FROM invoice_items
       WHERE invoice_id = ?
       ORDER BY id ASC`,
      [invoiceId]
    );

    const [businessRows] = await db.query(
      `SELECT business_name, owner_name, email, mobile, address, gst_number, pan_number, state, logo
       FROM businesses
       WHERE id = ?
       LIMIT 1`,
      [businessId]
    );

    return res.status(200).json({
      invoice: invoiceRows[0],
      items,
      business: businessRows[0] || null,
    });
  } catch (error) {
    console.error("GET INVOICE ERROR:", error);

    return res.status(500).json({
      message: "Unable to load invoice.",
      error: error.message,
    });
  }
};

// DELETE INVOICE
const deleteInvoice = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const businessId = await getBusinessId(req.user.id);

    if (!businessId) {
      return res.status(404).json({
        message: "Business details not found.",
      });
    }

    const invoiceId = Number(req.params.id);

    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return res.status(400).json({
        message: "Invalid invoice ID.",
      });
    }

    await connection.beginTransaction();

    const [invoiceRows] = await connection.query(
      `SELECT id FROM invoices
       WHERE id = ? AND business_id = ?
       LIMIT 1 FOR UPDATE`,
      [invoiceId, businessId]
    );

    if (!invoiceRows.length) {
      await connection.rollback();

      return res.status(404).json({
        message: "Invoice not found.",
      });
    }

    const [items] = await connection.query(
      `SELECT product_id, quantity
       FROM invoice_items
       WHERE invoice_id = ?`,
      [invoiceId]
    );

    for (const item of items) {
      if (item.product_id) {
        await connection.query(
          `UPDATE products
           SET stock_quantity = stock_quantity + ?
           WHERE id = ? AND business_id = ?`,
          [item.quantity, item.product_id, businessId]
        );
      }
    }

    await connection.query(
      `DELETE FROM payments_received
       WHERE invoice_id = ? AND business_id = ?`,
      [invoiceId, businessId]
    );

    await connection.query(
      "DELETE FROM invoice_items WHERE invoice_id = ?",
      [invoiceId]
    );

    await connection.query(
      "DELETE FROM invoices WHERE id = ? AND business_id = ?",
      [invoiceId, businessId]
    );

    await connection.commit();

    return res.status(200).json({
      message: "Invoice deleted successfully.",
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Delete rollback error:", rollbackError.message);
      }
    }

    console.error("DELETE INVOICE ERROR:", {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      sql: error.sql,
    });

    return res.status(500).json({
      message: error.message || "Unable to delete invoice.",
      code: error.code || "UNKNOWN_ERROR",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  deleteInvoice,
};
