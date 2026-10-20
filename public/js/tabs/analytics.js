/**
 * Analytics tab: performance statistics + visual reports computed from the
 * journal. Canvas charts are drawn from scratch so there are no external
 * chart dependencies.
 */

import { el, fmt, currencySymbol } from "../util.js";
import { journal, settings, on } from "../store.js";

let root = null;
let rangeDays = 30;

const RANGES = [
  ["7D", 7],
  ["30D", 30],
  ["90D", 90],
  ["YTD", -1],
  ["All", 0],
];

export function renderAnalyticsTab(container) {
  root = container;
  container.innerHTML = "";

  const rangeSeg = el("div", { class: "seg", style: { width: "260px" } });
  for (const [label, days] of RANGES) {
    rangeSeg.append(el("button", {
      text: label,
      class: days === rangeDays ? "active" : "",
      onclick: (e) => {
        rangeDays = days;
        rangeSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        renderAll();
      },
    }));
  }

  container.append(
    el("div", { class: "filter-bar" }, [
      el("h3", { text: "Performance report", style: { margin: 0, alignSelf: "center" } }),
      el("div", { class: "spacer", style: { flex: 1 } }),
      el("span", { class: "faint", text: "Time range" }),
      rangeSeg,
    ]),
    el("div", { id: "analytics-kpis", class: "kpi-grid" }),
    el("div", { id: "analytics-charts", class: "chart-grid" }),
    el("div", { id: "analytics-heatmap" }),
    el("div", { id: "analytics-tables", class: "chart-grid", style: { marginTop: "12px" } }),
    el("div", { id: "analytics-insights" }),
  );

  renderAll();
  on("journal:changed", () => {
    if (root?.isConnected) renderAll();
  });
}

function entriesInRange() {
  const all = journal.list();
  if (rangeDays === 0) return all;
  const now = Date.now();
  if (rangeDays === -1) {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime();
    return all.filter((e) => new Date(e.closeTime).getTime() >= start);
  }
  return all.filter((e) => now - new Date(e.closeTime).getTime() <= rangeDays * 86400000);
}

function renderAll() {
  const entries = entriesInRange();
  renderKpis(entries);
  renderCharts(entries);
  renderHeatmap(entries);
  renderTables(entries);
  renderInsights(entries);
}

/* ================================== KPIs ================================== */

function stats(entries) {
  const wins = entries.filter((e) => e.pnl > 0);
  const losses = entries.filter((e) => e.pnl < 0);
  const net = entries.reduce((s, e) => s + e.pnl, 0);
  const grossWin = wins.reduce((s, e) => s + e.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, e) => s + e.pnl, 0));
  const rs = entries.filter((e) => e.rMultiple != null).map((e) => e.rMultiple);
  // equity + drawdown
  const chron = [...entries].sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  const curve = [];
  for (const e of chron) {
    equity += e.pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
    curve.push({ t: new Date(e.closeTime).getTime(), equity, dd: peak - equity });
  }
  // streaks
  let winStreak = 0;
  let lossStreak = 0;
  let cw = 0;
  let cl = 0;
  for (const e of chron) {
    if (e.pnl > 0) {
      cw += 1;
      cl = 0;
    } else if (e.pnl < 0) {
      cl += 1;
      cw = 0;
    }
    winStreak = Math.max(winStreak, cw);
    lossStreak = Math.max(lossStreak, cl);
  }
  // per-day
  const byDay = groupBy(entries, (e) => e.closeTime.slice(0, 10));
  const dayNets = [...byDay.values()].map((list) => list.reduce((s, e) => s + e.pnl, 0));
  const holds = entries.map((e) => new Date(e.closeTime) - new Date(e.openTime)).filter((m) => m > 0);
  return {
    count: entries.length,
    net,
    wins: wins.length,
    losses: losses.length,
    winRate: entries.length ? (wins.length / entries.length) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancyR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    maxDrawdown: maxDD,
    curve,
    winStreak,
    lossStreak,
    bestDay: dayNets.length ? Math.max(...dayNets) : 0,
    worstDay: dayNets.length ? Math.min(...dayNets) : 0,
    avgHoldHours: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length / 3600000 : 0,
    byDay,
  };
}

