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
// GET VENDORS
// =====================================
const getVendors = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const businessId = await getOrCreateBusinessId(userId);

    const [vendors] = await db.query(
      `SELECT
        id,
        business_id,
        vendor_name,
        contact_person,
        mobile,
        email,
        address,
        city,
        state,
        pincode,
        gstin,
        bank_name,
        bank_account_no,
        bank_ifsc,
        opening_balance,
        current_balance,
        status,
        notes,
        created_at
      FROM vendors
      WHERE business_id = ?
      ORDER BY id DESC`,
      [businessId]
    );

    res.json(vendors || []);
  } catch (error) {
    console.error("GET VENDORS ERROR:", error);
    res.status(500).json({
      message: "Unable to load vendors.",
      error: error.message,
    });
  }
};

// =====================================
// GET VENDOR STATS
// =====================================
const getVendorStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const businessId = await getOrCreateBusinessId(userId);

    const [vendors] = await db.query(
      `SELECT id, current_balance, status FROM vendors WHERE business_id = ?`,
      [businessId]
    );

    const [purchases] = await db.query(
      `SELECT id, total_amount, balance_due FROM purchases WHERE business_id = ?`,
      [businessId]
    );

    const totalVendors = vendors ? vendors.length : 0;
    const activeVendors = vendors ? vendors.filter((v) => v.status !== "INACTIVE").length : 0;
    const totalPayables = (vendors || []).reduce(
      (sum, v) => sum + (Number(v.current_balance) || 0),
      0
    );
    const totalPurchasesAmount = (purchases || []).reduce(
      (sum, p) => sum + (Number(p.total_amount) || 0),
      0
    );

    res.json({
      totalVendors,
      activeVendors,
      totalPayables,
      totalPurchasesAmount,
      totalPurchasesCount: purchases ? purchases.length : 0,
    });
  } catch (error) {
    console.error("GET VENDOR STATS ERROR:", error);
    res.status(500).json({
      message: "Unable to fetch vendor statistics.",
      error: error.message,
    });
  }
};

// =====================================
// GET SINGLE VENDOR DETAILS WITH PURCHASES
// =====================================
const getVendorById = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const vendorId = req.params.id;
    const businessId = await getOrCreateBusinessId(userId);

    const [vendors] = await db.query(
      `SELECT * FROM vendors WHERE id = ? AND business_id = ? LIMIT 1`,
      [vendorId, businessId]
    );

    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: "Vendor not found." });
    }

    const [purchases] = await db.query(
      `SELECT * FROM purchases WHERE vendor_id = ? AND business_id = ? ORDER BY id DESC`,
      [vendorId, businessId]
    );

    res.json({
      vendor: vendors[0],
      purchases: purchases || [],
    });
  } catch (error) {
    console.error("GET VENDOR BY ID ERROR:", error);
    res.status(500).json({
      message: "Unable to load vendor details.",
      error: error.message,
    });
  }
};

