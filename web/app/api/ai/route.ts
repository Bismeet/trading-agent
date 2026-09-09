import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOTDIR = path.resolve(process.cwd(), "..");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");

  let config: any = null;
  try {
    config = JSON.parse(fs.readFileSync(path.join(ROOTDIR, "config.json"), "utf8"));
  } catch {
    /* fallback */
  }

  const baseUrl = config?.v2?.ai?.tradingAgentsBaseUrl || "http://127.0.0.1:8000";

  // If runId provided, fetch specific analysis snapshot
  const targetUrl = runId
    ? `${baseUrl}/api/analysis/${encodeURIComponent(runId)}`
    : `${baseUrl}/api/health`;

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, error: res.statusText }, { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, available: false, error: err?.message || "TradingAgents unreachable" }, { status: 200 });
  }
}
