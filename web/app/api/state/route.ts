// P9: read-only GET /api/state. Filesystem bridge to the engine's data dir.
// Missing files -> safe empty defaults so the dashboard never crashes (docs/15).
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOTDIR = path.resolve(process.cwd(), "..");
const DATA = path.join(ROOTDIR, "data");

function readJSON(p: string, fallback: any = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function readJSONL(p: string, limit = 0): any[] {
  let rows: any[] = [];
  try {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { /* skip corrupt tail */ }
    }
  } catch { /* missing -> empty */ }
  if (limit > 0 && rows.length > limit) rows = rows.slice(rows.length - limit);
  return rows;
}

// [DECISION] deterministic downsample: stride sampling preserving first/last points.
function downsample(points: any[], max = 320) {
  if (points.length <= max) return points;
  const stride = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * stride)]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

export async function GET() {
  const config = readJSON(path.join(ROOTDIR, "config.json"), null);

  // signals.v2.json primary; signals.json fallback only when version === 2
  let signals = readJSON(path.join(DATA, "signals.v2.json"), null);
  if (!signals) {
    const legacy = readJSON(path.join(DATA, "signals.json"), null);
    if (legacy && legacy.version === 2) signals = legacy;
  }

  const state = readJSON(path.join(DATA, "state.v2.json"), null);
  const episodes = readJSONL(path.join(DATA, "episodes.jsonl"), 40);
  const generations = readJSONL(path.join(DATA, "generations.jsonl"), 30).reverse();
  const stratLib = readJSON(path.join(DATA, "strategies.json"), { strategies: [] });
  const memory = readJSONL(path.join(DATA, "memory.jsonl"), 20).reverse();
  const equity = downsample(readJSONL(path.join(DATA, "equity.v2.jsonl"), 4000));
  const trades = readJSONL(path.join(DATA, "trades.v2.jsonl"), 60).reverse();

  return NextResponse.json(
    {
      serverTs: Date.now(),
      config,
      v2: {
        signals,
        state,
        episodes,
        generations,
        strategies: Array.isArray(stratLib?.strategies) ? stratLib.strategies : [],
        memory,
        equity,
        trades,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// OWNER EXTENSION (deviation from the read-only source spec): control channel.
// Queues commands to data/commands.v2.json; the engine consumes them at its next
// 30s cycle. Validated here; applied by scripts/v2/controls.mjs.
const COMMANDS = path.join(DATA, "commands.v2.json");

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

  let cmd: any = null;
  if (body?.action === "setGoal") {
    const target = num(body.target);
    const deadlineHours = body.deadlineHours == null ? null : num(body.deadlineHours);
    if (!(target > 0)) return NextResponse.json({ ok: false, error: "target must be a positive number" }, { status: 400 });
    if (deadlineHours != null && !(deadlineHours >= 1 && deadlineHours <= 8760))
      return NextResponse.json({ ok: false, error: "deadlineHours must be 1..8760" }, { status: 400 });
    cmd = { type: "setGoal", target, deadlineHours };
  } else if (body?.action === "restart") {
    const capital = num(body.startingCapital);
    const target = body.target == null ? null : num(body.target);
    const maxHours = body.maxHours == null ? null : num(body.maxHours);
    if (!(capital >= 1)) return NextResponse.json({ ok: false, error: "startingCapital must be >= 1" }, { status: 400 });
    if (target != null && !(target > capital))
      return NextResponse.json({ ok: false, error: "target must be greater than startingCapital" }, { status: 400 });
    if (maxHours != null && !(maxHours >= 1 && maxHours <= 8760))
      return NextResponse.json({ ok: false, error: "maxHours must be 1..8760" }, { status: 400 });
    cmd = {
      type: "restart",
      startingCapital: capital,
      ...(target != null ? { target } : {}),
      ...(maxHours != null ? { maxHours } : {}),
      ...(typeof body.survival === "boolean" ? { survival: body.survival } : {}),
    };
  } else if (body?.action === "setSurvival") {
    if (typeof body.enabled !== "boolean")
      return NextResponse.json({ ok: false, error: "enabled must be a boolean" }, { status: 400 });
    cmd = { type: "setSurvival", enabled: body.enabled };
  } else {
    return NextResponse.json({ ok: false, error: "action must be setGoal | restart | setSurvival" }, { status: 400 });
  }

  const file = readJSON(COMMANDS, { commands: [] }) as { commands: any[] };
  file.commands = Array.isArray(file.commands) ? file.commands : [];
  if (file.commands.length >= 20)
    return NextResponse.json({ ok: false, error: "command queue full; engine not consuming?" }, { status: 503 });
  file.commands.push(cmd);
  fs.writeFileSync(COMMANDS + ".tmp", JSON.stringify(file, null, 2));
  fs.renameSync(COMMANDS + ".tmp", COMMANDS);

  return NextResponse.json({ ok: true, queued: cmd, note: "engine picks this up within ~30s" });
}
