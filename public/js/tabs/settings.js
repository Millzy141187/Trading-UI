/**
 * Settings tab: connection, trading defaults, appearance and data management.
 */

import { el, fmt, toast, modal, confirmDialog, promptDialog, downloadText } from "../util.js";
import * as api from "../api.js";
import * as auth from "../auth.js";
import { settings, journal, watchlist as wlStore, alerts as alertStore, exportAll, importAll, DEFAULT_SETTINGS, on } from "../store.js";

let root = null;
let bound = false;

export function renderSettingsTab(container) {
  root = container;
  container.innerHTML = "";

  container.append(
    el("div", { class: "settings-grid" }, [
      buildProfileCard(),
      buildTradingViewCard(),
      buildConnectionCard(),
      buildTradingDefaults(),
      buildAppearance(),
      buildDataCard(),
      buildSecurityCard(),
      buildAboutCard(),
    ]),
  );

  if (!bound) {
    bound = true;
    on("settings:changed", () => {
      if (root?.isConnected) renderSettingsTab(root);
    });
  }
}

function row(label, sub, control) {
  return el("div", { class: "setting-row" }, [
    el("div", {}, [el("div", { class: "label", text: label }), sub ? el("div", { class: "sub", text: sub }) : null]),
    el("div", { class: "control" }, [control]),
  ]);
}

function toggleControl(key, onChange) {
  const input = el("input", {
    type: "checkbox",
    checked: Boolean(settings.get()[key]),
    onchange: (e) => {
      settings.set({ [key]: e.target.checked });
      if (onChange) onChange(e.target.checked);
    },
  });
  return el("label", { class: "switch" }, [input, el("span", { class: "track" })]);
}

function numberControl(key, { step = 1, min = 0, suffix = "" } = {}) {
  return el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, [
    el("input", {
      class: "input",
      type: "number",
      step,
      min,
      value: settings.get()[key],
      style: { width: "90px" },
      onchange: (e) => {
        settings.set({ [key]: parseFloat(e.target.value) || 0 });
        toast("Saved", "success", 1400);
      },
    }),
    suffix ? el("span", { class: "faint", text: suffix }) : null,
  ]);
}

function selectControl(key, options) {
  const sel = el("select", {
    class: "select",
    onchange: (e) => {
      settings.set({ [key]: e.target.value });
      toast("Saved", "success", 1400);
    },
  });
  for (const [value, label] of options) {
    sel.append(el("option", { value, text: label, selected: settings.get()[key] === value }));
  }
  return sel;
}

/* --------------------------------- profile -------------------------------- */

function buildProfileCard() {
  const profile = auth.getProfile();
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Profile" })]),
    el("div", { class: "panel-body" }, [
      row("Signed in as", "Local profile on this device", el("span", { class: "pill pill-neutral", text: profile?.name || "—" })),
      row("Change PIN", "Lock this profile on shared computers (4–10 digits, or blank to remove)", el("button", {
        class: "btn btn-sm",
        text: "Set PIN",
        onclick: async () => {
          const value = await promptDialog({
            title: "Profile PIN",
            label: "New PIN (blank to remove)",
            inputType: "password",
            confirmText: "Save PIN",
          });
          if (value === null) return; // cancelled
          const pin = value.trim();
          if (pin && !/^\d{4,10}$/.test(pin)) {
            toast("PIN must be 4–10 digits", "warn");
            return;
          }
          await auth.setPin(profile.id, pin);
          toast(pin ? "PIN updated" : "PIN removed", "success");
        },
      })),
      row("Sign out", "Return to the start screen on this device", el("button", {
        class: "btn btn-sm btn-danger",
        text: "Sign out",
        onclick: () => {
          auth.signOut();
          location.reload();
        },
      })),
    ]),
  ]);
}

/* ------------------------------- TradingView ------------------------------ */

