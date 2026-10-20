/** Focused debug: click the journal tab and capture crash details. */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on("crash", () => console.log("!!! PAGE CRASHED !!!"));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 300)));
page.on("console", (m) => console.log(`CONSOLE[${m.type()}]:`, m.text().slice(0, 200)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector(".app-header");
await page.waitForFunction(() => /\d/.test(document.getElementById("strip-price")?.textContent || ""));
console.log("--- clicking journal tab ---");
try {
  await page.click('[data-tab="journal"]', { timeout: 8000 });
  await page.waitForTimeout(2500);
  console.log("journal active:", await page.locator("#tab-journal.active").count());
  console.log("journal rows:", await page.locator("#tab-journal .data-table tbody tr").count());
} catch (e) {
  console.log("JOURNAL CLICK FAILED:", String(e).slice(0, 200));
}
console.log("--- clicking settings tab ---");
try {
  await page.click('[data-tab="settings"]', { timeout: 8000 });
  await page.waitForTimeout(2500);
  console.log("settings active:", await page.locator("#tab-settings.active").count());
} catch (e) {
  console.log("SETTINGS CLICK FAILED:", String(e).slice(0, 200));
}
console.log("--- clicking journal tab again ---");
try {
  await page.click('[data-tab="journal"]', { timeout: 8000 });
  await page.waitForTimeout(2000);
  console.log("journal active 2:", await page.locator("#tab-journal.active").count());
} catch (e) {
  console.log("JOURNAL CLICK 2 FAILED:", String(e).slice(0, 200));
}
await browser.close();
