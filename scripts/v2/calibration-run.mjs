// scripts/v2/calibration-run.mjs — Phase 5 orchestration: run one configuration
// over one panel and return frequency, cohorts and (optionally) resolved
// counterfactual outcomes. Pure computation: no live state, no live files.
import {
  STRATEGY_IDS, runStrategyOverPanel, candidatesFrom, resolveAll,
  foldBoundsBySymbol, splitBounds, foldName, inBounds,
} from "./calibration.mjs";
import {
  frequencyStats, buildCohorts, summarizeCohorts, outcomeStats, stabilityAcrossFolds, foldSlices, turnoverPerDay, selectionScore,
} from "./calibration-metrics.mjs";
import { newProbe, starvationProbe, classifyStarvation, acceptedPanelsFor } from "./calibration-probes.mjs";

export function panelForStrategy(spec, id) {
  return spec.parameterGrids?.[id]?.panel || null;
}

// ids: which strategies to evaluate on this panel (default: those assigned to it)
export function analyzeConfigOverPanel({
  spec, cfg, panel, panelName, dailyPanel, configName, paramsByStrategy,
  ids, withProbes = true, withResolution = false,
}) {
  const symbols = Object.keys(panel.symbols || {}).sort();
  const foldBySymbol = foldBoundsBySymbol(symbols, panel, spec.splits[panelName]);
  const list = ids || STRATEGY_IDS.filter((id) => panelForStrategy(spec, id) === panelName);
  const strategies = {};
  const allSignals = [];
  let totalEvaluations = 0;
  for (const id of list) {
    const params = paramsByStrategy[id];
    const probe = newProbe();
    const run = runStrategyOverPanel({
      id, params, cfg, panel, dailyPanel, panelName, symbols, foldBySymbol,
      onBar: withProbes ? (q) => starvationProbe(id, q, params, probe) : undefined,
    });
    const applicable = Object.keys(run.perSymbol);
    const freq = frequencyStats({ signals: run.signals, evaluations: run.evaluations, symbols: applicable.length });
    const perSymbolCounts = {};
    for (const [sym, res] of Object.entries(run.perSymbol)) perSymbolCounts[sym] = res.signals.length;
    const symbolsFired = Object.values(perSymbolCounts).filter((n) => n > 0).length;
    const starvation = classifyStarvation({
      id, signalCount: run.signals.length, evaluations: run.evaluations,
      notApplicable: Object.values(run.perSymbol).reduce((a, r) => a + r.notApplicable, 0),
      probe, perSide: freq.perSide, applicableSymbols: applicable.length, symbolsFired,
      panelName, expectedPanel: panelForStrategy(spec, id), acceptedPanels: acceptedPanelsFor(id),
    });
    strategies[id] = {
      strategy_id: id, panel: panelName, params, evaluations: run.evaluations,
      signals: run.signals, perSymbolCounts, perSymbol: run.perSymbol,
      frequency: freq, probe, starvation, foldBounds: foldBySymbol,
      rows: withResolution ? resolveAll(candidatesFrom(run.signals, { configName, panelName }), run, cfg, spec, foldBySymbol) : null,
    };
    totalEvaluations += run.evaluations;
    allSignals.push(...run.signals);
  }
  const barsWithSignal = new Set(allSignals.map((s) => `${s.symbol}|${s.ts}`)).size;
  const cohorts = buildCohorts(Object.fromEntries(list.map((id) => [id, { signals: strategies[id].signals }])));
  return {
    configName, panelName, strategies, barsWithSignal,
    cohortSummary: summarizeCohorts(cohorts, barsWithSignal),
    cohorts, evaluations: totalEvaluations, foldBySymbol,
  };
}

// Exact evaluation count inside a fold: readiness is monotone per symbol (once
// warmup is satisfied it stays satisfied), so the count is a pure intersection
// of the fold's bar range with [firstReadyIndex, N).
export function evalCountForFold(s, fold) {
  let n = 0;
  for (const [sym, res] of Object.entries(s.perSymbol || {})) {
    const b = s.foldBounds?.[sym];
    if (!b) continue;
    const N = res.rows?.ts?.length || 0;
    const r = fold === "train" ? b.train : fold === "validation" ? b.validation : b.test;
    n += Math.max(0, Math.min(r[1], N) - Math.max(r[0], res.firstReady ?? 0));
  }
  return n;
}
export function foldSpanMs(s, fold) {
  let a = null, b = null;
  for (const [sym, res] of Object.entries(s.perSymbol || {})) {
    const bounds = s.foldBounds?.[sym];
    const ts = res.rows?.ts;
    if (!bounds || !ts?.length) continue;
    const r = fold === "train" ? bounds.train : fold === "validation" ? bounds.validation : bounds.test;
    if (r[1] <= r[0]) continue;
    const t0 = ts[r[0]], t1 = ts[Math.min(r[1], ts.length) - 1];
    if (t0 == null || t1 == null) continue;
    if (a == null || t0 < a) a = t0;
    if (b == null || t1 > b) b = t1;
  }
  return a == null ? null : [a, b];
}

