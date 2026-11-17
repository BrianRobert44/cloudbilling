const express = require("express");
const router = express.Router();
const {
  initiatePayuPayment,
  handlePayuResponse,
  getPayuPaymentStatus,
} = require("../controllers/payuPaymentController");
const authMiddleware = require("../middleware/authMiddleware");

// 1. INITIATE PAYMENT (Generates txnid, payload & SHA-512 hash)
router.post("/initiate", authMiddleware, initiatePayuPayment);

// 2. PAYU SURL / FURL CALLBACK (PayU browser form POST)
router.post("/response", handlePayuResponse);

// 3. TRANSACTION STATUS CHECK
router.get("/status/:txnid", authMiddleware, getPayuPaymentStatus);

module.exports = router;
