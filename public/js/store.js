/**
 * Persistent application state (localStorage) + a tiny event bus.
 * Journal, watchlist, alerts, settings and closed-trade records live here.
 */

import { uid } from "./util.js";

const NS = "td.v1.";

const DEFAULT_SETTINGS = {
  theme: "dark",
  baseCurrency: "GBP",
  defaultRiskPercent: 1,
  defaultSize: 1,
  confirmTrades: true,
  soundOn: true,
  pollSeconds: 5,
  chartType: "candles",
  defaultTimeframe: "MINUTE_15",
  chartEngine: "pro", // "pro" (Lightweight Charts) | "tv" (TradingView widget)
  indicators: [], // [{uid, type, params}]
  subIndicators: [], // [{uid, type, params}]
  showVolume: true,
  lastEpic: null,
  forceDemo: false,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch (err) {
    console.warn("storage write failed", key, err);
  }
}

const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}
export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}
export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error("listener error", event, err);
    }
  });
}

export const state = {
  settings: { ...DEFAULT_SETTINGS, ...read("settings", {}) },
  watchlist: read("watchlist", null),
  alerts: read("alerts", []),
  journal: read("journal", []),
  closed: read("closed", []),
  brokerStatus: null, // live-updated, not persisted
};

export const settings = {
  get: () => state.settings,
  set(patch) {
    Object.assign(state.settings, patch);
    write("settings", state.settings);
    emit("settings:changed", state.settings);
  },
  reset() {
    state.settings = { ...DEFAULT_SETTINGS };
    write("settings", state.settings);
    emit("settings:changed", state.settings);
  },
};
export { DEFAULT_SETTINGS };

/* --------------------------------- watchlist -------------------------------- */

export const watchlist = {
  list: () => state.watchlist || [],
  init(defaults) {
    if (!state.watchlist) {
      state.watchlist = defaults;
      write("watchlist", state.watchlist);
    }
    return state.watchlist;
  },
  has(epic) {
    return (state.watchlist || []).some((m) => m.epic === epic);
  },
  add(market) {
    if (this.has(market.epic)) return;
    state.watchlist = [...(state.watchlist || []), market];
    write("watchlist", state.watchlist);
    emit("watchlist:changed", state.watchlist);
  },
  remove(epic) {
    state.watchlist = (state.watchlist || []).filter((m) => m.epic !== epic);
    write("watchlist", state.watchlist);
    emit("watchlist:changed", state.watchlist);
  },
  move(epic, delta) {
    const list = state.watchlist || [];
    const idx = list.findIndex((m) => m.epic === epic);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const copy = [...list];
    const [item] = copy.splice(idx, 1);
    copy.splice(next, 0, item);
    state.watchlist = copy;
    write("watchlist", state.watchlist);
    emit("watchlist:changed", state.watchlist);
  },
};

/* ---------------------------------- alerts ---------------------------------- */

export const alerts = {
  list: () => state.alerts || [],
  add(alert) {
    const entry = {
      id: uid("alert"),
      createdAt: new Date().toISOString(),
      triggeredAt: null,
      active: true,
      ...alert,
    };
    state.alerts = [entry, ...state.alerts];
    write("alerts", state.alerts);
    emit("alerts:changed", state.alerts);
    return entry;
  },
  update(id, patch) {
    state.alerts = state.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a));
    write("alerts", state.alerts);
    emit("alerts:changed", state.alerts);
  },
  remove(id) {
    state.alerts = state.alerts.filter((a) => a.id !== id);
    write("alerts", state.alerts);
    emit("alerts:changed", state.alerts);
  },
  reset(id) {
    this.update(id, { active: true, triggeredAt: null });
  },
};

/* ---------------------------------- journal --------------------------------- */

