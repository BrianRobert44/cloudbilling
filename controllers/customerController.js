const db = require("../config/db");

// Helper: Get or automatically create business ID for user
const getOrCreateBusinessId = async (userId) => {
  const [businessRows] = await db.query(
    "SELECT id FROM businesses WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (businessRows && businessRows.length > 0) {
    return businessRows[0].id;
  }

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

// =====================================
// GET CUSTOMERS
// =====================================
const getCustomers = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const businessId = await getOrCreateBusinessId(userId);

    const [customers] = await db.query(
      `SELECT
        id,
        customer_name,
        mobile,
        email,
        address,
        gstin,
        state,
        customer_type,
        opening_outstanding,
        created_at
      FROM customers
      WHERE business_id = ?
      ORDER BY id DESC`,
      [businessId]
    );

    res.json(customers || []);
  } catch (error) {
    console.error("GET CUSTOMERS ERROR:", error);
    res.status(500).json({
      message: "Unable to load customers.",
      error: error.message,
    });
  }
};

// =====================================
// ADD CUSTOMER
// =====================================
const createCustomer = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;

    const {
      customerName,
      mobile,
      email,
      address,
      gstin,
      state,
      customerType,
      openingOutstanding,
    } = req.body;

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({
        message: "Customer name is required.",
      });
    }

    const businessId = await getOrCreateBusinessId(userId);

    const [result] = await db.query(
      `INSERT INTO customers (
        business_id,
        customer_name,
        mobile,
        email,
        address,
        gstin,
        state,
        customer_type,
        opening_outstanding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        customerName.trim(),
        mobile || null,
        email || null,
        address || null,
        gstin || null,
        state || null,
        customerType || "Individual",
        Number(openingOutstanding) || 0,
      ]
    );

    const newCustomer = {
      id: result.insertId,
      customer_name: customerName.trim(),
      mobile: mobile || null,
      email: email || null,
      address: address || null,
      gstin: gstin || null,
      state: state || null,
      customer_type: customerType || "Individual",
      opening_outstanding: Number(openingOutstanding) || 0,
    };

    res.status(201).json({
      message: "Customer added successfully.",
      customerId: result.insertId,
      customer: newCustomer,
    });
  } catch (error) {
    console.error("CREATE CUSTOMER ERROR:", error);
    res.status(500).json({
      message: "Unable to add customer.",
      error: error.message,
    });
  }
};

// =====================================
// UPDATE CUSTOMER
// =====================================
const updateCustomer = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const customerId = req.params.id;

    const {
      customerName,
      mobile,
      email,
      address,
      gstin,
      state,
      customerType,
      openingOutstanding,
    } = req.body;

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({
        message: "Customer name is required.",
      });
    }

    const businessId = await getOrCreateBusinessId(userId);

    const [result] = await db.query(
      `UPDATE customers SET
        customer_name = ?,
        mobile = ?,
        email = ?,
        address = ?,
        gstin = ?,
        state = ?,
        customer_type = ?,
        opening_outstanding = ?
      WHERE id = ? AND business_id = ?`,
      [
        customerName.trim(),
        mobile || null,
        email || null,
        address || null,
        gstin || null,
        state || null,
        customerType || "Individual",
        Number(openingOutstanding) || 0,
        customerId,
        businessId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Customer not found.",
      });
    }

    res.json({
      message: "Customer updated successfully.",
    });
  } catch (error) {
    console.error("UPDATE CUSTOMER ERROR:", error);
    res.status(500).json({
      message: "Unable to update customer.",
      error: error.message,
    });
  }
};

// =====================================
// DELETE CUSTOMER
// =====================================
const deleteCustomer = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const customerId = req.params.id;

    const businessId = await getOrCreateBusinessId(userId);

    const [result] = await db.query(
      `DELETE FROM customers
       WHERE id = ? AND business_id = ?`,
      [customerId, businessId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Customer not found.",
      });
    }

    res.json({
      message: "Customer deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE CUSTOMER ERROR:", error);
    res.status(500).json({
      message: "Unable to delete customer.",
      error: error.message,
    });
  }
};

module.exports = {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
