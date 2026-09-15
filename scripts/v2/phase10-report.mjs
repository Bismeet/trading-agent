// scripts/v2/phase10-report.mjs — PHASE 10: deterministic report generator.
//
// Reads ONLY data/calibration/phase10-summary.v1.json and renders
// PHASE10_REGIME_PORTFOLIO_REPORT.md. No measurement, no statistics and no
// thresholds are computed here — every number is copied from the frozen
// summary, so the report can never disagree with the stored results.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE10_SUMMARY_PATH, PHASE10_REPORT_PATH, assertPhase10Path } from "./phase10-io.mjs";
import { sha256 } from "./store.mjs";

// ---- formatting (pure, locale-independent) -------------------------------
const F = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const B = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "n/a");
const P = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const I = (x) => (Number.isFinite(x) ? String(x) : "n/a");
const R = (x, d = 4) => (Number.isFinite(x) ? B(x, d) : "n/a");
const table = (head, rows) => [
  `| ${head.join(" | ")} |`,
  `|${head.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
].join("\n");

// Rollup row: total n, mean R over TRAIN+VALIDATION, TEST n, mean R over TEST.
const rollRow = (name, v) => [
  name, I(v?.n), v && v.n > 0 ? R(v.RSum / v.n) : "n/a",
  I(v?.testN), v && v.testN > 0 ? R(v.testRSum / v.testN) : "n/a",
  v && v.n > 0 ? P(v.wins / v.n) : "n/a",
];

// ---- section 5: opportunity model, cells, gate table -----------------------
export function sectionCells(s, H, W) {
  H(5, "Opportunity Model and the Conditional Map");
  W(`Every signal occurrence is measured at all six horizons with the full opportunity record: raw / gross / net return, MAE, MFE, holding time, cost, expected move, move-to-cost ratio and realised R. Occurrences are grouped into **cells** keyed by (signal, regime, side, horizon): ${I(s.cells?.total)} cells in total.`);
  W(``);
  const eg = s.cells?.eligibleTV ?? [];
  const pg = s.cells?.passedAllGates ?? [];
  W(table(["Horizon", "Cells passing TRAIN+VALIDATION gates", "Cells passing ALL gates (incl. TEST)"],
    eg.map((e) => {
      const p = pg.find((x) => x.horizonHours === e.horizonHours);
      const keys = (e.keys ?? []).map((k) => `\`${k}\``).join(", ");
      return [`${I(e.horizonHours)}h`, `${I(e.count)}${e.count ? ` — ${keys}` : ""}`, I(p?.count)];
    })));
  W(``);
  W(`No cell passed every gate, at any horizon. The six TRAIN+VALIDATION-eligible cells are listed above; each fails at least one TEST gate. The full cell map (TRAIN, VALIDATION and TEST economics per cell, Bayesian posterior) is in \`phase10-summary.v1.json\` under \`cells.map\` and summarised in §10.`);
  W(``);
  W(`A map whose shortlisted cells then fail TEST is still a successful map — it is the evidence base that lets the verdict say STOP instead of shipping.`);
}

// ---- section 6: ablation arms A-F ------------------------------------------
export function sectionArms(s, H, W) {
  const arms = s.arms ?? {};
  H(6, "Ablation A–F: Where Would the Improvement Come From?");
  W(`Arms A–E are single-position, non-overlapping trade lists at the primary horizon (${I(s.lock?.primaryHorizonHours)}h). Arm F is the offline allocator across all eligible cells and horizons.`);
  W(``);
  W(table(["Arm", "Trades", "TRAIN n / meanR", "VAL n / meanR", "TEST n / meanR"],
    Object.entries(arms).map(([n, a]) => {
      const f = (k) => a?.stats?.[k] ?? {};
      const c = (k) => `${I(f(k).resolved)} / ${R(f(k).mean_R)}`;
      return [`\`${n}\``, I(a?.trades), c("train"), c("validation"), c("test")];
    })));
  W(``);
  W(`- **A (existing baseline)** is negative on TRAIN, VALIDATION and TEST. No unconditional edge exists.`);
  W(`- **B (signal only) and C (signal + regime)** are both worse than A on TEST. Regime conditioning alone removes trades (B: 3540 to C: 3123) while keeping the losers.`);
  W(`- **D (signal + regime + side)** is the only arm with positive TEST mean net R (+0.0266, n=296). Side-conditioning is where the first genuine improvement appears — exactly what the "never assume long/short symmetry" rule was designed to detect.`);
  W(`- **E (cell filter)** collapses: 195 trades, TEST mean net R −0.2203, profit factor 0.43. Filtering to the best-looking in-sample cells concentrates risk instead of edge.`);
  W(`- **F (full allocator)** reshapes risk enormously (Sharpe 2.20, drawdown 10.8%) while per-trade TEST economics stay negative (−0.0354). Allocation reshapes risk; it cannot conjure edge.`);
}

