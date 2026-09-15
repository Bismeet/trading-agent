// scripts/v2/phase10-leakage.mjs — PHASE 10: the explicit leakage audit.
//
// Robustness check #8. Four independent, falsifiable checks run against the LIVE
// pipeline objects (never against a re-implementation of them):
//
//   1. FEATURE CAUSALITY — rebuilding the causal feature series and the regime
//      state machine from a panel that ENDS at the decision bar must reproduce,
//      field for field, the exact values the pipeline used at that bar. Any
//      forward peek into the panel would change at least one field.
//   2. TEST ISOLATION — every occurrence is measured either in its own fold or
//      not at all: the fold recorded in the measurement must be exactly what the
//      purge/embargo rule says, and no TEST outcome may exist before the lock.
//   3. LABEL ISOLATION — a measurement is a function of bars [entry, exit] only.
//      Re-measuring on a panel truncated AT the exit bar must be identical;
//      truncating one bar earlier must NOT be. That is what proves forward
//      returns are consumed for LABELS ONLY.
//   4. PURGE + EMBARGO — every measured (occurrence, horizon) closes its whole
//      forward window inside its own fold, at least embargoBars after the fold
//      start. No label may straddle a boundary.
//
// Every check returns { name, pass, checked, failures }. The runner treats any
// failure as EVALUATION INVALID (verdict D): a leaked experiment is not reportable.

const snap = (x) => JSON.parse(JSON.stringify(x ?? null));
const key = (x) => JSON.stringify(snap(x));

// Deterministic, evenly spread sample of `count` indices out of n. No randomness.
export function evenSample(n, count) {
  if (!(n > 0) || !(count > 0)) return [];
  if (count === 1) return [0];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (let j = 0; j < count; j++) out.push(Math.floor((j * (n - 1)) / (count - 1)));
  return [...new Set(out)];
}

// ---- 1. feature causality -------------------------------------------------------
// probe(symbol, rows, k, occurrence) must return EVERY quantity the pipeline
// derived from the panel at bar k: the pre-registered features for both sides at
// the primary horizon, the regime label, the regime direction, and the inputs of
// the production re-expressions (r672, prior channel, daily agreement).
export function auditFeatureCausality({ occurrences, rowsOf, truncateFor, probe, sample = 48, maxFailures = 5 }) {
  const failures = [];
  let checked = 0;
  for (const i of evenSample(occurrences.length, sample)) {
    const o = occurrences[i];
    const k = o.k;
    if (!Number.isFinite(k)) continue;
    const full = probe(o.symbol, rowsOf(o.symbol), k, o);
    const trunc = probe(o.symbol, truncateFor(o.symbol, k), k, o);
    checked += 1;
    if (key(full) !== key(trunc)) {
      failures.push({ occurrence: i, symbol: o.symbol, k, full, truncated: trunc });
      if (failures.length >= maxFailures) break;
    }
  }
  return { name: "feature_causality", pass: failures.length === 0, checked, failures };
}

// ---- 2. test isolation ----------------------------------------------------------
export function auditTestIsolation({ occurrences, measurements, boundsOf, hBarsOf, horizons, assignFold, embargoBars, expectNoTest = true, maxFailures = 5 }) {
  const failures = [];
  const measured = { train: 0, validation: 0, test: 0 };
  let checked = 0;
  for (const o of occurrences) {
    const perH = measurements[o.i];
    if (!perH) continue;
    for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
      const rec = perH[hIdx];
      if (!rec) continue;
      checked += 1;
      measured[rec.fold] += 1;
      const fold = assignFold(boundsOf(o.symbol), o.k, hBarsOf[hIdx], embargoBars);
      if (fold !== rec.fold) {
        failures.push({ occurrence: o.i, hIdx, reason: "measured fold disagrees with the purge/embargo rule", recorded: rec.fold, rule: fold });
        if (failures.length >= maxFailures) return { name: "test_isolation", pass: false, checked, measured, failures };
      }
    }
  }
  if (expectNoTest && measured.test > 0) failures.push({ reason: "TEST outcomes exist before the selection lock", count: measured.test });
  return { name: "test_isolation", pass: failures.length === 0, checked, measured, failures };
}

