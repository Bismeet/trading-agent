# 08 — Trading mathematics

## Notation and authority

P2/P5/P6 provide some exact algorithms, but only names for others. **SOURCE REQUIREMENT** denotes explicit formulas; **DERIVED** denotes their algebraic consequences; **RECOMMENDED IMPROVEMENT** supplies a proposed convention where the source is incomplete. Do not mistake a conventional textbook formula for an extracted author requirement.

Let s=−1 for `short`, otherwise +1 (literal sideSign behavior); E=entry, X=exit fill, P=mark, Q=positive quantity, L=leverage, M=isolated margin, N=notional, W=free wallet, A=account equity, c=chronological closes, r=realized R observations. Rates and stop/target parameters are fractions unless a field explicitly says percentage points. Currency normalization is required by the proposed accounting contract, not fully specified in source.

## Indicators and market regime

| Function / use | Formula or source instruction | Edge cases and source gaps |
|---|---|---|
| sma(arr,n); signal trend filters | SOURCE names SMA only. RECOMMENDED: sum(last n values)/n, return null until n valid closes | P4 deliberately permits absent SMA200 for three strategies; do not use shortened-window SMA without approval |
| rsi(closes,n=14); rsi2 entry/exit | SOURCE names RSI only. RECOMMENDED Wilder: gain=max(Δc,0), loss=max(−Δc,0), seed arithmetic n-period means then averages=(old×(n−1)+new)/n; RSI=100−100/(1+avgGain/avgLoss) | Wilder vs simple-window RSI changes signals; select explicitly. Proposed flat series=50, gain-only=100, loss-only=0; insufficient history=null |
| momentum(closes,n=10) | SOURCE DOES NOT SPECIFY units/indexing. RECOMMENDED 100×(c_t/c_(t−n)−1) | q.mom>1 in P4 depends on percent vs fraction; positive denominator required |
| retN(c,n) / P4 | Exact text: `c[last]/c[last-1-n] - 1` | If last is final array index, n=28 spans 29 intervals, not 28. Do not silently change to t−28; resolve D03 |
| indicators(closes) | Returns sma20,sma50,rsi,mom,trend,bias; trend=up/down/flat, bias=bullish/bearish/neutral | SOURCE DOES NOT SPECIFY trend/bias comparisons, tolerances or unavailable-data policy |
| lib.regime | If halt→risk_off; otherwise labels broad_up, crypto_down_highvol, crypto_down, us_down, mixed_chop using BTC,^GSPC,^NSEI trends | SOURCE DOES NOT SPECIFY boolean combinations/order beyond halt and listed labels, or high-vol threshold; do not invent an “exact” classifier |
| dailyVol / P5 | Fewer than 15 closes→.03. Else last 15 closes→14 log returns l_i=ln(c_i/c_(i−1)); v=sqrt(sum((l_i−mean(l))²)/14); clamp [.005,.15] | Population variance here, unlike lib.stdev sample variance; nonpositive/NaN closes are not guarded in source |
| Annual→daily vol target / P5 | v_target=volTargetAnnual/sqrt(365), fallback .8 annual; configured .60 | Same 365 factor used for stocks in exact source; volatility floor .005, ceiling .15 |
| Donchian channels | Max/min prior 20 daily closes for entry; prior 10 closes for opposing exit; exclude latest | Source close-based, not candle-high/low based; warmup/exclusion must be tested |
| Intraday channel | Max/min 48 prior 15m closes; latest close strictly outside | 48×15m=12h; incomplete current candles could leak future data |

RECOMMENDED trend completion, subject to approval: up when price>SMA20>SMA50, down when price<SMA20<SMA50, otherwise flat; bias follows up/down/flat. This is **not** the source algorithm and must not be installed without an explicit decision. A threshold policy for high-vol regime remains a decision, not an invented source constant.

## Leverage and liquidation — exact P2

