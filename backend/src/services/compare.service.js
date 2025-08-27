// src/services/compare.service.js

// --- helpers ---
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000; // 0..1
  };
}

function nameSeed(str) {
  return Array.from(String(str || "")).reduce((a, c) => a + c.charCodeAt(0), 0);
}

const NAME_BANK = [
  "Reliance","HDFC Bank","Infosys","TCS","ICICI Bank","HUL",
  "Bharti Airtel","Bajaj Auto","Sun Pharmaceutical","M&M","HCL Tech",
  "Tata Motors","Larsen & Toubro","Axis Bank","ITC",
];

function pickNames(n) {
  const out = [];
  const used = new Set();
  while (out.length < n) {
    const name = NAME_BANK[Math.floor(Math.random() * NAME_BANK.length)];
    if (!used.has(name)) {
      used.add(name);
      out.push(name);
    }
  }
  return out;
}

// --- public functions ---

// Overall “accuracy” metric (demo) – always favors Quantum a bit
function getAccuracy({ risk = "medium" } = {}) {
  const base = risk === "low" ? 72 : risk === "high" ? 80 : 76;
  const quantum   = Math.min(97, base + 12);   // e.g. 88–92
  const classical = Math.max(55, base - 8);    // e.g. 64–72
  return {
    metric: "accuracy",
    quantum,
    classical,
  };
}

// Per-asset risk/return (demo) – use actual selected names if provided
function getRiskReturn({ dataset = "nifty50", count = 5, assetNames = [], weights = [] } = {}) {
  const useNames = Array.isArray(assetNames) && assetNames.length > 0 ? assetNames : pickNames(count);
  const useWeights = Array.isArray(weights) && weights.length === useNames.length
    ? weights.map(w => Math.max(0, Number(w) || 0))
    : Array.from({ length: useNames.length }, () => 100 / (useNames.length || 1)); // equal if missing

  // Normalize to 0..1
  const wNorm = useWeights.map(w => w / 100);
  const baseSeed = nameSeed(dataset) + count * 97;

  const rows = useNames.map((name, idx) => {
    const w = wNorm[idx];                           // 0..1
    const rnd = seededRng(baseSeed + nameSeed(name) + idx * 17);

    // Map weight to risk/return:
    // more weight -> lower risk, higher return
    const riskFromWeight = 20 - 12 * w;             // ~8% at w=1, ~20% at w=0
    const returnFromWeight = 6 + 10 * w;            // ~16% at w=1, ~6% at w=0

    // add tiny jitter so points don’t stack
    const jitterR = (rnd() - 0.5) * 1.2;            // ±0.6
    const jitterMu = (rnd() - 0.5) * 1.2;

    const classicalRisk = +(riskFromWeight + jitterR).toFixed(1);
    const classicalReturn = +(returnFromWeight + jitterMu).toFixed(1);

    // Quantum edge
    const qBonusRet = +(0.8 + rnd() * 1.0).toFixed(1);  // +0.8..+1.8
    const qRiskEdge = +(0.3 + rnd() * 0.5).toFixed(1);  // -0.3..-0.8

    const quantumRisk = Math.max(3, +(classicalRisk - qRiskEdge).toFixed(1));
    const quantumReturn = +(classicalReturn + qBonusRet).toFixed(1);

    return {
      name,
      classical: { risk: classicalRisk, ret: classicalReturn },
      quantum:   { risk: quantumRisk,   ret: quantumReturn },
    };
  });

  return { dataset, points: rows };
}


module.exports = { getAccuracy, getRiskReturn };
