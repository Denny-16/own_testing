// backend/src/services/quantum.service.js
const fs = require("node:fs/promises");
const path = require("node:path");
const { config } = require("../config/env");
const {
  // Optimize (already had)
  FastApiOptimizeResponseSchema,
  NormalizedOptimizeResponseSchema,
  // Rebalance (new)
  RebalanceRequestSchema,
  RebalanceResponseSchema,
} = require("../utils/validate");

// ---------------- tiny fetch with timeout ----------------
async function httpFetch(url, { method = "GET", headers = {}, body, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------------- UI -> FastAPI mapping helpers ----------------
function mapDatasetOption(uiDataset) {
  // UI might send "NIFTY50"|"NASDAQ100"|"CRYPTO50" or lower-cased labels like "nifty50"|"nasdaq"|"crypto"
  const d = String(uiDataset || "").toUpperCase();
  if (d.includes("NIFTY")) return "NIFTY50";
  if (d.includes("NASDAQ")) return "NASDAQ";
  if (d.includes("CRYPTO")) return "Crypto";
  // fallback to NIFTY
  return "NIFTY50";
}

function mapUiRiskToFast(risk) {
  const r = String(risk || "").toLowerCase();
  if (r === "low" || r === "high") return r;
  return "medium";
}

// ---------------- OPTIMIZE ----------------
function toFastApiOptimizeBody(modeA) {
  return {
    dataset_option: mapDatasetOption(modeA.dataset),
    budget: Number(modeA.maxAssets),                    // number of assets to pick
    risk_factor: mapUiRiskToFast(modeA.riskLevel),      // "low"|"medium"|"high"
    total_investment: Number(modeA.budget),             // ₹
  };
}

function normalizeOptimize(fastApiJson) {
  // Accepts FastAPI JSON and converts to stable shape for frontend
  const parsed = FastApiOptimizeResponseSchema.parse(fastApiJson);

  const selected = parsed.portfolio.map(p => p.asset);
  const weights = parsed.portfolio.map(p => Number(p.weight) || 0);
  const allocation = parsed.portfolio.map(p => ({
    name: p.asset,
    value: Math.round(
      typeof p.percentage === "number" ? p.percentage : (Number(p.weight) || 0) * 100
    ),
  }));

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

// ---------------- REBALANCE ----------------

// UI payload -> FastAPI /rebalance body
function toFastApiRebalanceBody(ui) {
  return {
    dataset_option: mapDatasetOption(ui.dataset),
    future_dataset_option: undefined, // let FastAPI default to <dataset>_Future
    budget: Number(ui.budget),
    risk_factor: mapUiRiskToFast(ui.risk),
    total_investment: Number(ui.totalInvestment),
  };
}

// Defensive mapper: handles possible alias keys (percentage vs weight, etc.)
function pluckWeightPercent(r) {
  // weight: 0..1; percentage: 0..100
  if (typeof r?.weight === "number") return r.weight;
  if (typeof r?.percentage === "number") return r.percentage / 100;
  return 0;
}
function pluckExpRet(r) {
  if (typeof r?.expected_return === "number") return r.expected_return;
  if (typeof r?.exp_ret === "number") return r.exp_ret;
  return 0;
}

// Create a smooth daily path from portfolio expected return
function synthEvolution({ days, start, muCurrent, muFuture }) {
  const n = Math.max(5, Number(days) || 30);
  const s = Math.max(1000, Number(start) || 100000);
  let cur = s, fut = s;
  const out = [];
  for (let i = 0; i < n; i++) {
    const curDay = (muCurrent / 100) / 22; // ~22 trading days
    const futDay = (muFuture / 100) / 22;
    cur *= 1 + curDay + (Math.random() - 0.5) * 0.002; // tiny jitter
    fut *= 1 + futDay + (Math.random() - 0.5) * 0.002;
    out.push({ time: `Day ${i + 1}`, Current: Math.round(cur), Future: Math.round(fut) });
  }
  return out;
}

async function callQuantumRebalanceJSON(uiPayload) {
  // Validate UI payload early (throws 400 in controller if invalid)
  RebalanceRequestSchema.parse(uiPayload);

  // MOCK: generate evolution so the chart works without FastAPI
  if (String(process.env.MOCK_MODE || config.mockMode).toLowerCase() === "true") {
    const muCurrent = 8.5;
    const muFuture = 11.0;
    const evolution = synthEvolution({
      days: uiPayload.timeHorizon,
      start: uiPayload.totalInvestment,
      muCurrent,
      muFuture,
    });
    return RebalanceResponseSchema.parse({
      runId: new Date().toISOString(),
      dataset: mapDatasetOption(uiPayload.dataset),
      current: [],
      future: [],
      actions: [],
      evolution,
      summary: { muCurrent, muFuture },
    });
  }

  // LIVE: call FastAPI
  const base = (process.env.QUANTUM_BASE_URL || config.quantumBaseUrl || "").replace(/\/+$/, "");
  if (!base) {
    const err = new Error("QUANTUM_BASE_URL not set");
    err.type = "upstream_unavailable";
    throw err;
  }

  const headers = { "Content-Type": "application/json" };
  const key = process.env.QUANTUM_API_KEY || config.quantumApiKey;
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const body = toFastApiRebalanceBody(uiPayload);

  let res;
  try {
    res = await httpFetch(`${base}/rebalance`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || config.requestTimeoutMs || 60000),
    });
  } catch (e) {
    const err = new Error("Quantum /rebalance request failed or timed out");
    err.type = String(e || "").includes("timeout") ? "upstream_timeout" : "upstream_unavailable";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Quantum /rebalance error ${res.status}: ${text || res.statusText}`);
    err.type = res.status === 504 ? "upstream_timeout" : "upstream_unavailable";
    throw err;
  }

  const raw = await res.json();

  // FastAPI JSON (likely) fields:
  // {
  //   dataset: "NIFTY50",
  //   current_portfolio: [{ asset, expected_return, weight | percentage }],
  //   future_portfolio:  [{ asset, expected_return, weight | percentage }],
  //   recommendations:   [{ action, asset, current_pct, future_pct, change_pct }],
  //   objective_value, ...
  // }

  const current = Array.isArray(raw?.current_portfolio)
    ? raw.current_portfolio.map(r => ({
        asset: r.asset,
        expected_return: Number(pluckExpRet(r)),
        weight: Number(pluckWeightPercent(r)),
      }))
    : [];

  const future = Array.isArray(raw?.future_portfolio)
    ? raw.future_portfolio.map(r => ({
        asset: r.asset,
        expected_return: Number(pluckExpRet(r)),
        weight: Number(pluckWeightPercent(r)),
      }))
    : [];

  const actions = Array.isArray(raw?.recommendations)
    ? raw.recommendations.map(r => ({
        action: r.action,
        asset: r.asset,
        current_pct: Number(r.current_pct ?? r.current ?? 0),
        future_pct: Number(r.future_pct ?? r.future ?? 0),
        change_pct: Number(r.change_pct ?? r.change ?? 0),
      }))
    : [];

  // compute weighted expected returns for current/future
  const muW = (arr) =>
    arr.reduce(
      (s, a) =>
        s +
        (Number(a.expected_return) || 0) *
          (Number(a.weight) || 0),
      0
    );
  const muCurrent = muW(current);
  const muFuture = muW(future);

  const evolution = synthEvolution({
    days: uiPayload.timeHorizon,
    start: uiPayload.totalInvestment,
    muCurrent,
    muFuture,
  });

  return RebalanceResponseSchema.parse({
    runId: new Date().toISOString(),
    dataset: raw?.dataset || body.dataset_option || mapDatasetOption(uiPayload.dataset),
    current,
    future,
    actions,
    evolution,
    summary: { muCurrent, muFuture },
  });
}

module.exports = {
  callQuantumOptimizeJSON,
  callQuantumRebalanceJSON,
};
