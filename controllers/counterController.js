const db = require("../config/db");

const getBusinessId = async (userId) => {
  const [rows] = await db.query(
    "SELECT id FROM businesses WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows.length ? rows[0].id : null;
};

const checkCanAddCounter = async (userId, userRole) => {
  const [userRows] = await db.query(
    "SELECT plan, subscription_status, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!userRows.length) return { canAdd: false, plan: "UNKNOWN", status: "UNKNOWN" };

  const user = userRows[0];
  const plan = String(user.plan || "").toUpperCase();
  const status = String(user.subscription_status || "").toUpperCase();

  const isBusinessPlan = plan === "BUSINESS";
  return {
    canAdd: isBusinessPlan,
    plan: plan || "FREE_TRIAL",
    status,
  };
};

// GET /api/counters
exports.getCounters = async (req, res) => {
  try {
    const userId = req.user.id;
    const businessId = await getBusinessId(userId);
    const { canAdd, plan, status } = await checkCanAddCounter(userId, req.user.role);

    let [counters] = await db.query(
      "SELECT * FROM counters WHERE user_id = ? ORDER BY is_default DESC, id ASC",
      [userId]
    );

    // Auto-create default "Main Counter" if none exists
    if (!counters || counters.length === 0) {
      const defaultCounter = {
        user_id: userId,
        business_id: businessId || null,
        name: "Main Counter",
        counter_code: "C-01",
        operator_name: "Cashier",
        is_default: 1,
        status: "ACTIVE",
        created_at: new Date().toISOString(),
      };

      const [insertRes] = await db.query(
        `INSERT INTO counters (
          user_id, business_id, name, counter_code,
          operator_name, is_default, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          defaultCounter.user_id,
          defaultCounter.business_id,
          defaultCounter.name,
          defaultCounter.counter_code,
          defaultCounter.operator_name,
          defaultCounter.is_default,
          defaultCounter.status,
          defaultCounter.created_at,
        ]
      );
      defaultCounter.id = insertRes.insertId;
      counters = [defaultCounter];
    }

    return res.status(200).json({
      success: true,
      canAddCounter: canAdd,
      currentPlan: plan,
      subscriptionStatus: status,
      counters,
    });
  } catch (err) {
    console.error("GET COUNTERS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to load counters",
      error: err.message,
    });
  }
};

// POST /api/counters
exports.createCounter = async (req, res) => {
  try {
    const userId = req.user.id;
    const businessId = await getBusinessId(userId);
    const { canAdd, plan } = await checkCanAddCounter(userId, req.user.role);

    // Business Plan 999 Gating Check
    if (!canAdd) {
      return res.status(403).json({
        success: false,
        code: "PLAN_UPGRADE_REQUIRED",
        message:
          "Adding multiple billing counters is exclusive to the Business Plan (₹999/mo). Upgrade to unlock unlimited billing counters.",
        currentPlan: plan,
        requiredPlan: "BUSINESS",
      });
    }

    const { name, counter_code, operator_name, is_default = 0 } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Counter name is required.",
      });
    }

    const cleanName = name.trim();
    const cleanCode =
      (counter_code || "").trim().toUpperCase() ||
      `C-${Math.floor(10 + Math.random() * 90)}`;
    const cleanOperator = (operator_name || "").trim() || "Cashier";

    // If marked default, unset others
    if (Number(is_default) === 1) {
      await db.query(
        "UPDATE counters SET is_default = 0 WHERE user_id = ?",
        [userId]
      );
    }

    const [result] = await db.query(
      `INSERT INTO counters (
        user_id, business_id, name, counter_code,
        operator_name, is_default, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        businessId || null,
        cleanName,
        cleanCode,
        cleanOperator,
        Number(is_default) === 1 ? 1 : 0,
        "ACTIVE",
        new Date().toISOString(),
      ]
    );

    return res.status(201).json({
      success: true,
      message: `Counter "${cleanName}" created successfully.`,
      counter: {
        id: result.insertId,
        user_id: userId,
        business_id: businessId,
        name: cleanName,
        counter_code: cleanCode,
        operator_name: cleanOperator,
        is_default: Number(is_default) === 1 ? 1 : 0,
        status: "ACTIVE",
      },
    });
  } catch (err) {
    console.error("CREATE COUNTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create counter.",
      error: err.message,
    });
  }
};

// PUT /api/counters/:id
exports.updateCounter = async (req, res) => {
  try {
    const userId = req.user.id;
    const counterId = Number(req.params.id);
    const { name, counter_code, operator_name, status, is_default } = req.body;

    const [existing] = await db.query(
      "SELECT * FROM counters WHERE id = ? AND user_id = ? LIMIT 1",
      [counterId, userId]
    );

    if (!existing.length) {
      return res.status(404).json({
        success: false,
        message: "Counter not found.",
      });
    }

    if (Number(is_default) === 1) {
      await db.query(
        "UPDATE counters SET is_default = 0 WHERE user_id = ?",
        [userId]
      );
    }

    const updatedName = name !== undefined ? name.trim() : existing[0].name;
    const updatedCode =
      counter_code !== undefined
        ? counter_code.trim().toUpperCase()
        : existing[0].counter_code;
    const updatedOperator =
      operator_name !== undefined
        ? operator_name.trim()
        : existing[0].operator_name;
    const updatedStatus =
      status !== undefined ? String(status).toUpperCase() : existing[0].status;
    const updatedDefault =
      is_default !== undefined
        ? Number(is_default)
        : existing[0].is_default;

    await db.query(
      `UPDATE counters
       SET name = ?, counter_code = ?, operator_name = ?, status = ?, is_default = ?
       WHERE id = ? AND user_id = ?`,
      [
        updatedName,
        updatedCode,
        updatedOperator,
        updatedStatus,
        updatedDefault,
        counterId,
        userId,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Counter updated successfully.",
    });
  } catch (err) {
    console.error("UPDATE COUNTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update counter.",
    });
  }
};

// DELETE /api/counters/:id
exports.deleteCounter = async (req, res) => {
  try {
    const userId = req.user.id;
    const counterId = Number(req.params.id);

    const [counters] = await db.query(
      "SELECT * FROM counters WHERE user_id = ?",
      [userId]
    );

    if (counters.length <= 1) {
      return res.status(400).json({
        success: false,
        message:
          "You must keep at least one counter. Cannot delete the only remaining counter.",
      });
    }

    const target = counters.find((c) => c.id === counterId);
    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Counter not found.",
      });
    }

    await db.query(
      "DELETE FROM counters WHERE id = ? AND user_id = ?",
      [counterId, userId]
    );

    if (target.is_default === 1) {
      const remaining = counters.filter((c) => c.id !== counterId);
      if (remaining.length > 0) {
        await db.query(
          "UPDATE counters SET is_default = 1 WHERE id = ?",
          [remaining[0].id]
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Counter deleted successfully.",
    });
  } catch (err) {
    console.error("DELETE COUNTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete counter.",
    });
  }
};

// PATCH /api/counters/:id/default
exports.setDefaultCounter = async (req, res) => {
  try {
    const userId = req.user.id;
    const counterId = Number(req.params.id);

    await db.query(
      "UPDATE counters SET is_default = 0 WHERE user_id = ?",
      [userId]
    );

    const [result] = await db.query(
      "UPDATE counters SET is_default = 1 WHERE id = ? AND user_id = ?",
      [counterId, userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Counter not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Default counter updated.",
    });
  } catch (err) {
    console.error("SET DEFAULT COUNTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to set default counter.",
    });
  }
};

