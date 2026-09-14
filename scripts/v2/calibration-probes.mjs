// scripts/v2/calibration-probes.mjs — Phase 5 structural near-miss probes (§4).
//
// These counters are MEASUREMENT ONLY: they never create candidates and never
// change a strategy. Each probe mirrors the strategy's own structure with a
// relaxed (documented) threshold so a zero-signal strategy can be explained as
// "genuinely rare" vs "blocked by the trend filter" vs "threshold too strict".
import { rsi, sma } from "./store.mjs";

const retN = (c, n) => (Array.isArray(c) && c.length > n ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null);

export function newProbe() {
  return { bars: 0, nearMiss: 0, blockedByTrend: 0, blockedByOther: 0, atThreshold: 0 };
}
export const PROBE_RELAX = 0.5; // near-miss band = half the threshold distance
// Strategies whose SOURCE definition has no short entry (docs/09: mom_trend
// "no short entry specified"). A one-sided result for these is BY DESIGN, not
// starvation, and is reported as a note instead of a deficiency code.
export const STRUCTURALLY_LONG_ONLY = ["mom_trend"];
export const acceptedPanelsFor = (id) =>
  id === "ibreakout" || id === "orb" ? ["quarter"] : ["daily", "hour", "quarter"];

export function starvationProbe(id, q, params, probe) {
  probe.bars += 1;
  const c = q.closes;
  if (id === "tsmom") {
    const r = retN(c, params.retN);
    if (r == null) return;
    const s = sma(c, params.smaN);
    const want = r > 0 ? 1 : r < 0 ? -1 : 0;
    if (Math.abs(r) > params.momThreshold && want !== 0) {
      probe.atThreshold += 1;
      const aligned = s == null || (want > 0 ? q.price > s : q.price < s);
      if (!aligned) probe.blockedByTrend += 1;
    }
    if (Math.abs(r) > params.momThreshold * PROBE_RELAX && want !== 0) probe.nearMiss += 1;
    return;
  }
  if (id === "donchian") {
    if (!Array.isArray(c) || c.length < params.lookback + 1) return;
    const prior = c.slice(c.length - (params.lookback + 1), c.length - 1);
    const hi = Math.max(...prior), lo = Math.min(...prior);
    const s = sma(c, params.smaN);
    const upBreak = q.price > hi, downBreak = q.price < lo;
    if (upBreak || downBreak) {
      probe.atThreshold += 1;
      const ok = s == null || (upBreak ? q.price > s : q.price < s);
      if (!ok) probe.blockedByTrend += 1;
    }
    if (q.price > hi * (1 - 0.005) || q.price < lo * (1 + 0.005)) {
      probe.nearMiss += 1;
      const dir = q.price > hi * (1 - 0.005) ? 1 : -1;
      if (s != null && (dir > 0 ? q.price < s : q.price > s)) probe.blockedByTrend += 1;
    }
    return;
  }
  if (id === "rsi2dip") {
    if (!Array.isArray(c) || c.length < Math.max(210, params.smaN + 10)) return;
    const r2 = rsi(c, params.rsiN);
    const s = sma(c, params.smaN);
    if (r2 == null || s == null) return;
    if (r2 < params.rsiLow || r2 > params.rsiHigh) {
      probe.atThreshold += 1;
      const ok = r2 < params.rsiLow ? q.price > s : q.price < s;
      if (!ok) probe.blockedByTrend += 1;
    }
    if (r2 < params.rsiLow * 2.5 || r2 > 100 - (100 - params.rsiHigh) * 2.5) {
      probe.nearMiss += 1;
      const up = r2 < 50;
      if (up ? q.price < s : q.price > s) probe.blockedByTrend += 1;
    }
    return;
  }
  if (id === "mom_trend") {
    const r = retN(c, params.retN);
    if (r == null) return;
    const s = sma(c, params.smaN);
    if (r > params.retThreshold) {
      probe.atThreshold += 1;
      const trendOk = s == null || q.price > s;
      const momOk = Number.isFinite(q.mom) && q.mom > params.momMin;
      const rsiOk = Number.isFinite(q.rsi) && q.rsi < params.rsiMax;
      if (!trendOk) probe.blockedByTrend += 1;
      else if (!momOk || !rsiOk) probe.blockedByOther += 1;
    }
    if (r > params.retThreshold * PROBE_RELAX) probe.nearMiss += 1;
    return;
  }
  if (id === "ibreakout") {
    const ci = q.closesIntraday;
    if (!Array.isArray(ci) || ci.length < Math.max(49, params.bars + 1)) return;
    const prior = ci.slice(ci.length - (params.bars + 1), ci.length - 1);
    const hi = Math.max(...prior), lo = Math.min(...prior);
    const last = ci[ci.length - 1];
    if (last > hi || last < lo) probe.atThreshold += 1;
    if (last > hi * (1 - 0.002) || last < lo * (1 + 0.002)) probe.nearMiss += 1;
    return;
  }
  if (id === "orb") {
    const st = probe.orb ||= {};
    const key = `${q.symbol}|${q.sessionStart}`;
    const s = (st[key] ||= { orHi: q.price, orLo: q.price });
    s.orHi = Math.max(s.orHi, q.price);
    s.orLo = Math.min(s.orLo, q.price);
    const sinceOpen = q.ts - q.sessionStart;
    if (sinceOpen > 30 * 60000) {
      if (q.price > s.orHi || q.price < s.orLo) probe.atThreshold += 1;
      else probe.nearMiss += 1; // range formed, price still inside it
    } else probe.blockedByOther += 1; // opening range still forming
  }
}

