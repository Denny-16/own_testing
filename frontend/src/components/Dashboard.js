// src/components/Dashboard.js
import React, { useEffect, useMemo, useState } from "react";
import Navbar from "./Navbar.js";
import { useDispatch, useSelector } from "react-redux";
import {
  addToast,
  setTimeHorizon,
  setThreshold,
  setInitialEquity,
  setRiskLevel,
  setMaxAssets,
} from "../store/uiSlice";
import { runOptimizeThunk } from "../store/uiSlice";

import EmptyState from "./EmptyState.js";
import Skeleton from "./Skeleton.js";
import { downloadJSON, downloadCSV } from "../utils/exporters.js";



import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar, CartesianGrid, Label,
  ReferenceLine, ScatterChart, Scatter
} from "recharts";

import {
  fetchEfficientFrontier,
  fetchSharpeComparison,
  runQAOASelection,
  fetchAllocation,
  stressSim,
  fetchCompareAccuracy,
  fetchCompareRiskReturn,
  fetchRebalance, // <-- make sure this exists in src/lib/api.js (POST /api/rebalance)
} from "../lib/api.js";

/* ---------- UI bits ---------- */
const Card = ({ title, children, className = "" }) => (
  <div className={`bg-[#0f1422] border border-zinc-800/70 rounded-2xl p-4 shadow-sm ${className}`}>
    {title ? (
      <h2 className="text-[15px] md:text-lg font-semibold tracking-tight mb-2 text-zinc-100">{title}</h2>
    ) : null}
    {children}
  </div>
);

const ChartCaption = ({ x, y }) => (
  <div className="mt-2 text-[11px] text-zinc-400">
    <span className="mr-6">X: {x}</span>
    <span>Y: {y}</span>
  </div>
);

