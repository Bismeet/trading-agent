# 09 — Deterministic strategy specification

## SOURCE REQUIREMENT — exact six seeds (P4)

Every seed starts `status:"candidate"`. Markets shorthand below expands C=crypto, U=us, I=india; preserve actual arrays of those strings in implementation. Numeric stop/target values are underlying-price fractions, not account-risk percentages. Only `ibreakout` explicitly has `intraday:true`; absence is not a false-valued source field.

| id / name | setup_tag | markets | baseLev | stopPct | targetPct | Time/data scope |
|---|---|---|---:|---:|---:|---|
| tsmom / Time-series momentum | momentum | C,U,I | 12 | .05 | .10 | Daily closes, nominal 28-day return, optional SMA200 |
| donchian / Donchian breakout | breakout | C,U,I | 12 | .05 | .08 | Daily close channels 20/10, optional SMA200 |
| rsi2dip / RSI-2 dip (Connors) | mean-reversion | C,U,I | 10 | .05 | .06 | Daily RSI2, required SMA200 |
| mom_trend / Momentum + trend | trend | C,U,I | 10 | .05 | .08 | Daily return, q.mom/q.rsi, optional SMA200 |
| orb / Opening-range breakout | orb | U | 5 | .016 | .028 | First 30 minutes of observed US session; live-only |
| ibreakout / Intraday breakout (discovered) | breakout-15m | C | 15 | .015 | .08 | 15-minute closes, prior 48 bars; forward-test only; intraday:true |

Exact `text` values:

- tsmom: “Long when the 28-day trend is up (price > 200-SMA); short when down. Fast-resolving version for active trading.”
- donchian: “Long a 20-day high breakout above the 200-SMA; short the 20-day breakdown below it. Turtle-style trend following.”
- rsi2dip: “Buy 2-day oversold ONLY in an uptrend (RSI2<10 & price>200-SMA); short overbought in a downtrend.”
- mom_trend: “Long strong 28-day momentum above the 200-SMA; ride the trailing exit.”
- orb: “Trade the break of the first 30m session range at the US open (live-only).”
- ibreakout: “15-minute breakout of the prior ~12h range (48 bars). Tight 1.5% stop, 8% target. Forward-test only.”

SOURCE DOES NOT SPECIFY explicit liveOnly/forwardTestOnly boolean keys; restrictions are prose, not invented seed fields. Strategies other than ORB/ibreakout have no explicit testing-only designation. All actual execution here is paper trading.

## Entry algorithms

`c=q.closes`, numeric array; price is current quote. Literal source retN is `c[last]/c[last-1-n]−1`; its off-by-one ambiguity is documented in 08. Each function returns `{side,baseLev,stopPct,targetPct,confidence,reason}` or null. Exact reason text is not supplied.

| Function | Warmup/data | Long | Short |
|---|---|---|---|
| sigTsmom | ≥30 closes; r28=retN(c,28), s200=sma(c,200) | r28>.03 AND (no s200 OR price>s200), confidence .62 | r28<−.03 AND (no s200 OR price<s200), .55 |
| sigDonchian | ≥25 closes; hi/lo=prior 20 closes excluding latest, s200 | price>hi AND (no s200 OR price>s200), .60 | price<lo AND (no s200 OR price<s200), .55 |
| sigRsi2dip | ≥210 closes; r2=rsi(c,2), s200 | r2<10 AND price>s200, .60 | r2>90 AND price<s200, .55 |
| sigMomTrend | ≥30 closes; r28,s200,q.mom,q.rsi | (no s200 OR price>s200) AND r28>.05 AND q.mom>1 AND q.rsi<78, .55 | No short entry specified |
| sigOrb | US only; q.sessionStart; observe from within approximately five minutes of actual open; build orHi/orLo during first 30m | After range formed, price>orHi, .55 | After range formed, price<orLo, .50 |
| sigBreakoutIntraday | Crypto q.closesIntraday; latest i with 48 prior 15m bars excluding i | close_i>prior high, .50 | close_i<prior low, .50 |

Strict inequalities matter: equal thresholds do not enter. ORB live quote extrema are not guaranteed complete first-30m traded extrema; late observation must invalidate that session. Source does not specify holiday/DST calendar, reset persistence, q.mom units, adjusted closes, complete-candle filtering or tie ordering.

## Exits

`strategyExit(pos,q,regime)` evaluates the position's originating strategy. rsi2dip long exits r2≥65; short exits r2≤35. Donchian exits a 10-day channel break against position (recommended explicit direction: long below prior low, short above prior high; latest-bar exclusion follows channel intent but exact exit indexing is not separately provided). tsmom/mom_trend exit when nominal 28-day return flips sign. Equality-to-zero exit is SOURCE DOES NOT SPECIFY. ORB/ibreakout have no dedicated indicator exit; all positions remain subject to engine liquidation, stop, target, max hold and trailing logic in 07. `regime` parameter is named but no regime-specific exit branch is supplied.

Source brain tags include trend-flip, rsi2-reverted and strategy-exit; exact mapping for Donchian/ORB/time-stop is not fully prescribed. All stops use the seed fractions above unless a documented precedence decision says otherwise.

## Registration and dispatch

`ensureStrategies` reads `{strategies:[...]}` from V2.strategies or seeds it. Each new seed receives learned stats `{n:0,expectancy_R:0,win_rate:0,kelly:.12,confidence:.2}`. Existing IDs retain learned stats; missing new seed IDs are registered. SOURCE DOES NOT SPECIFY updating existing seed descriptions/parameters, versioning a changed strategy, or removing old IDs.

`runStrategies(state,eq,cfg,histCache)`:

1. Check exits for every open position; queue close orders before entry scanning.
2. Scan free symbols only; require open/enabled market, current usable data, no position in that symbol, two-minute cooldown elapsed, capacity under cfg.v2.strategies.maxConcurrentPositions=10.
3. Evaluate every market-compatible non-retired strategy. Candidate and probation are therefore eligible under literal “non-retired” wording; active is not the sole execution status.
4. Rank score=`signal.confidence×(.5+strategyConfidence)` and keep best per symbol. Tie resolution and cross-symbol capacity priority unspecified.
5. Queue `{op:"open",symbol,side,leverage,strategy_id,setup_tag,stopPct,targetPct,confidence,reason,trade_id,sizePct:null}`; clamp leverage to state aggression cap; set symbol cooldown when queueing, not after fill.
6. P5 resolves market caps/margin later. US ORB base 5 is constrained to market max 4; crypto bases 10–15 are below initial account cap 20.

Tracking: closed journal outcomes are joined by trade_id and attributed to strategy_id; realized_R drives expectancy/PF/SQN/Wilson/DSR, lifecycle/confidence/Kelly. Registry is persisted across episodes and generations. Explicit `trade_id` generation, cooldown persistence and outstanding queued-order capacity are missing source contracts.

## RECOMMENDED IMPROVEMENT

Test every threshold and warmup boundary. Require fresh complete observations for entries and preserve entry-time strategy version/regime/risk denominator. Queue reservations should count toward symbol/capacity limits; a queued close must not permit a same-tick reopen. Use stable tie-breaking so replay is deterministic. “Proven”, “research-tested” and “discovered” in the article are claims, not supporting backtest evidence. Do not label the rule functions AI or imply that runtime LLM calls invent new rules.
