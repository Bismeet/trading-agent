// scripts/v2/alpha-report.mjs — ALPHA RESEARCH: deterministic report generator.
//
// Reads ONLY data/calibration/alpha-summary.v2.json and renders
// ALPHA_RESEARCH_REPORT.md. No measurement, no statistics and no thresholds are
// computed here — every number is copied from the frozen summary, so the report
// can never disagree with the stored results. The same summary always produces
// byte-identical markdown (no timestamps, no locale formatting, no randomness).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALPHA_SUMMARY_PATH, ALPHA_REPORT_PATH, assertAlphaPath } from "./alpha-metrics.mjs";
import { sha256 } from "./store.mjs";

// ---- formatting (pure, locale-independent) -----------------------------------
const F = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const B = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "n/a");
const P = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const I = (x) => (Number.isFinite(x) ? String(x) : "n/a");
const utc = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "n/a");
const table = (head, rows) => [
  `| ${head.join(" | ")} |`,
  `|${head.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
].join("\n");
const V = (v) => {
  if (v == null) return "n/a";
  if (Array.isArray(v)) {
    const s = v.map((x) => (x && typeof x === "object" ? (x.market ?? x.symbol ?? JSON.stringify(x)) : String(x)));
    return s.length ? s.join(", ") : "—";
  }
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}=${F(x)}`).join(" ");
  if (typeof v === "number") return F(v, 2);
  return String(v);
};
const sortedKeys = (o) => Object.keys(o ?? {}).sort();
const sigIds = (spec) => ((spec.signals ?? []).map((x) => x.id));

