// scripts/v2/selection-rules.mjs — Phase 7 §9, §11, §12.
//
// Deterministic candidate selection rules (TAKE vs ABSTAIN).
// Evaluates a candidate signal against a pre-registered rule using ONLY
// pre-trade causal context features.
//
// Baseline:
//   RULE_TAKE_ALL: takes 100% of signals (production CONTROL baseline)
//
// Pre-registered candidate rules:
//   - Trend filters (alignment, strength)
//   - Volatility filters (expansion, quintile)
//   - Cost-aware filters (expected move / friction ratio)
//   - Momentum confirmation
//   - Structure (range expansion)
//   - Cross-strategy confirmation
//   - Bounded composites (max 3 conditions)

export function evaluateSelectionRule(ruleId, cand, features) {
  switch (ruleId) {
    case "RULE_TAKE_ALL":
      return { take: true, reason: "baseline_admit_all" };

    case "RULE_TREND_ALIGN":
      return features.trend_agree
        ? { take: true, reason: "trend_aligned" }
        : { take: false, reason: "counter_trend" };

    case "RULE_TREND_STRENGTH":
      return features.trend_agree && features.trend_strength >= 1.0
        ? { take: true, reason: "strong_trend_aligned" }
        : { take: false, reason: "weak_or_counter_trend" };

    case "RULE_VOL_EXPANSION":
      return features.vol_expansion >= 1.0
        ? { take: true, reason: "volatility_expanding" }
        : { take: false, reason: "volatility_contracting" };

    case "RULE_VOL_Q3_PLUS":
      return features.vol_percentile >= 3
        ? { take: true, reason: "volatility_q3_plus" }
        : { take: false, reason: "volatility_q1_q2_subdued" };

    case "RULE_MOVE_COST_RATIO_MIN":
      return features.move_to_cost_ratio >= 2.0
        ? { take: true, reason: "move_cost_ratio_ge_2" }
        : { take: false, reason: "cost_exceeds_move_potential" };

    case "RULE_MOVE_COST_RATIO_STRICT":
      return features.move_to_cost_ratio >= 3.0
        ? { take: true, reason: "move_cost_ratio_ge_3" }
        : { take: false, reason: "insufficient_expected_move" };

    case "RULE_MOMENTUM_CONFIRM": {
      const longAligned = cand.side === "long" && features.recent_return > 0 && features.multi_horizon_agree;
      const shortAligned = cand.side === "short" && features.recent_return < 0 && features.multi_horizon_agree;
      return longAligned || shortAligned
        ? { take: true, reason: "momentum_horizons_confirmed" }
        : { take: false, reason: "momentum_divergence" };
    }

    case "RULE_RANGE_EXPANSION":
      return features.range_expansion >= 1.0
        ? { take: true, reason: "range_expanded" }
        : { take: false, reason: "compressed_bar_range" };

    case "RULE_MULTI_AGREEMENT":
      return features.strategy_agreement_count >= 1
        ? { take: true, reason: `co_fired_with_${features.strategy_agreement_count}_strategies` }
        : { take: false, reason: "solo_signal_no_confirmation" };

    case "RULE_TREND_AND_VOL":
      return features.trend_agree && features.vol_expansion >= 1.0
        ? { take: true, reason: "trend_aligned_and_vol_expanding" }
        : { take: false, reason: "failed_trend_or_vol_criteria" };

    case "RULE_TREND_AND_COST":
      return features.trend_agree && features.move_to_cost_ratio >= 2.0
        ? { take: true, reason: "trend_aligned_and_move_ge_2x_cost" }
        : { take: false, reason: "failed_trend_or_cost_criteria" };

    case "RULE_COMPOSITE_QUALITY":
      return features.trend_agree && features.move_to_cost_ratio >= 2.0 && features.vol_percentile >= 3
        ? { take: true, reason: "composite_quality_pass" }
        : { take: false, reason: "failed_composite_quality" };

    default:
      throw new Error(`Unknown selection rule: ${ruleId}`);
  }
}

export function ruleMatches(ruleId, cand, features) {
  return evaluateSelectionRule(ruleId, cand, features).take;
}
