const express = require("express");
const router = express.Router();
const counterController = require("../controllers/counterController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.get("/", counterController.getCounters);
router.post("/", counterController.createCounter);
router.put("/:id", counterController.updateCounter);
router.delete("/:id", counterController.deleteCounter);
router.patch("/:id/default", counterController.setDefaultCounter);

module.exports = router;

