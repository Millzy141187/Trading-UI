/**
 * Local development server.
 *
 * - serves ./public as static files
 * - routes /api/* through the exact same Worker handler used in deployment
 *
 * Usage:  node server.mjs   (or: npm run dev)
 * Env:    PORT=3000 and the CAPITAL_* / APP_ACCESS_CODE variables.
 *         Values can also be placed in ./.dev.vars (KEY=value lines).
 */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import worker from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

// Load .dev.vars (KEY=value, # comments) without overwriting real env vars.
try {
  const raw = await readFile(path.join(__dirname, ".dev.vars"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
  console.log("[dev] loaded .dev.vars");
} catch {
  /* no .dev.vars is fine */
}

const env = {
  CAPITAL_API_KEY: process.env.CAPITAL_API_KEY || "",
  CAPITAL_IDENTIFIER: process.env.CAPITAL_IDENTIFIER || "",
  CAPITAL_PASSWORD: process.env.CAPITAL_PASSWORD || "",
  CAPITAL_ENV: process.env.CAPITAL_ENV || "demo",
  APP_ACCESS_CODE: process.env.APP_ACCESS_CODE || "",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.includes("..")) {
    send(res, 403, { "content-type": "text/plain" }, "Forbidden");
    return;
  }
  if (rel === "/") rel = "/index.html";
  let filePath = path.join(PUBLIC_DIR, rel);
  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      info = await stat(filePath);
    }
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(
      res,
      200,
      {
        "content-type": MIME[ext] || "application/octet-stream",
        "content-length": data.length,
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
      data,
    );
  } catch {
    // SPA fallback: unknown paths without an extension get index.html
    if (!path.extname(rel)) {
      try {
        const data = await readFile(path.join(PUBLIC_DIR, "index.html"));
        send(res, 200, { "content-type": MIME[".html"], "cache-control": "no-cache" }, data);
        return;
      } catch {
        /* fall through */
      }
    }
    send(res, 404, { "content-type": "text/plain" }, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const method = req.method || "GET";
      const init = { method, headers };
      if (!["GET", "HEAD"].includes(method)) {
        init.body = Readable.toWeb(req);
        init.duplex = "half";
      }
      const request = new Request(url.toString(), init);
      const response = await worker.fetch(request, env);
      const outHeaders = {};
      response.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });
      const buf = Buffer.from(await response.arrayBuffer());
      send(res, response.status, outHeaders, buf);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error("[dev] error:", err);
    send(res, 500, { "content-type": "application/json" }, JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[dev] TradingDesk running at http://${HOST}:${PORT}`);
  console.log(
    `[dev] Capital.com ${env.CAPITAL_ENV} mode - credentials ${
      env.CAPITAL_API_KEY ? "configured" : "NOT configured (app runs in simulated demo mode)"
    }`,
  );
});
