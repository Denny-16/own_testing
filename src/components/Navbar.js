import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { toggleSidebar, openAbout } from "../store/uiSlice";

export default function Navbar() {
  const dispatch = useDispatch();
  const { dataset } = useSelector((s) => s.ui);

  const label =
    dataset === "nifty50" ? "NIFTY 50" :
    dataset === "nasdaq" ? "NASDAQ" :
    dataset === "crypto" ? "Crypto" :
    "Select Dataset";

  return (
    <header className="w-full bg-[#0f1422] border-b border-zinc-800/70">
      <div className="h-14 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Hamburger for mobile */}
          <button
            className="lg:hidden p-2 rounded-lg bg-zinc-800/60"
            onClick={() => dispatch(toggleSidebar())}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <span className="text-sm text-zinc-400">Dataset:</span>
          <span className="text-sm font-medium">{label}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:block text-xs md:text-sm text-zinc-400">
            Quantum Portfolio Optimizer — QAOA
          </span>
          <button
            onClick={() => dispatch(openAbout())}
            className="text-xs md:text-sm px-3 py-2 rounded-xl border border-zinc-700/60 hover:bg-zinc-800/60 transition"
            aria-label="Open About"
          >
            About
          </button>
        </div>
      </div>
    </header>
  );
}
