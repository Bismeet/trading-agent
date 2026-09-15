// scripts/v2/phase10-allocator.mjs — PHASE 10: the offline opportunity allocator.
//
// Deterministic, causal, offline. At every decision bar the allocator collects
// the ELIGIBLE opportunities (cells locked from TRAIN+VALIDATION only), ranks
// them by their Bayesian-shrunk, volatility-normalised expected-R score minus
// the uncertainty penalty, applies the pre-registered correlation penalty
// against everything already open, and admits positions while the pre-registered
// exposure limits and the fixed risk budget allow. Everything else stays FLAT:
// knowing when NOT to trade is the deliverable.
//
// No randomness, no neural networks, no LLM, no fitting on TEST.
import { utcDateOf } from "./alpha-features.mjs";
import { emptyStats, pushStats, finishStats } from "./alpha-metrics.mjs";

const DAY_MS = 86400000;

// Deterministic pairwise correlation proxy from the pre-registered matrix.
export function correlationOf(a, b, matrix) {
  if (a.symbol === b.symbol) return matrix.sameSymbol;
  if (a.market === b.market) return matrix.sameMarket;
  return matrix.differentMarket;
}

// ---- simulation ----------------------------------------------------------------
// occurrences: [{i, symbol, market, k, ts, side, signalId, regime, horizonHours,
//                fold, cellKey, geometry}] sorted by (ts, symbol, ...).
// measurements: measurements[i] = measureHorizon output for occurrences[i]
//   (entry at the decision bar's close). For a NEXT-OPEN entry pass a
//   measurement with entryMode "nextOpen" (its entryIdx/exitIdx are honoured).
// eligible: Map cellKey -> score (> 0 required). Missing cell => FLAT.
export function simulateAllocator({
  occurrences, measurements, eligible, allocSpec, geometryOf, correlate = null,
}) {
  const maxTotal = allocSpec.totalRiskUnits;
  const maxPerSymbol = allocSpec.maxConcurrentPerSymbol;
  const maxPerMarket = allocSpec.maxConcurrentPerMarket;

  const order = occurrences.map((o, i) => i).sort((a, b) => {
    const oa = occurrences[a], ob = occurrences[b];
    return oa.ts - ob.ts || oa.symbol.localeCompare(ob.symbol) || a - b;
  });

  const open = [];              // { symbol, market, exitIdx }
  const trades = [];
  const funnel = { occurrences: 0, flat_no_cell: 0, flat_non_positive_score: 0, flat_penalty: 0, unresolved: 0, limit_symbol: 0, limit_market: 0, limit_total: 0, admitted: 0 };

  // expire positions whose exit bar is strictly before bar k
  const expire = (k) => {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exitIdx < k) open.splice(i, 1);
  };
  const countBy = (key, val) => open.reduce((a, p) => a + (p[key] === val ? 1 : 0), 0);

  let i = 0;
  while (i < order.length) {
    const bar = order[i];
    const k = occurrences[bar].k;
    // group every occurrence at the same decision bar
    let j = i;
    const group = [];
    while (j < order.length && occurrences[order[j]].ts === occurrences[bar].ts && occurrences[order[j]].k === k) {
      group.push(order[j]); j++;
    }
    i = j;
    funnel.occurrences += group.length;
    expire(k);

    // candidates at this bar
    const cands = [];
    for (const idx of group) {
      const o = occurrences[idx];
      const m = measurements[idx];
      const score = eligible.get(o.cellKey);
      if (score == null) { funnel.flat_no_cell += 1; continue; }
      if (!(score > 0)) { funnel.flat_non_positive_score += 1; continue; }
      if (!m || !m.resolved) { funnel.unresolved += 1; continue; }
      cands.push({ idx, o, m, score, rhoMax: 0, adjusted: score });
    }
    if (cands.length === 0) continue;

    // Greedy deterministic admission. Each round re-ranks every remaining
    // candidate by its penalty-adjusted score against EVERYTHING currently
    // open (including candidates admitted earlier in this very bar), then the
    // best one is admitted if the exposure limits allow. This is exactly the
    // pre-registered rule: score x (1 - rho_max).
    const byAdjusted = (a, b) =>
      b.adjusted - a.adjusted
      || a.o.signalId.localeCompare(b.o.signalId)
      || a.o.regime.localeCompare(b.o.regime)
      || a.o.side.localeCompare(b.o.side)
      || a.o.horizonHours - b.o.horizonHours
      || a.idx - b.idx;
    const remaining = [...cands];
    while (remaining.length > 0) {
      for (const c of remaining) {
        let rho = 0;
        for (const p of open) rho = Math.max(rho, correlate ? correlate(c.o, p) : 0);
        c.rhoMax = rho;
        c.adjusted = c.score * (1 - rho);
      }
      remaining.sort(byAdjusted);
      const c = remaining.shift();
      if (!(c.adjusted > 0)) { funnel.flat_penalty += 1; continue; }
      const o = c.o;
      if (countBy("symbol", o.symbol) >= maxPerSymbol) { funnel.limit_symbol += 1; continue; }
      if (countBy("market", o.market) >= maxPerMarket) { funnel.limit_market += 1; continue; }
      if (open.length >= maxTotal) { funnel.limit_total += 1; continue; }
      const exitIdx = Math.max(o.k + 1, c.m.exitIdx ?? o.k + 1);
      open.push({ symbol: o.symbol, market: o.market, exitIdx });
      funnel.admitted += 1;
      trades.push({
        i: c.idx, cellKey: o.cellKey, signalId: o.signalId, regime: o.regime, side: o.side,
        horizonHours: o.horizonHours, symbol: o.symbol, market: o.market, fold: o.fold,
        ts: o.ts, utc: utcDateOf(o.ts), k: o.k,
        entryIdx: c.m.entryIdx ?? o.k, exitIdx,
        holdHours: c.m.holdHours ?? (exitIdx - o.k),
        entryRef: c.m.entryRef, exitRef: c.m.exitRef,
        rawBps: c.m.rawBps, grossBps: c.m.grossBps, netBps: c.m.netBps, costBps: c.m.costBps,
        feeBps: c.m.feeBps, slipBps: c.m.slipBps,
        netPnl: c.m.netPnl, grossPnl: c.m.grossPnl, costUsd: c.m.costUsd,
        realized_R: c.m.realized_R, exit_reason: c.m.exit_reason, censored: !!c.m.censored,
        score: c.score, rhoMax: c.rhoMax, adjustedScore: c.adjusted,
        geometry: geometryOf(o),
      });
    }
  }
  return { trades, funnel };
}