function normalizeEntry(entry) {
  return {
    id: entry.id || uid("trade"),
    source: entry.source || "manual",
    dealId: entry.dealId || null,
    epic: entry.epic || "",
    symbol: entry.symbol || entry.instrumentName || entry.epic || "",
    direction: (entry.direction || "BUY").toUpperCase(),
    size: Number(entry.size ?? 1),
    entryPrice: Number(entry.entryPrice ?? entry.entry ?? 0),
    exitPrice: Number(entry.exitPrice ?? entry.exit ?? 0),
    stopPrice: entry.stopPrice ? Number(entry.stopPrice) : null,
    openTime: entry.openTime || new Date().toISOString(),
    closeTime: entry.closeTime || new Date().toISOString(),
    fees: Number(entry.fees ?? 0),
    pnl: Number(entry.pnl ?? 0),
    rMultiple: entry.rMultiple === undefined || entry.rMultiple === null || entry.rMultiple === ""
      ? null
      : Number(entry.rMultiple),
    riskAmount: entry.riskAmount ? Number(entry.riskAmount) : null,
    currency: entry.currency || state.settings.baseCurrency || "GBP",
    setup: entry.setup || "",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    notes: entry.notes || "",
    mistakes: Array.isArray(entry.mistakes) ? entry.mistakes : [],
    emotion: entry.emotion || "",
    grade: Number(entry.grade ?? 0),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export const journal = {
  list: () => state.journal || [],
  add(entry) {
    const normalized = normalizeEntry(entry);
    state.journal = [normalized, ...state.journal];
    write("journal", state.journal);
    emit("journal:changed", state.journal);
    return normalized;
  },
  update(id, patch) {
    state.journal = state.journal.map((e) =>
      e.id === id ? normalizeEntry({ ...e, ...patch, id }) : e,
    );
    write("journal", state.journal);
    emit("journal:changed", state.journal);
    return state.journal.find((e) => e.id === id);
  },
  remove(id) {
    state.journal = state.journal.filter((e) => e.id !== id);
    write("journal", state.journal);
    emit("journal:changed", state.journal);
  },
  clear() {
    state.journal = [];
    write("journal", state.journal);
    emit("journal:changed", state.journal);
  },
  import(entries, { dedupe = true } = {}) {
    let added = 0;
    for (const raw of entries) {
      const entry = normalizeEntry(raw);
      const dupe =
        dedupe &&
        state.journal.some(
          (e) =>
            (e.dealId && e.dealId === entry.dealId) ||
            (e.epic === entry.epic &&
              e.openTime === entry.openTime &&
              e.entryPrice === entry.entryPrice),
        );
      if (!dupe) {
        state.journal = [entry, ...state.journal];
        added += 1;
      }
    }
    write("journal", state.journal);
    emit("journal:changed", state.journal);
    return added;
  },
  byDealId(dealId) {
    return state.journal.find((e) => e.dealId === dealId);
  },
};

/* ------------------------------ closed trades ------------------------------- */

export const closed = {
  list: () => state.closed || [],
  add(trade) {
    // one record per broker dealId — auto-closure detection and the demo
    // broker can both report the same close
    if (trade.dealId) {
      const existing = state.closed.find((t) => t.dealId === trade.dealId);
      if (existing) return existing;
    }
    const entry = { id: uid("closed"), detectedAt: new Date().toISOString(), ...trade };
    state.closed = [entry, ...state.closed].slice(0, 500);
    write("closed", state.closed);
    return entry;
  },
  remove(id) {
    state.closed = (state.closed || []).filter((t) => t.id !== id);
    write("closed", state.closed);
  },
};

/* --------------------------------- demo data -------------------------------- */

export const demo = {
  get: () => read("demo", {}),
  set(patch) {
    const next = { ...read("demo", {}), ...patch };
    write("demo", next);
    return next;
  },
  reset() {
    localStorage.removeItem(NS + "demo");
    emit("demo:reset");
  },
};

export function exportAll() {
  return {
    app: "TradingDesk",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    watchlist: state.watchlist,
    alerts: state.alerts,
    journal: state.journal,
    closed: state.closed,
  };
}

export function importAll(data) {
  if (!data || data.app !== "TradingDesk") throw new Error("Not a TradingDesk export file");
  if (data.settings) settings.set(data.settings);
  if (Array.isArray(data.watchlist)) {
    state.watchlist = data.watchlist;
    write("watchlist", state.watchlist);
    emit("watchlist:changed", state.watchlist);
  }
  if (Array.isArray(data.alerts)) {
    state.alerts = data.alerts;
    write("alerts", state.alerts);
    emit("alerts:changed", state.alerts);
  }
  if (Array.isArray(data.journal)) {
    state.journal = data.journal.map(normalizeEntry);
    write("journal", state.journal);
    emit("journal:changed", state.journal);
  }
  if (Array.isArray(data.closed)) {
    state.closed = data.closed;
    write("closed", state.closed);
  }
}