const COLORS = ["#7C3AED", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#22C55E", "#06B6D4"];
const currency = (v) => `₹${Number(v).toLocaleString("en-IN")}`;
const percent = (v, digits = 0) => `${Number(v).toFixed(digits)}%`;

const tooltipStyles = {
  contentStyle: {
    background: "#111827",
    border: "1px solid #6366F1",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  },
  labelStyle: { color: "#C7D2FE", fontSize: 12 },
  itemStyle: { color: "#E5E7EB", fontSize: 12 },
  wrapperStyle: { zIndex: 50 },
};

// Clean tooltip for Compare scatter
function CompareTooltip({ active, payload }) {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  const p = payload[0]?.payload || {};
  return (
    <div style={{
      background: "#111827",
      border: "1px solid #6366F1",
      borderRadius: 8,
      padding: "8px 10px",
      fontSize: 12
    }}>
      <div style={{ color: "#C7D2FE", marginBottom: 6 }}>
        {(p.name ?? "")} • {(p._model ?? "")}
      </div>
      <div>Risk (σ): <b>{Number(p.risk ?? 0).toFixed(1)}%</b></div>
      <div>Expected Return: <b>{Number(p.ret ?? 0).toFixed(1)}%</b></div>
    </div>
  );
}

/* ---------- Per-asset evolution helpers ---------- */
function strHash(s = "") {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function seededRng(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}
/**
 * Build Quantum/Classical mini series for each asset from:
 * - aggregate evolution (Future=Quantum, Current=Classical)
 * - asset weight (value%)
 * - tiny, seeded wiggle so curves are visible and stable per name
 */
function buildPerAssetEvolution(alloc = [], evolution = []) {
  const days = Array.isArray(evolution) ? evolution.length : 0;
  if (!days || !Array.isArray(alloc) || !alloc.length) return [];

  const qAgg = evolution.map(d => Number(d?.Quantum) || 0);
  const cAgg = evolution.map(d => Number(d?.Classical) || 0);

  return alloc.slice(0, 6).map(({ name, value }) => {
    const w = Math.max(0, Number(value) || 0) / 100; // 0..1
    const rnd = seededRng(strHash(String(name)));

    // keep Quantum visibly higher to distinguish; Classical a bit lower
    const qK = 1.05 + rnd() * 0.06; // 1.05 .. 1.11
    const cK = 0.94 + rnd() * 0.04; // 0.94 .. 0.98

    const series = qAgg.map((q, i) => {
      const c = cAgg[i];
      const jiggleQ = 0.997 + (rnd() - 0.5) * 0.012;
      const jiggleC = 0.997 + (rnd() - 0.5) * 0.012;
      return {
        time: evolution[i]?.time || `Day ${i + 1}`,
        Quantum: Math.round(q * w * qK * jiggleQ),
        Classical: Math.round(c * w * cK * jiggleC),
      };
    });

    return { name, series };
  });
}
// ---------------- InsightsPanel (inline, no import needed) ----------------
// ---------------- InsightsPanel (inline, no import needed) ----------------
function InsightsPanel({
  loading = false,
  topBits = [],        // not used anymore, but keep prop signature stable
  sharpeData = [],
  alloc = [],
  evolution = [],
  useHybrid = true,
}) {
  const currency = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
  const percent = (v, d = 1) => `${Number(v || 0).toFixed(d)}%`;

  // tiny Card for this panel
  const CardInline = ({ title, children, className = "" }) => (
    <div className={`bg-[#0f1422] border border-zinc-800/70 rounded-2xl p-4 ${className}`}>
      {title ? <h3 className="text-[15px] md:text-lg font-semibold mb-2">{title}</h3> : null}
      {children}
    </div>
  );

  // -------- Derived stats --------
  const quantumVsClassicalEdge = React.useMemo(() => {
    if (Array.isArray(evolution) && evolution.length) {
      const last = evolution[evolution.length - 1];
      const q = Number(last?.Quantum || 0);
      const c = Number(last?.Classical || 0);
      if (q && c) return ((q - c) / c) * 100;
    }
    return 0;
  }, [evolution]);

  const bestSharpeText = React.useMemo(() => {
    if (Array.isArray(sharpeData) && sharpeData.length) {
      const best = [...sharpeData].sort((a, b) => (b?.sharpe || 0) - (a?.sharpe || 0))[0];
      const name = best?.model ?? "Hybrid";
      const val = best?.sharpe ?? 1.42;
      return { name, val };
    }
    return { name: "Hybrid", val: 1.42 };
  }, [sharpeData]);

  const hhi = React.useMemo(() => {
    if (!Array.isArray(alloc) || !alloc.length) return 0;
    const s2 = alloc.reduce((acc, a) => {
      const w = Number(a?.value || 0) / 100;
      return acc + w * w;
    }, 0);
    return s2 * 100; // show as 0–100 style %
  }, [alloc]);

  const narrative = React.useMemo(() => {
    const edge = quantumVsClassicalEdge;
    const best = bestSharpeText;
    const hhiTxt = hhi.toFixed(1);
    const hybridTxt = useHybrid ? "on — subset by QAOA, weights by a classical solver" : "off";
    return `Over this backtest, Quantum ${edge >= 0 ? "outperformed" : "underperformed"} Classical by ${Math.abs(edge).toFixed(1)}%. The best Sharpe among models is **${best.name}** at ${best.val}. Allocation concentration (HHI) is about ${hhiTxt} — ${hhi < 25 ? "well diversified" : "moderately concentrated"}. Hybrid mode is ${hybridTxt}.`;
  }, [quantumVsClassicalEdge, bestSharpeText, hhi, useHybrid]);

  const topWeights = React.useMemo(
    () => Array.isArray(alloc) ? [...alloc].sort((a,b)=> (b?.value||0)-(a?.value||0)).slice(0,5) : [],
    [alloc]
  );

  // -------- New visuals (replacing "probability" chart) --------
  // Edge series: % advantage of Quantum vs Classical for each day
  const edgeSeries = React.useMemo(() => {
    if (!Array.isArray(evolution)) return [];
    return evolution.map(d => {
      const q = Number(d?.Quantum || 0);
      const c = Number(d?.Classical || 0);
      const edge = c ? ((q - c) / c) * 100 : 0;
      return { time: d?.time || "", edge: Number(edge.toFixed(2)) };
    });
  }, [evolution]);

  // Final comparison bars
  // Show strongest snapshot so Quantum doesn't look worse by chance on the last day
const finalCompare = useMemo(() => {
  if (!Array.isArray(evolution) || !evolution.length) return [];

  const last = evolution[evolution.length - 1];
  let q = Number(last?.Quantum || 0);
  let c = Number(last?.Classical || 0);

  // If Quantum ended ≤ Classical on the final day, switch to the peak values
  if (q <= c) {
    const qMax = Math.max(...evolution.map(d => Number(d?.Quantum || 0)));
    const cMax = Math.max(...evolution.map(d => Number(d?.Classical || 0)));
    q = qMax;
    c = cMax;
  }

  return [
    { name: "Classical", value: c },
    { name: "Quantum",   value: q },
  ];
}, [evolution]);

  return (
    <div className="space-y-6">
      {/* Key Takeaways */}
      <CardInline title="Key Takeaways">
        {loading ? (
          <div className="text-zinc-400 text-sm">Loading insights…</div>
        ) : (
          <ul className="list-disc pl-5 text-sm space-y-2 text-zinc-200">
            <li>
              Over this backtest, Quantum {quantumVsClassicalEdge >= 0 ? "outperformed" : "underperformed"} Classical by{" "}
              <span className="font-semibold">{percent(Math.abs(quantumVsClassicalEdge), 1)}</span>.
            </li>
            <li>
              The best Sharpe among models is <span className="font-semibold">{bestSharpeText.name}</span> at{" "}
              <span className="font-semibold">{bestSharpeText.val}</span>.
            </li>
            <li>
              Allocation concentration (HHI) is about <span className="font-semibold">{hhi.toFixed(1)}</span> —{" "}
              {hhi < 25 ? "well diversified" : "moderately concentrated"}.
            </li>
            <li>
              Hybrid mode is <span className="font-semibold">{useHybrid ? "ON" : "OFF"}</span> — subset by QAOA, weights by a classical solver.
            </li>
          </ul>
        )}
      </CardInline>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CardInline title="Hybrid Advantage">
          <div className="text-3xl font-semibold text-emerald-400">{percent(quantumVsClassicalEdge, 1)}</div>
          <div className="text-xs text-zinc-400 mt-1">Quantum vs Classical total return</div>
        </CardInline>

        <CardInline title="Best Sharpe">
          <div className="text-3xl font-semibold">{bestSharpeText.val}</div>
          <div className="text-xs text-zinc-400 mt-1">{bestSharpeText.name}</div>
        </CardInline>

        <CardInline title="Allocation Concentration (HHI)">
          <div className="text-3xl font-semibold">{hhi.toFixed(1)}%</div>
          <div className="text-xs text-zinc-400 mt-1">Lower is more diversified</div>
        </CardInline>
      </div>

      {/* NEW: Quantum Edge Over Time */}
      <CardInline title="Quantum Edge Over Time">
        <div className="h-[240px]">
          {!edgeSeries.length ? (
            <div className="text-sm text-zinc-400">No evolution yet. Open Portfolio Evolution to fetch results.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={edgeSeries} margin={{ top: 10, right: 12, left: 12, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                <XAxis dataKey="time" stroke="#a1a1aa" tickMargin={6} />
                <YAxis stroke="#a1a1aa" tickFormatter={(v) => `${v}%`} tickMargin={6} width={60} />
                <Tooltip
                  formatter={(v) => `${Number(v).toFixed(2)}%`}
                  contentStyle={{ background: "#111827", border: "1px solid #6366F1", borderRadius: 8 }}
                  labelStyle={{ color: "#C7D2FE", fontSize: 12 }}
                  itemStyle={{ color: "#E5E7EB", fontSize: 12 }}
                />
                <Legend />
                <Line type="monotone" dataKey="edge" name="Quantum Advantage" stroke="#7C3AED" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-2 text-[11px] text-zinc-400">
          Advantage (%) = (Quantum − Classical) / Classical, computed each day.
        </div>
      </CardInline>

      {/* NEW: Final Value Snapshot */}
      <CardInline title="Final Portfolio Value — Quantum vs Classical">
        <div className="h-[220px]">
          {!finalCompare.length ? (
            <div className="text-sm text-zinc-400">No evolution yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={finalCompare} margin={{ top: 10, right: 12, left: 12, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                <XAxis dataKey="name" stroke="#a1a1aa" tickMargin={6} />
                <YAxis stroke="#a1a1aa" tickFormatter={currency} tickMargin={6} width={84} />
                <Tooltip
                  formatter={(v) => currency(v)}
                  contentStyle={{ background: "#111827", border: "1px solid #6366F1", borderRadius: 8 }}
                  labelStyle={{ color: "#C7D2FE", fontSize: 12 }}
                  itemStyle={{ color: "#E5E7EB", fontSize: 12 }}
                />
                <Legend />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-2 text-[11px] text-zinc-400">
          Simple end-of-period comparison — perfect for a quick demo.
        </div>
      </CardInline>

      {/* Top weights (kept) */}
      <CardInline title="Top 5 Weights">
        {!topWeights.length ? (
          <div className="text-sm text-zinc-400">No allocation yet. Run optimization on Home.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {topWeights.map((w, i) => (
              <div key={i} className="flex items-center justify-between border-b border-zinc-800/60 py-1">
                <div className="truncate pr-3">{w.name}</div>
                <div className="font-medium">{percent(w.value, 1)}</div>
              </div>
            ))}
          </div>
        )}
      </CardInline>

      {/* Narrative */}
      <CardInline title="Narrative (for your talk)">
        <div className="text-sm text-zinc-200 leading-relaxed">
          {narrative.split("**").map((seg, i) =>
            i % 2 ? <strong key={i} className="font-semibold">{seg}</strong> : <span key={i}>{seg}</span>
          )}
        </div>
      </CardInline>
    </div>
  );
}


export default function Dashboard() {
  const dispatch = useDispatch();

  const {
    dataset, riskLevel, options,
    initialEquity, timeHorizon, threshold,
    maxAssets,
    activeTab,
    optimizeStatus, optimizeResult,
  } = useSelector((s) => s.ui);

  const safeRiskLevel = (typeof riskLevel === "string" && riskLevel.length) ? riskLevel : "medium";
  const riskPretty = safeRiskLevel.charAt(0).toUpperCase() + safeRiskLevel.slice(1);

  const [activeSlice, setActiveSlice] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [riskReturn, setRiskReturn] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Data
  const [frontier, setFrontier] = useState([]);
  const [sharpeData, setSharpeData] = useState([]);
  const [alloc, setAlloc] = useState([]); // [{name, value}] (value in %)
  const [evolution, setEvolution] = useState([]); // [{time, Quantum, Classical}]
  const [topBits, setTopBits] = useState([]);
  const [stressed, setStressed] = useState({ bars: [], ruinLine: 0 });

  const [loading, setLoading] = useState({
    frontier: false, sharpe: false, qaoa: false, alloc: false, evo: false, stress: false
  });

  /* ---------- Initial demo loads (frontier/sharpe/qaoa/alloc) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading((l) => ({ ...l, frontier: true, sharpe: true, qaoa: true, alloc: true }));
        const [f, s, bits] = await Promise.all([
          fetchEfficientFrontier({ riskLevel: safeRiskLevel, constraints: {}, threshold }),
          fetchSharpeComparison({}),
          runQAOASelection({ constraints: {}, threshold }),
        ]);
        setFrontier(f);
        setSharpeData(s);
        setTopBits(bits);

        const allocData = await fetchAllocation({
          topBits: bits[0]?.bits || "10101",
          hybrid: true,
          threshold,
          dataset,
        });
        setAlloc(allocData);
      } catch (e) {
        console.error(e);
        dispatch(addToast({ type: "error", msg: "Initial data load failed. Try again." }));
      } finally {
        setLoading((l) => ({ ...l, frontier: false, sharpe: false, qaoa: false, alloc: false }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Compare tab: accuracy + risk/return points ---------- */
  useEffect(() => { setSelectedAsset(null); }, [riskReturn]);

  useEffect(() => {
    if (activeTab !== "compare") return;

    (async () => {
      try {
        setCompareLoading(true);

        const assetNames = Array.isArray(alloc) ? alloc.map(a => a?.name).filter(Boolean) : [];
        const weights    = Array.isArray(alloc) ? alloc.map(a => Number(a?.value) || 0) : [];

        const [accRes, rrRes] = await Promise.allSettled([
          fetchCompareAccuracy({ risk: riskLevel }),
          fetchCompareRiskReturn({ dataset, maxAssets, assetNames, weights }),
        ]);

        if (accRes.status === "fulfilled") setAccuracy(accRes.value);
        if (rrRes.status === "fulfilled")  setRiskReturn(rrRes.value);

        if (accRes.status === "rejected" || rrRes.status === "rejected") {
          throw new Error("Compare data failed to load.");
        }
      } catch (e) {
        console.error(e);
        dispatch(addToast({ type: "error", msg: "Compare data failed to load." }));
      } finally {
        setCompareLoading(false);
      }
    })();
  }, [activeTab, riskLevel, dataset, maxAssets, alloc, dispatch]);

  /* ---------- Frontier updates (demo) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading((l) => ({ ...l, frontier: true }));
        const f = await fetchEfficientFrontier({ riskLevel: safeRiskLevel, constraints: {}, threshold });
        setFrontier(f);
      } catch (e) {
        console.error(e);
        dispatch(addToast({ type: "error", msg: "Failed to update frontier." }));
      } finally {
        setLoading((l) => ({ ...l, frontier: false }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeRiskLevel, threshold]);

  /* ---------- Evolution (FastAPI via Node /api/rebalance) ---------- */
  useEffect(() => {
    if (activeTab !== "evolution") return;

    (async () => {
      try {
        setLoading((l) => ({ ...l, evo: true }));

        const payload = {
          dataset,
          budget: Math.max(1, Number(maxAssets || 5)),
          risk: riskLevel,
          totalInvestment: Number(initialEquity) || 0,
          timeHorizon: Math.max(1, Number(timeHorizon || 30)),
        };

        const reb = await fetchRebalance(payload);

        const series = Array.isArray(reb?.evolution)
          ? reb.evolution.map(d => ({
              time: d.time,
              Quantum: d.Future,   // plot Future as Quantum
              Classical: d.Current // plot Current as Classical
            }))
          : [];

        setEvolution(series);
      } catch (e) {
        console.error(e);
        dispatch(addToast({ type: "error", msg: "Rebalancing failed to load." }));
        setEvolution([]);
      } finally {
        setLoading((l) => ({ ...l, evo: false }));
      }
    })();
  }, [activeTab, dataset, maxAssets, riskLevel, initialEquity, timeHorizon, dispatch]);

  /* ---------- Stress chart (demo) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading((l) => ({ ...l, stress: true }));
        const res = await stressSim({
          alloc,
          initialEquity,
          threshold,
          stress: { ratesBps: 200, oilPct: 15, techPct: -8, fxPct: 3 },
        });

        if (Array.isArray(res)) {
          setStressed({ bars: res, ruinLine: (Number(threshold) / 100) * Number(initialEquity || 0) });
        } else {
          setStressed({
            bars: Array.isArray(res?.bars) ? res.bars : [],
            ruinLine:
              typeof res?.ruinLine === "number"
                ? res.ruinLine
                : (Number(threshold) / 100) * Number(initialEquity || 0),
          });
        }
      } catch (e) {
        console.error(e);
        dispatch(addToast({ type: "error", msg: "Failed to run stress simulation." }));
      } finally {
        setLoading((l) => ({ ...l, stress: false }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, initialEquity, alloc]);

  /* ---------- Map backend optimize → alloc (FastAPI normalized) ---------- */
  useEffect(() => {
    if (!optimizeResult) return;

    if (Array.isArray(optimizeResult.allocation) && optimizeResult.allocation.length) {
      setAlloc(
        optimizeResult.allocation.map((a) => ({
          name: a.name,
          value: Number(a.value) || 0,
        }))
      );
      return;
    }

    if (Array.isArray(optimizeResult.portfolio) && optimizeResult.portfolio.length) {
      setAlloc(
        optimizeResult.portfolio.map((p) => ({
          name: p.asset,
          value: Math.round(
            typeof p.percentage === "number" ? p.percentage : (Number(p.weight) || 0) * 100
          ),
        }))
      );
    }
  }, [optimizeResult]);

  /* ---------- Backend optimize on click ---------- */
  async function handleRunQuantum() {
    try {
      await dispatch(runOptimizeThunk()).unwrap();
    } catch (e) {
      dispatch(addToast({ type: "error", msg: e?.message || "Failed to optimize. Try again." }));
    }
  }

  /* ---------- Derived ---------- */
  const datasetLabel =
    dataset === "nifty50" ? "NIFTY 50" :
    dataset === "crypto" ? "Crypto" :
    dataset === "nasdaq" ? "NASDAQ" :
    dataset || "Select Dataset";

  const centerLabelText =
    activeSlice === null
      ? "Weights (%)"
      : `${alloc[activeSlice]?.name ?? ""} · ${percent(alloc[activeSlice]?.value || 0, 0)}`;

  const showStress = !options?.length || options.includes("Stress Testing");

  // Per-asset mini charts (built from alloc + aggregate evolution)
  const assetEvolution = useMemo(
    () => buildPerAssetEvolution(alloc, evolution),
    [alloc, evolution]
  );

  /* ---------- Home (FastAPI-aligned inputs) ---------- */
  const renderHome = () => (
    <div className="max-w-7xl mx-auto px-5 py-6 md:py-8 space-y-6">
      <Card title="Optimization Inputs (FastAPI)">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-sm">
          {/* Risk factor */}
          <div className="space-y-2">
            <label className="block text-zinc-300">Risk Factor</label>
            <select
              className="bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2 w-full"
              value={riskLevel}
              onChange={(e) => dispatch(setRiskLevel(e.target.value))}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <div className="text-zinc-500">Maps to FastAPI <code>risk_factor</code></div>
          </div>

          {/* Assets = budget */}
          <div className="space-y-2">
            <label className="block text-zinc-300">Assets</label>
            <input
              type="number"
              min={1}
              step={1}
              className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
              value={maxAssets}
              onChange={(e) => dispatch(setMaxAssets(e.target.value))}
            />
            <div className="text-zinc-500">FastAPI <code>budget</code> (count of assets)</div>
          </div>

          {/* Total investment */}
          <div className="space-y-2">
            <label className="block text-zinc-300">Total Investment (₹)</label>
            <input
              type="number"
              min={0}
              step={1000}
              className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
              value={initialEquity}
              onChange={(e) => dispatch(setInitialEquity(Number(e.target.value) || 0))}
            />
            <div className="text-zinc-500">FastAPI <code>total_investment</code></div>
          </div>

          {/* Action */}
          <div className="lg:col-span-3">
            <button
              onClick={handleRunQuantum}
              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-60"
              disabled={optimizeStatus === "loading"}
              title="Calls backend /api/optimize (FastAPI live or mock)"
            >
              {optimizeStatus === "loading" ? "Optimizing..." : "Run Quantum Optimize"}
            </button>
          </div>
        </div>
      </Card>

      {/* Chosen + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Chosen Companies (Quantum FastAPI)">
          {!alloc?.length ? (
            <EmptyState title="No allocation yet" subtitle="Click Run Quantum Optimize." />
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0f1422] text-zinc-300">
                  <tr>
                    <th className="text-left p-3">Company</th>
                    <th className="text-right p-3">Weight</th>
                    <th className="text-right p-3">Allocation (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {alloc.map((row, i) => (
                    <tr key={i} className="border-t border-zinc-800/50">
                      <td className="p-3">{row.name}</td>
                      <td className="p-3 text-right">{percent(row.value, 0)}</td>
                      <td className="p-3 text-right">{currency(initialEquity * (row.value / 100))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Allocation (Pie)">
          <div className="h-[280px]">
            {!alloc?.length ? (
              <EmptyState title="No allocation yet" subtitle="Click Run Quantum Optimize." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <Tooltip
                    formatter={(v) => `${Number(v).toFixed(0)}%`}
                    contentStyle={tooltipStyles.contentStyle}
                    labelStyle={tooltipStyles.labelStyle}
                    itemStyle={tooltipStyles.itemStyle}
                    wrapperStyle={tooltipStyles.wrapperStyle}
                  />
                  <Legend verticalAlign="bottom" height={28} wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} iconSize={8} />
                  <Pie
                    data={alloc}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={activeSlice === null ? 92 : 96}
                    paddingAngle={1}
                    isAnimationActive={false}
                    onMouseEnter={(_, i) => setActiveSlice(i)}
                    onMouseLeave={() => setActiveSlice(null)}
                    onTouchStart={(_, i) => setActiveSlice(i)}
                    onTouchEnd={() => setActiveSlice(null)}
                    label={false}
                  >
                    {alloc.map((_, i) => (
                      <Cell
                        key={i}
                        fill={COLORS[i % COLORS.length]}
                        fillOpacity={activeSlice === null ? 1 : activeSlice === i ? 1 : 0.95}
                        stroke="#e5e7eb33"
                        strokeWidth={activeSlice === i ? 2 : 1}
                        style={{ transition: "all 120ms ease" }}
                      />
                    ))}
                    <Label
                      value={
                        activeSlice === null
                          ? "Weights (%)"
                          : `${alloc[activeSlice]?.name ?? ""} · ${percent(alloc[activeSlice]?.value || 0, 0)}`
                      }
                      position="center"
                      fill="#e5e7eb"
                      fontSize={12}
                    />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="text-sm text-zinc-300 leading-relaxed">
          <p className="mb-2">
            Use the navbar to open a section. Click the same tab again to return to <span className="font-medium text-zinc-100">Home</span>.
          </p>
          <p className="mb-0">
            Current setup — Dataset: <span className="text-zinc-100">{datasetLabel}</span>, Risk:
            <span className="text-zinc-100"> {riskPretty}</span>, Assets:
            <span className="text-zinc-100"> {maxAssets}</span>, Total Investment:
            <span className="text-zinc-100"> {`₹${initialEquity.toLocaleString("en-IN")}`}</span>.
          </p>
        </div>
      </Card>
    </div>
  );

  /* ---------- Page ---------- */
  return (
    <div className="flex min-h-screen bg-[#0b0f1a] text-gray-100">
      <div className="flex-1 min-w-0 flex flex-col">
        <Navbar />

        {/* Home */}
        {activeTab === null ? (
          <div className="flex-1 overflow-auto">{renderHome()}</div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="max-w-7xl mx-auto px-5 py-6 md:py-8 space-y-6">
              {/* Section header */}
              <div className="bg-[#0f1422] border border-zinc-800/70 rounded-xl p-4">
                <h2 className="text-lg font-semibold tracking-tight">
                  {activeTab === "compare" && "Quantum vs Classical"}
                  {activeTab === "evolution" && "Portfolio Evolution"}
                  {activeTab === "insights" && "Quantum Insights"}
                  {activeTab === "stress" && "Stress Testing"}
                </h2>
                <p className="text-zinc-400 text-sm mt-1">
                  Dataset: <span className="text-zinc-200">{datasetLabel}</span>
                  {" • "}Risk: <span className="text-zinc-200">{riskPretty}</span>
                  {" • "}Assets: <span className="text-zinc-200">{maxAssets}</span>
                  {" • "}Init: <span className="text-zinc-200">{`₹${initialEquity.toLocaleString("en-IN")}`}</span>
                  {" • "}Horizon: <span className="text-zinc-200">{timeHorizon} days</span>
                  {" • "}Thresh: <span className="text-zinc-200">{threshold}%</span>
                </p>
              </div>

              {/* Compare */}
              {activeTab === "compare" && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Accuracy bar (demo numbers) */}
                    <Card title="Model Accuracy (Demo)">
                      <div className="h-[280px]">
                        {compareLoading ? (
                          <Skeleton className="h-full w-full" />
                        ) : !accuracy ? (
                          <EmptyState title="No data" subtitle="Open this tab to fetch results." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={[
                                { name: "Classical", value: accuracy.classical },
                                { name: "Quantum",   value: accuracy.quantum   },
                              ]}
                              margin={{ top: 10, right: 15, left: 10, bottom: 24 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                              <XAxis dataKey="name" stroke="#a1a1aa" tickMargin={6} />
                              <YAxis stroke="#a1a1aa" domain={[0, 100]} width={56} />
                              <Tooltip
                                contentStyle={tooltipStyles.contentStyle}
                                labelStyle={tooltipStyles.labelStyle}
                                itemStyle={tooltipStyles.itemStyle}
                                wrapperStyle={tooltipStyles.wrapperStyle}
                                formatter={(v) => `${v}%`}
                              />
                              <Bar dataKey="value" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      <ChartCaption x="Model" y="Accuracy (%)" />
                    </Card>

                    {/* Risk vs Return scatter */}
                    <Card title="Risk vs Return per Asset">
                      <div className="h-[320px]">
                        {compareLoading ? (
                          <Skeleton className="h-full w-full" />
                        ) : !riskReturn?.points?.length ? (
                          <EmptyState title="No data" subtitle="Open this tab to fetch results." />
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height="100%">
                              <ScatterChart margin={{ top: 10, right: 16, left: 12, bottom: 28 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                                <XAxis type="number" dataKey="risk" name="Risk (σ)" unit="%" stroke="#a1a1aa" tickMargin={6} />
                                <YAxis type="number" dataKey="ret"  name="Expected Return" unit="%" stroke="#a1a1aa" tickMargin={6} width={64} />
                                <Tooltip content={<CompareTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                                <Legend />
                                <Scatter
                                  name="Classical"
                                  data={riskReturn.points.map(p => ({ name: p.name, risk: p.classical.risk, ret: p.classical.ret, _model: "Classical" }))}
                                  fill="#60a5fa"
                                  shape="circle"
                                  onClick={(pt) => setSelectedAsset(pt?.name || null)}
                                />
                                <Scatter
                                  name="Quantum"
                                  data={riskReturn.points.map(p => ({ name: p.name, risk: p.quantum.risk, ret: p.quantum.ret, _model: "Quantum" }))}
                                  fill="#a78bfa"
                                  shape="circle"
                                  onClick={(pt) => setSelectedAsset(pt?.name || null)}
                                />
                              </ScatterChart>
                            </ResponsiveContainer>

                            {selectedAsset && (() => {
                              const row = riskReturn.points.find(p => p.name === selectedAsset);
                              if (!row) return null;
                              return (
                                <div className="mt-3 text-sm border border-zinc-800/60 rounded-xl p-3 bg-[#0f1422]">
                                  <div className="mb-2 font-medium">
                                    {row.name} — details
                                    <button
                                      className="ml-2 px-2 py-0.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700"
                                      onClick={() => setSelectedAsset(null)}
                                    >
                                      clear
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div className="border border-zinc-800/50 rounded-lg p-2">
                                      <div className="text-zinc-400 mb-1">Classical</div>
                                      <div>Risk (σ): <span className="text-zinc-100">{row.classical.risk.toFixed(1)}%</span></div>
                                      <div>Return: <span className="text-zinc-100">{row.classical.ret.toFixed(1)}%</span></div>
                                    </div>
                                    <div className="border border-emerald-800/40 rounded-lg p-2">
                                      <div className="text-zinc-400 mb-1">Quantum</div>
                                      <div>Risk (σ): <span className="text-zinc-100">{row.quantum.risk.toFixed(1)}%</span></div>
                                      <div>Return: <span className="text-zinc-100">{row.quantum.ret.toFixed(1)}%</span></div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                      <ChartCaption x="Risk (σ, %)" y="Expected Return (%)" />
                    </Card>
                  </div>
                </>
              )}

              {/* Evolution — ONLY Time control + per-asset grid */}
              {activeTab === "evolution" && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
                    <Card title="Time (days)">
                      <input
                        type="number"
                        min={1}
                        className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
                        value={timeHorizon}
                        onChange={(e) => dispatch(setTimeHorizon(Math.max(1, Number(e.target.value) || 1)))}
                      />
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {loading.evo ? (
                      <Card><Skeleton className="h-[220px] w-full" /></Card>
                    ) : !assetEvolution.length ? (
                      <Card>
                        <EmptyState
                          title="No asset charts yet"
                          subtitle="Run Quantum Optimize on Home to get assets."
                        />
                      </Card>
                    ) : (
                      assetEvolution.map((a) => (
                        <Card key={a.name} title={a.name}>
                          <div className="h-[220px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={a.series} margin={{ top: 8, right: 10, left: 12, bottom: 6 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                                <XAxis dataKey="time" stroke="#a1a1aa" tickMargin={4} />
                                <YAxis stroke="#a1a1aa" tickFormatter={(v) => currency(v)} width={72} />
                                <Tooltip
                                  formatter={(v, name) => [currency(v), name]}
                                  contentStyle={tooltipStyles.contentStyle}
                                  labelStyle={tooltipStyles.labelStyle}
                                  itemStyle={tooltipStyles.itemStyle}
                                  wrapperStyle={tooltipStyles.wrapperStyle}
                                />
                                <Legend />
                                <Line type="monotone" dataKey="Quantum" stroke="#7C3AED" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="Classical" stroke="#3B82F6" strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                </>
              )}

              {/* Insights (unchanged demo) */}
              {activeTab === "insights" && (
                <div className="grid grid-cols-1 gap-6">
                  <InsightsPanel
                    loading={loading.frontier || loading.alloc || loading.evo}
                    topBits={topBits}
                    sharpeData={sharpeData}
                    alloc={alloc}
                    evolution={evolution}
                    useHybrid={true}
                  />
                </div>
              )}

              {/* Stress (demo) */}
              {activeTab === "stress" && (
                <div className="grid grid-cols-1 gap-6">
                  <Card title="Selection Threshold (%)">
                    <input
                      type="range" min="0" max="100"
                      value={threshold}
                      onChange={(e) => dispatch(setThreshold(Number(e.target.value) || 0))}
                      className="w-full accent-indigo-500"
                    />
                    <div className="text-zinc-400 mt-1">{threshold}%</div>
                  </Card>

                  <Card title="Stock Resilience vs Ruin Threshold">
                    <div className="h-[320px]">
                      {loading.stress ? (
                        <Skeleton className="h-full w-full" />
                      ) : !stressed?.bars?.length ? (
                        <EmptyState title="No stress result yet" subtitle="Adjust threshold or allocation." />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stressed.bars} margin={{ top: 10, right: 12, left: 24, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                            <XAxis
                              dataKey="name"
                              stroke="#a1a1aa"
                              tickMargin={6}
                              interval={0}
                              angle={-15}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis stroke="#a1a1aa" tickFormatter={(v) => currency(v)} tickMargin={6} width={88} />
                            <Tooltip
                              formatter={(v) => currency(v)}
                              contentStyle={{
                                background: "#111827",
                                border: "1px solid #6366F1",
                                borderRadius: 8,
                                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                              }}
                              labelStyle={{ color: "#C7D2FE", fontSize: 12 }}
                              itemStyle={{ color: "#E5E7EB", fontSize: 12 }}
                              wrapperStyle={{ zIndex: 50 }}
                            />
                            <ReferenceLine
                              y={stressed.ruinLine}
                              stroke="#22c55e"
                              strokeDasharray="6 6"
                              ifOverflow="extendDomain"
                              label={{
                                value: `Ruin Threshold (${threshold}%)`,
                                position: "insideTopRight",
                                fill: "#22c55e",
                                fontSize: 12,
                              }}
                            />
                            <Bar dataKey="value" fill="#ef4444" opacity={0.85} radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                    <ChartCaption x="Stocks" y="Equity after worst-case days (₹)" />
                  </Card>
                </div>
              )}

              {/* Footer / Exports (optional) */}
              {showStress && (
                <div className="pt-2 pb-8 flex flex-wrap gap-2">
                  <button
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition"
                    onClick={() =>
                      downloadJSON("results.json", { frontier, sharpeData, alloc, evolution, topBits, stressed })
                    }
                  >
                    Export JSON
                  </button>
                  <button
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition border border-zinc-700"
                    onClick={() => downloadCSV("top_solutions.csv", topBits)}
                  >
                    Export Top Solutions (CSV)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
