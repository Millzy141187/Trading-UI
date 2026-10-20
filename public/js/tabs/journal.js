/**
 * Journal tab: the trading diary.
 * Every trade (manual, simulated or broker-synced) lands here with notes,
 * tags, mistakes, emotion, grade and an R multiple — powering Analytics.
 */

import { el, fmt, toast, modal, confirmDialog, toCSV, parseCSV, downloadText, escapeHTML, uid, debounce } from "../util.js";
import { journal, closed as closedStore, settings, on } from "../store.js";

const MISTAKES = [
  "FOMO entry",
  "Revenge trade",
  "Moved my stop",
  "No stop loss",
  "Oversized position",
  "Early exit",
  "Late exit",
  "Ignored my plan",
  "Traded the news",
  "Overtrading",
  "Averaged down badly",
];

const EMOTIONS = ["Calm", "Confident", "Anxious", "Greedy", "Fearful", "Frustrated", "Bored", "Excited"];

const COMMON_SETUPS = [
  "Breakout",
  "Breakdown",
  "Trend pullback",
  "Support bounce",
  "Resistance rejection",
  "Range scalp",
  "News reaction",
  "Opening drive",
  "Reversal",
  "Continuation",
  "Moving average cross",
  "Indicator confluence",
];

let root = null;
let sortKey = "openTime";
let sortDir = -1;
const filters = { text: "", from: "", to: "", symbol: "", direction: "", result: "", setup: "" };

/* ================================== render ================================= */

export function renderJournalTab(container) {
  root = container;
  container.innerHTML = "";

  const stats = el("div", { class: "kpi-grid", id: "journal-stats" });
  const toolbar = el("div", { class: "filter-bar" }, [
    el("button", { class: "btn btn-primary", text: "＋ Add trade", onclick: () => openTradeForm(null) }),
    el("button", {
      class: "btn",
      text: "⤓ Import from broker",
      onclick: openBrokerImport,
    }),
    el("button", {
      class: "btn",
      text: "⤒ Import CSV",
      onclick: () => {
        const input = el("input", { type: "file", accept: ".csv,text/csv" });
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;
          try {
            const rows = parseCSV(await file.text());
            const entries = rows.map(mapCsvRow).filter((e) => e.symbol || e.epic);
            const added = journal.import(entries);
            toast(`Imported ${added} trades (${rows.length - added} duplicates skipped)`, "success");
          } catch (err) {
            toast(`Import failed: ${err.message}`, "error");
          }
        };
        input.click();
      },
    }),
    el("button", {
      class: "btn",
      text: "⤓ Export CSV",
      onclick: () => {
        const rows = filtered();
        downloadText(`trading-journal-${Date.now()}.csv`, toCSV(rows, CSV_COLUMNS), "text/csv");
        toast(`Exported ${rows.length} trades`, "success");
      },
    }),
    el("button", {
      class: "btn",
      text: "⤓ Backup JSON",
      onclick: () => {
        downloadText(`journal-backup-${Date.now()}.json`, JSON.stringify(journal.list(), null, 2), "application/json");
      },
    }),
    el("div", { class: "spacer", style: { flex: 1 } }),
  ]);

  const filterBar = el("div", { class: "filter-bar" }, [
    textField("Search notes / tags", "text", (v) => { filters.text = v; renderTable(); }),
    dateField("From", "from"),
    dateField("To", "to"),
    selectField("Symbol", "symbol", uniqueSymbols()),
    selectField("Direction", "direction", ["BUY", "SELL"]),
    selectField("Result", "result", ["Win", "Loss", "Scratch"]),
    selectField("Setup", "setup", uniqueSetups()),
    el("button", {
      class: "btn btn-ghost",
      text: "Clear filters",
      onclick: () => {
        Object.keys(filters).forEach((k) => { filters[k] = ""; });
        root.querySelectorAll(".filter-bar input, .filter-bar select").forEach((i) => { i.value = ""; });
        renderTable();
      },
    }),
  ]);

  const tableWrap = el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [
      el("h3", { text: "Trade log" }),
      el("div", { class: "spacer" }),
      el("span", { class: "faint", id: "journal-count", text: "" }),
    ]),
    el("div", { class: "panel-body no-pad", id: "journal-table" }),
  ]);

  container.append(stats, toolbar, filterBar, tableWrap);
  renderStats();
  renderTable();

  on("journal:changed", () => {
    if (!root?.isConnected) return;
    renderStats();
    renderTable();
    // refresh setup/symbol filter options
    const symSel = root.querySelector('select[data-filter="symbol"]');
    if (symSel) fillSelect(symSel, uniqueSymbols());
    const setupSel = root.querySelector('select[data-filter="setup"]');
    if (setupSel) fillSelect(setupSel, uniqueSetups());
  });
}

