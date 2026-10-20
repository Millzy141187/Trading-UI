/**
 * Indicator engine.
 *
 * Every indicator is a definition object:
 *   { id, name, category, pane: 'overlay'|'sub', params, outputs, compute }
 * `compute(candles, params)` returns { outputKey: [{time, value}] }.
 * chart.js turns those into Lightweight Charts line/histogram series.
 *
 * Note: TradingView Pine Script indicators cannot be exported from a
 * TradingView account into third-party apps (TradingView provides no API for
 * it), so the common studies are re-implemented here in JavaScript.
 */

/* ------------------------------- math helpers ------------------------------ */

const getSeries = (candles, key = "close") => candles.map((c) => Number(c[key]));

function rolling(candles, period, fn) {
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i += 1) {
    const slice = candles.slice(i - period + 1, i + 1);
    out[i] = fn(slice);
  }
  return out;
}

function smaArr(vals, period) {
  const out = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i += 1) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function emaArr(vals, period) {
  const out = new Array(vals.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < vals.length; i += 1) {
    if (i < period - 1) continue;
    if (prev === null) {
      prev = vals.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = vals[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function wmaArr(vals, period) {
  const out = new Array(vals.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < vals.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < period; j += 1) sum += vals[i - period + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return out;
}

function rmaArr(vals, period) {
  // Wilder smoothing
  const out = new Array(vals.length).fill(null);
  let prev = null;
  for (let i = 0; i < vals.length; i += 1) {
    if (i < period - 1) continue;
    if (prev === null) prev = vals.slice(0, period).reduce((a, b) => a + b, 0) / period;
    else prev = (prev * (period - 1) + vals[i]) / period;
    out[i] = prev;
  }
  return out;
}

function stdevArr(vals, period) {
  const out = new Array(vals.length).fill(null);
  for (let i = period - 1; i < vals.length; i += 1) {
    const slice = vals.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    out[i] = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  }
  return out;
}

function highestArr(vals, period) {
  const out = new Array(vals.length).fill(null);
  for (let i = period - 1; i < vals.length; i += 1) {
    out[i] = Math.max(...vals.slice(i - period + 1, i + 1));
  }
  return out;
}

function lowestArr(vals, period) {
  const out = new Array(vals.length).fill(null);
  for (let i = period - 1; i < vals.length; i += 1) {
    out[i] = Math.min(...vals.slice(i - period + 1, i + 1));
  }
  return out;
}

function trueRangeArr(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
}

function toPoints(candles, vals) {
  const pts = [];
  for (let i = 0; i < candles.length; i += 1) {
    const v = vals[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) pts.push({ time: candles[i].time, value: v });
  }
  return pts;
}

function shiftedPoints(candles, vals, offsetBars) {
  // Positive offset = plotted later (into the future), negative = earlier.
  const pts = [];
  for (let i = 0; i < candles.length; i += 1) {
    const v = vals[i];
    const target = i + offsetBars;
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (target < 0 || target >= candles.length) continue;
    pts.push({ time: candles[target].time, value: v });
  }
  return pts;
}

/* ------------------------------- definitions ------------------------------ */

const SOURCE_PARAM = {
  key: "source",
  label: "Source",
  default: "close",
  options: ["close", "open", "high", "low"],
  type: "select",
};

const PERIOD_PARAM = (def = 14, label = "Period") => ({
  key: "period",
  label,
  default: def,
  min: 1,
  max: 500,
  step: 1,
  type: "number",
});

export const INDICATORS = {
  /* --- moving averages / overlays ------------------------------------- */
  sma: {
    id: "sma",
    name: "Simple Moving Average",
    category: "Moving Averages",
    pane: "overlay",
    params: [PERIOD_PARAM(20), SOURCE_PARAM],
    outputs: [{ key: "sma", label: "SMA", color: "#2962ff", type: "line" }],
    compute(candles, p) {
      return { sma: toPoints(candles, smaArr(getSeries(candles, p.source), p.period)) };
    },
  },
  ema: {
    id: "ema",
    name: "Exponential Moving Average",
    category: "Moving Averages",
    pane: "overlay",
    params: [PERIOD_PARAM(21), SOURCE_PARAM],
    outputs: [{ key: "ema", label: "EMA", color: "#ff6d00", type: "line" }],
    compute(candles, p) {
      return { ema: toPoints(candles, emaArr(getSeries(candles, p.source), p.period)) };
    },
  },
  wma: {
    id: "wma",
    name: "Weighted Moving Average",
    category: "Moving Averages",
    pane: "overlay",
    params: [PERIOD_PARAM(20), SOURCE_PARAM],
    outputs: [{ key: "wma", label: "WMA", color: "#00bcd4", type: "line" }],
    compute(candles, p) {
      return { wma: toPoints(candles, wmaArr(getSeries(candles, p.source), p.period)) };
    },
  },
  vwap: {
    id: "vwap",
    name: "VWAP",
    category: "Moving Averages",
    pane: "overlay",
    params: [],
    outputs: [{ key: "vwap", label: "VWAP", color: "#e91e63", type: "line" }],
    compute(candles) {
      let cumPV = 0;
      let cumV = 0;
      const vals = candles.map((c) => {
        const typical = (c.high + c.low + c.close) / 3;
        const v = Number(c.volume) || 1;
        cumPV += typical * v;
        cumV += v;
        return cumPV / cumV;
      });
      return { vwap: toPoints(candles, vals) };
    },
  },
  bollinger: {
    id: "bollinger",
    name: "Bollinger Bands",
    category: "Bands & Channels",
    pane: "overlay",
    params: [PERIOD_PARAM(20), { key: "mult", label: "Std Dev", default: 2, min: 0.5, max: 6, step: 0.1, type: "number" }, SOURCE_PARAM],
    outputs: [
      { key: "upper", label: "BB Upper", color: "#7e57c2", type: "line" },
      { key: "middle", label: "BB Basis", color: "#7e57c2", type: "line" },
      { key: "lower", label: "BB Lower", color: "#7e57c2", type: "line" },
    ],
    compute(candles, p) {
      const vals = getSeries(candles, p.source);
      const mid = smaArr(vals, p.period);
      const sd = stdevArr(vals, p.period);
      return {
        upper: toPoints(candles, mid.map((m, i) => (m === null ? null : m + p.mult * sd[i]))),
        middle: toPoints(candles, mid),
        lower: toPoints(candles, mid.map((m, i) => (m === null ? null : m - p.mult * sd[i]))),
      };
    },
  },
  keltner: {
    id: "keltner",
    name: "Keltner Channels",
    category: "Bands & Channels",
    pane: "overlay",
    params: [PERIOD_PARAM(20), { key: "mult", label: "ATR Mult", default: 2, min: 0.5, max: 6, step: 0.1, type: "number" }],
    outputs: [
      { key: "upper", label: "KC Upper", color: "#26a69a", type: "line" },
      { key: "middle", label: "KC Basis", color: "#26a69a", type: "line" },
      { key: "lower", label: "KC Lower", color: "#26a69a", type: "line" },
    ],
    compute(candles, p) {
      const mid = emaArr(getSeries(candles, "close"), p.period);
      const atr = rmaArr(trueRangeArr(candles), p.period);
      return {
        upper: toPoints(candles, mid.map((m, i) => (m === null ? null : m + p.mult * atr[i]))),
        middle: toPoints(candles, mid),
        lower: toPoints(candles, mid.map((m, i) => (m === null ? null : m - p.mult * atr[i]))),
      };
    },
  },
  donchian: {
    id: "donchian",
    name: "Donchian Channels",
    category: "Bands & Channels",
    pane: "overlay",
    params: [PERIOD_PARAM(20)],
    outputs: [
      { key: "upper", label: "DC Upper", color: "#ff9800", type: "line" },
      { key: "middle", label: "DC Basis", color: "#ff9800", type: "line" },
      { key: "lower", label: "DC Lower", color: "#ff9800", type: "line" },
    ],
    compute(candles, p) {
      const hi = highestArr(getSeries(candles, "high"), p.period);
      const lo = lowestArr(getSeries(candles, "low"), p.period);
      return {
        upper: toPoints(candles, hi),
        middle: toPoints(candles, hi.map((h, i) => (h === null ? null : (h + lo[i]) / 2))),
        lower: toPoints(candles, lo),
      };
    },
  },
  envelope: {
    id: "envelope",
    name: "Moving Average Envelope",
    category: "Bands & Channels",
    pane: "overlay",
    params: [PERIOD_PARAM(20), { key: "pct", label: "Deviation %", default: 0.5, min: 0.1, max: 10, step: 0.1, type: "number" }],
    outputs: [
      { key: "upper", label: "Env Upper", color: "#78909c", type: "line" },
      { key: "middle", label: "Env Basis", color: "#78909c", type: "line" },
      { key: "lower", label: "Env Lower", color: "#78909c", type: "line" },
    ],
    compute(candles, p) {
      const mid = smaArr(getSeries(candles, "close"), p.period);
      const d = p.pct / 100;
      return {
        upper: toPoints(candles, mid.map((m) => (m === null ? null : m * (1 + d)))),
        middle: toPoints(candles, mid),
        lower: toPoints(candles, mid.map((m) => (m === null ? null : m * (1 - d)))),
      };
    },
  },
  psar: {
    id: "psar",
    name: "Parabolic SAR",
    category: "Overlays",
    pane: "overlay",
    params: [
      { key: "step", label: "Step", default: 0.02, min: 0.001, max: 0.2, step: 0.001, type: "number" },
      { key: "max", label: "Max", default: 0.2, min: 0.05, max: 0.5, step: 0.01, type: "number" },
    ],
    outputs: [{ key: "psar", label: "PSAR", color: "#26c6da", type: "line" }],
    compute(candles, p) {
      const vals = new Array(candles.length).fill(null);
      if (candles.length < 2) return { psar: [] };
      let up = candles[1].close >= candles[0].close;
      let sar = up ? candles[0].low : candles[0].high;
      let ep = up ? candles[0].high : candles[0].low;
      let af = p.step;
      for (let i = 1; i < candles.length; i += 1) {
        sar = sar + af * (ep - sar);
        if (up) {
          if (candles[i].low < sar) {
            up = false;
            sar = ep;
            ep = candles[i].low;
            af = p.step;
          } else if (candles[i].high > ep) {
            ep = candles[i].high;
            af = Math.min(af + p.step, p.max);
          }
        } else {
          if (candles[i].high > sar) {
            up = true;
            sar = ep;
            ep = candles[i].high;
            af = p.step;
          } else if (candles[i].low < ep) {
            ep = candles[i].low;
            af = Math.min(af + p.step, p.max);
          }
        }
        vals[i] = sar;
      }
      return { psar: toPoints(candles, vals) };
    },
  },
  supertrend: {
    id: "supertrend",
    name: "Supertrend",
    category: "Overlays",
    pane: "overlay",
    params: [
      PERIOD_PARAM(10, "ATR Period"),
      { key: "mult", label: "Multiplier", default: 3, min: 0.5, max: 10, step: 0.1, type: "number" },
    ],
    outputs: [{ key: "supertrend", label: "Supertrend", color: "#00e676", type: "line" }],
    compute(candles, p) {
      const atr = rmaArr(trueRangeArr(candles), p.period);
      const vals = new Array(candles.length).fill(null);
      let upper = null;
      let lower = null;
      let trend = 1;
      for (let i = 0; i < candles.length; i += 1) {
        if (atr[i] === null) continue;
        const mid = (candles[i].high + candles[i].low) / 2;
        const bu = mid + p.mult * atr[i];
        const bl = mid - p.mult * atr[i];
        if (upper === null) {
          upper = bu;
          lower = bl;
        } else {
          upper = bu < upper || candles[i - 1].close > upper ? bu : upper;
          lower = bl > lower || candles[i - 1].close < lower ? bl : lower;
        }
        trend = candles[i].close > upper ? 1 : candles[i].close < lower ? -1 : trend;
        vals[i] = trend === 1 ? lower : upper;
      }
      return { supertrend: toPoints(candles, vals) };
    },
  },
  ichimoku: {
    id: "ichimoku",
    name: "Ichimoku Cloud",
    category: "Overlays",
    pane: "overlay",
    params: [
      PERIOD_PARAM(9, "Tenkan"),
      PERIOD_PARAM(26, "Kijun"),
      PERIOD_PARAM(52, "Senkou B"),
    ],
    outputs: [
      { key: "tenkan", label: "Tenkan", color: "#2962ff", type: "line" },
      { key: "kijun", label: "Kijun", color: "#ff6d00", type: "line" },
      { key: "spanA", label: "Span A", color: "#26a69a", type: "line" },
      { key: "spanB", label: "Span B", color: "#ef5350", type: "line" },
      { key: "chikou", label: "Chikou", color: "#ab47bc", type: "line" },
    ],
    compute(candles, p) {
      const hi = (n) => highestArr(getSeries(candles, "high"), n);
      const lo = (n) => lowestArr(getSeries(candles, "low"), n);
      const mid = (a, b) => a.map((v, i) => (v === null ? null : (v + b[i]) / 2));
      const tenkan = mid(hi(p.period), lo(p.period));
      const kijun = mid(hi(p.period_2 ?? 26), lo(p.period_2 ?? 26));
      // params arrive with generic keys; map by order fallback:
      const kijunLen = Number(p.kijun ?? p.period_2 ?? 26);
      const spanBLen = Number(p.senkouB ?? p.period_3 ?? 52);
      const kijunArr = mid(highestArr(getSeries(candles, "high"), kijunLen), lowestArr(getSeries(candles, "low"), kijunLen));
      const spanA = tenkan.map((v, i) => (v === null || kijunArr[i] === null ? null : (v + kijunArr[i]) / 2));
      const spanB = mid(highestArr(getSeries(candles, "high"), spanBLen), lowestArr(getSeries(candles, "low"), spanBLen));
      const close = getSeries(candles, "close");
      return {
        tenkan: toPoints(candles, tenkan),
        kijun: toPoints(candles, kijunArr),
        spanA: shiftedPoints(candles, spanA, kijunLen),
        spanB: shiftedPoints(candles, spanB, kijunLen),
        chikou: shiftedPoints(candles, close, -kijunLen),
      };
    },
  },
  pivot: {
    id: "pivot",
    name: "Pivot Points (rolling)",
    category: "Overlays",
    pane: "overlay",
    params: [PERIOD_PARAM(24, "Lookback bars")],
    outputs: [
      { key: "pp", label: "Pivot", color: "#ffd54f", type: "line" },
      { key: "r1", label: "R1", color: "#ef5350", type: "line" },
      { key: "s1", label: "S1", color: "#26a69a", type: "line" },
    ],
    compute(candles, p) {
      const pp = [];
      const r1 = [];
      const s1 = [];
      for (let i = 0; i < candles.length; i += 1) {
        const start = Math.max(0, i - p.period + 1);
        let hi = -Infinity;
        let lo = Infinity;
        let cl = candles[i].close;
        for (let j = start; j <= i; j += 1) {
          hi = Math.max(hi, candles[j].high);
          lo = Math.min(lo, candles[j].low);
        }
        const pivot = (hi + lo + cl) / 3;
        pp.push({ time: candles[i].time, value: pivot });
        r1.push({ time: candles[i].time, value: 2 * pivot - lo });
        s1.push({ time: candles[i].time, value: 2 * pivot - hi });
      }
      return { pp, r1, s1 };
    },
  },
  /* --- oscillators ---------------------------------------------------- */
  rsi: {
    id: "rsi",
    name: "RSI",
    category: "Oscillators",
    pane: "sub",
    params: [PERIOD_PARAM(14)],
    outputs: [
      {
        key: "rsi",
        label: "RSI",
        color: "#e91e63",
        type: "line",
        levels: [
          { value: 70, color: "#ef5350" },
          { value: 50, color: "#78909c" },
          { value: 30, color: "#26a69a" },
        ],
        range: [0, 100],
      },
    ],
    compute(candles, p) {
      const closes = getSeries(candles, "close");
      const gains = closes.map((v, i) => (i === 0 ? 0 : Math.max(0, v - closes[i - 1])));
      const losses = closes.map((v, i) => (i === 0 ? 0 : Math.max(0, closes[i - 1] - v)));
      const avgGain = rmaArr(gains, p.period);
      const avgLoss = rmaArr(losses, p.period);
      const vals = closes.map((_, i) => {
        if (avgGain[i] === null) return null;
        if (avgLoss[i] === 0) return 100;
        const rs = avgGain[i] / avgLoss[i];
        return 100 - 100 / (1 + rs);
      });
      return { rsi: toPoints(candles, vals) };
    },
  },
  stoch: {
    id: "stoch",
    name: "Stochastic Oscillator",
    category: "Oscillators",
    pane: "sub",
    params: [PERIOD_PARAM(14, "%K Period"), PERIOD_PARAM(3, "%K Smooth"), PERIOD_PARAM(3, "%D Period")],
    outputs: [
      { key: "k", label: "%K", color: "#2962ff", type: "line", levels: [{ value: 80, color: "#ef5350" }, { value: 20, color: "#26a69a" }], range: [0, 100] },
      { key: "d", label: "%D", color: "#ff6d00", type: "line" },
    ],
    compute(candles, p) {
      const hi = highestArr(getSeries(candles, "high"), p.period);
      const lo = lowestArr(getSeries(candles, "low"), p.period);
      const rawK = candles.map((c, i) => {
        if (hi[i] === null || hi[i] === lo[i]) return null;
        return ((c.close - lo[i]) / (hi[i] - lo[i])) * 100;
      });
      const kPeriod = Number(p.period_2 ?? 3);
      const dPeriod = Number(p.period_3 ?? 3);
      const kSmooth = smaArr(rawK.map((v) => v ?? 0), kPeriod);
      const d = smaArr(kSmooth.map((v) => v ?? 0), dPeriod);
      return { k: toPoints(candles, kSmooth), d: toPoints(candles, d) };
    },
  },
  macd: {
    id: "macd",
    name: "MACD",
    category: "Oscillators",
    pane: "sub",
    params: [PERIOD_PARAM(12, "Fast"), PERIOD_PARAM(26, "Slow"), PERIOD_PARAM(9, "Signal")],
    outputs: [
      { key: "macd", label: "MACD", color: "#2962ff", type: "line" },
      { key: "signal", label: "Signal", color: "#ff6d00", type: "line" },
      { key: "hist", label: "Histogram", color: "#78909c", type: "histogram" },
    ],
    compute(candles, p) {
      const closes = getSeries(candles, "close");
      const fast = emaArr(closes, p.period);
      const slow = emaArr(closes, Number(p.period_2 ?? 26));
      const macdVals = closes.map((_, i) => (fast[i] === null || slow[i] === null ? null : fast[i] - slow[i]));
      const signal = emaArr(macdVals.map((v) => v ?? 0), Number(p.period_3 ?? 9));
      const hist = macdVals.map((v, i) => (v === null || signal[i] === null ? null : v - signal[i]));
      return {
        macd: toPoints(candles, macdVals),
        signal: toPoints(candles, signal),
        hist: toPoints(candles, hist),
      };
    },
  },
  atr: {
    id: "atr",
    name: "Average True Range",
    category: "Volatility",
    pane: "sub",
    params: [PERIOD_PARAM(14)],
    outputs: [{ key: "atr", label: "ATR", color: "#ff9800", type: "line" }],
    compute(candles, p) {
      return { atr: toPoints(candles, rmaArr(trueRangeArr(candles), p.period)) };
    },
  },
  cci: {
    id: "cci",
    name: "Commodity Channel Index",
    category: "Oscillators",
    pane: "sub",
    params: [PERIOD_PARAM(20)],
    outputs: [
      {
        key: "cci",
        label: "CCI",
        color: "#00bcd4",
        type: "line",
        levels: [{ value: 100, color: "#ef5350" }, { value: -100, color: "#26a69a" }],
      },
    ],
    compute(candles, p) {
      const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
      const ma = smaArr(tp, p.period);
      const vals = tp.map((v, i) => {
        if (ma[i] === null) return null;
        const slice = tp.slice(Math.max(0, i - p.period + 1), i + 1);
        const meanDev = slice.reduce((a, b) => a + Math.abs(b - ma[i]), 0) / slice.length;
        return meanDev === 0 ? 0 : (v - ma[i]) / (0.015 * meanDev);
      });
      return { cci: toPoints(candles, vals) };
    },
  },
  williams: {
    id: "williams",
    name: "Williams %R",
    category: "Oscillators",
    pane: "sub",
    params: [PERIOD_PARAM(14)],
    outputs: [
      {
        key: "willr",
        label: "%R",
        color: "#ab47bc",
        type: "line",
        levels: [{ value: -20, color: "#ef5350" }, { value: -80, color: "#26a69a" }],
        range: [-100, 0],
      },
    ],
    compute(candles, p) {
      const hi = highestArr(getSeries(candles, "high"), p.period);
      const lo = lowestArr(getSeries(candles, "low"), p.period);
      const vals = candles.map((c, i) => {
        if (hi[i] === null || hi[i] === lo[i]) return null;
        return ((hi[i] - c.close) / (hi[i] - lo[i])) * -100;
      });
      return { willr: toPoints(candles, vals) };
    },
  },
  roc: {
    id: "roc",
    name: "Rate of Change",
    category: "Momentum",
    pane: "sub",
    params: [PERIOD_PARAM(12)],
    outputs: [{ key: "roc", label: "ROC", color: "#8bc34a", type: "line", levels: [{ value: 0, color: "#78909c" }] }],
    compute(candles, p) {
      const closes = getSeries(candles, "close");
      const vals = closes.map((v, i) => (i < p.period || closes[i - p.period] === 0 ? null : ((v - closes[i - p.period]) / closes[i - p.period]) * 100));
      return { roc: toPoints(candles, vals) };
    },
  },
  momentum: {
    id: "momentum",
    name: "Momentum",
    category: "Momentum",
    pane: "sub",
    params: [PERIOD_PARAM(10)],
    outputs: [{ key: "mom", label: "Momentum", color: "#ffc107", type: "line", levels: [{ value: 0, color: "#78909c" }] }],
    compute(candles, p) {
      const closes = getSeries(candles, "close");
      const vals = closes.map((v, i) => (i < p.period ? null : v - closes[i - p.period]));
      return { mom: toPoints(candles, vals) };
    },
  },
  obv: {
    id: "obv",
    name: "On-Balance Volume",
    category: "Volume",
    pane: "sub",
    params: [],
    outputs: [{ key: "obv", label: "OBV", color: "#4dd0e1", type: "line" }],
    compute(candles) {
      let acc = 0;
      const vals = candles.map((c, i) => {
        const v = Number(c.volume) || 0;
        if (i === 0) return (acc = v);
        if (c.close > candles[i - 1].close) acc += v;
        else if (c.close < candles[i - 1].close) acc -= v;
        return acc;
      });
      return { obv: toPoints(candles, vals) };
    },
  },
  mfi: {
    id: "mfi",
    name: "Money Flow Index",
    category: "Volume",
    pane: "sub",
    params: [PERIOD_PARAM(14)],
    outputs: [
      {
        key: "mfi",
        label: "MFI",
        color: "#66bb6a",
        type: "line",
        levels: [{ value: 80, color: "#ef5350" }, { value: 20, color: "#26a69a" }],
        range: [0, 100],
      },
    ],
    compute(candles, p) {
      const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
      const pos = [];
      const neg = [];
      for (let i = 0; i < candles.length; i += 1) {
        const flow = tp[i] * (Number(candles[i].volume) || 0);
        if (i === 0 || tp[i] === tp[i - 1]) {
          pos.push(0);
          neg.push(0);
        } else if (tp[i] > tp[i - 1]) {
          pos.push(flow);
          neg.push(0);
        } else {
          pos.push(0);
          neg.push(flow);
        }
      }
      const sumPos = smaArr(pos.map((v, i) => pos.slice(Math.max(0, i - p.period + 1), i + 1).reduce((a, b) => a + b, 0)), 1);
      const sumNeg = smaArr(neg.map((v, i) => neg.slice(Math.max(0, i - p.period + 1), i + 1).reduce((a, b) => a + b, 0)), 1);
      const vals = candles.map((_, i) => {
        if (i < p.period - 1) return null;
        if (sumNeg[i] === 0) return 100;
        const mr = sumPos[i] / sumNeg[i];
        return 100 - 100 / (1 + mr);
      });
      return { mfi: toPoints(candles, vals) };
    },
  },
  adx: {
    id: "adx",
    name: "ADX / DMI",
    category: "Trend",
    pane: "sub",
    params: [PERIOD_PARAM(14)],
    outputs: [
      { key: "adx", label: "ADX", color: "#ffd54f", type: "line", levels: [{ value: 25, color: "#78909c" }], range: [0, 100] },
      { key: "plusDI", label: "+DI", color: "#26a69a", type: "line" },
      { key: "minusDI", label: "-DI", color: "#ef5350", type: "line" },
    ],
    compute(candles, p) {
      const plusDM = [];
      const minusDM = [];
      for (let i = 0; i < candles.length; i += 1) {
        if (i === 0) {
          plusDM.push(0);
          minusDM.push(0);
          continue;
        }
        const up = candles[i].high - candles[i - 1].high;
        const down = candles[i - 1].low - candles[i].low;
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
      }
      const tr = trueRangeArr(candles);
      const atrS = rmaArr(tr, p.period);
      const plusS = rmaArr(plusDM, p.period);
      const minusS = rmaArr(minusDM, p.period);
      const plusDI = candles.map((_, i) => (atrS[i] ? (plusS[i] / atrS[i]) * 100 : null));
      const minusDI = candles.map((_, i) => (atrS[i] ? (minusS[i] / atrS[i]) * 100 : null));
      const dx = candles.map((_, i) => {
        if (plusDI[i] === null || minusDI[i] === null) return null;
        const sum = plusDI[i] + minusDI[i];
        return sum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100;
      });
      const adxVals = rmaArr(dx.map((v) => v ?? 0), p.period);
      return {
        adx: toPoints(candles, adxVals),
        plusDI: toPoints(candles, plusDI),
        minusDI: toPoints(candles, minusDI),
      };
    },
  },
  ao: {
    id: "ao",
    name: "Awesome Oscillator",
    category: "Momentum",
    pane: "sub",
    params: [PERIOD_PARAM(5, "Fast"), PERIOD_PARAM(34, "Slow")],
    outputs: [{ key: "ao", label: "AO", color: "#78909c", type: "histogram", levels: [{ value: 0, color: "#78909c" }] }],
    compute(candles, p) {
      const mp = candles.map((c) => (c.high + c.low) / 2);
      const fast = smaArr(mp, p.period);
      const slow = smaArr(mp, Number(p.period_2 ?? 34));
      const vals = mp.map((_, i) => (fast[i] === null || slow[i] === null ? null : fast[i] - slow[i]));
      return { ao: toPoints(candles, vals) };
    },
  },
  volume: {
    id: "volume",
    name: "Volume",
    category: "Volume",
    pane: "volume",
    params: [],
    outputs: [{ key: "volume", label: "Volume", color: "#546e7a", type: "histogram" }],
    compute(candles) {
      return {
        volume: candles.map((c) => ({ time: c.time, value: Number(c.volume) || 0 })),
      };
    },
  },
};

// Friendly param aliases used by ichimoku/stoch/macd (period_2 / period_3)
const PARAM_ALIAS = {
  ichimoku: { period: "tenkan", period_2: "kijun", period_3: "senkouB" },
  stoch: { period: "period", period_2: "kSmooth", period_3: "dPeriod" },
  macd: { period: "fast", period_2: "slow", period_3: "signal" },
  ao: { period: "fast", period_2: "slow" },
};

export function defaultParams(def) {
  const out = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

export function computeIndicator(type, candles, params = {}) {
  const def = INDICATORS[type];
  if (!def) return {};
  const merged = { ...defaultParams(def), ...params };
  // Map param keys to the generic keys the compute functions read.
  const alias = PARAM_ALIAS[type];
  if (alias) {
    for (const [generic, named] of Object.entries(alias)) {
      if (merged[named] !== undefined) merged[generic] = merged[named];
      else if (merged[generic] !== undefined && merged[named] === undefined) merged[named] = merged[generic];
    }
  }
  return def.compute(candles, merged);
}

export function indicatorCategories() {
  const cats = new Map();
  for (const def of Object.values(INDICATORS)) {
    if (def.id === "volume") continue;
    if (!cats.has(def.category)) cats.set(def.category, []);
    cats.get(def.category).push(def);
  }
  return cats;
}
