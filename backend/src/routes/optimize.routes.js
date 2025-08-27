const express = require("express");
const router = express.Router();

// IMPORTANT: path and name must match exactly
const { optimizeHandler } = require("../controllers/optimize.controller");

router.post("/optimize", optimizeHandler);

module.exports = router;