function renderKpis(entries) {
  const box = document.getElementById("analytics-kpis");
  if (!box) return;
  const s = stats(entries);
  const ccy = settings.get().baseCurrency;
  const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞";
  const cards = [
    ["Net P&L", fmt.money(s.net, ccy), s.net >= 0 ? "up" : "down", `${s.count} trades`],
    ["Win rate", `${s.winRate.toFixed(1)}%`, "", `${s.wins}W / ${s.losses}L`],
    ["Profit factor", pf, Number(s.profitFactor) >= 1 ? "up" : "down", "gross win ÷ gross loss"],
    ["Expectancy", s.expectancyR ? `${s.expectancyR >= 0 ? "+" : ""}${s.expectancyR.toFixed(2)}R` : "—", s.expectancyR >= 0 ? "up" : "down", "average R per trade"],
    ["Avg win / loss", `${fmt.money(s.avgWin, ccy)} / ${fmt.money(s.avgLoss, ccy)}`, "", `ratio ${s.avgLoss ? (s.avgWin / s.avgLoss).toFixed(2) : "—"}:1`],
    ["Max drawdown", fmt.money(s.maxDrawdown, ccy), "down", "peak-to-trough"],
    ["Best / worst day", `${fmt.money(s.bestDay, ccy)} / ${fmt.money(s.worstDay, ccy)}`, "", "closed-trade days"],
    ["Streaks", `${s.winStreak}W / ${s.lossStreak}L`, "", "best consecutive"],
    ["Avg hold time", s.avgHoldHours ? `${s.avgHoldHours < 48 ? `${s.avgHoldHours.toFixed(1)}h` : `${(s.avgHoldHours / 24).toFixed(1)}d`}` : "—", "", "entry to exit"],
  ];
  box.innerHTML = "";
  for (const [label, value, cls, sub] of cards) {
    box.append(el("div", { class: "kpi" }, [
      el("em", { text: label }),
      el("b", { class: cls, text: value }),
      el("small", { text: sub }),
    ]));
  }
}

/* ================================= charts ================================= */

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(10, rect.width * dpr);
  canvas.height = Math.max(10, rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawEquityChart(canvas, curve) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  ctx.clearRect(0, 0, w, h);
  if (curve.length < 2) return drawEmptyChart(ctx, w, h);
  const xs = curve.map((p) => p.t);
  const ys = curve.map((p) => p.equity);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const spanY = maxY - minY || 1;
  const X = (t) => pad.l + ((t - minX) / (maxX - minX || 1)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - minY) / spanY) * (h - pad.t - pad.b);

  // zero line
  ctx.strokeStyle = cssVar("--border");
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, Y(0));
  ctx.lineTo(w - pad.r, Y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // drawdown shading
  ctx.beginPath();
  ctx.moveTo(X(curve[0].t), Y(curve[0].equity));
  for (const p of curve) ctx.lineTo(X(p.t), Y(p.equity));
  ctx.strokeStyle = "#26c6da";
  ctx.lineWidth = 2;
  ctx.stroke();
  const grad = ctx.createLinearGradient(0, pad.t, 0, h);
  grad.addColorStop(0, "rgba(38,198,218,0.28)");
  grad.addColorStop(1, "rgba(38,198,218,0.01)");
  ctx.lineTo(X(curve[curve.length - 1].t), Y(minY));
  ctx.lineTo(X(curve[0].t), Y(minY));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = cssVar("--text-faint");
  ctx.font = "10px sans-serif";
  ctx.fillText(fmt.money(maxY, settings.get().baseCurrency, 0), pad.l, pad.t + 8);
  ctx.fillText(fmt.money(minY, settings.get().baseCurrency, 0), pad.l, h - pad.b + 12);
}

