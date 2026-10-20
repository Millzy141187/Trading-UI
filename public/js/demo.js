/**
 * Simulated market + broker used when no Capital.com credentials are
 * configured (or when the user forces demo mode).
 *
 * Prices are a deterministic, continuous function of (epic, time): a small
 * sum-of-sines wave around each instrument's base price. That gives
 * realistic-looking "live" movement which is consistent between the chart,
 * the watchlist and the order ticket, and stable across page reloads.
 */

const MINUTE = 60_000;

export const RESOLUTIONS = {
  MINUTE: MINUTE,
  MINUTE_5: 5 * MINUTE,
  MINUTE_15: 15 * MINUTE,
  MINUTE_30: 30 * MINUTE,
  HOUR: 60 * MINUTE,
  HOUR_4: 4 * 60 * MINUTE,
  DAY: 24 * 60 * MINUTE,
  WEEK: 7 * 24 * 60 * MINUTE,
};

export const RESOLUTION_LABELS = {
  MINUTE: "1m",
  MINUTE_5: "5m",
  MINUTE_15: "15m",
  MINUTE_30: "30m",
  HOUR: "1h",
  HOUR_4: "4h",
  DAY: "1D",
  WEEK: "1W",
};

/** [epic, name, type, base price, spread, currency, volatility factor] */
const TABLE = [
  ["IX.D.FTSE.DAILY.IP", "UK 100", "INDICES", 8240, 1.2, "GBP", 0.006],
  ["IX.D.DOW.DAILY.IP", "Wall St 30", "INDICES", 42350, 2.5, "USD", 0.006],
  ["IX.D.SPTRD.DAILY.IP", "US 500", "INDICES", 5765, 0.6, "USD", 0.005],
  ["IX.D.NASDAQ.DAILY.IP", "US Tech 100", "INDICES", 20150, 1.8, "USD", 0.008],
  ["IX.D.DAX.DAILY.IP", "Germany 40", "INDICES", 19280, 1.5, "EUR", 0.007],
  ["IX.D.CAC.DAILY.IP", "France 40", "INDICES", 7640, 1.2, "EUR", 0.007],
  ["IX.D.NIKKEI.DAILY.IP", "Japan 225", "INDICES", 38650, 9, "JPY", 0.008],
  ["IX.D.EU50.DAILY.IP", "EU 50", "INDICES", 4955, 1.2, "EUR", 0.007],
  ["IX.D.ASX.DAILY.IP", "Australia 200", "INDICES", 8265, 1.4, "AUD", 0.006],
  ["IX.D.HSI.DAILY.IP", "Hong Kong 50", "INDICES", 20150, 8, "HKD", 0.009],
  ["IX.D.IBEX.DAILY.IP", "Spain 35", "INDICES", 11820, 2, "EUR", 0.007],
  ["CS.D.EURUSD.CEEM.IP", "EUR/USD", "CURRENCIES", 1.0852, 0.00008, "USD", 0.0025],
  ["CS.D.GBPUSD.CEEM.IP", "GBP/USD", "CURRENCIES", 1.2718, 0.0001, "USD", 0.0028],
  ["CS.D.USDJPY.CEEM.IP", "USD/JPY", "CURRENCIES", 152.35, 0.012, "JPY", 0.003],
  ["CS.D.USDCHF.CEEM.IP", "USD/CHF", "CURRENCIES", 0.8822, 0.00012, "CHF", 0.0025],
  ["CS.D.AUDUSD.CEEM.IP", "AUD/USD", "CURRENCIES", 0.6584, 0.00012, "USD", 0.0032],
  ["CS.D.USDCAD.CEEM.IP", "USD/CAD", "CURRENCIES", 1.3618, 0.00014, "CAD", 0.0028],
  ["CS.D.NZDUSD.CEEM.IP", "NZD/USD", "CURRENCIES", 0.6022, 0.00016, "USD", 0.0032],
  ["CS.D.EURGBP.CEEM.IP", "EUR/GBP", "CURRENCIES", 0.8534, 0.00009, "GBP", 0.0022],
  ["CS.D.EURJPY.CEEM.IP", "EUR/JPY", "CURRENCIES", 165.32, 0.018, "JPY", 0.0032],
  ["CS.D.GBPJPY.CEEM.IP", "GBP/JPY", "CURRENCIES", 193.85, 0.025, "JPY", 0.0038],
  ["CO.D.XAUUSD.CMFS.IP", "Gold", "COMMODITIES", 2648.4, 0.35, "USD", 0.006],
  ["CO.D.XAGUSD.CMFS.IP", "Silver", "COMMODITIES", 31.24, 0.03, "USD", 0.011],
  ["CO.D.BCO.CMFS.IP", "Brent Oil Crude", "COMMODITIES", 75.18, 0.04, "USD", 0.011],
  ["CO.D.CL.CMFS.IP", "Oil - US Crude", "COMMODITIES", 71.42, 0.04, "USD", 0.012],
  ["CO.D.NGAS.CMFS.IP", "Natural Gas", "COMMODITIES", 2.862, 0.006, "USD", 0.022],
  ["CO.D.COPPER.CMFS.IP", "Copper", "COMMODITIES", 4.352, 0.004, "USD", 0.011],
  ["KC.D.BTCUSD.IP", "Bitcoin", "CRYPTOCURRENCIES", 64250, 22, "USD", 0.018],
  ["KC.D.ETHUSD.IP", "Ethereum", "CRYPTOCURRENCIES", 3148, 1.4, "USD", 0.021],
  ["KC.D.XRPUSD.IP", "Ripple", "CRYPTOCURRENCIES", 0.5235, 0.0006, "USD", 0.024],
  ["KC.D.SOLUSD.IP", "Solana", "CRYPTOCURRENCIES", 147.8, 0.12, "USD", 0.026],
  ["KC.D.LTCUSD.IP", "Litecoin", "CRYPTOCURRENCIES", 73.9, 0.08, "USD", 0.022],
  ["UN.D.AAPL.DAILY.IP", "Apple", "SHARES", 228.4, 0.06, "USD", 0.009],
  ["UN.D.MSFT.DAILY.IP", "Microsoft", "SHARES", 421.2, 0.08, "USD", 0.008],
  ["UN.D.NVDA.DAILY.IP", "NVIDIA", "SHARES", 121.35, 0.05, "USD", 0.015],
  ["UN.D.TSLA.DAILY.IP", "Tesla", "SHARES", 248.6, 0.12, "USD", 0.018],
  ["UN.D.AMZN.DAILY.IP", "Amazon", "SHARES", 186.5, 0.06, "USD", 0.01],
  ["UN.D.META.DAILY.IP", "Meta Platforms", "SHARES", 565.3, 0.12, "USD", 0.012],
  ["UN.D.GOOG.DAILY.IP", "Alphabet", "SHARES", 165.2, 0.05, "USD", 0.01],
  ["UN.D.NFLX.DAILY.IP", "Netflix", "SHARES", 702.4, 0.25, "USD", 0.012],
  ["UN.D.AMD.DAILY.IP", "AMD", "SHARES", 154.8, 0.05, "USD", 0.016],
  ["UN.D.INTC.DAILY.IP", "Intel", "SHARES", 22.42, 0.01, "USD", 0.015],
  ["UN.D.BA.DAILY.IP", "Boeing", "SHARES", 152.9, 0.06, "USD", 0.013],
  ["UN.D.DIS.DAILY.IP", "Walt Disney", "SHARES", 96.4, 0.03, "USD", 0.011],
];

