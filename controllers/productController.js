const db = require("../config/db");

// Helper: Check if user has Business Plan (₹999)
const checkBusinessPlan = async (userId, userRole) => {
  const [rows] = await db.query(
    "SELECT plan, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) return false;
  const userPlan = String(rows[0].plan || "").toUpperCase();
  return userPlan === "BUSINESS";
};

// Helper: Get or automatically create business ID for user
const getOrCreateBusinessId = async (userId) => {
  const [businessRows] = await db.query(
    "SELECT id FROM businesses WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (businessRows && businessRows.length > 0) {
    return businessRows[0].id;
  }

  // Check user details
  const [userRows] = await db.query(
    "SELECT name, email FROM users WHERE id = ? LIMIT 1",
    [userId]
  );

  const name = userRows[0]?.name || "My";
  const email = userRows[0]?.email || "billing@example.com";

  const [createResult] = await db.query(
    `INSERT INTO businesses (
      user_id, business_name, owner_name, email,
      mobile, business_type, state, invoice_prefix, invoice_next_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      `${name} Business`,
      name,
      email,
      "9876543210",
      "Retail",
      "Tamil Nadu",
      "INV",
      1,
    ]
  );

  return createResult.insertId;
};

// ========================================
// GET ALL PRODUCTS
// ========================================
const getProducts = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const businessId = await getOrCreateBusinessId(userId);

    const [products] = await db.query(
      `SELECT *
       FROM products
       WHERE business_id = ?
       ORDER BY id DESC`,
      [businessId]
    );

    return res.status(200).json(products || []);
  } catch (error) {
    console.error("GET PRODUCTS ERROR:", error);
    return res.status(500).json({
      message: "Unable to load products.",
    });
  }
};

// ========================================
// CREATE PRODUCT
// ========================================
const createProduct = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;

    const {
      sku,
      barcode,
      hsn_sac,
      hsnSac,
      category,
      unit = "PCS",
    } = req.body;

    const rawName = req.body.product_name || req.body.productName;
    const rawSellingPrice = req.body.selling_price !== undefined ? req.body.selling_price : req.body.sellingPrice;
    const rawPurchasePrice = req.body.purchase_price !== undefined ? req.body.purchase_price : (req.body.cost_price !== undefined ? req.body.cost_price : req.body.costPrice || req.body.purchasePrice || 0);
    const rawGst = req.body.gst !== undefined ? req.body.gst : (req.body.gstRate !== undefined ? req.body.gstRate : 0);
    const rawDiscount = req.body.discount !== undefined ? req.body.discount : (req.body.discountAmount !== undefined ? req.body.discountAmount : 0);
    const rawStock = req.body.stock_quantity !== undefined ? req.body.stock_quantity : (req.body.stockQuantity !== undefined ? req.body.stockQuantity : 0);

    if (!rawName || !rawName.trim()) {
      return res.status(400).json({
        message: "Product name is required.",
      });
    }

    if (
      rawSellingPrice === undefined ||
      rawSellingPrice === null ||
      rawSellingPrice === ""
    ) {
      return res.status(400).json({
        message: "Selling price is required.",
      });
    }

    const product_name = rawName.trim();
    const purchasePrice = Number(rawPurchasePrice) || 0;
    const sellingPrice = Number(rawSellingPrice);
    const gstValue = Number(rawGst) || 0;
    const discountValue = Number(rawDiscount) || 0;
    const stockValue = Number(rawStock) || 0;

    if (
      ![purchasePrice, sellingPrice, gstValue, discountValue, stockValue].every(
        Number.isFinite
      ) ||
      purchasePrice < 0 ||
      sellingPrice < 0 ||
      gstValue < 0 ||
      gstValue > 100 ||
      discountValue < 0 ||
      discountValue > 100 ||
      stockValue < 0
    ) {
      return res.status(400).json({
        message: "Please enter valid product values.",
      });
    }

    if (barcode && String(barcode).trim()) {
      const isBusiness = await checkBusinessPlan(userId, req.user?.role);
      if (!isBusiness) {
        return res.status(403).json({
          code: "PLAN_UPGRADE_REQUIRED",
          message:
            "Product Barcode feature is exclusive to the Business Plan (₹999/mo). Please upgrade to use barcodes.",
        });
      }
    }

    const businessId = await getOrCreateBusinessId(userId);

    const [result] = await db.query(
      `INSERT INTO products (
        business_id,
        product_name,
        sku,
        barcode,
        hsn_sac,
        category,
        purchase_price,
        selling_price,
        gst,
        discount,
        stock_quantity,
        unit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        product_name.trim(),
        sku || null,
        barcode || null,
        hsn_sac || null,
        category || null,
        purchasePrice,
        sellingPrice,
        gstValue,
        discountValue,
        stockValue,
        unit || "PCS",
      ]
    );

    const [rows] = await db.query(
      `SELECT * FROM products
       WHERE id = ? AND business_id = ?`,
      [result.insertId, businessId]
    );

    return res.status(201).json({
      message: "Product created successfully.",
      product: rows[0],
    });
  } catch (error) {
    console.error("CREATE PRODUCT ERROR:", error);
    return res.status(500).json({
      message: "Unable to create product.",
    });
  }
};

