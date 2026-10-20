/** Verifies the two remaining core requirements: indicators + TradingView engine. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
  // sign in through the start screen when no session is remembered
  const startVisible = await page.locator("#start-wrap .start-card").isVisible().catch(() => false);
  if (startVisible) {
    await page.locator(".start-card .input-lg").first().fill("E2E Trader");
    await page.locator(".start-card button", { hasText: /^sign in$/i }).first().click();
  }
  await page.waitForSelector("#chart-host canvas", { timeout: 15000 });

  /* ---- 1. add an indicator (RSI) ---- */
  const fxBtn = page.locator(".chart-toolbar button", { hasText: /indicators/i }).first();
  await fxBtn.click({ timeout: 5000 });
  await page.waitForSelector(".indicator-menu", { timeout: 5000 });
  const menuItems = await page.locator(".indicator-menu .ind-menu-item").count();
  check("indicator menu opens with items", menuItems > 5, `${menuItems} indicators listed`);
  // search for RSI then add it
  await page.locator(".indicator-menu input").fill("RSI");
  await page.waitForTimeout(300);
  const rsiBtn = page.locator(".indicator-menu .ind-menu-item", { hasText: /rsi/i }).first();
  const hasRsi = await rsiBtn.count();
  check("indicator menu lists RSI", hasRsi > 0);
  if (hasRsi) {
    await rsiBtn.click();
    await page.waitForTimeout(1200);
    // RSI renders in its own pane: pane count grows beyond main+volume
    const panes = await page.locator("#chart-host .chart-pane").count();
    check("RSI adds a sub-pane to the chart", panes >= 3, `${panes} panes`);
    const chip = await page.locator("#ind-chips").textContent().catch(() => "");
    check("indicator chip shown in toolbar", /rsi/i.test(chip || ""), (chip || "").trim());
    await page.screenshot({ path: "artifacts/shot-indicator.png" });
  }

  /* ---- 2. switch to the TradingView widget engine ---- */
  const tvBtn = page.locator("button", { hasText: /tradingview widget/i }).first();
  await tvBtn.click({ timeout: 5000 });
  await page.waitForTimeout(4000); // iframe loads from tradingview.com
  const frames = page.frames().map((f) => f.url());
  const tvFrame = frames.some((u) => /tradingview\.com|widgetembed/i.test(u));
  const tvHtml = await page.locator("#chart-host").innerHTML().catch(() => "");
  check(
    "TradingView widget engine embeds the TradingView chart",
    tvFrame || /tradingview|widgetembed/i.test(tvHtml),
    tvFrame ? `iframe: ${frames.find((u) => /tradingview/i.test(u)).slice(0, 80)}` : "embed markup present",
  );
  await page.screenshot({ path: "artifacts/shot-tv-widget.png" });

  // switch back to the built-in engine
  const proBtn = page.locator("button", { hasText: /desk chart/i }).first();
  await proBtn.click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  check("switch back to Desk Chart works", (await page.locator("#chart-host canvas").count()) > 0);

  check("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  check("verification completed without exception", false, String(err).slice(0, 250));
  await page.screenshot({ path: "artifacts/shot-extras-failure.png" }).catch(() => {});
}

await browser.close();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
