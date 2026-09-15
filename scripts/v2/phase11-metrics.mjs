// scripts/v2/phase11-metrics.mjs — PHASE 11: evaluation metrics.
//
// Pure functions over the equity paths and decision series produced by
// phase11-rotation.mjs. Everything is deterministic and derived only from the
// frozen series, so the report can never disagree with the stored summary.
import { meanOf, medianOf, populationStd, spearman, tStatOfMean } from "./phase11-rotation.mjs";
import { deflatedSharpe } from "./brain.mjs";

const DAY_MS = 86400000;

// ---- one global chronological split on the union grid --------------------------
export function globalSplit(n, splits) {
  const train = Math.floor(n * splits.train);
  const validation = Math.floor(n * splits.validation);
  return { train: [0, train], validation: [train, train + validation], test: [train + validation, n] };
}

export function subFoldBounds(bounds, k) {
  const [a, b] = bounds;
  const len = b - a;
  const out = [];
  for (let i = 0; i < k; i++) {
    const lo = a + Math.floor((len * i) / k);
    const hi = a + Math.floor((len * (i + 1)) / k);
    out.push([lo, hi]);
  }
  return out;
}

// Purge + embargo. Two conditions, both required:
//   EMBARGO: the decision index must be at least `embargo` bars after the fold start
//   PURGE:   the forward window [t, t + horizon] must close strictly inside the fold
export function admits({ t, foldStart, foldEnd, horizon, embargo }) {
  if (t < foldStart || t >= foldEnd) return false;
  if (t - foldStart < embargo) return false;
  if (t + horizon > foldEnd) return false;
  return true;
}

export function foldOf({ t, bounds, horizon, embargo }) {
  for (const name of ["train", "validation", "test"]) {
    const [a, b] = bounds[name];
    if (admits({ t, foldStart: a, foldEnd: b, horizon, embargo })) return name;
  }
  return null;
}

// ---- daily equity accounting ---------------------------------------------------
// The equity path is a per-grid-date series produced by the engine. Daily returns
// are simple returns on that path; a zero-return day (fully in cash) is a real
// observation and is kept, because cash days are a genuine property of the policy.
export function dailyReturns(days) {
  const out = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1].equity;
    const cur = days[i].equity;
    out.push({ date: days[i].date, r: prev > 0 ? cur / prev - 1 : 0 });
  }
  return out;
}

