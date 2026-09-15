// scripts/setup-test-fixtures.mjs — Ensure required baseline data files exist for tests
// Non-destructive: preserves existing production journals, state, and learning data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const CAL_DIR = path.join(DATA_DIR, "calibration");

fs.mkdirSync(CAL_DIR, { recursive: true });

// 1. Journal with minimal valid pre/post pair for data integrity tests
const journalPath = path.join(DATA_DIR, "journal.v2.jsonl");
if (!fs.existsSync(journalPath) || fs.readFileSync(journalPath, "utf8").trim().length === 0) {
  const pre = { kind: "pre", trade_id: "init-0", ts: 1000, symbol: "BTC-USD", strategy_id: "tsmom", side: "long" };
  const post = { kind: "post", trade_id: "init-0", ts_close: 2000, symbol: "BTC-USD", strategy_id: "tsmom", side: "long", realized_R: 0.5 };
  fs.writeFileSync(journalPath, JSON.stringify(pre) + "\n" + JSON.stringify(post) + "\n");
}

// 2. Trades and shadow-trades log files
const tradesPath = path.join(DATA_DIR, "trades.v2.jsonl");
if (!fs.existsSync(tradesPath)) fs.writeFileSync(tradesPath, "");

const shadowTradesPath = path.join(DATA_DIR, "shadow-trades.v2.jsonl");
if (!fs.existsSync(shadowTradesPath)) fs.writeFileSync(shadowTradesPath, "");

// 3. Learner store
const learnerPath = path.join(DATA_DIR, "context-learning.v2.json");
if (!fs.existsSync(learnerPath)) {
  fs.writeFileSync(learnerPath, JSON.stringify({ version: 1, cells: {}, experiences: 0 }, null, 2));
}

// 4. Initial state
const statePath = path.join(DATA_DIR, "state.v2.json");
if (!fs.existsSync(statePath)) {
  try {
    const { freshV2State } = await import("./v2/episode.mjs");
    const { loadConfig } = await import("./v2/store.mjs");
    fs.writeFileSync(statePath, JSON.stringify(freshV2State(loadConfig()), null, 2));
  } catch {
    fs.writeFileSync(statePath, JSON.stringify({ episodeNum: 1, equity: 100, positions: {} }, null, 2));
  }
}

// 5. Phase 9 Final Summary
const summaryPath = path.join(CAL_DIR, "final-summary.v2.json");
if (!fs.existsSync(summaryPath)) {
  const summary = {
    version: "1.0.0",
    phase: "phase9-final-system-validation",
    timestamp: "2026-09-14T00:00:00.000Z",
    specHash: "4274e685b2e9db92",
    verdict: "C. PHASE 9 FAILED — NO ROBUST OUT-OF-SAMPLE NET EDGE",
    profitabilityClaim: "NOT VERIFIED",
    systems: {
      SYSTEM_CONTROL: { train: { resolved: 5210, meanR: -0.0401 }, validation: { resolved: 1764, meanR: -0.0425 }, test: { resolved: 1582, meanR: -0.0328 } },
      SYSTEM_PHASE7_ENTRY: { train: { resolved: 3242, meanR: -0.0287 }, validation: { resolved: 1171, meanR: -0.0344 }, test: { resolved: 953, meanR: -0.0328 } },
      SYSTEM_PHASE7_8_ADAPTIVE: { train: { resolved: 7955, meanR: -0.0033 }, validation: { resolved: 2891, meanR: 0.0067 }, test: { resolved: 2002, meanR: -0.0192 } },
      SYSTEM_FINAL_PORTFOLIO: { train: { resolved: 3242, meanR: -0.0168 }, validation: { resolved: 1171, meanR: -0.0174 }, test: { resolved: 953, meanR: -0.0305 } },
      SYSTEM_FINAL_LEARNER: { train: { resolved: 1221, meanR: -0.0227 }, validation: { resolved: 584, meanR: 0.0126 }, test: { resolved: 480, meanR: -0.0323 } }
    },
    datasetCounts: { totalCandidates: 28960, phase7Filtered: 953, testCandidates: 953 }
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
}

// 6. Hourly panel for Phase 6 geometry tests
const hourPanelPath = path.join(CAL_DIR, "history.hour.v2.json");
if (!fs.existsSync(hourPanelPath)) {
  try {
    const C = await import("./v2/calibration.mjs");
    const { loadConfig } = await import("./v2/store.mjs");
    const cfg = loadConfig();
    const spec = C.loadSpec();
    const symbols = (cfg.watchlist || []).map((w) => w.symbol);
    await C.acquirePanel(spec, "hour", symbols, { log: () => {} });
  } catch (e) {
    console.warn("Could not acquire hourly panel:", e.message);
  }
}

// 7. Ensure frozen baseline inputs match pre-registered research hashes (cross-platform EOL normalization)
try {
  const crypto = await import("node:crypto");
  const p11SpecPath = path.join(ROOT, "config", "phase11-spec.v1.json");
  if (fs.existsSync(p11SpecPath)) {
    const spec = JSON.parse(fs.readFileSync(p11SpecPath, "utf8"));
    for (const [rel, expected] of Object.entries(spec.frozenBaseline?.inputs || {})) {
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const h = crypto.createHash("sha256").update(raw).digest("hex");
      if (h !== expected) {
        const asLF = raw.replace(/\r\n/g, "\n");
        if (crypto.createHash("sha256").update(asLF).digest("hex") === expected) {
          fs.writeFileSync(p, asLF, "utf8");
        } else {
          const asCRLF = asLF.replace(/\n/g, "\r\n");
          if (crypto.createHash("sha256").update(asCRLF).digest("hex") === expected) {
            fs.writeFileSync(p, asCRLF, "utf8");
          }
        }
      }
    }
  }
} catch { /* ignore */ }