function drawBarsChart(canvas, values, labels, { money = true } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  ctx.clearRect(0, 0, w, h);
  if (!values.length) return drawEmptyChart(ctx, w, h);
  const max = Math.max(...values.map(Math.abs), 1);
  const zeroY = pad.t + (1 - (Math.max(0, ...values) + 0.0001) / (max * 2)) * (h - pad.t - pad.b) * 2;
  const barW = Math.min(28, (w - pad.l - pad.r) / values.length - 4);
  const step = (w - pad.l - pad.r) / values.length;
  const scaleY = (h - pad.t - pad.b) / (max * 2);

  ctx.strokeStyle = cssVar("--border");
  ctx.beginPath();
  ctx.moveTo(pad.l, zeroY);
  ctx.lineTo(w - pad.r, zeroY);
  ctx.stroke();

  values.forEach((v, i) => {
    const x = pad.l + i * step + (step - barW) / 2;
    const bh = Math.abs(v) * scaleY;
    const y = v >= 0 ? zeroY - bh : zeroY;
    ctx.fillStyle = v >= 0 ? "rgba(38,166,154,0.85)" : "rgba(239,83,80,0.85)";
    ctx.fillRect(x, y, barW, Math.max(1, bh));
    if (labels[i] && values.length <= 16) {
      ctx.fillStyle = cssVar("--text-faint");
      ctx.font = "9px sans-serif";
      const text = String(labels[i]).slice(0, 8);
      ctx.fillText(text, x + barW / 2 - ctx.measureText(text).width / 2, h - 6);
    }
    void money;
  });
}

function drawHBars(canvas, items, ccy) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!items.length) return drawEmptyChart(ctx, w, h);
  const rowH = Math.min(26, (h - 8) / items.length);
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const midX = w * 0.34;
  items.forEach((item, i) => {
    const y = 4 + i * rowH;
    const len = (Math.abs(item.value) / max) * (w * 0.6);
    ctx.fillStyle = item.value >= 0 ? "rgba(38,166,154,0.8)" : "rgba(239,83,80,0.8)";
    ctx.fillRect(item.value >= 0 ? midX : midX - len, y + 2, len, rowH - 8);
    ctx.fillStyle = cssVar("--text-dim");
    ctx.font = "10px sans-serif";
    const label = String(item.label).slice(0, 18);
    ctx.fillText(label, 4, y + rowH / 2 + 1);
    ctx.fillStyle = cssVar("--text");
    const value = fmt.money(item.value, ccy, 0);
    ctx.fillText(value, item.value >= 0 ? midX + len + 5 : midX - len - 5 - ctx.measureText(value).width, y + rowH / 2 + 1);
  });
}

function drawHistogram(canvas, values) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  ctx.clearRect(0, 0, w, h);
  const vals = values.filter((v) => v != null);
  if (!vals.length) return drawEmptyChart(ctx, w, h);
  const min = Math.min(...vals, -3);
  const max = Math.max(...vals, 3);
  const bins = 12;
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    counts[idx] += 1;
  }
  const maxCount = Math.max(...counts, 1);
  const barW = (w - pad.l - pad.r) / bins;
  counts.forEach((count, i) => {
    const bh = (count / maxCount) * (h - pad.t - pad.b);
    const x = pad.l + i * barW;
    const binMid = min + (i + 0.5) * width;
    ctx.fillStyle = binMid >= 0 ? "rgba(38,166,154,0.8)" : "rgba(239,83,80,0.8)";
    ctx.fillRect(x + 1, h - pad.b - bh, barW - 2, Math.max(1, bh));
    if (i % 3 === 0) {
      ctx.fillStyle = cssVar("--text-faint");
      ctx.font = "9px sans-serif";
      ctx.fillText(binMid.toFixed(1) + "R", x, h - 6);
    }
  });
  // zero line
  const zeroX = pad.l + ((0 - min) / (max - min)) * (w - pad.l - pad.r);
  ctx.strokeStyle = cssVar("--border");
  ctx.beginPath();
  ctx.moveTo(zeroX, pad.t);
  ctx.lineTo(zeroX, h - pad.b);
  ctx.stroke();
}

