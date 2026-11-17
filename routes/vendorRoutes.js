const express = require("express");
const router = express.Router();

const {
  getVendors,
  getVendorStats,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
} = require("../controllers/vendorController");

const authMiddleware = require("../middleware/authMiddleware");

// GET all vendors
router.get("/", authMiddleware, getVendors);

// GET vendor stats
router.get("/stats", authMiddleware, getVendorStats);

// GET single vendor
router.get("/:id", authMiddleware, getVendorById);

// ADD vendor
router.post("/", authMiddleware, createVendor);

// UPDATE vendor
router.put("/:id", authMiddleware, updateVendor);

// DELETE vendor
router.delete("/:id", authMiddleware, deleteVendor);

module.exports = router;