function buildTradingViewCard() {
  const profile = auth.getProfile();
  const connected = Boolean(profile?.tv?.connected);
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "TradingView" })]),
    el("div", { class: "panel-body" }, [
      row(
        "Saved indicators",
        connected
          ? `Connected ${profile.tv.connectedAt ? fmt.relative(profile.tv.connectedAt) : ""} — use the TradingView chart engine to reach your saved scripts & layouts`
          : "Connect your TradingView account to use your saved indicators & layouts in the chart",
        el("span", { class: `pill ${connected ? "pill-buy" : "pill-warn"}`, text: connected ? "Connected" : "Not connected" }),
      ),
      el("div", { class: "setting-row" }, [
        el("div", {}, [
          el("div", { class: "label", text: connected ? "Reconnect / open sign-in" : "Connect with TradingView" }),
          el("div", { class: "sub", text: "Opens TradingView's own sign-in page in a new tab — we never see your TradingView password. TradingView has no third-party OAuth; the embedded chart picks up your browser session." }),
        ]),
        el("div", { class: "control" }, [el("div", { class: "actions" }, [
          el("button", {
            class: "btn btn-sm btn-primary",
            text: "Connect",
            onclick: () => {
              auth.markTradingViewConnected();
              window.open("https://www.tradingview.com/accounts/signin/", "_blank", "noopener");
              renderSettingsTab(root);
              toast("Sign in on the TradingView tab, then switch the chart to the TradingView engine to load your saved indicators.", "info", 9000);
            },
          }),
          connected
            ? el("button", {
                class: "btn btn-sm btn-danger",
                text: "Disconnect",
                onclick: () => {
                  auth.clearTradingView();
                  renderSettingsTab(root);
                  toast("TradingView disconnected", "info");
                },
              })
            : null,
        ])]),
      ]),
    ]),
  ]);
}

/* ------------------------------- connection ------------------------------- */

function buildConnectionCard() {
  const status = api.getStatus();
  const box = el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Broker connection" })]),
    el("div", { class: "panel-body", id: "connection-body" }, [el("p", { class: "hint", text: "Checking connection…" })]),
  ]);

  status.then((s) => {
    const body = box.querySelector("#connection-body");
    if (!body) return;
    const mode = api.isDemoMode() ? "Simulated (demo data)" : `Capital.com ${s.env}`;
    body.innerHTML = "";
    body.append(
      row("Mode", s.configured ? `Server is configured for ${s.env} trading` : "No API credentials on the server yet — the app runs on realistic simulated data", el("span", { class: `pill ${api.isDemoMode() ? "pill-warn" : "pill-buy"}`, text: mode })),
      row("Force simulator", "Trade against simulated prices even when the broker is connected", toggleControl("forceDemo", () => renderSettingsTab(root))),
      row("Access code", s.accessRequired ? "This deployment requires the shared access code" : "Not required by the server", el("button", {
        class: "btn btn-sm",
        text: api.getAccessCode() ? "Change code" : "Set code",
        onclick: () => openAccessCodeDialog(),
      })),
      row("Test connection", "Log in and fetch account details", el("button", {
        class: "btn btn-sm btn-primary",
        text: "Run test",
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Testing…";
          try {
            const fresh = await api.getStatus(true);
            if (!fresh.configured && !settings.get().forceDemo) {
              throw new Error("Server has no Capital.com credentials configured");
            }
            const accounts = await api.getAccounts();
            const acc = api.preferredAccount(accounts);
            toast(`Connected — account ${acc?.accountName || "?"} · balance ${fmt.money(acc?.balance?.balance ?? 0, acc?.currency || "GBP")}`, "success", 6000);
          } catch (err) {
            toast(`Connection test failed: ${err.message}`, "error", 8000);
          } finally {
            e.target.disabled = false;
            e.target.textContent = "Run test";
          }
        },
      })),
      el("p", {
        class: "hint",
        style: { marginTop: "10px" },
        text: "Credentials (API key, identifier, API password) live on the server only — they are never sent to your browser. See the README for how to add them.",
      }),
    );
  });

  return box;
}

