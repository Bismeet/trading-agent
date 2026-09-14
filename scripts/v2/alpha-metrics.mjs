// scripts/v2/alpha-metrics.mjs — ALPHA RESEARCH: metrics, stability, gates,
// verdict, and the write-isolation guard.
//
// Every number in ALPHA_RESEARCH_REPORT.md comes from these functions applied to
// the raw per-trade measurement stream, so the report can never disagree with
// the stored results (tests/alpha.test.mjs asserts this).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const ALPHA_DIR = path.join(REPO_ROOT, "data", "calibration");
export const ALPHA_SUMMARY_PATH = path.join(ALPHA_DIR, "alpha-summary.v2.json");
export const ALPHA_TRADES_PATH = path.join(ALPHA_DIR, "alpha-trades.v2.jsonl");
export const ALPHA_REPORT_PATH = path.join(REPO_ROOT, "ALPHA_RESEARCH_REPORT.md");

// ---- write isolation ---------------------------------------------------------
// The alpha research phase may ONLY write its own artefacts. It must never be
// able to touch config/ or any production data file.
export function assertAlphaPath(target, { allowReport = false } = {}) {
  const abs = path.resolve(target);
  const allowed = [ALPHA_DIR];
  if (allowReport) allowed.push(ALPHA_REPORT_PATH);
  const ok = allowed.some((a) => abs === a || abs.startsWith(a + path.sep));
  if (!ok) throw new Error(`alpha: refusing to write outside the alpha research area: ${abs}`);
  return abs;
}

export function writeAlphaJSON(target, obj, { allowReport = false } = {}) {
  const abs = assertAlphaPath(target, { allowReport });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  return abs;
}

// ---- statistics accumulator --------------------------------------------------
// Memory-light: sums + a lazily-kept list for cells where a median is required.
// Every grouping in the report (signal x horizon x fold x market x regime x
// sub-fold) uses this one structure, which is why the report is reproducible.
export function emptyStats({ list = false } = {}) {
  return {
    n: 0, censored: 0,
    rawSum: 0, grossSum: 0, netSum: 0, costSum: 0, feeSum: 0, slipSum: 0,
    mfeSum: 0, maeSum: 0, RSum: 0, rSum: 0, mfeCostSum: 0, captureSum: 0, holdSum: 0,
    wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, netProfit: 0, netLoss: 0,
    targetHits: 0, stopHits: 0, favFirst: 0, timeToMfeSum: 0,
    list,
    netList: [],
  };
}

export function pushStats(st, m) {
  if (!m || !m.resolved) { st.censored += 1; return st; }
  st.n += 1;
  st.rawSum += m.rawBps; st.grossSum += m.grossBps; st.netSum += m.netBps;
  st.costSum += m.costBps; st.feeSum += m.feeBps; st.slipSum += m.slipBps;
  st.mfeSum += m.mfeBps; st.maeSum += m.maeBps; st.RSum += m.realized_R;
  st.rSum += m.raw_R; st.mfeCostSum += m.mfeCostRatio; st.captureSum += m.mfe_capture_ratio;
  st.holdSum += m.holdHours;
  if (m.netPnl > 0) { st.wins += 1; st.netProfit += m.netPnl; } else { st.losses += 1; st.netLoss += Math.abs(m.netPnl); }
  if (m.grossPnl > 0) st.grossProfit += m.grossPnl; else st.grossLoss += Math.abs(m.grossPnl);
  if (m.touchedTarget) st.targetHits += 1;
  if (m.touchedStop) st.stopHits += 1;
  if (m.favBeforeAdverse) st.favFirst += 1;
  st.timeToMfeSum += m.timeToMfeBars ?? 0;
  if (st.list) st.netList.push(m.netBps);
  return st;
}

export function percentile(sorted, q) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