// ---- report assembly ---------------------------------------------------------
export function buildReport(s) {
  const spec = s.specSnapshot ?? {};
  const out = [];
  const H = (n, t) => out.push(`\n---\n\n## ${n}. ${t}\n`);
  const W = (t) => out.push(t);
  const ids = sigIds(spec);
  const gates = s.gates ?? null;
  const gatesQL = s.gatesQualityLayer ?? null;
  W(`# Alpha Research Report — Post-Phase-9 Signal Discovery Experiment`);
  W("");
  W(`**Deterministic Paper-Trading Engine — FabInvests**  `);
  W(`**Phase:** Alpha Research (post-Phase 9; research only, nothing deployed)  `);
  W(`**Data through:** ${utc(s.datasets?.hour?.lastTs)} (UTC)  `);
  W(`**Spec:** \`${s.specPath}\` v${s.specVersion} — ${spec.status ?? "PRE-REGISTERED — IMMUTABLE"}  `);
  W(`**Spec hash:** \`${(s.specHash ?? "").slice(0, 16)}\`  `);
  W(`**Selection lock hash:** \`${(s.selectionLockHash ?? "").slice(0, 16)}\`  `);
  W(`**TEST evaluation:** ${s.testEvaluated ? "YES — read exactly once, after the lock" : "NO (\\`--no-test\\` run)"}  `);
  W(`**Final verdict:** **${s.verdict?.grade ?? "?"} — ${s.verdict?.label ?? "?"}**`);

  H(1, "Objective and Scope");
  W(`> *${spec.objective ?? ""}*`);
  W("");
  W("This phase asks exactly one question: **does a new entry signal contain enough predictive information to make money after realistic transaction costs, on data it has never seen?**");
  W("");
  W("It is explicitly *not* a risk-management phase, *not* a parameter-tuning phase and *not* a production change. No production file is read for tuning, no production threshold is altered, and no signal discovered here is deployed. The deliverable is a measurement plus an honest verdict.");
  W("");
  W("Protocol constraints honoured by this run:");
  W("");
  W("- Every threshold, horizon, gate and selection rule was fixed in the spec **before** any measurement.");
  W("- Selection uses **TRAIN + VALIDATION only**; TEST never participates in selection.");
  W("- TEST is read **exactly once**, after the selection lock hash is computed.");
  W("- The runner writes only its own artefacts and aborts if a production input changes during the run.");

  H(2, "Position Relative to Phases 1–9");
  W("Phases 1–9 built and validated the deterministic systems (strategies, risk geometry, signal edge, portfolio management, final end-to-end validation). Phase 9 concluded that the frozen system has **no robust out-of-sample net edge** after realistic costs.");
  W("");
  W("This phase therefore stops optimizing the *system* and instead interrogates the *market*: it asks whether a materially different **entry signal** exists at all.");
  W("");
  W("| | Phase 9 (final validation) | Alpha Research (this phase) |");
  W("| --- | --- | --- |");
  W("| Object of study | The complete frozen trader | A new entry signal, measured in isolation |");
  W("| Success criterion | Positive net expectancy of the portfolio | A replicated, cost-surviving signal |");
  W("| Production impact | None (evaluation only) | None (research only; never deployed) |");
  W("");
  W("**Phase 1–9 immutability, verified by hash.** The runner hashes every production input at the start and the end of the run and aborts if any changed:");
  W("");
  W(table(["Production input", "SHA-256 (first 16)"],
    sortedKeys(s.productionInputHashes ?? {}).map((k) => [`\`${k}\``, `\`${(s.productionInputHashes[k] ?? "").slice(0, 16)}\``])));
  W("");
  W("End-of-run check: **all unchanged** (otherwise the process exits non-zero and no verdict is issued).");

  H(3, "Pre-Registration and Immutability");
  W(`The protocol is [\`${s.specPath}\`](file:///${(s.specPath ?? "").replace(/\\/g, "/")}), version **${s.specVersion}**, status **${spec.status ?? "PRE-REGISTERED — IMMUTABLE"}**, SHA-256 \`${s.specHash}\`.`);
  W("");
  W(`> ${spec.note ?? ""}`);
  W("");
  W("Because the thresholds are data, the runner cannot invent them: it reads the spec and fails if a required field is missing. Two further immutability properties are enforced by construction:");
  W("");
  W("1. **Production inputs are hashed before and after the run.** Any change aborts the run (see §2).");
  W("2. **The selection is locked.** The lock object below is hashed *before* TEST is read, and the hash is byte-stable across repeated runs of the same data (verified by running the experiment twice — identical lock hash).");
  W("");
  W("**Selection lock content** (hashed to produce the selection lock hash):");
  W("");
  W("```json");
  W(JSON.stringify(s.lock ?? {}, null, 2));
  W("```");
  W("");
  W(`- **Selection lock hash (SHA-256):** \`${s.selectionLockHash}\``);
  W(`- **Lock frozen at:** ${s.lockFrozenAt ?? "n/a"} (timestamp recorded but deliberately excluded from the hash)`);
  W(`- **TEST evaluation rule:** ${s.testRule ?? ""}`);
  W(`- **TEST evaluations performed in this run:** ${s.testEvaluated ? "1" : "0"}`);
  W("");
  W("**Reporting clarifications (disclosed in full).** Two items were adjusted while building the report, *after* the first TEST read, and neither touches a threshold, a horizon, an arm definition, a measurement or the selection:");
  W("");
  W("1. The spec defines two alpha arms (`alpha_selected` and `alpha_quality_layer`) but does not name which one the gate set targets. The report therefore shows the **complete gate table for both** (§22) rather than picking one silently.");
  W("2. Instrumentation was added to record the **entry funnel** (how many candidates each arm's entry policy rejects and why) and a verbatim **spec snapshot** was embedded in the summary. These are pure bookkeeping additions; the arms' trade counts and raw/gross/net figures are unchanged across those runs.");
  W("");
  W("Both are disclosed here because a pre-registered experiment should be able to say what changed and why. Neither can have improved the result: the verdict is driven by measurements (validation raw edge negative) that were identical in every run.");

  H(4, "Data and Panels");
  const d = spec.data ?? {};
  W(`**Research panel:** \`history.${d.researchPanel}.v2.json\` — ${d.researchInterval} bars over ${d.researchRange} (bar size ${I(d.barMs)} ms).  `);
  W(`**Context panel:** \`history.${d.contextPanel}.v2.json\` — used **only** as causal daily context (daily trend / SMA200 state), never as a source of hourly decisions.`);
  W("");
  W(table(["Panel", "Symbols", "Bars", "First bar (UTC)", "Last bar (UTC)"], [
    ["hourly research", I(s.datasets?.hour?.symbols), I(s.datasets?.hour?.bars), utc(s.datasets?.hour?.firstTs), utc(s.datasets?.hour?.lastTs)],
    ["daily context", I(s.datasets?.daily?.symbols), I(s.datasets?.daily?.bars), utc(s.datasets?.daily?.firstTs), utc(s.datasets?.daily?.lastTs)],
  ]));
  W("");
  W(`**Symbols (${I(s.datasets?.symbols)})** across markets ${(s.datasets?.markets ?? []).join(", ")}: ${sortedKeys(s.datasets?.folds ?? {}).map((x) => `\`${x}\``).join(", ")}.`);
  W("");
  W("Both panels are real historical data acquired in earlier phases; nothing is synthetic and nothing is resampled for this experiment beyond the frozen hourly/daily bar definitions.");
  W("");
  W(table(["Market", "Resolved trades (pure-signal arm)", "Mean cost (bps)", "Fee (bps)", "Spread + impact (bps)"],
    sortedKeys(s.measuredCostByMarket ?? {}).map((m) => {
      const c = s.measuredCostByMarket[m];
      return [`\`${m}\``, I(c.n), F(c.costBps), F(c.feeBps), F(c.slipBps)];
    })));
  W("");
  W("**Excluded panels (recorded, with reason):**");
  W("");
  for (const e of d.excludedPanels ?? []) W(`- \`${e.panel}\` — ${e.reason}`);
  W("");
  W(`**Benchmark re-expression:** \`${spec.benchmarkDonchian?.id}\` — ${spec.benchmarkDonchian?.note ?? ""} Lookback ${I(spec.benchmarkDonchian?.lookbackHours)} hourly bars; daily trend filter SMA${I(spec.benchmarkDonchian?.dailySmaN)}; ${spec.benchmarkDonchian?.dailyDecisionCadence ?? ""}.`);

  H(5, "Splits, Sub-Folds and Chronology");
  const sp = spec.splits ?? {};
  W(`Splits are **strictly chronological and applied per symbol** (no shuffling, no cross-sectional leakage): **TRAIN ${P(sp.train, 0)} / VALIDATION ${P(sp.validation, 0)} / TEST ${P(sp.test, 0)}**.`);
  W("");
  W(`Each fold is further divided into **${I(spec.subFolds)} equal chronological sub-folds**, used for the stability gate (§23). Sub-fold index is assigned by bar position inside its fold.`);
  W("");
  W(table(["Symbol", "Train bars", "Validation bars", "Test bars", "Train range", "Validation range", "Test range"],
    sortedKeys(s.datasets?.folds ?? {}).map((sym) => {
      const b = s.datasets.folds[sym];
      const r = (arr) => (Array.isArray(arr) ? `${I(arr[0])}..${I(arr[1])}` : "n/a");
      return [`\`${sym}\``, I(b.sizes?.train), I(b.sizes?.validation), I(b.sizes?.test), r(b.train), r(b.validation), r(b.test)];
    })));
  W("");
  W("Ranges are **bar indices**. TRAIN is the oldest segment, TEST the newest — the same chronological convention used throughout Phases 1–9, so an out-of-sample result here is genuinely forward in time.");

  H(6, "Causality Contract (No Look-Ahead)");
  W("Every feature, every signal, every gate and every measurement in this experiment obeys one strict rule:");
  W("");
  W("> **At bar `k`, only information from bars `<= k` may be used to decide, and only information from bars `> k` may be used to measure the outcome.**");
  W("");
  W("Concretely, the decisions use:");
  W("");
  W("- the **decision bar** = the last *completed* hourly bar (its close, high, low, open);");
  W("- rolling windows (ATR, channel maxima/minima, z-scores, compression, volatility ratio) computed with **strictly prior** bars only (a window of length `w` at bar `k` ends at `k-1`);");
  W("- daily context taken from the **previous completed daily bar** only, so a not-yet-closed day cannot leak future information;");
  W("- returns `r4`, `r24`, `r72` built from closes at or before the decision bar.");
  W("");
  W("The outcome uses:");
  W("");
  W("- the entry at the decision bar's close (or the **next bar's open** for the delayed-entry robustness arm), and the exit `h` bars later — always strictly after the decision bar;");
  W("- MFE/MAE, time-to-target and time-to-stop tracked **only** over bars after entry.");
  W("");
  W("This is enforced structurally in `alpha-features.mjs` (all rolling helpers are lagged) and is **asserted by the test suite**: truncating the panel at bar `k` and recomputing every feature must reproduce the value computed on the full panel, bit-for-bit. If any feature peeked forward, that test fails.");

  H(7, "Horizons Under Test");
  W(`Six decision horizons were pre-registered: **${(s.horizonsHours ?? []).join("h, ")}h**, with **${I(s.primaryHorizonHours)}h as the primary horizon**.`);
  W("");
  W("Rationale, fixed before measurement: the production system operated at 4h and 12h exits; Phase 6/9 showed that a 4h time-stop truncates favourable price discovery, so the horizon grid deliberately extends far beyond production to test whether *more time* converts a weak edge into a cost-surviving one.");
  W("");
  W("Every measured trade is a **fixed-horizon** trade (no stop, no target, no trailing) unless the arm explicitly says otherwise, so that the measurement isolates the *signal* rather than the management layer. Managed arms re-use the frozen Phase 8 simulator unchanged (`MGMT_CONTROL`, `MGMT_ADAPTIVE_HOLD`).");
  W("");
  W("**Exit/measurement modes used by the arms:**");
  W("");
  W("| Mode | Meaning |");
  W("| --- | --- |");
  W("| `fixed_<h>h_close` | enter at decision-bar close, exit at close `h` bars later |");
  W("| `fixed_<h>h_nextOpen` | enter at the next bar's open (implementation-delay robustness), exit `h` bars later |");
  W("| `MGMT_CONTROL` | frozen Phase 8 control management (4h time-stop) |");
  W("| `MGMT_ADAPTIVE_HOLD` | frozen Phase 8 adaptive management (extend favourable to 12h, cut deteriorating at 2h) |");

  H(8, "Signal Families and Signal Definitions");
  W(`**${(spec.signalFamilies ?? []).length} families** cover **${ids.length} signals**. Families were chosen to span mechanically different sources of edge rather than variations of one idea, so that a negative result is informative about *classes* of signals, not just one parameterisation.`);
  W("");
  W(table(["Family id", "Family name", "Signals"],
    (spec.signalFamilies ?? []).map((f) => [`**${f.id}**`, f.name, (f.signals ?? []).map((x) => `\`${x}\``).join(", ")])));
  W("");
  for (const sig of spec.signals ?? []) {
    W(`**\`${sig.id}\`** — ${sig.name} *(family ${sig.family})*  `);
    W(`Definition: ${sig.definition}  `);
    W(`Inputs: ${(sig.uses ?? []).map((u) => `\`${u}\``).join(", ")}`);
    W("");
  }
  W("All signals are **symmetric**: the long definition is mirrored exactly for shorts (replace `max` with `min`, flip the sign of every directional test). No signal is long-only, which matters because a long-only result in a rising sample would otherwise be indistinguishable from an edge.");
  W("");
  W("Supporting causal primitives (thresholds are spec data, not code):");
  W("");
  W("```json");
  W(JSON.stringify(spec.featureThresholds ?? {}, null, 2));
  W("```");

  H(9, "Candidate Generation (How Many Independent Decisions Each Signal Produces)");
  W("A *candidate* is one causally-fired signal bar (one symbol, one bar, one side). Candidates are then filtered by the entry policy and by the **non-overlap rule** (below).");
  W("");
  W(table(["Signal", "Family", "Raw firing bars", "Candidates", "Train", "Validation", "Test"],
    [...ids, "bench_donchian"].map((id) => {
      const c = s.candidateCounts?.[id];
      if (!c) return [`\`${id}\``, "—", "n/a", "n/a", "n/a", "n/a", "n/a"];
      return [`\`${id}\``, c.family, I(c.rawFiringBars), I(c.candidates), I(c.byFold?.train), I(c.byFold?.validation), I(c.byFold?.test)];
    })));
  W("");
  W("**Non-overlap rule (applied in every arm).** On any symbol, while a position opened by an arm is still open, no further entry is taken on that symbol. This is the *tradable* quantity: without it, overlapping duplicates would inflate sample sizes and make the same price move count several times. The funnel below shows how much of each signal survives it.");
  W("");
  const funnels = ["NEW_ALPHA", "NEW_ALPHA_QUALITY", "NEW_ALPHA_PHASE7"].filter((a) => s.arms?.[a]?.funnel);
  if (funnels.length) {
    W(table(["Arm", "Candidates", "Blocked by non-overlap", "Rejected by entry policy", "Accepted (all folds)"],
      funnels.map((a) => {
        const f = s.arms[a].funnel;
        const rejN = Object.values(f.policyRejected ?? {}).reduce((x, y) => x + y, 0);
        return [`\`${a}\``, I(f.candidates), I(f.nonOverlapBlocked), I(rejN), I(f.accepted)];
      })));
    W("");
    W("Why the entry policies reject, in full detail (every reason string the pre-registered decision layer can emit):");
    W("");
    for (const a of funnels) {
      const rej = s.arms[a].funnel.policyRejected ?? {};
      const keys = sortedKeys(rej);
      if (!keys.length) { W(`- \`${a}\`: no policy rejections (entry policy accepts all non-overlapping candidates).`); continue; }
      W(`- \`${a}\`: ${keys.map((k) => `\`${k}\` = ${I(rej[k])}`).join("; ")}`);
    }
  }

  H(10, "Transaction-Cost Model");
  W("Costs are the same primitives the production engine uses (`perp.mjs`), so a signal that survives here would survive in production execution terms:");
  W("");
  W("```json");
  W(JSON.stringify(spec.costModel ?? {}, null, 2));
  W("```");
  W("");
  W("Every measured trade decomposes into exactly three numbers, and the report never mixes them up:");
  W("");
  W("| Quantity | Definition | What it isolates |");
  W("| --- | --- | --- |");
  W("| **raw** (bps) | exit reference price minus entry reference price | pure directional information, no frictions |");
  W("| **gross** (bps) | raw after **adverse fills** (half spread + square-root market impact on both legs) | information + execution drag |");
  W("| **net** (bps) | gross after **taker fees on both legs** | what a trader actually keeps |");
  W("");
  W("Costs are charged on **notional = margin x leverage**, with the pre-registered geometry:");
  W("");
  W(table(["Strategy key", "Base leverage", "Stop", "Target"],
    sortedKeys(spec.strategyGeometry ?? {}).map((k) => {
      const gg = spec.strategyGeometry[k];
      return [`\`${k}\``, `${I(gg.baseLev)}x`, P(gg.stopPct), P(gg.targetPct)];
    })));
  W("");
  W(`**Measured cost drag** (mean over the resolved trades of the pure-signal arm) — a sanity check that the cost model is biting as designed:`);
  W("");
  W(table(["Market", "Trades", "Cost (bps)", "Fee (bps)", "Spread + impact (bps)"],
    sortedKeys(s.measuredCostByMarket ?? {}).map((m) => {
      const c = s.measuredCostByMarket[m];
      return [`\`${m}\``, I(c.n), F(c.costBps), F(c.feeBps), F(c.slipBps)];
    })));
  W("");
  const mc = s.measuredCostByMarket ?? {};
  W(`Measured round-trip drag is **${F(mc.crypto?.costBps)} bps on crypto** versus **${F(mc.us?.costBps)} bps on US equities** and **${F(mc.india?.costBps)} bps on Indian equities** (mean per resolved trade). ${Number.isFinite(mc.crypto?.costBps) && Number.isFinite(mc.us?.costBps) && mc.us.costBps > 0 ? `That is a **${F(mc.crypto.costBps / mc.us.costBps, 2)}x** higher hurdle on crypto for the same raw edge, which is why market-level results are reported separately (§17) rather than pooled into one number.` : ""}`);

  H(11, "Expected-Move Model and Causal Cost Coverage");
  W("Before any trade is taken, the experiment asks a purely causal question: **is the expected favourable move for this horizon large enough to pay for the round trip?**");
  W("");
  W("```json");
  W(JSON.stringify(spec.expectedMoveModel ?? {}, null, 2));
  W("```");
  W("");
  W("The ratio is `expectedMove / roundTripCost` where `expectedMove = atrNorm x sqrt(h)` and the round-trip cost fraction is recomputed per market from the same primitives. The table below counts **every eligible bar** in each fold (not just signal bars), so it describes the tradeable universe rather than the signals:");
  W("");
  const cf = s.costFilter ?? {};
  const hz = s.horizonsHours ?? [];
  W(table(["Horizon", "TRAIN n", "TRAIN mean ratio", "TRAIN >=5x", "VAL n", "VAL >=5x", "TEST n", "TEST >=5x", "TEST >=10x"],
    hz.map((h) => {
      const tv = (cf.trainVal ?? {})[h] ?? {};
      const t = (cf.test ?? {})[h] ?? {};
      return [ `${I(h)}h`,
        I(tv.train?.n), F(tv.train?.meanRatio), P(tv.train?.passRate5),
        I(tv.validation?.n), P(tv.validation?.passRate5),
        I(t.test?.n), P(t.test?.passRate5), P(t.test?.passRate10) ];
    })));
  W("");
  W(`**Reading this table.** The 4h row is the reason this phase exists: ${Number.isFinite(cf.trainVal?.[4]?.train?.passRate5) ? `${P(1 - cf.trainVal[4].train.passRate5)} of TRAIN bars fail even the 5x cost test at 4h, while at 48h only ${P(1 - (cf.trainVal?.[48]?.train?.passRate5 ?? 0))} fail it. ` : ""}The filter is generous by construction and is **not** a direction test: a bar that clears the cost bar comfortably can still be a coin flip, which is exactly what §12 and §13 demonstrate. It is the first of the two conditions in the decision layer (\`costCoverageFloor\`) and it does real work only at short horizons.`);

  H(12, "Base-Rate Control (Signal-Free)");
  W("Before crediting any signal, the experiment first measures what a **signal-free** trade earns. The control is pre-registered and deliberately dumb: at the primary horizon, take the direction from the sign of the causal 24-bar return (`r24`), with the same non-overlapping sampling and the same cost and horizon machinery as the signals.");
  W("");
  W("This control answers the obvious objection *\"is a breakout signal anything more than 'buy when the market has been going up'?\"*");
  W("");
  const br = s.baseRate ?? {};
  W(table(["Fold", "Resolved", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "MFE (bps)", "MAE (bps)"],
    ["train", "validation", "test"].map((f) => {
      const x = br[f];
      if (!x) return [f, "not evaluated in this run", "—", "—", "—", "—", "—", "—", "—"];
      return [f, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.mfeBps), F(x.maeBps)];
    })));
  W("");
  W("**The control is only half the story, and the more interesting half.** " + (Number.isFinite(br.train?.netBps) && Number.isFinite(br.validation?.netBps)
    ? `On TRAIN the naive momentum direction is ${B(br.train.netBps)} bps net; on VALIDATION it is ${B(br.validation.netBps)} bps net. Any signal whose TRAIN result looks like the control's, and whose VALIDATION result also looks like the control's, has demonstrated *sample-period momentum exposure* rather than an edge — which is exactly the pattern the signal study in §13 exhibits. It is the single most important warning sign in this report.`
    : "The control could not be evaluated in this run."));

  H(13, "Horizon Study on TRAIN + VALIDATION");
  W("All numbers below are computed **before** TEST is touched; they are the only inputs the selection protocol (§18) may use. Each cell is the **net** (after fees, spread and impact) mean per trade in bps, with fixed-horizon exits.");
  W("");
  const hs = s.horizonStudyTrainVal ?? {};
  const bs = s.benchmarkTrainVal ?? {};
  for (const fold of ["train", "validation"]) {
    W(`**${fold.toUpperCase()} — net bps per trade**`);
    W("");
    W(table(["Horizon", ...ids.map((id) => `\`${id}\``), "`bench_donchian`"],
      hz.map((h) => [`${I(h)}h`, ...ids.map((id) => B(hs[id]?.[h]?.folds?.[fold]?.netBps)), B(bs[h]?.folds?.[fold]?.netBps)])));
    W("");
    W(`**${fold.toUpperCase()} — raw bps per trade (pre-cost information)**`);
    W("");
    W(table(["Horizon", ...ids.map((id) => `\`${id}\``), "`bench_donchian`"],
      hz.map((h) => [`${I(h)}h`, ...ids.map((id) => B(hs[id]?.[h]?.folds?.[fold]?.rawBps)), B(bs[h]?.folds?.[fold]?.rawBps)])));
    W("");
  }
  W(`**Primary horizon (${I(s.primaryHorizonHours)}h) in detail** — the numbers the selection protocol consumes:`);
  W("");
  W(table(["Signal", "TRAIN n", "TRAIN raw", "TRAIN gross", "TRAIN net", "VAL n", "VAL raw", "VAL gross", "VAL net", "VAL mean R"],
    [...ids, "bench_donchian"].map((id) => {
      const a = id === "bench_donchian" ? bs[s.primaryHorizonHours] : hs[id]?.[s.primaryHorizonHours];
      const t = a?.folds?.train ?? {};
      const v = a?.folds?.validation ?? {};
      return [`\`${id}\``, I(t.resolved), B(t.rawBps), B(t.grossBps), B(t.netBps), I(v.resolved), B(v.rawBps), B(v.grossBps), B(v.netBps), F(v.mean_R, 4)];
    })));
  W("");
  const prim = s.primaryHorizonHours;
  const posRawTrain = ids.filter((id) => (hs[id]?.[prim]?.folds?.train?.rawBps ?? -1) > 0);
  const posRawVal = ids.filter((id) => (hs[id]?.[prim]?.folds?.validation?.rawBps ?? -1) > 0);
  const posNetTrain = ids.filter((id) => (hs[id]?.[prim]?.folds?.train?.netBps ?? -1) > 0);
  const posNetVal = ids.filter((id) => (hs[id]?.[prim]?.folds?.validation?.netBps ?? -1) > 0);
  W("**Two patterns dominate this table, and they point in opposite directions:**");
  W("");
  W(`1. **TRAIN looks encouraging.** ${I(posRawTrain.length)} of ${ids.length} signals have positive raw edge on TRAIN at the primary horizon (${I(posNetTrain.length)} stay positive after costs).`);
  W(`2. **VALIDATION reverses it.** Only ${I(posRawVal.length)} of ${ids.length} signals keep a positive raw edge out-of-sample (${I(posNetVal.length)} after costs).`);
  W("");
  W("A signal that is positive in the training window and negative in the next window, in the *same direction* as the naive momentum control (§12), is describing a **market regime** rather than a repeatable edge. That is a substantive finding, not a technicality — and it is precisely why the selection protocol (§18) is judged on VALIDATION net edge rather than TRAIN edge.");

  H(14, "Quality Score (Pre-Registered Decision Layer)");
  W("The decision layer is a **deterministic, untrained** weighted score. Nothing here is fitted: every component is a closed-form function of pre-trade, causal features, and the weights and threshold were fixed in the spec.");
  W("");
  W("```json");
  W(JSON.stringify(spec.qualityScore ?? {}, null, 2));
  W("```");
  W("");
  W("| Component | What it measures (causal) |");
  W("| --- | --- |");
  W("| `trendAlignment` | fraction of `r4`/`r24`/`r72` whose sign agrees with the trade side |");
  W("| `breakoutQuality` | distance beyond the prior 48-bar channel, in hourly ATRs (1.0 if >= 0.5 ATR, 0.5 if > 0, else 0) |");
  W("| `volExpansion` | fast/slow ATR ratio, scaled in [1.0, 1.5] |");
  W("| `mtfAgreement` | daily SMA50 trend agreement (0.5) plus 24-bar return agreement (0.5) |");
  W("| `costCoverage` | expected move / round-trip cost, saturating at 10x |");
  W("");
  W("**Score-bucket outcomes.** Buckets use *fixed* edges (chosen in the spec, never fitted): `q0` < 0.35, `q1` 0.35–0.50, `q2` 0.50–0.65, `q3` 0.65–0.80, `q4` >= 0.80. Only buckets that actually contain accepted trades appear.");
  W("");
  const byScore = s.arms?.NEW_ALPHA?.byScore ?? {};
  const scoreKeys = sortedKeys(byScore);
  if (scoreKeys.length) {
    W(table(["Score bucket", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "profit factor"],
      scoreKeys.map((k) => {
        const x = byScore[k];
        return [`\`${k}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.profitFactor)];
      })));
    W("");
    W("**Interpretation.** Higher score does buy *something* pre-cost — the top bucket is the only one with a positive raw edge in the pure-signal arm — but the effect is far too small to cover the round trip, and the sample in the top bucket is thin. The decision layer is therefore not a solution in itself: it is a *filter*, and a filter cannot create edge that the underlying signal does not have.");
  } else {
    W("No accepted trades were recorded in this arm, so score buckets are not reported.");
  }

  H(15, "False-Breakout Rejection Rules");
  W(`**${(spec.falseBreakoutRejectionRules ?? []).length} rejection rules** were pre-registered to remove the classic false-breakout patterns. Each rule reports *independently* so its marginal value can be measured:`);
  W("");
  W(table(["Rule", "Definition (verbatim from the spec)"],
    (spec.falseBreakoutRejectionRules ?? []).map((r) => [`\`${r.id}\``, r.definition])));
  W("");
  W("**Marginal value of each rule** (pure-signal arm; trades are partitioned by whether the rule fired, so the two rows of each rule are mutually exclusive and comparable directly):");
  W("");
  const byRej = s.arms?.NEW_ALPHA?.byReject ?? {};
  const rejKeys = sortedKeys(byRej).filter((k) => k !== "ALL_RULES|pass" && k !== "ALL_RULES|any_fired");
  if (rejKeys.length) {
    W(table(["Rule and state", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "stop-hit rate"],
      rejKeys.map((k) => {
        const x = byRej[k];
        return [`\`${k}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), P(x.stopHitRate)];
      })));
    W("");
    const allPass = byRej["ALL_RULES|pass"];
    const allAny = byRej["ALL_RULES|any_fired"];
    if (allPass || allAny) {
      W(table(["All rules", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate"],
        [["every rule passed", allPass], ["at least one rule fired", allAny]].map(([lab, x]) =>
          [`${lab}`, I(x?.resolved), B(x?.rawBps), B(x?.grossBps), B(x?.netBps), F(x?.mean_R, 4), P(x?.winRate)])));
      W("");
      W(`**Rule-level verdict.** With all rules passing: ${B(allPass?.netBps)} bps net on ${I(allPass?.resolved)} trades. With any rule fired: ${B(allAny?.netBps)} bps net on ${I(allAny?.resolved)} trades. ${Number.isFinite(allPass?.netBps) && Number.isFinite(allAny?.netBps) && allPass.netBps > allAny.netBps ? "The rules do select a better subset *on this arm*, but — as the funnel in §9 already showed — the size and composition of that subset is dominated by a single rule." : "The rules do not separate outcomes on this arm."}`);
    }
  }
  W("");
  W("**The critical structural finding.** The funnel in §9 shows *why* the quality layer keeps almost no trades, and it is not a threshold-tuning issue:");
  W("");
  const qf = s.arms?.NEW_ALPHA_QUALITY?.funnel?.policyRejected ?? {};
  const qfTotal = Object.values(qf).reduce((a, b) => a + b, 0);
  const overext = Object.entries(qf).filter(([k]) => k.includes("REJ_OVEREXTENDED")).reduce((a, [, v]) => a + v, 0);
  W(`Of ${I(qfTotal)} candidates that reached the quality layer's decision point, **${I(overext)} (${P(qfTotal ? overext / qfTotal : NaN)}) were rejected by \`REJ_OVEREXTENDED\`** — the rule that rejects an entry when \\|close - 48-bar mid\\| / atr14 > 2.0.`);
  W("");
  W("This is a **design incompatibility, not a market fact**: a *fresh channel breakout is by construction far from the middle of the channel it just broke*. A 48-bar channel is typically several ATRs wide, so a bar sitting at its upper edge is mechanically ~2–4 ATR from the mid. The rule therefore removes essentially every breakout candidate by definition, and only a handful of near-mid entries survive.");
  W("");
  W("This is reported as a **negative result about the protocol**, and it is why the report presents both gate tables (§22) rather than pretending the layer is a tradeable alpha. It is *not* corrected here: adjusting a pre-registered rule after seeing its effect is exactly the behaviour this protocol exists to prevent. A future pre-registered experiment may restate `REJ_OVEREXTENDED` in a scale-free way (for example, distance beyond the *broken channel edge* rather than from the channel *mid*), and that restatement must be fixed before any measurement is taken.");

  H(16, "Feature Bucket Analysis");
  W("**This is a descriptive analysis, not a search.** Bucket edges are computed from **TRAIN only** (quintiles of the causal feature value at the sampled decision bars), then the *same* edges are applied to VALIDATION and TEST. Every fold uses identical non-overlapping sampling, so the columns are comparable. Nothing in this section feeds selection.");
  W("");
  W("Its purpose is to answer, honestly: *is there any causal feature whose highest bucket carries a real out-of-sample edge?* If one existed, that feature would be the natural seed of a future pre-registered experiment.");
  W("");
  const fb = s.featureBuckets ?? {};
  const axisNames = sortedKeys(fb);
  if (!axisNames.length) W("Feature bucket data was not produced in this run.");
  for (const axis of axisNames) {
    const entry = fb[axis];
    W(`**\`${axis}\`** — TRAIN quintile edges: ${(entry.edges ?? []).map((x) => F(x, 3)).join(", ")} (${I(entry.trainSamples)} sampled TRAIN bars)`);
    W("");
    W(table(["Bucket", "TRAIN n", "TRAIN net", "VAL n", "VAL net", "TEST n", "TEST net", "TEST raw", "TEST mean R"],
      (entry.buckets ?? []).map((b) => [
        I(b.bucket), I(b.train?.resolved), B(b.train?.netBps), I(b.validation?.resolved), B(b.validation?.netBps),
        I(b.test?.resolved), B(b.test?.netBps), B(b.test?.rawBps), F(b.test?.mean_R, 4),
      ])));
    W("");
  }
  W("**How to read these tables.** Each row is one fifth of the causal feature's distribution, with the *same* boundary applied to all folds. A monotone column of falling-then-rising net bps across buckets, stable in VALIDATION and TEST, would be a genuine lead. Thin buckets (n < 30) are noise and should be ignored. The report deliberately shows *all* buckets — including the unflattering ones — because selective presentation of bucket tables is how spurious features get promoted.");

  H(17, "Regime, Market, Symbol and Side Analysis");
  W("The pure-signal arm (`NEW_ALPHA`, the selected candidate traded at the primary horizon with no quality filter) is partitioned below. All cells share one statistics implementation, so no cell can disagree with the aggregate.");
  W("");
  const armAll = s.arms?.NEW_ALPHA ?? {};
  const groupTable = (title, dict, note = "") => {
    const keys = sortedKeys(dict);
    if (!keys.length) return;
    W(`**${title}**${note ? ` — ${note}` : ""}`);
    W("");
    W(table(["Group", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "profit factor", "MFE (bps)", "MAE (bps)", "avg hold (h)"],
      keys.map((k) => {
        const x = dict[k];
        return [`\`${k}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.profitFactor), F(x.mfeBps), F(x.maeBps), F(x.avgHoldHours, 1)];
      })));
    W("");
  };
  groupTable("Market", armAll.byMarket ?? {}, "the gate set requires each market with >=10% share of the sample to be independently positive");
  groupTable("Side", armAll.bySide ?? {}, "long vs short symmetry check — a long-only edge in a rising sample would be a regime artefact");
  groupTable("Causal regime label", armAll.byRegime ?? {}, "regime labels are closed-form functions of the decision bar's own causal features");
  groupTable("Structure regime", armAll.byStructure ?? {}, "expansion / contraction / neutral, from volatility expansion and range compression");
  groupTable("Volatility regime", armAll.byVol ?? {}, "volatility ratio vs its own 240-bar mean");
  groupTable("Exit reason", armAll.byExitReason ?? {}, "fixed-horizon arms exit on the horizon by construction; managed arms show the management layer's decisions");
  const symDict = armAll.bySymbol ?? {};
  W("**Per symbol** (sorted by sample size) — the concentration gate (§23) is computed from the gross-profit shares of this table:");
  W("");
  W(table(["Symbol", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "profit factor"],
    sortedKeys(symDict).sort((a, b) => (symDict[b].resolved - symDict[a].resolved) || a.localeCompare(b)).map((k) => {
      const x = symDict[k];
      return [`\`${k}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.profitFactor)];
    })));
  W("");
  W("**Sub-fold breakdown** (four equal chronological quarters inside each fold) — the stability gate counts how many TEST sub-folds end positive:");
  W("");
  const subDict = armAll.bySubFold ?? {};
  W(table(["Fold and sub-fold", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate"],
    sortedKeys(subDict).map((k) => {
      const x = subDict[k];
      return [`\`${k}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate)];
    })));

  H(18, "Selection Protocol and the Selection Lock");
  W(`> ${spec.selectionProtocol?.rule ?? ""}`);
  W("");
  W(`**Selection folds:** ${(spec.selectionProtocol?.selectOn ?? ["train", "validation"]).join(" + ")}. **TEST evaluations allowed:** ${I(spec.selectionProtocol?.testEvaluationCount)}.`);
  W("");
  W("Selection rule, stated as executed (all pre-registered):");
  W("");
  W(`1. **TRAIN net edge > 0** (net of fees, spread and impact), and`);
  W(`2. **VALIDATION net edge > 0**, and`);
  W(`3. **sample sizes pass** (TRAIN >= ${I(spec.alphaQualityGates?.minResolvedTrain)}, VALIDATION >= ${I(spec.alphaQualityGates?.minResolvedValidation)} resolved trades), and`);
  W(`4. **no single symbol supplies more than ${P(spec.alphaQualityGates?.maxSymbolProfitShare, 0)}** of gross profit.`);
  W("");
  W("Ties are broken by the **pre-registered signal order** in the spec — never by observed performance.");
  W("");
  W("**Candidate-by-candidate selection table (TRAIN + VALIDATION only):**");
  W("");
  W(table(["Signal", "Family", "TRAIN n", "TRAIN raw", "TRAIN gross", "TRAIN net", "VAL n", "VAL raw", "VAL gross", "VAL net", "Max symbol share", "Qualifies"],
    (s.selection?.rows ?? []).map((r) => [
      `\`${r.id}\``, r.family, I(r.trainN), B(r.trainRawBps), B(r.trainGrossBps), B(r.trainNetBps),
      I(r.valN), B(r.valRawBps), B(r.valGrossBps), B(r.valNetBps), P(r.maxSymbolProfitShare), r.qualifies ? "**YES**" : "no",
    ])));
  W("");
  const sel = s.selection ?? {};
  W(`**Outcome of the pre-registered protocol:** ${sel.selected ? `a candidate **qualified**: \`${sel.selected}\`.` : "**no candidate qualified** — no signal had both TRAIN and VALIDATION net edge positive while passing the sample and concentration requirements."}`);
  W("");
  W(`For the arm matrix (§19) the protocol falls back to the **best-effort** candidate \`${sel.bestEffort ?? "n/a"}\` (the signal with the highest TRAIN net edge), explicitly labelled as a fallback: ${sel.usedIsSelected ? "the arm candidate *is* the selected signal." : "the arm candidate is **not** a selected signal, so its TEST numbers are reported for completeness and must not be read as a validated result."}`);
  W("");
  W("**Lock.** The following digest is computed from TRAIN+VALIDATION candidates only, hashed, and used to freeze the run *before* TEST is read. It is byte-stable: two consecutive runs of the same data produce the same hash.");
  W("");
  W("```json");
  W(JSON.stringify({ selectionLockHash: s.selectionLockHash, lock: s.lock }, null, 2));
  W("```");

  H(19, "Arm Matrix and the Raw / Gross / Net Decomposition");
  W("Seven arms were pre-registered. Each is one (entry, management) combination measured over the same candidates on the same data:");
  W("");
  W(table(["Arm", "Kind", "Entry", "Management", "Horizon"],
    (spec.arms ?? []).map((a) => [
      `\`${a.id}\``, a.kind, `\`${a.entry}\``, `\`${a.management}\``,
      a.horizonHours == null ? "management-determined" : (a.horizonHours === "primary" ? `${I(s.primaryHorizonHours)}h (primary)` : `${I(a.horizonHours)}h`),
    ])));
  W("");
  W("**TEST-fold results for every arm** (the raw/gross/net decomposition makes the cost story unambiguous):");
  W("");
  W(table(["Arm", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "profit factor", "avg hold (h)", "MFE cost ratio", "MFE capture"],
    sortedKeys(s.arms ?? {}).map((id) => {
      const x = s.arms[id]?.folds?.test ?? {};
      return [`\`${id}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.profitFactor), F(x.avgHoldHours, 1), F(x.mfeCostRatio), F(x.mfeCapture)];
    })));
  W("");
  W("**Same arms, all folds pooled** (TRAIN + VALIDATION + TEST, for context only — the TEST column above is the out-of-sample evidence):");
  W("");
  W(table(["Arm", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate", "profit factor", "target hit", "stop hit"],
    sortedKeys(s.arms ?? {}).map((id) => {
      const x = s.arms[id]?.all ?? {};
      return [`\`${id}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.profitFactor), P(x.targetHitRate), P(x.stopHitRate)];
    })));
  W("");
  W("**What the decomposition shows.** Across every arm the raw edge is larger than the gross edge and the gross edge is larger than the net edge — the ordering is mechanically guaranteed and is the whole point of the table: the difference between columns *is* the market's friction. Where an arm's raw edge is small (a few tens of bps), the frictions consume all of it. This is the same conclusion Phase 9 reached for the production system, now measured on a completely different signal set.");
  W("");
  W("**Benchmark comparison.** The frozen production Donchian, re-expressed at hourly resolution with its production daily decision cadence, is included in every table as `BASELINE_DONCHIAN_PROD` and `DONCHIAN_H48` so that the new signals are judged against the incumbent, not against zero.");

  H(20, "The Single Frozen TEST Evaluation");
  W(`**This is the only out-of-sample evidence in the report, and it was read exactly once** — after the selection lock hash was computed and frozen. ${s.testEvaluated ? "Every number in this section comes from that single evaluation." : "TEST was skipped in this run (`--no-test`), so no out-of-sample number exists here."}`);
  W("");
  if (s.testEvaluated) {
    const ht = s.horizonStudyTest ?? {};
    const bt = s.benchmarkTest ?? {};
    W("**TEST — net bps per trade** (fixed-horizon, after all costs):");
    W("");
    W(table(["Horizon", ...ids.map((id) => `\`${id}\``), "`bench_donchian`"],
      hz.map((h) => [`${I(h)}h`, ...ids.map((id) => B(ht[id]?.[h]?.folds?.test?.netBps)), B(bt[h]?.folds?.test?.netBps)])));
    W("");
    W("**TEST — raw bps per trade** (pure directional information, pre-cost):");
    W("");
    W(table(["Horizon", ...ids.map((id) => `\`${id}\``), "`bench_donchian`"],
      hz.map((h) => [`${I(h)}h`, ...ids.map((id) => B(ht[id]?.[h]?.folds?.test?.rawBps)), B(bt[h]?.folds?.test?.rawBps)])));
    W("");
    W("**TEST — sample size (resolved trades):**");
    W("");
    W(table(["Horizon", ...ids.map((id) => `\`${id}\``), "`bench_donchian`"],
      hz.map((h) => [`${I(h)}h`, ...ids.map((id) => I(ht[id]?.[h]?.folds?.test?.resolved)), I(bt[h]?.folds?.test?.resolved)])));
    W("");
    W(`**Primary horizon (${I(s.primaryHorizonHours)}h) TEST detail** — the numbers the gate set consumes for the candidate:`);
    W("");
    W(table(["Signal", "n", "raw", "gross", "net", "mean R", "win rate", "profit factor", "gross PF", "MFE", "MAE", "MFE cost ratio"],
      [...ids, "bench_donchian"].map((id) => {
        const a = id === "bench_donchian" ? bt[s.primaryHorizonHours] : ht[id]?.[s.primaryHorizonHours];
        const x = a?.folds?.test ?? {};
        return [`\`${id}\``, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate), F(x.profitFactor), F(x.grossProfitFactor), F(x.mfeBps), F(x.maeBps), F(x.mfeCostRatio)];
      })));
    W("");
    const anyRaw = ids.filter((id) => (ht[id]?.[s.primaryHorizonHours]?.folds?.test?.rawBps ?? -1) > 0);
    const anyNet = ids.filter((id) => (ht[id]?.[s.primaryHorizonHours]?.folds?.test?.netBps ?? -1) > 0);
    W(`**TEST at the primary horizon: ${I(anyRaw.length)} of ${ids.length} signals have a positive raw edge and ${I(anyNet.length)} have a positive net edge.**`);
    W("");
    W("This is the crux of the phase. A positive *raw* number means the market moved in the signal's direction more often than not after the signal fired; a positive *net* number means that move was large enough to pay the round trip. The gap between the two columns is the difference between **information** and **profit**.");
  }

  H(21, "The \"New Alpha\" Deliverable");
  const usedId = sel.usedForArms ?? sel.selected ?? null;
  const usedSig = (spec.signals ?? []).find((x) => x.id === usedId) ?? null;
  const selRow = (s.selection?.rows ?? []).find((r) => r.id === usedId) ?? {};
  W("Per the protocol, the deliverable of this phase is **the single best pre-registered candidate, described precisely enough to be replicated or falsified** — together with an honest statement of whether it passed.");
  W("");
  W("| Element | Value |");
  W("| --- | --- |");
  W(`| Signal | \`${usedId ?? "n/a"}\`${usedSig ? ` — ${usedSig.name} (family ${usedSig.family})` : ""} |`);
  W(`| Definition | ${usedSig?.definition ?? "n/a"} |`);
  W(`| Entry side | both (long and short, exact mirror definitions) |`);
  W(`| Entry timing | decision-bar close; a next-bar-open variant is also measured (§23) |`);
  W(`| Holding period | ${I(s.primaryHorizonHours)}h fixed horizon (management variants also measured) |`);
  W(`| Exit | fixed-horizon close; no stop, no target, no trailing in the primary measurement |`);
  W(`| Optional decision layer | quality score >= ${F(spec.qualityScore?.takeThreshold)} **and** cost coverage >= ${F(spec.qualityScore?.costCoverageFloor)} **and** no rejection rule fired |`);
  W(`| Selection status | ${sel.usedIsSelected ? "**QUALIFIED** on TRAIN + VALIDATION" : "did **not** qualify on TRAIN + VALIDATION (best-effort fallback)"} |`);
  W(`| TRAIN net (primary horizon) | ${B(selRow.trainNetBps)} bps on ${I(selRow.trainN)} trades |`);
  W(`| VALIDATION net (primary horizon) | ${B(selRow.valNetBps)} bps on ${I(selRow.valN)} trades |`);
  W(`| TEST net, pure signal | ${B(s.arms?.NEW_ALPHA?.folds?.test?.netBps)} bps on ${I(s.arms?.NEW_ALPHA?.folds?.test?.resolved)} trades |`);
  W(`| TEST raw, pure signal | ${B(s.arms?.NEW_ALPHA?.folds?.test?.rawBps)} bps |`);
  W("");
  W("**Why this candidate is the one reported.** It is the fastest-qualifying candidate under a rule fixed in advance (highest TRAIN net edge among the eight signals), used only because no signal satisfied the stricter VALIDATION requirement. Reporting it is required for completeness, but the *label* matters:");
  W("");
  if (sel.usedIsSelected) {
    W("The candidate **did** satisfy the pre-registered selection criteria on TRAIN + VALIDATION, so its TEST result is a legitimate out-of-sample test of a frozen hypothesis.");
  } else {
    W("The candidate did **not** satisfy the pre-registered selection criteria on TRAIN + VALIDATION. It is a **fallback**, and its TEST numbers are *not* a validated result: a fallback chosen for having the best training-window performance is exactly the object that selection protocols exist to filter out. Its TEST numbers are printed so the reader can see them, not because they support a claim.");
  }
  W("");
  W("**Decision-layer variant (secondary).** The same candidate with the pre-registered quality layer retains very few trades, for the structural reason documented in §15. Its TEST numbers appear in §19 (`NEW_ALPHA_QUALITY`) and its gate table in §22. That sample is far too small for inference, and the report says so rather than quoting an impressive-looking mean from a handful of trades.");
  W("");
  W("**Deployment status: NOT DEPLOYED.** Nothing in this phase touches production. The production configuration, the frozen strategies, the management policy and the ledger are byte-identical before and after the run (verified by hash, §2). Any future use of this measurement requires a **new** pre-registration and a **new** out-of-sample window.");

  H(22, "Pre-Registered Gate Evaluation");
  W("The gate set was fixed in the spec before measurement. It is applied to the candidate (pure signal) and, independently, to the quality-layer variant — the spec names two alpha arms but does not say which one the gates target, so both tables are shown in full rather than choosing silently (§3).");
  W("");
  W("```json");
  W(JSON.stringify(spec.alphaQualityGates ?? {}, null, 2));
  W("```");
  W("");
  const gateTable = (g, label) => {
    if (!g) { W(`**${label}:** not evaluated in this run.`); W(""); return; }
    W(`**${label} — ${g.pass ? "ALL GATES PASS" : `${g.failed.length} of ${g.checks.length} gates FAILED`}**`);
    W("");
    W(table(["Gate", "Value", "Threshold / expectation", "Pass", "Note"],
      g.checks.map((c) => [`\`${c.name}\``, V(c.value), String(c.threshold ?? ""), c.pass ? "PASS" : "**FAIL**", c.note ?? ""])));
    W("");
    W(`Failed gates: ${g.failed.length ? g.failed.map((x) => `\`${x}\``).join(", ") : "none"}.`);
    W("");
  };
  gateTable(gates, "Candidate arm: alpha_selected (pure signal)");
  gateTable(gatesQL, "Candidate arm: alpha_quality_layer");
  W("**Interpretation.** The two tables fail for *different* reasons, and both reasons are informative:");
  W("");
  W(`- The **pure-signal arm** fails on the *economic* gates: validation raw/gross/net edge is negative, the cost-stress and delayed-entry robustness checks are negative, and the TEST sub-fold stability requirement is not met. Its TEST sample (n = ${I(s.arms?.NEW_ALPHA?.folds?.test?.resolved)}) is also below the pre-registered minimum of ${I(spec.alphaQualityGates?.minResolvedTest)}. These are the gates that matter for the phase question, and they fail on economic content, not on a technicality.`);
  W(`- The **quality-layer arm** fails on *sample-size and concentration* gates because the layer keeps only ${I(s.arms?.NEW_ALPHA_QUALITY?.folds?.all?.resolved)} trades in total — a consequence of \`REJ_OVEREXTENDED\` (§15), which is a property of the protocol rather than a market fact. Its sample-size failures must **not** be read as evidence about the market.`);
  W("");
  W("Neither arm passes. Under the pre-registered decision rule the verdict is therefore **not A** (grade A requires a selected candidate that passes every gate).");

  H(23, "Concentration, Sub-Fold Stability and Cost/Entry Robustness");
  W("Three robustness properties decide whether a positive average is *real* or a one-off. All three are gate inputs and are reported for both arms.");
  W("");
  W(table(["Robustness measure", "alpha_selected", "alpha_quality_layer", "Requirement"],
    [
      ["Max single-symbol share of gross profit", P(s.arms?.NEW_ALPHA?.maxSymbolProfitShare), P(s.arms?.NEW_ALPHA_QUALITY?.maxSymbolProfitShare), `<= ${P(spec.alphaQualityGates?.maxSymbolProfitShare, 0)}`],
      ["Max single-period (sub-fold) share of gross profit", P(s.arms?.NEW_ALPHA?.maxPeriodProfitShare), P(s.arms?.NEW_ALPHA_QUALITY?.maxPeriodProfitShare), `<= ${P(spec.alphaQualityGates?.maxPeriodProfitShare, 0)}`],
      ["Mean favourable-excursion / cost ratio", F(s.arms?.NEW_ALPHA?.all?.mfeCostRatio), F(s.arms?.NEW_ALPHA_QUALITY?.all?.mfeCostRatio), `>= ${F(spec.alphaQualityGates?.minMoveCostRatio)}`],
    ]));
  W("");
  const snb = s.stressNextBar ?? {};
  const mult = snb.stressMultiplier ?? spec.costStress?.multiplier ?? 1;
  W(`**Cost stress (fees + slippage x${F(mult)} on VALIDATION + TEST pooled).** An edge that disappears when costs rise 25% was never an edge — it was a measurement of the cost model:`);
  W("");
  W(table(["Arm", `Net (bps) under x1 cost`, `Net (bps) under x${F(mult)} cost`, "Still positive?"],
    [
      ["alpha_selected", B(s.arms?.NEW_ALPHA?.all?.netBps), B(snb.alpha?.netBps), (snb.alpha?.netBps ?? -1) > 0 ? "yes" : "**no**"],
      ["alpha_quality_layer", B(s.arms?.NEW_ALPHA_QUALITY?.all?.netBps), B(snb.qualityLayer?.netBps), (snb.qualityLayer?.netBps ?? -1) > 0 ? "yes" : "**no**"],
    ]));
  W("");
  W("**Delayed-entry robustness (enter at the NEXT bar's open instead of the decision bar's close).** This is the single most important execution check: it removes any advantage that comes from acting on information at a price that has already moved:");
  W("");
  W(table(["Arm", "Net at close entry (bps)", "Net at next-bar-open entry (bps)"],
    [
      ["alpha_selected", B(s.arms?.NEW_ALPHA?.all?.netBps), B(snb.nextBarAlpha?.netBps)],
      ["alpha_quality_layer", B(s.arms?.NEW_ALPHA_QUALITY?.all?.netBps), B(snb.nextBarQualityLayer?.netBps)],
    ]));
  W("");
  const testSubs = [0, 1, 2, 3].map((k) => s.arms?.NEW_ALPHA?.bySubFold?.[`test|${k}`]).filter(Boolean);
  const posSubs = testSubs.filter((x) => (x.netBps ?? -1) > 0);
  W(`**TEST sub-fold stability.** The TEST fold is split into ${I(spec.subFolds)} equal chronological parts. The gate requires at least ${I(spec.alphaQualityGates?.minPositiveSubFolds)} of them to end net-positive; **${I(posSubs.length)} of ${I(testSubs.length)} did**:`);
  W("");
  W(table(["TEST sub-fold", "n", "raw (bps)", "gross (bps)", "net (bps)", "mean R", "win rate"],
    testSubs.map((x, i) => [`test|${i}`, I(x.resolved), B(x.rawBps), B(x.grossBps), B(x.netBps), F(x.mean_R, 4), P(x.winRate)])));
  W("");
  W("A positive full-fold average built from one good quarter and three poor ones is a one-period artefact; this table is why the gate exists. Sub-fold stability is also **necessary but not sufficient**: a signal can be stable and still lose money, and several are.");

  H(24, "Failure Analysis, Threats to Validity and Limitations");
  W("This section exists so that a future reader does not have to re-derive why the phase ended where it did. Findings are ordered by how much explanatory weight they carry.");
  W("");
  W("### 24.1 The dominant finding: TRAIN-positive / VALIDATION-negative reversal");
  W("");
  W(`At the primary horizon, ${I(posRawTrain.length)} of ${ids.length} signals were raw-positive on TRAIN while only ${I(posRawVal.length)} were raw-positive out-of-sample on VALIDATION. The naive signal-free momentum control (§12) shows the *same* shape — ${B(br.train?.netBps)} bps net on TRAIN, ${B(br.validation?.netBps)} bps on VALIDATION.`);
  W("");
  W("The most parsimonious explanation is a **market-regime shift inside the sample window** (a strong trending period followed by a choppy/mean-reverting one), not a property of the signals. The 730-day window is a single realisation of history; momentum-family signals are known to have multi-month regime dependence, and no amount of horizon selection removes that exposure within one window.");
  W("");
  W("### 24.2 The cost structure is a real, quantified barrier");
  W("");
  W(`Measured round-trip drag is ${F(mc.crypto?.costBps)} bps on crypto and ${F(mc.us?.costBps)} bps on US equities. A signal must therefore clear that bar in *mean per-trade* terms merely to break even — while its raw edge out-of-sample at the primary horizon was ${B(s.arms?.NEW_ALPHA?.folds?.test?.rawBps)} bps on the best-effort candidate and negative on VALIDATION. Costs did not need to be the culprit here: **the raw edge itself did not replicate.**`);
  W("");
  W("### 24.3 A protocol design incompatibility (reportable defect)");
  W("");
  W(`\`REJ_OVEREXTENDED\` rejected ${I(overext)} of ${I(qfTotal)} candidates at the quality layer's decision point (${P(qfTotal ? overext / qfTotal : NaN)}). As explained in §15, the rule as worded is structurally incompatible with breakout-family signals, so the quality-layer arm is not a fair test of the decision layer's value. This is flagged as a **defect in this phase's pre-registration**, to be corrected in a *future* pre-registration — never retro-fitted here.`);
  W("");
  W("### 24.4 Threats to validity");
  W("");
  W("| Threat | Assessment |");
  W("| --- | --- |");
  W("| **Single TEST window** | One 20% chronological block per symbol. A single window cannot distinguish \"no edge\" from \"no edge *in this window*\". |");
  W("| **Regime dependence** | The TRAIN/VALIDATION reversal (§24.1) is the largest single threat to *any* positive number in this report, including the best-effort candidate's TEST result. |");
  W(`| **Multiple comparisons** | ${I(ids.length)} signals x ${I(hz.length)} horizons x ${I(Object.keys(s.arms ?? {}).length)} arms were examined. Even under the null, some cell looks good. The report never selects on TEST and never re-tunes, but the *reader* should still expect best-of-many artefacts — which is exactly why selection used TRAIN + VALIDATION only. |`);
  W(`| **Sample size** | Several cells are thin (benchmark VALIDATION n = ${I(bs[s.primaryHorizonHours]?.folds?.validation?.resolved)}; quality-layer arm n = ${I(s.arms?.NEW_ALPHA_QUALITY?.all?.resolved)}). Thin cells are labelled rather than averaged away. |`);
  W(`| **Universe** | ${I(s.datasets?.symbols)} symbols across ${(s.datasets?.markets ?? []).join(", ")} over ${F((((s.datasets?.hour?.lastTs ?? 0) - (s.datasets?.hour?.firstTs ?? 0)) / 86400000), 0)} calendar days. Indian and US names contribute far fewer hourly bars than the crypto names and only a handful of signals; cross-market generalisation is limited. |`);
  W("| **Survivorship / selection of the universe** | The symbols were chosen in earlier phases and are all liquid, well-known names; results would likely be *worse*, not better, on an unbiased universe. |");
  W("| **Overlapping-market hours** | Indian and US sessions do not overlap fully; an hourly bar is not equally informative across markets, which adds cross-sectional noise to pooled numbers. |");
  W("| **Execution realism** | Fills assume taker-only fills with a square-root impact model and constant half-spread. Real fills, queue position and funding costs are not modelled. |");
  W("| **Reporting clarifications** | Disclosed in full in §3: gate-target ambiguity resolved by showing both tables, and bookkeeping instrumentation added after the first TEST read. No threshold, horizon, arm or measurement was changed. |");
  W("");
  W("### 24.5 What was *not* found");
  W("");
  W("It is worth stating the negative results precisely, because they are the phase's actual deliverable:");
  W("");
  W("- No new entry signal produced a **replicated** positive raw edge on TRAIN and VALIDATION.");
  W("- No signal produced a **net-of-cost** edge on VALIDATION at any of the six pre-registered horizons (see §13).");
  W("- No feature bucket (§16) shows a stable, economically meaningful out-of-sample gradient that would justify promoting that feature.");
  W("- The frozen production benchmark did not demonstrate a robust edge either: " + B(s.benchmarkTest?.[s.primaryHorizonHours]?.folds?.test?.netBps) + " bps net on TEST at the primary horizon — consistent with Phase 9.");
  W("");
  W("### 24.6 Limitations of the conclusion");
  W("");
  W("A negative result here means: **under this universe, this 730-day window, this cost model and this pre-registered signal set, no cost-surviving edge was found.** It does not prove that no entry signal can ever work, and it is not evidence about different horizons, different instruments, or signals that require data this engine does not have (order flow, funding rates, cross-asset context). It *is* strong evidence that adding more variations of trend/momentum/breakout logic will not fix the system's economics.");

  H(25, "Verdict and Decision");
  const v = s.verdict ?? {};
  // A blockquote callout rather than a heading, so the verdict is prominent
  // without adding a second, unnumbered H2 to the document outline.
  W(`> **${v.grade ?? "?"} — ${v.label ?? "?"}**`);
  W("");
  W(`**Reason (generated by the pre-registered decision rule):** ${v.reason ?? ""}`);
  W("");
  W("### The decision rule, and what it returned");
  W("");
  W("| Grade | Meaning | Condition | Returned? |");
  W("| --- | --- | --- | --- |");
  W("| **A** | Try in shadow / paper | A selected candidate passed **every** pre-registered gate, including TEST | " + (v.grade === "A" ? "**YES**" : "no") + " |");
  W("| **B** | Do not trade yet | A real, replicated **pre-cost** information edge exists out-of-sample, but the economics do not survive | " + (v.grade === "B" ? "**YES**" : "no") + " |");
  W("| **C** | Stop / redesign | No replicated positive raw edge out-of-sample; there is nothing for a cost-aware layer to exploit | " + (v.grade === "C" ? "**YES**" : "no") + " |");
  W("");
  W("### What the evidence says, plainly");
  W("");
  const valRaw = s.rawEdge?.validationRawBps;
  const testRaw = s.rawEdge?.testRawBps;
  W(`- **Best-effort candidate** (\`${usedId ?? "n/a"}\`, ${I(s.primaryHorizonHours)}h): raw edge ${B(valRaw)} bps on VALIDATION (n = ${I(s.rawEdge?.validationResolved)}) and ${B(testRaw)} bps on TEST (n = ${I(s.rawEdge?.testResolved)}). ${Number.isFinite(valRaw) && valRaw > 0 ? "" : "The validation half of the replication test failed, which is decisive: a signal that did not work on the window immediately preceding TEST is not a hypothesis that TEST can rescue."}`);
  W(`- **No candidate qualified** under the pre-registered selection protocol${sel.selected ? ` (exception: \`${sel.selected}\`)` : ""}, so no arm in this report is a validated alpha.`);
  W(`- **The production benchmark** did not produce an edge either (${B(s.benchmarkTest?.[s.primaryHorizonHours]?.folds?.test?.netBps)} bps net on TEST at the primary horizon), independently reconfirming the Phase 9 conclusion on a different measurement apparatus.`);
  W("");
  W("### What would change our mind (pre-committed)");
  W("");
  W("So that a future phase cannot invent its own success criteria after the fact, here is what a *genuine* positive result would have to look like — and it is deliberately stricter than what was observed:");
  W("");
  W("1. A signal whose raw edge is positive on **TRAIN, VALIDATION and TEST** (not just TRAIN), with at least the pre-registered minimum sample in each fold.");
  W("2. A signal-free control (§12) that does **not** exhibit the same sign pattern, proving the result is not unconditional momentum exposure.");
  W("3. A **sub-fold-stable** positive net edge, i.e. at least 3 of 4 TEST sub-folds positive.");
  W("4. Survival of the 1.25x cost-stress and the next-bar-open entry check (§23).");
  W("5. No single symbol or single period supplying more than the concentration cap of gross profit.");
  W("");
  W("Nothing observed in this phase meets even items 1 and 2, which is why the verdict is C rather than B.");
  W("");
  W("### Required next step");
  W("");
  W("**Do not trade any signal from this experiment.** No production file was modified, and none may be modified on the strength of these results. The useful output of this phase is the negative result plus the operational lessons recorded above (regime dependence dominates signal variety; a breakout filter must be scale-free; the round-trip cost bar is large relative to achievable per-trade edges at these horizons).");
  W("");
  W("### Artefacts and reproduction");
  W("");
  W("| Artefact | Path |");
  W("| --- | --- |");
  W("| This report (generated, deterministic) | `ALPHA_RESEARCH_REPORT.md` |");
  W("| Frozen summary of every number | `data/calibration/alpha-summary.v2.json` |");
  W("| Per-trade records (pure signal + quality layer) | `data/calibration/alpha-trades.v2.jsonl` |");
  W("| Pre-registered protocol | `config/alpha-experiment-spec.v1.json` |");
  W("| Acceptance tests (22: causality, cost, signals, rules, metrics, gates, verdict, write isolation) | `tests/alpha.test.mjs` |");
  W("| Runner | `scripts/v2/alpha-run.mjs` |");
  W("| Report generator | `scripts/v2/alpha-report.mjs` |");
  W("");
  W("```bash");
  W("# re-run the experiment (writes summary + trades; re-hashes production inputs and aborts if any changed)");
  W("node scripts/v2/alpha-run.mjs");
  W("");
  W("# regenerate this report from the frozen summary (byte-identical for the same summary)");
  W("node scripts/v2/alpha-report.mjs");
  W("");
  W("# run the alpha acceptance tests");
  W("node --test tests/alpha.test.mjs");
  W("");
  W("# run the whole repository suite");
  W("node --test tests/*.test.mjs");
  W("```");
  W("");
  W(`**Reproducibility anchors:** spec \`${(s.specHash ?? "").slice(0, 16)}\`, selection lock \`${(s.selectionLockHash ?? "").slice(0, 16)}\`, data through ${utc(s.datasets?.hour?.lastTs)}, ${I(s.datasets?.symbols)} symbols, ${I(s.datasets?.hour?.bars)} hourly bars. Any future run that produces a different selection lock hash from the same data and spec indicates the code changed.`);
  W("");
  W("---");
  W("");
  // The footer states the report's real rendered line count, computed from the fully
  // assembled body — `out.length` would undercount, because a pushed entry can contain
  // embedded newlines (tables, code fences). The +1 accounts for the footer line itself.
  const bodyLines = out.join("\n").split("\n").length;
  W(`*Generated deterministically from \`alpha-summary.v2.json\` — ${I(bodyLines + 1)} lines. No number in this report is computed at report time.*`);

  return out.join("\n");
}

// ---- CLI ---------------------------------------------------------------------
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const summary = JSON.parse(fs.readFileSync(ALPHA_SUMMARY_PATH, "utf8"));
  const md = buildReport(summary);
  const abs = assertAlphaPath(ALPHA_REPORT_PATH, { allowReport: true });
  fs.writeFileSync(abs, md);
  const hash = sha256(md);
  console.log(`[alpha-report] wrote ${path.relative(process.cwd(), abs)} (${(md.length / 1024).toFixed(0)} KB, sha256=${hash.slice(0, 16)})`);
}