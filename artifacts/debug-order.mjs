/** Focused debug: place an order and dump what actually happens. */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#ticket-body");
await page.waitForFunction(() => /\d/.test(document.getElementById("strip-price")?.textContent || ""));

// fill size
const nums = page.locator("#ticket-body input[type=number]");
console.log("number inputs in ticket:", await nums.count());
for (let i = 0; i < await nums.count(); i++) {
  console.log(`  input[${i}] id=${await nums.nth(i).getAttribute("id")} value=${await nums.nth(i).inputValue()}`);
}

await page.locator("#ticket-body .btn-buy").first().click();
await page.waitForTimeout(600);
const modalCount = await page.locator(".modal-overlay").count();
console.log("modal overlays after BUY click:", modalCount);
if (modalCount) {
  const buttons = await page.locator(".modal-overlay .modal-foot button").allTextContents();
  console.log("modal buttons:", JSON.stringify(buttons));
  await page.locator(".modal-overlay .modal-foot button", { hasText: /place/i }).first().click();
  await page.waitForTimeout(2500);
}
const toasts = await page.locator(".toast-root > *").allTextContents().catch(() => []);
console.log("toasts:", JSON.stringify(toasts));
const demo = await page.evaluate(() => localStorage.getItem("td.v1.demo"));
console.log("demo state:", (demo || "").slice(0, 300));
const rows = await page.locator("#bottom-body .data-table tbody tr").count();
console.log("position rows:", rows);
const bottom = await page.locator("#bottom-body").innerText().catch(() => "(none)");
console.log("bottom body:", bottom.slice(0, 300).replace(/\n/g, " | "));

await browser.close();
