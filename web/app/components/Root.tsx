"use client";

import { useEffect, useState } from "react";
import DashboardV2 from "./DashboardV2";
import { Mascot, Sakura } from "./visuals";

// P9: poll GET /api/state every 6 seconds, no-store; friendly loading screen.
export default function Root() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!stopped) { setData(j); setError(null); }
      } catch (e: any) {
        if (!stopped && e?.name !== "AbortError") setError(e?.message ?? "fetch failed");
      }
      if (!stopped) timer = setTimeout(load, 6000);
    };
    load();
    return () => { stopped = true; ctrl.abort(); clearTimeout(timer); };
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Sakura />
        <Mascot size={72} mood="happy" />
        <p className="font-jp text-inksoft">warming up the bot…</p>
        {error && <p className="text-downink text-sm">API not reachable yet ({error}) — retrying</p>}
      </div>
    );
  }
  return <DashboardV2 data={data} />;
}