function openAccessCodeDialog() {
  const input = el("input", { class: "input", type: "password", placeholder: "Access code", value: api.getAccessCode() });
  modal({
    title: "Access code",
    body: el("div", {}, [
      el("p", { class: "hint", text: "If the deployment is protected with APP_ACCESS_CODE, enter it here. It is stored in this browser tab's session only." }),
      el("div", { class: "field" }, [el("label", { text: "Code" }), input]),
    ]),
    actions: [
      {
        label: "Clear",
        class: "btn-ghost",
        onClick: () => {
          api.setAccessCode("");
          toast("Access code cleared", "info");
        },
      },
      {
        label: "Save",
        class: "btn-primary",
        onClick: () => {
          api.setAccessCode(input.value.trim());
          toast("Access code saved for this session", "success");
          api.getStatus(true).then(() => renderSettingsTab(root));
        },
      },
    ],
  });
}

/* ----------------------------- trading defaults ---------------------------- */

function buildTradingDefaults() {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Trading defaults" })]),
    el("div", { class: "panel-body" }, [
      row("Confirm before trading", "Show a confirmation dialog before any order is sent", toggleControl("confirmTrades")),
      row("Default risk per trade", "Used by the position size calculator", numberControl("defaultRiskPercent", { step: 0.1, suffix: "% of balance" })),
      row("Default order size", "Pre-filled in the deal ticket", numberControl("defaultSize", { step: 0.01 })),
      row("Poll interval", "How often prices and positions refresh (Capital.com allows 10 req/s)", numberControl("pollSeconds", { step: 1, suffix: "seconds" })),
      row("Alert sound", "Play a beep when a price alert triggers", toggleControl("soundOn")),
    ]),
  ]);
}

/* -------------------------------- appearance ------------------------------ */

function buildAppearance() {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Chart & appearance" })]),
    el("div", { class: "panel-body" }, [
      row("Theme", "Dark is easier on the eyes in class 😎", selectControl("theme", [["dark", "Dark"], ["light", "Light"]])),
      row("Default chart type", "Applied when the chart loads", selectControl("chartType", [["candles", "Candles"], ["bars", "Bars"], ["line", "Line"], ["area", "Area"]])),
      row("Default timeframe", "Applied when switching markets", selectControl("defaultTimeframe", [["MINUTE", "1m"], ["MINUTE_5", "5m"], ["MINUTE_15", "15m"], ["MINUTE_30", "30m"], ["HOUR", "1h"], ["HOUR_4", "4h"], ["DAY", "1D"], ["WEEK", "1W"]])),
      row("Volume pane", "Show volume bars under the price chart", toggleControl("showVolume")),
      row("Chart engine", "Desk Chart = built-in TradingView Lightweight Charts; Widget = full TradingView Supercharts", selectControl("chartEngine", [["pro", "Desk Chart"], ["tv", "TradingView Widget"]])),
      row("Base currency", "Used for journal and analytics totals", selectControl("baseCurrency", [["GBP", "GBP £"], ["USD", "USD $"], ["EUR", "EUR €"], ["AUD", "AUD"], ["CAD", "CAD"]])),
    ]),
  ]);
}

/* ----------------------------------- data --------------------------------- */

