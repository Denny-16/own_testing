const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const { config } = require('./config/env');
const { logger } = require('./config/logger');
const healthRouter = require('./routes/health.routes');

const app = express();

// middleware
app.use(helmet());
app.use(cors({ origin: config.allowOrigin }));
app.use(express.json());
app.use(compression());
const { requestLogger } = require('./middleware/request.logger');
app.use(requestLogger);

// routes
app.use('/api', healthRouter);
const optimizeRouter = require('./routes/optimize.routes');
app.use('/api', optimizeRouter);
const quantumHealthRouter = require('./routes/quantum.health.routes');
app.use('/api', quantumHealthRouter);
const demoRouter = require('./routes/demo.routes');
app.use('/api', demoRouter);

// start server
app.listen(config.port, () => {
  logger.info(`Backend running at http://localhost:${config.port}`);
});