function drawDonut(canvas, winRate) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 18;
  const start = -Math.PI / 2;
  ctx.lineWidth = 16;
  ctx.strokeStyle = "rgba(239,83,80,0.75)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "rgba(38,166,154,0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + (winRate / 100) * 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = cssVar("--text");
  ctx.font = "bold 17px sans-serif";
  const label = `${winRate.toFixed(0)}%`;
  ctx.fillText(label, cx - ctx.measureText(label).width / 2, cy + 2);
  ctx.font = "9px sans-serif";
  ctx.fillStyle = cssVar("--text-faint");
  const sub = "win rate";
  ctx.fillText(sub, cx - ctx.measureText(sub).width / 2, cy + 18);
}

function drawEmptyChart(ctx, w, h) {
  ctx.fillStyle = cssVar("--text-faint");
  ctx.font = "11px sans-serif";
  const msg = "Not enough data yet";
  ctx.fillText(msg, w / 2 - ctx.measureText(msg).width / 2, h / 2);
}

function chartPanel(title, canvas, legend) {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: title })]),
    legend ? el("div", { class: "legend" }, legend) : null,
    el("div", { class: "chart-box" }, [canvas]),
  ]);
}

function renderCharts(entries) {
  const wrap = document.getElementById("analytics-charts");
  if (!wrap) return;
  wrap.innerHTML = "";
  const s = stats(entries);
  const ccy = settings.get().baseCurrency;

  const equityCanvas = el("canvas");
  const dayCanvas = el("canvas");
  const histCanvas = el("canvas");
  const symCanvas = el("canvas");
  const setupCanvasEl = el("canvas");
  const donutCanvas = el("canvas");

  // daily P&L (last 14 trading days)
  const dayEntries = [...s.byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const dayValues = dayEntries.map(([, list]) => list.reduce((sum, e) => sum + e.pnl, 0));
  const dayLabels = dayEntries.map(([day]) => day.slice(5));

  // by symbol
  const bySymbol = topGroups(entries, (e) => e.symbol || e.epic, 8);
  // by setup
  const bySetup = topGroups(entries, (e) => e.setup || "(no setup)", 8);

  wrap.append(
    chartPanel("Equity curve (cumulative P&L)", equityCanvas, [
      legendItem("#26c6da", "cumulative"),
      legendItem("transparent", `max drawdown ${fmt.money(s.maxDrawdown, ccy)}`),
    ]),
    chartPanel("Daily P&L", dayCanvas),
    chartPanel("R-multiple distribution", histCanvas, [legendItem("#26a69a", "wins"), legendItem("#ef5350", "losses")]),
    chartPanel("P&L by market", symCanvas),
    chartPanel("P&L by setup", setupCanvasEl),
    chartPanel("Win rate", donutCanvas),
  );

  requestAnimationFrame(() => {
    drawEquityChart(equityCanvas, s.curve);
    drawBarsChart(dayCanvas, dayValues, dayLabels);
    drawHistogram(histCanvas, entries.map((e) => e.rMultiple));
    drawHBars(symCanvas, bySymbol, ccy);
    drawHBars(setupCanvasEl, bySetup, ccy);
    drawDonut(donutCanvas, s.winRate);
  });
}

function legendItem(color, text) {
  return el("span", {}, [
    el("span", { class: "swatch", style: { background: color } }),
    document.createTextNode(text),
  ]);
}

function topGroups(entries, keyFn, limit) {
  const map = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    map.set(key, (map.get(key) || 0) + e.pnl);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
}

function groupBy(entries, keyFn) {
  const map = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return map;
}

/* ================================= heatmap ================================ */

function renderHeatmap(entries) {
  const wrap = document.getElementById("analytics-heatmap");
  if (!wrap) return;
  wrap.innerHTML = "";
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const matrix = days.map(() => hours.map(() => 0));
  for (const e of entries) {
    const d = new Date(e.closeTime);
    const day = (d.getDay() + 6) % 7;
    matrix[day][d.getHours()] += e.pnl;
  }
  const max = Math.max(1, ...matrix.flat().map(Math.abs));
  const grid = el("div", { class: "heatmap", style: { gridTemplateColumns: `42px repeat(24, 1fr)`, marginTop: "12px" } });
  grid.append(el("div"), ...hours.map((h) => el("div", { class: "heat-label", text: h % 3 === 0 ? String(h).padStart(2, "0") : "" })));
  days.forEach((day, di) => {
    grid.append(el("div", { class: "heat-label", text: day }));
    hours.forEach((_, hi) => {
      const v = matrix[di][hi];
      const intensity = Math.abs(v) / max;
      const color = v === 0
        ? "transparent"
        : v > 0
          ? `rgba(38,166,154,${0.12 + intensity * 0.72})`
          : `rgba(239,83,80,${0.12 + intensity * 0.72})`;
      grid.append(
        el("div", {
          class: "heat-cell",
          style: { background: color },
          title: `${day} ${String(hi).padStart(2, "0")}:00 — ${fmt.money(v, settings.get().baseCurrency)}`,
          text: Math.abs(v) > 0 ? "" : "",
        }),
      );
    });
  });
  wrap.append(
    el("div", { class: "panel", style: { marginTop: "12px" } }, [
      el("div", { class: "panel-head" }, [
        el("h3", { text: "When do you make money? (P&L by weekday × hour)" }),
      ]),
      el("div", { class: "panel-body" }, [grid]),
    ]),
  );
}

/* ================================== tables ================================ */

function breakdownTable(title, entries, keyFn) {
  const map = groupBy(entries, keyFn);
  const rows = [...map.entries()]
    .map(([key, list]) => {
      const net = list.reduce((s, e) => s + e.pnl, 0);
      const wins = list.filter((e) => e.pnl > 0).length;
      const rs = list.filter((e) => e.rMultiple != null).map((e) => e.rMultiple);
      return {
        key,
        trades: list.length,
        winRate: (wins / list.length) * 100,
        net,
        avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      };
    })
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 10);

  const table = el("table", { class: "data-table" });
  table.innerHTML = `<thead><tr><th>${title}</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Net P&amp;L</th><th class="num">Avg R</th></tr></thead>`;
  const tbody = el("tbody");
  for (const r of rows) {
    tbody.append(el("tr", {}, [
      el("td", { text: r.key }),
      el("td", { class: "num", text: r.trades }),
      el("td", { class: "num", text: `${r.winRate.toFixed(0)}%` }),
      el("td", { class: `num ${r.net >= 0 ? "up" : "down"}`, text: fmt.money(r.net, settings.get().baseCurrency) }),
      el("td", { class: "num", text: r.avgR === null ? "—" : `${r.avgR.toFixed(2)}R` }),
    ]));
  }
  table.append(tbody);
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: `Breakdown by ${title.toLowerCase()}` })]),
    el("div", { class: "panel-body no-pad" }, [table]),
  ]);
}

