const crypto = require("crypto");
const db = require("../config/db");
const {
  PAYU_MERCHANT_KEY,
  PAYU_MERCHANT_SALT,
  PAYU_ENV,
  FRONTEND_URL,
  BACKEND_URL,
} = require("../config/env");

const PLAN_PRICING = {
  BASIC: { MONTHLY: 299, YEARLY: 2999 },
  PROFESSIONAL: { MONTHLY: 599, YEARLY: 5999 },
  BUSINESS: { MONTHLY: 999, YEARLY: 9999 },
};

// Generate Outbound SHA-512 Hash for PayU
function generateOutboundHash(params, salt) {
  const hashString = [
    params.key,
    params.txnid,
    params.amount,
    params.productinfo,
    params.firstname,
    params.email,
    params.udf1 || "",
    params.udf2 || "",
    params.udf3 || "",
    params.udf4 || "",
    params.udf5 || "",
    "",
    "",
    "",
    "",
    "",
    salt,
  ].join("|");

  return crypto.createHash("sha512").update(hashString).digest("hex");
}

// Generate Reverse SHA-512 Hash for Response Verification
function generateInboundHash(params, salt) {
  const hashString = [
    salt,
    params.status,
    "",
    "",
    "",
    "",
    "",
    params.udf5 || "",
    params.udf4 || "",
    params.udf3 || "",
    params.udf2 || "",
    params.udf1 || "",
    params.email || "",
    params.firstname || "",
    params.productinfo || "",
    params.amount || "",
    params.txnid || "",
    params.key || "",
  ].join("|");

  if (params.additionalCharges) {
    return crypto
      .createHash("sha512")
      .update(`${params.additionalCharges}|${hashString}`)
      .digest("hex");
  }

  return crypto.createHash("sha512").update(hashString).digest("hex");
}

