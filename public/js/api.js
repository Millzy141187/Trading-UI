/**
 * Broker + market data client.
 *
 * Talks to the app's own backend (/api/capital/...), which holds the
 * Capital.com credentials and session tokens server-side. When the backend
 * reports it is not configured (or the user forces demo mode) all calls are
 * served by the simulated demo engine instead.
 */

import {
  demoSearch,
  demoMarket,
  demoQuote,
  demoCandles,
  demoMarkets,
  DemoBroker,
} from "./demo.js";
import { closed as closedStore, settings, state } from "./store.js";

let accessCode = sessionStorage.getItem("td.accessCode") || "";
export function setAccessCode(code) {
  accessCode = code || "";
  if (accessCode) sessionStorage.setItem("td.accessCode", accessCode);
  else sessionStorage.removeItem("td.accessCode");
}
export function getAccessCode() {
  return accessCode;
}

let statusCache = null;
let demoBroker = null;

export async function getStatus(force = false) {
  if (statusCache && !force) return statusCache;
  try {
    const res = await fetch("/api/status", { headers: { "x-app-request": "trading-ui" } });
    statusCache = await res.json();
  } catch {
    statusCache = { configured: false, env: "demo", offline: true };
  }
  return statusCache;
}

export function isDemoMode() {
  return Boolean(settings.get().forceDemo) || !statusCache?.configured;
}

