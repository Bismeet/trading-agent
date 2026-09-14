// scripts/v2/management-features.mjs — Phase 8 §10, §11, §12, §15, §16, §20.
//
// Post-entry state modeling, excursion analytics (MFE, MAE, MFE capture),
// portfolio exposure tracking, and value decomposition.
// Strictly CAUSAL: state transitions and metrics depend only on observations
// available up to the current post-entry timestamp.

// ---- 1. Post-Entry Trade State Classifier (§12) -----------------------------
export function classifyTradeState({
  relHours,
  mfeR = 0,
  maeR = 0,
  curR = 0,
  peakR = 0,
  stalledHours = 0,
  trendPersists = true,
  opposingSignal = false,
  closed = false,
}) {
  if (closed) return "EXIT";
  if (opposingSignal || !trendPersists) return "OPPOSING";
  if (maeR <= -0.5 && mfeR < 0.2) return "DETERIORATING";
  if (mfeR >= 0.5) {
    if (stalledHours >= 2.0) return "STALLED";
    return "FAVORABLE";
  }
  if (relHours < 1.0) return "INITIAL";
  return "DEVELOPING";
}

// ---- 2. MFE Capture Ratio (§10) ---------------------------------------------
// Proportion of available favorable excursion captured by the eventual exit.
// Realized R / MFE R (clamped [0, 1] when MFE > 0).
export function calcMfeCaptureRatio(realizedR, mfeR) {
  if (!Number.isFinite(mfeR) || mfeR <= 0.001) return 0.0;
  if (!Number.isFinite(realizedR) || realizedR <= 0) return 0.0;
  return Math.min(1.0, Math.max(0.0, realizedR / mfeR));
}

// ---- 3. Portfolio Exposure & Correlation Tracker (§15, §16) -----------------
export function createPortfolioTracker(cfg, spec) {
  const concurrentCap = spec?.portfolioControls?.concurrentCap ?? 5;
  const clusterSymbols = new Set(spec?.portfolioControls?.correlationClusters?.crypto_majors ?? []);
  const clusterMaxLong = spec?.portfolioControls?.correlationClusters?.clusterMaxLong ?? 2;

  // Active positions map by tradeId
  const activePositions = new Map();

  return {
    canOpen({ tradeId, symbol, side, ts }) {
      // Purge closed positions before ts
      for (const [id, pos] of activePositions.entries()) {
        if (pos.exitTs && pos.exitTs <= ts) {
          activePositions.delete(id);
        }
      }

      // Check concurrent position limit
      if (activePositions.size >= concurrentCap) {
        return { allowed: false, reason: `concurrent_cap_reached_${concurrentCap}` };
      }

      // Check correlation cluster limit
      if (clusterSymbols.has(symbol) && side === "long") {
        let clusterLongs = 0;
        for (const pos of activePositions.values()) {
          if (clusterSymbols.has(pos.symbol) && pos.side === "long") {
            clusterLongs += 1;
          }
        }
        if (clusterLongs >= clusterMaxLong) {
          return { allowed: false, reason: `correlation_cluster_max_longs_${clusterMaxLong}` };
        }
      }

      return { allowed: true, reason: "portfolio_limits_pass" };
    },

    registerOpen(pos) {
      activePositions.set(pos.tradeId, { ...pos });
    },

    registerClose(tradeId, exitTs) {
      if (activePositions.has(tradeId)) {
        activePositions.get(tradeId).exitTs = exitTs;
      }
    },

    metricsAt(ts) {
      let grossNotional = 0;
      let netNotional = 0;
      let marginUsed = 0;
      let openCount = 0;
      const strategyCounts = {};
      const sideCounts = { long: 0, short: 0 };

      for (const [id, pos] of activePositions.entries()) {
        if (pos.exitTs && pos.exitTs <= ts) continue;
        openCount += 1;
        const notional = (pos.marginUsd || 100) * (pos.leverage || 10);
        grossNotional += notional;
        netNotional += pos.side === "long" ? notional : -notional;
        marginUsed += (pos.marginUsd || 100);

        const s = pos.strategy_id || "unknown";
        strategyCounts[s] = (strategyCounts[s] || 0) + 1;
        if (pos.side === "long") sideCounts.long += 1;
        else if (pos.side === "short") sideCounts.short += 1;
      }

      return {
        ts,
        openCount,
        grossNotional,
        netNotional,
        marginUsed,
        strategyCounts,
        sideCounts,
      };
    },

    reset() {
      activePositions.clear();
    },
  };
}

// ---- 4. Management Value Decomposition (§20) --------------------------------
// Decomposes performance changes into distinct causal components:
//   Baseline A: CONTROL ENTRY + CONTROL MANAGEMENT
//   Baseline B: PHASE 7 FILTER + CONTROL MANAGEMENT
//   Policy C:   PHASE 7 FILTER + EXPERIMENTAL MANAGEMENT
//   Policy D:   PHASE 7 FILTER + EXPERIMENTAL MANAGEMENT + PORTFOLIO CONTROL
export function decomposeManagementValue({ netRA, netRB, netRC, netRD }) {
  const entryEffect = (netRB != null && netRA != null) ? netRB - netRA : 0;
  const managementEffect = (netRC != null && netRB != null) ? netRC - netRB : 0;
  const portfolioEffect = (netRD != null && netRC != null) ? netRD - netRC : 0;
  const totalNetEffect = (netRD != null && netRA != null) ? netRD - netRA : 0;

  return {
    netRA,
    netRB,
    netRC,
    netRD,
    entryEffect,
    managementEffect,
    portfolioEffect,
    totalNetEffect,
  };
}
