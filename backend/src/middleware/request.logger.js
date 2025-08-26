const { logger } = require('../config/logger');
const crypto = require('node:crypto');

function requestLogger(req, res, next) {
  const id = crypto.randomUUID();
  res.setHeader('x-request-id', id);
  const start = Date.now();

  logger.info(`[${id}] -> ${req.method} ${req.originalUrl}`);

  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info(`[${id}] <- ${res.statusCode} (${ms}ms)`);
  });

  next();
}

module.exports = { requestLogger };
