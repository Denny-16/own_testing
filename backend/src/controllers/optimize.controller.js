const { OptimizeRequestSchema } = require('../utils/validate');
const { callQuantumOptimize } = require('../services/quantum.service');

async function optimizeController(req, res, next) {
  try {
    // Validate incoming body against Mode A schema
    const parsed = OptimizeRequestSchema.parse(req.body);

    // Call service (mock if MOCK_MODE=true, else FastAPI)
    const result = await callQuantumOptimize(parsed);

    return res.status(200).json(result);
  } catch (e) {
    // zod validation errors => 422 via error middleware
    if (e?.issues) {
      const err = new Error('Invalid payload');
      err.type = 'validation';
      err.details = e.issues.map(i => i.message);
      return next(err);
    }
    // otherwise bubble up to error middleware
    return next(e);
  }
}

module.exports = { optimizeController };