| Function | Formula / behavior | Meaning, use and edge cases |
|---|---|---|
| sideSign(side) | short→−1; everything else→+1 | Direction multiplier; invalid side silently becomes long in literal code; recommended reject unknown sides |
| imr(L) | 1/L | Initial margin fraction; require finite L>0 in recommended guards |
| tierFor(N,tiers) | abs(N); first tier satisfying floor≤N<cap; otherwise loop returns final tier | Half-open boundaries; empty/unsorted tiers and out-of-range values not guarded; below first floor also ultimately returns last |
| maintenanceMargin(N,tier) | abs(N)×mmr−(deduction or 0) | USD maintenance; negative possible with unsuitable tier; no source floor clamp |
| maxLeverageAt(N,tiers) | selected tier.maxLev | Maximum offered by tier; source builder does not itself enforce |
| liqPrice(side,E,L,mmr) | E×(1−s/L+s×mmr) | Simplified isolated trigger; ignores deduction, fees and funding effects |
| bankruptcyPrice(side,E,L) | E×(1−s/L) | Zero-margin-equity price without costs; not necessarily execution price |
| unrealizedPnl(side,E,P,Q) | (P−E)×Q×s | Mark-to-entry quote-currency P&L; conversion issue for INR instruments |
| positionEquity(M,U) | M+U | Position collateral equity; account free wallet excluded |
| isLiquidated | short: P≥liq; long: P≤liq | Inclusive trigger, evaluated before stops |
| sizeFromMargin(M,L,E) | N=M×L; Q=N/E | Output {notional,qty}; zero/negative E unsupported |
| marginForNotional(N,L) | abs(N)/L | Required isolated margin |
| emaUpdate(prev,price,alpha) | if prev null/nonfinite→price; else alpha×price+(1−alpha)×prev | Source alpha .25; malformed incoming price and alpha not checked; repeated stale tick smoothing is problematic |
| tradeFee(N,rate) | abs(N)×rate | Entry and close monetary cost; taker=.0005, maker=.0002 configured |
| fundingPayment(N,rate,side) | −s×abs(N)×rate | Signed cashflow: positive rate costs longs, credits shorts; negative reverses |
| slippageFraction(N,v=.02,D=2000000,k=.6) | k×max(.0005,v)×sqrt(max(0,N)/max(1,D)) | Adverse fraction, not dollars; no upper bound; actual v/depth provenance unspecified |
| fillPrice(ref,side,h,f) | ref×(1+s×(h+f)) | Buy/long action worsens upwards, sell/short action downwards; closing a long needs sell direction, not position's original long tag |

Golden vectors: E=100000, mmr=.004 gives 5× long liquidation 80400, 5× short 119600, 25× long 96400. These match the source formula, not a verified exchange contract.

**DERIVED:** at a fixed entry notional and no costs, setting M+sQ(P−E)=N×mmr yields the source liquidation expression. If maintenance instead uses current notional QP and deduction d, algebra yields P=(sQE−M−d)/(Q(s−mmr)). This alternative is not prescribed, and fee/funding/venue rules can change it further. Do not replace the exact source formula silently.

### Funding timestamps — exact P2

`crossedFundingTimestamps(lastTs,nowTs,hours=[0,8,16])`: no lastTs or nowTs≤lastTs→empty. Round a date constructed from lastTs down to its UTC hour, walk hourly through nowTs inclusive, skip t≤lastTs, include timestamps whose UTC hour is in hours. Return chronological millisecond timestamps. Multiple missed boundaries are returned; the source does not supply historical rates for those times. A zero epoch timestamp is treated as missing by the literal truthiness check. Restart must not charge a boundary twice (recommended).

## Stops, costs and account metrics

