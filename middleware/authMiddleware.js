const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");
const db = require("../config/db");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Authorization header check
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required.",
      });
    }

    // Bearer token
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization token.",
      });
    }

    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        message:
          jwtErr.name === "TokenExpiredError"
            ? "Token expired. Please login again."
            : "Invalid or expired token.",
      });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload.",
      });
    }

    // Check user and active session in database
    const [users] = await db.query(
      `SELECT id, business_id, name, email, role, is_active, active_session_id, subscription_status, plan, trial_end_date, subscription_end_date
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    if (!users.length) {
      return res.status(401).json({
        success: false,
        message: "User account not found.",
      });
    }

    const user = users[0];

    // Deactivated user check
    if (Number(user.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated.",
      });
    }

    // SINGLE ACTIVE DEVICE SESSION VALIDATION
    // Any valid token MUST match the user's currently active_session_id.
    // If the token has no sessionId, or if active_session_id is null (logged out),
    // or if the session IDs do not match: reject with 401 SESSION_REPLACED.
    if (!user.active_session_id || !decoded.sessionId || user.active_session_id !== decoded.sessionId) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REPLACED",
        message: "Your account has been logged in on another device.",
      });
    }

    // Store verified user and session details in request
    req.user = {
      ...decoded,
      ...user,
      id: user.id,
      userId: user.id,
      businessId: user.business_id || decoded.businessId || null,
      sessionId: decoded.sessionId || user.active_session_id,
    };

    next();
  } catch (error) {
    console.error("Auth Error:", error);

    return res.status(401).json({
      success: false,
      message: "Authentication validation error.",
    });
  }
};

module.exports = authMiddleware;