export function modeLabel() {
  if (statusCache?.offline) return "OFFLINE";
  return isDemoMode() ? "SIMULATED" : `CAPITAL.COM ${(statusCache?.env || "demo").toUpperCase()}`;
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const headers = { "x-app-request": "trading-ui" };
  if (accessCode) headers.authorization = `Bearer ${accessCode}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api/capital/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(describeError(data, res.status));
    err.status = res.status;
    err.code = data?.errorCode || `http.${res.status}`;
    err.data = data;
    throw err;
  }
  return data;
}

function describeError(data, status) {
  if (status === 401) return "Access code required or rejected. Set it in Settings.";
  if (status === 503) return "Broker connection is not configured on the server yet.";
  const code = data?.errorCode || data?.message || `Request failed (${status})`;
  return String(code);
}

function broker() {
  if (!demoBroker) demoBroker = new DemoBroker();
  return demoBroker;
}

/* --------------------------------- markets --------------------------------- */

export async function searchMarkets(term) {
  if (isDemoMode()) return demoSearch(term);
  const data = await apiFetch(`markets?searchTerm=${encodeURIComponent(term)}`);
  return data.markets || (data.marketDetails || []).map((d) => d.instrument).filter(Boolean);
}

export async function getMarket(epic) {
  if (isDemoMode()) return demoMarket(epic);
  return apiFetch(`markets/${encodeURIComponent(epic)}`);
}

export async function getQuotes(epics) {
  if (!epics.length) return [];
  if (isDemoMode()) return epics.map((e) => demoQuote(e)).filter(Boolean);
  const chunked = [];
  for (let i = 0; i < epics.length; i += 40) chunked.push(epics.slice(i, i + 40));
  const out = [];
  for (const chunk of chunked) {
    const data = await apiFetch(`markets?epics=${chunk.map(encodeURIComponent).join(",")}`);
    for (const detail of data.marketDetails || []) {
      const inst = detail.instrument || {};
      const deal = detail.dealingRules || {};
      out.push({
        epic: inst.epic,
        instrumentName: inst.name,
        instrumentType: inst.type,
        lotSize: inst.lotSize,
        currency: inst.currency,
        expiry: inst.expiry,
        marketStatus: detail.market?.marketStatus || "TRADEABLE",
        scalingFactor: inst.scalingFactor,
        controlledRiskAllowed: inst.controlledRiskAllowed,
        bid: detail.market?.bid,
        offer: detail.market?.offer,
        high: detail.market?.high,
        low: detail.market?.low,
        netChange: detail.market?.netChange,
        percentageChange: detail.market?.percentageChange,
        updateTime: detail.market?.updateTime,
        minimumDealSize: deal.minStepSize || deal.minSize,
        marginFactor: inst.marginFactor,
        marginFactorUnit: inst.marginFactorUnit,
      });
    }
  }
  return out;
}

export async function getPrices(epic, resolution = "MINUTE_15", max = 300) {
  if (isDemoMode()) return demoCandles(epic, resolution, max);
  const data = await apiFetch(
    `prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${Math.min(1000, max)}`,
  );
  return (data.prices || []).map((c) => {
    const mid = (p) => {
      if (p === null || p === undefined) return null;
      if (typeof p === "number") return p;
      const bid = Number(p.bid);
      const ask = Number(p.ask ?? p.offer);
      if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
      return Number(p.mid ?? bid ?? ask ?? 0);
    };
    const time = Date.parse(c.snapshotTimeUTC || c.snapshotTime || "") / 1000;
    return {
      time: Number.isFinite(time) ? Math.floor(time) : Math.floor(Date.now() / 1000),
      open: mid(c.openPrice),
      high: mid(c.highPrice),
      low: mid(c.lowPrice),
      close: mid(c.closePrice),
      volume: Number(c.lastTradedVolume ?? 0),
    };
  });
}

export async function getSentiment(marketIds) {
  if (isDemoMode()) {
    return marketIds.map((marketId, i) => ({
      marketId,
      longPositionPercentage: 35 + ((i * 13 + 21) % 45),
      shortPositionPercentage: 65 - ((i * 13 + 21) % 45),
    }));
  }
  const data = await apiFetch(`clientsentiment?marketIds=${marketIds.map(encodeURIComponent).join(",")}`);
  return data.clientSentiments || [];
}

/* --------------------------------- account --------------------------------- */

export async function getAccounts() {
  if (isDemoMode()) return broker().getAccounts();
  return apiFetch("accounts");
}

export function preferredAccount(accountsData) {
  const list = accountsData?.accounts || [];
  return list.find((a) => a.preferred) || list[0] || null;
}

/* -------------------------------- positions -------------------------------- */

export async function getPositions() {
  if (isDemoMode()) return broker().getPositions();
  return apiFetch("positions");
}

export async function openPosition(ticket) {
  if (isDemoMode()) return broker().openPosition(ticket);
  return apiFetch("positions", { method: "POST", body: ticket });
}

export async function editPosition(dealId, patch) {
  if (isDemoMode()) return broker().editPosition(dealId, patch);
  return apiFetch(`positions/${encodeURIComponent(dealId)}`, { method: "PUT", body: patch });
}

export async function closePosition(dealId) {
  if (isDemoMode()) return broker().closePosition(dealId);
  return apiFetch(`positions/${encodeURIComponent(dealId)}`, { method: "DELETE" });
}

/* ------------------------------ working orders ----------------------------- */

export async function getWorkingOrders() {
  if (isDemoMode()) return broker().getWorkingOrders();
  return apiFetch("workingorders");
}

export async function placeWorkingOrder(ticket) {
  if (isDemoMode()) return broker().placeWorkingOrder(ticket);
  return apiFetch("workingorders", { method: "POST", body: ticket });
}

export async function editWorkingOrder(dealId, patch) {
  if (isDemoMode()) return broker().editWorkingOrder(dealId, patch);
  return apiFetch(`workingorders/${encodeURIComponent(dealId)}`, { method: "PUT", body: patch });
}

export async function cancelWorkingOrder(dealId) {
  if (isDemoMode()) return broker().cancelWorkingOrder(dealId);
  return apiFetch(`workingorders/${encodeURIComponent(dealId)}`, { method: "DELETE" });
}

/* --------------------------------- confirms -------------------------------- */

export async function getConfirm(ref) {
  if (isDemoMode()) return broker().getConfirm(ref);
  return apiFetch(`confirms/${encodeURIComponent(ref)}`);
}

export async function waitConfirm(ref, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      last = await getConfirm(ref);
      if (last && (last.dealStatus === "ACCEPTED" || last.dealStatus === "OPEN" || last.affectedDeals?.length)) {
        return last;
      }
    } catch {
      /* keep trying briefly */
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  return last;
}

/* ------------------------------ history helpers ---------------------------- */

export async function getActivity(fromISO) {
  if (isDemoMode()) return { activities: [] };
  const from = encodeURIComponent(fromISO);
  return apiFetch(`history/activity?from=${from}&detailed=true`);
}

export async function getTransactions(fromISO) {
  if (isDemoMode()) return { transactions: [] };
  const from = encodeURIComponent(fromISO);
  return apiFetch(`history/transactions?from=${from}`);
}

/* ------------------------------- demo control ------------------------------ */

export function demoSync() {
  if (!isDemoMode()) return [];
  return broker().sync();
}

export function demoReset() {
  if (!isDemoMode()) return;
  broker().reset();
}

export function defaultWatchlist() {
  return demoMarkets()
    .filter((m) =>
      [
        "IX.D.FTSE.DAILY.IP",
        "IX.D.NASDAQ.DAILY.IP",
        "IX.D.DOW.DAILY.IP",
        "CS.D.EURUSD.CEEM.IP",
        "CS.D.GBPUSD.CEEM.IP",
        "CO.D.XAUUSD.CMFS.IP",
        "CO.D.BCO.CMFS.IP",
        "KC.D.BTCUSD.IP",
        "UN.D.AAPL.DAILY.IP",
        "UN.D.NVDA.DAILY.IP",
      ].includes(m.epic),
    )
    .map(({ delayTime, ...rest }) => rest);
}

/** Record detected broker-side position closures for journal import. */
export function recordClosure(trade) {
  closedStore.add(trade);
}

export { state };