/* ------------------------- deterministic price model ------------------------ */

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MARKETS = TABLE.map(([epic, name, type, base, spread, currency, vol]) => {
  const rng = mulberry32(hashStr(epic));
  const waves = [0, 1, 2].map(() => ({
    amp: vol * (0.35 + rng() * 0.5),
    w: (0.00013 + rng() * 0.0011) * (rng() > 0.5 ? 1 : -1),
    phase: rng() * Math.PI * 2,
  }));
  return {
    epic,
    instrumentName: name,
    name,
    instrumentType: type,
    lotSize: type === "SHARES" ? 1 : type === "CRYPTOCURRENCIES" ? 1 : 1,
    currency,
    spread,
    base,
    vol,
    waves,
    expiry: "-",
    marketStatus: "TRADEABLE",
    scalingFactor: 1,
    controlledRiskAllowed: type !== "CRYPTOCURRENCIES",
    streamingPricesAvailable: true,
    marginFactor: type === "CURRENCIES" ? 3.33 : type === "INDICES" ? 5 : 10,
    marginFactorUnit: "PERCENTAGE",
  };
});

const BY_EPIC = new Map(MARKETS.map((m) => [m.epic, m]));

export function demoMarkets() {
  return MARKETS.map(publicShape);
}

function publicShape(m) {
  return {
    delayTime: 0,
    epic: m.epic,
    instrumentName: m.instrumentName,
    name: m.instrumentName,
    instrumentType: m.instrumentType,
    lotSize: m.lotSize,
    currency: m.currency,
    expiry: m.expiry,
    marketStatus: m.marketStatus,
    scalingFactor: m.scalingFactor,
    controlledRiskAllowed: m.controlledRiskAllowed,
    streamingPricesAvailable: m.streamingPricesAvailable,
    marginFactor: m.marginFactor,
    marginFactorUnit: m.marginFactorUnit,
  };
}