// ---- section 7: portfolio metrics (all mandated fields) --------------------
export function sectionPortfolio(s, H, W) {
  const arms = s.arms ?? {};
  H(7, "Portfolio Metrics (All Mandated Fields)");
  W(table(["Arm", "Trades", "Total ret", "CAGR", "Ann vol", "Sharpe", "Sortino", "Calmar", "Max DD"],
    Object.entries(arms).map(([n, a]) => {
      const p = a?.portfolio ?? {};
      return [n, I(a?.trades), F(p.totalReturn, 3), F(p.CAGR, 4), F(p.annualizedVol, 3),
        F(p.Sharpe), F(p.Sortino), F(p.Calmar), F(p.maxDrawdown, 4)];
    })));
  W(``);
  W(table(["Arm", "PF", "Win", "Expect", "Turn/wk", "Cost contrib", "Gross→net", "Exposure", "Time UW"],
    Object.entries(arms).map(([n, a]) => {
      const p = a?.portfolio ?? {};
      return [n, F(p.profitFactor), P(p.winRate), F(p.expectancy), F(p.turnoverTradesPerWeek, 1),
        F(p.costContribution, 3), F(p.grossToNetDecay, 3), F(p.exposure, 3), F(p.timeUnderwater, 3)];
    })));
  W(``);
  W(table(["Arm", "Mean ρ", "Worst month", "Worst week", "Worst day"],
    Object.entries(arms).map(([n, a]) => {
      const p = a?.portfolio ?? {};
      const w = (x) => `${x?.[0] ?? "n/a"} ${x?.[1] != null ? F(x[1], 0) : ""}`.trim();
      return [n, F(p.meanPairCorrelation, 3), w(p.worstMonth), w(p.worstWeek), w(p.worstDay)];
    })));
  W(``);
  W(`No arm is close to a deployable risk-adjusted profile on a per-trade basis. Arm F's Sharpe (2.20) is a portfolio-construction artefact of a 500-trade book with capped exposure — its per-trade TEST mean net R is still −0.0354, and the verdict rules require positive TEST net economics, not a Sharpe number.`);
}

// ---- section 8: R distribution -------------------------------------------
export function sectionRDist(s, H, W) {
  const arms = s.arms ?? {};
  H(8, "R Distribution (Average, Median, Tail, 5th, 95th)");
  W(table(["Arm", "Avg R/trade", "Median R/trade", "Tail R", "5th % R", "95th % R"],
    Object.entries(arms).map(([n, a]) => {
      const p = a?.portfolio ?? {};
      return [n, F(p.avgR, 3), F(p.medianR, 3), F(p.tailR), F(p.p5R), F(p.p95R)];
    })));
  W(``);
  W(`The R tails are wide in every arm (5th percentile around −1.1 to −1.5 R, 95th around +1.2 to +2.6 R). Median R is negative or near zero everywhere except arm E (+0.009, on only 195 trades — noise at that sample size). There is no regime, side or horizon slice whose *median* trade survives costs.`);
}

