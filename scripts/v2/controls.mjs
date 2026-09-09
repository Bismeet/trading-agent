// scripts/v2/controls.mjs — OWNER EXTENSION (deviation from the read-only source spec,
// documented in DECISIONS.md): dashboard -> engine command channel + survival mode.
//
// Survival mode implements the owner's mandate: "you have X and must survive on your
// own; losses are not acceptable; long term we only need profit" as faithfully as an
// honest simulator can:
//   - while the run is UNDERWATER (equity < goal.startEquity): NO new positions at all
//   - once back above water: new entries allowed, but leverage hard-capped at 5x
//   - this cannot guarantee profits — it makes capital preservation the priority.
import { V2, readJSON, writeJSON, now } from "./store.mjs";
import { finalizeEpisode, nextEpisode, setGoal } from "./episode.mjs";

export const SURVIVAL_MAX_LEV = 5;

// Read + consume pending commands. Returns list applied.
// [RELIABILITY] poison hygiene: a command that keeps failing gets an
// `attempts` counter; after MAX_ATTEMPTS it is moved to `errors` (capped at
// MAX_ERRORS) so one bad command can never fill/block the queue (B02).
export const CMD_MAX_ATTEMPTS = 5;
export const CMD_MAX_ERRORS = 10;
export function consumeCommands(state, cfg) {
  const file = readJSON(V2.commands, { commands: [] });
  const applied = [];
  const remaining = [];
  const errors = Array.isArray(file.errors) ? file.errors.slice(-CMD_MAX_ERRORS) : [];
  for (const cmd of file.commands || []) {
    try {
      applyCommand(state, cfg, cmd);
      applied.push(cmd);
    } catch (e) {
      cmd.error = e.message;
      cmd.attempts = (cmd.attempts ?? 0) + 1;
      if (cmd.attempts >= CMD_MAX_ATTEMPTS) {
        errors.push({ ...cmd, droppedAt: now(), reason: `failed ${cmd.attempts}x; dropped` });
        while (errors.length > CMD_MAX_ERRORS) errors.shift();
      } else {
        remaining.push(cmd); // retried next cycle, with visible attempts count
      }
    }
  }
  writeJSON(V2.commands, { commands: remaining, ...(errors.length ? { errors } : {}) });
  return applied;
}

function applyCommand(state, cfg, cmd) {
  switch (cmd.type) {
    case "setGoal": {
      if (!Number.isFinite(cmd.target) || cmd.target <= 0) throw new Error("invalid target");
      const deadline = Number.isFinite(cmd.deadlineHours) ? cmd.deadlineHours : state.goal?.deadlineHours ?? 24;
      setGoal(state, cmd.target, deadline);
      break;
    }
    case "restart": {
      const capital = cmd.startingCapital;
      if (!Number.isFinite(capital) || capital < 1) throw new Error("invalid startingCapital");
      const target = Number.isFinite(cmd.target) ? cmd.target : capital * 5;
      const maxHours = Number.isFinite(cmd.maxHours) && cmd.maxHours > 0 ? cmd.maxHours : cfg.v2.episode.maxHoursPerEpisode;
      // settle-and-record the current run (survivors were marked last cycle; a manual
      // restart forfeits open positions rather than carrying them into the new mandate)
      if (Object.keys(state.positions || {}).length || state.equity !== state.startingCapital) {
        finalizeEpisode(state, "manual-restart");
      }
      nextEpisode(state, cfg);
      // owner overrides applied after the standard reset
      state.startingCapital = capital;
      state.walletBalance = capital;
      state.equity = capital;
      state.peakEquity = capital;
      state.lifetime.bestEquityEver = Math.max(state.lifetime.bestEquityEver, capital);
      state.goal = { target, deadlineHours: maxHours, startEquity: capital, startedAt: now() };
      state.episodeMaxHours = maxHours;
      if (typeof cmd.survival === "boolean") state.survival = { enabled: cmd.survival };
      break;
    }
    case "setSurvival": {
      if (typeof cmd.enabled !== "boolean") throw new Error("invalid enabled");
      state.survival = { enabled: cmd.enabled };
      break;
    }
    default:
      throw new Error(`unknown command type: ${cmd.type}`);
  }
}

// Survival gating for new entries. Returns { blocked, reason, maxLev }.
export function survivalGate(state) {
  if (!state.survival?.enabled) return { blocked: false, maxLev: Infinity };
  const floor = state.goal?.startEquity ?? state.startingCapital;
  if (state.equity < floor) {
    return { blocked: true, reason: "survival: underwater — no new risk until back above start", maxLev: 0 };
  }
  return { blocked: false, reason: "survival: above water — entries capped at 5x", maxLev: SURVIVAL_MAX_LEV };
}