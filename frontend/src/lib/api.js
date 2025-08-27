// src/lib/api.js
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

/* ---------------- helpers ---------------- */
async function post(path, body) {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.details || err?.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

async function get(path) {
  const resp = await fetch(`${API_BASE_URL}${path}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.details || err?.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

/* --------------- existing demo endpoints (backed by Node) --------------- */
export async function fetchEfficientFrontier({ riskLevel, constraints, threshold }) {
  return post("/api/frontier", { riskLevel, constraints, threshold });
}

export async function fetchSharpeComparison() {
  return get("/api/sharpe");
}

export async function runQAOASelection({ constraints, threshold }) {
  return post("/api/qaoa/bits", { constraints, threshold });
}

export async function fetchAllocation({ topBits, hybrid, threshold, dataset }) {
  return post("/api/allocation", { dataset, topBits, hybrid, threshold });
}

export async function backtestEvolution({ freq, hybrid, initialEquity, timeHorizon }) {
  return post("/api/evolution", { freq, hybrid, initialEquity, timeHorizon });
}

export async function stressSim({ alloc, initialEquity, threshold, stress }) {
  return post("/api/stress", { alloc, initialEquity, threshold, stress });
}

/* ----------------------- COMPARE (call backend) ------------------------- */

// Accuracy comparison (GET /api/compare/accuracy?risk=...)
export async function fetchCompareAccuracy({ risk }) {
  const r = encodeURIComponent(risk || "medium");
  return get(`/api/compare/accuracy?risk=${r}`);
}

// Risk vs Return per asset (POST /api/compare/risk-return)
export async function fetchCompareRiskReturn({ dataset, maxAssets, assetNames, weights }) {
  return post("/api/compare/risk-return", {
    dataset,
    maxAssets,
    assetNames: Array.isArray(assetNames) ? assetNames : [],
    weights: Array.isArray(weights) ? weights : [],
  });
}