// Chronological folds are tagged on every signal (`fold`), so fold metrics are
// deterministic filtering only: no re-evaluation, no cross-fold leakage.
export function foldMetrics(analysis, spec, ids) {
  const out = {};
  for (const fold of ["train", "validation", "test"]) {
    const per = {};
    for (const [id, s] of Object.entries(analysis.strategies)) {
      if (ids && !ids.includes(id)) continue;
      const sig = s.signals.filter((x) => x.fold === fold);
      const rows = (s.rows || []).filter((r) => r.fold === fold);
      const evals = evalCountForFold(s, fold);
      per[id] = {
        signals: sig.length, evaluations: evals,
        candidateRate: evals > 0 ? sig.length / evals : null,
        outcomes: outcomeStats(rows, spec.objective.minResolvedForQuality),
        turnoverPerDay: turnoverPerDay(rows, foldSpanMs(s, fold)),
        symbolsFired: new Set(sig.map((x) => x.symbol)).size,
        sidesFired: new Set(sig.map((x) => x.side)).size,
        trendContextsFired: new Set(sig.map((x) => x.trendContext)).size,
      };
    }
    out[fold] = per;
  }
  return out;
}
export function strategyStability(s, folds) {
  const perFold = [];
  for (const [sym, res] of Object.entries(s.perSymbol || {})) {
    const bounds = s.foldBounds?.[sym];
    const ts = res.rows?.ts;
    if (!bounds || !ts?.length) continue;
    for (const slice of foldSlices(bounds.train, folds)) {
      perFold.push({ signals: s.signals.filter((x) => x.symbol === sym && inBounds(slice, x.i)).length });
    }
  }
  return stabilityAcrossFolds(perFold);
}
export { splitBounds, foldName, inBounds };

// ---- selection logic (pure, unit-testable) ----------------------------------
// Kept OUT of the CLI so the walk-forward rules can be tested directly:
//   * scoring uses TRAIN metrics only,
//   * ranking is deterministic with a documented preference for CONTROL on ties,
//   * the validation gate can only REJECT a TRAIN winner (never promote on TEST).
export function scoreConfig(trainMetrics, controlCoFireRate, spec) {
  return selectionScore({
    frequency: trainMetrics.frequency, outcomes: trainMetrics.outcomes,
    symbolsAvailable: trainMetrics.symbolsAvailable,
    coFireRate: trainMetrics.coFireRate, controlCoFireRate,
    stability: trainMetrics.stability,
  }, spec);
}
export function rankConfigs(candidates, controlKey) {
  const ranked = candidates.slice().sort((a, b) =>
    (b.score.score - a.score.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const nOf = (c) => (Number.isFinite(c.trainSignals) ? c.trainSignals : (c.train?.signals?.length ?? 0));
  const pool = ranked.filter((c) => nOf(c) >= (c.minTrainCandidates ?? 0));
  const winner = pool.length ? pool[0] : null;
  // "no measurable improvement = no change": CONTROL wins ties.
  if (winner && winner.key !== controlKey) {
    const ctl = pool.find((c) => c.key === controlKey);
    if (ctl && Math.abs(winner.score.score - ctl.score.score) < 1e-9) return { ranked, pool, winner: ctl };
  }
  return { ranked, pool, winner };
}
export function validationGate({ winnerKey, controlKey, winner, winnerVal, winnerScore, ctlVal, ctlScore, controlParams, spec }) {
  const V = spec.validationGate;
  if (!winner) {
    return { chosen: "CONTROL", params: controlParams, reason: `no configuration reached the TRAIN availability floor (${spec.objective.minTrainCandidates} candidates)`, gate: [] };
  }
  if (winnerKey === controlKey) {
    return { chosen: "CONTROL", params: controlParams, reason: "CONTROL was the best-scoring TRAIN configuration", gate: ["no change needed: CONTROL selected on TRAIN"] };
  }
  const notes = [];
  const blocking = [];
  const nOf = (x) => (Array.isArray(x?.signals) ? x.signals.length : Number.isFinite(x?.signals) ? x.signals : 0);
  const wN = nOf(winnerVal), cN = nOf(ctlVal);
  const candRatio = cN > 0 ? wN / cN : wN > 0 ? 1 : 0;
  if (candRatio < V.minCandidateRatioVsControl) {
    blocking.push(`validation candidate availability ${wN} vs CONTROL ${cN} (ratio ${candRatio.toFixed(2)} < ${V.minCandidateRatioVsControl})`);
  }
  const minN = spec.objective.minResolvedForQuality;
  if (winnerVal.outcomes.resolved >= minN && ctlVal.outcomes.resolved >= minN) {
    if (winnerVal.outcomes.meanR < ctlVal.outcomes.meanR - V.qualityToleranceR) {
      blocking.push(`validation cost-adjusted meanR ${winnerVal.outcomes.meanR.toFixed(4)} worse than CONTROL ${ctlVal.outcomes.meanR.toFixed(4)} by more than ${V.qualityToleranceR}R`);
    } else {
      notes.push(`validation cost-adjusted meanR ${winnerVal.outcomes.meanR.toFixed(4)} vs CONTROL ${ctlVal.outcomes.meanR.toFixed(4)} (within tolerance)`);
    }
  } else {
    notes.push(`validation quality comparison INSUFFICIENT (resolved sample < ${minN}): not used to reject, not used to accept`);
  }
  if (winnerScore.score < ctlScore.score) {
    blocking.push(`validation composite score ${winnerScore.score} < CONTROL ${ctlScore.score}`);
  }
  if (blocking.length) {
    return { chosen: "CONTROL", params: controlParams, reason: `validation gate rejected the TRAIN winner: ${blocking.join("; ")}`, gate: [...blocking, ...notes] };
  }
  return { chosen: "CALIBRATED", params: winner.params, reason: "TRAIN winner passed the validation gate", gate: notes };
}