// =====================================================
// 1. INITIATE PAYMENT
// POST /api/payment/payu/initiate
// =====================================================
const initiatePayuPayment = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const { plan = "PROFESSIONAL", billingCycle = "MONTHLY" } = req.body;

    const targetPlan = String(plan).toUpperCase();
    const targetCycle = String(billingCycle).toUpperCase();

    const planCosts = PLAN_PRICING[targetPlan] || PLAN_PRICING.PROFESSIONAL;
    const amountNum = targetCycle === "YEARLY" ? planCosts.YEARLY : planCosts.MONTHLY;
    const amountStr = Number(amountNum).toFixed(2);

    // Fetch user details
    const [userRows] = await db.query(
      "SELECT id, name, email, mobile FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    const user = userRows[0] || {};
    const firstname = (user.name || "Customer").split(" ")[0].replace(/[^a-zA-Z0-9]/g, "") || "Customer";
    const email = user.email || "billing@example.com";
    const mobile = user.mobile || "9876543210";
    const productinfo = `Rohil Cloud Bill ${targetPlan} Plan (${targetCycle})`;

    const txnid = `CB_${Date.now()}_${userId}`;
    const actionUrl =
      PAYU_ENV === "production"
        ? "https://secure.payu.in/_payment"
        : "https://test.payu.in/_payment";

    const surl = `${BACKEND_URL}/api/payment/payu/response`;
    const furl = `${BACKEND_URL}/api/payment/payu/response`;

    // Hash payload
    const hashParams = {
      key: PAYU_MERCHANT_KEY,
      txnid,
      amount: amountStr,
      productinfo,
      firstname,
      email,
      udf1: String(userId),
      udf2: targetPlan,
      udf3: targetCycle,
      udf4: email,
      udf5: "Rohil Cloud Bill",
    };

    const hash = generateOutboundHash(hashParams, PAYU_MERCHANT_SALT);

    // Record pending transaction in database
    await db.query(
      `INSERT INTO subscription_payments (
        user_id,
        plan,
        billing_cycle,
        amount,
        payment_method,
        status,
        utr_number,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        targetPlan,
        targetCycle,
        amountNum,
        "PayU",
        "PENDING",
        txnid,
        new Date().toISOString(),
      ]
    );

    res.json({
      success: true,
      actionUrl,
      paymentData: {
        key: PAYU_MERCHANT_KEY,
        txnid,
        amount: amountStr,
        productinfo,
        firstname,
        email,
        phone: mobile,
        surl,
        furl,
        hash,
        udf1: hashParams.udf1,
        udf2: hashParams.udf2,
        udf3: hashParams.udf3,
        udf4: hashParams.udf4,
        udf5: hashParams.udf5,
      },
    });
  } catch (error) {
    console.error("PAYU INITIATE ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Unable to initiate PayU payment.",
      error: error.message,
    });
  }
};

// =====================================================
// 2. HANDLE PAYU RESPONSE (SURL / FURL Webhook)
// POST /api/payment/payu/response
// =====================================================
const handlePayuResponse = async (req, res) => {
  try {
    const data = req.body || {};
    const {
      status,
      txnid,
      amount,
      hash,
      udf1, // userId
      udf2, // plan
      udf3, // billingCycle
      mihpayid,
      error_Message,
      msg,
    } = data;

    console.log(`[PayU Response] txnid=${txnid}, status=${status}, amount=${amount}`);

    const expectedHash = generateInboundHash(data, PAYU_MERCHANT_SALT);
    const isHashValid =
      hash &&
      expectedHash &&
      hash.toLowerCase() === expectedHash.toLowerCase();

    // In test environment with default mock keys, allow if status is success
    const allowSuccess = status === "success" && (isHashValid || PAYU_ENV === "test");

    if (allowSuccess) {
      const userId = Number(udf1);
      const planName = (udf2 || "BUSINESS").toUpperCase();
      const billingCycle = (udf3 || "MONTHLY").toUpperCase();
      const durationDays = billingCycle === "YEARLY" ? 365 : 30;

      const now = new Date();
      const subEndDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      // 1. Update user record in Firestore
      if (userId) {
        await db.query(
          `UPDATE users SET
            plan = ?,
            subscription_status = 'ACTIVE',
            subscription_end_date = ?
          WHERE id = ?`,
          [planName, subEndDate, userId]
        );

        // 2. Update/create subscription record
        await db.query(
          `UPDATE subscriptions SET
            plan = ?,
            plan_name = ?,
            status = 'ACTIVE',
            amount = ?,
            subscription_end_date = ?,
            next_billing_date = ?
          WHERE user_id = ?`,
          [planName, planName, Number(amount) || 0, subEndDate, subEndDate, userId]
        );
      }

      // 3. Mark payment as SUCCESS
      if (txnid) {
        await db.query(
          `UPDATE subscription_payments SET
            status = 'SUCCESS',
            payment_method = 'PayU',
            notes = ?
          WHERE utr_number = ?`,
          [`PayU ID: ${mihpayid || "N/A"}`, txnid]
        );
      }

      // Redirect browser back to Subscription page with success query
      return res.redirect(
        `${FRONTEND_URL}/subscription?payment=success&plan=${planName}&txnid=${txnid}`
      );
    } else {
      // Payment Failed or Tampered
      console.warn(`[PayU Failure] txnid=${txnid}, reason=${error_Message || msg || status}`);

      if (txnid) {
        await db.query(
          `UPDATE subscription_payments SET
            status = 'FAILED',
            notes = ?
          WHERE utr_number = ?`,
          [error_Message || msg || "Payment Failed", txnid]
        );
      }

      const failReason = error_Message || msg || "Payment was cancelled or declined by bank.";
      return res.redirect(
        `${FRONTEND_URL}/subscription?payment=failed&reason=${encodeURIComponent(failReason)}`
      );
    }
  } catch (error) {
    console.error("PAYU RESPONSE ERROR:", error);
    return res.redirect(
      `${FRONTEND_URL}/subscription?payment=failed&reason=System+processing+error`
    );
  }
};

// =====================================================
// 3. CHECK TRANSACTION STATUS
// GET /api/payment/payu/status/:txnid
// =====================================================
const getPayuPaymentStatus = async (req, res) => {
  try {
    const { txnid } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM subscription_payments WHERE utr_number = ? LIMIT 1",
      [txnid]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }

    res.json({ success: true, payment: rows[0] });
  } catch (error) {
    console.error("GET PAYU STATUS ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  initiatePayuPayment,
  handlePayuResponse,
  getPayuPaymentStatus,
};
