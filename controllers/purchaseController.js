const db = require("../config/db");
const { getOrCreateBusinessId } = require("./vendorController");

// =====================================
// GET PURCHASES
// =====================================
const getPurchases = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const businessId = await getOrCreateBusinessId(userId);

    const [purchases] = await db.query(
      `SELECT
        id,
        business_id,
        vendor_id,
        vendor_name,
        bill_number,
        purchase_date,
        payment_status,
        payment_mode,
        subtotal,
        tax_amount,
        discount,
        total_amount,
        paid_amount,
        balance_due,
        notes,
        created_at
      FROM purchases
      WHERE business_id = ?
      ORDER BY id DESC`,
      [businessId]
    );

    res.json(purchases || []);
  } catch (error) {
    console.error("GET PURCHASES ERROR:", error);
    res.status(500).json({
      message: "Unable to load purchase records.",
      error: error.message,
    });
  }
};

// =====================================
// GET PURCHASE BY ID WITH ITEMS
// =====================================
const getPurchaseById = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const purchaseId = req.params.id;
    const businessId = await getOrCreateBusinessId(userId);

    const [purchases] = await db.query(
      `SELECT * FROM purchases WHERE id = ? AND business_id = ? LIMIT 1`,
      [purchaseId, businessId]
    );

    if (!purchases || purchases.length === 0) {
      return res.status(404).json({ message: "Purchase record not found." });
    }

    const [items] = await db.query(
      `SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id ASC`,
      [purchaseId]
    );

    res.json({
      purchase: purchases[0],
      items: items || [],
    });
  } catch (error) {
    console.error("GET PURCHASE BY ID ERROR:", error);
    res.status(500).json({
      message: "Unable to load purchase details.",
      error: error.message,
    });
  }
};

// =====================================
// CREATE PURCHASE (INWARD BILL + AUTO STOCK)
// =====================================
const createPurchase = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const businessId = await getOrCreateBusinessId(userId);

    const {
      vendorId,
      billNumber,
      purchaseDate,
      paymentStatus,
      paymentMode,
      subtotal,
      taxAmount,
      discount,
      totalAmount,
      paidAmount,
      notes,
      items,
    } = req.body;

    if (!vendorId) {
      return res.status(400).json({ message: "Vendor selection is required." });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "At least one product item is required." });
    }

    // Lookup vendor
    const [vendors] = await db.query(
      `SELECT id, vendor_name, current_balance FROM vendors WHERE id = ? AND business_id = ? LIMIT 1`,
      [vendorId, businessId]
    );

    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: "Selected vendor not found." });
    }

    const vendor = vendors[0];
    const vendorName = vendor.vendor_name;

    const total = Number(totalAmount) || 0;
    const paid = Number(paidAmount) || 0;
    const balanceDue = Math.max(0, total - paid);
    const resolvedStatus =
      paymentStatus ||
      (balanceDue <= 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "UNPAID");

    const effectiveDate = purchaseDate || new Date().toISOString().slice(0, 10);
    const effectiveBillNo =
      billNumber && billNumber.trim()
        ? billNumber.trim()
        : `PUR-${Date.now().toString().slice(-6)}`;

    // 1. Insert Purchase Record
    const [purchaseResult] = await db.query(
      `INSERT INTO purchases (
        business_id,
        vendor_id,
        vendor_name,
        bill_number,
        purchase_date,
        payment_status,
        payment_mode,
        subtotal,
        tax_amount,
        discount,
        total_amount,
        paid_amount,
        balance_due,
        notes,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        vendorId,
        vendorName,
        effectiveBillNo,
        effectiveDate,
        resolvedStatus,
        paymentMode || "Cash",
        Number(subtotal) || 0,
        Number(taxAmount) || 0,
        Number(discount) || 0,
        total,
        paid,
        balanceDue,
        notes ? notes.trim() : null,
        new Date().toISOString(),
      ]
    );

    const purchaseId = purchaseResult.insertId;

    // 2. Insert line items and auto-update product inventory stocks
    for (const item of items) {
      const productId = item.productId || item.product_id || null;
      const productName = item.productName || item.product_name || "Item";
      const quantity = Number(item.quantity) || 1;
      const purchasePrice = Number(item.purchasePrice || item.purchase_price) || 0;
      const gstRate = Number(item.gstRate || item.gst_rate) || 0;
      const itemTax = Number(item.taxAmount || item.tax_amount) || 0;
      const itemTotal =
        Number(item.totalAmount || item.total_amount) ||
        quantity * purchasePrice + itemTax;

      // Insert purchase item
      await db.query(
        `INSERT INTO purchase_items (
          purchase_id,
          product_id,
          product_name,
          quantity,
          purchase_price,
          gst_rate,
          tax_amount,
          total_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          purchaseId,
          productId,
          productName,
          quantity,
          purchasePrice,
          gstRate,
          itemTax,
          itemTotal,
        ]
      );

      // Auto-update Product Stock in inventory!
      if (productId) {
        const [prodRows] = await db.query(
          `SELECT id, stock_quantity, purchase_price FROM products WHERE id = ? AND business_id = ? LIMIT 1`,
          [productId, businessId]
        );

        if (prodRows && prodRows.length > 0) {
          const currentStock = Number(prodRows[0].stock_quantity) || 0;
          const newStock = currentStock + quantity;
          const updatedCost =
            purchasePrice > 0 ? purchasePrice : prodRows[0].purchase_price;

          await db.query(
            `UPDATE products SET stock_quantity = ?, purchase_price = ? WHERE id = ? AND business_id = ?`,
            [newStock, updatedCost, productId, businessId]
          );
        }
      }
    }

    // 3. Update Vendor's payable balance if unpaid/partial
    if (balanceDue > 0) {
      const newVendorBalance = (Number(vendor.current_balance) || 0) + balanceDue;
      await db.query(
        `UPDATE vendors SET current_balance = ? WHERE id = ? AND business_id = ?`,
        [newVendorBalance, vendorId, businessId]
      );
    }

    res.status(201).json({
      message: "Purchase bill recorded and product stock inwarded successfully.",
      purchaseId,
      billNumber: effectiveBillNo,
      balanceDue,
    });
  } catch (error) {
    console.error("CREATE PURCHASE ERROR:", error);
    res.status(500).json({
      message: "Unable to record purchase bill.",
      error: error.message,
    });
  }
};

