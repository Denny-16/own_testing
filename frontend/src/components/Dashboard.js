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
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Legend, BarChart, Bar, CartesianGrid,
  ReferenceLine, ScatterChart, Scatter
} from "recharts";

import {
  fetchEfficientFrontier,
  fetchSharpeComparison,
  runQAOASelection,
  fetchAllocation,
  stressSim,
  fetchRebalance, // POST /api/rebalance
} from "../lib/api.js";

/* ---------- Small UI helpers ---------- */
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

/* ---------- Dataset → API mapping (Home dataset → backend value) ---------- */
const DATASET_API_MAP = {
  crypto:  "Crypto",
  nasdaq:  "NASDAQ",
  nifty50: "NIFTY50",
};

/* ---------- Compare tooltip ---------- */
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

export default function Dashboard() {
  const dispatch = useDispatch();

  /* ---------- Global UI state ---------- */
  const {
    dataset, riskLevel, options,
    initialEquity, timeHorizon, threshold,
    maxAssets,
    activeTab,
    optimizeStatus, optimizeResult,
  } = useSelector((s) => s.ui);

  const safeRiskLevel = (typeof riskLevel === "string" && riskLevel.length) ? riskLevel : "medium";
  const riskPretty = safeRiskLevel.charAt(0).toUpperCase() + safeRiskLevel.slice(1);

  /* ---------- Local state ---------- */
  const [activeSlice, setActiveSlice] = useState(null);

  // Compare (uses demo data; no backend dependency to avoid missing export errors)
  const [compareLoading, setCompareLoading] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [riskReturn, setRiskReturn] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Allocation / Frontier / Stress
  const [frontier, setFrontier] = useState([]);
  const [sharpeData, setSharpeData] = useState([]);
  const [alloc, setAlloc] = useState([]);
  const [evolution, setEvolution] = useState([]); // kept only for export JSON compatibility
  const [topBits, setTopBits] = useState([]);
  const [stressed, setStressed] = useState({ bars: [], ruinLine: 0 });

  const [loading, setLoading] = useState({
    frontier: false, sharpe: false, qaoa: false, alloc: false, stress: false
  });

  // Rebalancing
  const [rbLoading, setRbLoading] = useState(false);
  const [futureDataset, setFutureDataset] = useState("NIFTY50_Future");
  const [rebal, setRebal] = useState(null);

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

  /* ---------- Compare tab (client-side demo data) ---------- */
  useEffect(() => { setSelectedAsset(null); }, [riskReturn]);

  useEffect(() => {
    if (activeTab !== "compare") return;
    setCompareLoading(true);

    // Simple deterministic demo data based on current alloc
    const names = (alloc || []).map(a => a.name);
    const baseAcc = { classical: 74, quantum: 83 };
    const pts = names.map((n, i) => {
      const w = Number(alloc[i]?.value || 0);
      // derive "risk/return" from weight so it's stable
      const risk = Math.max(2, Math.min(40, 30 - w * 0.1 + (i % 5)));
      const ret  = Math.max(1, Math.min(30,  5 + w * 0.12 + ((i * 3) % 7)));
      return {
        name: n,
        classical: { risk: risk + 2, ret: ret - 1 },
        quantum:   { risk: risk,     ret: ret + 1.5 },
      };
    });

    setAccuracy(baseAcc);
    setRiskReturn({ points: pts });
    setCompareLoading(false);
  }, [activeTab, alloc]);

  /* ---------- Frontier updates when risk/threshold change ---------- */
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

  /* ---------- REBALANCING (replaces old Evolution) ---------- */
  useEffect(() => {
    const isRebalancingTab = activeTab === "evolution" || activeTab === "insights"; // treat 'insights' as Rebalancing
    if (!isRebalancingTab) return;

    (async () => {
      try {
        setRbLoading(true);
        const res = await fetchRebalance({
          dataset_option: DATASET_API_MAP[dataset] || "NIFTY50", // current dataset from Home
          future_dataset_option: futureDataset,                  // user free pick
          budget: Math.max(1, Number(maxAssets || 5)),
          risk_factor: riskLevel,
          total_investment: Number(initialEquity) || 0,
        });
        setRebal(res);
        setEvolution([]); // not used anymore
      } catch (e) {
        console.error(e);
        dispatch(addToast({ type: "error", msg: "Rebalancing failed to load." }));
        setRebal(null);
      } finally {
        setRbLoading(false);
      }
    })();
  }, [activeTab, dataset, futureDataset, maxAssets, riskLevel, initialEquity, dispatch]);

  /* ---------- Stress chart ---------- */
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

  /* ---------- Map backend optimize → alloc ---------- */
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

  /* ---------- Actions ---------- */
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

  const showStress = !options?.length || options.includes("Stress Testing");

  const pieData = useMemo(
    () => (alloc || []).map((a, i) => ({ ...a, fill: COLORS[i % COLORS.length] })),
    [alloc]
  );

  /* ---------- Home ---------- */
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
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={92}
                    paddingAngle={1}
                    isAnimationActive={false}
                  />
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

  /* ---------- REBALANCING UI ---------- */
  const renderRebalancing = () => (
    <div className="grid grid-cols-1 gap-6">
      <Card title="Rebalancing Inputs">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {/* Future Dataset Option (user can choose any) */}
          <div className="space-y-1">
            <label className="block text-zinc-300">Future Dataset Option</label>
            <select
              className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
              value={futureDataset}
              onChange={(e) => setFutureDataset(e.target.value)}
            >
              <option value="NIFTY50_Future">NIFTY50_Future</option>
              <option value="NASDAQ_Future">NASDAQ_Future</option>
              <option value="Crypto_Future">Crypto_Future</option>
            </select>
            <div className="text-xs text-zinc-500">
              Current dataset sent to API: <b>{DATASET_API_MAP[dataset] || "NIFTY50"}</b>
            </div>
          </div>

          {/* Assets (budget) */}
          <div className="space-y-1">
            <label className="block text-zinc-300">Assets (budget)</label>
            <input
              type="number"
              min={1}
              step={1}
              className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
              value={maxAssets}
              onChange={(e) => dispatch(setMaxAssets(e.target.value))}
            />
          </div>

          {/* Total Investment */}
          <div className="space-y-1">
            <label className="block text-zinc-300">Total Investment (₹)</label>
            <input
              type="number"
              className="w-full bg-[#0b0f1a] border border-zinc-700 rounded-lg px-3 py-2"
              value={initialEquity}
              onChange={(e) => dispatch(setInitialEquity(Number(e.target.value) || 0))}
            />
          </div>
        </div>
      </Card>

      {rbLoading ? (
        <Skeleton className="h-[280px] w-full" />
      ) : !rebal ? (
        <EmptyState title="No rebalance result yet" subtitle="Adjust inputs above." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Current Portfolio */}
          <Card title="📊 Current Portfolio">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0f1422] text-zinc-300">
                  <tr>
                    <th className="p-2 text-left">Asset</th>
                    <th className="p-2 text-right">Weight</th>
                    <th className="p-2 text-right">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {rebal.current_portfolio?.map((a, i) => (
                    <tr key={i} className="border-t border-zinc-800/50">
                      <td className="p-2">{a.asset}</td>
                      <td className="p-2 text-right">{percent(a.percentage, 1)}</td>
                      <td className="p-2 text-right">{currency(a.investment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Future Portfolio */}
          <Card title="🔮 Future Portfolio">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0f1422] text-zinc-300">
                  <tr>
                    <th className="p-2 text-left">Asset</th>
                    <th className="p-2 text-right">Weight</th>
                    <th className="p-2 text-right">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {rebal.future_portfolio?.map((a, i) => (
                    <tr key={i} className="border-t border-zinc-800/50">
                      <td className="p-2">{a.asset}</td>
                      <td className="p-2 text-right">{percent(a.percentage, 1)}</td>
                      <td className="p-2 text-right">{currency(a.investment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Recommendations */}
          <Card title="✅ Recommendations">
            {!rebal.recommendations?.length ? (
              <div className="text-sm text-zinc-400">No actions.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rebal.recommendations.map((r, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border"
                    style={{
                      borderColor:
                        r.action === "BUY" || r.action === "INCREASE" ? "#059669" :
                        r.action === "SELL" ? "#DC2626" : "#52525b",
                      background:
                        r.action === "BUY" || r.action === "INCREASE" ? "#064e3b33" :
                        r.action === "SELL" ? "#7f1d1d33" : "#18181b33",
                    }}
                  >
                    <div className="font-semibold">{r.action}: {r.asset}</div>
                    <div className="text-xs text-zinc-400 mt-1">
                      Current: {currency(r.current_allocation || 0)} ({percent(r.current_pct || 0, 1)})
                    </div>
                    <div className="text-xs text-zinc-400">
                      Future: {currency(r.future_allocation || 0)} ({percent(r.future_pct || 0, 1)})
                    </div>
                    <div className="text-xs mt-1">
                      Change: <span className="font-medium">
                        {currency(
                          (r.change_allocation || 0).toFixed
                            ? r.change_allocation.toFixed(0)
                            : r.change_allocation || 0
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Summary */}
          <Card title="📌 Summary">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>Sell: <b>{rebal?.summary?.sell ?? 0}</b></div>
              <div>Buy: <b>{rebal?.summary?.buy ?? 0}</b></div>
              <div>Rebalance/Hold: <b>{rebal?.summary?.rebalance_or_hold ?? 0}</b></div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );

  /* ---------- Page ---------- */
  const isRebalancingTab = activeTab === "evolution" || activeTab === "insights"; // 'insights' = removed; route here

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
                  {isRebalancingTab && "Rebalancing"}
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
              )}

              {/* REBALANCING */}
              {isRebalancingTab && renderRebalancing()}

              {/* STRESS */}
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
                            <Bar dataKey="value" opacity={0.85} radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                    <ChartCaption x="Stocks" y="Equity after worst-case days (₹)" />
                  </Card>
                </div>
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
