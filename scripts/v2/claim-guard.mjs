// scripts/v2/claim-guard.mjs — Phase 4 §19 HARD reporting rule.
//
// The system must not print "learner profitable" / "AI improved returns" /
// "learning increased profit" unless ALL of the following hold:
//   - sufficient out-of-sample sample size (executed, resolved shadows)
//   - chronological (walk-forward) evaluation verified by tests
//   - a valid comparison baseline exists
//   - meaningful multi-strategy decision cohorts exist (strategy choice evaluated)
//   - no future leakage (verified by tests)
//   - complete-enough outcome coverage (data integrity passing)
// Until then the ONLY permitted claim is: PROFITABILITY: NOT VERIFIED.
//
// Note: a VERIFIED verdict means the evidence bar for making the claim is met —
// it is NOT itself a profitability result. Any headline claim still needs the
// actual walk-forward comparison numbers behind it.

export const PROFIT_MIN = {
  executed: 50,            // minimum closed executed trades
  resolvedShadows: 20,     // minimum resolved counterfactual outcomes
  cohorts: 20,             // minimum multi-strategy decision cohorts
};

export function profitabilityVerdict(e = {}) {
  const reasons = [];
  if (e.chronologicalPass !== true) reasons.push("chronological walk-forward evaluation not verified");
  if (e.leakagePass !== true) reasons.push("future-leakage tests not passing");
  if (!Number.isFinite(e.executed) || e.executed < PROFIT_MIN.executed)
    reasons.push(`executed trades ${e.executed ?? 0} < ${PROFIT_MIN.executed}`);
  if (!Number.isFinite(e.resolvedShadows) || e.resolvedShadows < PROFIT_MIN.resolvedShadows)
    reasons.push(`resolved shadow outcomes ${e.resolvedShadows ?? 0} < ${PROFIT_MIN.resolvedShadows}`);
  if (!Number.isFinite(e.cohorts) || e.cohorts < PROFIT_MIN.cohorts)
    reasons.push(`multi-strategy decision cohorts ${e.cohorts ?? 0} < ${PROFIT_MIN.cohorts}`);
  if (e.baselinePass !== true) reasons.push("no valid comparison baseline");
  if (e.integrityPass !== true) reasons.push("data integrity failures present");
  if (e.coveragePass !== true) reasons.push("outcome coverage incomplete (cells without sufficient observations)");
  return {
    profitability: reasons.length ? "NOT VERIFIED" : "VERIFIED",
    reasons,
    min: PROFIT_MIN,
  };
}

// One-line printer used by every report/CLI so the wording cannot drift.
export function printProfitLine(e) {
  const v = profitabilityVerdict(e);
  console.log(`PROFITABILITY: ${v.profitability}`);
  for (const r of v.reasons) console.log(`  - ${r}`);
  return v;
}
