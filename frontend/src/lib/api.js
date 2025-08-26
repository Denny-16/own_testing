// src/lib/api.js
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

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
  // backend only needs dataset for the demo behavior
  return post("/api/allocation", { dataset, topBits, hybrid, threshold });
}

export async function backtestEvolution({ freq, hybrid, initialEquity, timeHorizon }) {
  return post("/api/evolution", { freq, hybrid, initialEquity, timeHorizon });
}

export async function stressSim({ alloc, initialEquity, threshold, stress }) {
  return post("/api/stress", { alloc, initialEquity, threshold, stress });
}