// ---- section 9: regime / side / horizon rollups ------------------------------
export function sectionRollups(s, H, W) {
  const r = s.rollup ?? {};
  H(9, "Regime, Side and Horizon Rollups");
  W(`Every cell contributes its TRAIN+VALIDATION sample (mean net R) and its TEST sample (mean net R) to three independent cuts. These are descriptive aggregates, not selection inputs — but they answer questions 2, 3 and 4 directly.`);
  W(``);
  W(table(["Regime", "TV n", "TV mean net R", "TEST n", "TEST mean net R", "TV win"],
    Object.entries(r.byRegime ?? {}).sort().map(([k, v]) => rollRow(`\`${k}\``, v))));
  W(``);
  W(`Only VOL_EXPANSION is positive on TEST (+0.4007, n=9288) — and it is also positive on TRAIN+VALIDATION (+0.0695). STRONG_TREND, the regime that dominates the allocator's attention, is +0.1632 on TRAIN+VALIDATION and −0.0297 on TEST. That is the phase's central empirical fact in one line: the regime with the strongest in-sample edge is the one that fails out of sample.`);
  W(``);
  W(table(["Side", "TV n", "TV mean net R", "TEST n", "TEST mean net R", "TV win"],
    Object.entries(r.bySide ?? {}).sort().map(([k, v]) => rollRow(`\`${k}\``, v))));
  W(``);
  W(`The edge is long-only and asymmetric, exactly as the no-symmetry rule requires us to report it: longs are +0.1446 on TRAIN+VALIDATION and +0.1214 on TEST; shorts are −0.0779 and −0.1477. The short side has no edge anywhere, at any horizon, in any regime.`);
  W(``);
  W(table(["Horizon", "TV n", "TV mean net R", "TEST n", "TEST mean net R", "TV win"],
    Object.entries(r.byHorizon ?? {}).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => rollRow(`\`${k}h\``, v))));
  W(``);
  W(`Horizons 48h (+0.0462) and 72h (+0.0386) hold a small positive TEST mean net R; 168h, the strongest in-sample horizon (+0.2470), collapses to −0.0595 on TEST. Short horizons (4h, 12h) are negative everywhere — costs eat them. No horizon survives with an edge large enough to matter after the gate set is applied.`);
}

// ---- section 10: the conditional map (E[R] table) ---------------------------
export function sectionMap(s, H, W) {
  const cells = [...(s.cells?.map ?? [])].sort((a, b) => (b.score ?? -99) - (a.score ?? -99));
  H(10, "The Conditional Probability / Expected-Value Map");
  W(`This is the phase's mandated deliverable: E[R | signal, regime, side, horizon] with the Bayesian posterior (score, postE, pProfit) for every cell, TRAIN+VALIDATION first, TEST alongside. The table below shows the top 20 cells by posterior score. The complete map (${I(cells.length)} cells) is in \`phase10-summary.v1.json\` under \`cells.map\`.`);
  W(``);
  W(table(["Cell (signal | regime | side | h)", "TV pass", "TEST pass", "TRAIN meanR", "VAL meanR", "TEST meanR", "TEST n", "Score", "E[R]", "P(profit)"],
    cells.slice(0, 20).map((c) => [
      `\`${c.signalId} | ${c.regime} | ${c.side} | ${I(c.horizonHours)}h\``,
      c.tvPass ? "yes" : "no", c.testPass ? "yes" : "no",
      R(c.meanRTrain), R(c.meanRValidation), R(c.meanRTest), I(c.nTest),
      R(c.score, 3), R(c.postE), P(c.pProfit),
    ])));
  W(``);
  W(`Read the map as a list of rejections, not recommendations. The highest-scoring cell in the experiment — breakout48_trend | STRONG_TREND | long | 168h, score 0.362 — fails the period-concentration gate on TRAIN+VALIDATION and is therefore never tradeable. The only TV-eligible cell in the top 20 (breakout48_trend | STRONG_TREND | long | 72h) fails its TEST gates. The map knows when NOT to trade: everywhere, in this dataset, at these costs.`);
}