export function equityStats(days, { nTrials = 16, startEquity = 10000 } = {}) {
  if (!days?.length) return null;
  const rets = dailyReturns(days);
  const r = rets.map((x) => x.r);
  const m = meanOf(r) ?? 0;
  const sd = populationStd(r);
  const downside = r.filter((x) => x < 0);
  const dsd = downside.length ? Math.sqrt(downside.reduce((s, x) => s + x * x, 0) / downside.length) : null;

  let peak = days[0].equity, maxDD = 0, underwater = 0;
  for (const d of days) {
    if (d.equity > peak) peak = d.equity;
    if (peak > 0) {
      const dd = (peak - d.equity) / peak;
      if (dd > maxDD) maxDD = dd;
      if (d.equity < peak) underwater += 1;
    }
  }
  const spanDays = (Date.parse(days.at(-1).date) - Date.parse(days[0].date)) / DAY_MS;
  const years = spanDays / 365;
  const totalRet = days[0].equity > 0 ? days.at(-1).equity / days[0].equity - 1 : null;
  const cagr = years > 0 && days[0].equity > 0 && days.at(-1).equity > 0
    ? Math.pow(days.at(-1).equity / days[0].equity, 1 / years) - 1 : null;
  const annVol = sd != null ? sd * Math.sqrt(365) : null;
  const sharpe = sd ? (m / sd) * Math.sqrt(365) : null;
  const sortino = dsd ? (m / dsd) * Math.sqrt(365) : null;
  const calmar = cagr != null && maxDD > 0 ? cagr / maxDD : null;
  const totalCost = days.reduce((a, d) => a + (d.cost ?? 0), 0);
  // Weekly-frequency series for the Deflated Sharpe: the strategy trades on a
  // weekly grid, so the trial count and the sampling interval are both weekly.
  const weekly = [];
  for (let i = 5; i < rets.length; i += 5) {
    let acc = 1;
    for (let j = i - 4; j <= i; j++) acc *= 1 + rets[j].r;
    weekly.push(acc - 1);
  }
  const weeklyStats = (() => {
    if (weekly.length < 8) return null;
    const m = meanOf(weekly);
    const sd = populationStd(weekly);
    const annFac = Math.sqrt(52);
    const sharpe = sd ? (m / sd) * annFac : null;
    let peak = 1, dd = 0, eq = 1;
    for (const r of weekly) { eq *= 1 + r; if (eq > peak) peak = eq; if (peak > 0) dd = Math.max(dd, (peak - eq) / peak); }
    const years = weekly.length / 52;
    const cagr = years > 0 ? Math.pow(eq, 1 / years) - 1 : null;
    return { n: weekly.length, totalReturn: eq - 1, mean: m, sd, sharpe, maxDrawdown: dd, calmar: cagr != null && dd > 0 ? cagr / dd : null, cagr, deflatedSharpe: deflatedSharpe(weekly, nTrials) };
  })();
  return {
    returnSeries: rets,
    totalReturn: totalRet,
    finalEquity: days.at(-1).equity,
    netPnl: days.at(-1).equity - days[0].equity,
    annualizedReturn: cagr,
    annualizedVol: annVol,
    sharpe, sortino, calmar,
    maxDrawdown: maxDD,
    timeUnderwater: days.length ? underwater / days.length : null,
    spanDays, years, weeklyStats,
    meanDailyReturn: m,
    dailyVol: sd,
    totalCost,
    deflatedSharpe: deflatedSharpe(weekly.length >= 8 ? weekly : r, nTrials),
    deflatedSharpeDaily: deflatedSharpe(r, nTrials),
  };
}

// ---- folds ----------------------------------------------------------------------
// Slice a strategy's day series and decision series to a fold window, then compute
// the same statistics. Folds are applied on the UNION GRID, identically for every
// arm — nothing is re-anchored per strategy.
export function sliceDays(days, [a, b]) {
  return days.filter((d) => d.t >= a && d.t < b);
}

export function foldSeries(days, bounds, { nTrials = 16 } = {}) {
  const out = {};
  for (const name of ["train", "validation", "test"]) {
    const seg = sliceDays(days, bounds[name]);
    out[name] = seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null;
  }
  return out;
}

// ---- trade-level statistics ------------------------------------------------------
export function tradeStats(tradeLegs) {
  const legs = (tradeLegs || []).filter((l) => Number.isFinite(l.net));
  const nets = legs.map((l) => l.net);
  const grosses = legs.map((l) => l.gross);
  const rets = legs.map((l) => l.grossRet).filter(Number.isFinite);
  const wins = legs.filter((l) => l.net > 0);
  const gp = legs.filter((l) => l.net > 0).reduce((a, l) => a + l.net, 0);
  const gl = legs.filter((l) => l.net < 0).reduce((a, l) => a + Math.abs(l.net), 0);
  const cost = legs.reduce((a, l) => a + (l.cost ?? 0), 0);
  const horizonOf = (l) => (l.entryIdx != null && l.exitIdx != null ? l.exitIdx - l.entryIdx : null);
  const holds = legs.map(horizonOf).filter((h) => h != null && h > 0);
  return {
    n: legs.length,
    nWins: wins.length,
    winRate: legs.length ? wins.length / legs.length : null,
    profitFactor: gl > 0 ? gp / gl : null,
    avgTradeReturn: meanOf(rets),
    medianTradeReturn: medianOf(rets),
    avgTradePnl: meanOf(nets),
    medianTradePnl: medianOf(nets),
    grossPnl: grosses.reduce((a, b) => a + b, 0),
    netPnl: nets.reduce((a, b) => a + b, 0),
    costPnl: cost,
    avgHoldDays: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
    bestTrade: nets.length ? Math.max(...nets) : null,
    worstTrade: nets.length ? Math.min(...nets) : null,
  };
}

