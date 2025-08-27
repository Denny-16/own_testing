// src/controllers/optimize.controller.js
const { OptimizeRequestSchema } = require("../utils/validate");
const { callQuantumOptimizeJSON } = require("../services/quantum.service");

async function optimizeHandler(req, res, next) {
  try {
    const payload = OptimizeRequestSchema.parse(req.body);
    const result = await callQuantumOptimizeJSON(payload);
    res.json(result);
  } catch (err) {
    if (err?.issues) {
      // zod validation error
      return res.status(400).json({
        error: "Invalid request",
        details: err.issues.map(i => i.message),
      });
    }
    const status = err?.type === "upstream_timeout" ? 504
                : err?.type === "upstream_unavailable" ? 502
                : 500;
    res.status(status).json({ error: err.message || "Internal error" });
  }
}

module.exports = { optimizeHandler };
