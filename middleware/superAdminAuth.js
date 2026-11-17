
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { JWT_SECRET } = require("../config/env");

const superAdminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REPLACED",
        message: "Authorization token missing. Please login again.",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : (authHeader.startsWith("bearer ") ? authHeader.split(" ")[1] : authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REPLACED",
        message: "Authorization token missing. Please login again.",
      });
    }

    if (!JWT_SECRET) {
      console.error("JWT_SECRET missing in config/env");
      return res.status(500).json({
        success: false,
        message: "JWT configuration error",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      console.error("JWT VERIFY ERROR:", error.message);

      return res.status(401).json({
        success: false,
        message:
          error.name === "TokenExpiredError"
            ? "Token expired. Please login again."
            : "Invalid token. Please login again.",
      });
    }

    const adminId = decoded.id || decoded.userId;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: "Admin ID missing in token",
      });
    }

    const [users] = await db.query(
      `SELECT id, name, email, role, is_active, active_session_id
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [adminId]
    );

    if (!users.length) {
      return res.status(401).json({
        success: false,
        message: "Admin account not found",
      });
    }

    const admin = users[0];
    const role = String(admin.role || "").toUpperCase();

    // Your login code uses ADMIN role
    if (!["ADMIN", "SUPER_ADMIN"].includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Admin access denied",
      });
    }

    if (Number(admin.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Admin account is inactive",
      });
    }

    // Single active device session validation for admin
    if (!admin.active_session_id || !decoded.sessionId || admin.active_session_id !== decoded.sessionId) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REPLACED",
        message: "Your account has been logged in on another device.",
      });
    }

    req.admin = admin;

    next();

  } catch (error) {
    console.error("SUPER ADMIN AUTH ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication server error",
    });
  }
};

module.exports = superAdminAuth;
