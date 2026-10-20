/**
 * Application entry point.
 *
 * Boots the shell (theme, watchlist defaults, header telemetry), routes the
 * header tabs to their modules, and runs the polling loops that keep quotes,
 * price alerts, positions and the account pill fresh.
 */

import { $, fmt, toast } from "./util.js";
import * as api from "./api.js";
import { settings, watchlist, alerts, on } from "./store.js";
import * as tradeTab from "./tabs/trade.js";
import * as watchlistTab from "./tabs/watchlist.js";
import * as journalTab from "./tabs/journal.js";
import * as analyticsTab from "./tabs/analytics.js";
import * as settingsTab from "./tabs/settings.js";

/* ================================== tabs ================================== */

const TABS = {
  trade: {
    render: (c) => tradeTab.renderTrade(c),
    activate: () => tradeTab.activateTrade(),
  },
  watchlist: {
    render: (c) => watchlistTab.renderWatchlistTab(c),
  },
  journal: {
    render: (c) => journalTab.renderJournalTab(c),
  },
  analytics: {
    render: (c) => analyticsTab.renderAnalyticsTab(c),
  },
  settings: {
    render: (c) => settingsTab.renderSettingsTab(c),
  },
};

const renderedTabs = new Set();
let activeTab = "trade";

function switchTab(name, { pushHash = true } = {}) {
  if (!TABS[name]) name = "trade";
  activeTab = name;

  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === name);
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false");
  }
  for (const section of document.querySelectorAll(".app-main .tab")) {
    const isActive = section.id === `tab-${name}`;
    section.classList.toggle("active", isActive);
    section.hidden = !isActive;
  }

  const container = document.getElementById(`tab-${name}`);
  if (container && !renderedTabs.has(name)) {
    renderedTabs.add(name);
    try {
      TABS[name].render(container);
    } catch (err) {
      console.error(`failed to render ${name} tab`, err);
      container.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><h3>Tab failed to load</h3><p>${err.message}</p></div>`;
    }
  } else {
    TABS[name].activate?.();
    // nudge layout-sensitive widgets (charts) that were hidden while inactive
    window.dispatchEvent(new Event("resize"));
  }

  if (pushHash && location.hash !== `#${name}`) {
    history.replaceState(null, "", `#${name}`);
  }
}

function wireTabs() {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  }
  window.addEventListener("hashchange", () => {
    const name = location.hash.replace("#", "");
    if (name && name !== activeTab) switchTab(name, { pushHash: false });
  });
}

/* ================================= header ================================= */

function startClock() {
  const clock = $("#clock");
  const tick = () => {
    if (clock) clock.textContent = new Date().toLocaleTimeString("en-GB");
  };
  tick();
  setInterval(tick, 1000);
}

function setConn(state, text) {
  const dot = $("#conn-dot");
  const label = $("#conn-text");
  if (dot) dot.className = `conn-dot ${state}`;
  if (label) label.textContent = text;
}

function updateModePill() {
  const pill = $("#mode-pill");
  if (pill) pill.textContent = api.modeLabel();
}

async function updateAccountPill() {
  try {
    const accounts = await api.getAccounts();
    const acc = api.preferredAccount(accounts);
    if (!acc) return;
    const b = acc.balance || {};
    const balance = Number(b.balance ?? 0);
    const upl = Number(b.profitLoss ?? 0);
    const ccy = acc.currency || settings.get().baseCurrency;
    const balanceEl = $("#acc-balance");
    const equityEl = $("#acc-equity");
    const uplEl = $("#acc-upl");
    if (balanceEl) balanceEl.textContent = fmt.money(balance, ccy);
    if (equityEl) equityEl.textContent = fmt.money(balance + upl, ccy);
    if (uplEl) {
      uplEl.textContent = fmt.money(upl, ccy);
      uplEl.className = upl >= 0 ? "up" : "down";
    }
  } catch {
    /* pill keeps its last value */
  }
}

function updateAlertBadge() {
  const badge = $("#alert-badge");
  if (!badge) return;
  const count = alerts.list().filter((a) => a.triggeredAt).length;
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

/* ================================== sound ================================= */

let audioCtx = null;
function beep() {
  if (!settings.get().soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    for (const [freq, start] of [[880, 0], [1320, 0.12]]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, t + start);
      gain.gain.exponentialRampToValueAtTime(0.16, t + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + start + 0.11);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t + start);
      osc.stop(t + start + 0.13);
    }
  } catch {
    /* audio not available */
  }
}

/* =============================== polling loop ============================= */

const MIN_POLL_MS = 2000;
let pollTimer = null;
let tickBusy = false;

function pollIntervalMs() {
  const secs = Number(settings.get().pollSeconds) || 5;
  return Math.max(MIN_POLL_MS, secs * 1000);
}

