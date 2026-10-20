/** Screenshot the start screen (signed-out state). */
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" });
// make sure we are signed out (fresh incognito-like context has no profile)
await page.waitForSelector("#start-wrap .start-card", { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: "artifacts/shot-start.png" });
await browser.close();
console.log("saved artifacts/shot-start.png");
