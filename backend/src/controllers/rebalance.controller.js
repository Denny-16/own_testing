const { RebalanceRequestSchema } = require('../utils/validate');
const { callQuantumRebalanceJSON } = require('../services/quantum.service');

async function rebalanceHandler(req, res) {
  try {
    const payload = RebalanceRequestSchema.parse(req.body);
    const result = await callQuantumRebalanceJSON(payload);
    res.json(result);
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({
        error: 'Invalid request',
        details: err.issues.map(i => i.message),
      });
    }
    const status = err?.type === 'upstream_timeout' ? 504
                : err?.type === 'upstream_unavailable' ? 502
                : 500;
    res.status(status).json({ error: err.message || 'Internal error' });
  }
}

module.exports = { rebalanceHandler };
