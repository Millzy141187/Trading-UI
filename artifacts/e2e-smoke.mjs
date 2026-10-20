/**
 * End-to-end smoke test for TradingDesk.
 * Drives the real UI in headless Chromium against the local dev server.
 * Uses a persistent profile so app state (localStorage) survives a browser
 * crash/relaunch between phases.
 */
import { chromium } from "playwright";
import { rmSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PROFILE = "artifacts/.pw-profile";
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

if (process.env.FRESH_PROFILE) rmSync(PROFILE, { recursive: true, force: true });

let context = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 1600, height: 950 },
  args: ["--disable-gpu", "--disable-dev-shm-usage"],
});
let page = context.pages()[0] || (await context.newPage());

const pageErrors = [];
function wireErrors(p) {
  p.on("pageerror", (err) => pageErrors.push(String(err)));
  p.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console.error: ${msg.text()}`);
  });
}
wireErrors(page);

async function ensurePage() {
  // page.isClosed() stays false when the browser process dies, so probe it
  try {
    if (page && !page.isClosed()) {
      await Promise.race([
        page.evaluate(() => 1),
        new Promise((_, rej) => setTimeout(() => rej(new Error("probe timeout")), 3000)),
      ]);
      return page;
    }
  } catch {
    /* dead — fall through to relaunch */
  }
  try {
    await context.close();
  } catch {
    /* already closed */
  }
  context = await chromium.launchPersistentContext(PROFILE, {
    viewport: { width: 1600, height: 950 },
    args: ["--disable-gpu", "--disable-dev-shm-usage"],
  });
  page = context.pages()[0] || (await context.newPage());
  wireErrors(page);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForSelector(".app-header", { timeout: 10000 });
  return page;
}

async function step(name, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensurePage();
      await fn(page);
      return;
    } catch (err) {
      const crashed = /closed|crash/i.test(String(err));
      if (crashed && attempt === 0) continue; // relaunch and retry once
      check(name, false, String(err).slice(0, 250));
      await page.screenshot({ path: "artifacts/shot-failure.png", fullPage: true }).catch(() => {});
      return;
    }
  }
}

async function gotoTab(p, name) {
  const active = await p.locator(`#tab-${name}.active`).count();
  if (!active) await p.click(`[data-tab="${name}"]`);
  await p.waitForSelector(`#tab-${name}.active`, { timeout: 5000 });
}

