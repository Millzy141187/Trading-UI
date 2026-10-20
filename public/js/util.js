/**
 * Small DOM + formatting toolkit used by every tab module.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "html") node.innerHTML = value;
    else if (key === "class") node.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key === "dataset") for (const [k, v] of Object.entries(value)) node.dataset[k] = v;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pricePrecision(v) {
  const n = Math.abs(Number(v) || 0);
  if (n >= 1000) return 2;
  if (n >= 100) return 2;
  if (n >= 10) return 3;
  if (n >= 1) return 5;
  return 6;
}

export const fmt = {
  num(v, dp = 2) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    return Number(v).toLocaleString("en-GB", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    });
  },
  money(v, currency = "GBP", dp = 2) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    const sign = Number(v) < 0 ? "-" : "";
    return `${sign}${currencySymbol(currency)}${fmt.num(Math.abs(Number(v)), dp)}`;
  },
  signed(v, dp = 2) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    return `${n > 0 ? "+" : ""}${fmt.num(n, dp)}`;
  },
  price(v, precision) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    return fmt.num(v, precision ?? pricePrecision(v));
  },
  pct(v, dp = 2) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    return `${Number(v) > 0 ? "+" : ""}${fmt.num(v, dp)}%`;
  },
  time(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  },
  date(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  },
  dateTime(ts) {
    if (!ts) return "—";
    return `${fmt.date(ts)} ${fmt.time(ts)}`;
  },
  relative(ts) {
    if (!ts) return "—";
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  },
};

export function currencySymbol(currency = "GBP") {
  const map = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$", JPY: "¥", CHF: "CHF " };
  return map[String(currency).toUpperCase()] || `${currency} `;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce(fn, ms = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------- toasts --------------------------------- */

let toastRoot = null;
export function toast(message, type = "info", timeout = 3800) {
  if (!toastRoot) {
    toastRoot = el("div", { class: "toast-root" });
    document.body.append(toastRoot);
  }
  const icons = { info: "ℹ️", success: "✅", error: "⛔", warn: "⚠️" };
  const node = el("div", { class: `toast toast-${type}` }, [
    el("span", { class: "toast-icon", text: icons[type] || icons.info }),
    el("span", { class: "toast-msg", text: message }),
    el("button", {
      class: "toast-close",
      text: "×",
      onclick: () => node.remove(),
    }),
  ]);
  toastRoot.append(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 250);
  }, timeout);
  return node;
}

/* ---------------------------------- modals --------------------------------- */

export function modal({ title, body, actions = [], width = 520, onClose }) {
  const overlay = el("div", { class: "modal-overlay" });
  const panel = el("div", { class: "modal-panel", style: { width: `${width}px` } });
  const head = el("div", { class: "modal-head" }, [
    el("h3", { text: title || "" }),
    el("button", { class: "modal-x", text: "×", onclick: () => close() }),
  ]);
  const content = el("div", { class: "modal-body" });
  if (typeof body === "string") content.innerHTML = body;
  else if (body) content.append(body);
  const foot = el("div", { class: "modal-foot" });
  for (const action of actions) {
    foot.append(
      el("button", {
        class: `btn ${action.class || "btn-ghost"}`,
        text: action.label,
        onclick: async () => {
          if (action.onClick) {
            const keepOpen = await action.onClick();
            if (keepOpen === false) return;
          }
          close();
        },
      }),
    );
  }
  panel.append(head, content);
  if (actions.length) panel.append(foot);
  overlay.append(panel);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 180);
    if (onClose) onClose();
  }
  return { close, overlay, content };
}

export function confirmDialog({
  title = "Are you sure?",
  message = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const body = el("div", {}, [el("p", { class: "modal-message", text: message })]);
    modal({
      title,
      body,
      actions: [
        { label: cancelText, class: "btn-ghost", onClick: () => resolve(false) },
        {
          label: confirmText,
          class: danger ? "btn-danger" : "btn-primary",
          onClick: () => resolve(true),
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog({
  title = "Input",
  label = "",
  value = "",
  placeholder = "",
  inputType = "text",
  confirmText = "Save",
} = {}) {
  return new Promise((resolve) => {
    const input = el("input", {
      class: "input",
      type: inputType,
      value,
      placeholder,
      onkeydown: (e) => {
        if (e.key === "Enter") {
          resolve(input.value.trim());
          instance.close();
        }
      },
    });
    const body = el("div", { class: "field" }, [
      label ? el("label", { text: label }) : null,
      input,
    ]);
    const instance = modal({
      title,
      body,
      actions: [
        { label: "Cancel", class: "btn-ghost", onClick: () => resolve(null) },
        {
          label: confirmText,
          class: "btn-primary",
          onClick: () => resolve(input.value.trim()),
        },
      ],
      onClose: () => resolve(null),
    });
    setTimeout(() => input.focus(), 60);
  });
}

/* ----------------------------------- CSV ----------------------------------- */

export function toCSV(rows, columns) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCell(c.get(row))).join(","));
  return [header, ...lines].join("\r\n");
}

export function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });
}

export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