// mean return per holding, by symbol and by market cluster
export function contributionBy(tradeLegs, keyFn) {
  const by = {};
  for (const l of tradeLegs) {
    if (!Number.isFinite(l.net)) continue;
    const k = keyFn(l);
    by[k] = by[k] ?? { key: k, n: 0, net: 0, gross: 0, cost: 0, wins: 0 };
    by[k].n += 1;
    by[k].net += l.net;
    by[k].gross += l.gross ?? 0;
    by[k].cost += l.cost ?? 0;
    if (l.net > 0) by[k].wins += 1;
  }
  const total = Object.values(by).reduce((a, v) => a + v.net, 0);
  const positive = Object.values(by).reduce((a, v) => a + Math.max(0, v.net), 0);
  const rows = Object.values(by).map((v) => ({
    ...v,
    winRate: v.n ? v.wins / v.n : null,
    avgNet: v.n ? v.net / v.n : null,
    shareOfNet: total !== 0 ? v.net / total : null,
    // When there is NO positive net profit at all, no group can be said to
    // "contribute" profit: the concentration is maximal (1) rather than
    // undefined, because a gate that measures concentration of PROFIT cannot be
    // satisfied by a book that produced none.
    shareOfPositive: positive > 0 ? Math.max(0, v.net) / positive : (v.net > 0 ? 1 : 0),
  })).sort((a, b) => b.net - a.net);
  return { rows, total, positive, maxShareOfPositive: rows.length ? Math.max(...rows.map((r) => r.shareOfPositive)) : null };
}

