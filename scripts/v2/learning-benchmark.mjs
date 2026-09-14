// scripts/v2/learning-benchmark.mjs — DETERMINISTIC synthetic proof (§2-10).
// Plants known strategy/context edges; checks learner discovers them.
// No live data, no randomness. --json for machine output.
import { emptyLearning, recordExperience, rankCandidates } from "./learning.mjs";
import { scoreCell, learnConfig, decayOf } from "./learning.mjs";
import { loadConfig } from "./store.mjs";

const L = learnConfig(loadConfig());
const C = (regime, strategy, side = "long") => ({
  regime, strategy, side, symbol: "SYN", market: "crypto", vol: "medium",
  trend: "bullish", rsi: "neutral", mom: "positive", fng: "neutral",
  funding: "balanced", session: "us",
});
const feed = (s, regime, strategy, Rs, side = "long") => {
  for (const R of Rs) recordExperience(s, C(regime, strategy, side), R, {}, L);
};
const pick = (s, regime, strats, side = "long") => rankCandidates(
  strats.map((st) => ({ order: { strategy_id: st }, ctx: C(regime, st, side), baseScore: 0.5 })), s, L);
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// §2 planted regimes: A prefers tsmom, B prefers donchian
{
  const s = emptyLearning();
  feed(s, "broad_up", "tsmom", [0.5, 0.7, 0.4, 0.6, 0.55, 0.45]);
  feed(s, "broad_up", "donchian", [-0.3, -0.2, 0.1, -0.4, -0.25, -0.15]);
  feed(s, "crypto_down", "tsmom", [-0.4, -0.3, -0.2, -0.5, -0.35, -0.25]);
  feed(s, "crypto_down", "donchian", [0.5, 0.3, 0.4, 0.6, 0.45, 0.35]);
  const a = pick(s, "broad_up", ["tsmom", "donchian"]);
  const b = pick(s, "crypto_down", ["tsmom", "donchian"]);
  check("regime-A prefers planted winner (tsmom)", a.best?.order.strategy_id === "tsmom", `got ${a.best?.order.strategy_id}`);
  check("regime-B prefers planted winner (donchian)", b.best?.order.strategy_id === "donchian", `got ${b.best?.order.strategy_id}`);
}
// §3 cold start: all n=0 -> fair, unblocked, no lock-in
{
  const s = emptyLearning();
  const r = pick(s, "mixed_chop", ["tsmom", "donchian", "rsi2dip", "mom_trend"]);
  check("cold start: nothing blocked, no abstain", !r.abstain && r.eligible.length === 4, `eligible=${r.eligible.length}`);
  const ucbs = r.scored.map((x) => x.learn.ucb);
  check("cold start: UCB equal -> deterministic fair rotation", Math.max(...ucbs) - Math.min(...ucbs) < 1e-12, "spread~0");
}
// §4 four-regime generalization (one winner each, no global best)
{
  const s = emptyLearning();
  const plan = [["broad_up", "tsmom"], ["crypto_down", "donchian"], ["crypto_down_highvol", "rsi2dip"], ["mixed_chop", "mom_trend"]];
  const losers = ["tsmom", "donchian", "rsi2dip", "mom_trend"];
  for (const [reg, win] of plan) {
    feed(s, reg, win, [0.5, 0.6, 0.4, 0.55, 0.45, 0.5]);
    for (const lo of losers.filter((x) => x !== win)) feed(s, reg, lo, [-0.3, -0.25, -0.35, -0.2, -0.3, -0.28]);
  }
  let ok = true; const got = {};
  for (const [reg, win] of plan) {
    const r = pick(s, reg, losers);
    got[reg] = r.best?.order.strategy_id;
    if (got[reg] !== win) ok = false;
  }
  check("four regimes each prefer own planted winner", ok, JSON.stringify(got));
}
// §5/6 isolation: regime + side cells independent
{
  const s = emptyLearning();
  feed(s, "broad_up", "tsmom", [0.6, 0.55, 0.5, 0.65, 0.5, 0.6]);
  const other = scoreCell(s, C("crypto_down", "tsmom"), L);
  check("regime isolation: crypto_down cell untouched (n=0)", other.n === 0, `n=${other.n}`);
  feed(s, "crypto_down", "tsmom", [-0.5, -0.4, -0.45, -0.5, -0.4, -0.42, -0.48, -0.44, -0.46, -0.4]);
  const bad = scoreCell(s, C("crypto_down", "tsmom"), L);
  const good = scoreCell(s, C("broad_up", "tsmom"), L);
  check("bad regime blocked, good regime eligible", bad.blocked === true && good.blocked === false, `bad(b=${bad.blocked},n=${bad.n}) good(b=${good.blocked})`);
  const s2 = emptyLearning();
  feed(s2, "broad_up", "tsmom", [0.5, 0.6, 0.5, 0.55, 0.5, 0.6], "long");
  feed(s2, "broad_up", "tsmom", [-0.5, -0.4, -0.5, -0.45, -0.5, -0.42], "short");
  const lo = scoreCell(s2, C("broad_up", "tsmom", "long"), L);
  const sh = scoreCell(s2, C("broad_up", "tsmom", "short"), L);
  check("side awareness: long good / short bad diverge", lo.adjExp > 0.1 && sh.adjExp < -0.05, `long=${lo.adjExp.toFixed(3)} short=${sh.adjExp.toFixed(3)}`);
}
// §7 abstention when everything bad
{
  const s = emptyLearning();
  for (const st of ["tsmom", "donchian", "rsi2dip", "mom_trend"])
    feed(s, "risk_off", st, [-0.3, -0.25, -0.2, -0.28, -0.22, -0.3, -0.26, -0.24, -0.27, -0.23]);
  const r = pick(s, "risk_off", ["tsmom", "donchian", "rsi2dip", "mom_trend"]);
  check("all-bad context -> ABSTAIN (not least-bad)", r.abstain === true, `abstain=${r.abstain}`);
}
// §8-9 recovery + decay measurement (10x -0.5R then +0.6R until adjExp>0)
{
  const runToRecover = (decay) => {
    const s = emptyLearning();
    const Lc = { ...L, decay };
    for (let i = 0; i < 10; i++) recordExperience(s, C("broad_up", "tsmom"), -0.5, {}, Lc);
    let k = 0;
    for (; k < 40; k++) {
      recordExperience(s, C("broad_up", "tsmom"), 0.6, {}, Lc);
      if (scoreCell(s, C("broad_up", "tsmom"), Lc).adjExp > 0) break;
    }
    return k + 1;
  };
  const k1 = runToRecover(1.0), k95 = runToRecover(0.95);
  check("recovery possible without decay (default 1.0)", k1 <= 40, `${k1} good trades to adjExp>0`);
  check("decay 0.95 recovers faster (recency helps)", k95 < k1, `d=1:${k1} vs d=.95:${k95}`);
  console.log(`      config decay: ${decayOf(L)} (1.0=off; 0.95 opt-in, not tuned for profit)`);
}
// §10 chronological invariant
{
  const s = emptyLearning();
  const t0 = 1700000000000;
  recordExperience(s, C("broad_up", "tsmom"), 0.5, { ts_close: t0 });
  const decidedAt = t0 + 30000;
  const sc = scoreCell(s, C("broad_up", "tsmom"), L);
  const infoTs = s.cells["broad_up|long|tsmom"].lastTs;
  check("chronological invariant (info<decision, close-fed only)", infoTs === t0 && infoTs < decidedAt && sc.n === 1, `info=${infoTs} decision=${decidedAt}`);
}
const fails = results.filter((r) => !r.pass).length;
console.log(`\nbenchmark: ${results.length - fails}/${results.length} PASS (SYNTHETIC — not live evidence)`);
if (process.argv.includes("--json")) console.log(JSON.stringify({ synthetic: true, pass: results.length - fails, total: results.length, results }, null, 2));
process.exitCode = fails ? 1 : 0;