| Calculation | Requirement / formula | Used by; missing details |
|---|---|---|
| Realized gross P&L | DERIVED G=sQ(X−E) | Close settlement; entry/exit must be actual simulated fills |
| Net P&L | RECOMMENDED G−entryFee−exitFee+signedFunding−borrow | Journals/learning; source mandates net_pnl but not full settlement convention |
| USD→INR conversion | SOURCE fetchFx gets INR per USD, fallback 83.0. DERIVED INR price/USD rate yields USD price | Engine; source does not specify exactly where conversion occurs or stale-rate treatment |
| Borrow cost | SOURCE config us.borrowAnnual=.08, no formula. RECOMMENDED borrowed USD principal×annual rate×elapsed seconds/(365×86400) | Non-crypto leverage; borrowed principal/short borrow conventions remain unresolved |
| Stop price | RECOMMENDED E×(1−s×stopPct) | P4 gives stop distances, P8 checks stops; mark vs trade trigger ambiguous |
| Target price | RECOMMENDED E×(1+s×targetPct) | Source distances; gap execution still needs adverse fill, not guaranteed trigger price |
| Price-return ROI | DERIVED s(P−E)/E | Underlying return; distinct from collateral ROI |
| Margin ROI | DERIVED U/M; roiPct=100×U/M | UI/trailing; net of costs or gross is unspecified |
| Trailing stop | SOURCE activate ROI .5, give ROI .25; peakUPnl tracked. RECOMMENDED activate when peakUPnl/M≥.5, close when (peakUPnl−U)/M≥.25 | Giveback absolute ROI points versus 25% of peak profit is ambiguous; proposed convention uses absolute points |
| Hold time | (now−openedAt)/3600000; source max=4 hours | Engine time exit; exact equality should be tested |
| Equity | SOURCE W+Σ(M+U) | Accounting; funding destination must agree |
| Peak/drawdown | DERIVED peak=max(oldPeak,A), drawdownPct=100×(peak−A)/peak | recordEquityPeak/maxDrawdown; positive peak required; negative A may exceed 100% DD |
| Episode return | DERIVED 100×(finalEquity/startingCapital−1) | finalizeEpisode; no source rounding scale specified |
| Goal progress | RECOMMENDED 100×(A−goal.startEquity)/(goal.target−goal.startEquity) | UI/sizing; sizing explicitly uses fractional progress, unclipped; zero/negative span special case |
| Notional/gross leverage | RECOMMENDED sum(abs(Q×mark))/A | UI; source leaves mark vs entry notional undefined; unavailable for A≤0 |
| Liquidation runway | SOURCE danger<4%, watch<12%, safe otherwise; formula missing. RECOMMENDED 100×s×(mark−liq)/mark | Position cards; clamp only visual bar, not raw distance; nonpositive mark invalid |
| realized_R | SOURCE field required, denominator missing. RECOMMENDED net_pnl / initial planned stop risk USD, frozen at entry | Brain; initial risk=abs(Q×(E−stop)) before costs under proposed convention; liquidation may make R much less than −1 |

## Statistical helpers

SOURCE `mean`, sample `stdev`, Wilson lower bound z=1.96, SQN=sqrt(n)×mean/stdev, profitFactor and expectancyStats are named. Full conventions below are DERIVED/RECOMMENDED where not explicit.

For finite realized-R observations r_i: mean μ=Σr_i/n; sample variance s²=Σ(r_i−μ)²/(n−1); sample stdev=sqrt(s²). `mean` empty and stdev n<2 behavior: SOURCE DOES NOT SPECIFY; recommended unavailable rather than fabricated zero edge.

RECOMMENDED zero-R convention: n counts all completed trades; wins count r>0; losses count r<0; breakeven count implicit n−wins−losses. WinRate=p=wins/n. avgWinR=mean(positive R); avgLossR=mean(abs(negative R)). ExpectancyR=μ. The equivalent p×avgWin−(1−p)×avgLoss only holds when there are no zero outcomes or p/loss probabilities are adjusted. ProfitFactor=sum(positive R)/abs(sum(negative R)). BreakevenWr=avgLoss/(avgWin+avgLoss). Source does not choose missing-win/loss behavior; recommended null/explicit reason, never JSON Infinity.

Wilson LB (conventional formula consistent with named helper):

`[p + z²/(2n) − z×sqrt(p(1−p)/n + z²/(4n²))] / [1+z²/n]`.

n=0 invalid; require 0≤wins≤n and finite z. This lower bound measures binary win probability, not payoff-size uncertainty. SQN = sqrt(n)×μ/s; recommended tStat uses the same one-sample t statistic against zero. SOURCE DOES NOT SPECIFY a distinct tStat equation. Both have undefined zero-variance behavior; P6's DSR explicitly fails zero variance.

