# TradingDesk

A browser trading terminal for stocks, shares, indices, FX, commodities and crypto:

- **Trade** — TradingView-powered charts (Lightweight Charts™) with 20+ indicators, candle/bar/line/area types, an optional full TradingView widget, a professional order ticket (market / limit / stop, stop-loss, take-profit, guaranteed & trailing stops), a position-size calculator, and live open-positions / working-orders / account / activity panels.
- **Watchlist** — live quote board with sparklines and price alerts (sound + toast).
- **Journal** — trade log with notes, tags, setups, mistakes, emotions and grades; CSV import/export; one-click import of closed trades detected from the broker.
- **Analytics** — win rate, profit factor, expectancy, R-multiples, equity curve, drawdown, daily P&L, weekday×hour heatmap, breakdowns by market/setup/direction/mistakes, and rule-based coaching insights.
- **Settings** — broker connection, trading defaults, theme, access code, data export/import, simulator controls.

Everything works out of the box in **Simulated mode** with realistic generated prices and a full simulated broker (fills, stops, targets, working orders, account balance). Add your Capital.com API credentials to trade a real (demo or live) account.

## Quick start

```bash
node server.mjs          # or: npm run dev
# open http://localhost:3000
```

No build step, no dependencies — plain ES modules served by a small Node server that also proxies the Capital.com API.

## Connecting your Capital.com account

The app never sends your API credentials to the browser. They live server-side in environment variables:

| Variable | Meaning |
|---|---|
| `CAPITAL_API_KEY` | Your Capital.com API key (My API Keys in your Capital.com profile) |
| `CAPITAL_IDENTIFIER` | Your Capital.com login identifier (email) |
| `CAPITAL_PASSWORD` | Your **API password** (set when creating the API key — not your account password) |
| `CAPITAL_ENV` | `demo` (default, strongly recommended) or `live` |
| `APP_ACCESS_CODE` | Optional shared password so only you can use the deployment |

For local development put them in a `.dev.vars` file (loaded automatically by `server.mjs`):

```bash
CAPITAL_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CAPITAL_IDENTIFIER=you@example.com
CAPITAL_PASSWORD=your-api-password
CAPITAL_ENV=demo
APP_ACCESS_CODE=a-long-random-string
```

Then open **Settings → Connection → Run test**. The header pill switches from `SIMULATED` to `CAPITAL.COM DEMO` (or `LIVE`).

> ⚠️ **Always start with `CAPITAL_ENV=demo`.** CFDs are complex instruments with a high risk of losing money rapidly. This tool is not financial advice.

### Security notes

- CST / `X-SECURITY-TOKEN` session tokens are held **server-side only** and refreshed automatically.
- If you deploy publicly, set `APP_ACCESS_CODE` and enter it in Settings → Security (kept in the tab session only).
- Every request from the app carries a same-origin / app-request check on the server.

## Deployment (Cloudflare Workers)

The exact same backend runs as a Cloudflare Worker (`worker.js`) and serves the static frontend:

```bash
# deploy-manifest.json is ready for the Sites/Workers deploy pipeline
npx wrangler deploy --config deploy-manifest.json   # or use Freebuff Sites
```

Set the `CAPITAL_*` and `APP_ACCESS_CODE` values as Worker secrets — never in code. The project is pure static assets + one fetch handler, so any static host + small Node/Worker proxy also works (`server.mjs` is the reference implementation).

## Architecture

```
worker.js                 Cloudflare Worker: static files + /api/status + /api/capital/* proxy (single session, keep-alive, error mapping)
server.mjs                Local dev server: serves public/ and delegates API calls to the same worker.js handler
public/
  index.html              App shell: header tabs, account pill, connection indicator, clock
  css/styles.css          Full design system (dark default + light theme)
  js/app.js               Entry point: tab routing, quote/alert/broker polling loops
  js/api.js               Broker client — transparently switches real proxy ↔ simulated engine
  js/demo.js              Deterministic simulated market data + simulated broker (persisted in localStorage)
  js/indicators.js        22 indicators (SMA, EMA, RSI, MACD, Bollinger, ATR, Stochastic, …) with editable params
  js/chart.js             ChartPanel: Lightweight Charts panes, sub-indicator panes, trade markers, price lines, TV widget engine
  js/store.js             localStorage state (settings, watchlist, alerts, journal, closed trades) + event bus
  js/util.js              DOM/format helpers, toasts, modals, CSV import/export
  js/tabs/…               trade, watchlist, journal, analytics, settings
  vendor/                 lightweight-charts.standalone.production.js (Apache 2.0)
```

### How trading works

1. The order ticket builds a deal ticket (epic, direction, size, order type, stop/target as distance or absolute level).
2. `api.js` sends it to `/api/capital/positions` (market) or `/api/capital/workingorders` (pending) — or to the simulated broker when no credentials are configured.
3. The backend creates/refreshes the Capital.com session and proxies the request; the deal reference is polled via `/confirms/{ref}` until accepted.
4. Closed positions are detected automatically and offered in **Journal → Import from broker** (deduped by deal ID).

### Persistence

- **Browser (localStorage):** settings, watchlist, alerts, journal, detected closed trades, simulator state. Export/import it all from Settings → Data.
- **Server:** nothing persisted — the Worker is stateless; the Capital.com session is created per cold start and kept alive in memory.

## Testing

```bash
node artifacts/check-imports.mjs    # static ES-module wiring + asset check
node artifacts/e2e-smoke.mjs        # headless-Chromium end-to-end smoke test (Playwright)
```

The e2e tests need Playwright once: `npm i -D playwright && npx playwright install chromium`.

The smoke test boots the app, places a simulated trade, records a journal entry, and verifies every tab renders with no page errors (15 checks).

## Roadmap ideas

- Streaming prices via Capital.com's WebSocket (WSS) instead of polling
- Multi-account switching and account-level analytics
- Strategy backtesting from journal data
- Pine Script indicator porting helper

## Credits

- Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (Apache 2.0).
- Optional chart widget: TradingView® (their terms apply; you stay logged in to access your saved indicators/layouts).
- Broker integration: Capital.com Open API.
