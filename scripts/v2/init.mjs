// scripts/v2/init.mjs — P8 CLI initialization. Idempotent without --force.
// --force resets state/collateral but does NOT erase journals/history (docs/07).
import { V2, readJSON, writeJSON, loadConfig } from "./store.mjs";
import { freshV2State } from "./episode.mjs";
import { ensureStrategies } from "./strategies.mjs";

const force = process.argv.includes("--force");
const cfg = loadConfig();
const existing = readJSON(V2.state, null);

if (existing && !force) {
  console.log(`Existing state found: Episode ${existing.episodeNum}, equity $${existing.equity}. Learning and collateral preserved. Use --force to reset.`);
  process.exit(0);
}

writeJSON(V2.state, freshV2State(cfg));
ensureStrategies(); // merges seeds without clobbering existing learned stats
writeJSON(V2.pending, { orders: [] });

console.log(`Episode 1 initialized.`);
console.log(`  Starting collateral: $${cfg.v2.startingCapital}`);
console.log(`  Leverage: ${cfg.v2.aggression.leverageStart}x start / ${cfg.v2.aggression.leverageCeiling}x ceiling`);
console.log(`  Kelly fraction: ${cfg.v2.aggression.kellyFractionStart}`);
console.log(`  Goal: $${cfg.v2.episode.goal.target} within ${cfg.v2.episode.goal.deadlineHours}h`);
console.log(`Paper trading only. Fake money, real lessons. Never connect to real-money execution.`);
