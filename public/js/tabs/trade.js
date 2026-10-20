/**
 * Trade tab: the trading terminal.
 * Left: symbol search + watchlist. Center: chart workspace. Right: deal ticket.
 * Bottom: open positions / working orders / account / recent activity.
 */

import { $, el, fmt, toast, modal, confirmDialog, debounce, currencySymbol } from "../util.js";
import { ChartPanel } from "../chart.js";
import { INDICATORS, defaultParams } from "../indicators.js";
import { RESOLUTION_LABELS } from "../demo.js";
import * as api from "../api.js";
import { settings, journal, watchlist as wlStore, closed as closedStore, on } from "../store.js";

const TIMEFRAMES = ["MINUTE", "MINUTE_5", "MINUTE_15", "MINUTE_30", "HOUR", "HOUR_4", "DAY", "WEEK"];

let root = null;
let chart = null;
let currentEpic = null;
let currentQuote = null;
let currentMarket = null;
let candles = [];
let overlayIndicators = [];
let subIndicators = [];
let positionsCache = [];
let ordersCache = [];
let accountCache = null;
let bottomTab = "positions";
const quoteCache = new Map();

const ticket = {
  side: "BUY",
  orderType: "MARKET",
  size: 1,
  entryLevel: null,
  slMode: "distance", // distance | level | off
  slValue: null,
  tpMode: "off",
  tpValue: null,
  guaranteed: false,
  trailing: false,
};

/* ============================== DOM construction ============================ */

export function renderTrade(container) {
  root = container;
  const s = settings.get();
  overlayIndicators = s.indicators || [];
  subIndicators = s.subIndicators || [];

  container.innerHTML = "";
  container.classList.add("trade-layout");

  /* ---- left sidebar: search + watchlist ---- */
  const searchInput = el("input", {
    class: "input",
    placeholder: "Search markets… (e.g. Gold, EURUSD, Apple)",
    oninput: debounce((e) => runSearch(e.target.value), 260),
    onfocus: (e) => runSearch(e.target.value),
  });
  const results = el("div", { class: "wl-results", hidden: true });
  const wlList = el("div", { id: "trade-wl-list" });

  const sidebar = el("aside", { class: "panel trade-sidebar" }, [
    el("div", { class: "wl-search" }, [searchInput, results]),
    el("div", { class: "panel-head" }, [
      el("h3", { text: "Watchlist" }),
      el("div", { class: "spacer" }),
      el("button", {
        class: "btn btn-sm btn-ghost",
        text: "＋",
        title: "Open Watchlist tab",
        onclick: () => document.querySelector('[data-tab="watchlist"]').click(),
      }),
    ]),
    el("div", { class: "panel-body no-pad" }, [wlList]),
  ]);

  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== searchInput) results.hidden = true;
  });

  async function runSearch(term) {
    try {
      const markets = await api.searchMarkets(term || "");
      results.innerHTML = "";
      results.hidden = false;
      const list = markets.slice(0, 30);
      if (!list.length) {
        results.append(el("div", { class: "wl-result dim", text: "No markets found" }));
        return;
      }
      for (const m of list) {
        results.append(
          el("button", { class: "wl-result", onclick: () => { results.hidden = true; selectSymbol(m.epic); } }, [
            el("span", {}, [
              el("div", { text: m.instrumentName || m.name || m.epic }),
              el("div", { class: "faint", text: `${m.epic} · ${m.instrumentType || ""}` }),
            ]),
            el("span", { class: "mono", text: fmt.price(m.bid) }),
          ]),
        );
      }
    } catch (err) {
      results.innerHTML = "";
      results.append(el("div", { class: "wl-result down", text: err.message }));
    }
  }

  /* ---- center: symbol strip + chart + bottom panel ---- */
  const strip = el("div", { class: "symbol-strip", id: "symbol-strip" });
  const chartHost = el("div", { id: "chart-host" });
  const chartToolbar = el("div", { class: "chart-toolbar" });

  const bottomBody = el("div", { class: "panel-body no-pad", id: "bottom-body" });
  const bottomTabs = el("div", { class: "sub-tabs" });
  for (const [id, label] of [
    ["positions", "Open Positions"],
    ["orders", "Working Orders"],
    ["account", "Account"],
    ["activity", "Activity"],
  ]) {
    bottomTabs.append(
      el("button", {
        class: `sub-tab ${id === bottomTab ? "active" : ""}`,
        text: label,
        dataset: { bottom: id },
        onclick: () => {
          bottomTab = id;
          bottomTabs.querySelectorAll(".sub-tab").forEach((b) => b.classList.toggle("active", b.dataset.bottom === id));
          renderBottom();
        },
      }),
    );
  }

  const center = el("div", { class: "trade-center" }, [
    strip,
    el("div", { class: "chart-panel" }, [chartToolbar, chartHost]),
    el("div", { class: "panel bottom-panel" }, [
      el("div", { class: "panel-head" }, [bottomTabs, el("div", { class: "spacer" }),
        el("button", { class: "btn btn-sm btn-ghost", text: "Refresh", onclick: () => refreshBroker(true) })]),
      bottomBody,
    ]),
  ]);

  /* ---- right: order ticket ---- */
  const ticketPanel = el("aside", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Order Ticket" }), el("div", { class: "spacer" }), el("span", { class: "faint", id: "ticket-symbol", text: "—" })]),
    el("div", { class: "panel-body", id: "ticket-body" }),
  ]);

  container.append(sidebar, center, ticketPanel);

  /* ---- chart ---- */
  chart = new ChartPanel(chartHost, {
    theme: s.theme,
    resolution: s.defaultTimeframe,
  });
  chart.setShowVolume(s.showVolume);
  chart.setIndicators(allIndicators());
  buildChartToolbar(chartToolbar);
  renderTicket();
  renderSymbolStrip();
  renderWatchlist();
  renderBottom();

  on("watchlist:changed", renderWatchlist);
  on("settings:changed", (next) => {
    if (chart) chart.setTheme(next.theme);
    renderTicket();
  });

  selectSymbol(s.lastEpic || "IX.D.FTSE.DAILY.IP");
}