// ---- cross-sectional rank evidence ------------------------------------------------
// At every decision bar with >= 5 eligible assets, correlate the decision-time
// relative-strength score with the FORWARD holding-period return. Only bars
// admitted by the purge/embargo rule for the fold under report are used, so no
// forward window straddles a boundary and no TEST information is touched before
// the lock.
export function rankEvidence({ decisions, grid, foldBounds, horizon, embargo, bucketCount = 4 }) {
  const forward = (s, t, h) => {
    const pIn = grid.eff[s]?.close?.[t];
    const pOut = grid.eff[s]?.close?.[t + h];
    if (!Number.isFinite(pIn) || !Number.isFinite(pOut) || pIn <= 0) return null;
    return pOut / pIn - 1;
  };
  const ics = [];
  const bucketed = [];       // per-bucket accumulator over raw forward returns
  const bucketNets = [];
  const spreads = [];
  for (const d of decisions) {
    const t = d.t;
    const fold = foldOf({ t, bounds: foldBounds, horizon, embargo });
    if (!fold) continue;
    const rows = [];
    for (const e of d.eligibleRows ?? []) {
      const fwd = forward(e.symbol, t, horizon);
      if (fwd != null) rows.push({ ...e, fwd });
    }
    if (rows.length < 5) continue;
    const ic = spearman(rows.map((r) => r.score), rows.map((r) => r.fwd));
    if (ic != null) ics.push(ic);

    // quantile buckets by score (rank split, deterministic)
    const sorted = rows.slice().sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    const per = Math.floor(sorted.length / bucketCount);
    if (per >= 1) {
      const buckets = [];
      for (let i = 0; i < bucketCount; i++) {
        const lo = i * per;
        const hi = i === bucketCount - 1 ? sorted.length : (i + 1) * per;
        buckets.push(sorted.slice(lo, hi));
      }
      buckets.forEach((b, i) => {
        const m = meanOf(b.map((x) => x.fwd));
        if (m == null) return;
        bucketed[i] = bucketed[i] ?? [];
        bucketed[i].push(m);
      });
      const top = meanOf(buckets[0].map((x) => x.fwd));
      const bottom = meanOf(buckets[bucketCount - 1].map((x) => x.fwd));
      if (top != null && bottom != null) spreads.push({ t, utc: d.utc, top, bottom, spread: top - bottom });
    }
    // top-K net measurement: forward return of the actually selected assets,
    // charged a pro-rata round trip using the frozen cost primitives
    const selRet = [];
    for (const s of d.selected) {
      const fwd = forward(s, t, horizon);
      if (fwd != null) selRet.push(fwd);
    }
    if (selRet.length) bucketNets.push({ t, utc: d.utc, n: selRet.length, mean: meanOf(selRet) });
  }
  const bucketMeans = bucketed.map((xs) => meanOf(xs));
  const idx = bucketMeans.map((_, i) => i);
  const monotonicity = spearman(idx, bucketMeans);
  const topMinusBottom = spreads.length ? meanOf(spreads.map((s) => s.spread)) : null;
  const topMinusBottomNet = spreads.length ? meanOf(spreads.map((s) => s.spread - 0.003)) : null; // one round trip at the frozen worst-market rate
  return {
    nBars: ics.length,
    rankIC: meanOf(ics),
    rankICTstat: tStatOfMean(ics),
    rankICSd: populationStd(ics),
    rankICPositiveShare: ics.length ? ics.filter((x) => x > 0).length / ics.length : null,
    bucketMeans,
    bucketCount,
    rankMonotonicity: monotonicity,
    topMinusBottomSpread: topMinusBottom,
    topMinusBottomSpreadNet: topMinusBottomNet,
    spreadTstat: spreads.length ? tStatOfMean(spreads.map((s) => s.spread)) : null,
    nSpreadBars: spreads.length,
    topKForwardMean: bucketNets.length ? meanOf(bucketNets.map((b) => b.mean)) : null,
    topKForwardTstat: tStatOfMean(bucketNets.map((b) => b.mean)),
    topKBars: bucketNets.length,
  };
}

// ---- excess return vs a baseline ------------------------------------------------
// Identical grid, identical fold window: difference the two daily return series
// date by date. The result is reported as a mean WEEKLY excess return (the horizon
// the strategy actually trades on) together with its t-statistic on the raw daily
// differences, and the number of daily observations so the power is visible.
export function excessVs(strategyStats, baselineStats) {
  if (!strategyStats?.returnSeries || !baselineStats?.returnSeries) return null;
  const bByDate = new Map(baselineStats.returnSeries.map((x) => [x.date, x.r]));
  const diffs = [];
  for (const x of strategyStats.returnSeries) {
    const b = bByDate.get(x.date);
    if (b == null) continue;
    diffs.push(x.r - b);
  }
  if (!diffs.length) return null;
  const meanDaily = meanOf(diffs);
  const tDaily = tStatOfMean(diffs);
  return {
    nDays: diffs.length,
    meanDailyExcess: meanDaily,
    meanWeeklyExcess: meanDaily * 5,
    tStatDaily: tDaily,
    // weekly-frequency t-stat: one observation per 5-day block
    tStatWeekly: (() => {
      const blocks = [];
      for (let i = 0; i + 5 <= diffs.length; i += 5) blocks.push(diffs.slice(i, i + 5).reduce((a, b) => a + b, 0));
      return tStatOfMean(blocks);
    })(),
    nWeeks: Math.floor(diffs.length / 5),
    positiveShare: diffs.filter((x) => x > 0).length / diffs.length,
  };
}

// ---- digest for the repeatability check -------------------------------------------
export const equityDigest = (days) => days.map((d) => `${d.date}:${d.equity.toFixed(6)}`).join("|");
