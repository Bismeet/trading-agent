// scripts/v2/phase11-io.mjs — PHASE 11: write isolation.
//
// The Phase 11 research runner may ONLY write its own artefacts under
// data/calibration/ plus its two report files. It must never be able to touch
// config/ or any production data file. Mirrors the Phase 10 guard exactly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const PHASE11_DIR = path.join(REPO_ROOT, "data", "calibration");
export const PHASE11_SUMMARY_PATH = path.join(PHASE11_DIR, "phase11-summary.v1.json");
export const PHASE11_TRADES_PATH = path.join(PHASE11_DIR, "phase11-trades.v1.jsonl");
export const PHASE11_EQUITY_PATH = path.join(PHASE11_DIR, "phase11-equity.v1.json");
export const PHASE11_LOCK_PATH = path.join(PHASE11_DIR, "phase11-lock.v1.json");
export const PHASE11_REPORT_PATH = path.join(REPO_ROOT, "PHASE11_RESEARCH_REPORT.md");
export const PHASE11_PROPOSAL_PATH = path.join(REPO_ROOT, "PHASE11_RESEARCH_PROPOSAL.md");
export const PHASE11_SPEC_PATH = path.join(REPO_ROOT, "config", "phase11-spec.v1.json");

export function assertPhase11Path(target, { allowReport = false } = {}) {
  const abs = path.resolve(target);
  const allowed = [PHASE11_DIR];
  if (allowReport) allowed.push(PHASE11_REPORT_PATH, PHASE11_PROPOSAL_PATH);
  const ok = allowed.some((a) => abs === a || abs.startsWith(a + path.sep));
  if (!ok) throw new Error(`phase11: refusing to write outside the phase 11 research area: ${abs}`);
  return abs;
}

export function writePhase11JSON(target, obj, { allowReport = false } = {}) {
  const abs = assertPhase11Path(target, { allowReport });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  return abs;
}

export function writePhase11Markdown(target, text) {
  const abs = assertPhase11Path(target, { allowReport: true });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

export function writePhase11Trades(target, trades) {
  const abs = assertPhase11Path(target);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, trades.map((t) => JSON.stringify(t)).join("\n") + (trades.length ? "\n" : ""));
  return abs;
}