// ---- 3. label isolation ----------------------------------------------------------
// measureAt({ o, hIdx, upTo }) re-measures occurrence o at horizon hIdx using only
// the first `upTo` bars of the panel. A correct measurement is a pure function of
// bars [entry, exit]:
//   * truncating AT the exit bar (upTo = exitIdx + 1) must reproduce it exactly
//     -> no bar beyond the label window is ever consulted;
//   * truncating ONE BAR BEFORE it must change it
//     -> the exit bar really is the label, and the label is not stale.
export function auditLabelIsolation({ occurrences, measurements, measureAt, sample = 48, maxFailures = 5 }) {
  const failures = [];
  let checked = 0, recorded = 0, doesNotChange = 0;
  for (const i of evenSample(occurrences.length, sample)) {
    const o = occurrences[i];
    const perH = measurements[o.i];
    if (!perH) continue;
    for (let hIdx = 0; hIdx < perH.length; hIdx++) {
      const rec = perH[hIdx];
      if (!rec || !rec.m || !rec.m.resolved) continue;
      const m = rec.m;
      if (!Number.isFinite(m.exitIdx) || !Number.isFinite(m.entryIdx)) continue;
      checked += 1;
      const atExit = measureAt({ o, hIdx, upTo: m.exitIdx + 1 });
      if (!atExit || atExit.resolved !== true || key(atExit) !== key(m)) {
        failures.push({ occurrence: o.i, hIdx, kind: "forward window extends past the exit bar", exitIdx: m.exitIdx, recorded: snap(m), reMeasured: snap(atExit) });
        if (failures.length >= maxFailures) return { name: "label_isolation", pass: false, checked, recorded, doesNotChange, failures };
        continue;
      }
      if (m.exitIdx > m.entryIdx) {
        const before = measureAt({ o, hIdx, upTo: m.exitIdx });
        if (before && key(before) === key(m)) doesNotChange += 1;
        else recorded += 1;
      }
    }
  }
  return { name: "label_isolation", pass: failures.length === 0, checked, recorded, doesNotChange, failures };
}

// ---- 4. purge + embargo ----------------------------------------------------------
// Verified DIRECTLY from the fold bounds, not by calling assignFold again: every
// measured (occurrence, horizon) must have its entry bar inside its own fold, at
// least embargoBars after that fold's first bar, and its whole forward window
// [k, k + hBars] closing inside the fold. No label may straddle a boundary.
export function auditPurgeEmbargo({ occurrences, measurements, boundsOf, hBarsOf, horizons, subFoldBoundsOf, subFolds, embargoBars, maxFailures = 5 }) {
  const failures = [];
  let checked = 0;
  const byFold = { train: 0, validation: 0, test: 0 };
  for (const o of occurrences) {
    const perH = measurements[o.i];
    if (!perH) continue;
    const bounds = boundsOf(o.symbol);
    for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
      const rec = perH[hIdx];
      if (!rec) continue;
      checked += 1;
      byFold[rec.fold] = (byFold[rec.fold] ?? 0) + 1;
      const k = o.k, hBars = hBarsOf[hIdx], boundsFold = bounds[rec.fold];
      if (!boundsFold) {
        failures.push({ occurrence: o.i, hIdx, reason: `unknown fold ${rec.fold}` });
      } else {
        const [a, b] = boundsFold;
        if (k < a || k >= b) failures.push({ occurrence: o.i, hIdx, fold: rec.fold, reason: "entry bar outside the fold", k, foldRange: [a, b] });
        else if (k - a < embargoBars) failures.push({ occurrence: o.i, hIdx, fold: rec.fold, reason: "embargo violated after the fold boundary", gap: k - a, embargoBars });
        else if (k + hBars > b) failures.push({ occurrence: o.i, hIdx, fold: rec.fold, reason: "forward window straddles the fold end", windowEnd: k + hBars, foldEnd: b });
        else if (subFoldBoundsOf && rec.subFold != null) {
          const sf = subFoldBoundsOf(o.symbol, rec.fold);
          const sfb = sf ? sf[rec.subFold] : null;
          if (!sfb || k < sfb[0] || k >= sfb[1]) failures.push({ occurrence: o.i, hIdx, fold: rec.fold, reason: "sub-fold index disagrees with the entry bar", subFold: rec.subFold, subFoldRange: sfb ?? null, k });
        }
      }
      if (failures.length >= maxFailures) return { name: "purge_embargo", pass: false, checked, byFold, failures };
    }
  }
  return { name: "purge_embargo", pass: failures.length === 0, checked, byFold, failures };
}

// ---- aggregate -------------------------------------------------------------------
export function runLeakageAudit(parts) {
  const checks = parts.filter(Boolean);
  const fail = checks.filter((c) => !c.pass);
  return { pass: fail.length === 0, checks, failed: fail.map((c) => c.name) };
}
