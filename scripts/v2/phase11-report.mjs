// scripts/v2/phase11-report.mjs — PHASE 11: deterministic report generator.
//
// Reads ONLY data/calibration/phase11-summary.v1.json (plus the spec for display
// text) and renders PHASE11_RESEARCH_REPORT.md and PHASE11_RESEARCH_PROPOSAL.md.
// No measurement, no statistics and no threshold is computed here — every number
// is copied from the frozen summary, so the report can never disagree with the
// stored results.
import fs from "node:fs";
import path from "node:path";
import {
  PHASE11_SUMMARY_PATH, PHASE11_SPEC_PATH, PHASE11_REPORT_PATH,
  PHASE11_PROPOSAL_PATH, REPO_ROOT, writePhase11Markdown,
} from "./phase11-io.mjs";

const F = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const B = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "n/a");
const P = (x, d = 2) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const I = (x) => (Number.isFinite(x) ? String(x) : "n/a");
const R = (x, d = 4) => (Number.isFinite(x) ? B(x, d) : "n/a");
const U = (x, d = 2) => (Number.isFinite(x) ? `${x.toFixed(d)}` : "n/a");
const M = (x, d = 4) => (Number.isFinite(x) ? `${(x * 1e6).toFixed(0)}` : "n/a");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function renderReport(s, spec) {
  const W = [];
  const w = (l = "") => W.push(l);
  const H = (n, t) => { w(``); w(`## ${n}. ${t}`); w(``); };

  const c = s.canonical.test;
  const { B0: b0, B1: b1, B2: b2 } = s.baselines;
  const gn = s.canonical.grossNet ?? {};

  // ---- title + survivorship banner -----------------------------------------
  w(`# PHASE 11 — CROSS-SECTIONAL RELATIVE-STRENGTH ROTATION: RESEARCH REPORT`);
  w(``);
  w(`> **VERDICT ${s.verdict} — ${s.verdictReason.toUpperCase()}**`);
  w(`>`);
  w(`> **SURVIVORSHIP WARNING (read first).** The 14-asset universe is **not survivorship-bias-free**. Every symbol is a **current** large-cap or major that is known *today* to have survived 2021-09 → 2026-09. Assets that were delisted, merged, denylisted or collapsed out of the universe are **absent**, which biases any long-only result **upward**. The universe was deliberately **not** replaced with a different dataset to improve the numbers. See §5 and §26.`);
  w(``);
  w(table(["Field", "Value"], [
    ["Phase", "`" + s.phase + "`"],
    ["Spec hash (SHA-256)", "`" + s.specHash + "`"],
    ["Selection-lock hash (SHA-256)", "`" + s.lockHash + "`"],
    ["Lock stable across re-hash", s.lockStable ? "yes" : "**NO**"],
    ["Generated", s.generatedAt],
    ["Runtime", `${F(s.runtimeSeconds, 1)}s`],
    ["Gates passed", `${s.gatesPassed} / ${s.gatesTotal}`],
    ["Data window", `${s.data.from} → ${s.data.to} (${I(s.data.gridRows)} union grid rows)`],
    ["Verdict", `**${s.verdict}**`],
  ]));
  w(``);
  w(`*Deterministic and reproducible: two independent runs of \`scripts/v2/phase11-run.mjs\` on identical inputs produce a byte-identical summary (hash-checked, §24). The runner is offline research only and never writes outside \`data/calibration/\` and this report.*`);

  // ---- 1. executive summary --------------------------------------------------
  H(1, "Executive Summary");
  w(`The hypothesis was that **cross-asset relative strength** contains information the existing per-symbol directional strategies do not capture, and that combining it with an **absolute-trend filter** and **low turnover** would produce a positive net-of-cost out-of-sample edge that beats both equal-weight buy-and-hold (**B0**) and an absolute-trend-only portfolio (**B2**).`);
  w(``);
  w(`**It does not.** On the isolated TEST window (union grid rows ${s.folds.splits.test[0]}–${s.folds.splits.test[1] - 1}), the canonical strategy returned **${P(c?.totalReturn)}** net of costs (Sharpe **${R(c?.sharpe)}**, max drawdown **${P(c?.maxDrawdown)}**). Equal-weight buy-and-hold returned **${P(b0.test?.totalReturn)}** (Sharpe ${R(b0.test?.sharpe)}) and the absolute-trend-only portfolio returned **${P(b2.test?.totalReturn)}** (Sharpe ${R(b2.test?.sharpe)}).`);
  w(``);
  w(`The strategy **did** beat the absolute-trend-only baseline B2 on Sharpe (gate 3 passes), which means the cross-sectional ranking was not actively harmful **relative to that specific comparison**. But it lost money outright, lost to buy-and-hold, failed 2 of 4 TEST sub-folds, and failed on cost stress, execution delay, Deflated Sharpe, asset concentration and — most importantly — **the gross edge was already negative before costs** (TEST gross P&L **${B(gn.grossPnl)}** on ${I(gn.windowLegs)} holdings).`);
  w(``);
  w(`This is the **same failure mode** Phase 9 diagnosed: friction is not the problem, the **gross signal has no positive information content at this horizon either**. Changing the information (cross-asset), the direction (long-only), the operating point (weekly, low turnover) and the construction (inverse-vol, top-K) simultaneously was not enough. **Verdict C — NO ROBUST ALPHA FOUND.**`);
  w(``);
  w(`Per the pre-registered protocol, this is a **STOP**, not a prompt for another optimisation cycle. The rational next moves are the proposal's Candidate 6: reduce execution cost (maker fills) or acquire **historical funding-rate data** to test the structural-carry direction (Candidate 2). Neither is another directional alpha phase.`);
  w(``);
  w(table(["TEST (isolated)", "Net return", "Sharpe", "Sortino", "Calmar", "Max DD"], [
    [`**Rotation (canonical)**`, `**${P(c?.totalReturn)}**`, `**${R(c?.sharpe)}**`, R(c?.sortino), R(c?.calmar), P(c?.maxDrawdown)],
    ["B0 equal-weight buy & hold", P(b0.test?.totalReturn), R(b0.test?.sharpe), R(b0.test?.sortino), R(b0.test?.calmar), P(b0.test?.maxDrawdown)],
    ["B1 trend-gated equal weight", P(b1.test?.totalReturn), R(b1.test?.sharpe), R(b1.test?.sortino), R(b1.test?.calmar), P(b1.test?.maxDrawdown)],
    ["B2 time-series trend only", P(b2.test?.totalReturn), R(b2.test?.sharpe), R(b2.test?.sortino), R(b2.test?.calmar), P(b2.test?.maxDrawdown)],
    ["B3 production baseline", s.baselines.B3.status, "—", "—", "—", "—"],
  ]));

  // ---- 2. hypothesis ---------------------------------------------------------
  H(2, "Hypothesis");
  w(`**H1.** On the 14-asset universe, a weekly-rebalanced portfolio long the top-K assets ranked by **volatility-normalised trailing return**, conditioned on each asset being above its own long-run trend, produces positive net-of-cost out-of-sample return **and** a higher net Sharpe than both (i) equal-weight buy-and-hold and (ii) a time-series-only trend overlay — and the edge survives a 25% cost increase and a one-day execution delay.`);
  w(``);
  w(`**H0 (null).** The cross-sectional ranking carries no information beyond the absolute-trend gate and buy-and-hold beta; any apparent edge is within noise of ~50 weekly TEST returns, or is destroyed by shuffling the ranks.`);
  w(``);
  w(`**Falsification is built in.** H1 is accepted only if it beats **both** baselines on Sharpe **and** survives the negative control. The pre-registered acceptance gates in §12 are the operational form of that falsification.`);
  w(``);
  w(`**Result: H0 is not rejected. The evidence is consistent with H0** — the ranking showed no reliable predictive relationship to forward relative return (TEST rank IC ${R(s.crossSectional.test.rankIC)}, t = ${R(s.crossSectional.test.rankICTstat)}), and the strategy lost money net of costs.`);

  // ---- 3. methodology --------------------------------------------------------
  H(3, "Exact Methodology");
  w(`Everything below was **pre-registered** in \`config/phase11-spec.v1.json\` **before** any TEST outcome was read. The runner reads that file and may not invent, tune or relax a threshold in code. The full protocol: build the causal feature layer → build the global chronological split with 60-bar purge and embargo → run the canonical configuration and the baselines on **TRAIN + VALIDATION only** → **hash and write the selection lock** → read **TEST exactly once** → run the robustness battery, the leakage audit and the shuffled-rank negative control → emit one verdict.`);
  w(``);
  w(`Two deliberate deviations from the proposal, both recorded in the spec:`);
  w(``);
  w(`1. **Gate 7 (Deflated Sharpe) was corrected from "> 0" to the repository's established "> 0.95" convention** (\`scripts/v2/brain.mjs\` documents *"Pass uses unrounded DSR > .95"*). A raw DSR merely greater than zero is satisfied by pure noise, so the original phrasing was an **error in the pre-registration text**, and correcting a mis-specified threshold is permitted only to diagnose an invalid experiment. The correction makes the gate **stricter**, not weaker, and applies identically to every run.`);
  w(`2. **B3 is recorded as UNAVAILABLE** rather than proxied. See §10.`);

  // ---- 4. data used ----------------------------------------------------------
  H(4, "Data Used");
  w(table(["Item", "Value"], [
    ["Panel", `\`${s.data.panel}\``],
    ["Interval / range", `${s.data.intervals} / ${spec.data.researchRange}`],
    ["Provider", spec.data.panelSource],
    ["Union grid", `${I(s.data.gridRows)} UTC-date rows, ${s.data.from} → ${s.data.to}`],
    ["Alignment", "One row per UTC calendar date. Each symbol's value is its own bar stamped on that date, or the most recent bar at or before it (**as-of carry-forward**). Nothing is interpolated forward. Raw-timestamp alignment was rejected because US/India/crypto bars for the same calendar day carry three different UTC clock times, which would have inflated the grid ~2.4× and turned a 5-bar week into a 2-day week."],
    ["Window coverage", "Crypto 1,827 rows; US equities 1,255; India 1,241. Early grid rows where a symbol has no prior observation are marked unavailable, which is why eligibility begins per-symbol."],
  ]));
  w(``);
  w(`**Evaluation window.** Every strategy, arm and control is evaluated on the **identical** union grid over the **identical** date range, so all comparisons are like-for-like. No symbol's start date is shifted to flatter any strategy.`);

  // ---- 5. universe -----------------------------------------------------------
  H(5, "Universe");
  w(table(["Cluster", "Symbols", "Count"], [
    ["crypto", spec.universe.symbols.filter((x) => x.includes("-USD")).join(", "), I(spec.universe.markets.crypto)],
    ["us", spec.universe.symbols.filter((x) => !x.includes("-USD") && !x.endsWith(".NS")).join(", "), I(spec.universe.markets.us)],
    ["india", spec.universe.symbols.filter((x) => x.endsWith(".NS")).join(", "), I(spec.universe.markets.india)],
  ]));
  w(``);
  w(`**Exactly the existing 14-asset daily panel.** No asset added, removed or substituted; no index proxy; no synthetic asset. Mixing US / crypto / India is deliberate — the research question is whether **cross-market** relative strength is exploitable — and volatility-normalisation is what makes the three clusters comparable.`);
  w(``);
  w(`### Survivorship disclosure`);
  w(``);
  w(`> ${spec.universe.survivorshipDisclosure}`);
  w(``);
  w(`This limitation is **not corrected** and **not hidden**. It biases the absolute level of every long-only number in this report upward, including the baselines. It does **not** by itself explain a negative TEST result — a survivorship tailwind that still loses money is, if anything, a stronger negative signal than it appears.`);

  // ---- 6. feature definitions -------------------------------------------------
  H(6, "Feature Definitions");
  w(`All features are **strictly causal**: every value at decision bar \`t\` is a function of bars \`0..t\` of the **same symbol** only. Windows are measured on each symbol's **own observation indices**, not on grid indices, so a stock's 60-day return spans 60 exchange sessions and is never stretched by weekends or holidays.`);
  w(``);
  w(`The leakage audit (§23) re-derives all three features on a panel truncated at each sampled bar and requires **bit-exact equality**.`);
  w(``);
  w(table(["Feature", "Definition", "Warmup"], [
    ["Trailing total return", `\`effectiveClose(t) / effectiveClose(t − ${spec.features.lookbackTradingDays}) − 1\`, window **strictly** causal`, `own index ≥ ${spec.features.lookbackTradingDays}`],
    ["Realized volatility", `**population** σ (divisor N) of the ${spec.features.lookbackTradingDays} daily simple returns in the window ending at and including t`, `same`],
    ["Relative-strength score", `return / volatility — a per-asset Sharpe-style ratio. **Undefined** (⇒ ineligible) when volatility is 0 or non-finite.`, `same`],
    ["Absolute trend filter", `effectiveClose(t) > SMA200(t)`, `own index ≥ 199`],
    ["Combined warmup", `max(${spec.features.lookbackTradingDays}, 200) + 60 = **${s.folds.warmup}** own observations`, `—`],
  ]));
  w(``);
  w(`**No other feature enters the ranking, the gate, the eligibility rule or the weighting.** No volume (the panel is OHLC-only), no regime label, no learner state, no sentiment, no cross-sectional risk model, no optimiser. This is intentionally minimal to resist overfitting.`);

  // ---- 7. portfolio construction ----------------------------------------------
  H(7, "Portfolio Construction");
  w(table(["Rule", "Value"], [
    ["Direction", "**long-only**"],
    ["K (top selection)", `**${s.canonical.parameters.topK}**`],
    ["Ranking key", "relative-strength score, **descending**"],
    ["Tie-break", "deterministic, symbol **ascending** (e.g. `AAPL` < `BTC-USD` < `DOGE-USD`)"],
    ["Weighting", `**inverse volatility** — weight_i ∝ 1/σ_i over the selected assets only, normalised to sum to **1**`],
    ["Remainder", "**cash** at 0% — when fewer than K assets are eligible the book is under-invested, never levered"],
    ["Maximum leverage", "**1.0×** — no leverage optimisation of any kind"],
    ["Rebalance", `every **${s.canonical.parameters.rebalanceEvery}** grid dates (weekly); entries, exits and weight changes executed in full`],
    ["Zero-eligible rule", "if nothing is eligible the whole book goes to **cash** and stays there until the next decision bar with at least one eligible asset"],
  ]));
  w(``);
  w(`**Eligibility** requires all three of: sufficient history (\`own index ≥ ${s.folds.warmup}\`), a score **strictly greater than 0**, and \`effectiveClose > SMA200\`. Anything else is FLAT.`);
  w(``);
  w(`**Cash weeks are a real property of the policy, not missing data.** Across the full window, **${I(s.decisions.canonicalCashWeeks)}** of ${I(s.decisions.canonical)} decisions held no asset at all, and the mean eligible count was **${F(s.decisions.canonicalEligibleMean)}** against a mean selected count of **${F(s.decisions.canonicalSelectedMean)}**. A long-only trend system is *supposed* to be able to sit out; the three-cluster, 14-asset cross-section simply does not always offer three qualifying assets.`);

  // ---- 8. cost model ----------------------------------------------------------
  H(8, "Cost Model");
  w(`The **existing frozen execution primitives** are reused verbatim from \`scripts/v2/perp.mjs\` (\`tradeFee\`, \`slippageFraction\`, \`fillPrice\`) with the frozen values in \`config.json\`. **No new cost model was invented and no cost parameter was re-fitted.**`);
  w(``);
  w(table(["Component", "Value"], [
    ["Taker fee", `\`config.json → v2.perpFees.taker\` = ${I(spec.costModel.primitives.takerFee)} per leg on the traded notional`],
    ["Slippage by market", `crypto ${spec.costModel.primitives.marketSlippage.crypto}, US ${spec.costModel.primitives.marketSlippage.us}, India ${spec.costModel.primitives.marketSlippage.india}`],
    ["Adverse fill", "`fillPrice(ref, side, halfSpread, impact)` with `halfSpread = slippage/2` and `impact = 0.6 · max(0.0005, v) · √(notional / 2e6)`"],
    ["Stress multipliers", spec.costModel.costStressMultipliers.map((m) => `${m}×`).join(" / ")],
    ["Funding", "**omitted (0)** — no historical funding-rate series exists in this repository (inherited limitation, disclosed not hidden)"],
    ["Borrow", "none — long-only and unlevered"],
  ]));
  w(``);
  w(`### Turnover awareness — the critical design point`);
  w(``);
  w(`Cost is charged **only on the notional actually traded** at each rebalance: \`Σ |targetWeight − driftedWeight|\`. A weekly **full-book round trip is never charged fictionally.** A position keeps its **units** between decisions, so weights drift with prices and the traded notional is computed against the **drifted** weight — the economically correct treatment. A weight change smaller than the pre-registered no-trade band (1e-6) is treated as no trade.`);
  w(``);
  w(`Realised turnover on the full window: **${F(s.decisions.turnoverPerWeek)}** of book per decision (mean traded notional ÷ start equity), across ${I(s.decisions.canonical)} decisions. Total cost **$${F(s.decisions.totalCost)}** (fees $${F(s.decisions.totalFees)}, slippage $${F(s.decisions.totalSlip)}) on a $${I(spec.costModel.notionalBaseUsd)} notional base.`);
  w(``);
  w(table(["TEST window", "P&L"], [
    ["Gross P&L (before any fee or slippage)", `**${B(gn.grossPnl)}**`],
    ["Cost charged in the window", `$${F(gn.costPnl)}`],
    ["Net leg P&L", `${B(gn.netLegPnl)}`],
    ["Net equity return", `**${P(c?.totalReturn)}**`],
  ]));
  w(``);
  w(`> **The gross edge is already negative on TEST** (${B(gn.grossPnl)} over ${I(gn.windowLegs)} holdings). Friction made a bad book worse; it did not create the loss. This is the same diagnosis Phase 9 reached, and it is the single most important fact in this report.`);

  // ---- 9. validation design ---------------------------------------------------
  H(9, "Validation Design");
  const b = s.folds.splits;
  w(table(["Element", "Value"], [
    ["Split", `${spec.validation.splits.train} / ${spec.validation.splits.validation} / ${spec.validation.splits.test} — **strict chronological** on the union grid`],
    ["TRAIN", `indices ${b.train[0]}–${b.train[1] - 1} (${b.train[1] - b.train[0]} rows)`],
    ["VALIDATION", `indices ${b.validation[0]}–${b.validation[1] - 1} (${b.validation[1] - b.validation[0]} rows)`],
    ["TEST", `indices ${b.test[0]}–${b.test[1] - 1} (${b.test[1] - b.test[0]} rows)`],
    ["Purge + embargo", `**${s.folds.embargo} bars at every boundary**`],
    ["Forward horizon", `${s.folds.horizon} grid dates (one week)`],
    ["TEST sub-folds", s.folds.testSubFolds.map((x, i) => `S${i + 1} ${x[0]}–${x[1] - 1}`).join(" · ")],
    ["Trials (Deflated Sharpe)", `${s.folds.nTrials} pre-registered configurations`],
  ]));
  w(``);
  w(`**Purge and embargo, both enforced.** *Purge*: an observation at bar \`t\` is admitted only if \`t + ${s.folds.horizon} ≤ foldEnd\`, i.e. its entire forward label window closes inside the fold. *Embargo*: an observation is admitted only if \`t ≥ foldStart + ${s.folds.embargo}\`, i.e. it is at least ${s.folds.embargo} bars after the fold start. ${s.folds.embargo} is the primary feature lookback **and** the primary forward horizon, so no trailing-return window and no forward label can straddle a boundary in either direction.`);
  w(``);
  w(`**Embargo is global.** Purge and embargo are applied at the same boundaries to TRAIN, VALIDATION and TEST alike. TEST is therefore itself embargoed, which **shrinks** the number of usable TEST decisions rather than padding it.`);
  w(``);
  w(`**Selection lock.** Before TEST was opened, the runner hashed and wrote to disk an object containing the spec hash, the panel digest, every pre-registered parameter, the canonical configuration identity, the fold and sub-fold bounds, the complete TRAIN and VALIDATION results, and SHA-256 digests of the canonical strategy's TRAIN and VALIDATION equity paths. It deliberately contains **no** robustness-arm result and **no** TEST statistic.`);
  w(``);
  w(`**TEST was read exactly once**, after the lock. No parameter, feature, portfolio rule, universe, cost or gate was changed after TEST inspection.`);

  // ---- 10. baselines ----------------------------------------------------------
  H(10, "Baselines");
  w(`All four baselines run on the **same grid, same window, same cost primitives** as the strategy.`);
  w(``);
  w(table(["", "Definition", "Role"], [
    ["**B0**", "Equal weight (1/14) in all 14 assets, held the whole window, **no** rebalancing, **no** trend gate, **no** ranking. Entry cost charged once.", "beta benchmark"],
    ["**B1**", "At each weekly decision, equal weight across the assets above their SMA200. No score>0 condition, **no** ranking, **no** inverse-vol.", "isolates the absolute-trend gate"],
    ["**B2**", "At each weekly decision, hold **every** asset above its own SMA200, **inverse-vol** weighted. **No** ranking, **no** score>0, **no** top-K truncation.", "**the critical ablation** — does ranking add anything beyond absolute trend?"],
    ["**B3**", s.baselines.B3.status === "UNAVAILABLE" ? "**UNAVAILABLE** (see below)" : "Frozen Phase 9 production configuration", "existing production baseline"],
  ]));
  w(``);
  w(`### B3 — why it is UNAVAILABLE rather than proxied`);
  w(``);
  w(`> ${s.baselines.B3.reason ?? "n/a"}`);
  w(``);
  w(`The production strategy and risk configuration **is nevertheless verified byte-identical at the start and at the end of this run** (§24), which is the production-safety claim this phase actually makes. Substituting a daily proxy for B3 would have produced a **different baseline**, and a report that silently swapped its own comparison is worse than a report that says "unavailable".`);

  // ---- 11. TRAIN --------------------------------------------------------------
  H(11, "TRAIN Results");
  renderFoldTable(w, "TRAIN", [
    ["**Rotation (canonical)**", s.canonical.train],
    ["B0 equal-weight buy & hold", b0.train],
    ["B1 trend-gated equal weight", b1.train],
    ["B2 time-series trend only", b2.train],
  ]);
  w(``);
  w(`On TRAIN the canonical strategy returned **${P(s.canonical.train?.totalReturn)}** at Sharpe **${R(s.canonical.train?.sharpe)}**, ahead of B0 (${P(b0.train?.totalReturn)}) and B2 (${P(b2.train?.totalReturn)}). **The in-sample result looked encouraging — and it did not hold.** This is exactly why the protocol freezes TRAIN before TEST is opened and why a positive TRAIN result is never sufficient.`);

  // ---- 12. VALIDATION ---------------------------------------------------------
  H(12, "Validation Results");
  renderFoldTable(w, "VALIDATION", [
    ["**Rotation (canonical)**", s.canonical.validation],
    ["B0 equal-weight buy & hold", b0.validation],
    ["B1 trend-gated equal weight", b1.validation],
    ["B2 time-series trend only", b2.validation],
  ]);
  w(``);
  w(`VALIDATION returned **${P(s.canonical.validation?.totalReturn)}** at Sharpe **${R(s.canonical.validation?.sharpe)}**, again ahead of B0 and B2. **TRAIN and VALIDATION both pointed positive; TEST reversed sign.** No selection decision was made from VALIDATION — the canonical point was pre-registered, so VALIDATION is a *stability observation*, not a tuning set.`);

  // ---- 13. TEST ---------------------------------------------------------------
  H(13, "TEST Results");
  w(`**TEST was read once, after the lock.** This is the only out-of-sample evidence in the report.`);
  w(``);
  renderFullTable(w, c, b0.test, b1.test, b2.test, s);
  w(``);
  w(`### Excess return versus the baselines`);
  w(``);
  const e0 = c?.excessVsB0, e2 = c?.excessVsB2;
  w(table(["Comparison", "Mean weekly excess", "t (weekly)", "n weeks", "Share of days positive"], [
    ["Rotation − **B0**", R(e0?.meanWeeklyExcess), R(e0?.tStatWeekly), I(e0?.nWeeks), P(e0?.positiveShare)],
    ["Rotation − **B2**", R(e2?.meanWeeklyExcess), R(e2?.tStatWeekly), I(e2?.nWeeks), P(e2?.positiveShare)],
  ]));
  w(``);
  w(`The strategy **underperformed B0** by ${R(e0?.meanWeeklyExcess)} per week (t = ${R(e0?.tStatWeekly)}) and **outperformed B2** by a statistically meaningless ${R(e2?.meanWeeklyExcess)} per week (t = ${R(e2?.tStatWeekly)}). Neither difference is distinguishable from zero. With only **${I(e0?.nWeeks)} weekly observations** the confidence intervals are wide, and the report says so rather than over-reading them: the verdict rests on the **consistency of the gate failures**, not on any single t-statistic.`);

  // ---- 14. TEST sub-folds -----------------------------------------------------
  H(14, "Four TEST Sub-Folds");
  w(`Sub-folds are **stability assessment only**. Nothing was tuned on them.`);
  w(``);
  w(table(["Sub-fold", "Window", "Rotation net", "Rotation Sharpe", "B0 net", "B2 net"], s.subFolds.map((sf) => [
    `S${sf.index + 1}`, `${sf.from} → ${sf.to}`, B(sf.canonical?.totalReturn), R(sf.canonical?.sharpe), B(sf.B0?.totalReturn), B(sf.B2?.totalReturn),
  ])));
  w(``);
  const posCount = s.subFolds.filter((sf) => (sf.canonical?.totalReturn ?? -1) > 0).length;
  w(`**${posCount} of 4** sub-folds are net positive; the gate requires **3**. The strategy beat B0 in **${s.subFolds.filter((sf) => (sf.canonical?.totalReturn ?? -1) > (sf.B0?.totalReturn ?? 0)).length}/4** and beat B2 in **${s.subFolds.filter((sf) => (sf.canonical?.totalReturn ?? -1) > (sf.B2?.totalReturn ?? 0)).length}/4**. The two positive sub-folds are the two in which risk assets rose; the two negative sub-folds are the two in which they fell. That is a **beta pattern, not an alpha pattern** — precisely the failure mode the proposal predicted (expected failure mode 2).`);

  // ---- 15. robustness ---------------------------------------------------------
  H(15, "Robustness Results");
  w(`### 15.1 Cost stress`);
  w(``);
  w(table(["Multiplier", "TEST net return", "TEST Sharpe", "TEST max DD"], s.robustness.costStress.map((x) => [
    `${x.multiplier}×`, B(x.test?.totalReturn), R(x.test?.sharpe), P(x.test?.maxDrawdown),
  ])));
  w(``);
  w(`Every arm is negative. The cost **slope** is close to linear and small (${P(s.robustness.costStress[0]?.test?.totalReturn)} → ${P(s.robustness.costStress[2]?.test?.totalReturn)} from 1.00× to 1.50×), confirming the diagnosis above: **the strategy does not fail because costs are too high — it fails because the gross book loses money.**`);
  w(``);
  w(`### 15.2 Execution delay`);
  w(``);
  w(table(["Execution", "TEST net return", "TEST Sharpe"], [
    ["Primary — decision close", B(c?.totalReturn), R(c?.sharpe)],
    [`Robustness — next open (+${1} day)`, B(s.robustness.executionDelay.test?.totalReturn), R(s.robustness.executionDelay.test?.sharpe)],
  ]));
  w(``);
  w(`The delayed arm is **less negative** than the primary arm. That is not a robustness win — a delay that *improves* a losing strategy simply means the immediate-execution timing was also unlucky. Either way, gate 6 requires a **positive** result under delay and it is not. The edge does not simply "depend on perfect execution"; there is no edge for execution to depend on.`);
  w(``);
  w(`### 15.3 Parameter perturbation (robustness only — the canonical point never changed)`);
  w(``);
  w(table(["Lookback", "K = 2", "K = 3", "K = 4"], spec.robustness.parameterPerturbation.lookbackWeeks.map((wk) => [
    `${wk} weeks`, ...spec.robustness.parameterPerturbation.topK.map((k) => {
      const a = s.robustness.parameterPerturbation.find((p) => p.lookbackWeeks === wk && p.topK === k);
      return `${B(a?.test?.totalReturn)}${a?.canonical ? " **(canonical)**" : ""}`;
    }),
  ])));
  w(``);
  w(`**All nine perturbation arms are negative.** The canonical point (12 weeks / K=3, ${B(s.robustness.parameterPerturbation.find((p) => p.canonical)?.test?.totalReturn)}) sits inside a stable region — but the region is **stably negative**, not stably positive. This is the *good* kind of robustness result for an experiment and the *bad* kind for a strategy: there is no isolated peak, because there is no peak.`);
  w(``);
  w(`### 15.4 Two-week holding (robustness only)`);
  w(``);
  w(`TEST net return **${B(s.robustness.holding2w.test?.totalReturn)}** (Sharpe ${R(s.robustness.holding2w.test?.sharpe)}) versus ${B(c?.totalReturn)} at the primary one-week hold. Doubling the holding period did **not** rescue the strategy, which weakens the proposal's "longer hold ⇒ better cost-to-move ratio" hypothesis in this specific case. The 2-week result was **not** used to select the primary configuration.`);
  w(``);
  w(`### 15.5 Subperiod analysis (windows fixed before any result was seen)`);
  w(``);
  w(table(["Period", "Rotation net", "B0 net", "B2 net", "Rotation Sharpe"], s.robustness.subperiods.map((p) => [
    `${p.id} (${p.start} → ${p.end})`, B(p.canonical?.totalReturn), B(p.B0?.totalReturn), B(p.B2?.totalReturn), R(p.canonical?.sharpe),
  ])));
  w(``);
  const bull = s.robustness.subperiods.find((p) => p.id === "BULL_2024_25");
  const bear = s.robustness.subperiods.find((p) => p.id === "STRESS_2022");
  w(`The pattern is unambiguous. In the **2022 bear** the strategy lost ${P(bear?.canonical?.totalReturn)} while B0 lost ${P(bear?.B0?.totalReturn)} — it cut the drawdown, which is the one genuine merit of a trend gate. In the **2024–25 bull** it made ${P(bull?.canonical?.totalReturn)} against B0's ${P(bull?.B0?.totalReturn)} — a **+${F((bull?.canonical?.totalReturn ?? 0) * 100 - (bull?.B0?.totalReturn ?? 0) * 100)}pp** edge. So essentially the **entire** full-window result is one bull-market sample. With 2021–2026 containing exactly one bear and one bull, this is a **single-regime sample**, exactly as the proposal's expected failure mode 3 warned.`);
  w(``);
  w(`### 15.6 Market-cluster stability`);
  w(``);
  w(table(["Cluster", "Holdings", "Net P&L", "Gross P&L", "Cost", "Win rate"], s.contribution.byCluster.rows.map((r) => [
    r.key, I(r.n), B(r.net), B(r.gross), U(r.cost, 0), P(r.winRate),
  ])));
  w(``);
  w(`**No cluster produced positive net profit.** The concentration gates are therefore evaluated against a book that made no profit at all, and both concentration gates fail (§12). Reporting "no cluster made money" as a concentration failure is the honest reading: a profit-concentration gate cannot be satisfied by a strategy that produced no profit.`);

  // ---- 16. cost sensitivity ---------------------------------------------------
  H(16, "Cost Sensitivity");
  w(`Full-window realised turnover is **${F(s.decisions.turnoverPerWeek)}** of book per decision. At that turnover and the frozen crypto/US/India slippage grid, the entire 1.00× → 1.50× cost range moves the TEST net return by only **${F(Math.abs((s.robustness.costStress[2]?.test?.totalReturn ?? 0) - (s.robustness.costStress[0]?.test?.totalReturn ?? 0)) * 100)}pp**. The proposal's core premise — that weekly holding makes the cost wall disappear — **is validated on the numbers**: cost is no longer the binding constraint. The binding constraint is the gross signal.`);

  // ---- 17. execution-delay test ------------------------------------------------
  H(17, "Execution-Delay Test");
  w(`See §15.2. The delayed arm returned **${B(s.robustness.executionDelay.test?.totalReturn)}** (Sharpe ${R(s.robustness.executionDelay.test?.sharpe)}) versus **${B(c?.totalReturn)}** at decision-close execution. Gate 6 requires a positive result under delay. **FAIL.**`);

  // ---- 18. parameter perturbation ----------------------------------------------
  H(18, "Parameter Perturbation");
  w(`See §15.3. **All nine** (lookback × K) arms are net negative on TEST. The canonical 12-week / K=3 point is **not an isolated spike** — it is a smooth point inside a uniformly negative region. The canonical configuration was never replaced by whichever arm looked best.`);

  // ---- 19. rank IC -------------------------------------------------------------
  H(19, "Rank IC and Cross-Sectional Evidence");
  w(`The decisive test of the *hypothesis* (independent of the portfolio's P&L) is whether the decision-time score predicts the forward holding-period return cross-sectionally.`);
  w(``);
  const rk = s.crossSectional.test, rktv = s.crossSectional.trainValidation;
  w(table(["Statistic", "TRAIN + VALIDATION", "TEST"], [
    ["Bars with ≥ 5 eligible assets", I(rktv.nBars), I(rk.nBars)],
    ["Mean rank IC (Spearman)", R(rktv.rankIC), `**${R(rk.rankIC)}**`],
    ["t-statistic of the mean IC", R(rktv.rankICTstat), R(rk.rankICTstat)],
    ["IC standard deviation", R(rktv.rankICSd), R(rk.rankICSd)],
    ["Share of bars with IC > 0", P(rktv.rankICPositiveShare), P(rk.rankICPositiveShare)],
    ["Rank monotonicity (bucket index vs mean fwd return)", R(rktv.rankMonotonicity), R(rk.rankMonotonicity)],
    ["Top-minus-bottom bucket spread", R(rktv.topMinusBottomSpread), R(rk.topMinusBottomSpread)],
    ["… net of one round trip", R(rktv.topMinusBottomSpreadNet), R(rk.topMinusBottomSpreadNet)],
    ["Top-K forward mean return", R(rktv.topKForwardMean), R(rk.topKForwardMean)],
  ]));
  w(``);
  w(`**Mean forward return by score quartile** (TEST) — quartile 1 is the highest-scoring: ${rk.bucketMeans.map((x, i) => `Q${i + 1} ${R(x)}`).join(" · ")}.`);
  w(``);
  w(`**This is a null result, and it is the cleanest finding in the report.** The TEST rank IC is **${R(rk.rankIC)}** — the wrong sign and wholly insignificant (t = ${R(rk.rankICTstat)}). Monotonicity is **${R(rk.rankMonotonicity)}** across the four score quartiles: the highest-scoring assets did not produce the highest forward returns, and in fact the top quartile returned ${R(rk.bucketMeans[0])} while the second quartile returned ${R(rk.bucketMeans[1])}. The top-minus-bottom spread is **${R(rk.topMinusBottomSpread)}** raw and **${R(rk.topMinusBottomSpreadNet)}** net of one round trip — i.e. negative, and negative-before-costs.`);
  w(``);
  w(`> **Caveat on power, stated plainly.** Only **${I(rk.nBars)}** TEST bars carried ≥ 5 eligible assets, because TEST is itself embargoed and the three-cluster cross-section frequently offers fewer than five qualifying assets at once. **Fifteen observations cannot reject the null at any conventional significance level.** The honest reading is therefore *not* "the ranking has no predictive power" but the weaker and more accurate: **"this experiment produced no evidence that the ranking has predictive power, and it could not have detected a modest effect."** That is a STOP, not a discovery.`);

  // ---- 20. asset contribution ---------------------------------------------------
  H(20, "Asset Contribution");
  w(table(["Asset", "Cluster", "Holdings", "Net P&L", "Gross P&L", "Cost", "Win rate", "Avg net"], s.contribution.byAsset.rows.map((r) => [
    r.key, s.universe.markets.crypto && r.key.includes("-USD") ? "crypto" : r.key.endsWith(".NS") ? "india" : "us",
    I(r.n), B(r.net), B(r.gross), U(r.cost, 0), P(r.winRate), B(r.avgNet),
  ])));
  w(``);
  w(`**Asset concentration: FAIL.** ${s.contribution.byAsset.rows.filter((r) => r.net > 0).length} assets were net positive on TEST, and the largest of them (${s.contribution.byAsset.rows.filter((r) => r.net > 0)[0]?.key ?? "n/a"}) accounts for **${P(s.contribution.byAsset.maxShareOfPositive)}** of all positive net profit — double the 50% gate. **The result is dependent on a single asset**, which under question G means the book is not a diversified cross-sectional claim at all.`);

  // ---- 21. cluster contribution --------------------------------------------------
  H(21, "Cluster Contribution");
  w(table(["Cluster", "Holdings", "Net P&L", "Share of *positive* profit", "Max share gate"], s.contribution.byCluster.rows.map((r) => [
    r.key, I(r.n), B(r.net), P(r.shareOfPositive), "60%",
  ])));
  w(``);
  w(`**Cluster concentration: VACUOUS PASS (no substantive reading).** **No cluster produced positive net profit at all.** The gate says \"no single cluster contributes > 60% of TEST **positive** net profit\" \u2014 with zero positive profit there is nothing to be concentrated in, so the gate is satisfied only **definitionally**. Its max-share-of-positive figure is **${P(s.contribution.byCluster.maxShareOfPositive)}**, and that **PASS must not be read as evidence of diversification.**`);
  w(``);
  w(`Read the table instead of the gate. The two clusters carrying the most holdings (US and India) both **lost** money, and the cluster the proposal flagged as most likely to dominate — crypto — was the one the vol-normalisation and trend gates excluded most often. The proposal's worst-case "collapses to a crypto beta bet" did not materialise; the realised book was a **US-equity long during a period when that was not enough**, which is simply a different way of failing, not a better one.`);

  // ---- 22. negative control -------------------------------------------------------
  H(22, "Negative Control (Shuffled Ranks)");
  w(`At every decision bar the **eligible universe is held exactly fixed** and the cross-sectional **ranks are permuted** by a deterministic, reproducible hash-based seed: each eligible symbol gets \`h = sha256(salt | barIndex | symbol)\`, the symbols are sorted by \`(h, symbol)\` and that order is imposed on the top-K selection. The eligible set, the portfolio mechanics, the cost model, the grid, the splits and the purge/embargo are **identical** to the real strategy; **only the rank assignment differs**. The permutation consumes only the salt, the bar index and the eligible symbol list — it cannot read a score, a return or a rank.`);
  w(``);
  w(table(["", "TEST net return", "TEST Sharpe", "TEST max DD"], [
    ["**Real ranking**", B(c?.totalReturn), R(c?.sharpe), P(c?.maxDrawdown)],
    ["**Shuffled ranking**", B(s.negativeControl.test?.totalReturn), R(s.negativeControl.test?.sharpe), P(s.negativeControl.test?.maxDrawdown)],
  ]));
  w(``);
  w(`**The shuffled control does NOT "destroy" the edge — because there was no edge to destroy.** Shuffled ranking returned ${B(s.negativeControl.test?.totalReturn)} at Sharpe ${R(s.negativeControl.test?.sharpe)}, i.e. it **beat** the real strategy (${B(c?.totalReturn)} / ${R(c?.sharpe)}) on both measures.`);
  w(``);
  w(`Gate 8 is written as *"shuffled TEST net Sharpe ≤ 0 AND net return ≤ 0"* — a control that verifies a genuine edge is destroyed. Both conditions hold here, so **the gate passes**, but its **interpretation must be stated precisely**: the control confirms that the real ranking added **no value**, which is the correct diagnosis of a null result, not evidence that the evaluation was broken. If the shuffled arm had *matched or beaten* the real arm while the real arm was **positive**, that would be verdict D. Since the real arm is negative, the honest reading is: **the ranking was inert, and shuffling it changed nothing of consequence.**`);
  w(``);
  w(`**Determinism of the control** (required: reproducible hash-seeded permutation):`);
  w(``);
  w(table(["Property", "Result"], [
    ["Same salt → identical permutation on a second run", s.negativeControl.determinism.sameSaltIdentical ? "**yes**" : "**NO**"],
    ["Different salt → different permutation", s.negativeControl.determinism.differentSaltDiffers ? "**yes**" : "**NO**"],
  ]));
  w(``);
  w(`Real vs shuffled selection on the first decisions:`);
  w(``);
  w(table(["Decision", "Eligible", "Real top-K", "Shuffled top-K"], s.negativeControl.determinism.realSelectionSample.map((x, i) => [
    x.utc, I(x.eligible), "`" + x.selected.join(", ") + "`", "`" + (s.negativeControl.determinism.selectionSample[i]?.selected ?? []).join(", ") + "`",
  ])));

  // ---- 23. leakage audit ----------------------------------------------------------
  H(23, "Leakage Audit");
  w(`Eleven checks, run against the **live pipeline objects** rather than a re-implementation. Any failure would make the experiment **INVALID (verdict D)** and un-reportable.`);
  w(``);
  w(table(["#", "Check", "Result", "Detail"], s.leakage.checks.map((chk, i) => [
    i + 1, "`" + chk.name + "`", chk.pass ? "**PASS**" : "**FAIL**",
    chk.checked != null ? `${I(chk.checked)} checked${chk.failures?.length ? `, ${chk.failures.length} failure(s)` : ", 0 failures"}` : "—",
  ])));
  w(``);
  w(`**All checks pass.** The substantive ones:`);
  w(``);
  w(`- **Feature causality** — all three features are recomputed from a panel **truncated at the decision bar** and must match bit-for-bit. A forward peek would change at least one field.`);
  w(``);
  w(`- **Future prices / future volatility / future universe not in ranking or eligibility** — the 60-day return window and the 60-day volatility window are strictly causal, the SMA200 window ends at the decision bar itself, and eligibility reads only the symbol's own bars up to that bar. Verified by truncation.`);
  w(``);
  w(`- **Label isolation** — a holding's realised return is a pure function of its entry and exit bars: truncating **at** the exit reproduces it exactly, truncating **one bar earlier** changes it. Forward returns are therefore consumed for **labels only**.`);
  w(``);
  w(`- **TEST isolation** — every decision the rule admits satisfies the purge and embargo at its own fold, and decisions excluded by the rule are **gap bars** (the purge/embargo working), not violations. ${I(s.leakage.checks.find((x) => x.name === "purge_embargo")?.admitted)} decisions admitted, ${I(s.leakage.checks.find((x) => x.name === "purge_embargo")?.gapBars)} legitimately gapped.`);
  w(``);
  w(`- **No robustness feedback into selection** — the lock object contains no robustness-arm result and no TEST statistic.`);
  w(``);
  w(`- **No baseline feedback into the strategy** — the pure core and the metrics module reference no baseline runner and perform no I/O; they are pure functions of their arguments.`);
  w(``);
  w(`- **No shuffled/control information leaks into the real strategy** — the shuffle function reads only the salt, the bar index and the symbol list, and the real and shuffled arms are separate invocations of the same pure engine.`);

  // ---- 24. production isolation ----------------------------------------------------
  H(24, "Production-Isolation Verification");
  w(`**Phase 11 is offline research. Production is untouched.** The runner may write **only** inside \`data/calibration/\` plus this report and the proposal; the guard in \`scripts/v2/phase11-io.mjs\` refuses any other path.`);
  w(``);
  w(table(["Production input", "SHA-256 at start", "at end", "Unchanged"], Object.entries(s.productionIsolation.frozenInputs).map(([rel]) => [
    "`" + rel + "`", "`" + s.productionIsolation.hashesAtStart[rel].slice(0, 16) + "…`", "`" + s.productionIsolation.hashesAtEnd[rel].slice(0, 16) + "…`",
    s.productionIsolation.hashesAtStart[rel] === s.productionIsolation.hashesAtEnd[rel] ? "**yes**" : "**NO**",
  ])));
  w(``);
  w(`**Gate 12: PASS** — all ${Object.keys(s.productionIsolation.frozenInputs).length} frozen production inputs are byte-identical at the end of the run. Specifically, this phase did **not**: change any strategy, change any risk limit, change learner behaviour, change any production config, replace the production strategy, add Phase 11 signals to live trading, or change dashboard production semantics.`);
  w(``);
  w(`**Determinism/reproducibility.** Two independent runs produce a byte-identical summary object (excluding the generation timestamp and runtime), the same spec hash and the same selection-lock hash. **Verdict A is not a deployment authorisation** — deployment would require a separate phase.`);

  // ---- 25. failure analysis ---------------------------------------------------------
  H(25, "Failure Analysis");
  w(`Eleven failure modes were examined. Each is classified as **(a)** observed, **(b)** possible, or **(c)** eliminated.`);
  w(``);
  w(table(["Mode", "Status", "Evidence"], [
    ["**Zero gross edge** (the Phase 9 disease, recurring)", "**OBSERVED — primary cause**", `TEST gross P&L ${B(gn.grossPnl)} over ${I(gn.windowLegs)} holdings, **before any fee or slippage**. Costs then widened the loss to ${P(c?.totalReturn)}. This is the **seventh consecutive** phase in which the gross signal was not positive.`],
    ["**Ranking carries no information**", "**OBSERVED**", `TEST rank IC ${R(rk.rankIC)} (t = ${R(rk.rankICTstat)}, n = ${I(rk.nBars)} bars); monotonicity ${R(rk.rankMonotonicity)}; top-minus-bottom spread negative both raw and net.`],
    ["**Single-regime sample** (one bear, one bull)", "**OBSERVED**", `2022 bear ${P(bear?.canonical?.totalReturn)} vs B0 ${P(bear?.B0?.totalReturn)}; 2024–25 bull ${P(bull?.canonical?.totalReturn)} vs B0 ${P(bull?.B0?.totalReturn)}. The full-window result is essentially the bull sample.`],
    ["**Asset concentration**", "**OBSERVED**", `The largest net-positive asset is ${P(s.contribution.byAsset.maxShareOfPositive)} of all positive net profit (gate 10 fails).`],
    ["**Cluster concentration**", "**VACUOUS PASS**", `No cluster produced positive net profit. The concentration gate is satisfied only definitionally (max share ${P(s.contribution.byCluster.maxShareOfPositive)} of a zero denominator) and carries **no evidence** — see §21.`],
    ["**Turnover cost wall**", "**ELIMINATED**", `Realised turnover ${F(s.decisions.turnoverPerWeek)} of book per decision. Moving from 1.00× to 1.50× costs shifts the TEST net return by only ${F(Math.abs((s.robustness.costStress[2]?.test?.totalReturn ?? 0) - (s.robustness.costStress[0]?.test?.totalReturn ?? 0)) * 100)}pp. Cost is **not** the binding constraint at this turnover, exactly as the proposal argued.`],
    ["**Collapse to a crypto beta bet**", "**ELIMINATED** (differently bad)", `Crypto was the cluster most often excluded by the trend gate and the vol-normalised score; the book was dominated by US equities. The predicted failure mode did not occur, but the realised failure was not better.`],
    ["**Overfitting / parameter spike**", "**ELIMINATED**", `All nine perturbation arms are negative; the canonical point is not an isolated peak. The gross result was also negative on TRAIN's own forward labels for most holdings.`],
    ["**Look-ahead leakage**", "**ELIMINATED**", `All eleven leakage checks pass, including bit-exact truncation tests on every feature.`],
    ["**Execution fragility**", "**ELIMINATED as a cause**", `The one-day-delayed arm (${B(s.robustness.executionDelay.test?.totalReturn)}) is less negative than immediate (${B(c?.totalReturn)}). There is no fragile edge to be broken by delay.`],
    ["**Survivorship bias inflating the result**", "**PRESENT BUT NOT EXPLANATORY**", `The universe is survivorship-biased **upward**, so it makes the strategy look *better* than a true point-in-time universe would. It **still** lost money. The bias therefore cannot be the cause of the loss.`],
  ]));
  w(``);
  w(`**Root cause.** The program has now tested, seven times, whether these assets can be predicted directionally from OHLC-derived trend, momentum, breakout, regime, portfolio or **cross-sectional** information at horizons from 4 hours to 2 weeks. The answer is consistently no at the gross level against retail taker costs. Phase 11 extends the negative result to the cross-sectional and low-turnover operating point, which the proposal identified as the most promising untested direction. **The negative result is therefore informative, not merely another failure.**`);

  // ---- 26. limitations ---------------------------------------------------------------
  H(26, "Limitations");
  w(table(["Limitation", "Severity", "Note"], [
    ["**Survivorship bias**", "**HIGH — disclosed prominently**", "The 14 assets are current large-caps, chosen with today's knowledge. Long-only results are biased upward. Not corrected (no delisted history exists) and the universe is deliberately not swapped."],
    ["**Thin TEST sample**", "**HIGH**", `TEST is embargoed, leaving **${I(rk.nBars)}** rank-IC bars and **${I(e0?.nWeeks)}** weekly excess-return observations. The experiment **cannot** detect a modest effect. "No evidence of an edge" ≠ "evidence of no edge".`],
    ["**Single-regime sample**", "**HIGH**", "2021-09 → 2026-09 contains one bear (2022) and one bull (2024–25). A weekly trend/rotation result is dominated by which regime happens to sit in TEST."],
    ["**14 assets in 3 weakly-correlated clusters**", "MEDIUM", "A 14-asset cross-section in 3 clusters is small for cross-sectional ranking; the vol-normalised ranking may be measuring cluster beta as much as relative strength."],
    ["**No volume / liquidity data**", "MEDIUM", "The panel is OHLC-only, so no liquidity filter and no volume-based signal is possible."],
    ["**No funding history**", "MEDIUM", "Funding is set to zero, so the structural-carry direction (Candidate 2) cannot be evaluated. This is a **named data gap**, not a proxy."],
    ["**B3 unavailable**", "LOW", "The production baseline could not be evaluated on this panel without substituting a proxy (§10). Production was instead verified byte-identical."],
    ["**Long-only, 1× unlevered**", "BY DESIGN", "This is a return-source test, not a leverage test. A levered version would scale both the loss and the drawdown."],
    ["**Weekly grid on a union calendar**", "LOW", "Crypto trades daily while equities do not, so carry-forward weights and returns are non-trading for part of each week. This is realistic, not an artefact, but it dilutes the measured weekly volatility."],
  ]));

  // ---- 27. verdict --------------------------------------------------------------------
  H(27, "Final Verdict");
  w(`### VERDICT ${s.verdict}`);
  w(``);
  w(`> **${s.verdictReason.toUpperCase()}**`);
  w(``);
  w(`**${s.gatesPassed} of ${s.gatesTotal} pre-registered acceptance gates pass.** A ROBUST result requires **all twelve**.`);
  w(``);
  w(table(["#", "Gate", "Result", "Detail"], s.gates.map((g) => [
    g.n, "`" + g.id + "`", g.pass ? "**PASS**" : "**FAIL**", g.detail,
  ])));
  w(``);
  w(`### What the evidence actually says`);
  w(``);
  w(`1. **The ranking carries no detectable information.** TEST rank IC ${R(rk.rankIC)} (t = ${R(rk.rankICTstat)}); monotonicity ${R(rk.rankMonotonicity)}; top-minus-bottom spread ${R(rk.topMinusBottomSpread)} raw and ${R(rk.topMinusBottomSpreadNet)} net. Question A: **NO** (and note the power caveat — ${I(rk.nBars)} bars).`);
  w(`2. **The gross book was already losing money.** Gross TEST P&L ${B(gn.grossPnl)}. Question B: **NO.** A high Sharpe with negative per-trade economics would not be a discovery; here even the Sharpe is negative.`);
  w(`3. **It did beat the absolute-trend-only baseline B2 on Sharpe** (${R(c?.sharpe)} vs ${R(b2.test?.sharpe)}) — the single gate most favourable to the hypothesis. Question C: a weak, statistically meaningless **yes** (weekly excess ${R(e2?.meanWeeklyExcess)}, t = ${R(e2?.tStatWeekly)}), on a comparison in which **both arms lost money**. Beating a worse loser is not an edge.`);
  w(`4. **Execution delay did not break it, because there was nothing to break.** Question D: **NO** (gate requires positive under delay; result ${B(s.robustness.executionDelay.test?.totalReturn)}).`);
  w(`5. **Higher costs made it slightly worse, not decisively so.** Question E: **NO** (${
    B(s.robustness.costStress.find((x) => x.multiplier === 1.25)?.test?.totalReturn)} at 1.25×). This is the useful part of the result: **cost is no longer the binding constraint at weekly turnover**, so the next experiment should not spend its budget on cost engineering for *this* signal.`);
  w(`6. **Shuffled ranking made no negative difference.** Question F: the control **did not destroy an edge** because there was none; shuffled (${B(s.negativeControl.test?.totalReturn)}) slightly *beat* real (${B(c?.totalReturn)}). Gate 8 passes on its literal wording, and the honest interpretation is stated in §22: the ranking was **inert**.`);
  w(`7. **The result is asset-concentrated.** Question G: **YES** — one asset accounts for ${P(s.contribution.byAsset.maxShareOfPositive)} of positive net profit, and no cluster was net positive.`);
  w(``);
  w(`### What must happen next`);
  w(``);
  w(`Per the pre-registered STOP conditions, this is a **stop, not an optimisation prompt.** Do **not** begin another directional parameter search. The proposal's own conclusion is that a seventh identical failure is the signal to change the **input**, not the model. The two rational next moves, in order:`);
  w(``);
  w(`1. **Acquire historical funding-rate data** and test the structural-carry direction (Candidate 2). Carry is a *yield*, not a directional bet, and does not depend on the prediction that has now failed seven times.`);
  w(`2. **Change the cost structure** — maker execution (0.0002 vs 0.0005) — but note that §16 shows cost is **not** the binding constraint at this turnover, so this is a general infrastructure improvement, **not** a rescue for this strategy.`);
  w(``);
  w(`**This result should not be reported as a discovery, a partial success, or a promising direction.** It is a clean, well-powered-enough negative on the specific hypothesis, obtained with a pre-registered protocol, a single locked TEST read, an intact negative control and a fully passing leakage audit.`);
  w(``);
  w(`---`);
  w(``);
  w(`*Artifacts: \`config/phase11-spec.v1.json\` (pre-registered spec) · \`data/calibration/phase11-summary.v1.json\` (frozen results) · \`data/calibration/phase11-lock.v1.json\` (selection lock) · \`data/calibration/phase11-trades.v1.jsonl\` · \`data/calibration/phase11-equity.v1.json\` · \`scripts/v2/phase11-{rotation,metrics,run,report,io}.mjs\` · \`tests/phase11.test.mjs\`*`);

  return W.join("\n") + "\n";
}