export function finishStats(st) {
  const n = st.n;
  const safe = (x) => (n > 0 ? x / n : null);
  const list = st.list ? [...st.netList].sort((a, b) => a - b) : null;
  return {
    resolved: n,
    censored: st.censored,
    rawBps: safe(st.rawSum),
    grossBps: safe(st.grossSum),
    netBps: safe(st.netSum),
    costBps: safe(st.costSum),
    feeBps: safe(st.feeSum),
    slipBps: safe(st.slipSum),
    mfeBps: safe(st.mfeSum),
    maeBps: safe(st.maeSum),
    mean_R: safe(st.RSum),
    mean_raw_R: safe(st.rSum),
    mfeCostRatio: safe(st.mfeCostSum),
    mfeCapture: safe(st.captureSum),
    avgHoldHours: safe(st.holdSum),
    winRate: n > 0 ? st.wins / n : null,
    lossRate: n > 0 ? st.losses / n : null,
    profitFactor: st.netLoss > 0 ? st.netProfit / st.netLoss : st.netProfit > 0 ? Infinity : null,
    grossProfitFactor: st.grossLoss > 0 ? st.grossProfit / st.grossLoss : st.grossProfit > 0 ? Infinity : null,
    avgWin: st.wins > 0 ? st.netProfit / st.wins : null,
    avgLoss: st.losses > 0 ? st.netLoss / st.losses : null,
    payoffRatio: st.losses > 0 && st.wins > 0 ? (st.netProfit / st.wins) / (st.netLoss / st.losses) : null,
    targetHitRate: n > 0 ? st.targetHits / n : null,
    stopHitRate: n > 0 ? st.stopHits / n : null,
    favFirstRate: n > 0 ? st.favFirst / n : null,
    avgTimeToMfeBars: safe(st.timeToMfeSum),
    medianNetBps: list ? percentile(list, 0.5) : null,
    p10NetBps: list ? percentile(list, 0.1) : null,
    p90NetBps: list ? percentile(list, 0.9) : null,
  };
}

export function dictPush(dict, key, m) {
  if (!dict[key]) dict[key] = emptyStats();
  return pushStats(dict[key], m);
}

// ---- cost-stress helper ------------------------------------------------------
// Re-prices an already-measured trade under a harsher cost multiplier by scaling
// the fee + slippage components. Transparent and auditable: no re-simulation.
export function stressNetBps(m, multiplier) {
  if (!m || !m.resolved) return null;
  return m.rawBps - (m.feeBps + m.slipBps) * multiplier;
}

// ---- TRAIN-only quintile edges (pre-registered bucketing rule, §8/§15) ------
export function quantileEdges(values, k = 5) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const edges = [];
  for (let i = 1; i < k; i++) edges.push(percentile(v, i / k));
  return edges;
}

export function bucketOf(value, edges) {
  if (!Number.isFinite(value)) return null;
  let b = 0;
  while (b < edges.length && value >= edges[b]) b += 1;
  return b;
}