// ========================================
// UPDATE PRODUCT
// ========================================
const updateProduct = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const productId = req.params.id;

    const {
      product_name,
      sku,
      barcode,
      hsn_sac,
      category,
      purchase_price,
      selling_price,
      gst,
      discount,
      stock_quantity,
      unit,
    } = req.body;

    if (barcode && String(barcode).trim()) {
      const isBusiness = await checkBusinessPlan(userId, req.user?.role);
      if (!isBusiness) {
        return res.status(403).json({
          code: "PLAN_UPGRADE_REQUIRED",
          message:
            "Product Barcode feature is exclusive to the Business Plan (₹999/mo). Please upgrade to use barcodes.",
        });
      }
    }

    const businessId = await getOrCreateBusinessId(userId);

    const [existing] = await db.query(
      `SELECT * FROM products
       WHERE id = ? AND business_id = ?`,
      [productId, businessId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    await db.query(
      `UPDATE products SET
        product_name = ?,
        sku = ?,
        barcode = ?,
        hsn_sac = ?,
        category = ?,
        purchase_price = ?,
        selling_price = ?,
        gst = ?,
        discount = ?,
        stock_quantity = ?,
        unit = ?
       WHERE id = ? AND business_id = ?`,
      [
        product_name !== undefined ? product_name.trim() : existing[0].product_name,
        sku !== undefined ? sku : existing[0].sku,
        barcode !== undefined ? barcode : existing[0].barcode,
        hsn_sac !== undefined ? hsn_sac : existing[0].hsn_sac,
        category !== undefined ? category : existing[0].category,
        purchase_price !== undefined ? Number(purchase_price) : existing[0].purchase_price,
        selling_price !== undefined ? Number(selling_price) : existing[0].selling_price,
        gst !== undefined ? Number(gst) : existing[0].gst,
        discount !== undefined ? Number(discount) : existing[0].discount,
        stock_quantity !== undefined ? Number(stock_quantity) : existing[0].stock_quantity,
        unit !== undefined ? unit : existing[0].unit,
        productId,
        businessId,
      ]
    );

    const [updated] = await db.query(
      `SELECT * FROM products
       WHERE id = ? AND business_id = ?`,
      [productId, businessId]
    );

    return res.status(200).json({
      message: "Product updated successfully.",
      product: updated[0],
    });
  } catch (error) {
    console.error("UPDATE PRODUCT ERROR:", error);
    return res.status(500).json({
      message: "Unable to update product.",
    });
  }
};

// ========================================
// DELETE PRODUCT
// ========================================
const deleteProduct = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const productId = req.params.id;
    const businessId = await getOrCreateBusinessId(userId);

    const [result] = await db.query(
      `DELETE FROM products
       WHERE id = ? AND business_id = ?`,
      [productId, businessId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE PRODUCT ERROR:", error);
    return res.status(500).json({
      message: "Unable to delete product.",
    });
  }
};

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
