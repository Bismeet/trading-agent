# 13 — World and market context

## SOURCE REQUIREMENT — market data (P2/P8)

All requests use a desktop User-Agent and 12-second AbortController timeout. `getJSON(url)` and `getText(url)` are general helpers; POST configuration required by Hyperliquid is not present in their supplied signatures, so collector transport must be completed explicitly.

| Source/helper | Provides | Keys | Frequency/cache | Failure behavior and trading effect |
|---|---|---|---|---|
| Yahoo `YH(sym,range,interval)` chart | Quote/history data | Source says none | Quotes each 30s v2 cycle; parallel watchlist+indices | Last-good quote marked stale; no entries on missing/stale |
| fetchQuote(symbol) | symbol,price,prevClose,changePct,marketState,currency,sessionStart,ok:true | None stated | Current cycle | If failure and suffix -USD, Coinbase fallback; otherwise {symbol,ok:false} |
| Coinbase `api.coinbase.com/v2/prices/SYM/spot` | Crypto spot fallback | None stated | On failed Yahoo crypto quote | SOURCE DOES NOT SPECIFY missing change/session fields or timestamp normalization; do not invent them |
| fetchHistory(symbol,range="6mo",interval="1d") | Numeric close array | None stated | Engine overrides with one-year daily every 20m | Failure/cache contract unspecified; reject insufficient history for required indicators |
| Yahoo intraday history | Five days of 15m crypto closes | None stated | Approximately every 10m | Complete-bar filtering/response contract absent; no fake bars |
| fetchFx / Yahoo `USDINR=X` | INR per USD | None stated | Each engine cycle | Literal fallback 83.0; conflicts with never-fabricate principle if represented as live |

P8 one-year history is needed for SMA200 and ≥210-bar RSI2 warmup; generic six-month default is not sufficient for US trading-day data. Daily and intraday arrays omit timestamps in the source API; this must be improved before historical causality can be tested reliably.

## SOURCE REQUIREMENT — world provider inventory (P7)

Every world source is described as keyless/free; availability, current API terms and rate limits were not independently verified. Each has a TTL in the **5–60 minute range**, but exact per-source values are SOURCE DOES NOT SPECIFY. Use last good cache on failures; missing observations show a dash. Recommended stale labeling reconciles cache reuse with honesty.

| Provider key | Source/API | Data | Special constraints / system influence |
|---|---|---|---|
| macro | Yahoo ^TNX, ^VIX, DX-Y.NYB, CL=F, GC=F | Yields, volatility, dollar, oil, gold quotes | regimeScore→world regime/posture/drivers; exact economic units require validation |
| cryptoFng | `api.alternative.me/fng/?limit=1` | Crypto fear/greed index | Gauge/band; missing cannot become neutral observation |
| cnnFng | `production.dataviz.cnn.io/index/fearandgreed/graphdata` | Stock fear/greed | Gauge/band; HTTP access/response shape can change |
| cboePutCall | Current CBOE put/call CSVs; exact URLs absent | Put/call ratio with observation date | Reject rows older than about six days; show dash, never fake-live old rows |
| hyperliquid | POST `api.hyperliquid.xyz/info`, body `{type:"metaAndAssetCtxs"}` | BTC, ETH, SOL funding, open interest, mark | Compute average 8h funding and crowd read; sets state.fundingRate; source-rate interval and averaging weights absent |
| stocktwits | `api.stocktwits.com/api/2/streams/symbol/SYM.json` for AAPL,NVDA,TSLA | Bull/bear counts | Social context; neutral/unlabeled posts and count normalization unspecified |
| fedHeadlines | Federal Reserve press RSS; exact URL absent | Titles | Fed/news presentation and context; no automatic macro trade gate specified |
| cryptoNews | Cointelegraph and Decrypt RSS; exact URLs absent | Titles aggregated by aggregateNews | Sentiment/headline display; source attribution and deduplication unspecified |
| gdeltTone | GDELT tonechart query “stock market”; full URL/query parameters absent | Tone time series/context | Mapping to digest/scoring absent; cannot invent direct trading signal |

