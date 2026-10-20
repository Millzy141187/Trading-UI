/**
 * Chart engine.
 *
 * "pro" engine: TradingView Lightweight Charts (vendored locally) with
 *   - main price pane (candles / bars / line / area)
 *   - optional volume pane
 *   - one pane per sub-indicator (RSI, MACD, ...), time-synced with the
 *     main chart's zoom/scroll
 *   - overlay indicators, trade markers, position/stop price lines
 * "tv" engine: official TradingView Advanced Chart widget (full Supercharts
 *   UI where the user can browse TradingView's own indicator library and,
 *   if they sign in inside the widget, reach their TradingView account).
 */

import { computeIndicator, INDICATORS, defaultParams } from "./indicators.js";
import { el, pricePrecision, fmt } from "./util.js";

const LWC = () => window.LightweightCharts;

const TV_INTERVALS = {
  MINUTE: "1",
  MINUTE_5: "5",
  MINUTE_15: "15",
  MINUTE_30: "30",
  HOUR: "60",
  HOUR_4: "240",
  DAY: "D",
  WEEK: "W",
};

const TV_SYMBOLS = {
  "IX.D.FTSE.DAILY.IP": "CAPITALCOM:UK100",
  "IX.D.DOW.DAILY.IP": "CAPITALCOM:US30",
  "IX.D.SPTRD.DAILY.IP": "CAPITALCOM:SPX500",
  "IX.D.NASDAQ.DAILY.IP": "CAPITALCOM:NAS100",
  "IX.D.DAX.DAILY.IP": "CAPITALCOM:GER40",
  "IX.D.CAC.DAILY.IP": "CAPITALCOM:FRA40",
  "IX.D.NIKKEI.DAILY.IP": "CAPITALCOM:JPN225",
  "CS.D.EURUSD.CEEM.IP": "FX:EURUSD",
  "CS.D.GBPUSD.CEEM.IP": "FX:GBPUSD",
  "CS.D.USDJPY.CEEM.IP": "FX:USDJPY",
  "CO.D.XAUUSD.CMFS.IP": "TVC:GOLD",
  "CO.D.XAGUSD.CMFS.IP": "TVC:SILVER",
  "CO.D.BCO.CMFS.IP": "TVC:UKOIL",
  "CO.D.CL.CMFS.IP": "TVC:USOIL",
  "KC.D.BTCUSD.IP": "BITSTAMP:BTCUSD",
  "KC.D.ETHUSD.IP": "BITSTAMP:ETHUSD",
  "UN.D.AAPL.DAILY.IP": "NASDAQ:AAPL",
  "UN.D.MSFT.DAILY.IP": "NASDAQ:MSFT",
  "UN.D.NVDA.DAILY.IP": "NASDAQ:NVDA",
  "UN.D.TSLA.DAILY.IP": "NASDAQ:TSLA",
  "UN.D.AMZN.DAILY.IP": "NASDAQ:AMZN",
  "UN.D.META.DAILY.IP": "NASDAQ:META",
  "UN.D.GOOG.DAILY.IP": "NASDAQ:GOOGL",
  "UN.D.NFLX.DAILY.IP": "NASDAQ:NFLX",
  "UN.D.AMD.DAILY.IP": "NASDAQ:AMD",
  "UN.D.INTC.DAILY.IP": "NASDAQ:INTC",
  "UN.D.BA.DAILY.IP": "NYSE:BA",
  "UN.D.DIS.DAILY.IP": "NYSE:DIS",
};

const THEME_COLORS = {
  dark: {
    bg: "#14213a",
    text: "#8fa3c2",
    grid: "rgba(34, 52, 90, 0.5)",
    border: "#22345a",
    up: "#26a69a",
    down: "#ef5350",
    crosshair: "#5d7191",
  },
  light: {
    bg: "#ffffff",
    text: "#51617e",
    grid: "rgba(211, 220, 233, 0.7)",
    border: "#d3dce9",
    up: "#12897e",
    down: "#d43c39",
    crosshair: "#8b9ab3",
  },
};

export class ChartPanel {
  constructor(container, { theme = "dark", resolution = "MINUTE_15" } = {}) {
    this.container = container;
    this.theme = theme;
    this.resolution = resolution;
    this.engine = "pro";
    this.chartType = "candles";
    this.candles = [];
    this.indicators = []; // [{uid, type, params}]
    this.markers = [];
    this.priceLines = []; // [{price, color, title}]
    this.charts = [];
    this._syncing = false;
    this._buildPro();
  }

