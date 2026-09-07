// scripts/world/score.mjs — P7 pure world scoring. Imports mean/stdev from lib.
// [DECISION] POS/NEG word weights and regimeScore coefficients are the proposed
// completions from docs/13 — the source supplies word lists "and similar" only.
import { mean, stdev } from "../lib.mjs";

export const POS = {
  surge: 2, rally: 1.5, jump: 1.5, gain: 1, beat: 1, upgrade: 1.5, bullish: 2,
  record: 1, growth: 1, breakout: 1.5, adoption: 1, approval: 1.5, inflows: 1,
  rebound: 1.5, soar: 2, boost: 1, profit: 1, strong: 0.5, recover: 1,
};
export const NEG = {
  crash: -2.5, plunge: -2.5, plummet: -2.5, slump: -1.5, miss: -1, downgrade: -1.5,
  bearish: -2, selloff: -2, hack: -2, fraud: -2.5, scam: -2, liquidation: -1.5,
  recession: -2, bankruptcy: -2.5, panic: -2.5, collapse: -2.5, default: -2, weak: -0.5,
};
const NEGATORS = new Set(["not", "no", "never", "without", "despite"]);

export function lexiconScore(text) {
  if (!text) return 0;
  const words = String(text).toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  let sum = 0, hits = 0;
  for (let i = 0; i < words.length; i++) {
    let w = POS[words[i]] ?? NEG[words[i]];
    if (w == null) continue;
    hits++;
    if (i > 0 && NEGATORS.has(words[i - 1])) w = -0.7 * w;
    sum += w;
  }
  if (!hits) return 0;
  return Math.max(-1, Math.min(1, sum / 3));
}

export function fngBand(v) {
  if (v == null || !Number.isFinite(v) || v < 0 || v > 100) return "unknown";
  if (v <= 24) return "extreme_fear";
  if (v <= 44) return "fear";
  if (v <= 55) return "neutral";
  if (v <= 74) return "greed";
  return "extreme_greed";
}

// [DECISION] coefficients proposed per docs/13: dollar up/yields up/high VIX lower
// the score; calm VIX raises it. m: {symbol: {price, changePct}}.
export function regimeScore(m) {
  let score = 0;
  const drivers = [];
  const chg = (sym) => (Number.isFinite(m?.[sym]?.changePct) ? m[sym].changePct : null);
  const vix = m?.["^VIX"]?.price;
  const dxy = chg("DX-Y.NYB"), tnx = chg("^TNX");
  if (dxy != null) { score -= Math.max(-1, Math.min(1, dxy / 1)) * 0.3; if (Math.abs(dxy) > 0.3) drivers.push(dxy > 0 ? "dollar up" : "dollar down"); }
  if (tnx != null) { score -= Math.max(-1, Math.min(1, tnx / 2)) * 0.25; if (Math.abs(tnx) > 0.5) drivers.push(tnx > 0 ? "yields up" : "yields down"); }
  if (Number.isFinite(vix)) {
    if (vix >= 30) { score -= 0.4; drivers.push("high VIX"); }
    else if (vix >= 22) { score -= 0.2; drivers.push("elevated VIX"); }
    else if (vix <= 15) { score += 0.25; drivers.push("calm VIX"); }
  }
  const oil = chg("CL=F"), gold = chg("GC=F");
  if (oil != null && Math.abs(oil) > 2) { score -= Math.sign(oil) * 0.1; drivers.push(oil > 0 ? "oil spike" : "oil drop"); }
  if (gold != null && Math.abs(gold) > 1.5) drivers.push(gold > 0 ? "gold bid" : "gold offered");
  score = Math.max(-1, Math.min(1, score));
  const label = score > 0.15 ? "risk_on" : score < -0.15 ? "risk_off" : "neutral";
  const posture = score < -0.5 ? "defensive" : score < -0.15 ? "cautious" : score > 0.5 ? "aggressive" : "normal";
  return { label, score, posture, drivers };
}

// [DECISION] volume = |mean|, impact = volume*sqrt(n), dispersion = sample stdev (0 when n<2),
// top = highest-|score| titles (up to 5).
export function aggregateNews(items) {
  const scored = (items || []).map((it) => ({ title: it.title, s: lexiconScore(it.title) }));
  const n = scored.length;
  const scores = scored.map((x) => x.s);
  const mean_s = n ? mean(scores) : 0;
  const dispersion = n > 1 ? (stdev(scores) ?? 0) : 0;
  const volume = Math.abs(mean_s);
  const impact = volume * Math.sqrt(n);
  const top = [...scored].sort((a, b) => Math.abs(b.s) - Math.abs(a.s)).slice(0, 5).map((x) => x.title);
  return { mean_s, dispersion, volume, impact, n, top, mixed: dispersion > 0.45 };
}
