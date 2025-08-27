// src/controllers/rebalance.controller.js
const { z } = require("zod");

// ✅ Validation schema for request
const RebalanceRequestSchema = z.object({
  dataset_option: z.string(),
  future_dataset_option: z.string(),
  budget: z.number(),
  risk_factor: z.string(),
  total_investment: z.number()
});

// Call Quantum FastAPI /rebalance (real server)
async function callQuantumRebalance(payload) {
  const url = (process.env.QUANTUM_API_URL || "http://127.0.0.1:8000") + "/rebalance";

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Quantum API error ${resp.status}: ${text}`);
    err.type = resp.status === 504 ? "upstream_timeout" : "upstream_unavailable";
    throw err;
  }

  return resp.json();
}

async function rebalanceHandler(req, res) {
  try {
    const payload = RebalanceRequestSchema.parse(req.body);

    // 🔗 Call real FastAPI backend
    const result = await callQuantumRebalance(payload);

    res.json(result);
  } catch (err) {
    console.error("Rebalance error:", err);
    if (err?.issues) {
      return res.status(400).json({
        error: "Invalid request",
        details: err.issues.map((i) => i.message),
      });
    }
    res.status(500).json({ error: err.message || "Internal server error" });
  }
}

module.exports = { rebalanceHandler };