// geometry hook (per-occurrence leverage/stop/target for the summary)
export const defaultGeometryOf = (spec) => (o) => spec.allocator.geometry[o.geometryKey ?? "alpha_breakout"] ?? spec.allocator.geometry.alpha_breakout;

// ---- portfolio metrics ----------------------------------------------------------
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const stdOf = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
};
const monthKeyOf = (ms) => utcDateOf(ms).slice(0, 7);
const isoWeekKeyOf = (ms) => {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);                 // move to this week's Thursday
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const wk = 1 + Math.round((t - firstThu) / (7 * DAY_MS));
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
};

// Deterministic portfolio metrics from the trade list (spec.portfolioMetrics).
// P&L is attributed to the UTC day on which each trade EXITS.
export function portfolioMetrics(trades, { equityStartUsd, firstTs, lastTs }) {
  const resolved = trades.filter((t) => Number.isFinite(t.netPnl));
  const firstDay = utcDateOf(firstTs), lastDay = utcDateOf(lastTs);
  const pnlByDay = {};
  for (const t of resolved) pnlByDay[t.utc] = (pnlByDay[t.utc] ?? 0) + t.netPnl;

  // daily equity grid (every UTC day in range, zero P&L when flat)
  const grid = [];
  const t0 = Date.parse(firstDay + "T00:00:00Z"), t1 = Date.parse(lastDay + "T00:00:00Z");
  for (let ts = t0; ts <= t1; ts += DAY_MS) grid.push(utcDateOf(ts));
  let eq = equityStartUsd, peak = equityStartUsd, maxDD = 0, underwaterDays = 0;
  const equityByDay = [];
  const dailyRet = [];
  for (const d of grid) {
    const prevEq = eq;
    eq += pnlByDay[d] ?? 0;
    equityByDay.push({ day: d, equity: eq });
    const r = prevEq > 0 ? eq / prevEq - 1 : 0;
    dailyRet.push(Number.isFinite(r) ? r : 0);
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const dd = (peak - eq) / peak;
      if (dd > maxDD) maxDD = dd;
      if (eq < peak) underwaterDays += 1;
    }
  }
  const ret = dailyRet.filter((r) => Number.isFinite(r));
  const m = mean(ret), sd = stdOf(ret);
  const downside = ret.filter((r) => r < 0);
  const dsd = downside.length ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length) : null;
  const years = (t1 - t0) / (365 * DAY_MS);
  const total = eq / equityStartUsd;
  const cagr = years > 0 && total > 0 ? Math.pow(total, 1 / years) - 1 : null;

  const grossProfit = resolved.filter((t) => t.grossPnl > 0).reduce((a, t) => a + t.grossPnl, 0);
  const grossLoss = resolved.filter((t) => t.grossPnl < 0).reduce((a, t) => a + Math.abs(t.grossPnl), 0);
  const netTotal = resolved.reduce((a, t) => a + t.netPnl, 0);
  const grossTotal = resolved.reduce((a, t) => a + t.grossPnl, 0);
  const costTotal = resolved.reduce((a, t) => a + (t.costUsd ?? 0), 0);
  const wins = resolved.filter((t) => t.netPnl > 0);

  const rList = resolved.map((t) => t.realized_R).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => (rList.length ? rList[Math.min(rList.length - 1, Math.max(0, Math.round(p * (rList.length - 1))))] : null);
  const tailN = Math.max(1, Math.ceil(0.05 * rList.length));
  const tailR = rList.length ? mean(rList.slice(0, tailN)) : null;

  // exposure: bar-level sweep of open positions (positions counted on [entry, exit])
  const totalBars = grid.length * 24;
  const events = [];
  for (const t of resolved) { events.push([t.entryIdx, 1]); events.push([t.exitIdx + 1, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let coveredBars = 0, openNow = 0, maxOpen = 0, prev = null;
  for (const [bar, delta] of events) {
    if (prev != null && openNow > 0) coveredBars += Math.min(bar, totalBars) - prev;
    openNow += delta;
    if (openNow > maxOpen) maxOpen = openNow;
    prev = bar;
  }
  if (prev != null && openNow > 0) coveredBars += Math.max(0, totalBars - prev);
  const exposure = coveredBars / Math.max(1, totalBars);
  const avgConcurrent = coveredBars / Math.max(1, totalBars);

  // concentration: largest share of GROSS PROFIT by symbol / cell / market
  const shareOf = (keyFn) => {
    const by = {};
    let tot = 0;
    for (const t of resolved) { const k = keyFn(t); const v = Math.max(0, t.grossPnl); by[k] = (by[k] ?? 0) + v; tot += v; }
    return tot > 0 ? Math.max(...Object.values(by)) / tot : null;
  };

  // correlation: mean pairwise correlation of daily P&L between symbols
  const symbols = [...new Set(resolved.map((t) => t.symbol))].sort();
  const dailyBySymbol = {};
  for (const s of symbols) dailyBySymbol[s] = {};
  for (const t of resolved) dailyBySymbol[t.symbol][t.utc] = (dailyBySymbol[t.symbol][t.utc] ?? 0) + t.netPnl;
  const pairs = [];
  for (let a = 0; a < symbols.length; a++) for (let b = a + 1; b < symbols.length; b++) {
    const A = dailyBySymbol[symbols[a]], B = dailyBySymbol[symbols[b]];
    const common = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
    if (common.length < 20) continue;
    const xa = common.map((d) => A[d] ?? 0), xb = common.map((d) => B[d] ?? 0);
    const ma = mean(xa), mb = mean(xb);
    const sa = stdOf(xa), sb = stdOf(xb);
    if (!sa || !sb) continue;
    const cov = xa.reduce((s, v, i) => s + (v - ma) * (xb[i] - mb), 0) / xa.length;
    pairs.push(cov / (sa * sb));
  }

  // period extremes (worst absolute P&L per period)
  const worstOf = (keyFn) => {
    const byKey = {};
    for (const t of resolved) { const k = keyFn(Date.parse(t.utc + "T00:00:00Z")); byKey[k] = (byKey[k] ?? 0) + t.netPnl; }
    const entries = Object.entries(byKey);
    return entries.length ? entries.reduce((w, e) => (e[1] < w[1] ? e : w), entries[0]) : null;
  };

  const daysCount = grid.length;
  const weeksCount = Math.max(1, daysCount / 7);

  return {
    trades: resolved.length,
    finalEquity: eq, equityStartUsd,
    totalReturn: total - 1,
    CAGR: cagr,
    annualizedVol: sd != null ? sd * Math.sqrt(365) : null,
    Sharpe: sd ? (m / sd) * Math.sqrt(365) : null,
    Sortino: dsd ? (m / dsd) * Math.sqrt(365) : null,
    Calmar: cagr != null && maxDD > 0 ? cagr / maxDD : null,
    maxDrawdown: maxDD,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    winRate: resolved.length ? wins.length / resolved.length : null,
    expectancy: resolved.length ? netTotal / resolved.length : null,
    netTotal, grossTotal, costTotal,
    costContribution: grossTotal > 0 ? costTotal / grossTotal : null,
    grossToNetDecay: grossTotal > 0 ? 1 - netTotal / grossTotal : null,
    turnoverTradesPerWeek: resolved.length / weeksCount,
    exposure, avgConcurrentOpen: avgConcurrent, maxConcurrentOpen: maxOpen,
    maxSymbolShare: shareOf((t) => t.symbol),
    maxCellShare: shareOf((t) => t.cellKey),
    maxMarketShare: shareOf((t) => t.market),
    meanPairCorrelation: pairs.length ? mean(pairs) : null,
    worstDay: worstOf((ts) => utcDateOf(ts)),
    worstWeek: worstOf((ts) => isoWeekKeyOf(ts)),
    worstMonth: worstOf((ts) => monthKeyOf(ts)),
    timeUnderwater: daysCount ? underwaterDays / daysCount : null,
    avgR: rList.length ? mean(rList) : null,
    medianR: q(0.5), p5R: q(0.05), p95R: q(0.95), tailR,
  };
}

// Fold-wise aggregation of a trade list (same stats shape as the cell layer).
export function foldStatsOfTrades(trades) {
  const out = { all: emptyStats({ list: true }), train: emptyStats({ list: true }), validation: emptyStats({ list: true }), test: emptyStats({ list: true }) };
  for (const t of trades) {
    const m = {
      resolved: Number.isFinite(t.netBps), rawBps: t.rawBps, grossBps: t.grossBps, netBps: t.netBps,
      costBps: t.costBps, feeBps: t.feeBps, slipBps: t.slipBps, mfeBps: 0, maeBps: 0,
      realized_R: t.realized_R, raw_R: 0, mfeCostRatio: 0, mfe_capture_ratio: 0, holdHours: t.holdHours,
      netPnl: t.netPnl, grossPnl: t.grossPnl, touchedTarget: /target|profit/.test(t.exit_reason ?? ""),
      touchedStop: /stop|liquidation|cut/.test(t.exit_reason ?? ""), favBeforeAdverse: true, timeToMfeBars: 0,
    };
    pushStats(out.all, m);
    if (t.fold && out[t.fold]) pushStats(out[t.fold], m);
  }
  return {
    all: finishStats(out.all),
    train: finishStats(out.train),
    validation: finishStats(out.validation),
    test: finishStats(out.test),
  };
}

// Deterministic trade-list digest (for the repeatability check).
export function tradesDigest(trades) {
  return trades
    .map((t) => `${t.symbol}|${t.cellKey}|${t.ts}|${Number(t.netBps ?? 0).toFixed(6)}|${Number(t.realized_R ?? 0).toFixed(6)}`)
    .sort().join(",");
}