`expectancyStats(rs)` exact output keys: `n,wins,losses,winRate,avgWinR,avgLossR,expectancyR,profitFactor,sqn,wilsonLb,breakevenWr,tStat`. Display aliases `expectancy_R` and `win_rate` in strategies are not the same spelling; mapping must be explicit.

## Deflated Sharpe — exact P6 algorithm

Inputs realized R array and nTrials (number of strategies). If n<8 or sample sd=0 return `{sr:0,dsr:0,sr0:0,pass:false}`. Otherwise:

1. SR=mean(r)/sampleStdev(r), N=max(2,nTrials or 2), γ=.5772156649.
2. emax=(1−γ)Φ⁻¹(1−1/N)+γΦ⁻¹(1−1/(N×e)).
3. varSR=1/(n−1); SR0=sqrt(varSR)×emax.
4. sk=skewness(r), ku=kurtosis(r).
5. denom=sqrt(max(1e−6,1−sk×SR+((ku−1)/4)×SR²)).
6. DSR=Φ(((SR−SR0)×sqrt(n−1))/denom).
7. Return sr,dsr,sr0 rounded to three decimals; pass uses **unrounded DSR>.95**.

SOURCE names `erf`, `normCdf`, `normInv` with Acklam inverse-normal, `skewness`, `kurtosis`, but does not provide their actual implementations/coefficients. RECOMMENDED definitions: Φ(x)=.5(1+erf(x/sqrt(2))); erf(x)=2/sqrt(π)×integral from 0 to x of exp(−t²)dt; Φ⁻¹ is inverse standard normal. Use a verified Acklam implementation with reference vectors rather than inventing coefficients. Proposed population standardized central moments: skew=m3/m2^(3/2), kurtosis=m4/m2² (Pearson, not excess). Bias correction is a required decision because changing it changes DSR. DSR is a heuristic over dependent trades, not proof of edge.

## Kelly and learning mathematics

P6 `strategyKelly`: under five trades .12 or .04 if failed backtest; otherwise `0.4×clamp(expectancyR/variance,0,1.5)`. Despite “half-Kelly” wording, preserve 0.4. Blend a present `backtest_kelly` with pseudo-count 15. RECOMMENDED blend, because exact equation absent: `(n×liveKelly+15×backtestKelly)/(n+15)`. Halve on probation; retired=.02; clamp final [.02,.40]. Variance convention and branch ordering with under-five/prior/status require approval. Classical binary Kelly `p−(1−p)/b` is not the supplied algorithm.

P5 account multiplier, volatility multiplier, goal multiplier and wallet clamp are fully ordered in [10](10-risk-and-position-sizing.md).

P6 lifecycle t threshold: `tNeed=3+.25×(nTrials−1)`; six seeds imply 4.25. Active promotion additionally requires n≥30, Wilson LB>breakevenWr, PF≥1.5, SQN≥1.5, expectancy>0, tStat>tNeed and unrounded DSR pass. Last-30 demotion and recovery details: [12](12-memory-and-learning.md).

P6 lesson retrieval: `score=importance×.95^ageDays×relevance`; relevance=1 for same regime else .4; last 500 memories, top k=4. Age definition proposed `(now−createdAt)/86400000`, clamped ≥0; source timestamp field unspecified. Hash helper sha256 takes first 16 hex characters, i.e. 64 bits of output; source chain serialization is undefined.

P7 sentiment: sum lexicon weights, previous-word negator multiplies matched weight by −.7, divide by 3, bound [−1,1], no hits→0. News mixed if dispersion>.45; exact dispersion estimator/impact aggregation absent. FNG bands and world scores: [13](13-world-model.md).

## RECOMMENDED IMPROVEMENT — numeric policy

Validate finite values before every financial calculation. Preserve full computational precision; round display only except source's explicit DSR return values. Record raw gate inputs separately. Define cents reconciliation tolerances and avoid negative-zero display without erasing a genuine loss. JSON cannot represent NaN/Infinity; encode unavailable metrics as null with a reason, not zero. Do not claim mathematical completeness until all SOURCE DOES NOT SPECIFY decisions are resolved and fixture-tested.