export function demoSearch(term = "") {
  const needle = term.trim().toLowerCase();
  const matches = !needle
    ? MARKETS.slice(0, 25)
    : MARKETS.filter(
        (m) =>
          m.instrumentName.toLowerCase().includes(needle) ||
          m.epic.toLowerCase().includes(needle) ||
          m.instrumentType.toLowerCase().includes(needle),
      );
  return matches.map((m) => demoQuote(m.epic));
}

export function demoMarket(epic) {
  const m = BY_EPIC.get(epic);
  if (!m) return null;
  return { instrument: publicShape(m), dealingRules: null };
}

/** Continuous price for an epic at time t (ms). */
export function demoPrice(epic, t = Date.now()) {
  const m = BY_EPIC.get(epic);
  if (!m) return 1;
  const s = t / 1000;
  let drift = 0;
  for (const w of m.waves) drift += w.amp * Math.sin(w.w * s + w.phase);
  const micro = m.vol * 0.06 * Math.sin(s * 0.021 + hashStr(epic) % 7);
  return m.base * Math.exp(drift + micro);
}

export function demoQuote(epic) {
  const m = BY_EPIC.get(epic);
  if (!m) return null;
  const now = Date.now();
  const bid = demoPrice(epic, now);
  const offer = bid + m.spread;
  const dayAgo = demoPrice(epic, now - 24 * 60 * MINUTE);
  const netChange = bid - dayAgo;
  let high = bid;
  let low = bid;
  for (let i = 0; i < 24; i += 1) {
    const p = demoPrice(epic, now - i * 60 * MINUTE);
    high = Math.max(high, p);
    low = Math.min(low, p);
  }
  return {
    delayTime: 0,
    epic: m.epic,
    instrumentName: m.instrumentName,
    instrumentType: m.instrumentType,
    lotSize: m.lotSize,
    currency: m.currency,
    expiry: m.expiry,
    marketStatus: m.marketStatus,
    scalingFactor: m.scalingFactor,
    bid: round(bid, 6),
    offer: round(offer, 6),
    high: round(high, 6),
    low: round(low, 6),
    netChange: round(netChange, 6),
    percentageChange: round((netChange / dayAgo) * 100, 4),
    updateTime: new Date(now).toISOString(),
    updateTimeUTC: new Date(now).toISOString(),
  };
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function demoCandles(epic, resolution = "MINUTE_15", max = 300) {
  const m = BY_EPIC.get(epic);
  if (!m) return [];
  const step = RESOLUTION_MS[resolution] || RESOLUTION_MS.MINUTE_15;
  const now = Date.now();
  const lastBucket = Math.floor(now / step) * step;
  const rng = mulberry32(hashStr(epic + resolution));
  const out = [];
  for (let i = max - 1; i >= 0; i -= 1) {
    const time = lastBucket - i * step;
    const close = demoPrice(epic, time);
    const open = demoPrice(epic, time - step);
    const wick = Math.abs(close) * m.vol * (0.25 + rng() * 0.6);
    out.push({
      time: Math.floor(time / 1000),
      open: round(Math.min(open, close) - wick * rng(), 6),
      high: round(Math.max(open, close) + wick * (0.4 + rng() * 0.8), 6),
      low: round(Math.min(open, close) - wick * (0.4 + rng() * 0.8), 6),
      close: round(close, 6),
      volume: Math.round(50 + rng() * 950),
    });
  }
  // Enforce OHLC sanity
  for (const c of out) {
    c.high = Math.max(c.high, c.open, c.close);
    c.low = Math.min(c.low, c.open, c.close);
  }
  return out;
}

export const RESOLUTION_MS = RESOLUTIONS;

/* ------------------------------- demo broker ------------------------------- */

function brokerState() {
  try {
    const raw = localStorage.getItem("td.v1.demo");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      balance: parsed.balance ?? 10000,
      realized: parsed.realized ?? 0,
      currency: parsed.currency ?? "GBP",
      positions: parsed.positions ?? [],
      orders: parsed.orders ?? [],
      refs: parsed.refs ?? {},
    };
  } catch {
    return { balance: 10000, realized: 0, currency: "GBP", positions: [], orders: [], refs: {} };
  }
}