try {
  /* ---------------- boot ---------------- */
  await step("page loads with header", async (p) => {
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
    await p.waitForSelector(".app-header", { timeout: 10000 });
    check("page loads with header", true);
  });

  await step("mode pill + account pill resolve", async (p) => {
    await p.waitForFunction(
      () => {
        const el = document.getElementById("mode-pill");
        return el && el.textContent.trim() && !el.textContent.includes("loading");
      },
      { timeout: 10000 },
    );
    const mode = (await p.textContent("#mode-pill")).trim();
    check("mode pill resolves", /SIMULATED|CAPITAL/i.test(mode), mode);
    await p.waitForFunction(
      () => /[\d,]/.test(document.getElementById("acc-balance")?.textContent || ""),
      { timeout: 10000 },
    );
    const bal = (await p.textContent("#acc-balance")).trim();
    check("account pill shows balance", /[\d,]/.test(bal), bal);
  });

  /* ---------------- trade tab (default) ---------------- */
  await step("chart renders", async (p) => {
    await p.waitForSelector("#chart-host", { timeout: 10000 });
    await p.waitForFunction(
      () => document.querySelectorAll("#chart-host canvas").length > 0,
      { timeout: 15000 },
    );
    const n = await p.locator("#chart-host canvas").count();
    check("chart renders canvas panes", n > 0, `${n} canvas element(s)`);
  });

  await step("trade watchlist + symbol strip", async (p) => {
    await p.waitForSelector(".wl-row", { timeout: 10000 });
    const rows = await p.locator(".wl-row").count();
    check("trade watchlist populated", rows > 0, `${rows} rows`);
    await p.waitForFunction(
      () => /\d/.test(document.getElementById("strip-price")?.textContent || ""),
      { timeout: 10000 },
    );
    check("symbol strip shows price", true, (await p.textContent("#strip-price")).trim());
  });

  /* ---------------- place a simulated trade ---------------- */
  await step("place simulated order", async (p) => {
    await p.waitForSelector("#ticket-body", { timeout: 10000 });
    const before = await p.locator("#bottom-body .data-table tbody tr").count();
    const sizeInput = p.locator("#ticket-body input[type=number]").first();
    await sizeInput.fill("1");
    await p.locator("#ticket-body .btn-buy").first().click();
    // confirmation modal may appear
    try {
      await p.locator(".modal-overlay .modal-foot button", { hasText: /place/i }).first().click({ timeout: 3000 });
    } catch {
      /* no confirmation modal */
    }
    await p.waitForFunction(
      (prev) => document.querySelectorAll("#bottom-body .data-table tbody tr").length > prev,
      before,
      { timeout: 10000 },
    ).catch(() => {});
    const after = await p.locator("#bottom-body .data-table tbody tr").count();
    check("order flow completed", after > before, `positions rows ${before} -> ${after}`);
  });

  /* ---------------- watchlist tab ---------------- */
  await step("watchlist tab", async (p) => {
    await gotoTab(p, "watchlist");
    await p.waitForSelector("#wl-board", { timeout: 10000 });
    await p.waitForTimeout(1200);
    const nodes = await p.locator("#wl-board .data-table tbody tr, #wl-board .wl-row, #wl-board > *").count();
    check("watchlist tab renders board", nodes > 0, `${nodes} nodes`);
    await p.screenshot({ path: "artifacts/shot-watchlist.png" });
  });

  /* ---------------- journal tab ---------------- */
  let journalRows = 0;
  await step("journal tab renders", async (p) => {
    await gotoTab(p, "journal");
    await p.waitForSelector("#journal-stats", { timeout: 10000 });
    const kpis = await p.locator("#journal-stats .kpi").count();
    check("journal tab renders KPIs", kpis > 0, `${kpis} KPIs`);
  });

  await step("add manual journal trade", async (p) => {
    await gotoTab(p, "journal");
    const before = await p.locator("#tab-journal .data-table tbody tr").count();
    await p.locator("button", { hasText: /add trade/i }).first().click();
    await p.waitForSelector(".modal-overlay", { timeout: 5000 });
    const modal = p.locator(".modal-overlay").last();
    await modal.locator("input[type=text], input:not([type])").first().fill("E2E TEST").catch(() => {});
    const nums = modal.locator("input[type=number]");
    for (const [i, v] of [[0, 1], [1, 100], [2, 110], [3, 10]].entries()) {
      await nums.nth(i).fill(String(v)).catch(() => {});
    }
    await modal.locator(".modal-foot button", { hasText: /add to journal|save/i }).first().click().catch(() => {});
    await p.waitForTimeout(1200);
    journalRows = await p.locator("#tab-journal .data-table tbody tr").count();
    check("journal records a trade", journalRows > before, `rows ${before} -> ${journalRows}`);
    await p.screenshot({ path: "artifacts/shot-journal.png" });
  });

  /* ---------------- analytics tab ---------------- */
  await step("analytics tab", async (p) => {
    await gotoTab(p, "analytics");
    await p.waitForSelector("#analytics-kpis", { timeout: 10000 });
    await p.waitForTimeout(900);
    const kpis = await p.locator("#analytics-kpis .kpi").count();
    check("analytics tab renders KPIs", kpis > 0, `${kpis} KPIs`);
    const canvases = await p.locator("#analytics-charts canvas").count();
    check("analytics draws charts", canvases > 0, `${canvases} canvases`);
    await p.screenshot({ path: "artifacts/shot-analytics.png" });
  });

  /* ---------------- settings tab ---------------- */
  await step("settings tab", async (p) => {
    await gotoTab(p, "settings");
    await p.waitForSelector(".settings-grid", { timeout: 10000 });
    const cards = await p.locator(".settings-grid > *").count();
    check("settings tab renders cards", cards > 0, `${cards} cards`);
    await p.screenshot({ path: "artifacts/shot-settings.png" });
  });

  /* ---------------- back to trade tab ---------------- */
  await step("tab routing returns to trade", async (p) => {
    await gotoTab(p, "trade");
    await p.waitForSelector("#tab-trade.active", { timeout: 5000 });
    check("tab routing returns to trade", true);
    await p.waitForTimeout(800);
    await p.screenshot({ path: "artifacts/shot-trade.png" });
  });

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  check("smoke test completed without exception", false, String(err).slice(0, 250));
}

await context.close().catch(() => {});

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