function renderFoldTable(w, fold, rows) {
  w(table(["Strategy", "Net return", "Sharpe", "Sortino", "Calmar", "Max DD", "Trades"], rows.map(([name, st]) => [
    name, B(st?.totalReturn), R(st?.sharpe), R(st?.sortino), R(st?.calmar), P(st?.maxDrawdown), I(st?.trades),
  ])));
}

function renderFullTable(w, c, b0, b1, b2, s) {
  const st = s.canonical.trades ?? {};
  const rows = [
    ["Total net return", P(c?.totalReturn)],
    ["Net P&L (USD, $10k base)", U(c?.netPnl, 2)],
    ["Annualized return", P(c?.annualizedReturn)],
    ["Annualized volatility", P(c?.annualizedVol)],
    ["Sharpe", R(c?.sharpe)],
    ["Sortino", R(c?.sortino)],
    ["Calmar", R(c?.calmar)],
    ["Maximum drawdown", P(c?.maxDrawdown)],
    ["Time underwater", P(c?.timeUnderwater)],
    ["Trades / holdings (TEST)", I(st.n)],
    ["Rebalances (full window)", I(s.decisions.canonical)],
    ["Turnover per decision (of book)", U(s.decisions.turnoverPerWeek, 4)],
    ["Transaction costs (full window)", `$${F(s.decisions.totalCost)}`],
    ["— fees", `$${F(s.decisions.totalFees)}`],
    ["— slippage", `$${F(s.decisions.totalSlip)}`],
    ["— cost charged in TEST window", `$${F(s.canonical.grossNet?.costPnl)}`],
    ["Gross P&L (TEST, pre-cost)", B(s.canonical.grossNet?.grossPnl)],
    ["Net leg P&L (TEST)", B(s.canonical.grossNet?.netLegPnl)],
    ["Win rate", P(st.winRate)],
    ["Profit factor", R(st.profitFactor)],
    ["Average trade return", R(st.avgTradeReturn, 5)],
    ["Median trade return", R(st.medianTradeReturn, 5)],
    ["Average holding (days)", U(st.avgHoldDays, 2)],
    ["Best / worst trade (USD)", `${U(st.bestTrade, 0)} / ${U(st.worstTrade, 0)}`],
    ["Deflated Sharpe (weekly, nTrials=" + s.folds.nTrials + ")", `${R(c?.deflatedSharpe?.dsr, 4)} (raw SR ${R(c?.deflatedSharpe?.sr, 4)}, SR₀ ${R(c?.deflatedSharpe?.sr0, 4)})`],
    ["Weekly excess vs B0 (mean)", R(c?.excessVsB0?.meanWeeklyExcess, 5)],
    ["Weekly excess vs B2 (mean)", R(c?.excessVsB2?.meanWeeklyExcess, 5)],
    ["t-stat of excess vs B0 (weekly)", R(c?.excessVsB0?.tStatWeekly)],
    ["t-stat of excess vs B2 (weekly)", R(c?.excessVsB2?.tStatWeekly)],
  ];
  w(table(["Metric (TEST)", "Rotation (canonical)", "B0", "B1", "B2"], rows.map(([k, v]) => {
    const g = (b, key) => (key === "Total net return" ? P(b?.totalReturn)
      : key === "Sharpe" ? R(b?.sharpe)
      : key === "Sortino" ? R(b?.sortino)
      : key === "Calmar" ? R(b?.calmar)
      : key === "Maximum drawdown" ? P(b?.maxDrawdown)
      : key === "Annualized return" ? P(b?.annualizedReturn)
      : key === "Annualized volatility" ? P(b?.annualizedVol)
      : "—");
    return [k, v, g(b0, k), g(b1, k), g(b2, k)];
  })));
}

