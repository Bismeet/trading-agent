// scripts/v2/store.mjs — P2: re-export lib helpers + V2 path registry (docs/06).
export * from "../lib.mjs";
import path from "node:path";
import { DATA } from "../lib.mjs";

export const V2 = {
  state: path.join(DATA, "state.v2.json"),
  signals: process.env.FAB_SIGNALS || path.join(DATA, "signals.v2.json"),
  episodes: path.join(DATA, "episodes.jsonl"),
  generations: path.join(DATA, "generations.jsonl"),
  strategies: path.join(DATA, "strategies.json"),
  memory: path.join(DATA, "memory.jsonl"),
  pending: path.join(DATA, "pending.v2.json"),
  backtestStats: path.join(DATA, "backtest_stats.json"),
  trades: path.join(DATA, "trades.v2.jsonl"),
  equity: path.join(DATA, "equity.v2.jsonl"),
  prices: path.join(DATA, "prices.v2.json"),
  log: path.join(DATA, "engine.v2.log"),
  journal: path.join(DATA, "journal.v2.jsonl"),
  playbook: path.join(DATA, "playbook.json"),
  reflog: path.join(DATA, "reflog.v2.jsonl"),
  calib: path.join(DATA, "calibration.json"),
  world: path.join(DATA, "world.v2.json"),
  worldThesis: path.join(DATA, "world_thesis.v2.json"),
  worldCache: path.join(DATA, "world_cache_v2"),
  commands: path.join(DATA, "commands.v2.json"), // owner control channel (dashboard -> engine)
};

export const round = (x, d = 2) => {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
};
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
