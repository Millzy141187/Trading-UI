/**
 * TradingDesk backend.
 *
 * Runs as a Cloudflare Worker (default export) and is also imported by the
 * local Node dev server (server.mjs), so there is exactly one implementation
 * of the Capital.com proxy.
 *
 * Responsibilities:
 *   - serve /api/status (configuration probe, never leaks secrets)
 *   - proxy /api/capital/* to the Capital.com REST API with a managed session
 *     (CST + X-SECURITY-TOKEN stay server-side and never reach the browser)
 *   - optional shared access code (APP_ACCESS_CODE) so a public deployment
 *     cannot be used by strangers to trade the owner's account
 *
 * Secrets are read from the environment (Cloudflare Worker secrets, or
 * process.env for the local dev server):
 *   CAPITAL_API_KEY      - Capital.com API key
 *   CAPITAL_IDENTIFIER   - Capital.com login e-mail
 *   CAPITAL_PASSWORD     - API-key password (not the account login password)
 *   CAPITAL_ENV          - "demo" (default) or "live"
 *   APP_ACCESS_CODE      - optional shared password for using the app
 */

const LIVE_BASE = "https://api-capital.backend-capital.com";
const DEMO_BASE = "https://demo-api-capital.backend-capital.com";

const SESSION_TTL_MS = 8 * 60 * 1000; // re-ping / re-login well before 10 min
const APP_VERSION = "1.0.0";

/** @type {{cst:string, token:string, expires:number, base:string} | null} */
let session = null;

function baseFor(env) {
  const mode = String(env?.CAPITAL_ENV || "demo").toLowerCase();
  return mode === "live" ? LIVE_BASE : DEMO_BASE;
}

function isConfigured(env) {
  return Boolean(env?.CAPITAL_API_KEY && env?.CAPITAL_IDENTIFIER && env?.CAPITAL_PASSWORD);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

/* ------------------------------------------------------------------ */
/* Capital.com session management                                      */
/* ------------------------------------------------------------------ */

async function createSession(env) {
  const base = baseFor(env);
  const res = await fetch(`${base}/api/v1/session`, {
    method: "POST",
    headers: {
      "X-CAP-API-KEY": env.CAPITAL_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      identifier: env.CAPITAL_IDENTIFIER,
      password: env.CAPITAL_PASSWORD,
    }),
  });
  const text = await res.text();
  const body = parseBody(text);
  if (!res.ok) {
    return { error: body, status: res.status };
  }
  const cst = res.headers.get("CST");
  const token = res.headers.get("X-SECURITY-TOKEN");
  if (!cst || !token) {
    return { error: { errorCode: "error.session.tokens.missing" }, status: 502 };
  }
  session = { cst, token, expires: Date.now() + SESSION_TTL_MS, base };
  return { session, body };
}

async function ensureSession(env) {
  const base = baseFor(env);
  if (session && session.base === base && Date.now() < session.expires) {
    return { session };
  }
  if (session && session.base === base) {
    // Try the documented keep-alive before logging in again.
    try {
      const res = await fetch(`${base}/api/v1/ping`, {
        headers: { CST: session.cst, "X-SECURITY-TOKEN": session.token },
      });
      if (res.ok) {
        session.expires = Date.now() + SESSION_TTL_MS;
        return { session };
      }
    } catch {
      /* fall through to login */
    }
  }
  session = null;
  return createSession(env);
}

async function capitalFetch(env, path, init = {}) {
  const ensured = await ensureSession(env);
  if (ensured.error) {
    return json(
      { errorCode: "error.session.login.failed", detail: ensured.error },
      502,
    );
  }
  const base = ensured.session.base;
  const doFetch = (s) =>
    fetch(`${base}/api/v1/${path}`, {
      method: init.method || "GET",
      headers: {
        CST: s.cst,
        "X-SECURITY-TOKEN": s.token,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body,
    });

  let res = await doFetch(ensured.session);
  if (res.status === 401) {
    // Session invalidated server-side: log in once and retry.
    session = null;
    const retry = await createSession(env);
    if (retry.error) {
      return json({ errorCode: "error.session.login.failed", detail: retry.error }, 502);
    }
    res = await doFetch(retry.session);
  }
  if (res.status === 204) return new Response(null, { status: 204 });

  const text = await res.text();
  const body = parseBody(text);
  return json(body ?? {}, res.status);
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

function accessCheck(request, env) {
  const code = env?.APP_ACCESS_CODE;
  if (!code) return null;
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-access-code") || "";
  if (provided && provided === code) return null;
  return json({ errorCode: "error.unauthorized", message: "Access code required" }, 401);
}

function sameOriginCheck(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  // A cross-site form post cannot set this custom header, which blocks CSRF.
  if (request.headers.get("x-app-request") !== "trading-ui") {
    return json({ errorCode: "error.bad.request", message: "Missing app request header" }, 403);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const requestHost = new URL(request.url).host;
      if (originHost !== requestHost) {
        return json({ errorCode: "error.forbidden.origin", message: "Cross-origin request rejected" }, 403);
      }
    } catch {
      return json({ errorCode: "error.bad.request", message: "Bad origin" }, 403);
    }
  }
  return null;
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) return null; // static assets

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: securityHeaders() });
  }

  if (url.pathname === "/api/status") {
    return json(
      {
        app: "TradingDesk",
        version: APP_VERSION,
        configured: isConfigured(env),
        env: String(env?.CAPITAL_ENV || "demo").toLowerCase(),
        accessRequired: Boolean(env?.APP_ACCESS_CODE),
        time: new Date().toISOString(),
      },
      200,
      securityHeaders(),
    );
  }

  const denied = accessCheck(request, env) || sameOriginCheck(request);
  if (denied) return denied;

  if (!isConfigured(env)) {
    return json(
      {
        errorCode: "error.not.configured",
        message: "Capital.com credentials are not configured on the server",
      },
      503,
    );
  }

  if (!url.pathname.startsWith("/api/capital/")) {
    return json({ errorCode: "error.not.found" }, 404);
  }

  const upstreamPath = url.pathname.slice("/api/capital/".length) + url.search;
  const hasBody = !["GET", "HEAD"].includes(request.method);
  let bodyText = null;
  if (hasBody) bodyText = await request.text();

  return capitalFetch(env, upstreamPath, {
    method: request.method,
    body: bodyText ?? undefined,
  });
}

export default {
  async fetch(request, env) {
    try {
      const api = await handleRequest(request, env);
      if (api) return api;
      // Static assets are attached to the Worker binding in the platform.
      if (env?.ASSETS) return env.ASSETS.fetch(request);
      return json({ errorCode: "error.not.found" }, 404);
    } catch (err) {
      return json(
        { errorCode: "error.internal", message: String(err && err.message ? err.message : err) },
        500,
      );
    }
  },
};