function textField(label, key, onChange) {
  return el("div", { class: "field grow" }, [
    el("label", { text: label }),
    el("input", { class: "input", placeholder: "e.g. breakout, mistake, tag…", oninput: debounce((e) => onChange(e.target.value.trim().toLowerCase()), 220) }),
  ]);
}

function dateField(label, key) {
  return el("div", { class: "field" }, [
    el("label", { text: label }),
    el("input", { class: "input", type: "date", oninput: (e) => { filters[key] = e.target.value; renderTable(); } }),
  ]);
}

function selectField(label, key, options) {
  const sel = el("select", {
    class: "select",
    dataset: { filter: key },
    onchange: (e) => { filters[key] = e.target.value; renderTable(); },
  }, [el("option", { value: "", text: `All ${label.toLowerCase()}s` })]);
  fillSelect(sel, options);
  return el("div", { class: "field" }, [el("label", { text: label }), sel]);
}

function fillSelect(sel, options) {
  const current = sel.value;
  sel.innerHTML = "";
  sel.append(el("option", { value: "", text: "All" }));
  for (const o of options) sel.append(el("option", { value: o, text: o }));
  sel.value = current;
}

function uniqueSymbols() {
  return [...new Set(journal.list().map((e) => e.symbol).filter(Boolean))].sort();
}
function uniqueSetups() {
  return [...new Set(journal.list().map((e) => e.setup).filter(Boolean))].sort();
}

/* ================================== stats ================================== */

function computeStats(entries) {
  const wins = entries.filter((e) => e.pnl > 0);
  const losses = entries.filter((e) => e.pnl < 0);
  const net = entries.reduce((s, e) => s + e.pnl, 0);
  const grossWin = wins.reduce((s, e) => s + e.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, e) => s + e.pnl, 0));
  const rs = entries.filter((e) => e.rMultiple !== null && e.rMultiple !== undefined).map((e) => e.rMultiple);
  return {
    count: entries.length,
    wins: wins.length,
    losses: losses.length,
    net,
    winRate: entries.length ? (wins.length / entries.length) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    best: entries.length ? Math.max(...entries.map((e) => e.pnl)) : 0,
    worst: entries.length ? Math.min(...entries.map((e) => e.pnl)) : 0,
  };
}