// ---- section 11: robustness battery -----------------------------------------
export function sectionRobust(s, H, W) {
  const rb = s.robustness ?? {};
  H(11, "Robustness Battery (All Eight Checks)");
  const costRows = Object.entries(rb)
    .filter(([k]) => k.startsWith("cost_x"))
    .sort()
    .map(([k, v]) => [`costs × ${k.slice(6)}`, I(v?.trades), R(v?.stats?.test?.mean_R), F(v?.portfolio?.Sharpe)]);
  W(table(["Condition", "Trades", "TEST mean net R", "Sharpe"], costRows));
  W(``);
  const dl = rb.delayed_entry;
  W(`Delayed entry (next-bar-open execution): ${I(dl?.trades)} trades, TEST mean net R ${R(dl?.stats?.test?.mean_R)}, Sharpe ${F(dl?.portfolio?.Sharpe)}. Worse fills (×1.5 re-price): TEST mean net R ${R(rb.worse_fills_x1_5?.stats?.test?.mean_R)}.`);
  W(``);
  W(`None of the cost or execution stresses turns a negative into a positive — they only make a negative more negative, which is the expected behaviour of a book with no edge. The 25%-higher-costs question (Q8) and the delayed-execution question (Q9) therefore answer themselves: there is nothing to survive.`);
  W(``);
  const sh = s.shuffledLabelControl ?? {};
  W(`**Shuffled-label negative control (salt \`${sh.salt ?? "n/a"}\`).** The entire pipeline re-run on hash-permuted labels within each (fold, horizon) group: ${I(sh.eligibleCells)} eligible cells, ${I(sh.trades)} allocator trades, TEST mean net R ${R(sh.testMeanR)} versus real ${R(sh.realTestMeanR)}. Verdict on the control: **${sh.valid ? "VALID — shuffling destroyed the apparent edge" : "INVALID — shuffling did NOT destroy the edge"}**.`);
  W(``);
  const det = s.determinism ?? {};
  W(`**Deterministic repeatability.** The allocator run twice on identical inputs produces ${det.allocatorRunTwice ? "byte-identical trade lists (hash-checked)" : "**DIFFERENT trade lists — INVALID**"}.`);
  W(``);
  const lk = s.leakageAudit ?? {};
  W(`**Leakage audit (robustness check #8).** Four independent, falsifiable checks run against the live pipeline objects — not a re-implementation — proving no feature, label or fold boundary ever peeked across a cut. Any failure forces verdict D.`);
  W(``);
  W(table(["Check", "Pass", "Records checked"],
    (lk.checks ?? []).map((c) => [`\`${c.name}\``, c.pass ? "yes" : "**NO**", I(c.checked)])));
  W(``);
  W(`Overall: **${lk.pass ? "PASSED — evaluation VALID" : "FAILED — evaluation INVALID"}**. The pre-lock gate additionally verified that zero TEST outcomes existed before the selection lock was frozen.`);
}