function startPolling() {
  stopPolling();
  tick(); // immediate first pass
  pollTimer = setInterval(tick, pollIntervalMs());
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function collectEpics() {
  const epics = new Set();
  for (const m of watchlist.list()) epics.add(m.epic);
  for (const pos of tradeTab.getPositionsCache?.() || []) {
    const epic = pos.market?.epic || pos.position?.epic;
    if (epic) epics.add(epic);
  }
  return [...epics];
}

/** Detect positions that vanished since the previous poll and log them. */
const knownPositions = new Map();

function detectClosures() {
  const current = tradeTab.getPositionsCache?.() || [];
  const currentIds = new Set();
  for (const pos of current) {
    const p = pos.position;
    const m = pos.market || {};
    if (!p?.dealId) continue;
    currentIds.add(p.dealId);
    knownPositions.set(p.dealId, {
      dealId: p.dealId,
      epic: m.epic || p.epic || "",
      instrumentName: m.instrumentName || p.instrumentName || m.epic || p.epic || "",
      direction: p.direction,
      size: p.size,
      entry: p.level,
      currency: p.currency,
      openTime: p.createdDate,
      lastUpl: p.upl ?? 0,
    });
  }
  for (const [dealId, snap] of [...knownPositions]) {
    if (currentIds.has(dealId)) continue;
    knownPositions.delete(dealId);
    const dir = snap.direction === "BUY" ? 1 : -1;
    const exit = snap.entry + (Number(snap.lastUpl) || 0) / (Number(snap.size) || 1) / dir;
    api.recordClosure({
      dealId: snap.dealId,
      epic: snap.epic,
      instrumentName: snap.instrumentName,
      direction: snap.direction,
      size: snap.size,
      entry: snap.entry,
      exit,
      openTime: snap.openTime,
      closeTime: new Date().toISOString(),
      pnl: snap.lastUpl ?? 0,
      currency: snap.currency,
      reason: "MANUAL",
      source: api.isDemoMode() ? "demo" : "capital",
    });
  }
}

function checkAlerts(quotes) {
  const byEpic = new Map(quotes.map((q) => [q.epic, q]));
  for (const a of alerts.list()) {
    if (!a.active || a.triggeredAt) continue;
    const q = byEpic.get(a.epic);
    if (!q) continue;
    const mid = (q.bid + q.offer) / 2;
    const hit = a.condition === "above" ? mid >= a.price : mid <= a.price;
    if (!hit) continue;
    alerts.update(a.id, { active: false, triggeredAt: new Date().toISOString() });
    toast(
      `🔔 Alert: ${a.symbol || a.epic} ${a.condition} ${fmt.price(a.price)} — now ${fmt.price(mid)}`,
      "warn",
      8000,
    );
    beep();
    updateAlertBadge();
  }
}

async function tick() {
  if (tickBusy || document.hidden) return;
  tickBusy = true;
  try {
    // 1. simulated broker: evaluate stops/targets and working orders
    if (api.isDemoMode()) {
      const closed = api.demoSync() || [];
      for (const t of closed) {
        api.recordClosure(t);
        toast(
          `Position closed (${t.reason}): ${t.instrumentName || t.epic} ${fmt.money(t.pnl, t.currency)}`,
          (t.pnl ?? 0) >= 0 ? "success" : "warn",
          7000,
        );
        beep();
      }
    }

    // 2. quotes for watchlist + open positions
    const epics = collectEpics();
    if (epics.length) {
      const quotes = await api.getQuotes(epics);
      tradeTab.updateQuotes(quotes);
      watchlistTab.updateQuotes(quotes);
      checkAlerts(quotes);
    }

    // 3. broker state + header telemetry
    await tradeTab.refreshBroker();
    detectClosures();
    updateAccountPill();
    updateAlertBadge();

    setConn(
      api.isDemoMode() ? "sim" : "live",
      api.isDemoMode() ? "simulated feed" : `connected · ${(api.modeLabel().split(" ").pop() || "").toLowerCase()}`,
    );
    updateModePill();
  } catch (err) {
    setConn("down", "connection problem");
    console.warn("poll tick failed", err);
  } finally {
    tickBusy = false;
  }
}

/* ================================== boot ================================== */

function applyTheme() {
  document.documentElement.dataset.theme = settings.get().theme || "dark";
}

async function boot() {
  applyTheme();
  watchlist.init(api.defaultWatchlist());
  wireTabs();
  startClock();

  on("settings:changed", (s) => {
    applyTheme();
    if (s?.pollSeconds !== undefined) startPolling();
  });
  on("alerts:changed", updateAlertBadge);
  on("demo:reset", () => {
    knownPositions.clear();
    tick();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });

  switchTab(location.hash.replace("#", "") || "trade", { pushHash: false });

  setConn("sim", "connecting…");
  await api.getStatus();
  updateModePill();
  setConn(
    api.isDemoMode() ? "sim" : "live",
    api.isDemoMode() ? "simulated feed" : `connected · ${(api.modeLabel().split(" ").pop() || "").toLowerCase()}`,
  );
  updateAccountPill();
  updateAlertBadge();

  startPolling();
}

boot().catch((err) => {
  console.error("boot failed", err);
  setConn("down", "failed to start");
  toast(`App failed to start: ${err.message}`, "error", 10000);
});