// =====================================
// DELETE PURCHASE (REVERTS STOCK & VENDOR BALANCE)
// =====================================
const deletePurchase = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const purchaseId = req.params.id;
    const businessId = await getOrCreateBusinessId(userId);

    // Fetch purchase
    const [purchases] = await db.query(
      `SELECT * FROM purchases WHERE id = ? AND business_id = ? LIMIT 1`,
      [purchaseId, businessId]
    );

    if (!purchases || purchases.length === 0) {
      return res.status(404).json({ message: "Purchase record not found." });
    }

    const purchase = purchases[0];

    // Fetch items to reverse product stock
    const [items] = await db.query(
      `SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?`,
      [purchaseId]
    );

    if (items && items.length > 0) {
      for (const item of items) {
        if (item.product_id) {
          const [prodRows] = await db.query(
            `SELECT id, stock_quantity FROM products WHERE id = ? AND business_id = ? LIMIT 1`,
            [item.product_id, businessId]
          );

          if (prodRows && prodRows.length > 0) {
            const currentStock = Number(prodRows[0].stock_quantity) || 0;
            const revertedStock = Math.max(0, currentStock - Number(item.quantity || 0));
            await db.query(
              `UPDATE products SET stock_quantity = ? WHERE id = ? AND business_id = ?`,
              [revertedStock, item.product_id, businessId]
            );
          }
        }
      }
    }

    // Revert vendor balance due
    if (purchase.balance_due > 0 && purchase.vendor_id) {
      const [vendorRows] = await db.query(
        `SELECT id, current_balance FROM vendors WHERE id = ? AND business_id = ? LIMIT 1`,
        [purchase.vendor_id, businessId]
      );

      if (vendorRows && vendorRows.length > 0) {
        const currentBal = Number(vendorRows[0].current_balance) || 0;
        const revertedBal = Math.max(0, currentBal - Number(purchase.balance_due));
        await db.query(
          `UPDATE vendors SET current_balance = ? WHERE id = ? AND business_id = ?`,
          [revertedBal, purchase.vendor_id, businessId]
        );
      }
    }

    // Delete items & purchase
    await db.query(`DELETE FROM purchase_items WHERE purchase_id = ?`, [purchaseId]);
    await db.query(`DELETE FROM purchases WHERE id = ? AND business_id = ?`, [
      purchaseId,
      businessId,
    ]);

    res.json({
      message: "Purchase record removed and product stocks successfully updated.",
    });
  } catch (error) {
    console.error("DELETE PURCHASE ERROR:", error);
    res.status(500).json({
      message: "Unable to delete purchase record.",
      error: error.message,
    });
  }
};

module.exports = {
  getPurchases,
  getPurchaseById,
  createPurchase,
  deletePurchase,
};
