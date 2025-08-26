const express = require('express');
const router = express.Router();

const { config } = require('../config/env');

// tiny fetch with timeout
async function httpFetch(url, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

router.get('/health/quantum', async (req, res) => {
  // If mock mode, report healthy so UI doesn’t block
  const mock = String(process.env.MOCK_MODE || config.mockMode).toLowerCase() === 'true';
  if (mock) {
    return res.json({ quantumHealthy: true, mode: 'mock', time: new Date().toISOString() });
  }

  const base = (process.env.QUANTUM_BASE_URL || config.quantumBaseUrl || '').replace(/\/+$/, '');
  if (!base) return res.status(503).json({ quantumHealthy: false, reason: 'QUANTUM_BASE_URL not set' });

  try {
    const r = await httpFetch(`${base}/health`, { timeoutMs: 5000 });
    if (r.ok) return res.json({ quantumHealthy: true, mode: 'live', code: r.status });
    return res.status(503).json({ quantumHealthy: false, mode: 'live', code: r.status });
  } catch (e) {
    return res.status(503).json({ quantumHealthy: false, mode: 'live', reason: 'timeout/unreachable' });
  }
});

module.exports = router;