OI USD conversion may require multiplying coin-denominated OI by mark; SOURCE DOES NOT SPECIFY actual provider unit conversion. Funding covers three assets while watchlist has five crypto symbols. Applying a single average to XRP/DOGE or reconstructing missed historical payments from the latest rate is an approximation, not instrument-specific venue accounting.

## Pure world scoring

`scripts/world/score.mjs` imports mean/stdev.

- POS words: surge, rally, jump, gain, beat, upgrade, bullish, record, growth, breakout, adoption, approval, inflows, rebound and similar; weights .5 to 2. Exact per-word map and additional words not supplied.
- NEG: crash, plunge, plummet, slump, miss, downgrade, bearish, selloff, hack, fraud, scam, liquidation, recession, bankruptcy, panic and similar; weights −1 to −2.5. Exact map missing.
- `lexiconScore(text)`: lowercase, strip punctuation, sum matched weights; prior word in not/no/never/without/despite flips a weight to −.7×original; divide by 3 and clamp [−1,1]; no hits returns 0. Tokenization details/multiword phrases unspecified.
- `fngBand(v)`: missing→unknown; ≤24 extreme_fear; ≤44 fear; ≤55 neutral; ≤74 greed; else extreme_greed. Validation outside 0–100 and nonnumeric values unspecified; recommended reject invalid values rather than classifying them.
- `regimeScore(m)`: macro records each {price,changePct}. Dollar up/yields up/high VIX lower score; calm VIX raises it. Clamp [−1,1]; return `{label,score,posture,drivers}` with label risk_on/risk_off/neutral and posture defensive/cautious/normal/aggressive. Coefficients, thresholds, oil/gold effects and missing-data behavior are SOURCE DOES NOT SPECIFY.
- `aggregateNews(items)`: each item has title; score with lexiconScore and return `{mean_s,dispersion,volume,impact,n,top,mixed}`. mixed when dispersion>.45. Source does not define exact volume/impact/top selection or whether dispersion is sample stdev. Do not fabricate aggregate certainty from disagreeing headlines.

## Collector output — exact digest fields

`regime, risk_posture, macro, crypto, fearGreedCrypto, fearGreedStocks, putCall, fundingRate, whaleCrowd, oiUsd, fed, headlines, newsMood, social, thesis, deep_due`.

Write world.v2.json, use V2.worldCache folder for last-good source observations, set state.fundingRate from live Hyperliquid funding, return compact digest. `world_thesis.v2.json`, `lastWorldDeepTs`, `lastWorldRegime`, `deep_due` exist conceptually, but thesis generator, deep scheduling and their schemas are not implemented by any exact source algorithm. No LLM call is specified.

## Two regime systems — do not merge silently

Lib regime is trading context from BTC/^GSPC/^NSEI trends and riskState: risk_off, broad_up, crypto_down_highvol, crypto_down, us_down, mixed_chop. World regime is macro score label risk_on/risk_off/neutral. Memory relevance compares regime strings exactly. If world labels replace trading labels without migration, retrieval/grouping changes. Source does not define a mapping or identify which label all journal records use.

## No fabricated missing data

Source prohibits fake values and blocks entries with missing/stale quote data. Optional world information is context, not permission to create a trade. Missing stock sentiment must not automatically become bullish, bearish or numeric zero. At cycle step 8, new funding is collected only after this cycle's funding accrual; the source therefore uses previously available state funding unless restructured.

## RECOMMENDED IMPROVEMENT — operational completion

Preserve the sources and cache layer. Give each provider observation/source timestamps, fetchedAt, lastSuccessAt, expiresAt, status and unit/provenance metadata; this is a proposed schema, not source. Stale cached optional context may display with age but must not masquerade as live. Hard-expire CBOE stale rows even if fetch succeeds. Treat missing required quote/FX/funding data via an explicit policy: block new relevant exposure; record unavailable accrual rather than inventing zero-rate funding. Do not silently replace literal FX=83 fallback; mark it an approved source deviation if disabled.

Use independent bounded asynchronous collectors so 12s timeouts across providers cannot stall the 30s trading cadence. No retries without a limit; provider failures do not erase last-good data. Validate funding interval/units and asset mapping before charging. Record exact source URLs/TTLs only after verification; these are open implementation decisions, not facts inferred from the article.