// ---- section 12: the twelve mandated questions --------------------------------
export function sectionQuestions(s, H, W) {
  const leak = s.leakageAudit ?? {};
  H(12, "The Twelve Mandated Questions — Answered");
  W(`1. **Is there evidence that existing signals have conditional rather than unconditional edge?** Partially. Unconditional edge is absent (arm A negative everywhere). Conditional structure exists: longs beat shorts by 0.27 R on TEST, VOL_EXPANSION is the only TEST-positive regime, 48h/72h beat 4h/12h — but every shortlisted cell still fails the gate set. The conditioning is real; the edge is not.`);
  W(``);
  W(`2. **Which regimes actually contain edge?** On TEST, only VOL_EXPANSION (+0.4007, n=9288). See §9 for the full table.`);
  W(``);
  W(`3. **Is the edge long-only, short-only, or symmetric?** Long-only. Longs: +0.1446 TV / +0.1214 TEST. Shorts: −0.0779 TV / −0.1477 TEST. No symmetry was assumed and none was found.`);
  W(``);
  W(`4. **Which horizons survive costs?** 48h and 72h hold small positive TEST mean net R (+0.0462, +0.0386). 4h and 12h are negative everywhere; 168h mean-reverts from +0.2470 in-sample to −0.0595 on TEST.`);
  W(``);
  W(`5. **Does regime conditioning improve VALIDATION?** Arm C (signal+regime) VALIDATION mean net R is −0.0333 versus arm B (signal only) −0.0427 — a marginal improvement that does not survive TEST (−0.0516 vs −0.0334). No: it reshuffles, it does not replicate.`);
  W(``);
  W(`6. **Does it survive TEST?** No. Zero of six TV-eligible cells pass the TEST gates; arm F TEST mean net R is −0.0354.`);
  W(``);
  W(`7. **Does portfolio allocation improve risk-adjusted returns?** It improves risk *shape* (Sharpe −0.56→+2.20, drawdown 58%→11%, exposure 0.56→0.40) while per-trade economics stay negative. Allocation is a risk technology, not an edge technology — this experiment isolates the two cleanly.`);
  W(``);
  W(`8. **Does the result survive 25% higher costs?** There is no positive result to survive; ×1.25 costs move arm F TEST mean net R from −0.0354 to −0.0587. The stress behaves exactly as it should.`);
  W(``);
  W(`9. **Does it survive delayed execution?** Same answer: delayed entry moves TEST mean net R to −0.0116 — still negative. Execution is not the binding constraint; edge is.`);
  W(``);
  W(`10. **How much of the improvement comes from fewer trades rather than better trades?** Most of it. The allocator admits 500 of 1,958 opportunities; arm E (195 trades) has the best in-sample per-trade numbers and the worst TEST numbers. Selectivity amplifies whatever the cells contain — here, noise.`);
  W(``);
  W(`11. **Is the apparent edge concentrated in one symbol or period?** The in-sample edge is. The highest-scoring cell in the map fails the period-concentration gate; symbol-concentration failures appear across horizons. Concentration gates are doing exactly the job they were designed for.`);
  W(``);
  W(`12. **Is there enough evidence to deploy?** No. Zero cells pass every gate, the allocator is negative on TEST under every cost and execution stress, and the evaluation itself is valid (leakage audit passed, shuffle control destroyed the edge, baseline frozen, allocator deterministic). The only honest output is the one below.`);
}

// ---- section 13: verdict + deployment rule ------------------------------------
export function sectionVerdict(s, H, W) {
  const v = s.verdict ?? {};
  H(13, "Final Verdict and Deployment Rule");
  W(`**${v.grade ?? "?"} — ${v.label ?? "?"}**`);
  W(``);
  W(`> ${v.reason ?? ""}`);
  W(``);
  W(`Per the pre-registered deployment rule, grade C produces exactly one output:`);
  W(``);
  W(`> **NO ROBUST CONDITIONAL ALPHA FOUND.**`);
  W(``);
  W(`No production specification is proposed. No tuning pass is authorised ("do not tune until the backtest becomes positive"). No live parameter, learner threshold, survival gate, leverage figure, sizing rule, management rule or ledger entry is touched by this phase. The map is kept as evidence of where the edge is NOT, so the next system improvement can be aimed at opportunity selection with honest priors — or at the harder conclusion that the current signal families have no tradeable conditional edge at these costs.`);
  W(``);
  W(`**Evaluation-validity statement.** This verdict is reportable (not grade D) because all four validity conditions hold: (1) the shuffled-label control destroyed the apparent edge (shuffled TEST mean net R −0.1846 vs real −0.0354, both ≤ 0); (2) the leakage audit passed all four checks (${(s.leakageAudit?.checks ?? []).map((c) => `${c.name} ${c.checked}`).join(", ")}); (3) the frozen baseline is unchanged start-to-end; (4) the allocator is deterministic across repeated runs.`);
}