// =====================================
// CREATE VENDOR
// =====================================
const createVendor = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;

    const {
      vendorName,
      contactPerson,
      mobile,
      email,
      address,
      city,
      state,
      pincode,
      gstin,
      bankName,
      bankAccountNo,
      bankIfsc,
      openingBalance,
      notes,
    } = req.body;

    if (!vendorName || !vendorName.trim()) {
      return res.status(400).json({
        message: "Vendor name is required.",
      });
    }

    const businessId = await getOrCreateBusinessId(userId);
    const initialBalance = Number(openingBalance) || 0;

    const [result] = await db.query(
      `INSERT INTO vendors (
        business_id,
        vendor_name,
        contact_person,
        mobile,
        email,
        address,
        city,
        state,
        pincode,
        gstin,
        bank_name,
        bank_account_no,
        bank_ifsc,
        opening_balance,
        current_balance,
        status,
        notes,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        vendorName.trim(),
        contactPerson ? contactPerson.trim() : null,
        mobile ? mobile.trim() : null,
        email ? email.trim() : null,
        address ? address.trim() : null,
        city ? city.trim() : null,
        state ? state.trim() : null,
        pincode ? pincode.trim() : null,
        gstin ? gstin.trim().toUpperCase() : null,
        bankName ? bankName.trim() : null,
        bankAccountNo ? bankAccountNo.trim() : null,
        bankIfsc ? bankIfsc.trim().toUpperCase() : null,
        initialBalance,
        initialBalance, // initial current_balance = opening_balance
        "ACTIVE",
        notes ? notes.trim() : null,
        new Date().toISOString(),
      ]
    );

    const newVendor = {
      id: result.insertId,
      business_id: businessId,
      vendor_name: vendorName.trim(),
      contact_person: contactPerson ? contactPerson.trim() : null,
      mobile: mobile ? mobile.trim() : null,
      email: email ? email.trim() : null,
      address: address ? address.trim() : null,
      city: city ? city.trim() : null,
      state: state ? state.trim() : null,
      pincode: pincode ? pincode.trim() : null,
      gstin: gstin ? gstin.trim().toUpperCase() : null,
      bank_name: bankName ? bankName.trim() : null,
      bank_account_no: bankAccountNo ? bankAccountNo.trim() : null,
      bank_ifsc: bankIfsc ? bankIfsc.trim().toUpperCase() : null,
      opening_balance: initialBalance,
      current_balance: initialBalance,
      status: "ACTIVE",
      notes: notes ? notes.trim() : null,
      created_at: new Date().toISOString(),
    };

    res.status(201).json({
      message: "Vendor created successfully.",
      vendorId: result.insertId,
      vendor: newVendor,
    });
  } catch (error) {
    console.error("CREATE VENDOR ERROR:", error);
    res.status(500).json({
      message: "Unable to create vendor.",
      error: error.message,
    });
  }
};

// =====================================
// UPDATE VENDOR
// =====================================
const updateVendor = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const vendorId = req.params.id;

    const {
      vendorName,
      contactPerson,
      mobile,
      email,
      address,
      city,
      state,
      pincode,
      gstin,
      bankName,
      bankAccountNo,
      bankIfsc,
      openingBalance,
      status,
      notes,
    } = req.body;

    if (!vendorName || !vendorName.trim()) {
      return res.status(400).json({
        message: "Vendor name is required.",
      });
    }

    const businessId = await getOrCreateBusinessId(userId);

    // Retrieve existing vendor to adjust balance if opening_balance changed
    const [existing] = await db.query(
      "SELECT * FROM vendors WHERE id = ? AND business_id = ? LIMIT 1",
      [vendorId, businessId]
    );

    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: "Vendor not found." });
    }

    const currentOpening = Number(existing[0].opening_balance) || 0;
    const newOpening = openingBalance !== undefined ? Number(openingBalance) || 0 : currentOpening;
    const openingDiff = newOpening - currentOpening;
    const updatedCurrentBalance = (Number(existing[0].current_balance) || 0) + openingDiff;

    await db.query(
      `UPDATE vendors SET
        vendor_name = ?,
        contact_person = ?,
        mobile = ?,
        email = ?,
        address = ?,
        city = ?,
        state = ?,
        pincode = ?,
        gstin = ?,
        bank_name = ?,
        bank_account_no = ?,
        bank_ifsc = ?,
        opening_balance = ?,
        current_balance = ?,
        status = ?,
        notes = ?
      WHERE id = ? AND business_id = ?`,
      [
        vendorName.trim(),
        contactPerson ? contactPerson.trim() : null,
        mobile ? mobile.trim() : null,
        email ? email.trim() : null,
        address ? address.trim() : null,
        city ? city.trim() : null,
        state ? state.trim() : null,
        pincode ? pincode.trim() : null,
        gstin ? gstin.trim().toUpperCase() : null,
        bankName ? bankName.trim() : null,
        bankAccountNo ? bankAccountNo.trim() : null,
        bankIfsc ? bankIfsc.trim().toUpperCase() : null,
        newOpening,
        updatedCurrentBalance,
        status || existing[0].status || "ACTIVE",
        notes ? notes.trim() : null,
        vendorId,
        businessId,
      ]
    );

    res.json({
      message: "Vendor updated successfully.",
    });
  } catch (error) {
    console.error("UPDATE VENDOR ERROR:", error);
    res.status(500).json({
      message: "Unable to update vendor.",
      error: error.message,
    });
  }
};

// =====================================
// DELETE VENDOR
// =====================================
const deleteVendor = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const vendorId = req.params.id;
    const businessId = await getOrCreateBusinessId(userId);

    // Check if there are linked purchases
    const [linkedPurchases] = await db.query(
      "SELECT id FROM purchases WHERE vendor_id = ? AND business_id = ? LIMIT 1",
      [vendorId, businessId]
    );

    if (linkedPurchases && linkedPurchases.length > 0) {
      return res.status(400).json({
        message:
          "Cannot delete vendor with existing purchase inward records. You may mark this vendor as INACTIVE instead.",
      });
    }

    const [result] = await db.query(
      "DELETE FROM vendors WHERE id = ? AND business_id = ?",
      [vendorId, businessId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Vendor not found." });
    }

    res.json({
      message: "Vendor deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE VENDOR ERROR:", error);
    res.status(500).json({
      message: "Unable to delete vendor.",
      error: error.message,
    });
  }
};

module.exports = {
  getVendors,
  getVendorStats,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
  getOrCreateBusinessId,
};
