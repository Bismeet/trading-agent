// scripts/v2/episode.mjs — P3 episode state machine. Imports store.
import { V2, now, appendJSONL } from "./store.mjs";

export function freshV2State(cfg) {
  const t = now();
  const cap = cfg.v2.startingCapital;
  const ag = cfg.v2.aggression;
  return {
    version: 2,
    episodeNum: 1,
    episodeId: `ep_${t}_1`,
    startedAt: t,
    updatedAt: t,
    startingCapital: cap,
    walletBalance: cap,
    equity: cap,
    peakEquity: cap,
    maxDrawdownPct: 0,
    realizedPnlEpisode: 0,
    positions: {}, // Map-by-symbol serialized as object
    riskState: "normal",
    regime: "mixed_chop",
    generation: 1,
    aggression: {
      kellyFraction: ag.kellyFractionStart,
      leverageCap: ag.leverageStart,
      leverageCeiling: ag.leverageCeiling,
      unlockedLevel: 0,
    },
    goal: {
      target: cfg.v2.episode.goal.target,
      deadlineHours: cfg.v2.episode.goal.deadlineHours,
      startEquity: cap,
      startedAt: t,
    },
    importanceAccum: 0,
    closesSinceDeep: 0,
    lastDeepReflectTs: 0,
    cycles: 0,
    blownUp: false,
    lifetime: {
      episodes: 1,
      totalBlowups: 0,
      bestEpisodeReturnPct: 0,
      bestEquityEver: cap,
      careerStartedAt: t,
    },
    lastWorldDeepTs: 0,
    lastWorldRegime: "neutral",
    fundingRate: null,
  };
}

export function recordEquityPeak(state) {
  if (state.equity > state.peakEquity) state.peakEquity = state.equity;
  const dd = state.peakEquity > 0 ? (100 * (state.peakEquity - state.equity)) / state.peakEquity : 0;
  if (dd > state.maxDrawdownPct) state.maxDrawdownPct = dd;
  if (state.equity > state.lifetime.bestEquityEver) state.lifetime.bestEquityEver = state.equity;
  return dd;
}

// End precedence: blowup -> goal -> time (docs/11). Owner may override hours per episode.
export function episodeEndReason(state, cfg, nowTs = now()) {
  const ep = cfg.v2.episode;
  const maxHours = Number.isFinite(state.episodeMaxHours) ? state.episodeMaxHours : ep.maxHoursPerEpisode;
  if (state.equity <= ep.blowupEquity) return "blowup";
  if (state.goal && state.equity >= state.goal.target) return "goal";
  if (nowTs - state.startedAt >= maxHours * 3600000) return "time";
  return null;
}

export function finalizeEpisode(state, reason, extra = {}) {
  const t = now();
  const rec = {
    episodeNum: state.episodeNum,
    episodeId: state.episodeId,
    startedAt: state.startedAt,
    endedAt: t,
    durationHours: (t - state.startedAt) / 3600000,
    startingCapital: state.startingCapital,
    finalEquity: state.equity,
    peakEquity: state.peakEquity,
    returnPct: state.startingCapital > 0 ? 100 * (state.equity / state.startingCapital - 1) : 0,
    maxDrawdownPct: state.maxDrawdownPct,
    blownUp: reason === "blowup",
    endReason: reason,
    generation: state.generation,
    ...extra,
  };
  appendJSONL(V2.episodes, rec);
  if (rec.blownUp) state.lifetime.totalBlowups += 1;
  if (rec.returnPct > state.lifetime.bestEpisodeReturnPct) state.lifetime.bestEpisodeReturnPct = rec.returnPct;
  return rec;
}

// Reset capital, preserve learning (docs/11 matrix).
export function nextEpisode(state, cfg) {
  const cap = cfg.v2.startingCapital;
  const t = now();
  const n = state.episodeNum + 1;
  state.episodeNum = n;
  state.episodeId = `ep_${t}_${n}`;
  state.startedAt = t;
  state.startingCapital = cap;
  state.walletBalance = cap;
  state.equity = cap;
  state.peakEquity = cap;
  state.maxDrawdownPct = 0;
  state.realizedPnlEpisode = 0;
  state.positions = {};
  state.riskState = "normal";
  state.blownUp = false;
  state.goal = {
    target: cfg.v2.episode.goal.target,
    deadlineHours: cfg.v2.episode.goal.deadlineHours,
    startEquity: cap,
    startedAt: t,
  };
  state.lifetime.episodes += 1;
  state.updatedAt = t;
  return state;
}

export function setGoal(state, target, deadlineHours) {
  state.goal = { target, deadlineHours, startEquity: state.equity, startedAt: now() };
  return state.goal;
}