function renderStats() {
  const box = document.getElementById("journal-stats");
  if (!box) return;
  const s = computeStats(filtered());
  const ccy = settings.get().baseCurrency;
  box.innerHTML = "";
  const cards = [
    ["Net P&L", fmt.money(s.net, ccy), s.net >= 0 ? "up" : "down"],
    ["Trades", `${s.count}`, ""],
    ["Win rate", `${s.winRate.toFixed(1)}%`, ""],
    ["Profit factor", Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞", ""],
    ["Avg win", fmt.money(s.avgWin, ccy), "up"],
    ["Avg loss", fmt.money(s.avgLoss, ccy), "down"],
    ["Avg R multiple", s.avgR ? `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R` : "—", ""],
    ["Best / worst", `${fmt.money(s.best, ccy)} / ${fmt.money(s.worst, ccy)}`, ""],
  ];
  for (const [label, value, cls] of cards) {
    box.append(el("div", { class: "kpi" }, [
      el("em", { text: label }),
      el("b", { class: cls, text: value }),
    ]));
  }
}

/* ================================== table ================================== */

function filtered() {
  let entries = [...journal.list()];
  if (filters.text) {
    const t = filters.text;
    entries = entries.filter((e) =>
      [e.notes, e.setup, e.symbol, e.epic, ...(e.tags || []), ...(e.mistakes || []), e.emotion]
        .join(" ")
        .toLowerCase()
        .includes(t),
    );
  }
  if (filters.from) entries = entries.filter((e) => e.openTime >= filters.from);
  if (filters.to) entries = entries.filter((e) => e.openTime <= `${filters.to}T23:59:59`);
  if (filters.symbol) entries = entries.filter((e) => e.symbol === filters.symbol);
  if (filters.direction) entries = entries.filter((e) => e.direction === filters.direction);
  if (filters.setup) entries = entries.filter((e) => e.setup === filters.setup);
  if (filters.result) {
    entries = entries.filter((e) =>
      filters.result === "Win" ? e.pnl > 0 : filters.result === "Loss" ? e.pnl < 0 : e.pnl === 0,
    );
  }
  entries.sort((a, b) => {
    const av = a[sortKey] ?? "";
    const bv = b[sortKey] ?? "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
    return String(av).localeCompare(String(bv)) * sortDir;
  });
  return entries;
}

const COLUMNS = [
  ["openTime", "Opened", (e) => fmt.dateTime(e.openTime)],
  ["symbol", "Market", (e) => e.symbol],
  ["direction", "Dir", (e) => e.direction],
  ["size", "Size", (e) => fmt.num(e.size, 2)],
  ["entryPrice", "Entry", (e) => fmt.price(e.entryPrice)],
  ["exitPrice", "Exit", (e) => fmt.price(e.exitPrice)],
  ["pnl", "P&L", (e) => fmt.money(e.pnl, e.currency)],
  ["rMultiple", "R", (e) => (e.rMultiple === null || e.rMultiple === undefined ? "—" : `${e.rMultiple >= 0 ? "+" : ""}${e.rMultiple.toFixed(2)}R`)],
  ["setup", "Setup", (e) => e.setup || "—"],
  ["tags", "Tags", (e) => (e.tags || []).map((t) => `<span class="tag">${escapeHTML(t)}</span>`).join(" ")],
  ["grade", "Grade", (e) => (e.grade ? "★".repeat(e.grade) : "—")],
];

function renderTable() {
  const wrap = document.getElementById("journal-table");
  if (!wrap) return;
  const entries = filtered();
  const count = document.getElementById("journal-count");
  if (count) count.textContent = `${entries.length} trade${entries.length === 1 ? "" : "s"} shown`;
  renderStats();

  if (!entries.length) {
    wrap.innerHTML = "";
    wrap.append(
      el("div", { class: "empty-state" }, [
        el("div", { class: "big", text: "📓" }),
        el("h3", { text: journal.list().length ? "No trades match these filters" : "Your journal is empty" }),
        el("p", { text: journal.list().length ? "Try clearing the filters above." : "Add a trade manually, import from the broker, or trade in the Trade tab — closed positions can be logged in one click." }),
      ]),
    );
    return;
  }

  const table = el("table", { class: "data-table" });
  const thead = el("thead");
  const headRow = el("tr");
  for (const [key, label] of COLUMNS) {
    headRow.append(
      el("th", {
        class: "sortable",
        onclick: () => {
          if (sortKey === key) sortDir *= -1;
          else {
            sortKey = key;
            sortDir = -1;
          }
          renderTable();
        },
      }, [
        document.createTextNode(`${label} ${sortKey === key ? (sortDir > 0 ? "▲" : "▼") : ""}`),
      ]),
    );
  }
  headRow.append(el("th", { text: "" }));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const e of entries) {
    const row = el("tr", { style: { cursor: "pointer" }, onclick: () => openTradeDetail(e) });
    for (const [key, , get] of COLUMNS) {
      const td = el("td", { html: typeof get(e) === "string" ? get(e) : String(get(e)) });
      if (key === "pnl") td.className = `num ${e.pnl >= 0 ? "up" : "down"}`;
      if (key === "rMultiple") td.className = `num ${(e.rMultiple ?? 0) >= 0 ? "up" : "down"}`;
      if (["size", "entryPrice", "exitPrice"].includes(key)) td.classList.add("num");
      if (key === "direction") {
        td.innerHTML = `<span class="pill ${e.direction === "BUY" ? "pill-buy" : "pill-sell"}">${e.direction}</span>`;
      }
      row.append(td);
    }
    row.append(
      el("td", {}, [el("div", { class: "actions" }, [
        el("button", {
          class: "btn btn-sm btn-danger",
          text: "×",
          onclick: async (ev) => {
            ev.stopPropagation();
            const ok = await confirmDialog({ title: "Delete trade", message: `Delete this ${e.symbol} trade journal entry?`, confirmText: "Delete", danger: true });
            if (ok) journal.remove(e.id);
          },
        }),
      ])]),
    );
    tbody.append(row);
  }
  table.append(tbody);
  wrap.innerHTML = "";
  wrap.append(table);
}

