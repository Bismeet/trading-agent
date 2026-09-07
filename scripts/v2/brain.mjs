// scripts/v2/brain.mjs — P6: statistics, lifecycle, lessons, retrieval, evolution.
import {
  V2, readJSON, writeJSON, appendJSONL, readJSONL, now, iso, sha256,
  mean, stdev, expectancyStats, clamp,
} from "./store.mjs";

// ---- Distribution helpers (P6 named; [DECISION] Acklam + erf approximation) ----
export function erf(x) {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
export const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

// Acklam inverse normal CDF
export function normInv(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425, phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// [DECISION] population standardized central moments; kurtosis is Pearson (not excess).
export function skewness(rs) {
  const a = (rs || []).filter(Number.isFinite);
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  const m2 = a.reduce((x, y) => x + (y - m) ** 2, 0) / n;
  if (m2 === 0) return 0;
  const m3 = a.reduce((x, y) => x + (y - m) ** 3, 0) / n;
  return m3 / Math.pow(m2, 1.5);
}
export function kurtosis(rs) {
  const a = (rs || []).filter(Number.isFinite);
  const n = a.length;
  if (n < 2) return 3;
  const m = mean(a);
  const m2 = a.reduce((x, y) => x + (y - m) ** 2, 0) / n;
  if (m2 === 0) return 3;
  const m4 = a.reduce((x, y) => x + (y - m) ** 4, 0) / n;
  return m4 / (m2 * m2);
}

// Exact P6 Deflated Sharpe (docs/08). Pass uses unrounded DSR > .95.
export function deflatedSharpe(rs, nTrials) {
  const a = (rs || []).filter(Number.isFinite);
  const n = a.length;
  const s = stdev(a);
  if (n < 8 || s == null || s === 0) return { sr: 0, dsr: 0, sr0: 0, pass: false };
  const SR = mean(a) / s;
  const N = Math.max(2, nTrials || 2);
  const gamma = 0.5772156649;
  const emax = (1 - gamma) * normInv(1 - 1 / N) + gamma * normInv(1 - 1 / (N * Math.E));
  const varSR = 1 / (n - 1);
  const SR0 = Math.sqrt(varSR) * emax;
  const sk = skewness(a), ku = kurtosis(a);
  const denom = Math.sqrt(Math.max(1e-6, 1 - sk * SR + ((ku - 1) / 4) * SR * SR));
  const dsrRaw = normCdf(((SR - SR0) * Math.sqrt(n - 1)) / denom);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { sr: r3(SR), dsr: r3(dsrRaw), sr0: r3(SR0), pass: dsrRaw > 0.95 };
}

// ---- Journal join (P6) ----
// [DECISION] journal rows carry {kind:"pre"|"post", trade_id, ...}; join first,
// filter by close timestamp afterward (docs/12 recommendation).
export function loadClosedV2(sinceTs = 0) {
  const rows = readJSONL(V2.journal, 6000);
  const pre = new Map(), post = new Map();
  for (const r of rows) {
    if (!r || !r.trade_id) continue;
    if (r.kind === "pre" && !pre.has(r.trade_id)) pre.set(r.trade_id, r);
    else if (r.kind === "post" && !post.has(r.trade_id)) post.set(r.trade_id, r);
  }
  const out = [];
  for (const [id, p] of post) {
    const a = pre.get(id);
    if (!a) continue; // no fabricated closed trade without a pre row
    if (sinceTs && p.ts_close < sinceTs) continue;
    out.push({
      trade_id: id,
      symbol: a.symbol,
      market: a.market,
      strategy_id: a.strategy_id ?? null,
      setup_tag: a.setup_tag ?? null,
      regime: a.regime ?? null, // entry-time attribution frozen from pre row
      side: a.side,
      exit_reason: p.exit_reason ?? null,
      net_pnl: p.net_pnl,
      realized_R: p.realized_R,
      roi_on_margin: p.roi_on_margin,
      ts_close: p.ts_close,
      hold_secs: p.hold_secs,
    });
  }
  return out.sort((x, y) => x.ts_close - y.ts_close);
}

// ---- Importance map — exact P6 values ----
export const IMPORTANCE = {
  liquidation: 10, "capital-floor": 10, "stop-loss": 7, "episode-end": 6,
  "take-profit": 5, "trailing-stop": 4, "trend-flip": 3, "rsi2-reverted": 3,
  "manual-close": 3, "strategy-exit": 3,
};

export function onClose(state, pos, reasonTag) {
  state.importanceAccum = (state.importanceAccum ?? 0) + (IMPORTANCE[reasonTag] ?? 2);
  state.closesSinceDeep = (state.closesSinceDeep ?? 0) + 1;
}

// ---- Hash-chained reflog ----
function reflogWrite(event) {
  const rows = readJSONL(V2.reflog, 1);
  const prev = rows.length ? rows[rows.length - 1].hash : "GENESIS";
  const base = { ts: now(), iso: iso(), prev, ...event };
  appendJSONL(V2.reflog, { ...base, hash: sha256(JSON.stringify(base)) });
}
// ---- Strategy Kelly (exact P6; docs/12) ----
export function strategyKelly(s) {
  const n = s.n ?? 0;
  let k;
  if (n < 5) {
    k = s.backtest_failed ? 0.04 : 0.12;
  } else {
    const variance = Number.isFinite(s.variance_R) && s.variance_R > 0 ? s.variance_R : null;
    k = variance ? 0.4 * clamp(s.expectancy_R / variance, 0, 1.5) : 0.02;
  }
  // [DECISION] blend live Kelly with backtest prior pseudo-count 15 (docs/08 recommendation).
  if (Number.isFinite(s.backtest_kelly) && n >= 5) k = (n * k + 15 * s.backtest_kelly) / (n + 15);
  if (s.status === "probation") k /= 2;
  if (s.status === "retired") k = 0.02;
  return clamp(k, 0.02, 0.40);
}

// ---- scoreStrategies: stats, lifecycle gates, confidence/Kelly, reflog (P6) ----
export function scoreStrategies(state, cfg) {
  const lib = readJSON(V2.strategies, { strategies: [] });
  const closed = loadClosedV2(0);
  const nTrials = lib.strategies.length || 2;
  const tNeed = 3 + 0.25 * (nTrials - 1); // 4.25 for six seeds
  for (const s of lib.strategies) {
    const rs = closed.filter((c) => c.strategy_id === s.id).map((c) => c.realized_R).filter(Number.isFinite);
    const stats = expectancyStats(rs);
    const dsr = deflatedSharpe(rs, nTrials);
    const m = mean(rs);
    s.n = stats.n;
    s.expectancy_R = stats.expectancyR;
    s.win_rate = stats.winRate;
    s.profit_factor = stats.profitFactor;
    s.sqn = stats.sqn;
    s.dsr = dsr.dsr;
    s.wilson_lb = stats.wilsonLb;
    s.breakeven_wr = stats.breakevenWr;
    s.variance_R = rs.length > 1 && stdev(rs) != null ? stdev(rs) ** 2 : null;
    // [DECISION] confidence mapping: base .2 scaled by Wilson LB of win rate.
    s.confidence = stats.n > 0 && stats.wilsonLb != null ? clamp(0.2 + stats.wilsonLb, 0.05, 0.95) : 0.2;
    const prevStatus = s.status;
    if (s.status === "candidate" && stats.n >= 30) {
      const gates =
        (stats.wilsonLb != null && stats.breakevenWr != null && stats.wilsonLb > stats.breakevenWr) &&
        (stats.profitFactor != null && stats.profitFactor >= 1.5) &&
        stats.sqn >= 1.5 && stats.expectancyR > 0 && stats.tStat > tNeed && dsr.pass;
      if (gates) s.status = "active";
    } else if (s.status === "active") {
      const recent = rs.slice(-30);
      const rStats = expectancyStats(recent);
      if ((rStats.profitFactor != null && rStats.profitFactor < 1.2) || rStats.expectancyR < 0 || stats.sqn < 1.0) {
        s.status = "probation";
        s.probationFails = 0;
      }
    } else if (s.status === "probation") {
      const recent = rs.slice(-30);
      const rStats = expectancyStats(recent);
      if (rStats.profitFactor != null && rStats.profitFactor >= 1.5 && rStats.expectancyR > 0) {
        s.status = "active";
      } else {
        // [DECISION] retirement threshold: 3 consecutive failing checks.
        s.probationFails = (s.probationFails ?? 0) + 1;
        if (s.probationFails >= 3) s.status = "retired";
      }
    }
    s.kelly = strategyKelly(s);
    if (s.status !== prevStatus) {
      reflogWrite({ event: "lifecycle", strategy_id: s.id, from: prevStatus, to: s.status, generation: state.generation });
    }
  }
  writeJSON(V2.strategies, lib);
  return lib;
}

// ---- Memory (P6) ----
export function addMemory(rec) {
  const t = now();
  appendJSONL(V2.memory, { id: `m_${t}_${sha256(JSON.stringify(rec))}`, createdAt: t, ...rec });
}

// [DECISION] worst/best groups ranked by total net_pnl (docs/12 leaves metric open).
export function distillEpisodeLessons(state, rec, closedThisEp) {
  if (rec.blownUp) {
    const byGroup = groupPnL(closedThisEp);
    const worst = byGroup[0];
    addMemory({
      title: `Run ${rec.episodeNum} blew up`,
      kind: "blowup",
      text: worst
        ? `Blew up (return ${rec.returnPct.toFixed(1)}%). Worst: ${worst.key} at ${worst.pnl.toFixed(2)} USD. Cut size sooner when the regime turns against open risk.`
        : `Blew up (return ${rec.returnPct.toFixed(1)}%). Reduce leverage and respect stops before adding risk.`,
      regime: state.regime,
      importance: 10,
    });
    return;
  }
  if (!closedThisEp.length) {
    addMemory({
      title: `Run ${rec.episodeNum}: no trades`,
      kind: "note",
      text: "No trades this run. Consider broader entry gates or more symbols if signals stay silent.",
      regime: state.regime,
      importance: 2,
    });
    return;
  }
  const groups = groupPnL(closedThisEp);
  const worst = groups[0], best = groups[groups.length - 1];
  if (worst && worst.pnl < 0) {
    addMemory({
      title: `Loss cluster: ${worst.key}`,
      kind: "loss",
      text: `${worst.key} lost ${Math.abs(worst.pnl).toFixed(2)} USD over ${worst.n} trades in run ${rec.episodeNum}. Tighten entries for this strategy/regime pair.`,
      regime: worst.regime,
      importance: 7,
    });
  }
  if (best && best.pnl > 0) {
    addMemory({
      title: `Win cluster: ${best.key}`,
      kind: "win",
      text: `${best.key} made ${best.pnl.toFixed(2)} USD over ${best.n} trades in run ${rec.episodeNum}. Conditions favored this setup.`,
      regime: best.regime,
      importance: 5,
    });
  }
}

function groupPnL(closed) {
  const map = new Map();
  for (const c of closed) {
    const key = `${c.strategy_id ?? "manual"}/${c.regime ?? "unknown"}`;
    const g = map.get(key) || { key, regime: c.regime, pnl: 0, n: 0 };
    g.pnl += c.net_pnl ?? 0;
    g.n += 1;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => a.pnl - b.pnl);
}

// Exact P6 retrieval: last 500, score=importance*.95^ageDays*relevance, k=4.
export function retrieveLessons(regime, k = 4) {
  const rows = readJSONL(V2.memory, 500);
  const t = now();
  return rows
    .map((m) => {
      const ageDays = Math.max(0, (t - (m.createdAt ?? t)) / 86400000);
      const relevance = m.regime === regime ? 1 : 0.4;
      return { ...m, score: (m.importance ?? 1) * Math.pow(0.95, ageDays) * relevance };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---- Brain digest + world passthrough (P6) ----
export function buildBrainV2(state, regimeStr) {
  const lib = readJSON(V2.strategies, { strategies: [] });
  const gens = readJSONL(V2.generations, 30).reverse();
  const lessons = retrieveLessons(regimeStr, 4);
  return {
    generation: state.generation,
    episode: state.episodeNum,
    regime: regimeStr,
    aggression: state.aggression,
    importance: state.importanceAccum ?? 0,
    lifetime: state.lifetime,
    strategies: lib.strategies,
    activeCount: lib.strategies.filter((s) => s.status === "active").length,
    avoid: lib.strategies.filter((s) => s.status === "retired" || s.status === "probation").map((s) => s.id),
    lessons,
    generations: gens,
  };
}

// Read-only passthrough; does NOT collect external data (docs/12).
export function collectWorldV2() {
  return readJSON(V2.world, null);
}

// ---- onEpisodeEnd (exact P6 aggression transitions; docs/11) ----
export function onEpisodeEnd(state, cfg, rec) {
  scoreStrategies(state, cfg);
  const closedThisEp = loadClosedV2(rec.startedAt);
  distillEpisodeLessons(state, rec, closedThisEp);
  const edges = closedThisEp.map((c) => c.realized_R).filter(Number.isFinite);
  const edge = edges.length ? mean(edges) : 0;
  const ag = state.aggression;
  const hitGoal = rec.endReason === "goal";
  const timedOutInProfit = rec.endReason === "time" && rec.finalEquity > rec.startingCapital;
  if ((hitGoal || timedOutInProfit) && edge > 0) {
    ag.unlockedLevel += 1;
    ag.kellyFraction += 0.07 * clamp(edge, 0.2, 1.2);
  } else if (rec.endReason === "blowup") {
    ag.unlockedLevel -= 1;
    ag.kellyFraction -= 0.03;
  }
  // [DECISION] account Kelly lower bound .02, clamp to configured max .7 (C06 resolution).
  ag.kellyFraction = clamp(ag.kellyFraction, 0.02, cfg.v2.aggression.kellyFractionMax);
  const A = cfg.v2.aggression;
  ag.leverageCap = clamp(A.leverageStart + ag.unlockedLevel * A.earnItUnlockStep, A.leverageStart, A.leverageCeiling);
  state.generation += 1;
  const note = `After run ${rec.episodeNum} (${rec.endReason}, ${rec.returnPct.toFixed(1)}%): leverage cap ${ag.leverageCap}x, Kelly ${ag.kellyFraction.toFixed(2)}.`;
  appendJSONL(V2.generations, {
    generation: state.generation,
    episodeNum: rec.episodeNum,
    ts: now(),
    aggression: { ...ag },
    note,
  });
  reflogWrite({ event: "generation", generation: state.generation, episodeNum: rec.episodeNum, note });
}

// ---- evolveTick (P6/P8; 8-minute cadence) ----
// [DECISION] "a little" = +/-1 level and +/-0.02 Kelly; only counts trades closed
// since the last evolve tick (fresh-sample requirement from docs/11 recommendation).
export function evolveTick(state, cfg) {
  const closed = loadClosedV2(0);
  if (closed.length < 4) return;
  const lastTs = state.lastEvolveTs ?? 0;
  const fresh = closed.filter((c) => c.ts_close > lastTs);
  if (!fresh.length) return; // unchanged sample must not retrigger
  state.lastEvolveTs = now();
  const rs = closed.slice(-25).map((c) => c.realized_R).filter(Number.isFinite);
  const edge = rs.length ? mean(rs) : 0;
  const dd = state.peakEquity > 0 ? (100 * (state.peakEquity - state.equity)) / state.peakEquity : 0;
  const ag = state.aggression;
  let delta = 0;
  if (edge > 0.05 && state.equity > state.startingCapital && dd < 15) delta = 1;
  else if (edge < -0.05 || dd >= 18) delta = -1;
  if (delta) {
    ag.unlockedLevel += delta;
    ag.kellyFraction = clamp(ag.kellyFraction + 0.02 * delta, 0.02, cfg.v2.aggression.kellyFractionMax);
    const A = cfg.v2.aggression;
    ag.leverageCap = clamp(A.leverageStart + ag.unlockedLevel * A.earnItUnlockStep, A.leverageStart, A.leverageCeiling);
    reflogWrite({ event: "evolve", delta, edge, dd, generation: state.generation, aggression: { ...ag } });
  }
}
