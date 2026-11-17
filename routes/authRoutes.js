

const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

// Register
router.post("/register", authController.register);

// Login
router.post("/login", authController.login);

// Google Sign-In
router.post("/google", authController.googleLogin);

// Forgot Password - Get Security Question
router.post("/forgot-password", authController.getSecurityQuestion);

// Reset Password
router.post("/reset-password", authController.resetPassword);

// Session Check (Validates active session)
router.get("/session-check", authMiddleware, authController.sessionCheck);

// Logout (Invalidates active session)
router.post("/logout", authMiddleware, authController.logout);

module.exports = router;
