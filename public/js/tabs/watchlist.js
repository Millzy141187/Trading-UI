/**
 * Watchlist tab: full-page quote board with sparklines + price alerts.
 */

import { el, fmt, toast, modal, confirmDialog, debounce, downloadText } from "../util.js";
import * as api from "../api.js";
import { watchlist as wlStore, alerts as alertStore, settings, on } from "../store.js";

let root = null;
let quoteCache = new Map();
const sparkHistory = new Map(); // epic -> number[]

export function renderWatchlistTab(container) {
  root = container;
  container.innerHTML = "";

  const searchInput = el("input", {
    class: "input",
    placeholder: "Add a market — search by name, epic or type…",
    oninput: debounce((e) => runSearch(e.target.value), 250),
    onfocus: (e) => runSearch(e.target.value),
  });
  const results = el("div", { class: "wl-results", hidden: true });
  const board = el("div", { class: "panel-body no-pad", id: "wl-board" });

  const alertsPanel = buildAlertsPanel();

  container.append(
    el("div", { class: "chart-grid" }, [
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, [
          el("h3", { text: "My markets" }),
          el("div", { class: "spacer" }),
          el("button", {
            class: "btn btn-sm btn-ghost",
            text: "Export quotes",
            onclick: () => {
              const rows = wlStore.list().map((m) => {
                const q = quoteCache.get(m.epic) || {};
                return { epic: m.epic, name: m.instrumentName, bid: q.bid ?? "", offer: q.offer ?? "", change: q.percentageChange ?? "" };
              });
              const header = "epic,name,bid,offer,change";
              const csv = [header, ...rows.map((r) => `${r.epic},"${r.name}",${r.bid},${r.offer},${r.change}`)].join("\n");
              downloadText(`watchlist-${Date.now()}.csv`, csv, "text/csv");
            },
          }),
        ]),
        el("div", { class: "wl-search" }, [searchInput, results]),
        board,
      ]),
      alertsPanel,
    ]),
  );

  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== searchInput) results.hidden = true;
  });

  async function runSearch(term) {
    try {
      const markets = await api.searchMarkets(term || "");
      results.innerHTML = "";
      results.hidden = false;
      for (const m of markets.slice(0, 25)) {
        results.append(
          el("button", {
            class: "wl-result",
            onclick: () => {
              wlStore.add({ epic: m.epic, instrumentName: m.instrumentName || m.name, instrumentType: m.instrumentType, currency: m.currency });
              results.hidden = true;
              searchInput.value = "";
              renderBoard();
            },
          }, [
            el("span", {}, [
              el("div", { text: m.instrumentName || m.name || m.epic }),
              el("div", { class: "faint", text: m.epic }),
            ]),
            el("span", { class: "mono", text: fmt.price(m.bid) }),
          ]),
        );
      }
      if (!markets.length) results.append(el("div", { class: "wl-result dim", text: "No markets found" }));
    } catch (err) {
      results.append(el("div", { class: "wl-result down", text: err.message }));
    }
  }

  renderBoard();
  renderAlerts();
  on("watchlist:changed", renderBoard);
  on("alerts:changed", renderAlerts);
}

function renderBoard() {
  const board = document.getElementById("wl-board");
  if (!board) return;
  board.innerHTML = "";
  const list = wlStore.list();
  if (!list.length) {
    board.append(
      el("div", { class: "empty-state" }, [
        el("div", { class: "big", text: "👁️" }),
        el("h3", { text: "Your watchlist is empty" }),
        el("p", { text: "Search above to add markets you want to track." }),
      ]),
    );
    return;
  }
  const table = el("table", { class: "data-table" });
  table.innerHTML = `
    <thead><tr>
      <th>Market</th><th class="num">Bid</th><th class="num">Offer</th><th class="num">Spread</th>
      <th class="num">Change</th><th class="num">Day range</th><th>Trend</th><th></th>
    </tr></thead>`;
  const tbody = el("tbody", { id: "wl-tbody" });
  for (const m of list) {
    tbody.append(buildRow(m));
  }
  table.append(tbody);
  board.append(table);
}

