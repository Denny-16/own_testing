// src/controllers/demo.controller.js
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSETS = {
  nifty50: ["Reliance", "HDFC Bank", "Infosys", "TCS", "ICICI Bank", "HUL", "Bharti Airtel"],
  nasdaq: ["Apple", "Microsoft", "Amazon", "Google", "Tesla", "Nvidia", "Meta"],
  crypto: ["Bitcoin", "Ethereum", "Solana", "Cardano", "Polkadot", "BNB", "XRP"],
  default: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"],
};

// GET/POST /api/sharpe
async function sharpeController(_req, res, next) {
  try {
    await delay(300);
    return res.json([
      { name: "Classical", value: 1.1 },
      { name: "Quantum", value: 1.35 },
      { name: "Hybrid", value: 1.42 },
    ]);
  } catch (e) { next(e); }
}

// POST /api/frontier
async function frontierController(req, res, next) {
  try {
    const { riskLevel = "medium" } = req.body || {};
    await delay(400);
    const base = riskLevel === "low" ? 5 : riskLevel === "medium" ? 10 : 20;
    const data = Array.from({ length: 8 }, (_, i) => ({
      risk: base + i * 2,
      return: base / 2 + i * 1.5,
    }));
    return res.json(data);
  } catch (e) { next(e); }
}

// POST /api/qaoa/bits
async function qaoaBitsController(_req, res, next) {
  try {
    await delay(500);
    return res.json([
      { bits: "00111", p: 0.21, expRet: 0.093, risk: 0.113, constraints: "OK" },
      { bits: "11100", p: 0.20, expRet: 0.088, risk: 0.092, constraints: "OK" },
      { bits: "10101", p: 0.19, expRet: 0.097, risk: 0.117, constraints: "ESG excluded" },
      { bits: "11010", p: 0.18, expRet: 0.092, risk: 0.095, constraints: "ESG excluded" },
      { bits: "10011", p: 0.13, expRet: 0.090, risk: 0.096, constraints: "OK" },
    ]);
  } catch (e) { next(e); }
}

// POST /api/allocation
async function allocationController(req, res, next) {
  try {
    const { dataset = "nifty50" } = req.body || {};
    await delay(400);
    const assets = ASSETS[dataset] || ASSETS.default;
    const slice = assets.slice(0, 5);
    const weights = Array.from({ length: slice.length }, () => Math.max(5, Math.random() * 40));
    const sum = weights.reduce((a, b) => a + b, 0);
    const alloc = slice.map((name, i) => ({
      name,
      value: Math.round((weights[i] / sum) * 100),
    }));
    return res.json(alloc);
  } catch (e) { next(e); }
}

// POST /api/evolution
async function evolutionController(req, res, next) {
  try {
    const { initialEquity = 100000, timeHorizon = 12 } = req.body || {};
    await delay(500);
    let q = Number(initialEquity);
    let c = Number(initialEquity) * 0.95;
    const data = Array.from({ length: timeHorizon }, (_, i) => {
      q *= 1 + (Math.random() * 0.04 - 0.01);
      c *= 1 + (Math.random() * 0.03 - 0.01);
      return { time: `Day ${i + 1}`, Quantum: Math.round(q), Classical: Math.round(c) };
    });
    return res.json(data);
  } catch (e) { next(e); }
}

// POST /api/stress
async function stressController(req, res, next) {
  try {
    const { alloc = [], initialEquity = 100000, threshold = 60, stress = {} } = req.body || {};
    const sectorOf = (nm) => {
      const n = (nm || "").toLowerCase();
      if (n.includes("oil") || n.includes("coal") || n.includes("petro") || n.includes("energy")) return "energy";
      if (n.includes("tech") || n.includes("it") || n.includes("software") || n.includes("airtel")) return "tech";
      if (n.includes("bank") || n.includes("finance")) return "finance";
      if (n.includes("auto")) return "auto";
      if (n.includes("pharma") || n.includes("lab") || n.includes("health")) return "health";
      return "other";
    };
    const { ratesBps = 0, oilPct = 0, techPct = 0, fxPct = 0 } = stress;
    const base = { energy: 0.10, tech: 0.12, finance: 0.08, auto: 0.07, health: 0.05, other: 0.06 };
    const ratesHit  = Math.max(0, ratesBps) / 10000;
    const oilShock  = oilPct / 100;
    const techShock = techPct / 100;
    const fxShock   = Math.abs(fxPct) / 100 * 0.3;

    const bars = (alloc || []).map(a => {
      const w = (Number(a.value) || 0) / 100;
      const name = a.name || "Asset";
      const sec = sectorOf(name);
      let stressFactor = base[sec] ?? base.other;

      if (sec === "finance") stressFactor += ratesHit * 0.8 + fxShock * 0.2;
      if (sec === "tech")    stressFactor += ratesHit * 0.3 + Math.max(0, -techShock) * 0.6 + fxShock * 0.1;
      if (sec === "energy")  stressFactor += Math.max(0, oilShock) * 0.7 + fxShock * 0.1;
      if (sec === "auto")    stressFactor += ratesHit * 0.2 + fxShock * 0.2;
      if (sec === "health")  stressFactor += ratesHit * 0.1;

      stressFactor = Math.max(0.02, Math.min(0.35, stressFactor));
      const equityAfter = Number(initialEquity) * w * (1 - stressFactor);
      return { name, value: Math.max(0, Math.round(equityAfter)) };
    });

    const ruinLine = Math.round((Number(threshold) || 0) / 100 * Number(initialEquity));
    await delay(250);
    return res.json({ bars, ruinLine });
  } catch (e) { next(e); }
}

module.exports = {
  sharpeController,
  frontierController,
  qaoaBitsController,
  allocationController,
  evolutionController,
  stressController,
};
