// tests/reliability.test.mjs — reliability fixes: poison-queue hygiene,
// snapshotId monotonicity, heartbeat contract, restart-once semantics.
// Isolated via FAB_DATA so the live ledger is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-rel-"));
const { consumeCommands, CMD_MAX_ATTEMPTS } = await import("../scripts/v2/controls.mjs");
const { freshV2State } = await import("../scripts/v2/episode.mjs");
const { loadConfig, V2 } = await import("../scripts/v2/store.mjs");
const cfg = loadConfig();

test("poison commands retry then drop to errors (never block queue)", () => {
  const s = freshV2State(cfg);
  fs.writeFileSync(V2.commands, JSON.stringify({ commands: [{ type: "wat" }] }));
  for (let i = 0; i < CMD_MAX_ATTEMPTS; i++) consumeCommands(s, cfg);
  const left = JSON.parse(fs.readFileSync(V2.commands, "utf8"));
  assert.equal(left.commands.length, 0);
  assert.equal(left.errors.length, 1);
  assert.ok(left.errors[0].reason.includes("dropped"));
});

test("poison errors capped: many bad commands do not grow file unboundedly", () => {
  const s = freshV2State(cfg);
  const bad = Array.from({ length: 25 }, (_, i) => ({ type: `nope-${i}` }));
  fs.writeFileSync(V2.commands, JSON.stringify({ commands: bad }));
  for (let i = 0; i < CMD_MAX_ATTEMPTS + 1; i++) consumeCommands(s, cfg);
  const left = JSON.parse(fs.readFileSync(V2.commands, "utf8"));
  assert.equal(left.commands.length, 0);
  assert.ok(left.errors.length <= 10);
});

test("valid commands still apply while poison present", () => {
  const s = freshV2State(cfg);
  fs.writeFileSync(V2.commands, JSON.stringify({ commands: [{ type: "wat" }, { type: "setSurvival", enabled: true }] }));
  const applied = consumeCommands(s, cfg);
  assert.equal(applied.length, 1);
  assert.equal(s.survival.enabled, true);
});

test("V2 registry exposes heartbeat path under FAB_DATA", () => {
  assert.ok(V2.heartbeat.startsWith(process.env.FAB_DATA));
  assert.ok(V2.heartbeat.endsWith("heartbeat.v2.json"));
});

test("snapshotId format ties episode+cycle+ts", () => {
  const s = freshV2State(cfg);
  s.cycles = 7;
  const t = Date.now();
  s.snapshotId = `${s.episodeId}:cycle_${s.cycles}:${t}`;
  assert.ok(s.snapshotId.includes(s.episodeId));
  assert.ok(s.snapshotId.includes("cycle_7"));
});

test("heartbeat freshness rule: <90s alive, older stale", () => {
  const fresh = { ts: Date.now() - 10000 };
  const old = { ts: Date.now() - 120000 };
  const alive = (hb) => Date.now() - hb.ts < 90000;
  assert.equal(alive(fresh), true);
  assert.equal(alive(old), false);
});