function allIndicators() {
  return [...overlayIndicators, ...subIndicators];
}

function persistIndicators() {
  settings.set({ indicators: overlayIndicators, subIndicators });
  if (chart) chart.setIndicators(allIndicators());
  refreshIndicatorChips();
}

/* =============================== chart toolbar ============================= */

function buildChartToolbar(toolbar) {
  toolbar.innerHTML = "";

  const typeSeg = el("div", { class: "seg", style: { width: "150px" } });
  for (const [type, label] of [["candles", "Candles"], ["bars", "Bars"], ["line", "Line"], ["area", "Area"]]) {
    typeSeg.append(
      el("button", {
        text: label,
        class: settings.get().chartType === type ? "active" : "",
        onclick: (e) => {
          settings.set({ chartType: type });
          chart.setChartType(type);
          typeSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");
        },
      }),
    );
  }

  const engineSeg = el("div", { class: "seg", style: { width: "180px" } });
  for (const [engine, label] of [["pro", "Desk Chart"], ["tv", "TradingView Widget"]]) {
    engineSeg.append(
      el("button", {
        text: label,
        class: settings.get().chartEngine === engine ? "active" : "",
        onclick: (e) => {
          settings.set({ chartEngine: engine });
          chart.setEngine(engine);
          engineSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");
        },
      }),
    );
  }

  const indBtn = el("button", { class: "btn btn-sm", text: "ƒx  Indicators" });
  const chips = el("div", { class: "active-indicators", id: "ind-chips" });
  indBtn.addEventListener("click", () => openIndicatorMenu(indBtn));

  toolbar.append(typeSeg, engineSeg, indBtn, el("div", { class: "spacer" }), chips);
  refreshIndicatorChips();
}

function refreshIndicatorChips() {
  const chips = document.getElementById("ind-chips");
  if (!chips) return;
  chips.innerHTML = "";
  for (const ind of allIndicators()) {
    const def = INDICATORS[ind.type];
    if (!def) continue;
    chips.append(
      el("span", { class: "ind-chip" }, [
        el("span", { text: def.name }),
        el("button", {
          text: "⚙",
          title: "Settings",
          onclick: () => openIndicatorSettings(ind),
        }),
        el("button", {
          text: "×",
          title: "Remove",
          onclick: () => {
            overlayIndicators = overlayIndicators.filter((i) => i.uid !== ind.uid);
            subIndicators = subIndicators.filter((i) => i.uid !== ind.uid);
            persistIndicators();
          },
        }),
      ]),
    );
  }
}

