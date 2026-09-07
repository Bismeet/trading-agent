// tests/controls.test.mjs — owner command channel + survival gating.
// Backs up and restores data/commands.v2.json so the live engine queue is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { consumeCommands, survivalGate, SURVIVAL_MAX_LEV } from "../scripts/v2/controls.mjs";
import { freshV2State, episodeEndReason } from "../scripts/v2/episode.mjs";
import { loadConfig } from "../scripts/lib.mjs";

const cfg = loadConfig();
const CMD = fileURLToPath(new URL("../data/commands.v2.json", import.meta.url));
const backup = fs.existsSync(CMD) ? fs.readFileSync(CMD, "utf8") : null;
test.after(() => { backup !== null ? fs.writeFileSync(CMD, backup) : fs.existsSync(CMD) && fs.rmSync(CMD); });

test("setGoal command updates goal using current equity baseline", () => {
  const s = freshV2State(cfg);
  s.equity = 250;
  fs.writeFileSync(CMD, JSON.stringify({ commands: [{ type: "setGoal", target: 1000, deadlineHours: 48 }] }));
  const applied = consumeCommands(s, cfg);
  assert.equal(applied.length, 1);
  assert.equal(s.goal.target, 1000);
  assert.equal(s.goal.startEquity, 250); // current equity baseline
  assert.equal(s.goal.deadlineHours, 48);
  assert.deepEqual(consumeCommands(s, cfg), []); // queue consumed
});

test("restart command settles, resets with owner capital/goal/hours", () => {
  const s = freshV2State(cfg);
  s.equity = 130;
  s.positions = { "BTC-USD": { fake: true } };
  fs.writeFileSync(CMD, JSON.stringify({ commands: [{ type: "restart", startingCapital: 500, target: 1500, maxHours: 8, survival: true }] }));
  consumeCommands(s, cfg);
  assert.equal(s.startingCapital, 500);
  assert.equal(s.walletBalance, 500);
  assert.equal(s.equity, 500);
  assert.equal(s.goal.target, 1500);
  assert.equal(s.goal.startEquity, 500);
  assert.equal(s.episodeMaxHours, 8);
  assert.deepEqual(s.positions, {});
  assert.equal(s.survival.enabled, true);
  // owner maxHours governs episode timeout
  const past = s.startedAt + 8 * 3600000 + 1;
  assert.equal(episodeEndReason(s, cfg, past), "time");
  assert.equal(episodeEndReason(s, cfg, s.startedAt + 8 * 3600000 - 1), null);
});

test("survival gating: blocked underwater, 5x cap above water, off = no gate", () => {
  const s = freshV2State(cfg);
  s.survival = { enabled: true };
  s.equity = 90; // below start 100
  const under = survivalGate(s);
  assert.equal(under.blocked, true);
  s.equity = 110;
  const above = survivalGate(s);
  assert.equal(above.blocked, false);
  assert.equal(above.maxLev, SURVIVAL_MAX_LEV);
  assert.equal(above.maxLev, 5);
  s.survival = { enabled: false };
  const off = survivalGate(s);
  assert.equal(off.blocked, false);
  assert.equal(off.maxLev, Infinity);
});

test("malformed commands are kept with error, not silently dropped", () => {
  const s = freshV2State(cfg);
  fs.writeFileSync(CMD, JSON.stringify({ commands: [{ type: "setGoal", target: -5 }, { type: "wat" }] }));
  const applied = consumeCommands(s, cfg);
  assert.equal(applied.length, 0);
  const left = JSON.parse(fs.readFileSync(CMD, "utf8")).commands;
  assert.equal(left.length, 2);
  assert.ok(left.every((c) => c.error));
});
