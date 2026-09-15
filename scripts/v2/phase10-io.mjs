// scripts/v2/phase10-io.mjs — PHASE 10: write isolation.
//
// The phase 10 research runner may ONLY write its own artefacts under
// data/calibration/ plus its single report file. It must never be able to touch
// config/ or any production data file. Mirrors the alpha-phase guard.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const PHASE10_DIR = path.join(REPO_ROOT, "data", "calibration");
export const PHASE10_SUMMARY_PATH = path.join(PHASE10_DIR, "phase10-summary.v1.json");
export const PHASE10_TRADES_PATH = path.join(PHASE10_DIR, "phase10-trades.v1.jsonl");
export const PHASE10_REPORT_PATH = path.join(REPO_ROOT, "PHASE10_REGIME_PORTFOLIO_REPORT.md");
export const PHASE10_SPEC_PATH = path.join(REPO_ROOT, "config", "phase10-spec.v1.json");

export function assertPhase10Path(target, { allowReport = false } = {}) {
  const abs = path.resolve(target);
  const allowed = [PHASE10_DIR];
  if (allowReport) allowed.push(PHASE10_REPORT_PATH);
  const ok = allowed.some((a) => abs === a || abs.startsWith(a + path.sep));
  if (!ok) throw new Error(`phase10: refusing to write outside the phase 10 research area: ${abs}`);
  return abs;
}

export function writePhase10JSON(target, obj, { allowReport = false } = {}) {
  const abs = assertPhase10Path(target, { allowReport });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  return abs;
}

export function writePhase10Trades(target, trades) {
  const abs = assertPhase10Path(target);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, trades.map((t) => JSON.stringify(t)).join("\n") + (trades.length ? "\n" : ""));
  return abs;
}