/* ================================ trade form =============================== */

function openTradeForm(entry) {
  const isNew = !entry;
  const data = entry || {
    symbol: "",
    epic: "",
    direction: "BUY",
    size: 1,
    entryPrice: "",
    exitPrice: "",
    stopPrice: "",
    openTime: new Date().toISOString().slice(0, 16),
    closeTime: new Date().toISOString().slice(0, 16),
    fees: 0,
    pnl: "",
    rMultiple: "",
    riskAmount: "",
    setup: "",
    tags: [],
    mistakes: [],
    emotion: "Calm",
    grade: 0,
    notes: "",
  };

  const F = {};
  const field = (label, key, type = "text", extra = {}) => {
    const input = el("input", {
      class: "input",
      type,
      value: data[key] ?? "",
      step: extra.step || "any",
      list: extra.list,
    });
    F[key] = input;
    return el("div", { class: "field" }, [el("label", { text: label }), input]);
  };
  const dtField = (label, key) => {
    const input = el("input", { class: "input", type: "datetime-local", value: toLocalInput(data[key]) });
    F[key] = input;
    return el("div", { class: "field" }, [el("label", { text: label }), input]);
  };

  const setupList = el("datalist", { id: "setup-list" }, COMMON_SETUPS.map((s) => el("option", { value: s })));
  const dirSeg = el("div", { class: "seg" });
  let direction = data.direction;
  for (const dir of ["BUY", "SELL"]) {
    dirSeg.append(el("button", {
      text: dir,
      class: dir === direction ? "active" : "",
      onclick: (e) => {
        direction = dir;
        dirSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
      },
    }));
  }

  const tagsInput = el("input", { class: "input", placeholder: "comma, separated, tags", value: (data.tags || []).join(", ") });
  const mistakesBox = el("div", { class: "tag-list" });
  const selectedMistakes = new Set(data.mistakes || []);
  for (const m of MISTAKES) {
    const chip = el("button", {
      class: "chip-btn",
      text: m,
      onclick: () => {
        if (selectedMistakes.has(m)) selectedMistakes.delete(m);
        else selectedMistakes.add(m);
        chip.style.borderColor = selectedMistakes.has(m) ? "var(--red)" : "";
        chip.style.color = selectedMistakes.has(m) ? "var(--red)" : "";
      },
    });
    if (selectedMistakes.has(m)) {
      chip.style.borderColor = "var(--red)";
      chip.style.color = "var(--red)";
    }
    mistakesBox.append(chip);
  }

  const emotionSeg = el("div", { class: "chips" });
  let emotion = data.emotion || "Calm";
  for (const emo of EMOTIONS) {
    const chip = el("button", {
      class: "chip-btn",
      text: emo,
      onclick: () => {
        emotion = emo;
        emotionSeg.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active"));
        chip.classList.add("active");
      },
    });
    if (emo === emotion) chip.classList.add("active");
    emotionSeg.append(chip);
  }

  const stars = el("div", { class: "stars" });
  let grade = data.grade || 0;
  const starButtons = [];
  for (let i = 1; i <= 5; i += 1) {
    const star = el("button", {
      class: `star ${i <= grade ? "on" : ""}`,
      text: "★",
      onclick: () => {
        grade = grade === i ? 0 : i;
        starButtons.forEach((s, idx) => s.classList.toggle("on", idx < grade));
      },
    });
    starButtons.push(star);
    stars.append(star);
  }

  const notes = el("textarea", { class: "textarea", placeholder: "Why did you take this trade? What was the plan? What will you do better next time?", text: data.notes || "" });

  const body = el("div", { class: "trade-detail" }, [
    el("div", { class: "detail-grid" }, [
      field("Market / symbol", "symbol"),
      field("Epic (optional)", "epic"),
      field("Size", "size", "number", { step: "0.01" }),
    ]),
    el("div", { class: "field" }, [el("label", { text: "Direction" }), dirSeg]),
    el("div", { class: "detail-grid" }, [
      field("Entry price", "entryPrice", "number"),
      field("Exit price", "exitPrice", "number"),
      field("Stop price", "stopPrice", "number"),
    ]),
    el("div", { class: "detail-grid" }, [
      dtField("Opened", "openTime"),
      dtField("Closed", "closeTime"),
    ]),
    el("div", { class: "detail-grid" }, [
      field("P&L (account ccy)", "pnl", "number"),
      field("R multiple", "rMultiple", "number", { step: "0.1" }),
      field("Risk amount", "riskAmount", "number"),
      field("Fees", "fees", "number"),
    ]),
    el("div", { class: "field" }, [el("label", { text: "Setup / strategy" }), el("input", { class: "input", list: "setup-list", value: data.setup || "", oninput: (e) => { F.setup = { value: e.target.value }; } }), setupList]),
    el("div", { class: "field" }, [el("label", { text: "Tags" }), tagsInput]),
    el("div", { class: "field" }, [el("label", { text: "Mistakes made" }), mistakesBox]),
    el("div", { class: "field" }, [el("label", { text: "Emotion at entry" }), emotionSeg]),
    el("div", { class: "field" }, [el("label", { text: "Execution grade" }), stars]),
    el("div", { class: "field" }, [el("label", { text: "Notes" }), notes]),
  ]);

  // keep setup in F for save
  F.setup = { value: data.setup || "" };
  const setupInput = body.querySelector('input[list="setup-list"]');
  if (setupInput) setupInput.addEventListener("input", (e) => { F.setup.value = e.target.value; });

  modal({
    title: isNew ? "Add trade" : "Edit trade",
    width: 640,
    body,
    actions: [
      { label: "Cancel", class: "btn-ghost" },
      {
        label: isNew ? "Add to journal" : "Save changes",
        class: "btn-primary",
        onClick: () => {
          const payload = {
            symbol: F.symbol.value.trim() || F.epic.value.trim(),
            epic: F.epic.value.trim(),
            direction,
            size: parseFloat(F.size.value) || 1,
            entryPrice: parseFloat(F.entryPrice.value) || 0,
            exitPrice: parseFloat(F.exitPrice.value) || 0,
            stopPrice: parseFloat(F.stopPrice.value) || null,
            openTime: fromLocalInput(F.openTime.value),
            closeTime: fromLocalInput(F.closeTime.value),
            pnl: parseFloat(F.pnl.value) || 0,
            rMultiple: F.rMultiple.value === "" ? null : parseFloat(F.rMultiple.value),
            riskAmount: F.riskAmount.value === "" ? null : parseFloat(F.riskAmount.value),
            fees: parseFloat(F.fees.value) || 0,
            setup: F.setup.value.trim(),
            tags: tagsInput.value.split(",").map((t) => t.trim()).filter(Boolean),
            mistakes: [...selectedMistakes],
            emotion,
            grade,
            notes: notes.value,
          };
          if (!payload.symbol) {
            toast("Enter at least a market symbol", "warn");
            return false;
          }
          if (isNew) {
            journal.add({ ...payload, source: "manual" });
            toast("Trade added to journal", "success");
          } else {
            journal.update(entry.id, payload);
            toast("Trade updated", "success");
          }
        },
      },
    ],
  });
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

/* =============================== detail modal ============================== */

function openTradeDetail(entry) {
  const ccy = entry.currency || settings.get().baseCurrency;
  const body = el("div", { class: "trade-detail" }, [
    el("div", { class: "detail-grid" }, [
      detailCell("Market", entry.symbol || entry.epic),
      detailCell("Direction", entry.direction),
      detailCell("Size", fmt.num(entry.size, 2)),
      detailCell("Entry", fmt.price(entry.entryPrice)),
      detailCell("Exit", fmt.price(entry.exitPrice)),
      detailCell("P&L", fmt.money(entry.pnl, ccy), entry.pnl >= 0 ? "up" : "down"),
      detailCell("R multiple", entry.rMultiple === null || entry.rMultiple === undefined ? "—" : `${entry.rMultiple.toFixed(2)}R`),
      detailCell("Risk", entry.riskAmount ? fmt.money(entry.riskAmount, ccy) : "—"),
      detailCell("Opened", fmt.dateTime(entry.openTime)),
      detailCell("Closed", fmt.dateTime(entry.closeTime)),
      detailCell("Hold time", holdTime(entry)),
      detailCell("Source", entry.source || "manual"),
    ]),
    el("div", {}, [
      el("label", { class: "hint", text: "Setup" }),
      el("div", { text: entry.setup || "—", style: { marginBottom: "10px" } }),
      el("label", { class: "hint", text: "Tags" }),
      el("div", { class: "tag-list", style: { margin: "4px 0 10px" } },
        (entry.tags || []).length ? entry.tags.map((t) => el("span", { class: "tag", text: t })) : el("span", { class: "dim", text: "—" })),
      el("label", { class: "hint", text: "Mistakes" }),
      el("div", { class: "tag-list", style: { margin: "4px 0 10px" } },
        (entry.mistakes || []).length
          ? entry.mistakes.map((m) => el("span", { class: "tag", style: { background: "var(--red-dim)", color: "var(--red)" }, text: m }))
          : el("span", { class: "dim", text: "none recorded" })),
      el("label", { class: "hint", text: `Emotion: ${entry.emotion || "—"} · Grade: ${entry.grade ? "★".repeat(entry.grade) : "—"}` }),
      el("p", { style: { whiteSpace: "pre-wrap", lineHeight: "1.6" }, text: entry.notes || "No notes yet." }),
    ]),
  ]);

  modal({
    title: `${entry.direction} ${entry.symbol || entry.epic} — ${fmt.money(entry.pnl, ccy)}`,
    width: 640,
    body,
    actions: [
      { label: "Close", class: "btn-ghost" },
      {
        label: "Edit",
        class: "btn",
        onClick: () => setTimeout(() => openTradeForm(entry), 120),
      },
      {
        label: "Delete",
        class: "btn-danger",
        onClick: async () => {
          const ok = await confirmDialog({ title: "Delete trade", message: "Delete this journal entry permanently?", confirmText: "Delete", danger: true });
          if (ok) {
            journal.remove(entry.id);
            toast("Trade deleted", "info");
          }
        },
      },
    ],
  });
}

function detailCell(label, value, cls = "") {
  return el("div", { class: "detail-cell" }, [el("em", { text: label }), el("b", { class: cls, text: value })]);
}

function holdTime(entry) {
  const ms = new Date(entry.closeTime) - new Date(entry.openTime);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 48) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

/* ============================= broker import ============================== */

function openBrokerImport() {
  const pending = closedStore.list().filter((t) => !(t.dealId && journal.byDealId(t.dealId)));
  const body = el("div");
  if (!pending.length) {
    body.append(el("div", { class: "empty-state" }, [
      el("div", { class: "big", text: "✅" }),
      el("h3", { text: "Nothing to import" }),
      el("p", { text: "All detected closed trades are already in your journal. New closures appear here automatically after positions close." }),
    ]));
  } else {
    body.append(el("p", { class: "hint", text: "Trades detected from your broker connection (or the simulator). Select the ones you want in your journal — you can add notes afterwards." }));
    const table = el("table", { class: "data-table" });
    table.innerHTML = `<thead><tr><th></th><th>Closed</th><th>Market</th><th>Dir</th><th class="num">Size</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P&amp;L</th></tr></thead>`;
    const tbody = el("tbody");
    const selected = new Set(pending.map((t) => t.id));
    for (const t of pending) {
      const cb = el("input", { type: "checkbox", checked: true, onchange: (e) => {
        if (e.target.checked) selected.add(t.id);
        else selected.delete(t.id);
      } });
      tbody.append(el("tr", {}, [
        el("td", {}, [cb]),
        el("td", { class: "faint", text: fmt.dateTime(t.closeTime) }),
        el("td", { text: t.instrumentName || t.epic }),
        el("td", {}, [el("span", { class: `pill ${t.direction === "BUY" ? "pill-buy" : "pill-sell"}`, text: t.direction })]),
        el("td", { class: "num", text: fmt.num(t.size, 2) }),
        el("td", { class: "num", text: fmt.price(t.entry) }),
        el("td", { class: "num", text: fmt.price(t.exit) }),
        el("td", { class: `num ${(t.pnl ?? 0) >= 0 ? "up" : "down"}`, text: fmt.money(t.pnl, t.currency) }),
      ]));
    }
    table.append(tbody);
    body.append(table);
  }

  modal({
    title: "Import closed trades from broker",
    width: 680,
    body,
    actions: [
      { label: "Close", class: "btn-ghost" },
      ...(pending.length
        ? [{
            label: "Add selected to journal",
            class: "btn-primary",
            onClick: () => {
              const picks = pending.filter((t) => selected.has(t.id));
              const added = journal.import(
                picks.map((t) => ({
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
                })),
              );
              toast(`Added ${added} trade${added === 1 ? "" : "s"} to journal`, "success");
            },
          }]
        : []),
    ],
  });
}

/* ================================== CSV =================================== */

const CSV_COLUMNS = [
  { key: "openTime", header: "opened", get: (e) => e.openTime },
  { key: "closeTime", header: "closed", get: (e) => e.closeTime },
  { key: "symbol", header: "symbol", get: (e) => e.symbol },
  { key: "epic", header: "epic", get: (e) => e.epic },
  { key: "direction", header: "direction", get: (e) => e.direction },
  { key: "size", header: "size", get: (e) => e.size },
  { key: "entryPrice", header: "entry", get: (e) => e.entryPrice },
  { key: "exitPrice", header: "exit", get: (e) => e.exitPrice },
  { key: "stopPrice", header: "stop", get: (e) => e.stopPrice ?? "" },
  { key: "pnl", header: "pnl", get: (e) => e.pnl },
  { key: "currency", header: "currency", get: (e) => e.currency },
  { key: "rMultiple", header: "r_multiple", get: (e) => e.rMultiple ?? "" },
  { key: "riskAmount", header: "risk_amount", get: (e) => e.riskAmount ?? "" },
  { key: "fees", header: "fees", get: (e) => e.fees },
  { key: "setup", header: "setup", get: (e) => e.setup },
  { key: "tags", header: "tags", get: (e) => (e.tags || []).join("|") },
  { key: "mistakes", header: "mistakes", get: (e) => (e.mistakes || []).join("|") },
  { key: "emotion", header: "emotion", get: (e) => e.emotion },
  { key: "grade", header: "grade", get: (e) => e.grade },
  { key: "notes", header: "notes", get: (e) => e.notes },
];

function mapCsvRow(row) {
  const pick = (...keys) => {
    for (const k of keys) {
      const hit = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase());
      if (hit && row[hit] !== "") return row[hit];
    }
    return "";
  };
  return {
    id: uid("trade"),
    source: "import",
    openTime: pick("opened", "openTime", "open_time", "date"),
    closeTime: pick("closed", "closeTime", "close_time"),
    symbol: pick("symbol", "market", "instrument"),
    epic: pick("epic"),
    direction: (pick("direction", "side") || "BUY").toUpperCase(),
    size: parseFloat(pick("size", "qty", "quantity")) || 1,
    entryPrice: parseFloat(pick("entry", "entryPrice", "open")) || 0,
    exitPrice: parseFloat(pick("exit", "exitPrice", "close")) || 0,
    stopPrice: parseFloat(pick("stop", "stopPrice")) || null,
    pnl: parseFloat(pick("pnl", "profit", "P&L")) || 0,
    currency: pick("currency") || settings.get().baseCurrency,
    rMultiple: pick("r_multiple", "rMultiple", "r") === "" ? null : parseFloat(pick("r_multiple", "rMultiple", "r")),
    riskAmount: pick("risk_amount", "riskAmount", "risk") === "" ? null : parseFloat(pick("risk_amount", "riskAmount", "risk")),
    fees: parseFloat(pick("fees", "commission")) || 0,
    setup: pick("setup", "strategy"),
    tags: pick("tags").split("|").map((t) => t.trim()).filter(Boolean),
    mistakes: pick("mistakes").split("|").map((t) => t.trim()).filter(Boolean),
    emotion: pick("emotion"),
    grade: parseInt(pick("grade", "rating"), 10) || 0,
    notes: pick("notes", "comment"),
  };
}

export function renderJournalStats() {
  renderStats();
}
