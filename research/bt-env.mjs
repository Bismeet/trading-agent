// research/bt-env.mjs — must be the FIRST import of backtest.mjs.
// Isolates the harness from the live engine's data/ directory: store.mjs resolves
// its V2 path registry from FAB_DATA at module-init time, so the env var has to be
// set before any scripts/v2 import is evaluated. Keeps backtests reproducible even
// on machines that carry live learned state in data/strategies.json.
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.env.FAB_DATA) {
  process.env.FAB_DATA = path.join(ROOT, "research", ".bt-scratch");
}
