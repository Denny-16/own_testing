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
import InsightsPanel from "./InsightsPanel.js";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar, CartesianGrid, Label,
  ReferenceLine, ScatterChart, Scatter,
} from "recharts";

import {
  fetchEfficientFrontier,
  fetchSharpeComparison,
  runQAOASelection,
  fetchAllocation,
  stressSim,
  fetchCompareAccuracy,
  fetchCompareRiskReturn,
  fetchRebalance, // <-- backend /api/rebalance
} from "../lib/api.js";

// ---------- UI bits ----------
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

  // Compare tab state
  const [compareLoading, setCompareLoading] = useState(false);
  const [accuracy, setAccuracy] = useState(null); // {metric,quantum,classical}
  const [riskReturn, setRiskReturn] = useState(null); // {dataset, points:[{name, classical:{risk,ret}, quantum:{risk,ret}}]}
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Demo-only bits kept for other charts/sections
  const [stress, setStress] = useState({ ratesBps: 200, oilPct: 15, techPct: -8, fxPct: 3 });

  // Data
  const [frontier, setFrontier] = useState([]);
  const [sharpeData, setSharpeData] = useState([]);
  const [alloc, setAlloc] = useState([]); // [{name, value}] in %
  const [evolution, setEvolution] = useState([]); // aggregate series
  const [assetEvolution, setAssetEvolution] = useState([]); // per-asset mini series
  const [topBits, setTopBits] = useState([]);
  const [stressed, setStressed] = useState({ bars: [], ruinLine: 0 });

  // Loading flags (demo endpoints)
  const [loading, setLoading] = useState({
    frontier: false, sharpe: false, qaoa: false, alloc: false, evo: false, stress: false
  });

  // ---------- Initial demo data for non-FastAPI charts ----------
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

  // ---------- Compare tab ----------
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

  // ---------- Frontier updates (demo) ----------
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

  // ---------- Evolution: FastAPI /api/rebalance ----------
  useEffect(() => {
    if (activeTab !== "evolution") return;

    (async () => {
      try {
        setLoading((l) => ({ ...l, evo: true }));

        const assetsCount = Math.max(1, Number(maxAssets || 5));
        const reb = await fetchRebalance({
          dataset,                      // "nifty50" | "nasdaq" | "crypto"
          budget: assetsCount,          // number of assets
          risk: riskLevel,              // "low" | "medium" | "high"
          totalInvestment: initialEquity,
          timeHorizon: Math.max(1, Number(timeHorizon || 30)),
        });

        const series = Array.isArray(reb?.evolution)
          ? reb.evolution.map(d => ({
              time: d.time,            // "Day 1"
              Quantum: d.Future,       // plot FastAPI Future as Quantum
              Classical: d.Current,    // plot FastAPI Current as Classical
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

  // ---------- Stress chart (demo backend) ----------
  useEffect(() => {
    (async () => {
      try {
        setLoading((l) => ({ ...l, stress: true }));
        const res = await stressSim({
          alloc,
          initialEquity,
          threshold,
          stress,
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
  }, [stress, threshold, initialEquity, alloc]);

  // ---------- Map backend optimize → alloc (REAL FastAPI weights) ----------
  useEffect(() => {
    if (!optimizeResult) return;

    if (Array.isArray(optimizeResult.allocation) && optimizeResult.allocation.length) {
      setAlloc(
        optimizeResult.allocation.map((a) => ({
          name: a.name,
          value: Number(a.value) || 0, // %
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

  // ---------- Per-asset mini series builder ----------
  function seededRng(seedStr) {
    let s = Array.from(String(seedStr || "x")).reduce((a, c) => a + c.charCodeAt(0), 0) >>> 0;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 10000) / 10000;
    };
  }
  function buildAssetEvolution({ alloc = [], totalSeries = [] }) {
    if (!alloc.length || !totalSeries.length) return [];
    const weights = alloc.map(a => Math.max(0, Number(a.value) || 0));
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const norm = weights.map(w => w / wSum);

    return alloc.map((a, idx) => {
      const rnd = seededRng(a.name + "::qevo");
      const w = norm[idx];
      const series = totalSeries.map((row) => {
        const baseC = row.Classical * w;
        const baseQ = row.Quantum   * w;
        const jitter = (rnd() - 0.5) * 0.002;  // ±0.1%
        const jitter2 = (rnd() - 0.5) * 0.002;
        const cur = Math.round(baseC * (1 + jitter));
        const fut = Math.round(baseQ * (1 + 0.001 + jitter2)); // Future a bit ahead
        return { time: row.time, Current: cur, Future: fut };
      });
      return { name: a.name, series };
    });
  }

  useEffect(() => {
    setAssetEvolution(buildAssetEvolution({ alloc, totalSeries: evolution }));
  }, [alloc, evolution]);

  // ---------- Backend optimize on click ----------
  async function handleRunQuantum() {
    try {
      await dispatch(runOptimizeThunk()).unwrap();
    } catch (e) {
      dispatch(addToast({ type: "error", msg: e?.message || "Failed to optimize. Try again." }));
    }
  }

  // ---------- Derived ----------
  const datasetLabel =
    dataset === "nifty50" ? "NIFTY 50" :
    dataset === "crypto" ? "Crypto" :
    dataset === "nasdaq" ? "NASDAQ" :
    dataset || "Select Dataset";

  const centerLabelText =
    activeSlice === null
      ? "Weights (%)"
      : `${alloc[activeSlice]?.name ?? ""} · ${percent(alloc[activeSlice]?.value || 0, 0)}`;

  const showSharpe = !options?.length || options.includes("Sharpe Ratio");
  const showStress = !options?.length || options.includes("Stress Testing");

  // ---------- Home (FastAPI inputs) ----------
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

          {/* Assets (budget = number of assets) */}
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
            <div className="text-zinc-500">FastAPI <code>budget</code> (count of assets to select)</div>
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

          {/* Single action */}
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

      {/* Two-pane results */}
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
                    <Label value={centerLabelText} position="center" fill="#e5e7eb" fontSize={12} />
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

  // ---------- Page ----------
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
                  {activeTab === "explain" && "Explain"}
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
                    {/* Accuracy bar (demo) */}
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
                                <XAxis
                                  type="number"
                                  dataKey="risk"
                                  name="Risk (σ)"
                                  unit="%"
                                  stroke="#a1a1aa"
                                  tickMargin={6}
                                />
                                <YAxis
                                  type="number"
                                  dataKey="ret"
                                  name="Expected Return"
                                  unit="%"
                                  stroke="#a1a1aa"
                                  tickMargin={6}
                                  width={64}
                                />
                                <Tooltip content={<CompareTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                                <Legend />
                                <Scatter
                                  name="Classical"
                                  data={riskReturn.points.map(p => ({
                                    name: p.name,
                                    risk: p.classical.risk,
                                    ret: p.classical.ret,
                                    _model: "Classical",
                                  }))}
                                  fill="#60a5fa"
                                  shape="circle"
                                  onClick={(pt) => setSelectedAsset(pt?.name || null)}
                                />
                                <Scatter
                                  name="Quantum"
                                  data={riskReturn.points.map(p => ({
                                    name: p.name,
                                    risk: p.quantum.risk,
                                    ret: p.quantum.ret,
                                    _model: "Quantum",
                                  }))}
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

              {/* Evolution */}
              {activeTab === "evolution" && (
                <>
                  {/* Only Time (days) control */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Card title="Time (days)">
                      <input
                        type="number"
                        min={1}
                        className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
                        value={timeHorizon}
                        onChange={(e) => dispatch(setTimeHorizon(Math.max(1, Number(e.target.value) || 1)))}
                      />
                      <div className="mt-2 text-xs text-zinc-400">
                        Changing days will refetch the Quantum vs Classical projection.
                      </div>
                    </Card>
                  </div>

                  {/* Aggregate series */}
                  <div className="grid grid-cols-1 gap-6">
                    <Card title="Portfolio Value Over Time">
                      <div className="h-[320px]">
                        {loading.evo ? (
                          <Skeleton className="h-full w-full" />
                        ) : !evolution?.length ? (
                          <EmptyState title="No evolution yet" subtitle="Enter days to fetch the projection." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={evolution} margin={{ top: 10, right: 12, left: 24, bottom: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                              <XAxis dataKey="time" stroke="#a1a1aa" tickMargin={6} />
                              <YAxis stroke="#a1a1aa" tickFormatter={(v) => currency(v)} tickMargin={6} width={88} />
                              <Tooltip
                                formatter={(v) => currency(v)}
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
                        )}
                      </div>
                      <ChartCaption x="Time (days)" y="Portfolio Value (₹)" />
                    </Card>
                  </div>

                  {/* Per-asset mini charts (3x2 grid) */}
                  {!!assetEvolution.length && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {assetEvolution.slice(0, 6).map((a, i) => (
                        <Card key={i} title={a.name}>
                          <div className="h-[180px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={a.series} margin={{ top: 6, right: 8, left: 12, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                                <XAxis dataKey="time" stroke="#a1a1aa" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                                <YAxis
                                  stroke="#a1a1aa"
                                  width={70}
                                  tick={{ fontSize: 10 }}
                                  tickFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
                                />
                                <Tooltip
                                  formatter={(v, n) => [`₹${Math.round(v).toLocaleString("en-IN")}`, n]}
                                  contentStyle={tooltipStyles.contentStyle}
                                  labelStyle={tooltipStyles.labelStyle}
                                  itemStyle={tooltipStyles.itemStyle}
                                />
                                <Line type="monotone" dataKey="Future" stroke="#7C3AED" strokeWidth={1.8} dot={false} />
                                <Line type="monotone" dataKey="Current" stroke="#3B82F6" strokeWidth={1.6} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </>
              )}

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

              {activeTab === "stress" && (
                <div className="grid grid-cols-1 gap-6">
                  <Card title="Stress Controls (incl. Threshold)">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <label className="block text-zinc-300 mb-1">Interest Rates (+bps)</label>
                        <input
                          type="range" min="0" max="400"
                          value={stress.ratesBps}
                          onChange={(e) => setStress({ ...stress, ratesBps: Number(e.target.value) })}
                          className="w-full accent-indigo-500"
                        />
                        <div className="text-zinc-400 mt-1">{stress.ratesBps} bps</div>
                      </div>
                      <div>
                        <label className="block text-zinc-300 mb-1">Oil Price Shock (%)</label>
                        <input
                          type="range" min="-20" max="30"
                          value={stress.oilPct}
                          onChange={(e) => setStress({ ...stress, oilPct: Number(e.target.value) })}
                          className="w-full accent-indigo-500"
                        />
                        <div className="text-zinc-400 mt-1">{stress.oilPct}%</div>
                      </div>
                      <div>
                        <label className="block text-zinc-300 mb-1">Tech Sector Shock (%)</label>
                        <input
                          type="range" min="-30" max="10"
                          value={stress.techPct}
                          onChange={(e) => setStress({ ...stress, techPct: Number(e.target.value) })}
                          className="w-full accent-indigo-500"
                        />
                        <div className="text-zinc-400 mt-1">{stress.techPct}%</div>
                      </div>
                      <div>
                        <label className="block text-zinc-300 mb-1">FX Shock (±%)</label>
                        <input
                          type="range" min="-10" max="10"
                          value={stress.fxPct}
                          onChange={(e) => setStress({ ...stress, fxPct: Number(e.target.value) })}
                          className="w-full accent-indigo-500"
                        />
                        <div className="text-zinc-400 mt-1">{stress.fxPct}%</div>
                      </div>

                      {/* Editable Threshold here */}
                      <div className="md:col-span-2">
                        <label className="block text-zinc-300 mb-1">Selection Threshold (%)</label>
                        <input
                          type="range" min="0" max="100"
                          value={threshold}
                          onChange={(e) => dispatch(setThreshold(Number(e.target.value) || 0))}
                          className="w-full accent-indigo-500"
                        />
                        <div className="text-zinc-400 mt-1">{threshold}%</div>
                      </div>
                    </div>
                  </Card>

                  <Card title="Stock Resilience vs Ruin Threshold">
                    <div className="h-[320px]">
                      {loading.stress ? (
                        <Skeleton className="h-full w-full" />
                      ) : !stressed?.bars?.length ? (
                        <EmptyState title="No stress result yet" subtitle="Adjust shocks or threshold." />
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

              {activeTab === "explain" && (
                <Card title="Top Measured Portfolios (Demo)">
                  {!topBits?.length ? (
                    <EmptyState title="No solutions yet" subtitle="Apply constraints to compute candidate bitstrings." />
                  ) : (
                    <div className="overflow-auto border border-zinc-800/70 rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="bg-[#0f1422] text-zinc-300">
                          <tr>
                            <th className="text-left p-3">Bitstring</th>
                            <th className="text-right p-3">Prob.</th>
                            <th className="text-right p-3">Exp. Return</th>
                            <th className="text-right p-3">Risk</th>
                            <th className="text-left p-3">Constraints</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topBits.map((r, i) => (
                            <tr key={i} className="border-t border-zinc-800/50">
                              <td className="p-3 font-mono">{r.bits}</td>
                              <td className="p-3 text-right">{percent(r.p * 100, 1)}</td>
                              <td className="p-3 text-right">{percent(r.expRet, 1)}</td>
                              <td className="p-3 text-right">{percent(r.risk, 1)}</td>
                              <td className="p-3">{r.constraints}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {/* Footer / Exports */}
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
