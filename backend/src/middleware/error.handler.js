const { logger } = require('../config/logger');

function errorHandler(err, req, res, _next) {
  const requestId = res.getHeader('x-request-id') || 'n/a';
  logger.error(`[${requestId}]`, err.message || err);

  // validation errors (zod)
  if (err.type === 'validation') {
    return res.status(422).json({ error: 'VALIDATION_ERROR', details: err.details || err.message });
  }

  // explicit 400s
  if (err.type === 'bad_request') {
    return res.status(400).json({ error: 'BAD_REQUEST', details: err.message });
  }

  // upstream specific
  if (err.type === 'upstream_timeout') {
    return res.status(504).json({ error: 'UPSTREAM_TIMEOUT', details: 'Quantum service timed out' });
  }
  if (err.type === 'upstream_unavailable') {
    return res.status(503).json({ error: 'UPSTREAM_UNAVAILABLE', details: 'Quantum service unavailable' });
  }

  // fallback
  return res.status(500).json({ error: 'INTERNAL_ERROR', details: 'Something went wrong' });
}

module.exports = { errorHandler };
