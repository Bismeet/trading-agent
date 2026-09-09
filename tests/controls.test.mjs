// tests/controls.test.mjs — owner command channel + survival gating.
// Fully isolated: uses a temp FAB_DATA dir so tests NEVER touch the live data/ ledger
// (regression: earlier version polluted the live episodes.jsonl).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-test-"));
const { consumeCommands, survivalGate, SURVIVAL_MAX_LEV } = await import("../scripts/v2/controls.mjs");
const { freshV2State, episodeEndReason } = await import("../scripts/v2/episode.mjs");
const { loadConfig, V2 } = await import("../scripts/v2/store.mjs");
const CMD = V2.commands;

const cfg = loadConfig();

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

test("malformed commands are kept with error + attempts, not silently dropped", () => {
  const s = freshV2State(cfg);
  fs.writeFileSync(CMD, JSON.stringify({ commands: [{ type: "setGoal", target: -5 }, { type: "wat" }] }));
  const applied = consumeCommands(s, cfg);
  assert.equal(applied.length, 0);
  const left = JSON.parse(fs.readFileSync(CMD, "utf8")).commands;
  assert.equal(left.length, 2);
  assert.ok(left.every((c) => c.error && c.attempts === 1));
});
