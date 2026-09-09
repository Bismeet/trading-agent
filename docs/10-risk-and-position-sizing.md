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

## Implemented Multi-Agent Risk Council (`scripts/v2/agents.mjs`)

Every candidate trade surviving strategy generation and AI research filtering must pass the three-agent **Risk Council** before sizing:

1. **Analyst Agent (`evalAnalyst`):**
   - Evaluates broad market regime compatibility.
   - Vetoes crypto longs during `crypto_down` regimes.
   - Vetoes US equity longs during `us_down` regimes.
2. **Risk Agent (`evalRisk`):**
   - **Position Limit:** Rejects candidates if current open positions count >= 10 (`maxConcurrentPositions`).
   - **Crypto Cluster Control:** Maximum of 4 concurrent open crypto positions across the portfolio. Uses `intent.market === 'crypto'` to prevent correlated crypto downside cascades.
   - **Drawdown Brake:** Halts or vetoes aggressive risk when portfolio max drawdown exceeds 10%.
3. **Investor Agent (`evalInvestor`):**
   - **Stale Quote Guard:** Rejects orders if quote age > 5 minutes (300,000ms).
   - **Wallet Affordability:** Verifies available free wallet collateral > $2.00.

| Control | Implementation | Target & Guarantee |
|---|---|---|
| One position per symbol / ten total | `evalRisk` & engine | Enforced both at Council and execution |
| Crypto correlation cluster | `evalRisk` | Hard cap of 4 concurrent crypto positions |
| Two-minute cooldown | `histCache.cooldowns` | Prevents immediate re-entry after close |
| Missing/stale prohibition | `evalInvestor` | Quotes >5m marked stale and blocked |
| Leverage ceilings | `sizeOrder` | 20x US equity, 12x crypto, 10x Indian equity; 5x survival cap |
| Minimum wallet | `evalInvestor` | Free wallet < $2.00 blocks new entries |
| Drawdown protection | `evalRisk` & survivalGate | 10% drawdown engages capital protection |
| AI Filter Gating | `v2/ai_gate.mjs` | Fail-closed gate: timeouts and errors evaluate to `AI_UNAVAILABLE` |

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
