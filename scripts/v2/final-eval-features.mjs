// scripts/v2/final-eval-features.mjs — Phase 9 features, portfolio, and causal online learner.
//
// Strictly local, deterministic, and causal.
// Ensures zero future leakage for portfolio exposure and online learner updates.
import {
  emptyLearning, scoreCell, recordExperience, learnConfig,
} from "./learning.mjs";

export function getMarketOf(symbol, cfg) {
  const item = (cfg?.watchlist || []).find((w) => w.symbol === symbol);
  if (item?.market) return item.market;
  if (symbol.includes("-USD") || symbol.includes("USDT")) return "crypto";
  if (symbol.endsWith(".NS")) return "india";
  return "us";
}

// ---- Causal Online Learner State Machine ------------------------------------
// Updates learner state strictly upon trade resolution (exitTs <= current candidate ts).
// Zero forward-looking information; zero test leakage.
export function createCausalLearnerTracker(cfg, spec) {
  const L = learnConfig(cfg);
  const store = emptyLearning();
  const inFlight = []; // { exitTs, ctx, realizedR, extra }

  return {
    getStore() {
      return store;
    },
    getL() {
      return L;
    },
    // Progress time to currentTs and process all trades that closed at or before currentTs
    reconcile(currentTs) {
      let i = 0;
      while (i < inFlight.length) {
        const item = inFlight[i];
        if (item.exitTs <= currentTs) {
          recordExperience(store, item.ctx, item.realizedR, item.extra, L);
          inFlight.splice(i, 1);
        } else {
          i++;
        }
      }
    },
    // Evaluate whether candidate is admitted by the learner's empirical state
    evaluateCandidate(cand) {
      this.reconcile(cand.ts);

      const market = cand.market || getMarketOf(cand.symbol, cfg);
      const ctx = {
        regime: cand.trendContext || "unknown",
        strategy: cand.strategy_id,
        side: cand.side,
        symbol: cand.symbol,
        market,
      };

      const sc = scoreCell(store, ctx, L);
      const quality = Math.max(L.qualityLo, Math.min(L.qualityHi, 1 + L.qualityGain * sc.adjExp));
      const blocked = sc.blocked;
      const ucbTooLow = sc.ucb < L.noTradeUcb;
      const qualityTooLow = quality < L.noTradeQuality;

      const allowed = !blocked && !ucbTooLow && !qualityTooLow;
      let reason = "learner-admitted";
      if (blocked) reason = `blocked-by-negative-exp(${sc.adjExp.toFixed(3)})`;
      else if (ucbTooLow) reason = `ucb-below-zero(${sc.ucb.toFixed(3)})`;
      else if (qualityTooLow) reason = `quality-below-floor(${quality.toFixed(3)})`;

      return { allowed, reason, score: sc, quality };
    },
    // Register a newly entered trade to be learned upon completion
    registerTradeForLearning({ exitTs, cand, realizedR, exitReason }) {
      const market = cand.market || getMarketOf(cand.symbol, cfg);
      const ctx = {
        regime: cand.trendContext || "unknown",
        strategy: cand.strategy_id,
        side: cand.side,
        symbol: cand.symbol,
        market,
      };
      inFlight.push({
        exitTs,
        ctx,
        realizedR,
        extra: { ts_close: exitTs, exit_reason: exitReason },
      });
    },
  };
}

// ---- Final Portfolio & Risk Exposure Tracker --------------------------------
// Tracks concurrent positions, market cluster caps, and margin exposure.
export function createFinalPortfolioTracker(cfg, spec) {
  const maxConcurrent = spec?.portfolioLimits?.maxConcurrentPositions ?? cfg?.risk?.maxConcurrentPositions ?? 10;
  const maxSameSetup = spec?.portfolioLimits?.maxSameSetupPositions ?? cfg?.v2?.learning?.maxSameSetupPositions ?? 2;
  const clusterLimits = spec?.markets || {
    crypto: { maxLeverage: 40 },
    us: { maxLeverage: 4 },
    india: { maxLeverage: 5 },
  };

  const activePositions = []; // { tradeId, symbol, side, strategy_id, market, marginUsd, leverage, ts, exitTs }

  return {
    prune(currentTs) {
      let i = 0;
      while (i < activePositions.length) {
        if (activePositions[i].exitTs <= currentTs) {
          activePositions.splice(i, 1);
        } else {
          i++;
        }
      }
    },
    canOpen({ tradeId, symbol, side, strategy_id, market, ts }) {
      this.prune(ts);

      if (activePositions.length >= maxConcurrent) {
        return { allowed: false, reason: `max-concurrent-positions-reached(${maxConcurrent})` };
      }

      const sameSetup = activePositions.filter(
        (p) => p.symbol === symbol && p.side === side && p.strategy_id === strategy_id
      );
      if (sameSetup.length >= maxSameSetup) {
        return { allowed: false, reason: `max-same-setup-reached(${maxSameSetup})` };
      }

      // Max 2 positions per market cluster
      const marketPositions = activePositions.filter((p) => p.market === market);
      if (marketPositions.length >= 2) {
        return { allowed: false, reason: `market-cluster-limit-reached(${market}:2)` };
      }

      return { allowed: true, reason: "portfolio-check-passed" };
    },
    registerOpen(pos) {
      activePositions.push(pos);
    },
    getActiveCount() {
      return activePositions.length;
    },
    getActivePositions() {
      return [...activePositions];
    },
  };
}
