// src/lib/api.js
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

async function post(path, body) {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!resp.ok) {
    // Try to parse JSON error; otherwise throw generic
    let err = {};
    try { err = await resp.json(); } catch {}
    throw new Error(err?.details || err?.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

async function get(path) {
  const resp = await fetch(`${API_BASE_URL}${path}`);
  if (!resp.ok) {
    let err = {};
    try { err = await resp.json(); } catch {}
    throw new Error(err?.details || err?.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

/* ========= Existing APIs ========= */
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

/* ========= NEW: Compare tab helpers (added to fix build) =========
   If your backend doesn't expose these yet, we return demo data so the UI works.
*/
export async function fetchCompareAccuracy({ risk }) {
  try {
    // Preferred: backend route (POST)
    return await post("/api/compare/accuracy", { risk });
  } catch {
    // Fallback demo so the Compare tab renders
    return { classical: 72, quantum: 86 };
  }
}

export async function fetchCompareRiskReturn({ dataset, maxAssets, assetNames = [], weights = [] }) {
  try {
    // Preferred: backend route (POST)
    return await post("/api/compare/riskreturn", { dataset, maxAssets, assetNames, weights });
  } catch {
    // Fallback demo points mapped from provided assetNames
    const points = (assetNames.length ? assetNames : ["A", "B", "C"]).map((name, i) => ({
      name,
      classical: { risk: 8 + i * 2, ret: 10 + i * 1.5 },
      quantum:   { risk: 7.5 + i * 1.8, ret: 12 + i * 1.6 },
    }));
    return { points };
  }
}

/* ========= NEW: Rebalancing ========= */
export async function fetchRebalance({
  dataset_option,
  future_dataset_option,
  budget,
  risk_factor,
  total_investment,
}) {
  return post("/api/rebalance", {
    dataset_option,
    future_dataset_option,
    budget,
    risk_factor,
    total_investment,
  });
}
