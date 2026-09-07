# 10 — Risk and position sizing

## SOURCE REQUIREMENT — exact sizeOrder sequence (P5)

Signature `sizeOrder(state,o,eq,cfg)`. Missing order or op other than `open`: return unchanged. It reads strategy statistics, writes nothing, and returns spread order fields plus selected `leverage` and `marginUsd`.

1. `V=cfg.v2`; market from watchlist match, fallback `crypto`. `marketMax=V.leverage[market]?.maxLeverage || 1`.
2. Proposed leverage=`o.leverage || state.aggression.leverageCap`. Clamp [1,min(state.aggression.leverageCap,state.aggression.leverageCeiling,marketMax)]. Explicit leverage 0 falls back by truthiness; malformed numbers have no source guard.
3. `explicit = o.marginUsd != null`. If explicit, skip all base, volatility and goal calculations; still clamp leverage and wallet at the end.
4. Otherwise determine base:
   - With strategy_id: read strategies or `{strategies:[]}`; locate same id. acctMult=clamp(account Kelly / configured Kelly start, .4, 1.6). base=clamp((finite strategy.kelly ? strategy.kelly : .1)×acctMult,.02,.40).
   - Without strategy_id: base=`o.sizePct` if non-null, else `(state.aggression.kellyFraction ?? .25)×.5`.
5. marginUsd=base×state.equity.
6. Target daily vol=`(V.aggression.volTargetAnnual ?? .8)/sqrt(365)`. Daily vol from last 15 closes as in 08. Multiply margin by clamp(targetDaily/observedDaily,.25,1.7).
7. If goal exists and target>startEquity, progress=(equity−startEquity)/(target−startEquity). Only when 0<progress<1 multiply margin by `1+clamp(.55×(1−progress),0,.55)`.
8. Final margin=clamp(margin,0,max(0,walletBalance×.98)). Return `{...o,leverage:lev,marginUsd}`.

## Interpretation and edge behavior

SOURCE REQUIREMENT: strategy-specific learned Kelly starts the bet; account Kelly scales it; volatility scales collateral, not leverage; the positive-goal-progress bonus disappears underwater; wallet bounds total margin. This is not a classic fixed-loss-percent position sizer.

**DERIVED examples:**

- Fresh seeded strategy: Kelly .12, account/config .45/.45=1. At equity=100 and observed vol .02, daily target=.60/sqrt365≈.031405; vol multiplier≈1.5703. With no positive goal progress, margin≈18.843 before final wallet clamp. At 12× leverage, notional≈226.12 and 5% stop gross risk≈11.31, excluding costs. These are algebraic examples, not executed trades.
- Explicit margin=100 with wallet=100 yields 98 regardless of strategy/volatility/goal; entry fee is still additional and not included in the source clamp.
- At goal start exactly, no progress bonus; immediately above start, multiplier approaches 1.55. This discontinuity is in the literal algorithm. At progress approaching 1 from below, multiplier approaches 1; at/above 1 there is no bonus.
- US leverage is at most 4 even when ORB proposes 5. Indian max=5, crypto max=40, further limited by state caps.

## Other risk controls: stated versus wired

| Control | Source evidence | Gap |
|---|---|---|
| One position per symbol / ten total | P4/P8 | Outstanding intents, duplicate symbols and queued closes not fully specified |
| Two-minute cooldown | P4 set after queueing | Restart persistence, rejected-order behavior unspecified |
| Market-open/enabled | P4 | Holiday/DST/early-close/session mapping and long/short availability unspecified |
| Missing/stale prohibition | P4/P8 | Numeric freshness thresholds absent |
| Tier max leverage | P2 helper, P1 tier settings | Exact sizeOrder only checks market/account caps; integration enforcement unspecified |
| Minimum notional USD 2 | P1 | No rejection branch in P5/P8 text |
| Root maxPositionPct .30 / minCashPct .02 | P1 | P5 does not use maxPositionPct; .98 wallet cap is hardcoded |
| ddCaution .12, ddHalt .20, hardFloorPct .70 | P1 | No complete riskState/capital-floor enforcement algorithm |
| Price-distance stop/target | P4 | Can be beyond liquidation at leverage; not a guaranteed maximum loss |
| Trail ROI .5/.25, hold 4h | P1/P8 | Activation/giveback convention and time-stop reason unresolved |
| US annual borrow .08 | P1 | Not charged anywhere explicitly in P8 |
| Kelly max .7 | P1 | P6 increments do not explicitly clamp account Kelly |

## RECOMMENDED IMPROVEMENT — required correctness baseline

Resolve these proposals separately from source-exact sizing:

- Reject nonfinite/negative/zero prices, invalid sides/leverage/quantities and malformed explicit margins before sizing/execution.
- Convert instrument quote currency to the accounting currency before computing margin/notional/fees; do not treat INR prices as USD.
- Re-size sequentially at actual fill using current free wallet and pending reservations. Avoid sizing twice in a way that turns a previously generated margin into an unintended immutable explicit margin.
- Include entry fees in affordability. For a same-price estimate with fee rate f, affordable margin≤wallet/(1+L×f); retain any approved reserve in addition. Actual fill slippage can change cost.
- Enforce market/tier/position/notional limits at execution as well as signal generation.
- Choose initial-stop-risk definition for realized_R and freeze it. Stop beyond liquidation must be disclosed, not described as protective collateral insurance.
- Define drawdown and riskState transitions and the exact precedence of root and v2 risk settings.
- Do not claim that lack of underwater bonus means “never blows up” or that candidate Kelly is earned evidence. Leverage and correlated positions can still lose all collateral.
