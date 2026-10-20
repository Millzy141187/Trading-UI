/**
 * Start screen: the login page shown before the app loads.
 *
 * Handles local profile sign-in / creation (optional PIN + remember-me), the
 * shared deployment access code when the server requires one, and the
 * "Continue with TradingView" flow.
 *
 * A note on TradingView: they do not offer third-party OAuth ("Sign in with
 * TradingView" for apps does not exist). The honest integration is to open
 * their official sign-in page, then run the embedded TradingView chart which
 * picks up the browser's TradingView session — that is how your saved
 * indicators and layouts become reachable. We never see TradingView
 * credentials.
 */

import { $, el, toast } from "./util.js";
import * as api from "./api.js";
import * as auth from "./auth.js";

const TV_SIGN_IN_URL = "https://www.tradingview.com/accounts/signin/";

let root = null;

export function renderStartScreen(container, { onEnter } = {}) {
  root = container;
  container.innerHTML = "";
  container.classList.add("start-screen");

  const status = { accessRequired: false };

  /* ------------------------------ left: brand ----------------------------- */

  const hero = el("div", { class: "start-hero" }, [
    el("div", { class: "start-hero-inner" }, [
      el("div", { class: "start-brand" }, [
        svg(`<svg viewBox="0 0 32 32" class="brand-logo" width="44" height="44" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent-dim)"/><path d="M6 22 L12 14 L17 18 L26 8" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="8" r="3" fill="var(--accent)"/></svg>`),
        el("div", {}, [
          el("h1", { text: "TradingDesk", class: "start-title" }),
          el("p", { text: "Charts · Trading · Journal · Analytics", class: "start-tagline" }),
        ]),
      ]),
      el("ul", { class: "start-features" }, [
        feature("📈", "TradingView-powered charts", "Lightweight Charts with 24 indicators, or full TradingView Supercharts"),
        feature("⚡", "Trade with your Capital.com key", "Market, limit & stop orders with SL/TP — tickets just like MT4/5"),
        feature("📓", "Journal & performance analytics", "Track every trade, tag mistakes, watch your equity curve grow"),
        feature("🛡️", "Your keys stay on the server", "Capital.com credentials never reach the browser"),
      ]),
      el("div", { class: "start-hero-foot" }, [
        el("span", { class: "pill pill-warn", text: "Simulated mode available — no keys needed" }),
      ]),
    ]),
  ]);

  /* ----------------------------- right: auth card -------------------------- */

  const nameInput = el("input", {
    class: "input input-lg",
    placeholder: "e.g. Alex",
    autocomplete: "username",
    maxlength: 40,
  });
  const pinInput = el("input", {
    class: "input input-lg",
    type: "password",
    placeholder: "Optional PIN (4–10 digits)",
    autocomplete: "current-password",
    inputmode: "numeric",
    maxlength: 10,
  });
  const accessInput = el("input", {
    class: "input input-lg",
    type: "password",
    placeholder: "Access code",
    autocomplete: "current-password",
    hidden: true,
  });
  const rememberInput = el("input", { type: "checkbox", checked: true });
  const errorBox = el("div", { class: "start-error", hidden: true });
  const profileList = el("div", { class: "start-profiles" });

  const signInBtn = el("button", {
    class: "btn btn-primary btn-lg btn-block",
    text: "Sign in",
    onclick: () => signIn({ viaTv: false }),
  });
  const tvBtn = el("button", {
    class: "btn btn-tv btn-lg btn-block",
    onclick: () => signIn({ viaTv: true }),
  }, [
    tvLogo(),
    el("span", { text: "Continue with TradingView" }),
  ]);
  const guestBtn = el("button", {
    class: "btn btn-ghost btn-block",
    text: "Skip — explore in simulated mode",
    onclick: () => enter({ name: "Guest" }),
  });

  const card = el("div", { class: "start-card" }, [
    el("h2", { text: "Sign in", class: "start-card-title" }),
    el("p", {
      class: "hint",
      text: "Profiles are stored on this device only (college PCs may wipe them — export your journal from Settings).",
    }),
    profileList,
    el("div", { class: "field" }, [el("label", { text: "Name" }), nameInput]),
    el("div", { class: "field" }, [el("label", { text: "PIN" }), pinInput]),
    el("div", { class: "field", id: "access-field", hidden: true }, [
      el("label", { text: "Access code" }),
      accessInput,
    ]),
    el("label", { class: "checkbox-row" }, [
      rememberInput,
      el("span", { text: "Remember me on this device" }),
    ]),
    errorBox,
    el("div", { class: "start-actions" }, [
      signInBtn,
      el("div", { class: "start-divider" }, [el("span", { text: "or" })]),
      tvBtn,
      el("p", {
        class: "hint start-tv-note",
        text: "Opens TradingView's own sign-in page — we never see your TradingView password. After signing in, the TradingView chart unlocks your saved indicators & layouts.",
      }),
      guestBtn,
    ]),
  ]);

  container.append(hero, el("div", { class: "start-card-wrap" }, [card]));

  /* ------------------------------- behaviour ------------------------------ */

  function showError(msg) {
    errorBox.hidden = !msg;
    errorBox.textContent = msg || "";
  }

  function fillProfileList() {
    profileList.innerHTML = "";
    const profiles = auth.getProfiles();
    if (!profiles.length) return;
    profileList.append(el("div", { class: "start-existing", text: "Existing profiles on this device:" }));
    for (const p of profiles) {
      profileList.append(
        el("button", {
          class: "start-profile-chip",
          onclick: () => {
            nameInput.value = p.name;
            pinInput.value = "";
            pinInput.focus();
            showError("");
          },
        }, [
          el("span", { text: p.name }),
          p.pinHash ? el("span", { class: "faint", text: "🔒" }) : null,
          p.tv?.connected ? el("span", { class: "faint", text: "TV" }) : null,
        ]),
      );
    }
  }

  async function signIn({ viaTv }) {
    showError("");
    const name = nameInput.value.trim();
    const pin = pinInput.value.trim();

    if (!name) {
      showError("Enter a name to continue.");
      nameInput.focus();
      return;
    }
    if (pin && !/^\d{4,10}$/.test(pin)) {
      showError("PIN must be 4–10 digits (or leave it blank).");
      pinInput.focus();
      return;
    }

    signInBtn.disabled = true;
    tvBtn.disabled = true;
    try {
      // 1. access code gate (only when the deployment requires one)
      if (status.accessRequired) {
        const code = accessInput.value.trim();
        if (!code) {
          showError("This deployment requires the access code.");
          return;
        }
        if (!(await auth.verifyAccessCode(code))) {
          showError("Access code rejected.");
          return;
        }
        api.setAccessCode(code);
      }

      // 2. find or create the local profile
      const existing = auth.getProfiles().find((p) => p.name.toLowerCase() === name.toLowerCase());
      let profile;
      if (existing) {
        if (!(await auth.verifyPin(existing, pin))) {
          showError(existing.pinHash ? "Wrong PIN for this profile." : "This profile has no PIN — leave PIN blank.");
          return;
        }
        auth.activateProfile(existing.id, rememberInput.checked);
        profile = existing;
      } else {
        profile = await auth.createProfile({ name, pin, remember: rememberInput.checked });
      }

      // 3. TradingView connect flow
      if (viaTv) {
        auth.markTradingViewConnected(profile.id);
        auth.queueTradingViewConnect();
        window.open(TV_SIGN_IN_URL, "_blank", "noopener");
      }

      // 4. reload so the whole app boots in this profile's storage scope
      location.reload();
    } catch (err) {
      showError(err.message);
    } finally {
      signInBtn.disabled = false;
      tvBtn.disabled = false;
    }
  }

  async function enter({ name }) {
    try {
      const existing = auth.getProfiles().find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        auth.activateProfile(existing.id, true);
      } else {
        await auth.createProfile({ name, remember: true });
      }
      onEnter?.();
      location.reload();
    } catch (err) {
      showError(err.message);
    }
  }

  // probe the server for the access-code requirement
  api.getStatus().then((s) => {
    status.accessRequired = Boolean(s.accessRequired);
    if (status.accessRequired) {
      const field = root?.querySelector("#access-field");
      if (field) field.hidden = false;
    }
  });

  fillProfileList();
  nameInput.focus();
}

/* --------------------------------- pieces --------------------------------- */

function feature(icon, title, sub) {
  return el("li", {}, [
    el("span", { class: "start-feature-icon", text: icon }),
    el("div", {}, [
      el("strong", { text: title }),
      el("span", { text: sub }),
    ]),
  ]);
}

function tvLogo() {
  return svg(`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 6h7.5a4 4 0 0 1 3.9 3.1L15.6 6h5.4l-4.3 9h-4.2l.6-1.3a2.6 2.6 0 0 0-2.4-3.6H5.4L3 6Zm5.3 2.4 1.4 3H6.9l-.6-1.3-.2-.7h2.2Z"/></svg>`);
}

/** Real SVG namespace — el() uses createElement, which can't build SVG. */
function svg(markup) {
  const wrap = document.createElement("div");
  wrap.innerHTML = markup.trim();
  return wrap.firstElementChild;
}