function buildDataCard() {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Your data" })]),
    el("div", { class: "panel-body" }, [
      el("p", { class: "hint", text: `Journal: ${journal.list().length} trades · Watchlist: ${wlStore.list().length} markets · Alerts: ${alertStore.list().length}. Everything is stored locally in this browser — export regularly if the journal matters to you (college machines may wipe browser data).` }),
      el("div", { class: "chips", style: { margin: "10px 0" } }, [
        el("button", {
          class: "btn",
          text: "⤓ Export everything (JSON)",
          onclick: () => {
            downloadText(`tradingdesk-backup-${Date.now()}.json`, JSON.stringify(exportAll(), null, 2), "application/json");
            toast("Backup downloaded", "success");
          },
        }),
        el("button", {
          class: "btn",
          text: "⤒ Import backup",
          onclick: () => {
            const input = el("input", { type: "file", accept: "application/json,.json" });
            input.onchange = async () => {
              const file = input.files[0];
              if (!file) return;
              try {
                importAll(JSON.parse(await file.text()));
                toast("Backup restored", "success");
              } catch (err) {
                toast(`Import failed: ${err.message}`, "error");
              }
            };
            input.click();
          },
        }),
      ]),
      el("div", { class: "chips" }, [
        el("button", {
          class: "btn btn-danger",
          text: "Reset simulator account",
          onclick: async () => {
            const ok = await confirmDialog({
              title: "Reset simulator",
              message: "Reset the simulated account back to its starting balance and clear simulated positions/orders? Journal entries are kept.",
              confirmText: "Reset simulator",
              danger: true,
            });
            if (ok) {
              api.demoReset();
              toast("Simulator reset", "success");
            }
          },
        }),
        el("button", {
          class: "btn btn-danger",
          text: "Clear journal",
          onclick: async () => {
            const ok = await confirmDialog({ title: "Clear journal", message: `Delete all ${journal.list().length} journal entries? This cannot be undone (export a backup first).`, confirmText: "Delete all", danger: true });
            if (ok) {
              journal.clear();
              toast("Journal cleared", "info");
            }
          },
        }),
        el("button", {
          class: "btn btn-danger",
          text: "Factory reset",
          onclick: async () => {
            const ok = await confirmDialog({ title: "Factory reset", message: "Wipe ALL local data: journal, watchlist, alerts, settings and simulator state?", confirmText: "Wipe everything", danger: true });
            if (ok) {
              localStorage.clear();
              location.reload();
            }
          },
        }),
      ]),
    ]),
  ]);
}

/* --------------------------------- security ------------------------------- */

function buildSecurityCard() {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "Security & how this works" })]),
    el("div", { class: "panel-body" }, [
      el("ul", { class: "hint", style: { lineHeight: "1.9", paddingLeft: "18px" } }, [
        el("li", { text: "Your Capital.com API key, login and API password are stored on the server (environment secrets) — never in this page, and never visible to the browser." }),
        el("li", { text: "The browser talks only to this app's own /api routes; the server opens the authenticated Capital.com session and keeps its tokens." }),
        el("li", { text: "Optionally set APP_ACCESS_CODE on the server so only you can use the deployment, even if the URL leaks." }),
        el("li", { text: "Journal/analytics data lives in this browser's localStorage. Export backups regularly." }),
        el("li", { text: "Always use the Capital.com DEMO environment while learning this tool. CFD trading carries a high risk of rapid losses." }),
      ]),
    ]),
  ]);
}

function buildAboutCard() {
  return el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("h3", { text: "About" })]),
    el("div", { class: "panel-body" }, [
      el("p", { class: "hint", style: { lineHeight: "1.8" } }, [
        el("strong", { text: "TradingDesk v1.0 " }),
        document.createTextNode("— charts, execution, journal and analytics in one browser tab."),
      ]),
      el("p", { class: "hint", style: { lineHeight: "1.8" } }, [
        document.createTextNode("Charts rendered with "),
        el("a", { href: "https://www.tradingview.com/lightweight-charts/", target: "_blank", rel: "noopener", text: "TradingView Lightweight Charts™" }),
        document.createTextNode(" (Apache 2.0). The optional TradingView widget is provided by TradingView®. Trading data via the "),
        el("a", { href: "https://open-api.capital.com/", target: "_blank", rel: "noopener", text: "Capital.com API" }),
        document.createTextNode("."),
      ]),
      el("p", { class: "hint", style: { lineHeight: "1.8" } }, [
        document.createTextNode("Note on saved TradingView indicators: TradingView does not allow third-party apps to read your private Pine Script indicators — that is a TradingView platform restriction, not a limitation of this app. The Desk Chart engine ships with 22 built-in studies you can configure and save, and the TradingView Widget mode gives you TradingView's own indicator library inside Supercharts."),
      ]),
    ]),
  ]);
}