  /* ------------------------------ pro engine ------------------------------ */

  _colors() {
    return THEME_COLORS[this.theme] || THEME_COLORS.dark;
  }

  _buildPro() {
    this.engine = "pro";
    this.container.innerHTML = "";
    const c = this._colors();
    const L = LWC();
    if (!L) {
      this.container.innerHTML = '<div class="empty-state">Chart library failed to load.</div>';
      return;
    }

    this.area = el("div", { class: "chart-area" });
    this.paneMain = el("div", { class: "chart-pane" });
    this.paneVolume = el("div", { class: "chart-pane volume" });
    this.legend = el("div", {
      style: {
        position: "absolute",
        top: "8px",
        left: "12px",
        zIndex: "6",
        fontSize: "11px",
        lineHeight: "1.6",
        fontFamily: "var(--mono)",
        color: "var(--text-dim)",
        pointerEvents: "none",
        background: "color-mix(in srgb, var(--bg-panel) 72%, transparent)",
        padding: "4px 9px",
        borderRadius: "6px",
      },
    });
    this.paneMain.append(this.legend);
    this.area.append(this.paneMain);
    this.container.append(this.area);

    const baseOptions = {
      autoSize: true,
      layout: {
        background: { type: "solid", color: c.bg },
        textColor: c.text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: c.grid },
        horzLines: { color: c.grid },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: c.crosshair, width: 1, style: 3, labelBackgroundColor: c.border },
        horzLine: { color: c.crosshair, width: 1, style: 3, labelBackgroundColor: c.border },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    };

    this.mainChart = L.createChart(this.paneMain, baseOptions);
    this.charts = [this.mainChart];
    this.mainSeries = this._createPriceSeries();

