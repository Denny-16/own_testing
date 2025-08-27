const express = require("express");
const router = express.Router();
const {
  getAccuracyHandler,
  getRiskReturnHandler,
} = require("../controllers/compare.controller");

router.get("/accuracy", getAccuracyHandler);       // GET /api/compare/accuracy?risk=high
router.post("/risk-return", getRiskReturnHandler); // POST /api/compare/risk-return

module.exports = router;
