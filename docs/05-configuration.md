# 05 — Configuration and dependencies

## SOURCE REQUIREMENT — P1 config payload

The following preserves the supplied JSON keys and numeric values. It is a specification excerpt, not an application `config.json`. P1 says byte-for-byte; line-ending/whitespace fidelity of a future generated file must be checked against the supplied source block rather than claimed from this rendered Markdown.

```json
{
  "startingCapital": 1000,
  "goal": 5000,
  "currency": "USD",
  "watchlist": [
    { "symbol": "BTC-USD", "name": "Bitcoin", "market": "crypto", "icon": "B" },
    { "symbol": "ETH-USD", "name": "Ethereum", "market": "crypto", "icon": "E" },
    { "symbol": "SOL-USD", "name": "Solana", "market": "crypto", "icon": "S" },
    { "symbol": "XRP-USD", "name": "XRP", "market": "crypto", "icon": "X" },
    { "symbol": "DOGE-USD", "name": "Dogecoin", "market": "crypto", "icon": "D" },
    { "symbol": "AAPL", "name": "Apple", "market": "us", "icon": "" },
    { "symbol": "NVDA", "name": "NVIDIA", "market": "us", "icon": "N" },
    { "symbol": "MSFT", "name": "Microsoft", "market": "us", "icon": "M" },
    { "symbol": "TSLA", "name": "Tesla", "market": "us", "icon": "T" },
    { "symbol": "AMZN", "name": "Amazon", "market": "us", "icon": "A" },
    { "symbol": "RELIANCE.NS", "name": "Reliance", "market": "india", "icon": "R" },
    { "symbol": "TCS.NS", "name": "TCS", "market": "india", "icon": "T" },
    { "symbol": "INFY.NS", "name": "Infosys", "market": "india", "icon": "I" },
    { "symbol": "HDFCBANK.NS", "name": "HDFC Bank", "market": "india", "icon": "H" }
  ],
  "indices": [
    { "symbol": "BTC-USD", "name": "Bitcoin", "icon": "B" },
    { "symbol": "ETH-USD", "name": "Ethereum", "icon": "E" },
    { "symbol": "^GSPC", "name": "S&P 500", "icon": "US" },
    { "symbol": "^NSEI", "name": "NIFTY 50", "icon": "IN" }
  ],
  "benchmarkBasket": ["BTC-USD", "ETH-USD", "AAPL", "NVDA", "RELIANCE.NS"],
  "fees":     { "crypto": 0.001,  "us": 0.0005,  "india": 0.0005 },
  "slippage": { "crypto": 0.0010, "us": 0.0005,  "india": 0.0005 },
  "risk": {
    "maxPositionPct": 0.30,
    "minCashPct": 0.02,
    "stopLoss":      { "crypto": 0.09, "us": 0.06, "india": 0.06 },
    "takeProfit":    { "crypto": 0.25, "us": 0.16, "india": 0.16 },
    "trailingActivatePct": 0.12,
    "trailingGivebackPct": 0.05,
    "ddCaution": 0.12,
    "ddHalt": 0.20,
    "hardFloorPct": 0.70
  },
  "loopSeconds": 60,
  "historyRefreshMinutes": 20,
  "v2": {
    "enabled": true,
    "startingCapital": 100,
    "immutableCore": "honesty",
    "episode": {
      "autoResetOnBlowup": true,
      "maxHoursPerEpisode": 24,
      "blowupEquity": 0,
      "goal": { "target": 500, "deadlineHours": 24 }
    },
    "aggression": {
      "leverageStart": 20,
      "leverageCeiling": 40,
      "kellyFractionStart": 0.45,
      "kellyFractionMax": 0.7,
      "volTargetAnnual": 0.60,
      "earnItUnlockStep": 3.5,
      "trailActivateRoi": 0.5,
      "trailGiveRoi": 0.25,
      "maxHoldHours": 4
    },
    "leverage": {
      "crypto": { "enabled": true, "maxLeverage": 40, "funding": true },
      "us":     { "enabled": true, "maxLeverage": 4,  "funding": false, "borrowAnnual": 0.08 },
      "india":  { "enabled": true, "maxLeverage": 5, "funding": false }
    },
    "perpFees":     { "taker": 0.0005, "maker": 0.0002 },
    "markEmaAlpha": 0.25,
    "fundingHoursUTC": [0, 8, 16],
    "maintenanceTiers": {
      "crypto": [
        { "floor": 0, "cap": 50000, "maxLev": 125, "mmr": 0.004, "deduction": 0 },
        { "floor": 50000, "cap": 600000, "maxLev": 100, "mmr": 0.005, "deduction": 50 },
        { "floor": 600000, "cap": 3000000, "maxLev": 75, "mmr": 0.01, "deduction": 3050 }
      ],
      "us": [ { "floor": 0, "cap": 100000000, "maxLev": 4, "mmr": 0.12, "deduction": 0 } ],
      "india": [ { "floor": 0, "cap": 100000000, "maxLev": 5, "mmr": 0.10, "deduction": 0 } ]
    },
    "strategies": {
      "loopSeconds": 30,
      "brainLoopMinutes": 8,
      "maxConcurrentPositions": 10,
      "minNotionalUsd": 2
    }
  }
}
```

