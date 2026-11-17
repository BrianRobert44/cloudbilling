const express = require("express");
const router = express.Router();

const {
  getPurchases,
  getPurchaseById,
  createPurchase,
  deletePurchase,
} = require("../controllers/purchaseController");

const authMiddleware = require("../middleware/authMiddleware");

// GET all purchases
router.get("/", authMiddleware, getPurchases);

// GET single purchase with items
router.get("/:id", authMiddleware, getPurchaseById);

// CREATE purchase bill & inward stock
router.post("/", authMiddleware, createPurchase);

// DELETE purchase bill & revert stock
router.delete("/:id", authMiddleware, deletePurchase);

module.exports = router;
