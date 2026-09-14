// scripts/v2/alpha.mjs — THE NEW ALPHA (research deliverable, §22).
//
// A single, deterministic, causal, untrained entry model assembled from the
// pre-registered signal families in config/alpha-experiment-spec.v1.json.
// It has three layers:
//
//   1. SIGNAL      alphaSignalSides(id, f, spec) -> ["long"|"short", ...]
//   2. REJECTION   evaluateRejectionRules(f, spec) -> {rejects[], pass}
//   3. DECISION    decideAlphaEntry({...}) -> {take, side, reason, score}
//
// The decision layer maps 1 + 2 + the quality score into the pre-registered
// TAKE / ABSTAIN output. Nothing here is fitted on data; every threshold lives
// in the frozen spec so the layer can be unit-tested and audited.
import { qualityScore } from "./alpha-features.mjs";

const sgnOf = (r) => (Number.isFinite(r) ? Math.sign(r) : 0);

// ---- 1. Signals --------------------------------------------------------------
// Each pre-registered signal is symmetric in long/short and returns every side
// for which the condition holds (the conditions are mutually exclusive, so the
// result has at most one element).
export function alphaSignalSides(id, f, spec) {
  const t = spec?.featureThresholds ?? {};
  const out = [];
  const long = (cond) => cond && out.push("long");
  const short = (cond) => cond && out.push("short");

  switch (id) {
    case "breakout48_trend": {
      long(f.bd48 && sgnOf(f.r24) > 0 && f.dailyTrendDir === 1);
      short(f.bd48 && sgnOf(f.r24) < 0 && f.dailyTrendDir === -1);
      break;
    }
    case "persistence3": {
      const z = Math.abs(f.z24 ?? NaN);
      const ok = Number.isFinite(z) && z >= (t.persistenceZMin ?? 1.0)
        && sgnOf(f.r4) !== 0 && sgnOf(f.r4) === sgnOf(f.r24) && sgnOf(f.r24) === sgnOf(f.r72);
      long(ok && sgnOf(f.r24) > 0);
      short(ok && sgnOf(f.r24) < 0);
      break;
    }
    case "momentum24": {
      const z = Math.abs(f.z24 ?? NaN);
      const ok = Number.isFinite(z) && z >= (t.momentumZMin ?? 1.5)
        && sgnOf(f.r24) !== 0 && sgnOf(f.r24) === sgnOf(f.r72);
      long(ok && sgnOf(f.r24) > 0);
      short(ok && sgnOf(f.r24) < 0);
      break;
    }
    case "volexp_breakout": {
      const ve = f.volExpansion ?? NaN;
      const ok = Number.isFinite(ve) && ve >= (t.volExpansionMin ?? 1.2);
      long(f.bd48 && ok && sgnOf(f.r24) >= 0 && f.dailyTrendDir >= 0);
      short(f.bd48 && ok && sgnOf(f.r24) <= 0 && f.dailyTrendDir <= 0);
      break;
    }
    case "compression_breakout": {
      const rc = f.rangeCompression ?? NaN;
      const br = f.bodyRatio ?? NaN;
      const ok = Number.isFinite(rc) && rc <= (t.compressionRatioMax ?? 0.6) && Number.isFinite(br) && br >= (t.bodyRatioMin ?? 0.5);
      long(f.bd48 && ok);
      short(f.bd48 && ok);
      break;
    }
    case "mtf_4h_24h": {
      long(f.bd4 && Number.isFinite(f.z24) && f.z24 >= (t.mtfZMin ?? 0.5) && f.dailyTrendDir === 1);
      short(f.bd4 && Number.isFinite(f.z24) && f.z24 <= -(t.mtfZMin ?? 0.5) && f.dailyTrendDir === -1);
      break;
    }
    case "mtf_breakout_daily": {
      long(f.bd24 && sgnOf(f.r72) > 0 && f.above200);
      short(f.bd24 && sgnOf(f.r72) < 0 && !f.above200);
      break;
    }
    case "regime_gated_breakout": {
      const strong = f.trendRegime === "strong_trend";
      long(f.bd48 && strong && f.regimeDirection > 0);
      short(f.bd48 && strong && f.regimeDirection < 0);
      break;
    }
    default:
      throw new Error(`alpha: unknown signal id "${id}"`);
  }
  return out;
}

// ---- 2. False-breakout rejection rules (§9) ---------------------------------
// Each rule is causal and pre-registered. Rules report independently so the
// report can measure the marginal value of every individual rejection.
export function evaluateRejectionRules(f, spec) {
  const fired = [];
  if (Number.isFinite(f.volExpansion) && f.volExpansion < 1.0) fired.push("REJ_NO_VOL_EXPANSION");
  if (Number.isFinite(f.bodyRatio) && f.bodyRatio < 0.3) fired.push("REJ_WEAK_BODY");
  if (f.dailyTrendDir !== 0 && f.dailyTrendAgree === 0) fired.push("REJ_COUNTER_DAILY_TREND");
  if (f.bd48 && Number.isFinite(f.breakoutDistAtr) && f.breakoutDistAtr < 0.25) fired.push("REJ_MARGINAL_BREAKOUT");
  if (Number.isFinite(f.distFromMidAtr) && Math.abs(f.distFromMidAtr) > 2.0) fired.push("REJ_OVEREXTENDED");
  return { rejects: fired, pass: fired.length === 0 };
}

// ---- 3. Decision layer -------------------------------------------------------
// Pre-registered TAKE/ABSTAIN rule:
//   TAKE iff quality score >= takeThreshold
//          AND causal cost coverage >= costCoverageFloor (expected move pays for the round trip)
//          AND no rejection rule fired.
export function decideAlphaEntry({ id, f, spec }) {
  const sides = alphaSignalSides(id, f, spec);
  if (sides.length === 0) return { take: false, side: null, reason: "NO_SIGNAL", score: 0, rejects: [] };
  const side = sides[0];
  const score = qualityScore(f, spec);
  const rej = evaluateRejectionRules(f, spec);
  const floor = spec?.qualityScore?.costCoverageFloor ?? 0.2;
  const threshold = spec?.qualityScore?.takeThreshold ?? 0.55;
  const costOk = (f.comp?.costCoverage ?? 0) >= floor;
  const qualityOk = score >= threshold;
  const take = rej.pass && costOk && qualityOk;
  const reason = take ? "TAKE"
    : !rej.pass ? `REJECTED:${rej.rejects.join("+")}`
      : !costOk ? "ABSTAIN_COST"
        : "ABSTAIN_QUALITY";
  return { take, side, reason, score, rejects: rej.rejects };
}

export const alphaSignalIds = (spec) => (spec?.signals ?? []).map((s) => s.id);
export const signalFamilyOf = (id, spec) => spec?.signals?.find((s) => s.id === id)?.family ?? null;