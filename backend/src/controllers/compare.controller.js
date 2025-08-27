const { getAccuracy, getRiskReturn } = require("../services/compare.service");

async function getAccuracyHandler(req, res) {
  try {
    const risk = String(req.query.risk || "medium");
    const data = getAccuracy({ risk });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Internal error" });
  }
}

async function getRiskReturnHandler(req, res) {
  try {
    const {
      dataset = "nifty50",
      maxAssets = 5,
      assetNames = [],
      weights = [],
    } = req.body || {};
    const count = Math.max(3, Math.min(12, Number(maxAssets) || 5));
    const data = getRiskReturn({ dataset, count, assetNames, weights });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Internal error" });
  }
}

module.exports = { getAccuracyHandler, getRiskReturnHandler };
