// scripts/v2/phase10-regime.mjs — PHASE 10: the fixed regime state machine.
//
// Five pre-registered states — STRONG_TREND, WEAK_TREND, RANGE, VOL_EXPANSION,
// VOL_CONTRACTION — driven by causal per-bar features ONLY:
//   volExpansion    = ATR14 / ATR50            (volatility expansion / contraction)
//   rangeCompression= prior-48h channel / prior-240h channel   (range / compression)
//   |z24|           = |r24 / (atrNorm * sqrt(24))|             (trend strength)
//   r24             (direction ATTRIBUTE only — never flips a state)
//
// state(k) = f(state(k-1), features(k)) with hysteresis: a state is LEFT only
// when its pre-registered EXIT condition fires, then the first ENTER condition
// in the fixed precedence order is taken, else RANGE. Nothing here sees a
// future bar and nothing is fitted: tests/phase10.test.mjs poisons future bars
// and asserts the state sequence is unchanged.
import { HOURLY_MS } from "./alpha-features.mjs";

export const REGIME_STATES = ["STRONG_TREND", "WEAK_TREND", "RANGE", "VOL_EXPANSION", "VOL_CONTRACTION"];

export const defaultHysteresis = {
  volExpansionEnterHigh: 1.35, volExpansionExitHigh: 1.15,
  volExpansionEnterLow: 0.75, volExpansionExitLow: 0.90,
  compressionEnter: 0.55, compressionExit: 0.70,
  strongEnterZ: 1.5, strongExitZ: 1.0,
  weakEnterZ: 0.75, weakExitZ: 0.45,
};

export const hysteresisOf = (spec) => ({ ...defaultHysteresis, ...(spec?.regimeState?.hysteresis ?? {}) });

// One deterministic transition. `prev` is a state name; `x` carries the causal
// per-bar features. Missing features can never MAINTAIN a state.
export function regimeStep(prev, x, H) {
  const ve = Number.isFinite(x.volExpansion) ? x.volExpansion : null;
  const rc = Number.isFinite(x.rangeCompression) ? x.rangeCompression : null;
  const z = Number.isFinite(x.absZ) ? x.absZ : null;

  // 1. VOL_EXPANSION
  if (prev === "VOL_EXPANSION") {
    if (ve != null && ve > H.volExpansionExitHigh) return "VOL_EXPANSION";
  } else if (ve != null && ve >= H.volExpansionEnterHigh) {
    return "VOL_EXPANSION";
  }
  // 2. VOL_CONTRACTION (expansion or genuine range compression)
  if (prev === "VOL_CONTRACTION") {
    const stillTight = ve != null && ve < H.volExpansionExitLow && (rc == null || rc < H.compressionExit);
    if (stillTight) return "VOL_CONTRACTION";
  } else if ((ve != null && ve <= H.volExpansionEnterLow) || (rc != null && rc <= H.compressionEnter)) {
    return "VOL_CONTRACTION";
  }
  // 3. STRONG_TREND
  if (prev === "STRONG_TREND") {
    if (z != null && z > H.strongExitZ) return "STRONG_TREND";
  } else if (z != null && z >= H.strongEnterZ) {
    return "STRONG_TREND";
  }
  // 4. WEAK_TREND
  if (prev === "WEAK_TREND") {
    if (z != null && z > H.weakExitZ) return "WEAK_TREND";
  } else if (z != null && z >= H.weakEnterZ) {
    return "WEAK_TREND";
  }
  return "RANGE";
}

// Whole series, sequential (state k depends on state k-1 only). Causal by
// construction; deterministic; O(n).
export function precomputeRegimeStates(series, spec) {
  const H = hysteresisOf(spec);
  const n = series.n;
  const states = new Array(n);
  let prev = spec?.regimeState?.initialState ?? "RANGE";
  for (let k = 0; k < n; k++) {
    const x = {
      volExpansion: series.volExpansion[k],
      rangeCompression: series.rangeCompression[k],
      absZ: Number.isFinite(series.rets[24][k]) && Number.isFinite(series.atrNorm[k]) && series.atrNorm[k] > 0
        ? Math.abs(series.rets[24][k] / (series.atrNorm[k] * Math.sqrt(24)))
        : NaN,
    };
    prev = regimeStep(prev, x, H);
    states[k] = prev;
  }
  return states;
}

// Causal direction attribute (not part of the state machine): sign of r24.
export const regimeDirectionOf = (series, k) => {
  const r = series.rets[24][k];
  return Number.isFinite(r) && r !== 0 ? Math.sign(r) : 0;
};

// Hours -> bars for the purge/embargo arithmetic (hourly panel by construction).
export const barsFor = (hours) => Math.max(1, Math.round((hours * HOURLY_MS) / HOURLY_MS));
