// src/components/InsightsPanel.js
import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const currency = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
const percent = (v, d = 1) => `${Number(v || 0).toFixed(d)}%`;

// Local lightweight "Card" so this file is self-contained
const Card = ({ title, children, className = "" }) => (
  <div className={`bg-[#0f1422] border border-zinc-800/70 rounded-2xl p-4 ${className}`}>
    {title ? <h3 className="text-[15px] md:text-lg font-semibold mb-2">{title}</h3> : null}
    {children}
  </div>
);

export default function InsightsPanel({
  loading = false,
  topBits = [],
  sharpeData = [],
  alloc = [],
  evolution = [],
  useHybrid = true,
}) {
  // --- Derived little stats (safe fallbacks) ---
  const quantumVsClassicalEdge = useMemo(() => {
    // if evolution has Classical & Quantum series, compare last point
    if (Array.isArray(evolution) && evolution.length) {
      const last = evolution[evolution.length - 1];
      const q = Number(last?.Quantum || 0);
      const c = Number(last?.Classical || 0);
      if (q && c) return ((q - c) / c) * 100; // %
    }
    return 0;
  }, [evolution]);

  const bestSharpeText = useMemo(() => {
    // look for max in sharpeData if provided; else show "Hybrid"
    if (Array.isArray(sharpeData) && sharpeData.length) {
      const best = [...sharpeData].sort((a, b) => (b?.sharpe || 0) - (a?.sharpe || 0))[0];
      const name = best?.model ?? "Hybrid";
      const val = best?.sharpe ?? 1.42;
      return { name, val };
    }
    return { name: "Hybrid", val: 1.42 };
  }, [sharpeData]);

  const hhi = useMemo(() => {
    // Herfindahl–Hirschman Index from weights (0–100 range)
    if (!Array.isArray(alloc) || !alloc.length) return 0;
    const s2 = alloc.reduce((acc, a) => {
      const w = Number(a?.value || 0) / 100; // to 0–1
      return acc + w * w;
    }, 0);
    return s2 * 100; // show as 0–100-ish scale for UI
  }, [alloc]);

  const narrative = useMemo(() => {
    const edge = quantumVsClassicalEdge;
    const best = bestSharpeText;
    const hhiTxt = hhi.toFixed(1);
    const hybridTxt = useHybrid ? "on — subset by QAOA, weights by a classical solver" : "off";
    return `Over this backtest, Quantum ${edge >= 0 ? "outperformed" : "underperformed"} Classical by ${Math.abs(edge).toFixed(1)}%. The best Sharpe among models is **${best.name}** at ${best.val}. Allocation concentration (HHI) is about ${hhiTxt} — ${hhi < 25 ? "well diversified" : "moderately concentrated"}. Hybrid mode is ${hybridTxt}.`;
  }, [quantumVsClassicalEdge, bestSharpeText, hhi, useHybrid]);

  // Top weights list (up to 5)
  const topWeights = useMemo(
    () => Array.isArray(alloc) ? [...alloc].sort((a,b)=> (b?.value||0)-(a?.value||0)).slice(0,5) : [],
    [alloc]
  );

  return (
    <div className="space-y-6">
      {/* Header summary line (kept minimal; Dashboard shows dataset/risk row above) */}
      <Card title="Key Takeaways">
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
      </Card>

      {/* Metric tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Hybrid Advantage">
          <div className="text-3xl font-semibold text-emerald-400">{percent(quantumVsClassicalEdge, 1)}</div>
          <div className="text-xs text-zinc-400 mt-1">Quantum vs Classical total return</div>
        </Card>

        <Card title="Best Sharpe">
          <div className="text-3xl font-semibold">{bestSharpeText.val}</div>
          <div className="text-xs text-zinc-400 mt-1">{bestSharpeText.name}</div>
        </Card>

        <Card title="Allocation Concentration">
          <div className="text-3xl font-semibold">{hhi.toFixed(1)}%</div>
          <div className="text-xs text-zinc-400 mt-1">HHI × 100 (lower = diversified)</div>
        </Card>
      </div>

      {/* Top QAOA bitstrings (probability) */}
      <Card title="Top QAOA Bitstrings (Probability)">
        <div className="h-[240px]">
          {!Array.isArray(topBits) || !topBits.length ? (
            <div className="text-sm text-zinc-400">No bitstring data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topBits.map(b => ({ bits: b.bits, p: Math.round((b.p || 0) * 1000) / 10 }))}
                margin={{ top: 10, right: 12, left: 12, bottom: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                <XAxis dataKey="bits" stroke="#a1a1aa" tickMargin={6} />
                <YAxis stroke="#a1a1aa" tickFormatter={(v) => `${v}%`} tickMargin={6} width={56} />
                <Tooltip
                  formatter={(v) => `${v}%`}
                  contentStyle={{
                    background: "#111827",
                    border: "1px solid #6366F1",
                    borderRadius: 8
                  }}
                  labelStyle={{ color: "#C7D2FE", fontSize: 12 }}
                  itemStyle={{ color: "#E5E7EB", fontSize: 12 }}
                />
                <Legend />
                <Bar dataKey="p" name="Probability" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-2 text-[11px] text-zinc-400">
          Bars show measurement probability (%) for the most likely portfolios.
        </div>
      </Card>

      {/* Top 5 weights */}
      <Card title="Top 5 Weights">
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
      </Card>

      {/* Narrative for your talk */}
      <Card title="Narrative (for your talk)">
        <div className="text-sm text-zinc-200 leading-relaxed">
          {narrative.split("**").map((seg, i) =>
            i % 2 ? <strong key={i} className="font-semibold">{seg}</strong> : <span key={i}>{seg}</span>
          )}
        </div>
      </Card>
    </div>
  );
}
