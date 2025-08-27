import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

/* ---------- ENV (Parcel) ---------- */
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

/* ---------- Helpers: map UI -> backend payload (Mode A) ---------- */
const datasetMap = {
  nifty50: "NIFTY50",
  nasdaq: "NASDAQ100",
  nasdaq100: "NASDAQ100",
  crypto: "CRYPTO50",
  crypto50: "CRYPTO50",
};

export function buildOptimizePayload(ui) {
  return {
    mode: "dataset",
    dataset: datasetMap[ui.dataset] || "NIFTY50",
    timeHorizon: Number(ui.timeHorizon) || 15,
    riskLevel: ui.riskLevel || "medium",
    budget: Number(ui.initialEquity) || 100000, // total_investment
    maxAssets: Math.max(1, Math.floor(Number(ui.maxAssets) || 5)), // number of assets to pick
    objective: "sharpe",
    qaoaParams: {},
    constraints: {
      // optional knobs (kept for future, currently not used by FastAPI)
      minWeight: (Number(ui.threshold) || 0) / 100,
      maxWeight: 1,
    },
    include: Array.isArray(ui.options) ? ui.options : [],
    exclude: [],
  };
}

/* ---------- Async thunk to call backend ---------- */
export const runOptimizeThunk = createAsyncThunk(
  "ui/runOptimize",
  async (_, { getState, rejectWithValue }) => {
    const { ui } = getState();
    const payload = buildOptimizePayload(ui);

    try {
      const resp = await fetch(`${API_BASE_URL}/api/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const msg =
          err?.details?.join?.(", ") ||
          err?.details ||
          err?.error ||
          `Request failed: ${resp.status}`;
        return rejectWithValue(msg);
      }

      const data = await resp.json(); // normalized shape from backend
      return data;
    } catch (e) {
      return rejectWithValue(e?.message || "Network error");
    }
  }
);

/* ---------- Load saved UI ---------- */
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem("ui") || "{}");
  } catch {
    return {};
  }
})();

/* ---------- Initial state ---------- */
const initialState = {
  // core
  dataset: saved.dataset ?? "nifty50",
  riskLevel: saved.riskLevel ?? "medium", // 'low' | 'medium' | 'high'
  options: saved.options ?? [],

  // tunables
  initialEquity: saved.initialEquity ?? 108000, // total_investment
  timeHorizon: saved.timeHorizon ?? 15,         // (kept for charts)
  threshold: saved.threshold ?? 0,              // %

  // NEW: FastAPI input — number of assets to select
  maxAssets: saved.maxAssets ?? 5,

  // nav
  activeTab: saved.activeTab ?? null, // null = Home, else 'compare'|'evolution'|'insights'|'stress'|'explain'

  // ui
  isAboutOpen: false,
  toasts: [],

  // optimize call state
  optimizeStatus: "idle", // 'idle' | 'loading' | 'succeeded' | 'failed'
  optimizeResult: null,   // normalized JSON from backend
  optimizeError: null,    // string
};

let toastId = 1;

/* ---------- Slice ---------- */
const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    // nav toggle: clicking same tab goes back to Home
    setActiveTab: (s, a) => {
      const next = a.payload;
      s.activeTab = s.activeTab === next ? null : next;
    },

    // basic filters
    setDataset: (s, a) => {
      s.dataset = a.payload;
    },
    setRiskLevel: (s, a) => {
      s.riskLevel = a.payload; // 'low'|'medium'|'high'
    },
    setOptions: (s, a) => {
      s.options = a.payload;
    },

    // tunables
    setInitialEquity: (s, a) => {
      s.initialEquity = Number(a.payload) || 0;
    },
    setTimeHorizon: (s, a) => {
      s.timeHorizon = Math.max(1, Number(a.payload) || 1);
    },
    setThreshold: (s, a) => {
      s.threshold = Math.max(0, Math.min(100, Number(a.payload) || 0));
    },

    // NEW: FastAPI "budget" (count of assets)
    setMaxAssets: (s, a) => {
      const v = Math.max(1, Math.floor(Number(a.payload) || 1));
      s.maxAssets = v;
    },

    // about + toasts
    openAbout: (s) => {
      s.isAboutOpen = true;
    },
    closeAbout: (s) => {
      s.isAboutOpen = false;
    },
    addToast: (s, a) => {
      s.toasts.push({
        id: toastId++,
        type: a.payload?.type ?? "info",
        msg: a.payload?.msg ?? "",
      });
    },
    removeToast: (s, a) => {
      s.toasts = s.toasts.filter((t) => t.id !== a.payload);
    },

    // allow clearing results if user changes inputs
    clearOptimizeResult: (s) => {
      s.optimizeResult = null;
      s.optimizeError = null;
      s.optimizeStatus = "idle";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(runOptimizeThunk.pending, (s) => {
        s.optimizeStatus = "loading";
        s.optimizeError = null;
      })
      .addCase(runOptimizeThunk.fulfilled, (s, a) => {
        s.optimizeStatus = "succeeded";
        s.optimizeResult = a.payload;
        s.optimizeError = null;
        s.toasts.push({ id: toastId++, type: "success", msg: "Optimization complete" });
      })
      .addCase(runOptimizeThunk.rejected, (s, a) => {
        s.optimizeStatus = "failed";
        s.optimizeError = a.payload || "Failed to optimize";
        s.toasts.push({ id: toastId++, type: "error", msg: s.optimizeError });
      });
  },
});

export const {
  setActiveTab,
  setDataset,
  setRiskLevel,
  setOptions,
  setInitialEquity,
  setTimeHorizon,
  setThreshold,
  setMaxAssets, // NEW
  openAbout,
  closeAbout,
  addToast,
  removeToast,
  clearOptimizeResult,
} = uiSlice.actions;

export default uiSlice.reducer;

/* ---------- Persist select fields ---------- */
export const uiMiddleware = (store) => (next) => (action) => {
  const res = next(action);
  const { ui } = store.getState();
  const persist = {
    dataset: ui.dataset,
    riskLevel: ui.riskLevel,
    options: ui.options,
    initialEquity: ui.initialEquity,
    timeHorizon: ui.timeHorizon,
    threshold: ui.threshold,
    activeTab: ui.activeTab,
    maxAssets: ui.maxAssets, // NEW
  };
  try {
    localStorage.setItem("ui", JSON.stringify(persist));
  } catch {}
  return res;
};
