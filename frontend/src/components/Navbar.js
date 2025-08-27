// src/components/Navbar.js
import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setActiveTab, setDataset, setRiskLevel } from "../store/uiSlice";

const TabBtn = ({ id, label, active, onClick }) => (
  <button
    onClick={() => onClick(id)}
    className={`px-3 md:px-4 py-2 rounded-lg text-sm transition ${
      active ? "bg-zinc-800/60" : "hover:bg-zinc-800/30"
    }`}
  >
    {label}
  </button>
);

export default function Navbar() {
  const dispatch = useDispatch();
  const { activeTab, dataset, riskLevel } = useSelector((s) => s.ui);

  const handleTab = (key) => dispatch(setActiveTab(key));

  return (
    <div className="sticky top-0 z-20 bg-[#0b0f1a]/80 backdrop-blur border-b border-zinc-800/60">
      <div className="max-w-7xl mx-auto px-5 py-3 flex flex-wrap items-center gap-3">
        {/* Left: Tabs */}
        <div className="flex items-center gap-2 bg-[#0f1422] border border-zinc-800/70 rounded-xl p-1">
          <TabBtn id={null} label="Home" active={activeTab === null} onClick={handleTab} />
          <TabBtn id="compare" label="Quantum vs Classical" active={activeTab === "compare"} onClick={handleTab} />
          <TabBtn id="evolution" label="Rebalancing" active={activeTab === "evolution"} onClick={handleTab} />
          <TabBtn id="stress" label="Stress Testing" active={activeTab === "stress"} onClick={handleTab} />
        </div>

        {/* Right: quick dataset + risk selectors */}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={dataset}
            onChange={(e) => dispatch(setDataset(e.target.value))}
            className="bg-[#0f1422] border border-zinc-800/70 rounded-lg px-3 py-2 text-sm"
          >
            <option value="nifty50">NIFTY 50</option>
            <option value="nasdaq">NASDAQ</option>
            <option value="crypto">Crypto</option>
          </select>

          <select
            value={riskLevel}
            onChange={(e) => dispatch(setRiskLevel(e.target.value))}
            className="bg-[#0f1422] border border-zinc-800/70 rounded-lg px-3 py-2 text-sm"
          >
            <option value="low">Low Risk</option>
            <option value="medium">Medium Risk</option>
            <option value="high">High Risk</option>
          </select>
        </div>
      </div>
    </div>
  );
}