function buildRow(m) {
  const q = quoteCache.get(m.epic);
  const chg = q?.percentageChange ?? 0;
  const row = el("tr", { dataset: { epic: m.epic } }, [
    el("td", {}, [
      el("div", { text: m.instrumentName || m.epic, style: { fontWeight: "600" } }),
      el("div", { class: "faint", text: `${m.epic} · ${m.instrumentType || ""}` }),
    ]),
    el("td", { class: "num", text: q ? fmt.price(q.bid) : "…" }),
    el("td", { class: "num", text: q ? fmt.price(q.offer) : "…" }),
    el("td", { class: "num dim", text: q ? fmt.price(q.offer - q.bid) : "" }),
    el("td", { class: `num ${chg >= 0 ? "up" : "down"}`, text: q ? fmt.pct(chg) : "" }),
    el("td", { class: "num dim", text: q ? `${fmt.price(q.low)} – ${fmt.price(q.high)}` : "" }),
    el("td", {}, [sparkCanvas(m.epic)]),
    el("td", {}, [el("div", { class: "actions" }, [
      el("button", {
        class: "btn btn-sm",
        text: "Alert",
        onclick: () => openAlertForm(m),
      }),
      el("button", {
        class: "btn btn-sm btn-ghost",
        text: "↑",
        title: "Move up",
        onclick: () => wlStore.move(m.epic, -1),
      }),
      el("button", {
        class: "btn btn-sm btn-ghost",
        text: "↓",
        title: "Move down",
        onclick: () => wlStore.move(m.epic, 1),
      }),
      el("button", {
        class: "btn btn-sm btn-danger",
        text: "×",
        onclick: async () => {
          const ok = await confirmDialog({ title: "Remove market", message: `Remove ${m.instrumentName || m.epic} from your watchlist?`, confirmText: "Remove", danger: true });
          if (ok) wlStore.remove(m.epic);
        },
      }),
    ])]),
  ]);
  return row;
}

function sparkCanvas(epic) {
  const canvas = el("canvas", { width: "110", height: "28", style: { display: "block" } });
  requestAnimationFrame(() => drawSpark(canvas, sparkHistory.get(epic) || []));
  return canvas;
}

function drawSpark(canvas, values) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr || 110 * dpr;
  canvas.height = canvas.clientHeight * dpr || 28 * dpr;
  ctx.scale(dpr, dpr);
  const w = canvas.clientWidth || 110;
  const h = canvas.clientHeight || 28;
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const up = values[values.length - 1] >= values[0];
  ctx.strokeStyle = up ? "#26a69a" : "#ef5350";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export function updateQuotes(quotes) {
  for (const q of quotes) {
    quoteCache.set(q.epic, q);
    const hist = sparkHistory.get(q.epic) || [];
    hist.push((q.bid + q.offer) / 2);
    if (hist.length > 40) hist.shift();
    sparkHistory.set(q.epic, hist);
  }
  if (!root || !root.isConnected) return;
  for (const q of quotes) {
    const row = root.querySelector(`tr[data-epic="${CSS.escape(q.epic)}"]`);
    if (!row) continue;
    const cells = row.querySelectorAll("td");
    if (cells.length < 7) continue;
    cells[1].textContent = fmt.price(q.bid);
    cells[2].textContent = fmt.price(q.offer);
    cells[3].textContent = fmt.price(q.offer - q.bid);
    cells[4].textContent = fmt.pct(q.percentageChange);
    cells[4].className = `num ${q.percentageChange >= 0 ? "up" : "down"}`;
    cells[5].textContent = `${fmt.price(q.low)} – ${fmt.price(q.high)}`;
    const canvas = cells[6].querySelector("canvas");
    if (canvas) drawSpark(canvas, sparkHistory.get(q.epic) || []);
  }
}

/* --------------------------------- alerts --------------------------------- */

