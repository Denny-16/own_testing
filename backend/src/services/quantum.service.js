const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../config/env');
const { OptimizeResponseSchema } = require('../utils/validate');

// tiny fetch with timeout using AbortController (built-in in Node 18+)
async function httpFetch(url, { method = 'GET', headers = {}, body, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function callQuantumOptimize(payload) {
  if (String(process.env.MOCK_MODE || config.mockMode).toLowerCase() === 'true') {
    const mockPath = path.join(process.cwd(), 'scripts', 'mockPayloads', 'sample-response.json');
    const txt = await fs.readFile(mockPath, 'utf-8');
    const data = JSON.parse(txt);
    data.runId = new Date().toISOString();
    return OptimizeResponseSchema.parse(data);
  }

  const base = (process.env.QUANTUM_BASE_URL || config.quantumBaseUrl || '').replace(/\/+$/, '');
  if (!base) {
    const err = new Error('QUANTUM_BASE_URL not set');
    err.type = 'upstream_unavailable';
    throw err;
  }

  const url = `${base}/optimize`;
  const headers = { 'Content-Type': 'application/json' };
  const key = process.env.QUANTUM_API_KEY || config.quantumApiKey;
  if (key) headers['Authorization'] = `Bearer ${key}`;

  let res;
  try {
    res = await httpFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || config.requestTimeoutMs || 60000),
    });
  } catch (e) {
    const err = new Error('Quantum API request failed or timed out');
    err.type = String(e).includes('timeout') ? 'upstream_timeout' : 'upstream_unavailable';
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Quantum API error ${res.status}: ${text || res.statusText}`);
    err.type = res.status === 504 ? 'upstream_timeout' : 'upstream_unavailable';
    throw err;
  }

  const json = await res.json();
  if (!json.runId) json.runId = new Date().toISOString();
  return OptimizeResponseSchema.parse(json);
}

module.exports = { callQuantumOptimize };