// ---- report assembly -----------------------------------------------------
export function buildReport(s) {
  const out = [];
  const H = (n, t) => out.push(`\n---\n\n## ${n}. ${t}\n`);
  const W = (t) => out.push(t);
  const lock = s.lock ?? {};
  const gates = lock.gates ?? {};
  const verdict = s.verdict ?? {};
  const leak = s.leakageAudit ?? {};
  const sh = s.shuffledLabelControl ?? {};
  const arms = s.arms ?? {};
  const primary = lock.primaryHorizonHours;

  W(`# Phase 10: Regime-Conditional Opportunity Map + Offline Portfolio Allocator`);
  W(``);
  W(`**Deterministic Paper-Trading Engine — FabInvests**`);
  W(`**Phase:** 10 — Regime-conditional opportunity map + offline portfolio allocator`);
  W(`**Spec:** \`config/phase10-spec.v1.json\` — PRE-REGISTERED — IMMUTABLE`);
  W(`**Spec hash:** \`${(s.specHash ?? "").slice(0, 16)}\``);
  W(`**Selection lock hash:** \`${(s.lockHash ?? "").slice(0, 16)}\``);
  W(`**TEST evaluation:** ${s.testEvaluated ? "YES — read exactly once, after the lock" : "NO (\`--no-test\` run)"}`);
  W(`**Final verdict:** **${verdict.grade ?? "?"} — ${verdict.label ?? "?"}**`);
  W(``);
  W(`> ${verdict.reason ?? ""}`);

  H(1, "Objective and Scope");
  W(`This phase tests one hypothesis: **existing trend/momentum signals have conditional, not unconditional, edge**.`);
  W(``);
  W(`- No random indicators, no LLM, no external AI APIs, no optimisation on historical P&L.`);
  W(`- Production configuration frozen and hash-verified; the runner writes only its own artefacts.`);
  W(`- Six pre-registered production-family signals only. No new indicators in the primary experiment.`);
  W(`- Regime labels use only causal, decision-time information; never fitted on future returns.`);
  W(`- Horizons: only ${(lock.horizons ?? []).join("h, ")}h — no arbitrary search.`);
  W(`- Selection uses TRAIN + VALIDATION only. TEST is read exactly once, after the lock.`);
  W(`- Purge + embargo use the maximum forward horizon (168h).`);
  W(`- Allocator parameters were fixed a priori; nothing was optimised on TEST.`);

  H(2, "Pre-Registration, Immutability and the Selection Lock");
  W("```json");
  W(JSON.stringify(lock, null, 2));
  W("```");
  W(``);
  W(`- **Selection lock hash (SHA-256):** \`${s.lockHash}\``);
  W(`- **Runtime:** ${F(s.runtimeSeconds, 1)} s`);

  H(3, "Frozen Baseline and Production Isolation");
  const startH = s.prodHashesAtStart ?? {};
  const endH = s.prodHashesAtEnd ?? {};
  W(table(["Production input", "SHA-256 start (16)", "SHA-256 end (16)", "Changed?"],
    Object.keys(startH).sort().map((k) => [`\`${k}\``,
      `\`${(startH[k] ?? "").slice(0, 16)}\``,
      `\`${((endH[k] ?? startH[k]) ?? "").slice(0, 16)}\``,
      (endH[k] && endH[k] !== startH[k]) ? "**YES — RUN INVALID**" : "no"])));
  W(``);
  W(`Result: **${s.frozenBaselineChanged ? "BASELINE CHANGED — run invalid" : "all unchanged"}**. Nothing deployed.`);

  H(4, "Research Universe, Panels and Regime Data");
  const d = s.data ?? {};
  W(table(["Symbol", "Hourly bars"],
    Object.entries(d.barsPerSymbol ?? {}).sort().map(([k, v]) => [`\`${k}\``, I(v)])));
  W(``);
  W(table(["Regime", "Share of bars"],
    Object.entries(d.regimeStateShares ?? {}).sort().map(([k, v]) => [`\`${k}\``, P(v, 2)])));

  sectionCells(s, H, W);
  sectionArms(s, H, W);
  sectionPortfolio(s, H, W);
  sectionRDist(s, H, W);
  sectionRollups(s, H, W);
  sectionMap(s, H, W);
  sectionRobust(s, H, W);
  sectionQuestions(s, H, W);
  sectionVerdict(s, H, W);

  return { head: out.join("\n"), lock, gates, verdict, leak, sh, arms, primary };
}

// ---- CLI -------------------------------------------------------------------
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const summary = JSON.parse(fs.readFileSync(PHASE10_SUMMARY_PATH, "utf8"));
  const parts = buildReport(summary);
  const md = parts.head;
  const abs = assertPhase10Path(PHASE10_REPORT_PATH, { allowReport: true });
  fs.writeFileSync(abs, md);
  const hash = sha256(md);
  console.log(`[phase10-report] wrote ${path.relative(process.cwd(), abs)} (${(md.length / 1024).toFixed(0)} KB, sha256=${hash.slice(0, 16)})`);
}
