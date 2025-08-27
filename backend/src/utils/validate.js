// src/utils/validate.js
const { z } = require("zod");

/** ---------- Frontend → Backend (Mode A) ---------- */
const DatasetEnum = z.enum(["NIFTY50", "NASDAQ100", "CRYPTO50"]);
const OptimizeRequestSchema = z.object({
  mode: z.literal("dataset"),
  dataset: DatasetEnum,
  timeHorizon: z.number().int().positive().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  budget: z.number().finite().positive(),   // total_investment (₹)
  maxAssets: z.number().int().positive(),   // how many assets to pick
  objective: z.enum(["sharpe", "variance"]).optional(),
  qaoaParams: z.record(z.any()).optional(),
  constraints: z.object({
    minWeight: z.number().min(0).max(1).optional(),
    maxWeight: z.number().min(0).max(1).optional(),
  }).partial().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

/** ---------- FastAPI JSON (as returned by /optimize) ---------- */
const FastApiOptimizeResponseSchema = z.object({
  dataset: z.string(),
  budget: z.number(),
  risk_factor: z.string(),
  gamma: z.number().optional(),
  total_investment: z.number(),
  objective_value: z.number().optional(),
  portfolio: z.array(z.object({
    asset: z.string(),
    expected_return: z.number().nullable().optional(),
    weight: z.number(),         // 0..1
    investment: z.number().optional(),
    percentage: z.number().optional(), // 0..100
  })),
});

/** ---------- Backend → Frontend (normalized) ---------- */
const NormalizedOptimizeResponseSchema = z.object({
  runId: z.string(),
  method: z.literal("quantum"),
  selected: z.array(z.string()).min(1),
  weights: z.array(z.number()).min(1),   // 0..1
  allocation: z.array(z.object({ name: z.string(), value: z.number() })), // value in %
  expectedReturn: z.number().nullable().optional(),
  risk: z.number().nullable().optional(),
  sharpe: z.number().nullable().optional(),
  diagnostics: z.object({
    backend: z.string().optional(),
    dataset: z.string().optional(),
    objectiveValue: z.number().optional(),
    gamma: z.number().optional(),
  }).partial(),
});
const RebalanceRequestSchema = z.object({
  // UI inputs we need; Node will map to FastAPI keys
  dataset: z.string().min(1),                 // "nifty50" | "nasdaq" | "crypto"
  budget: z.number().int().positive(),        // number of assets
  risk: z.enum(['low','medium','high']),
  totalInvestment: z.number().positive(),
  timeHorizon: z.number().int().min(5).max(365).default(30), // days for chart (Node-only)
});
const RebalanceResponseSchema = z.object({
  runId: z.string(),
  dataset: z.string(),
  current: z.array(z.object({
    asset: z.string(),
    weight: z.number(),           // 0..1
    expected_return: z.number(),  // %
  })).default([]),
  future: z.array(z.object({
    asset: z.string(),
    weight: z.number(),
    expected_return: z.number(),
  })).default([]),
  actions: z.array(z.object({
    action: z.string(),           // BUY/SELL/HOLD
    asset: z.string(),
    current_pct: z.number(),
    future_pct: z.number(),
    change_pct: z.number(),
  })).default([]),
   evolution: z.array(z.object({
    time: z.string(),
    Current: z.number(),
    Future: z.number(),
  })).default([]),
  
  summary: z.object({
    muCurrent: z.number(),
    muFuture: z.number(),
  }),
});
module.exports = {
  OptimizeRequestSchema,
  FastApiOptimizeResponseSchema,
  NormalizedOptimizeResponseSchema,
  DatasetEnum,
  RebalanceRequestSchema,
  RebalanceResponseSchema,

};