function renderTables(entries) {
  const wrap = document.getElementById("analytics-tables");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!entries.length) {
    wrap.append(el("div", { class: "empty-state" }, [
      el("div", { class: "big", text: "📊" }),
      el("h3", { text: "No trades in this range" }),
      el("p", { text: "Journal some trades (or trade in the simulator) and your analytics will come alive." }),
    ]));
    return;
  }
  wrap.append(
    breakdownTable("Market", entries, (e) => e.symbol || e.epic),
    breakdownTable("Setup", entries, (e) => e.setup || "(no setup)"),
    breakdownTable("Weekday", entries, (e) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(e.closeTime).getDay()]),
    breakdownTable("Direction", entries, (e) => e.direction),
    breakdownTable("Mistake tag", entries.flatMap((e) => (e.mistakes || []).length ? e.mistakes.map((m) => ({ ...e, _m: m })) : [{ ...e, _m: "(clean)" }]), (e) => e._m),
  );
}

/* ================================= insights =============================== */

function renderInsights(entries) {
  const wrap = document.getElementById("analytics-insights");
  if (!wrap) return;
  wrap.innerHTML = "";
  const insights = [];
  const s = stats(entries);
  const ccy = settings.get().baseCurrency;

  if (entries.length < 5) {
    insights.push(["💡", "Log at least 5 trades to unlock pattern insights. The more detail you record (setup, mistakes, emotion), the sharper these become."]);
  } else {
    if (s.profitFactor < 1) insights.push(["⚠️", `Your profit factor is ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"} — you lose more than you make. Consider reducing size and only taking A+ setups until it moves above 1.3.`]);
    else if (s.profitFactor > 2) insights.push(["🌟", `Profit factor ${s.profitFactor.toFixed(2)} is excellent. Protect this edge: keep risk per trade consistent.`]);

    if (s.avgWin && s.avgLoss && s.avgWin < s.avgLoss) {
      insights.push(["🎯", `Your average win (${fmt.money(s.avgWin, ccy)}) is smaller than your average loss (${fmt.money(s.avgLoss, ccy)}). Let winners run further or cut losers faster.`]);
    }
    if (s.winRate < 40 && s.expectancyR > 0) {
      insights.push(["📉", `Win rate is ${s.winRate.toFixed(0)}% but expectancy is positive (${s.expectancyR.toFixed(2)}R) — you have a trend-following profile. Expect losing streaks of ${Math.max(4, s.lossStreak)} and size accordingly.`]);
    }
    if (s.winRate > 65 && s.expectancyR <= 0) {
      insights.push(["🎯", `High win rate (${s.winRate.toFixed(0)}%) but negative expectancy — classic sign of small winners and big losers. Try wider targets or tighter stops.`]);
    }
    if (s.maxDrawdown > 0) {
      insights.push(["🛡️", `Max drawdown in this range is ${fmt.money(s.maxDrawdown, ccy)}. Keep daily loss limits below ${fmt.money(s.maxDrawdown * 0.5, ccy)} to protect your equity curve.`]);
    }
    const bySetup = topGroups(entries, (e) => e.setup || "(no setup)", 2);
    if (bySetup.length > 1 && bySetup[0].value > 0 && bySetup[1].value < 0) {
      insights.push(["🧠", `“${bySetup[0].label}” is your best setup (+${fmt.money(bySetup[0].value, ccy)}), while “${bySetup[1].label}” bleeds money (${fmt.money(bySetup[1].value, ccy)}). Consider stopping the second one.`]);
    }
    const clean = entries.filter((e) => !(e.mistakes || []).length);
    const dirty = entries.filter((e) => (e.mistakes || []).length);
    if (clean.length >= 3 && dirty.length >= 3) {
      const cleanNet = clean.reduce((a, e) => a + e.pnl, 0) / clean.length;
      const dirtyNet = dirty.reduce((a, e) => a + e.pnl, 0) / dirty.length;
      if (dirtyNet < cleanNet) {
        insights.push(["🧼", `Trades without recorded mistakes average ${fmt.money(cleanNet, ccy)} vs ${fmt.money(dirtyNet, ccy)} with mistakes. Discipline is literally worth ${fmt.money(cleanNet - dirtyNet, ccy)} per trade.`]);
      }
    }
    const fearful = entries.filter((e) => ["Fearful", "Anxious", "Frustrated", "Greedy"].includes(e.emotion));
    const calm = entries.filter((e) => ["Calm", "Confident"].includes(e.emotion));
    if (fearful.length >= 3 && calm.length >= 3) {
      const f = fearful.reduce((a, e) => a + e.pnl, 0) / fearful.length;
      const c = calm.reduce((a, e) => a + e.pnl, 0) / calm.length;
      if (c > f) insights.push(["🧘", `You average ${fmt.money(c, ccy)} trading calm vs ${fmt.money(f, ccy)} when emotional. Consider pausing trading when you record Fearful/Greedy states.`]);
    }
    if (s.lossStreak >= 3) insights.push(["🔴", `Your worst run in this range is ${s.lossStreak} losses in a row. Pre-define what you'll do after 3 losers (stop for the day?).`]);
  }

  const panel = el("div", { class: "panel", style: { marginTop: "12px" } }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "🧠 Coach notes" })]),
    el("div", { class: "panel-body" },
      insights.length
        ? insights.map(([icon, text]) => el("div", { class: "insight" }, [el("span", { class: "icon", text: icon }), el("span", { text })]))
        : [el("p", { class: "hint", text: "No patterns to report yet." })]),
  ]);
  wrap.append(panel);
}