    this.mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (this._syncing || !range) return;
      this._syncing = true;
      for (const chart of this.charts) {
        if (chart !== this.mainChart) chart.timeScale().setVisibleLogicalRange(range);
      }
      this._syncing = false;
    });

    this.mainChart.subscribeCrosshairMove((param) => this._updateLegend(param));

    this._applyData();
    this._rebuildIndicators();
    this._applyMarkers();
    this._applyPriceLines();
    this._setTimeVisibility();
  }

  _createPriceSeries() {
    const L = LWC();
    const c = this._colors();
    const common = {
      priceLineVisible: false,
      lastValueVisible: true,
    };
    if (this.chartType === "candles") {
      return this.mainChart.addCandlestickSeries({
        ...common,
        upColor: c.up,
        downColor: c.down,
        wickUpColor: c.up,
        wickDownColor: c.down,
        borderVisible: false,
      });
    }
    if (this.chartType === "bars") {
      return this.mainChart.addBarSeries({
        ...common,
        upColor: c.up,
        downColor: c.down,
      });
    }
    if (this.chartType === "area") {
      return this.mainChart.addAreaSeries({
        ...common,
        lineColor: "#26c6da",
        topColor: "rgba(38,198,218,0.28)",
        bottomColor: "rgba(38,198,218,0.02)",
        lineWidth: 2,
      });
    }
    return this.mainChart.addLineSeries({
      ...common,
      color: "#26c6da",
      lineWidth: 2,
    });
  }

  _setTimeVisibility() {
    const intraday = !["DAY", "WEEK"].includes(this.resolution);
    for (const chart of this.charts) {
      chart.timeScale().applyOptions({ timeVisible: intraday, secondsVisible: false });
    }
  }

  _updateLegend(param) {
    if (!this.legend) return;
    const candles = this.candles;
    const fallback = candles[candles.length - 1];
    let candle = fallback;
    if (param?.time) {
      const found = candles.find((c) => c.time === param.time);
      if (found) candle = found;
    }
    if (!candle) {
      this.legend.textContent = "";
      return;
    }
    const precision = pricePrecision(candle.close);
    const chg = candle.close - candle.open;
    const color = chg >= 0 ? "var(--green-bright)" : "var(--red)";
    this.legend.innerHTML = `
      <span style="color:${color}">${fmt.price(candle.open, precision)}</span>
      <span style="opacity:.75">H ${fmt.price(candle.high, precision)}</span>
      <span style="opacity:.75">L ${fmt.price(candle.low, precision)}</span>
      <span style="color:${color}">C ${fmt.price(candle.close, precision)}</span>
      <span style="opacity:.6">V ${candle.volume ?? 0}</span>`;
  }

  _applyData() {
    if (!this.mainSeries) return;
    const data =
      this.chartType === "candles"
        ? this.candles
        : this.chartType === "bars"
          ? this.candles.map((c) => ({ ...c, color: c.close >= c.open ? this._colors().up : this._colors().down }))
          : this.candles.map((c) => ({ time: c.time, value: c.close }));
    this.mainSeries.setData(data);
    if (this.candles.length) {
      const precision = pricePrecision(this.candles[this.candles.length - 1].close);
      this.mainSeries.applyOptions({
        priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
      });
    }
    this._rebuildIndicators();
    this._updateLegend(null);
  }

  _rebuildIndicators() {
    if (!this.mainChart) return;
    // Remove previously created sub panes and overlay series
    for (const sub of this.subPanes || []) {
      sub.chart.remove();
      sub.el.remove();
    }
    this.subPanes = [];
    for (const s of this.overlaySeries || []) this.mainSeries && s.series.remove();
    this.overlaySeries = [];

    // Volume pane
    if (this.showVolume) {
      this._buildVolumePane();
    } else if (this.volumeChart) {
      this.volumeChart.remove();
      this.paneVolume.remove();
      this.volumeChart = null;
    }

    for (const ind of this.indicators) {
      const def = INDICATORS[ind.type];
      if (!def || def.pane !== "overlay") continue;
      const computed = computeIndicator(ind.type, this.candles, ind.params);
      for (const out of def.outputs) {
        const points = computed[out.key];
        if (!points) continue;
        const series = this.mainChart.addLineSeries({
          color: out.color,
          lineWidth: out.type === "histogram" ? 1 : 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(points);
        this.overlaySeries.push({ series, key: out.key });
      }
    }

    for (const ind of this.indicators) {
      const def = INDICATORS[ind.type];
      if (!def || def.pane !== "sub") continue;
      this._buildSubPane(ind, def);
    }

    this.charts = [this.mainChart, ...(this.volumeChart ? [this.volumeChart] : []), ...this.subPanes.map((s) => s.chart)];
    this._setTimeVisibility();
    this._applyMarkers();
    this._applyPriceLines();
  }

  _buildVolumePane() {
    if (this.volumeChart) {
      this.volumeChart.remove();
    }
    if (!this.paneVolume.isConnected) this.area.append(this.paneVolume);
    const c = this._colors();
    const L = LWC();
    this.volumeChart = L.createChart(this.paneVolume, {
      autoSize: true,
      layout: { background: { type: "solid", color: c.bg }, textColor: c.text, fontSize: 10 },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: "transparent" } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { visible: false, borderColor: c.border },
      handleScroll: true,
      handleScale: true,
    });
    const series = this.volumeChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(
      this.candles.map((candle) => ({
        time: candle.time,
        value: candle.volume || 0,
        color: candle.close >= candle.open ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)",
      })),
    );
  }

  _buildSubPane(ind, def) {
    const c = this._colors();
    const L = LWC();
    const paneEl = el("div", { class: "chart-pane sub" });
    const title = el("div", {
      text: `${def.name}`,
      style: {
        position: "absolute",
        top: "3px",
        left: "10px",
        fontSize: "9.5px",
        letterSpacing: "0.6px",
        textTransform: "uppercase",
        color: "var(--text-faint)",
        zIndex: "5",
        pointerEvents: "none",
      },
    });
    paneEl.append(title);
    this.area.append(paneEl);
    const chart = L.createChart(paneEl, {
      autoSize: true,
      layout: { background: { type: "solid", color: c.bg }, textColor: c.text, fontSize: 10 },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: "transparent" } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { visible: false, borderColor: c.border },
      handleScroll: true,
      handleScale: true,
    });
    const computed = computeIndicator(ind.type, this.candles, ind.params);
    for (const out of def.outputs) {
      const points = computed[out.key];
      if (!points) continue;
      let series;
      if (out.type === "histogram") {
        series = chart.addHistogramSeries({
          color: out.color,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        series.setData(
          points.map((p) => ({
            ...p,
            color: out.colorBySign ? (p.value >= 0 ? c.up : c.down) : out.color,
          })),
        );
      } else {
        series = chart.addLineSeries({
          color: out.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(points);
      }
      for (const level of out.levels || []) {
        series.createPriceLine({
          price: level.value,
          color: level.color,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "",
        });
      }
      if (out.range) {
        chart.priceScale("right").applyOptions({
          mode: 0,
          autoScale: false,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        });
      }
    }
    this.subPanes.push({ chart, el: paneEl, uid: ind.uid });
  }

  /* ------------------------------ public API ------------------------------ */

  setData(candles) {
    this.candles = candles || [];
    this._applyData();
    if (this.mainChart && this.candles.length) {
      this.mainChart.timeScale().fitContent();
    }
  }

  updateLast(candle) {
    if (!candle || !this.mainSeries) return;
    const idx = this.candles.findIndex((c) => c.time === candle.time);
    if (idx >= 0) this.candles[idx] = candle;
    else this.candles.push(candle);
    this.mainSeries.update(
      this.chartType === "candles"
        ? candle
        : { time: candle.time, value: candle.close },
    );
  }

  setChartType(type) {
    if (type === this.chartType) return;
    this.chartType = type;
    if (this.mainSeries) {
      this.mainSeries.remove();
      this.mainSeries = this._createPriceSeries();
    }
    this._applyData();
  }

  setIndicators(list) {
    this.indicators = list || [];
    this._rebuildIndicators();
  }

  setShowVolume(show) {
    this.showVolume = show !== false;
    this._rebuildIndicators();
  }

  setResolution(resolution) {
    this.resolution = resolution;
    this._setTimeVisibility();
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.engine === "pro") this._buildPro();
    else this._buildTv();
  }

  setMarkers(markers) {
    this.markers = markers || [];
    this._applyMarkers();
  }

  _applyMarkers() {
    if (!this.mainSeries || !this.mainSeries.setMarkers) return;
    this.mainSeries.setMarkers(this.markers.filter((m) => this.candles.some((c) => c.time === m.time)));
  }

  setPriceLines(lines) {
    this.priceLines = lines || [];
    this._applyPriceLines();
  }

  _applyPriceLines() {
    if (!this.mainSeries) return;
    for (const line of this._activePriceLines || []) {
      try {
        this.mainSeries.removePriceLine(line);
      } catch {
        /* series may be rebuilt */
      }
    }
    this._activePriceLines = [];
    for (const spec of this.priceLines) {
      const line = this.mainSeries.createPriceLine({
        price: spec.price,
        color: spec.color,
        lineWidth: 1,
        lineStyle: spec.style ?? 0,
        axisLabelVisible: true,
        title: spec.title || "",
      });
      this._activePriceLines.push(line);
    }
  }

  /* ---------------------------- tv widget engine --------------------------- */

  setEngine(engine) {
    if (engine === this.engine && engine === "tv") return;
    this.engine = engine;
    if (engine === "tv") this._buildTv();
    else this._buildPro();
  }

  _buildTv() {
    this.engine = "tv";
    this.container.innerHTML = "";
    const wrap = el("div", {
      class: "tradingview-widget-container chart-tv-container",
      style: { height: "100%" },
    });
    const widget = el("div", {
      class: "tradingview-widget-container__widget",
      style: { height: "100%" },
    });
    wrap.append(widget);
    this.container.append(wrap);

    const symbol = TV_SYMBOLS[this.currentEpic] || this.tvSymbolFallback || "CAPITALCOM:UK100";
    const config = {
      autosize: true,
      symbol,
      interval: TV_INTERVALS[this.resolution] || "15",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
      theme: this.theme === "dark" ? "dark" : "light",
      style: "1",
      locale: "en",
      allow_symbol_change: true,
      save_image: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      with_floating_toolbar: true,
      studies: [],
      support_host: "https://www.tradingview.com",
    };
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify(config);
    wrap.append(script);
    const note = el("div", {
      class: "chart-watermark",
      html: 'TradingView® widget — sign in inside the chart to use your saved TradingView indicators &amp; layouts',
    });
    this.container.append(note);
  }

  setSymbol(epic, tvFallback) {
    this.currentEpic = epic;
    this.tvSymbolFallback = tvFallback;
    if (this.engine === "tv") this._buildTv();
  }

  destroy() {
    for (const sub of this.subPanes || []) sub.chart.remove();
    this.subPanes = [];
    if (this.volumeChart) this.volumeChart.remove();
    if (this.mainChart) this.mainChart.remove();
    this.container.innerHTML = "";
  }
}

export function indicatorMenuData() {
  return Object.values(INDICATORS)
    .filter((d) => d.id !== "volume")
    .map((d) => ({ id: d.id, name: d.name, category: d.category, pane: d.pane }));
}

export { defaultParams };
