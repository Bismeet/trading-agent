// scripts/v2/strategy-frequency-analysis.mjs — Phase 5 §3/§4.
//
// Measures how often each EXISTING strategy produces candidates on real
// historical bars, and explains every low-activity result with evidence. This
// step is measurement-only: no trading state is created or changed, no live
// file is read, and no "missing" observation is ever fabricated.
//
//   node scripts/v2/strategy-frequency-analysis.mjs [--acquire] [--force] [--json]
import {
  STRATEGY_IDS, loadSpec, loadControlConfig, loadCalibratedConfig, paramsFor,
  acquirePanel, loadPanel, writeCalJSON, FREQUENCY_PATH, specHash, panelSpan,
} from "./calibration.mjs";
import { analyzeConfigOverPanel } from "./calibration-run.mjs";
import { loadConfig } from "./store.mjs";

const DAILY_STRATS = ["tsmom", "donchian", "rsi2dip", "mom_trend"];
const args = process.argv.slice(2);
const wantJson = args.includes("--json");
const cfg = loadConfig();
const spec = loadSpec();
const symbols = cfg.watchlist.map((w) => w.symbol);

if (args.includes("--acquire")) {
  for (const name of Object.keys(spec.panels)) {
    const p = await acquirePanel(spec, name, symbols, { force: args.includes("--force"), log: () => {} });
    const span = panelSpan(p);
    console.log(`panel ${name}: ${Object.keys(p.symbols).length}/${symbols.length} symbols, ${p.failures.length} failures, ${span.firstTs ? new Date(span.firstTs).toISOString().slice(0, 10) : "-"} .. ${span.lastTs ? new Date(span.lastTs).toISOString().slice(0, 10) : "-"}`);
    for (const f of p.failures) console.log(`   FAILED ${f.symbol}: ${f.reason} (no data invented)`);
  }
}

const panels = {};
for (const name of Object.keys(spec.panels)) panels[name] = loadPanel(name);

const control = loadControlConfig();
const calibrated = loadCalibratedConfig();
const configs = [{ name: "CONTROL", config: control }];
if (calibrated) configs.push({ name: "CALIBRATED", config: calibrated });

// Panel plan: the hour panel carries the four daily-signal strategies, the
// 15m quarter panel carries the intraday pair AND doubles as the all-strategy
// co-firing panel, and the 5y daily panel gives the long-horizon frequency view.
const plan = [
  { panelName: "daily", ids: DAILY_STRATS },
  { panelName: "hour", ids: DAILY_STRATS },
  { panelName: "quarter", ids: STRATEGY_IDS },
];

const out = {
  generatedAt: Date.now(), specHash: specHash(spec),
  note: "measurement only: no trading state, no live files, no fabrication; daily panel = 5y frequency view, hour/quarter = calibration panels",
  panels: Object.fromEntries(Object.entries(panels).map(([k, p]) => [k, {
    interval: p.interval, range: p.range, source: p.source, fetchedAt: p.fetchedAt,
    symbols: Object.fromEntries(Object.entries(p.symbols).map(([s, r]) => [s, r.ts.length])),
    failures: p.failures || [],
  }])),
  configurations: {},
};

const summarize = (a, cohortsAll) => ({
  panel: a.panelName, configuration: a.configName,
  evaluations: a.evaluations, barsWithSignal: a.barsWithSignal,
  cohortSummary: a.cohortSummary,
  strategies: Object.fromEntries(Object.entries(a.strategies).map(([id, s]) => [id, {
    params: s.params, evaluations: s.evaluations, signals: s.signals.length,
    candidateRate: s.frequency.candidateRate,
    perSymbol: s.perSymbolCounts, perSide: s.frequency.perSide, perTrend: s.frequency.perTrend,
    maxConsecutiveFiring: s.frequency.maxConsecutiveFiring,
    meanBarsBetweenSignals: s.frequency.meanBarsBetweenSignals,
    coFiringBars: cohortsAll.filter((c) => c.members.some((m) => m.strategy_id === id)).length,
    probe: s.probe, starvation: s.starvation,
  }])),
});

for (const { name, config } of configs) {
  const perConfig = { configuration: config.configuration || name, panels: {} };
  for (const step of plan) {
    const paramsByStrategy = Object.fromEntries(step.ids.map((id) => [id, paramsFor(config, id)]));
    const a = analyzeConfigOverPanel({
      spec, cfg, panel: panels[step.panelName], panelName: step.panelName, dailyPanel: panels.daily,
      configName: name, paramsByStrategy, ids: step.ids, withProbes: true, withResolution: false,
    });
    perConfig.panels[step.panelName] = summarize(a, a.cohorts);
  }
  out.configurations[name] = perConfig;
}
writeCalJSON(FREQUENCY_PATH, out);

// ---- console report (spec §3 table + §4 starvation explanations) ------------
const line = (n) => "-".repeat(n);
const fmtPct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(3)}%`);
if (!wantJson) {
  for (const [name, perConfig] of Object.entries(out.configurations)) {
    console.log(`\nCONFIGURATION = ${name}`);
    for (const [panelName, rep] of Object.entries(perConfig.panels)) {
      console.log(`\nPANEL ${panelName} (${out.panels[panelName].interval}/${out.panels[panelName].range}): ${rep.evaluations} evaluations, ${rep.barsWithSignal} bars with >=1 signal`);
      console.log(`${line(118)}`);
      console.log(`STRATEGY    EVALS    SIGNALS  RATE      SYMBOLS  SIDES  TREND  COFIRE  MAXRUN  MEDGAP  STARVATION`);
      console.log(line(118));
      for (const [id, s] of Object.entries(rep.strategies)) {
        const syms = `${Object.values(s.perSymbol).filter((n) => n > 0).length}/${Object.keys(s.perSymbol).length}`;
        const st = `[${s.starvation.code}] ${s.starvation.label}`;
        console.log(`${id.padEnd(11)} ${String(s.evaluations).padStart(7)} ${String(s.signals).padStart(8)} ${fmtPct(s.candidateRate).padStart(9)} ${syms.padStart(8)} ${String(Object.keys(s.perSide).length).padStart(6)} ${String(Object.keys(s.perTrend).filter((k) => k !== "trend_unknown").length).padStart(6)} ${String(s.coFiringBars).padStart(7)} ${String(s.maxConsecutiveFiring).padStart(7)} ${String(s.meanBarsBetweenSignals == null ? "n/a" : s.meanBarsBetweenSignals.toFixed(1)).padStart(7)}  ${st}`);
      }
      const c = rep.cohortSummary;
      console.log(`co-firing: ${c.cohorts} cohorts (2-way ${c.twoWay}, 3-way ${c.threeWay}, 4-way+ ${c.fourPlus}), max width ${c.maxWidth}, co-fire rate ${fmtPct(c.coFireRate)}`);
    }
    console.log(`\nSTARVATION EVIDENCE (${name})`);
    console.log(line(118));
    for (const [panelName, rep] of Object.entries(perConfig.panels)) {
      for (const [id, s] of Object.entries(rep.strategies)) {
        if (s.starvation.code === "H" && !(s.starvation.notes || []).length) continue;
        console.log(`${id.padEnd(11)} ${panelName.padEnd(8)} [${s.starvation.code}] ${s.starvation.evidence}`);
        for (const n of s.starvation.notes || []) console.log(`${" ".repeat(22)}note: ${n}`);
      }
    }
    console.log("\n(rows marked H are strategies whose input series is not defined on that panel; no fabrication, no guessing)");
  }
} else {
  console.log(JSON.stringify(out, null, 2));
}
