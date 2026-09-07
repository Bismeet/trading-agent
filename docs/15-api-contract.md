# 15 — Engine/dashboard contract

## SOURCE REQUIREMENT — transport (P9)

One read-only endpoint: **GET `/api/state`**, implemented in `web/app/api/state/route.ts`. No request parameters, body, pagination API or mutation endpoints are specified. Do not invent POST order controls or a database service.

Route is dynamic (`force-dynamic`, `revalidate=0`), sets `Cache-Control: no-store`, resolves root as `path.resolve(process.cwd(),"..")` when running from web, then reads root config.json and data files. Root polls every six seconds with fetch cache no-store. This filesystem access requires a runtime that can read the engine's shared local data directory; a separate stateless frontend host is not the source architecture.

## File reads and bounds

| Read | Source behavior | Response use |
|---|---|---|
| root config.json | Read configuration | Placement in response not explicitly stated |
| signals.v2.json | Primary signals | v2.signals |
| signals.json | Fallback only if version===2 | v2.signals fallback; never use legacy v1 as v2 |
| state.v2.json | Current state | v2 state conceptual member; exact key implied, not explicit code |
| episodes.jsonl | Last 40 | v2.episodes; ordering not explicitly reversed |
| generations.jsonl | Last 30, reversed | v2.generations newest first |
| strategies.json | Library | v2.strategies; array versus library wrapper ambiguous |
| memory.jsonl | Last 20, reversed | v2.memory newest first |
| equity.v2.jsonl | Downsample to maximum 320 points | v2.equity; algorithm and episode selection unspecified |
| trades.v2.jsonl | Last 60, reversed | v2.trades newest first |

Source says return a v2 object holding all of that plus serverTs; exact top-level placement of serverTs/config is ambiguous. Missing files return safe empty defaults so dashboard does not crash. SOURCE DOES NOT SPECIFY status codes/error bodies for malformed files, mixed-write snapshots, unsupported methods or server failures. Safe dashboard defaults must not be mistaken for authority to reset engine balances.

## Published signal schema — P8

Required names: `ts,iso,version,episodeNum,equity,walletBalance,startingCapital,goal,totalPnl,totalPnlPct,progressPct,goalGap,realizedPnlEpisode,peakEquity,maxDrawdownPct,riskState,regime,generation,aggression,lifetime,fundingRate,investedNotional,grossLeverage`, plus `positions`, `watch`, recent episodes, brain and world digests.

- `version` exactly 2; ts epoch milliseconds, iso ISO date string via source now/iso helpers.
- Numbers monetary in accounting USD as intended; exact currency normalization is unresolved in engine.
- goal/aggression/lifetime fields in 06/11; positions array includes exact names in 07.
- `watch` row schema is not specified, though quotes and indicators are natural inputs.
- `brain` conceptual fields in 12; exact avoid-list schema missing.
- `world` exact 17 keys in 13; nested provider/gauge/headline schemas incomplete.
- Episode/generation/memory/fill/equity shapes partially specified in 06. Do not claim this is a complete author-defined JSON Schema.

### Quote contract — P2

Success `{symbol,price,prevClose,changePct,marketState,currency,sessionStart,ok:true}`; failure `{symbol,ok:false}`. P8 adds stale marking when preserving old quotes; exact field name and age thresholds are not explicit. Enriched q adds `closes`, `closesIntraday` for crypto, `sma20,sma50,rsi,mom,trend,bias`; source does not provide observation timestamps in the base quote contract.

## RECOMMENDED IMPROVEMENT — concrete completion contract

The following choices are proposed for implementation approval, not source requirements:

| Response member | Proposed type/default | Notes |
|---|---|---|
| config | object or null | Root settings; never used by browser to mutate engine |
| serverTs | finite epoch milliseconds | Time route created response; not a live-engine heartbeat |
| v2.signals | source signal object or null | Missing signal means uninitialized/unavailable, not equity=0 |
| v2.state | source state object or null | Preserve map positions here |
| v2.episodes | episode[] / [] | Preserve source chronological tail; display may reverse locally |
| v2.generations | generation[] / [] | Newest first |
| v2.strategies | strategy[] / [] | Unwrap file's strategies array explicitly |
| v2.memory | lesson[] / [] | Newest first |
| v2.equity | equityPoint[] / [] | Time ascending; maximum 320; no averaging across reset boundary |
| v2.trades | fill[] / [] | Newest first |
| status | proposed object | Per-file availability/staleness, snapshot consistency, errors; do not expose fabricated metrics |

Proposed record completions: equityPoint includes ts,episodeId,episodeNum,equity; fills include unique eventId,trade_id,episodeId,ts,op,side,symbol,leverage,reason,margin/net_pnl as applicable; memory includes id,createdAt,title,kind,text,regime,importance; generations includes generation,episodeNum,ts,aggression,note. These names are **new recommendations** where source does not supply exact keys. Avoid rewriting original fields just to match preferred naming.

### Errors and consistency

Proposed status policy: 200 with defaults and per-file status for expected uninitialized/missing artifacts; 200 partial response with explicit warnings for optional unavailable history; 503 with a structured error when core snapshot cannot be safely interpreted after initialization. No silent malformed-state→fresh-balance conversion. Exact policies require approval because source only mandates missing-file defaults.

Per-file rename prevents partial JSON visibility, not a coherent cross-file read. Prefer engine publish-last coherent snapshot with a common cycle/snapshot ID; route retries or marks mismatch rather than mixing old positions and new equity. All source artifacts remain filesystem-backed. Respect FAB_SIGNALS through a shared path resolver after approval, otherwise document that route cannot see the overridden engine output.

### Serialization / numerical units

Proposed types: monetary/ratio values finite JSON numbers; absent/undefined statistical quantities null with explanation, never NaN/Infinity or invented zero. `Pct` display fields use percentage points, source fractional parameters stay fractions; fundingRate is a signed fraction per defined 8h interval. Include currency/units in provider normalization. Timestamps UTC epoch milliseconds plus ISO where requested, no locale date strings in persistence. Full computational precision in snapshots; formatting to cents belongs in UI. Round DSR returned metrics to three decimals as source specifies while retaining raw gating decision.

### Refresh and sample selection

One poll supplies all tabs. Keep prior data while refreshing; engine signal ts determines freshness. Do not infer trading liveness from serverTs. Proposed deterministic equity downsampling preserves first/last/current-run boundaries and selects representative points; exact algorithm is a required choice. Reading 320 output points must not require unbounded parsing of years of JSONL on every six-second request; bounded-tail/index optimization remains a file-backed recommendation.

## Contract acceptance

Verify all eight tabs consume the same agreed schema, unknown/missing fields produce an honest state, array ordering is stable, signals fallback checks version, periods and monetary units are consistent, no lost negative P&L through formatting, and the route remains read-only. Source dependencies on process.cwd, relative data and deployment location must be tested rather than redesigned silently.
