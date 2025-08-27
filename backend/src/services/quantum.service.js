// src/services/quantum.service.js
const fs = require("node:fs/promises");
const path = require("node:path");
const { config } = require("../config/env");
const {
  FastApiOptimizeResponseSchema,
  NormalizedOptimizeResponseSchema,
} = require("../utils/validate");

// tiny fetch with timeout
async function httpFetch(url, { method = "GET", headers = {}, body, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// UI dataset → FastAPI dataset_option
function mapDatasetOption(uiDataset) {
  switch (uiDataset) {
    case "NIFTY50": return "NIFTY50";
    case "NASDAQ100": return "NASDAQ";
    case "CRYPTO50": return "Crypto";
    default: return "NIFTY50";
  }
}

// Mode A → FastAPI /optimize body
function toFastApiOptimizeBody(modeA) {
  return {
    dataset_option: mapDatasetOption(modeA.dataset),
    budget: Number(modeA.maxAssets),                    // number of assets to pick
    risk_factor: String(modeA.riskLevel || "medium"),   // "low"|"medium"|"high"
    total_investment: Number(modeA.budget),             // ₹
  };
}

// Normalize FastAPI JSON → stable shape for frontend
function normalizeOptimize(fastApiJson) {
  const parsed = FastApiOptimizeResponseSchema.parse(fastApiJson);

  const selected = parsed.portfolio.map(p => p.asset);
  const weights = parsed.portfolio.map(p => Number(p.weight) || 0);
  const allocation = parsed.portfolio.map(p => ({
    name: p.asset,
    value: Math.round(
      typeof p.percentage === "number" ? p.percentage : (Number(p.weight) || 0) * 100
    ),
  }));

  // optional aggregate expected return if provided
  const expRets = parsed.portfolio
    .map(p => (typeof p.expected_return === "number" ? p.expected_return : null))
    .filter(v => v !== null);

  const expectedReturn = expRets.length
    ? expRets.reduce((a, b) => a + b, 0) / expRets.length
    : null;

  const normalized = {
    runId: new Date().toISOString(),
    method: "quantum",
    selected,
    weights,
    allocation,
    expectedReturn,
    risk: null,
    sharpe: null,
    diagnostics: {
      backend: "fastapi",
      dataset: parsed.dataset,
      objectiveValue: parsed.objective_value,
      gamma: parsed.gamma,
    },
  };

  return NormalizedOptimizeResponseSchema.parse(normalized);
}

async function callQuantumOptimizeJSON(modeA) {
  // mock mode
  if (String(process.env.MOCK_MODE || config.mockMode).toLowerCase() === "true") {
    const fp = path.join(process.cwd(), "scripts", "mockPayloads", "sample-optimize.json");
    const txt = await fs.readFile(fp, "utf-8");
    const json = JSON.parse(txt);
    const normalized = normalizeOptimize(json);
    // stamp a fresh runId
    normalized.runId = new Date().toISOString();
    return normalized;
  }

  const base = (process.env.QUANTUM_BASE_URL || config.quantumBaseUrl || "").replace(/\/+$/, "");
  if (!base) {
    const err = new Error("QUANTUM_BASE_URL not set");
    err.type = "upstream_unavailable";
    throw err;
  }

  const body = toFastApiOptimizeBody(modeA);
  const headers = { "Content-Type": "application/json" };
  const key = process.env.QUANTUM_API_KEY || config.quantumApiKey;
  if (key) headers["Authorization"] = `Bearer ${key}`;

  let res;
  try {
    res = await httpFetch(`${base}/optimize`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || config.requestTimeoutMs || 60000),
    });
  } catch (e) {
    const err = new Error("Quantum API request failed or timed out");
    err.type = String(e || "").includes("timeout") ? "upstream_timeout" : "upstream_unavailable";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Quantum API error ${res.status}: ${text || res.statusText}`);
    err.type = res.status === 504 ? "upstream_timeout" : "upstream_unavailable";
    throw err;
  }

  const json = await res.json();
  return normalizeOptimize(json);
}

module.exports = {
  callQuantumOptimizeJSON,
};
