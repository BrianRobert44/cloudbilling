const db = require("../config/db");

// Helper: Get Business ID for logged-in user
const getBusinessId = async (userId) => {
  const [rows] = await db.query(
    "SELECT id FROM businesses WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows.length ? rows[0].id : null;
};

// GET /api/expenses
exports.getExpenses = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const businessId = await getBusinessId(userId);

    if (!businessId) {
      return res.status(200).json({ expenses: [] });
    }

    const [rows] = await db.query(
      "SELECT * FROM expenses WHERE business_id = ? ORDER BY expense_date DESC, id DESC",
      [businessId]
    );

    res.status(200).json({ expenses: rows });
  } catch (error) {
    console.error("Get expenses error:", error);
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
};

// POST /api/expenses
exports.createExpense = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const businessId = await getBusinessId(userId);

    if (!businessId) {
      return res.status(404).json({
        message: "Business details not found. Please setup your business profile first.",
      });
    }

    const {
      title,
      category,
      amount,
      expenseDate,
      paymentMethod,
      description,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: "Expense name is required" });
    }

    if (
      amount === undefined ||
      amount === null ||
      amount === "" ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      return res.status(400).json({ message: "Enter a valid expense amount" });
    }

    if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      return res.status(400).json({ message: "Valid expense date is required" });
    }

    const [result] = await db.query(
      `INSERT INTO expenses
       (business_id, title, category, amount, expense_date, payment_method, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        String(title).trim(),
        category || "Other",
        Number(amount),
        expenseDate,
        paymentMethod || "Cash",
        description || null,
      ]
    );

    const [rows] = await db.query(
      "SELECT * FROM expenses WHERE id = ? AND business_id = ?",
      [result.insertId, businessId]
    );

    res.status(201).json({
      message: "Expense created successfully",
      expense: rows[0],
    });
  } catch (error) {
    console.error("Create expense error:", error);
    res.status(500).json({ message: "Failed to create expense" });
  }
};

// PUT /api/expenses/:id
exports.updateExpense = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const businessId = await getBusinessId(userId);

    if (!businessId) {
      return res.status(404).json({ message: "Business details not found." });
    }

    const { id } = req.params;
    const {
      title,
      category,
      amount,
      expenseDate,
      paymentMethod,
      description,
    } = req.body;

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({ message: "Invalid expense ID" });
    }

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: "Expense name is required" });
    }

    if (
      amount === undefined ||
      amount === null ||
      amount === "" ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      return res.status(400).json({ message: "Enter a valid expense amount" });
    }

    if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      return res.status(400).json({ message: "Valid expense date is required" });
    }

    const [result] = await db.query(
      `UPDATE expenses
       SET title = ?, category = ?, amount = ?, expense_date = ?,
           payment_method = ?, description = ?
       WHERE id = ? AND business_id = ?`,
      [
        String(title).trim(),
        category || "Other",
        Number(amount),
        expenseDate,
        paymentMethod || "Cash",
        description || null,
        Number(id),
        businessId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const [rows] = await db.query(
      "SELECT * FROM expenses WHERE id = ? AND business_id = ?",
      [Number(id), businessId]
    );

    res.status(200).json({
      message: "Expense updated successfully",
      expense: rows[0],
    });
  } catch (error) {
    console.error("Update expense error:", error);
    res.status(500).json({ message: "Failed to update expense" });
  }
};

// DELETE /api/expenses/:id
exports.deleteExpense = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const businessId = await getBusinessId(userId);

    if (!businessId) {
      return res.status(404).json({ message: "Business details not found." });
    }

    const { id } = req.params;

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({ message: "Invalid expense ID" });
    }

    const [result] = await db.query(
      "DELETE FROM expenses WHERE id = ? AND business_id = ?",
      [Number(id), businessId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    res.status(200).json({ message: "Expense deleted successfully" });
  } catch (error) {
    console.error("Delete expense error:", error);
    res.status(500).json({ message: "Failed to delete expense" });
  }
};