function openIndicatorMenu(anchor) {
  document.querySelectorAll(".indicator-menu").forEach((m) => m.remove());
  const menu = el("div", { class: "indicator-menu" });
  const search = el("input", {
    class: "input",
    placeholder: "Search indicators…",
    oninput: (e) => renderList(e.target.value),
  });
  const list = el("div");
  menu.append(search, list);

  function renderList(term = "") {
    list.innerHTML = "";
    const needle = term.trim().toLowerCase();
    const cats = new Map();
    for (const def of Object.values(INDICATORS)) {
      if (def.id === "volume") continue;
      if (needle && !def.name.toLowerCase().includes(needle) && !def.category.toLowerCase().includes(needle)) continue;
      if (!cats.has(def.category)) cats.set(def.category, []);
      cats.get(def.category).push(def);
    }
    for (const [cat, defs] of cats) {
      list.append(el("div", { class: "ind-menu-cat", text: cat }));
      for (const def of defs) {
        const first = def.outputs[0];
        const color = first?.color || "#26c6da";
        list.append(
          el("button", {
            class: "ind-menu-item",
            onclick: () => {
              const entry = { uid: `${def.id}_${Date.now().toString(36)}`, type: def.id, params: defaultParams(def) };
              if (def.pane === "sub") {
                if (subIndicators.length >= 3) {
                  toast("Maximum 3 sub-panes — remove one first", "warn");
                  return;
                }
                subIndicators.push(entry);
              } else {
                overlayIndicators.push(entry);
              }
              persistIndicators();
              menu.remove();
              toast(`${def.name} added`, "success");
            },
          }, [
            el("span", { class: "dot", style: { background: color } }),
            el("span", { text: def.name }),
            el("span", { class: "spacer", style: { flex: 1 } }),
            el("span", { class: "faint", text: def.pane === "sub" ? "pane" : "overlay" }),
          ]),
        );
      }
    }
    if (!list.children.length) list.append(el("div", { class: "ind-menu-cat", text: "No matches" }));
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 350)}px`;
  menu.style.position = "fixed";
  document.body.append(menu);
  renderList();
  setTimeout(() => {
    const closer = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener("mousedown", closer);
      }
    };
    document.addEventListener("mousedown", closer);
    search.focus();
  }, 30);
}

function openIndicatorSettings(ind) {
  const def = INDICATORS[ind.type];
  if (!def) return;
  const body = el("div");
  const inputs = new Map();
  for (const p of def.params) {
    const input = el("input", {
      class: "input",
      type: p.type === "number" ? "number" : "text",
      value: ind.params[p.key] ?? p.default,
      min: p.min,
      max: p.max,
      step: p.step || "any",
    });
    inputs.set(p.key, input);
    body.append(el("div", { class: "field" }, [el("label", { text: p.label }), input]));
  }
  if (!def.params.length) body.append(el("p", { class: "hint", text: "This indicator has no adjustable parameters." }));
  modal({
    title: `${def.name} settings`,
    body,
    actions: [
      { label: "Cancel", class: "btn-ghost" },
      {
        label: "Apply",
        class: "btn-primary",
        onClick: () => {
          const params = {};
          for (const [key, input] of inputs) params[key] = Number.isNaN(parseFloat(input.value)) ? input.value : parseFloat(input.value);
          ind.params = { ...ind.params, ...params };
          persistIndicators();
          toast(`${def.name} updated`, "success");
        },
      },
    ],
  });
}

/* =============================== symbol strip ============================== */

function renderSymbolStrip() {
  const strip = document.getElementById("symbol-strip");
  if (!strip) return;
  const q = currentQuote;
  const spread = q ? q.offer - q.bid : null;
  const chg = q?.percentageChange ?? 0;
  strip.innerHTML = "";

  const tfGroup = el("div", { class: "tf-group" });
  for (const tf of TIMEFRAMES) {
    tfGroup.append(
      el("button", {
        class: `tf-btn ${settings.get().defaultTimeframe === tf ? "active" : ""}`,
        text: RESOLUTION_LABELS[tf],
        onclick: (e) => {
          settings.set({ defaultTimeframe: tf });
          tfGroup.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");
          loadCandles();
        },
      }),
    );
  }

  strip.append(
    el("div", { class: "symbol-name" }, [
      el("strong", { text: q?.instrumentName || currentEpic || "—" }),
      el("span", { text: currentEpic || "" }),
    ]),
    el("div", { class: "symbol-price" }, [
      el("b", { id: "strip-price", text: q ? fmt.price((q.bid + q.offer) / 2) : "—" }),
      el("span", {
        id: "strip-change",
        class: chg >= 0 ? "up" : "down",
        text: q ? `${fmt.pct(chg)}  ·  spread ${fmt.price(spread)}` : "",
      }),
    ]),
    el("div", { class: "spacer" }),
    el("div", { class: "stat-strip", id: "sentiment-box" }, [
      el("div", { class: "stat" }, [el("em", { text: "Session" }), el("b", { id: "strip-session", text: q?.marketStatus || "—" })]),
    ]),
    tfGroup,
    el("button", {
      class: "btn btn-sm",
      text: wlStore.has(currentEpic) ? "★ In watchlist" : "☆ Watch",
      onclick: (e) => {
        if (wlStore.has(currentEpic)) {
          wlStore.remove(currentEpic);
          e.target.textContent = "☆ Watch";
        } else if (currentQuote) {
          wlStore.add({ epic: currentEpic, instrumentName: currentQuote.instrumentName, instrumentType: currentQuote.instrumentType, currency: currentQuote.currency });
          e.target.textContent = "★ In watchlist";
        }
      },
    }),
  );
  loadSentiment();
}

async function loadSentiment() {
  const box = document.getElementById("sentiment-box");
  if (!box || !currentEpic) return;
  try {
    const [sent] = await api.getSentiment([currentEpic]);
    if (!sent) return;
    const stat = el("div", { class: "stat" }, [
      el("em", { text: "Client sentiment" }),
      el("b", { text: `${sent.longPositionPercentage.toFixed(0)}% long` }),
    ]);
    const existing = box.querySelector("[data-sentiment]");
    if (existing) existing.remove();
    stat.dataset.sentiment = "1";
    box.prepend(stat);
  } catch {
    /* sentiment is optional */
  }
}

/* ================================== chart ================================= */

async function loadCandles() {
  if (!currentEpic) return;
  const resolution = settings.get().defaultTimeframe;
  try {
    candles = await api.getPrices(currentEpic, resolution, 400);
    chart.setResolution(resolution);
    chart.setData(candles);
    chart.setChartType(settings.get().chartType);
    if (settings.get().chartEngine === "tv") chart.setEngine("tv");
    else chart.setEngine("pro");
    drawTradeAnnotations();
  } catch (err) {
    toast(`Chart data failed: ${err.message}`, "error");
  }
}

function drawTradeAnnotations() {
  if (!chart || !candles.length) return;
  const first = candles[0].time;
  const markers = [];
  for (const t of closedStore.list()) {
    if (t.epic !== currentEpic) continue;
    const entryTime = Math.floor(new Date(t.openTime).getTime() / 1000);
    const exitTime = Math.floor(new Date(t.closeTime).getTime() / 1000);
    if (entryTime >= first) {
      markers.push({
        time: entryTime,
        position: t.direction === "BUY" ? "belowBar" : "aboveBar",
        color: t.direction === "BUY" ? "#26a69a" : "#ef5350",
        shape: t.direction === "BUY" ? "arrowUp" : "arrowDown",
        text: `OPEN ${t.direction}`,
      });
    }
    if (exitTime >= first) {
      markers.push({
        time: exitTime,
        position: t.direction === "BUY" ? "aboveBar" : "belowBar",
        color: (t.pnl ?? 0) >= 0 ? "#00e676" : "#ef5350",
        shape: "circle",
        text: `CLOSE ${fmt.money(t.pnl, t.currency)}`,
      });
    }
  }
  markers.sort((a, b) => a.time - b.time);
  chart.setMarkers(markers);

  const lines = [];
  for (const pos of positionsCache) {
    const p = pos.position;
    const m = pos.market;
    if (m.epic !== currentEpic) continue;
    lines.push({ price: p.level, color: "#26c6da", title: `Entry ${p.direction} ${p.size}` });
    if (p.stopLevel) lines.push({ price: p.stopLevel, color: "#ef5350", title: "Stop loss", style: 2 });
    if (p.profitLevel) lines.push({ price: p.profitLevel, color: "#26a69a", title: "Take profit", style: 2 });
  }
  chart.setPriceLines(lines);
}

/* =============================== symbol select ============================= */

export async function selectSymbol(epic) {
  currentEpic = epic;
  settings.set({ lastEpic: epic });
  try {
    const detail = await api.getMarket(epic);
    currentMarket = detail?.instrument || detail;
  } catch {
    currentMarket = null;
  }
  const quotes = await api.getQuotes([epic]).catch(() => []);
  currentQuote = quotes[0] || quoteCache.get(epic) || null;
  if (currentQuote) quoteCache.set(epic, currentQuote);
  if (chart) chart.setSymbol(epic, currentMarket?.name);
  renderSymbolStrip();
  renderTicket();
  await loadCandles();
  renderWatchlist();
}

export function updateQuotes(quotes) {
  const byEpic = new Map(quotes.map((q) => [q.epic, q]));
  for (const q of quotes) quoteCache.set(q.epic, q);
  const q = byEpic.get(currentEpic);
  if (q) {
    currentQuote = q;
    const priceEl = document.getElementById("strip-price");
    const changeEl = document.getElementById("strip-change");
    if (priceEl) priceEl.textContent = fmt.price((q.bid + q.offer) / 2);
    if (changeEl) {
      changeEl.textContent = `${fmt.pct(q.percentageChange)}  ·  spread ${fmt.price(q.offer - q.bid)}`;
      changeEl.className = q.percentageChange >= 0 ? "up" : "down";
    }
    const sessionEl = document.getElementById("strip-session");
    if (sessionEl) sessionEl.textContent = q.marketStatus || "—";
    // live-update the forming candle
    if (candles.length && chart) {
      const last = { ...candles[candles.length - 1] };
      const mid = (q.bid + q.offer) / 2;
      last.close = mid;
      last.high = Math.max(last.high, mid);
      last.low = Math.min(last.low, mid);
      candles[candles.length - 1] = last;
      chart.updateLast(last);
    }
    updateTicketQuotes();
  }
  renderWatchlistRows(byEpic);
}

/* ================================= watchlist =============================== */

function renderWatchlist() {
  renderWatchlistRows();
}

function renderWatchlistRows(byEpic = null) {
  const list = document.getElementById("trade-wl-list");
  if (!list) return;
  list.innerHTML = "";
  for (const m of wlStore.list()) {
    const q = byEpic?.get(m.epic) || quoteCache.get(m.epic) || (currentQuote?.epic === m.epic ? currentQuote : null);
    const price = q ? fmt.price((q.bid + q.offer) / 2) : "…";
    const chg = q?.percentageChange ?? 0;
    list.append(
      el("button", { class: `wl-row ${m.epic === currentEpic ? "active" : ""}`, onclick: () => selectSymbol(m.epic) }, [
        el("span", {}, [
          el("div", { class: "wl-name", text: m.instrumentName || m.epic }),
          el("div", { class: "wl-sub", text: m.instrumentType || "" }),
        ]),
        el("span", { class: "wl-price", text: price }),
        el("span", { class: `wl-chg ${chg >= 0 ? "up" : "down"}`, text: q ? fmt.pct(chg, 2) : "" }),
      ]),
    );
  }
}

/* ================================ order ticket ============================= */

function renderTicket() {
  const body = document.getElementById("ticket-body");
  const symEl = document.getElementById("ticket-symbol");
  if (!body) return;
  if (symEl) symEl.textContent = currentQuote?.instrumentName || currentEpic || "—";
  body.innerHTML = "";
  const wrap = el("div", { class: "ticket" });

  const quoteBox = el("div", { class: "ticket-quote" }, [
    el("div", { class: "q" }, [el("em", { text: "SELL / BID" }), el("b", { id: "ticket-bid", class: "down", text: currentQuote ? fmt.price(currentQuote.bid) : "—" })]),
    el("div", { class: "q" }, [el("em", { text: "BUY / OFFER" }), el("b", { id: "ticket-offer", class: "up", text: currentQuote ? fmt.price(currentQuote.offer) : "—" })]),
  ]);

  const typeSeg = el("div", { class: "seg" });
  for (const [type, label] of [["MARKET", "Market"], ["LIMIT", "Limit"], ["STOP", "Stop"]]) {
    typeSeg.append(
      el("button", {
        text: label,
        class: ticket.orderType === type ? "active" : "",
        onclick: () => {
          ticket.orderType = type;
          if (type !== "MARKET" && !ticket.entryLevel) {
            ticket.entryLevel = currentQuote ? (currentQuote.bid + currentQuote.offer) / 2 : null;
          }
          renderTicket();
        },
      }),
    );
  }

  const sizeInput = el("input", {
    class: "input",
    type: "number",
    min: "0.01",
    step: "0.01",
    value: ticket.size,
    oninput: (e) => {
      ticket.size = parseFloat(e.target.value) || 0;
      updateTicketSummary();
    },
  });
  const sizeChips = el("div", { class: "chips" }, [0.5, 1, 2, 5, 10].map((v) =>
    el("button", { class: "chip-btn", text: `+${v}`, onclick: () => { ticket.size = Math.round((ticket.size + v) * 100) / 100; renderTicket(); } }),
  ));

  wrap.append(quoteBox, el("div", { class: "field" }, [el("label", { text: "Order type" }), typeSeg]));

  if (ticket.orderType !== "MARKET") {
    const entryInput = el("input", {
      class: "input",
      type: "number",
      step: "any",
      value: ticket.entryLevel ?? "",
      oninput: (e) => { ticket.entryLevel = parseFloat(e.target.value) || null; updateTicketSummary(); },
    });
    wrap.append(el("div", { class: "field" }, [el("label", { text: ticket.orderType === "LIMIT" ? "Limit entry level" : "Stop entry level" }), entryInput]));
  }

  wrap.append(el("div", { class: "field" }, [el("label", { text: "Size (contracts/units)" }), sizeInput, sizeChips]));

  // Stop loss
  const slSeg = el("div", { class: "seg" });
  for (const [mode, label] of [["off", "None"], ["distance", "Distance"], ["level", "Level"]]) {
    slSeg.append(el("button", {
      text: label,
      class: ticket.slMode === mode ? "active" : "",
      onclick: () => { ticket.slMode = mode; renderTicket(); },
    }));
  }
  wrap.append(el("div", { class: "field" }, [el("label", { text: "Stop loss" }), slSeg]));
  if (ticket.slMode !== "off") {
    wrap.append(
      el("input", {
        class: "input",
        type: "number",
        step: "any",
        placeholder: ticket.slMode === "distance" ? "Distance in price points" : "Absolute stop level",
        value: ticket.slValue ?? "",
        oninput: (e) => { ticket.slValue = parseFloat(e.target.value) || null; updateTicketSummary(); },
      }),
    );
  }

  // Take profit
  const tpSeg = el("div", { class: "seg" });
  for (const [mode, label] of [["off", "None"], ["distance", "Distance"], ["level", "Level"]]) {
    tpSeg.append(el("button", {
      text: label,
      class: ticket.tpMode === mode ? "active" : "",
      onclick: () => { ticket.tpMode = mode; renderTicket(); },
    }));
  }
  wrap.append(el("div", { class: "field" }, [el("label", { text: "Take profit" }), tpSeg]));
  if (ticket.tpMode !== "off") {
    wrap.append(
      el("input", {
        class: "input",
        type: "number",
        step: "any",
        placeholder: ticket.tpMode === "distance" ? "Distance in price points" : "Absolute target level",
        value: ticket.tpValue ?? "",
        oninput: (e) => { ticket.tpValue = parseFloat(e.target.value) || null; updateTicketSummary(); },
      }),
    );
  }

  const options = el("div", {}, [
    el("label", { class: "checkbox-row" }, [
      el("input", {
        type: "checkbox",
        checked: ticket.guaranteed,
        onchange: (e) => { ticket.guaranteed = e.target.checked; if (e.target.checked) ticket.trailing = false; renderTicket(); },
      }),
      el("span", { text: "Guaranteed stop (wider spread)" }),
    ]),
    el("label", { class: "checkbox-row" }, [
      el("input", {
        type: "checkbox",
        checked: ticket.trailing,
        disabled: ticket.guaranteed,
        onchange: (e) => { ticket.trailing = e.target.checked; if (e.target.checked) ticket.slMode = "distance"; renderTicket(); },
      }),
      el("span", { text: "Trailing stop (requires SL distance)" }),
    ]),
  ]);

  const summary = el("div", { class: "ticket-summary", id: "ticket-summary" });

  const riskCalc = el("details", {}, [
    el("summary", { class: "hint", text: "🧮 Position size calculator" }),
    el("div", { class: "field" }, [el("label", { text: "Account balance" }), el("input", { class: "input", type: "number", id: "rc-balance", value: accountCache ? accountCache.balance.balance : 10000 })]),
    el("div", { class: "field" }, [el("label", { text: "Risk per trade %" }), el("input", { class: "input", type: "number", id: "rc-risk", value: settings.get().defaultRiskPercent, step: "0.1" })]),
    el("div", { class: "field" }, [el("label", { text: "Stop distance (price points)" }), el("input", { class: "input", type: "number", id: "rc-stop", step: "any" })]),
    el("button", {
      class: "btn btn-block",
      text: "Calculate size",
      onclick: () => {
        const balance = parseFloat(document.getElementById("rc-balance").value) || 0;
        const riskPct = parseFloat(document.getElementById("rc-risk").value) || 0;
        const stop = parseFloat(document.getElementById("rc-stop").value) || 0;
        if (!balance || !riskPct || !stop) {
          toast("Fill in balance, risk % and stop distance", "warn");
          return;
        }
        const riskAmount = (balance * riskPct) / 100;
        const size = Math.max(0.01, Math.floor((riskAmount / stop) * 100) / 100);
        ticket.size = size;
        if (ticket.slMode === "distance") ticket.slValue = stop;
        toast(`Risk ${fmt.money(riskAmount, accountCache?.balance?.currency || settings.get().baseCurrency)} → suggested size ${size}`, "success");
        renderTicket();
      },
    }),
  ]);

  const actions = el("div", { class: "ticket-actions" }, [
    el("button", {
      class: "btn btn-sell",
      text: `SELL ${currentQuote ? fmt.price(currentQuote.bid) : ""}`,
      onclick: () => submitOrder("SELL"),
    }),
    el("button", {
      class: "btn btn-buy",
      text: `BUY ${currentQuote ? fmt.price(currentQuote.offer) : ""}`,
      onclick: () => submitOrder("BUY"),
    }),
  ]);

  wrap.append(options, summary, actions, riskCalc);
  body.append(wrap);
  updateTicketSummary();
}

function updateTicketQuotes() {
  const bid = document.getElementById("ticket-bid");
  const offer = document.getElementById("ticket-offer");
  if (bid && currentQuote) {
    bid.textContent = fmt.price(currentQuote.bid);
    offer.textContent = fmt.price(currentQuote.offer);
    const buyBtn = document.querySelector(".btn-buy");
    const sellBtn = document.querySelector(".btn-sell");
    if (buyBtn) buyBtn.textContent = `BUY ${fmt.price(currentQuote.offer)}`;
    if (sellBtn) sellBtn.textContent = `SELL ${fmt.price(currentQuote.bid)}`;
    updateTicketSummary();
  }
}

function ticketLevels() {
  const entry = ticket.orderType === "MARKET"
    ? ticket.side === "BUY" ? currentQuote?.offer : currentQuote?.bid
    : ticket.entryLevel;
  const dir = ticket.side === "BUY" ? 1 : -1;
  let stopLevel = null;
  let profitLevel = null;
  if (ticket.slMode === "level" && ticket.slValue) stopLevel = ticket.slValue;
  if (ticket.slMode === "distance" && ticket.slValue && entry) stopLevel = entry - dir * ticket.slValue;
  if (ticket.tpMode === "level" && ticket.tpValue) profitLevel = ticket.tpValue;
  if (ticket.tpMode === "distance" && ticket.tpValue && entry) profitLevel = entry + dir * ticket.tpValue;
  return { entry, stopLevel, profitLevel, dir };
}

function updateTicketSummary() {
  const box = document.getElementById("ticket-summary");
  if (!box) return;
  const { entry, stopLevel, profitLevel, dir } = ticketLevels();
  const ccy = accountCache?.balance?.currency || settings.get().baseCurrency;
  const risk = entry && stopLevel ? Math.abs(entry - stopLevel) * ticket.size : null;
  const reward = entry && profitLevel ? Math.abs(profitLevel - entry) * ticket.size : null;
  const rr = risk && reward ? reward / risk : null;
  const marginFactor = currentMarket?.marginFactor ?? 5;
  const margin = entry ? (ticket.size * entry * marginFactor) / 100 : null;
  box.innerHTML = "";
  const rows = [
    ["Direction", `${ticket.side} ${ticket.orderType.toLowerCase()}`],
    ["Entry", entry ? fmt.price(entry) : "—"],
    ["Stop level", stopLevel ? fmt.price(stopLevel) : "—"],
    ["Target level", profitLevel ? fmt.price(profitLevel) : "—"],
    ["Est. risk", risk !== null ? fmt.money(risk, ccy) : "—"],
    ["Est. reward", reward !== null ? fmt.money(reward, ccy) : "—"],
    ["Risk : reward", rr ? `1 : ${rr.toFixed(2)}` : "—"],
    ["Est. margin", margin !== null ? fmt.money(margin, ccy) : "—"],
  ];
  for (const [label, value] of rows) {
    box.append(el("div", { class: "row" }, [el("span", { class: "faint", text: label }), el("b", { text: value })]));
  }
  void dir;
}

async function submitOrder(direction) {
  if (!currentQuote) {
    toast("No market selected", "warn");
    return;
  }
  ticket.side = direction;
  const { entry, stopLevel, profitLevel } = ticketLevels();
  const ccy = accountCache?.balance?.currency || settings.get().baseCurrency;

  if (ticket.orderType !== "MARKET" && !ticket.entryLevel) {
    toast("Enter an entry level for pending orders", "warn");
    return;
  }
  if (ticket.size <= 0) {
    toast("Enter a valid size", "warn");
    return;
  }
  if (stopLevel && direction === "BUY" && entry && stopLevel >= entry) {
    toast("Buy stop-loss must be below entry", "warn");
    return;
  }
  if (stopLevel && direction === "SELL" && entry && stopLevel <= entry) {
    toast("Sell stop-loss must be above entry", "warn");
    return;
  }

  const summary = [
    `${direction} ${ticket.size} ${currentQuote.instrumentName || currentEpic}`,
    ticket.orderType === "MARKET" ? `at market (~${fmt.price(entry)})` : `${ticket.orderType.toLowerCase()} @ ${fmt.price(entry)}`,
    stopLevel ? `· SL ${fmt.price(stopLevel)}` : "",
    profitLevel ? `· TP ${fmt.price(profitLevel)}` : "",
  ].filter(Boolean).join("  ");

  if (settings.get().confirmTrades) {
    const ok = await confirmDialog({
      title: `${direction} ${currentQuote.instrumentName || currentEpic}`,
      message: `${summary}\n\nEstimated risk: ${stopLevel ? fmt.money(Math.abs(entry - stopLevel) * ticket.size, ccy) : "unlimited (no stop)"}\n\nThis will place a real order if a live broker is connected.`,
      confirmText: `Place ${direction} order`,
    });
    if (!ok) return;
  }

  try {
    let res;
    if (ticket.orderType === "MARKET") {
      const body = {
        epic: currentEpic,
        direction,
        size: ticket.size,
        guaranteedStop: ticket.guaranteed,
        trailingStop: ticket.trailing,
      };
      if (stopLevel) (ticket.slMode === "level" ? (body.stopLevel = stopLevel) : (body.stopDistance = Math.abs(entry - stopLevel)));
      if (profitLevel) (ticket.tpMode === "level" ? (body.profitLevel = profitLevel) : (body.profitDistance = Math.abs(profitLevel - entry)));
      res = await api.openPosition(body);
    } else {
      const body = {
        epic: currentEpic,
        direction,
        size: ticket.size,
        level: ticket.entryLevel,
        type: ticket.orderType,
        guaranteedStop: ticket.guaranteed,
      };
      if (stopLevel) body.stopDistance = Math.abs(ticket.entryLevel - stopLevel);
      if (profitLevel) body.profitDistance = Math.abs(profitLevel - ticket.entryLevel);
      res = await api.placeWorkingOrder(body);
    }
    if (res.errorCode) throw new Error(res.errorCode);
    const confirm = await api.waitConfirm(res.dealReference);
    const level = confirm?.level;
    toast(
      `${ticket.orderType === "MARKET" ? "Order placed" : "Working order placed"}: ${direction} ${ticket.size} ${currentQuote.instrumentName}${level ? ` @ ${fmt.price(level)}` : ""}`,
      "success",
      6000,
    );
    await refreshBroker(true);
  } catch (err) {
    toast(`Order failed: ${err.message}`, "error", 7000);
  }
}

/* ========================== positions / orders / account =================== */

export async function refreshBroker(force = false) {
  void force;
  try {
    const [positions, orders, accounts] = await Promise.all([
      api.getPositions(),
      api.getWorkingOrders(),
      api.getAccounts(),
    ]);
    positionsCache = positions.positions || [];
    ordersCache = orders.workingOrders || [];
    accountCache = api.preferredAccount(accounts);
    if (root && root.isConnected) renderBottom();
    drawTradeAnnotations();
  } catch (err) {
    if (root && root.isConnected) {
      const body = document.getElementById("bottom-body");
      if (body) body.innerHTML = `<div class="empty-state"><div class="big">🔌</div><h3>Broker connection problem</h3><p>${err.message}</p></div>`;
    }
  }
}

function renderBottom() {
  const body = document.getElementById("bottom-body");
  if (!body) return;
  body.innerHTML = "";

  if (bottomTab === "positions") {
    if (!positionsCache.length) {
      body.append(emptyState("📭", "No open positions", "Place a trade from the ticket on the right, or import history in the Journal tab."));
      return;
    }
    const table = el("table", { class: "data-table" });
    table.innerHTML = `
      <thead><tr>
        <th>Market</th><th>Dir</th><th class="num">Size</th><th class="num">Entry</th>
        <th class="num">Current</th><th class="num">Stop</th><th class="num">Target</th>
        <th class="num">UPL</th><th>Opened</th><th></th>
      </tr></thead>`;
    const tbody = el("tbody");
    for (const pos of positionsCache) {
      const p = pos.position;
      const m = pos.market;
      const upl = p.upl ?? 0;
      const current = p.direction === "BUY" ? m.bid : m.offer;
      tbody.append(
        el("tr", {}, [
          el("td", {}, [el("button", { class: "btn btn-sm btn-ghost", text: m.instrumentName || m.epic, onclick: () => selectSymbol(m.epic) })]),
          el("td", {}, [el("span", { class: `pill ${p.direction === "BUY" ? "pill-buy" : "pill-sell"}`, text: p.direction })]),
          el("td", { class: "num", text: fmt.num(p.size, 2) }),
          el("td", { class: "num", text: fmt.price(p.level) }),
          el("td", { class: "num", text: fmt.price(current) }),
          el("td", { class: "num dim", text: p.stopLevel ? fmt.price(p.stopLevel) : "—" }),
          el("td", { class: "num dim", text: p.profitLevel ? fmt.price(p.profitLevel) : "—" }),
          el("td", { class: `num ${upl >= 0 ? "up" : "down"}`, text: fmt.money(upl, p.currency) }),
          el("td", { class: "faint", text: fmt.dateTime(p.createdDate) }),
          el("td", {}, [el("div", { class: "actions" }, [
            el("button", { class: "btn btn-sm", text: "Edit", onclick: () => openEditPosition(pos) }),
            el("button", { class: "btn btn-sm btn-danger", text: "Close", onclick: () => closePositionFlow(pos) }),
          ])]),
        ]),
      );
    }
    table.append(tbody);
    body.append(table);
    return;
  }

  if (bottomTab === "orders") {
    if (!ordersCache.length) {
      body.append(emptyState("🗓️", "No working orders", "Choose Limit or Stop in the order ticket to place a pending entry order."));
      return;
    }
    const table = el("table", { class: "data-table" });
    table.innerHTML = `
      <thead><tr>
        <th>Market</th><th>Type</th><th>Dir</th><th class="num">Size</th><th class="num">Level</th>
        <th class="num">Stop dist</th><th class="num">Target dist</th><th>Created</th><th></th>
      </tr></thead>`;
    const tbody = el("tbody");
    for (const order of ordersCache) {
      const o = order.workingOrderData;
      const m = order.marketData;
      tbody.append(
        el("tr", {}, [
          el("td", { text: m.instrumentName || o.epic }),
          el("td", {}, [el("span", { class: "pill pill-neutral", text: o.orderType })]),
          el("td", {}, [el("span", { class: `pill ${o.direction === "BUY" ? "pill-buy" : "pill-sell"}`, text: o.direction })]),
          el("td", { class: "num", text: fmt.num(o.orderSize, 2) }),
          el("td", { class: "num", text: fmt.price(o.orderLevel) }),
          el("td", { class: "num dim", text: o.stopDistance ? fmt.num(o.stopDistance, 2) : "—" }),
          el("td", { class: "num dim", text: o.profitDistance ? fmt.num(o.profitDistance, 2) : "—" }),
          el("td", { class: "faint", text: fmt.dateTime(o.createdDate) }),
          el("td", {}, [el("div", { class: "actions" }, [
            el("button", { class: "btn btn-sm btn-danger", text: "Cancel", onclick: () => cancelOrderFlow(o) }),
          ])]),
        ]),
      );
    }
    table.append(tbody);
    body.append(table);
    return;
  }

  if (bottomTab === "account") {
    const acc = accountCache;
    if (!acc) {
      body.append(emptyState("💳", "No account data", "Check the broker connection in Settings."));
      return;
    }
    const b = acc.balance;
    body.append(
      el("div", { class: "stat-strip", style: { padding: "16px" } }, [
        statItem("Account", acc.accountName),
        statItem("Currency", acc.currency),
        statItem("Balance", fmt.money(b.balance, acc.currency)),
        statItem("Margin used", fmt.money(b.deposit, acc.currency)),
        statItem("Funds available", fmt.money(b.available, acc.currency)),
        statItem("Open P&L", fmt.money(b.profitLoss, acc.currency)),
        statItem("Account type", acc.accountType),
      ]),
    );
    return;
  }

  // activity
  const trades = closedStore.list().slice(0, 25);
  if (!trades.length) {
    body.append(emptyState("🕓", "No recent activity", "Closed trades detected from your broker (or the simulator) will appear here."));
    return;
  }
  const table = el("table", { class: "data-table" });
  table.innerHTML = `
    <thead><tr><th>Closed</th><th>Market</th><th>Dir</th><th class="num">Size</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P&amp;L</th><th>Reason</th><th></th></tr></thead>`;
  const tbody = el("tbody");
  for (const t of trades) {
    const journaled = t.dealId && journal.byDealId(t.dealId);
    tbody.append(
      el("tr", {}, [
        el("td", { class: "faint", text: fmt.dateTime(t.closeTime) }),
        el("td", { text: t.instrumentName || t.epic }),
        el("td", {}, [el("span", { class: `pill ${t.direction === "BUY" ? "pill-buy" : "pill-sell"}`, text: t.direction })]),
        el("td", { class: "num", text: fmt.num(t.size, 2) }),
        el("td", { class: "num", text: fmt.price(t.entry) }),
        el("td", { class: "num", text: fmt.price(t.exit) }),
        el("td", { class: `num ${(t.pnl ?? 0) >= 0 ? "up" : "down"}`, text: fmt.money(t.pnl, t.currency) }),
        el("td", { class: "faint", text: t.reason || "MANUAL" }),
        el("td", {}, [el("div", { class: "actions" }, [
          journaled
            ? el("span", { class: "pill pill-neutral", text: "in journal" })
            : el("button", {
                class: "btn btn-sm btn-primary",
                text: "Add to journal",
                onclick: () => {
                  journal.add({
                    source: "broker",
                    dealId: t.dealId,
                    epic: t.epic,
                    symbol: t.instrumentName,
                    direction: t.direction,
                    size: t.size,
                    entryPrice: t.entry,
                    exitPrice: t.exit,
                    openTime: t.openTime,
                    closeTime: t.closeTime,
                    pnl: t.pnl,
                    currency: t.currency,
                  });
                  toast("Trade added to journal", "success");
                  renderBottom();
                },
              }),
        ])]),
      ]),
    );
  }
  table.append(tbody);
  body.append(table);
}

function statItem(label, value) {
  return el("div", { class: "stat" }, [el("em", { text: label }), el("b", { text: value })]);
}

function emptyState(big, title, text) {
  return el("div", { class: "empty-state" }, [
    el("div", { class: "big", text: big }),
    el("h3", { text: title }),
    el("p", { text }),
  ]);
}

function openEditPosition(pos) {
  const p = pos.position;
  const m = pos.market;
  const stopInput = el("input", { class: "input", type: "number", step: "any", value: p.stopLevel ?? "" });
  const tpInput = el("input", { class: "input", type: "number", step: "any", value: p.profitLevel ?? "" });
  const stopDistInput = el("input", { class: "input", type: "number", step: "any", placeholder: "e.g. 25 points" });
  const tpDistInput = el("input", { class: "input", type: "number", step: "any", placeholder: "e.g. 50 points" });
  const body = el("div", {}, [
    el("p", { class: "hint", text: `${p.direction} ${p.size} ${m.instrumentName || m.epic} @ ${fmt.price(p.level)}. Set absolute levels OR distances (distance clears the absolute level).` }),
    el("div", { class: "field" }, [el("label", { text: "Stop loss level" }), stopInput]),
    el("div", { class: "field" }, [el("label", { text: "…or stop distance" }), stopDistInput]),
    el("div", { class: "field" }, [el("label", { text: "Take profit level" }), tpInput]),
    el("div", { class: "field" }, [el("label", { text: "…or profit distance" }), tpDistInput]),
    el("p", { class: "hint", text: "Leave a field empty to remove that protection." }),
  ]);
  modal({
    title: "Modify position",
    body,
    actions: [
      { label: "Cancel", class: "btn-ghost" },
      {
        label: "Save",
        class: "btn-primary",
        onClick: async () => {
          const patch = {};
          const dist = parseFloat(stopDistInput.value);
          const distTp = parseFloat(tpDistInput.value);
          const stopLevel = parseFloat(stopInput.value);
          const tpLevel = parseFloat(tpInput.value);
          if (!Number.isNaN(dist)) patch.stopDistance = dist;
          else if (!Number.isNaN(stopLevel)) patch.stopLevel = stopLevel;
          else patch.stopLevel = null;
          if (!Number.isNaN(distTp)) patch.profitDistance = distTp;
          else if (!Number.isNaN(tpLevel)) patch.profitLevel = tpLevel;
          else patch.profitLevel = null;
          try {
            await api.editPosition(p.dealId, patch);
            toast("Position updated", "success");
            refreshBroker(true);
          } catch (err) {
            toast(`Update failed: ${err.message}`, "error");
          }
        },
      },
    ],
  });
}

async function closePositionFlow(pos) {
  const p = pos.position;
  const m = pos.market;
  const ok = await confirmDialog({
    title: "Close position",
    message: `Close ${p.direction} ${p.size} ${m.instrumentName || m.epic} at market? Open P&L: ${fmt.money(p.upl ?? 0, p.currency)}`,
    confirmText: "Close position",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.closePosition(p.dealId);
    toast("Position closed", "success");
    refreshBroker(true);
  } catch (err) {
    toast(`Close failed: ${err.message}`, "error");
  }
}

async function cancelOrderFlow(o) {
  const ok = await confirmDialog({
    title: "Cancel working order",
    message: `Cancel ${o.direction} ${o.orderSize} ${o.epic} ${o.orderType} @ ${fmt.price(o.orderLevel)}?`,
    confirmText: "Cancel order",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.cancelWorkingOrder(o.dealId);
    toast("Working order cancelled", "success");
    refreshBroker(true);
  } catch (err) {
    toast(`Cancel failed: ${err.message}`, "error");
  }
}

export function getPositionsCache() {
  return positionsCache;
}

export function activateTrade() {
  if (chart) chart.setTheme(settings.get().theme);
}