## Consumers and unresolved precedence

- P3 uses `v2.startingCapital`, episode goal/timeout/blowup, and aggression starts; root capital/goal do not govern v2 episodes.
- P5 uses v2 market maxima, aggression cap/ceiling, Kelly start and annual volatility target. It hardcodes a 0.98 wallet multiplier rather than reading root `risk.minCashPct`.
- P8 uses history refresh 20 minutes, one-year daily history, approximately ten-minute intraday refresh, EMA 0.25, funding UTC schedule, four-hour max hold and ten-position maximum. P11 fixes active v2 cadence at 30 seconds, not root 60.
- Source root risk settings define caution/halt/floor but P8 does not specify state transitions/enforcement. `maxPositionPct` 0.30 is not used by the exact P5 algorithm (strategy base can reach 0.40 before other multipliers).
- `benchmarkBasket`, maker execution, root fees/slippage precedence, `v2.enabled`, `kellyFractionMax`, `autoResetOnBlowup`, `minNotionalUsd`, and US borrow calculation have incomplete or absent wiring. Preserve keys; do not pretend mere presence makes them effective.
- Seed `stopPct/targetPct` differ from root per-market stops/targets. Priority/fallback requires a decision. Trailing v2 ROI fractions differ from root price-return fractions.
- SOURCE DOES NOT SPECIFY schema validation, hot reload behavior or immutable snapshot/version binding for a run.

## SOURCE REQUIREMENT — manifests

Root name `fabinvests-engine`, version `1.0.0`, private `true`, type `module`; no third-party engine dependencies. Uses built-in Node `fs`, global `fetch`, AbortController and crypto hashing.

| Root script | Exact command |
|---|---|
| init | `node scripts/init.mjs` |
| cycle | `node scripts/daemon.mjs --once` |
| daemon | `node scripts/daemon.mjs` |

Web scripts: dev=`next dev`, build=`next build`, start=`next start`.

| Web dependency | Exact declaration | Role |
|---|---|---|
| next | 16.2.9 | App Router and filesystem route |
| react | 19.2.4 | UI |
| react-dom | 19.2.4 | DOM rendering |
| recharts | ^3.8.1 | Charts |
| motion | ^12.40.0 | Animation dependency; exact use unspecified |
| @tailwindcss/postcss | ^4 | Development CSS integration |
| tailwindcss | ^4 | Development styling |
| typescript | ^5 | Development type checking |
| @types/node | ^20 | Development Node typings |
| @types/react | ^19 | Development React typings |
| @types/react-dom | ^19 | Development React DOM typings |

Node: check `node -v`; use nodejs.org LTS if missing. SOURCE DOES NOT SPECIFY Node major, package manager or lockfile. `.gitignore`: node_modules, .next, data/*.log. `FAB_SIGNALS` overrides V2.signals; no other environment variable is named.

## RECOMMENDED IMPROVEMENT — 2026 verification

As of this review date, package versions and public APIs were not queried against registries/providers. No listed version is certified current, available or obsolete. Verify exact declarations and peer/Node requirements on npm and framework release documentation; commit a lockfile and record the resolved Node/package-manager versions. Resolve root aliases separately; do not silently replace exact P1 settings. A source-exact config fixture should remain available even if approved improvements introduce validation or effective-risk reporting.
