# 04 — File and module specification

## SOURCE REQUIREMENT — expected application tree

This is a specification, not files created by this documentation change. Bracketed descriptions are annotations, not proposed filenames.

```text
project/
├── package.json
├── config.json
├── .gitignore
├── scripts/
│   ├── lib.mjs
│   ├── init.mjs                 [P1 command target only; no implementation prompt]
│   ├── daemon.mjs               [P1 command target only; no implementation prompt]
│   ├── world/
│   │   └── score.mjs
│   └── v2/
│       ├── store.mjs
│       ├── perp.mjs
│       ├── episode.mjs
│       ├── strategies.mjs
│       ├── sizing.mjs
│       ├── brain.mjs
│       ├── world.mjs
│       ├── init.mjs
│       └── engine.mjs
├── data/                       [full artifact inventory in 06]
└── web/
    ├── package.json
    └── app/
        ├── globals.css
        ├── layout.tsx
        ├── page.tsx
        ├── api/state/route.ts
        ├── lib/format.ts
        └── components/
            ├── Root.tsx
            ├── visuals.tsx
            └── DashboardV2.tsx
```

P1 also requires a fresh Next app; SOURCE DOES NOT SPECIFY names/content of its generated TypeScript, PostCSS, Next configuration, lockfile or public asset files. Do not present a chosen scaffold's incidental files as author-mandated paths.

## Backend module contracts

| File / prompt | Responsibility and named interface | Inputs → outputs | Storage and dependents |
|---|---|---|---|
| `package.json` / P1 | Root ESM manifest, no external dependencies, three CLI scripts | Runtime/package tooling → Node commands | All engine modules |
| `config.json` / P1 | Single settings payload | None → config object | lib, init, engine, strategies, sizing, episodes, brain, world and API |
| `.gitignore` / P1 | Ignore node_modules, .next, data/*.log | Paths → Git ignore behavior | Not a runtime module |
| `scripts/lib.mjs` / P2 | ROOT, DATA, PATHS; file/network/date/hash/indicator/stat/regime toolbox | Paths, observations, numbers → persisted objects or computed values | All backend modules through direct imports or store re-exports; full exports in 01 |
| `scripts/v2/store.mjs` / P2 | Re-export lib helpers; V2 paths; round(x,d=2), clamp(x,lo,hi) | Relative root/environment → paths; numbers → numbers | All v2 modules; exact path registry in 06 |
| `scripts/v2/perp.mjs` / P2 | Pure leverage/funding/fee/mark/fill math; position builders | Trade numeric arguments → scalar/position/mark result | No file access; engine, sizing integration and unit tests |
| `scripts/v2/episode.mjs` / P3 | Fresh state, peak tracking, end reason, finalize/reset/setGoal | State/config/time/extra → state or record | Appends V2.episodes; engine caller owns state persistence; brain consumes records |
| `scripts/v2/strategies.mjs` / P4 | Seed registration, six signals, strategyExit, runStrategies | Enriched quotes/state/config/cache → order intents | Reads/writes V2.strategies; engine/sizing/brain/dashboard depend on stable IDs |
| `scripts/v2/sizing.mjs` / P5 | sizeOrder; internal dailyVol | State/order/eq/config → sized open order or unchanged non-open | Reads V2.strategies; no writes; engine consumes |
| `scripts/v2/brain.mjs` / P6 | Statistics, lifecycle, lessons, retrieval, evolution, onClose and buildBrainV2 | Closed trades/state/episode/config/regime → learned library/digests | Reads journals/world/memory; writes strategies/memory/generations/reflog; engine/API consumers |
| `scripts/world/score.mjs` / P7 | POS/NEG maps; lexiconScore, fngBand, regimeScore, aggregateNews | Text/macro/news observations → bounded context scores | Pure; collector depends on it |
| `scripts/v2/world.mjs` / P7/P8 | collectWorld, keyless cached provider aggregation | Config/state/time/provider responses → world digest, fundingRate | V2.world and V2.worldCache; worldThesis is only reserved; engine/brain/UI depend |
| `scripts/v2/init.mjs` / P8 | CLI initialization, optional --force | Config/existing state/flag → preserved or fresh state, seeded library, empty pending | Reads state, writes state/strategies/pending; no export name supplied |
| `scripts/v2/engine.mjs` / P8 | --once or continuous loop; markAndManage, publishSignals | Persisted state and feeds → trading cycle and UI snapshot | Owns state/prices/signals/trades/journal/equity/log; invokes episode/brain/world writers |
| `scripts/init.mjs`, `scripts/daemon.mjs` / P1 | Referenced command targets only | SOURCE DOES NOT SPECIFY implementation | Not created by any later prompt; recommended alias decision in 19 |

## Frontend module contracts

| File | Responsibility/interface | Inputs → outputs and interactions |
|---|---|---|
| `web/package.json` | Next/React/chart/motion/Tailwind/TS manifests and dev/build/start | Tooling → separate web process |
| `web/app/globals.css` | Exact P9 tokens, glass cards, sky/sun/petal/mascot animations | DOM classes → sakura design; all components |
| `web/app/layout.tsx` | Metadata, fonts, globals import, sky/sun backgrounds | children → root layout; export naming not explicitly prescribed |
| `web/app/page.tsx` | Render Root | Page → client Root |
| `web/app/components/Root.tsx` | Client Root; six-second no-store fetch; loading Mascot | GET /api/state → DashboardV2 data prop |
| `web/app/lib/format.ts` | usd, pct, signed, tone, price, timeAgo | Nullable/number/time values → formatted strings/classes; no I/O |
| `web/app/components/visuals.tsx` | Client Sakura and Mascot({size,mood}) SVG components | Deterministic petal positions or mascot props → decoration |
| `web/app/api/state/route.ts` | Dynamic file-backed state route; force-dynamic/revalidate 0 | Request → config + v2 snapshot + server time; root files read only |
| `web/app/components/DashboardV2.tsx` | Client eight-view dashboard from data.v2 | Root data → navigation, views, cards/charts/lists; no engine writes |

## SOURCE DOES NOT SPECIFY

Export visibility of the individual signal functions, default versus named exports for page/layout/components, collector argument signature, engine internal function signatures, exact pending-queue helpers, identifiers for history caches, or component decomposition beyond the named files. Keep chosen interfaces explicitly marked as implementation decisions.