function brokerSave(s) {
  localStorage.setItem("td.v1.demo", JSON.stringify(s));
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class DemoBroker {
  constructor() {
    this.s = brokerState();
  }

  _save() {
    brokerSave(this.s);
  }

  getAccounts() {
    const upl = this.s.positions.reduce((sum, p) => sum + this._upl(p), 0);
    return {
      accounts: [
        {
          accountId: "demo-0001",
          accountName: `${this.s.currency} Simulated`,
          status: "ENABLED",
          accountType: "CFD",
          preferred: true,
          balance: {
            balance: round(this.s.balance, 2),
            deposit: round(this.s.positions.reduce((t, p) => t + p.size * p.level * 0.05, 0), 2),
            profitLoss: round(upl, 2),
            available: round(this.s.balance + upl, 2),
          },
          currency: this.s.currency,
        },
      ],
    };
  }

  _quote(epic) {
    return demoQuote(epic);
  }

  _upl(p) {
    const q = this._quote(p.epic);
    if (!q) return 0;
    const price = p.direction === "BUY" ? q.bid : q.offer;
    return round((price - p.level) * p.size * (p.direction === "BUY" ? 1 : -1), 2);
  }

  getPositions() {
    const positions = this.s.positions.map((p) => {
      const q = this._quote(p.epic) || {};
      return {
        position: {
          contractSize: 1,
          createdDate: p.createdDate,
          createdDateUTC: p.createdDateUTC,
          dealId: p.dealId,
          dealReference: p.dealReference,
          size: p.size,
          leverage: p.leverage,
          upl: this._upl(p),
          direction: p.direction,
          level: p.level,
          currency: p.currency,
          guaranteedStop: p.guaranteedStop,
          stopLevel: p.stopLevel ?? null,
          profitLevel: p.profitLevel ?? null,
          trailingStop: p.trailingStop ?? false,
        },
        market: {
          epic: p.epic,
          instrumentName: q.instrumentName || p.epic,
          instrumentType: q.instrumentType || "",
          expiry: "-",
          marketStatus: q.marketStatus || "TRADEABLE",
          lotSize: q.lotSize || 1,
          bid: q.bid,
          offer: q.offer,
          high: q.high,
          low: q.low,
          percentageChange: q.percentageChange,
          netChange: q.netChange,
          updateTime: q.updateTime,
          scalingFactor: q.scalingFactor || 1,
        },
      };
    });
    return { positions };
  }

  _levelsFor(ticket, fillPrice) {
    const dir = ticket.direction === "BUY" ? 1 : -1;
    let stopLevel = null;
    let profitLevel = null;
    if (ticket.stopLevel) stopLevel = Number(ticket.stopLevel);
    else if (ticket.stopDistance) stopLevel = fillPrice - dir * Number(ticket.stopDistance);
    if (ticket.profitLevel) profitLevel = Number(ticket.profitLevel);
    else if (ticket.profitDistance) profitLevel = fillPrice + dir * Number(ticket.profitDistance);
    return { stopLevel, profitLevel };
  }

  openPosition(ticket) {
    const q = this._quote(ticket.epic);
    if (!q) return { errorCode: "error.not-found.epic" };
    const size = Number(ticket.size);
    if (!(size > 0)) return { errorCode: "error.invalid.size" };
    const isBuy = ticket.direction === "BUY";
    const fillPrice = isBuy ? q.offer : q.bid;
    const { stopLevel, profitLevel } = this._levelsFor(ticket, fillPrice);
    if (isBuy && stopLevel && stopLevel >= fillPrice) return { errorCode: "error.invalid.stoploss" };
    if (!isBuy && stopLevel && stopLevel <= fillPrice) return { errorCode: "error.invalid.stoploss" };
    const ref = `o_${newId("deal")}`;
    const dealId = newId("pos");
    this.s.positions.push({
      dealId,
      dealReference: ref,
      epic: ticket.epic,
      direction: ticket.direction,
      size,
      level: round(fillPrice, 6),
      currency: this.s.currency,
      leverage: 10,
      guaranteedStop: Boolean(ticket.guaranteedStop),
      trailingStop: Boolean(ticket.trailingStop),
      stopLevel: stopLevel ? round(stopLevel, 6) : null,
      profitLevel: profitLevel ? round(profitLevel, 6) : null,
      createdDate: new Date().toISOString(),
      createdDateUTC: new Date().toISOString(),
    });
    this.s.refs[ref] = { dealId, level: fillPrice, size, direction: ticket.direction, epic: ticket.epic };
    this._save();
    return { dealReference: ref };
  }

  editPosition(dealId, patch) {
    const p = this.s.positions.find((x) => x.dealId === dealId);
    if (!p) return { errorCode: "error.not-found.dealId" };
    const { stopLevel, profitLevel } = this._levelsFor(
      {
        direction: p.direction,
        stopLevel: patch.stopLevel,
        stopDistance: patch.stopDistance,
        profitLevel: patch.profitLevel,
        profitDistance: patch.profitDistance,
      },
      p.level,
    );
    if (patch.stopLevel !== undefined || patch.stopDistance !== undefined) p.stopLevel = stopLevel;
    if (patch.profitLevel !== undefined || patch.profitDistance !== undefined) p.profitLevel = profitLevel;
    if (patch.guaranteedStop !== undefined) p.guaranteedStop = Boolean(patch.guaranteedStop);
    this._save();
    return { dealReference: `p_${newId("deal")}` };
  }

  closePosition(dealId, reason = "MANUAL", exitOverride = null) {
    const idx = this.s.positions.findIndex((x) => x.dealId === dealId);
    if (idx < 0) return { errorCode: "error.not-found.dealId" };
    const p = this.s.positions[idx];
    const q = this._quote(p.epic) || {};
    const exit =
      exitOverride ??
      (reason === "STOP" ? p.stopLevel : reason === "LIMIT" ? p.profitLevel : null) ??
      (p.direction === "BUY" ? q.bid : q.offer);
    const pnl = round((exit - p.level) * p.size * (p.direction === "BUY" ? 1 : -1), 2);
    this.s.balance = round(this.s.balance + pnl, 2);
    this.s.realized = round(this.s.realized + pnl, 2);
    this.s.positions.splice(idx, 1);
    const ref = `p_${newId("deal")}`;
    this._save();
    return {
      dealReference: ref,
      closedTrade: {
        dealId: p.dealId,
        epic: p.epic,
        instrumentName: q.instrumentName || p.epic,
        direction: p.direction,
        size: p.size,
        entry: p.level,
        exit: round(exit, 6),
        openTime: p.createdDate,
        closeTime: new Date().toISOString(),
        pnl,
        currency: this.s.currency,
        reason,
        source: "demo",
      },
    };
  }

  getWorkingOrders() {
    const workingOrders = this.s.orders.map((o) => {
      const q = this._quote(o.epic) || {};
      return {
        workingOrderData: {
          dealId: o.dealId,
          direction: o.direction,
          epic: o.epic,
          orderSize: o.size,
          orderLevel: o.level,
          timeInForce: o.goodTillDate ? "GOOD_TILL_DATE" : "GOOD_TILL_CANCELLED",
          goodTillDate: o.goodTillDate || null,
          createdDate: o.createdDate,
          guaranteedStop: o.guaranteedStop,
          orderType: o.orderType,
          stopDistance: o.stopDistance ?? null,
          profitDistance: o.profitDistance ?? null,
          currencyCode: o.currency,
        },
        marketData: {
          epic: o.epic,
          instrumentName: q.instrumentName || o.epic,
          bid: q.bid,
          offer: q.offer,
          marketStatus: q.marketStatus || "TRADEABLE",
        },
      };
    });
    return { workingOrders };
  }

  placeWorkingOrder(ticket) {
    const q = this._quote(ticket.epic);
    if (!q) return { errorCode: "error.not-found.epic" };
    const size = Number(ticket.size);
    const level = Number(ticket.level);
    if (!(size > 0) || !(level > 0)) return { errorCode: "error.invalid.request.data" };
    const orderType = (ticket.type || ticket.orderType || "LIMIT").toUpperCase();
    if (!["LIMIT", "STOP"].includes(orderType)) return { errorCode: "error.invalid.orderType" };
    const ref = `o_${newId("deal")}`;
    this.s.orders.push({
      dealId: newId("wo"),
      dealReference: ref,
      epic: ticket.epic,
      direction: ticket.direction,
      size,
      level: round(level, 6),
      orderType,
      guaranteedStop: Boolean(ticket.guaranteedStop),
      stopDistance: ticket.stopDistance ? Number(ticket.stopDistance) : null,
      profitDistance: ticket.profitDistance ? Number(ticket.profitDistance) : null,
      goodTillDate: ticket.goodTillDate || null,
      currency: this.s.currency,
      createdDate: new Date().toISOString(),
    });
    this._save();
    return { dealReference: ref };
  }

  editWorkingOrder(dealId, patch) {
    const o = this.s.orders.find((x) => x.dealId === dealId);
    if (!o) return { errorCode: "error.not-found.dealId" };
    if (patch.level !== undefined) o.level = Number(patch.level);
    if (patch.size !== undefined) o.size = Number(patch.size);
    if (patch.stopDistance !== undefined) o.stopDistance = patch.stopDistance ? Number(patch.stopDistance) : null;
    if (patch.profitDistance !== undefined) o.profitDistance = patch.profitDistance ? Number(patch.profitDistance) : null;
    if (patch.goodTillDate !== undefined) o.goodTillDate = patch.goodTillDate;
    this._save();
    return { dealReference: `o_${newId("deal")}` };
  }

  cancelWorkingOrder(dealId) {
    const idx = this.s.orders.findIndex((x) => x.dealId === dealId);
    if (idx < 0) return { errorCode: "error.not-found.dealId" };
    this.s.orders.splice(idx, 1);
    this._save();
    return { dealReference: `o_${newId("deal")}` };
  }

  getConfirm(ref) {
    const info = this.s.refs[ref];
    return {
      date: new Date().toISOString(),
      status: "OPEN",
      reason: "SUCCESS",
      dealStatus: "ACCEPTED",
      epic: info?.epic || "",
      dealReference: ref,
      dealId: info?.dealId || "",
      affectedDeals: [{ dealId: info?.dealId || "", status: "OPENED" }],
      level: info?.level ?? null,
      size: info?.size ?? null,
      direction: info?.direction || "",
      guaranteedStop: false,
      trailingStop: false,
    };
  }

  /** Evaluate stops/targets/order fills. Returns array of newly closed trades. */
  sync() {
    const closedTrades = [];
    for (const p of [...this.s.positions]) {
      const q = this._quote(p.epic);
      if (!q) continue;
      const bid = q.bid;
      const offer = q.offer;
      if (p.direction === "BUY") {
        if (p.stopLevel && bid <= p.stopLevel) {
          const res = this.closePosition(p.dealId, "STOP");
          if (res.closedTrade) closedTrades.push(res.closedTrade);
        } else if (p.profitLevel && bid >= p.profitLevel) {
          const res = this.closePosition(p.dealId, "LIMIT");
          if (res.closedTrade) closedTrades.push(res.closedTrade);
        }
      } else {
        if (p.stopLevel && offer >= p.stopLevel) {
          const res = this.closePosition(p.dealId, "STOP");
          if (res.closedTrade) closedTrades.push(res.closedTrade);
        } else if (p.profitLevel && offer <= p.profitLevel) {
          const res = this.closePosition(p.dealId, "LIMIT");
          if (res.closedTrade) closedTrades.push(res.closedTrade);
        }
      }
    }
    for (const o of [...this.s.orders]) {
      const q = this._quote(o.epic);
      if (!q) continue;
      const trigger =
        (o.direction === "BUY" && o.orderType === "LIMIT" && q.offer <= o.level) ||
        (o.direction === "BUY" && o.orderType === "STOP" && q.offer >= o.level) ||
        (o.direction === "SELL" && o.orderType === "LIMIT" && q.bid >= o.level) ||
        (o.direction === "SELL" && o.orderType === "STOP" && q.bid <= o.level);
      if (!trigger) continue;
      this.cancelWorkingOrder(o.dealId);
      this.openPosition({
        epic: o.epic,
        direction: o.direction,
        size: o.size,
        guaranteedStop: o.guaranteedStop,
        stopDistance: o.stopDistance,
        profitDistance: o.profitDistance,
      });
    }
    return closedTrades;
  }

  reset() {
    this.s = { balance: 10000, realized: 0, currency: "GBP", positions: [], orders: [], refs: {} };
    this._save();
  }
}
