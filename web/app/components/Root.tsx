"use client";

import { useEffect, useRef, useState } from "react";
import DashboardV2 from "./DashboardV2";
import { Mascot, Sakura } from "./visuals";

// [RELIABILITY F05] robust poller: every poll is a FULL snapshot (backend owns
// execution; refresh/reconnect just re-reads files, never restarts anything).
// In-flight guard + exponential backoff + tab-visibility pause + keep-last-good
// + explicit LIVE / RECONNECTING / STALE / ERROR connection states (B05).
type Conn = "loading" | "live" | "reconnecting" | "stale" | "error";
const BASE_MS = 6000, MAX_MS = 60000;
export default function Root() {
  const [data, setData] = useState<any>(null);
  const [conn, setConn] = useState<Conn>("loading");
  const [error, setError] = useState<string | null>(null);
  const [failCount, setFailCount] = useState(0);
  const inFlight = useRef(false);
  const backoff = useRef(BASE_MS);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => { if (!stopped) { clearTimeout(timer); timer = setTimeout(load, ms); } };
    const load = async () => {
      if (stopped) return;
      if (document.hidden) { schedule(BASE_MS); return; }
      if (inFlight.current) { schedule(BASE_MS); return; }
      inFlight.current = true;
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (stopped) return;
        // Torn cross-file read: keep showing last good frame, retry soon (B01).
        if (j?.snapshot && j.snapshot.consistent === false) {
          setConn((c) => (c === "live" || c === "reconnecting" ? "reconnecting" : c));
          schedule(2000);
          return;
        }
        setData(j); setError(null); setFailCount(0);
        backoff.current = BASE_MS;
        // Engine liveness comes from heartbeat age, not from poll success.
        setConn(j?.liveness?.alive === false ? "stale" : "live");
        schedule(BASE_MS);
      } catch (e: any) {
        if (stopped) return;
        setError(e?.message ?? "fetch failed");
        setFailCount((c) => c + 1);
        setConn((c) => (c === "live" || c === "reconnecting" ? "reconnecting" : "error"));
        backoff.current = Math.min(MAX_MS, backoff.current * 2);
        schedule(backoff.current);
      } finally {
        inFlight.current = false;
      }
    };
    load();
    const onVis = () => { if (!document.hidden) { backoff.current = BASE_MS; load(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Sakura />
        <Mascot size={72} mood="happy" />
        <p className="font-jp text-inksoft">warming up the bot…</p>
        <p className="text-xs tnum text-inksoft" role="status">
          {conn === "error" ? `API not reachable (${error}) — retrying with backoff` : "connecting…"}
        </p>
      </div>
    );
  }
  return <DashboardV2 data={data} conn={conn} fails={failCount} err={error} />;
}
