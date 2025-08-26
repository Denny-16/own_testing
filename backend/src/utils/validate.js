const { z } = require('zod');

// EXACT strings your FastAPI is likely to expect.
// Add/remove as your quantum team confirms.
const DatasetEnum = z.enum(['NIFTY50', 'NASDAQ100', 'CRYPTO50']);

const OptimizeRequestSchema = z.object({
  mode: z.literal('dataset'),
  dataset: DatasetEnum,
  timeHorizon: z.number().int().positive(), // days (e.g., 15)
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  budget: z.number().finite().positive(),    // your initialEquity
  maxAssets: z.number().int().positive(),    // cap on selected assets
  objective: z.enum(['sharpe', 'variance']).default('sharpe'),
  qaoaParams: z.object({
    p: z.number().int().positive().optional(),
    shots: z.number().int().positive().optional(),
    optimizer: z.string().optional(),
    seed: z.number().int().optional(),
  }).partial().default({}),
  constraints: z.object({
    minWeight: z.number().min(0).max(1).optional(),
    maxWeight: z.number().min(0).max(1).optional(),
  }).partial().optional(),
  include: z.array(z.string()).optional(), // must-include tickers
  exclude: z.array(z.string()).optional(), // must-exclude tickers
});

const OptimizeResponseSchema = z.object({
  runId: z.string(),
  method: z.literal('quantum'),
  weights: z.array(z.number().finite()).min(1),
  selected: z.array(z.string()),
  expectedReturn: z.number().finite(),
  risk: z.number().finite(),    // agree with team: variance or stdev
  sharpe: z.number().finite(),
  diagnostics: z.object({
    iterations: z.number().int().optional(),
    convergence: z.boolean().optional(),
    backend: z.string().optional(),
    runtimeMs: z.number().int().optional(),
    notes: z.string().optional(),
  }).partial(),
});

module.exports = {
  OptimizeRequestSchema,
  OptimizeResponseSchema,
  DatasetEnum,
};