function buildAlertsPanel() {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [
      el("h3", { text: "Price alerts" }),
      el("div", { class: "spacer" }),
      el("button", { class: "btn btn-sm btn-primary", text: "＋ New alert", onclick: () => openAlertForm(null) }),
    ]),
    el("div", { class: "panel-body", id: "alerts-body" }),
    el("div", { class: "panel-body", style: { borderTop: "1px solid var(--border-soft)" } }, [
      el("p", { class: "hint", text: "Alerts fire inside the app while this page is open (sound + notification banner). Use them as heads-up levels, not as guaranteed execution triggers." }),
    ]),
  ]);
}

function renderAlerts() {
  const body = document.getElementById("alerts-body");
  if (!body) return;
  body.innerHTML = "";
  const list = alertStore.list();
  if (!list.length) {
    body.append(el("div", { class: "empty-state" }, [
      el("div", { class: "big", text: "🔔" }),
      el("p", { text: "No alerts yet. Create one for any market in your watchlist." }),
    ]));
    return;
  }
  for (const a of list) {
    body.append(
      el("div", { class: `alert-row ${a.triggeredAt ? "triggered" : ""}` }, [
        el("div", { style: { flex: 1 } }, [
          el("div", { text: `${a.condition === "above" ? "↑ above" : "↓ below"} ${fmt.price(a.price)} — ${a.symbol || a.epic}`, style: { fontWeight: 600 } }),
          el("div", { class: "faint", text: a.note || (a.triggeredAt ? `triggered ${fmt.relative(a.triggeredAt)}` : `created ${fmt.relative(a.createdAt)}`) }),
        ]),
        a.triggeredAt
          ? el("button", { class: "btn btn-sm", text: "Re-arm", onclick: () => alertStore.reset(a.id) })
          : null,
        el("button", {
          class: "btn btn-sm btn-danger",
          text: "×",
          onclick: () => alertStore.remove(a.id),
        }),
      ]),
    );
  }
}

function openAlertForm(market) {
  const list = wlStore.list();
  const select = el("select", { class: "select" });
  for (const m of list.length ? list : market ? [market] : []) {
    select.append(el("option", { value: m.epic, text: m.instrumentName || m.epic, selected: market?.epic === m.epic }));
  }
  const priceInput = el("input", { class: "input", type: "number", step: "any", placeholder: "Trigger price" });
  const noteInput = el("input", { class: "input", placeholder: "Note (optional)" });
  const condSeg = el("div", { class: "seg" });
  let condition = "above";
  for (const [value, label] of [["above", "Price moves above"], ["below", "Price moves below"]]) {
    condSeg.append(el("button", {
      text: label,
      class: value === condition ? "active" : "",
      onclick: (e) => {
        condition = value;
        condSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
      },
    }));
  }
  const body = el("div", {}, [
    el("div", { class: "field" }, [el("label", { text: "Market" }), select]),
    el("div", { class: "field" }, [el("label", { text: "Condition" }), condSeg]),
    el("div", { class: "field" }, [el("label", { text: "Price level" }), priceInput]),
    el("div", { class: "field" }, [el("label", { text: "Note" }), noteInput]),
    el("div", { class: "chips" }, [2, 5, 10, 20].map((pct) =>
      el("button", {
        class: "chip-btn",
        text: `+${pct}%`,
        onclick: () => {
          const epic = select.value;
          const q = quoteCache.get(epic);
          if (q) priceInput.value = ((q.bid + q.offer) / 2) * (1 + pct / 100);
        },
      }),
    )),
    el("p", { class: "hint", text: "Quick chips set the level a % away from the current price." }),
  ]);

  modal({
    title: "New price alert",
    body,
    actions: [
      { label: "Cancel", class: "btn-ghost" },
      {
        label: "Create alert",
        class: "btn-primary",
        onClick: () => {
          const price = parseFloat(priceInput.value);
          if (!select.value || !price) {
            toast("Pick a market and enter a price level", "warn");
            return false;
          }
          alertStore.add({
            epic: select.value,
            symbol: select.options[select.selectedIndex]?.text || select.value,
            condition,
            price,
            note: noteInput.value.trim(),
          });
          toast("Alert created", "success");
        },
      },
    ],
  });
}

export function getQuoteCache() {
  return quoteCache;
}