// ---- pre-registered pass/fail gates (§23) -----------------------------------
// `ctx` carries the finished statistics for every grouping the gates examine.
export function evaluateAlphaGates({ ctx, spec }) {
  const g = spec?.alphaQualityGates ?? {};
  const folds = ctx.folds ?? {};
  const tr = folds.train ?? { resolved: 0 };
  const va = folds.validation ?? { resolved: 0 };
  const te = folds.test ?? { resolved: 0 };
  const checks = [];
  const add = (name, pass, value, threshold, note = "") => checks.push({ name, pass: !!pass, value, threshold, note });

  add("sample_train", tr.resolved >= (g.minResolvedTrain ?? 300), tr.resolved, g.minResolvedTrain ?? 300);
  add("sample_validation", va.resolved >= (g.minResolvedValidation ?? 150), va.resolved, g.minResolvedValidation ?? 150);
  add("sample_test", te.resolved >= (g.minResolvedTest ?? 150), te.resolved, g.minResolvedTest ?? 150);

  // Markets that carry a non-trivial share of the sample must each stand alone.
  const shareThreshold = 0.10;
  const totalResolved = (tr.resolved ?? 0) + (va.resolved ?? 0) + (te.resolved ?? 0);
  const marketChecks = [];
  for (const [mkt, s] of Object.entries(ctx.markets ?? {})) {
    const share = totalResolved > 0 ? s.resolved / totalResolved : 0;
    if (share < shareThreshold) continue;
    marketChecks.push({
      market: mkt, share, resolved: s.resolved, netBps: s.netBps,
      pass: s.resolved >= (g.minResolvedPerMarket ?? 60) && (s.netBps ?? -1) > 0,
    });
  }
  add("market_breadth", marketChecks.length > 0 && marketChecks.every((m) => m.pass), marketChecks, `markets with >=10% share need n>=${g.minResolvedPerMarket ?? 60} and net>0`);

  const symbolChecks = [];
  for (const [sym, s] of Object.entries(ctx.symbols ?? {})) {
    const share = totalResolved > 0 ? s.resolved / totalResolved : 0;
    if (share < shareThreshold) continue;
    symbolChecks.push({ symbol: sym, share, resolved: s.resolved, pass: s.resolved >= (g.minResolvedPerSymbol ?? 15) });
  }
  add("symbol_sample", symbolChecks.every((s) => s.pass), symbolChecks, `>=${g.minResolvedPerSymbol ?? 15} per >=10% symbol`);

  add("raw_edge_validation", (va.rawBps ?? -1) > 0, va.rawBps, "> 0", "pre-cost directional information");
  add("raw_edge_test", (te.rawBps ?? -1) > 0, te.rawBps, "> 0");
  add("gross_edge_validation", (va.grossBps ?? -1) > 0, va.grossBps, "> 0", "survives spread + market impact");
  add("gross_edge_test", (te.grossBps ?? -1) > 0, te.grossBps, "> 0");
  add("min_gross_R_test", (te.mean_R ?? -1) >= (g.minGrossR ?? 0), te.mean_R, `>= ${g.minGrossR ?? 0}`);
  add("net_edge_validation", (va.netBps ?? -1) > 0, va.netBps, "> 0", "after fees, spread and impact");
  add("net_edge_test", (te.netBps ?? -1) > 0, te.netBps, "> 0");
  add("move_cost_ratio", (ctx.moveCostRatio ?? 0) >= (g.minMoveCostRatio ?? 3), ctx.moveCostRatio, `>= ${g.minMoveCostRatio ?? 3}`, "favourable excursion / round-trip cost");

  const subFolds = ctx.testSubFolds ?? [];
  const positiveSubs = subFolds.filter((s) => (s.netBps ?? -1) > 0).length;
  add("sub_fold_stability", positiveSubs >= (g.minPositiveSubFolds ?? 3), { positive: positiveSubs, of: subFolds.length }, `>= ${g.minPositiveSubFolds ?? 3} of 4 positive`);

  const maxSymbolShare = ctx.maxSymbolProfitShare ?? 1;
  add("symbol_concentration", maxSymbolShare <= (g.maxSymbolProfitShare ?? 0.5), maxSymbolShare, `<= ${g.maxSymbolProfitShare ?? 0.5}`, "largest single-symbol share of gross profit");
  const maxPeriodShare = ctx.maxPeriodProfitShare ?? 1;
  add("period_concentration", maxPeriodShare <= (g.maxPeriodProfitShare ?? 0.5), maxPeriodShare, `<= ${g.maxPeriodProfitShare ?? 0.5}`, "largest single-period share of gross profit");

  add("cost_stress", (ctx.stressNetBps ?? -1) > 0, ctx.stressNetBps, "> 0", `fees+slippage x${spec?.costStress?.multiplier ?? 1.25}`);
  add("next_bar_entry", (ctx.nextBarNetBps ?? -1) > 0, ctx.nextBarNetBps, "> 0", "one-bar delayed entry (implementation delay)");

  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  return { pass: failed.length === 0, checks, failed };
}

// ---- final verdict (§31) ----------------------------------------------------
// A: a candidate survived every pre-registered gate out-of-sample.
// B: a real, replicated information edge exists but is not economically robust.
// C: no measurable edge at all.
export function computeVerdict({ selection, gates, rawEdge }) {
  if (selection?.selected && gates?.pass) {
    return { grade: "A", label: "TRY IN SHADOW / PAPER", reason: "Selected candidate passed every pre-registered gate, including TEST." };
  }
  const rawOk = (rawEdge?.validationRawBps ?? -1) > 0 && (rawEdge?.testRawBps ?? -1) > 0
    && (rawEdge?.validationResolved ?? 0) >= 100 && (rawEdge?.testResolved ?? 0) >= 100;
  if (rawOk) {
    return {
      grade: "B",
      label: "DO NOT TRADE YET",
      reason: selection?.selected
        ? `Information edge replicates out-of-sample (VAL ${rawEdge.validationRawBps.toFixed(2)} bps, TEST ${rawEdge.testRawBps.toFixed(2)} bps raw) but fails ${gates?.failed?.length ?? 0} pre-registered economic gate(s): ${(gates?.failed ?? []).join(", ")}.`
        : "Directional information replicates out-of-sample but no candidate satisfied the selection protocol on TRAIN+VALIDATION.",
    };
  }
  return {
    grade: "C",
    label: "STOP / REDESIGN",
    reason: "No candidate produced a replicated positive raw (pre-cost) edge out-of-sample; there is nothing for a cost-aware layer to exploit.",
  };
}