// Deterministic, evidence-backed starvation classification (spec §4).
// A low-frequency strategy is NEVER automatically labelled "bad": the
// classification explains WHY the observed count is what it is. Codes:
//   A genuinely rare setup · B overly restrictive threshold · C insufficient
//   data · D regime/trend-filter interaction · E side filter / narrow coverage
//   G symbol-specific incompatibility · H pipeline condition
export function classifyStarvation({ id, signalCount, evaluations, notApplicable, probe, perSide, applicableSymbols, symbolsFired, panelName, expectedPanel, acceptedPanels }) {
  const panels = acceptedPanels || [expectedPanel];
  if (!panels.includes(panelName)) {
    return {
      code: "H", label: "pipeline condition (panel does not carry this strategy's input)",
      evidence: `${id} is evaluable on [${panels.join(", ")}]; this row uses the ${panelName} panel, so its input series is not defined here`,
    };
  }
  if (!evaluations) {
    return {
      code: "C", label: "insufficient data (warmup/panel length)",
      evidence: `0 usable evaluations out of ${notApplicable ?? 0} bars: the strategy's warmup was never satisfied on this panel`,
    };
  }
  const rate = signalCount / evaluations;
  const p = probe || newProbe();
  if (signalCount === 0) {
    if (p.nearMiss === 0) {
      return {
        code: "A", label: "genuinely rare setup",
        evidence: `0 candidates in ${evaluations} evaluations; the primary condition was never approached even inside the relaxed (${PROBE_RELAX}x) band (at-threshold bars: ${p.atThreshold})`,
      };
    }
    if (p.blockedByTrend >= 0.5 * p.nearMiss && p.blockedByTrend > 0) {
      return {
        code: "D", label: "regime/trend-filter interaction",
        evidence: `0 candidates; ${p.blockedByTrend} of ${p.nearMiss} near-misses were blocked by the trend (SMA) filter, ${p.blockedByOther} by secondary conditions, ${p.atThreshold} bars were at/past the primary threshold`,
      };
    }
    if (p.blockedByOther > 0) {
      return {
        code: "B", label: "restrictive secondary threshold",
        evidence: `0 candidates; ${p.atThreshold} bars passed the primary threshold, ${p.blockedByOther} were blocked by a secondary condition (near-misses: ${p.nearMiss})`,
      };
    }
    return {
      code: "B", label: "overly restrictive threshold",
      evidence: `0 candidates; ${p.nearMiss} near-misses inside the relaxed band, none crossed the strict threshold`,
    };
  }
  const ev = [];
  const notes = [];
  if (rate < 0.002) ev.push(`candidate rate ${(rate * 100).toFixed(3)}% is very low (<0.2%)`);
  const sides = Object.keys(perSide || {});
  if (sides.length === 1) {
    const msg = `side coverage: only "${sides[0]}" fired (${JSON.stringify(perSide)})`;
    if (STRUCTURALLY_LONG_ONLY.includes(id)) notes.push(`${msg} -- long-only BY DESIGN (docs/09); short signals: INSUFFICIENT, never manufactured`);
    else ev.push(`${msg} -- reported, never manufactured`);
  }
  if ((applicableSymbols || 0) > 0 && symbolsFired < applicableSymbols) ev.push(`symbol coverage ${symbolsFired}/${applicableSymbols} applicable symbols`);
  if (ev.length) {
    const code = rate < 0.002 ? "A" : symbolsFired < applicableSymbols ? "G" : "E";
    const label = code === "A" ? "rare but real setup" : code === "G" ? "symbol-specific incompatibility" : "side/coverage limited";
    return { code, label, evidence: ev.join("; "), notes };
  }
  return { code: "-", label: "no starvation detected", evidence: `rate ${(rate * 100).toFixed(2)}% over ${evaluations} evaluations, ${symbolsFired}/${applicableSymbols || "?"} symbols`, notes };
}