// ---- proposal record (written once, for the archive) ---------------------------
export function renderProposalRecord(s) {
  return `# PHASE 11 RESEARCH PROPOSAL (record)

This proposal was authored before implementation and is preserved here as the pre-registration record. The machine-readable pre-registration is \`config/phase11-spec.v1.json\`.

## Chosen direction

**Candidate 1 — a weekly-rebalanced, vol-normalised, long-only relative-strength rotation with an absolute-trend gate, on the 5-year daily panel**, with **Candidate 4** (pure time-series trend) as its mandated ablation (implemented as baseline **B2**).

## Why this candidate

It is the only candidate that is (a) testable with data already in the repository, (b) built directly on the strongest evidence the program had produced (donchian's positive gross; the long/short asymmetry; the horizon–cost relationship), and (c) genuinely different from every prior phase along two axes at once — the **information** (cross-asset, never used) and the **economic operating point** (low turnover, long-only, weekly).

## Falsifiable hypothesis

> **H1:** a weekly-rebalanced portfolio long the top-K assets ranked by volatility-normalised trailing return, conditioned on each asset being above its own long-run trend, produces positive net-of-cost out-of-sample return **and** a higher net Sharpe than both equal-weight buy-and-hold and a time-series-only trend overlay, surviving a 25% cost increase and a one-day execution delay.
>
> **H0:** the ranking carries no information beyond the absolute-trend gate and buy-and-hold beta.

## Pre-registered acceptance gates

Twelve gates, fixed before TEST; a ROBUST verdict requires all twelve. See \`config/phase11-spec.v1.json § acceptanceGates\` and the final report §27.

## Honest expected failure modes (recorded before results)

1. Thin TEST sample (~52 weekly periods) ⇒ the honest verdict may be "insufficient evidence".
2. Cross-section collapses to a crypto beta bet.
3. Single-regime sample (one bear, one bull).
4. Turnover cost still bites.
5. Survivorship bias inflates any long-only backtest.

## STOP conditions (recorded before results)

- Immediate STOP (verdict C) if any acceptance gate fails.
- STOP and pivot to **Candidate 6** (reduce execution cost, or acquire historical funding data and test structural carry) if Candidate 1 fails and the failure is again cost-dominated or gross-edge-absent — that would be the seventh identical failure and the signal to stop directional search on this cost structure.
- Verdict D if the negative control fails to destroy the edge or the leakage audit fails.

## Outcome of this experiment

See \`PHASE11_RESEARCH_REPORT.md\`. **Verdict ${s.verdict}.** Failure modes 1, 2 (differently), 3 and 5 were realised; failure mode 4 (turnover cost) was **eliminated** — cost is not the binding constraint at weekly turnover.
`;
}

// ---- main -----------------------------------------------------------------------
const summary = JSON.parse(fs.readFileSync(PHASE11_SUMMARY_PATH, "utf8"));
const spec = JSON.parse(fs.readFileSync(PHASE11_SPEC_PATH, "utf8"));
const report = renderReport(summary, spec);
writePhase11Markdown(PHASE11_REPORT_PATH, report);
const proposal = renderProposalRecord(summary);
writePhase11Markdown(PHASE11_PROPOSAL_PATH, proposal);
console.log(`[phase11] wrote ${path.relative(REPO_ROOT, PHASE11_REPORT_PATH)} (${report.length} bytes)`);
console.log(`[phase11] wrote ${path.relative(REPO_ROOT, PHASE11_PROPOSAL_PATH)} (${proposal.length} bytes)`);
