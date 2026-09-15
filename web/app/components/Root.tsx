"use client";

import { useEffect, useRef, useState } from "react";
import DashboardV2 from "./DashboardV2";
import { DataStream, TerminalLogo } from "./visuals";

// Polls GET /api/state every 6 seconds, no-store.
// Shows a retro CRT boot sequence while the first payload is in flight.

const BOOT_LINES = [
  "FABINVESTS TERMINAL FX-2000",
  "BIOS v2.11 (C) 1987 FABRICATED MICROSYSTEMS INC.",
  "",
  "RAM CHECK ......................... 640K OK",
  "PHOSPHOR ARRAY .................... OK",
  "SCANLINE GENERATOR ................ OK",
  "TAPE DRIVE ........................ OK",
  "MARKET DATA UPLINK ................ HANDSHAKING",
  "LOADING STRATEGY ROM ............. 6 MODULES",
  "LOADING RISK GATES ................ ENABLED",
  "LOADING CONTEXTUAL LEARNER ........ PRESENT",
  "ALPHA MODULE ...................... NOT FOUND",
  "",
  "WARNING: NO GUARANTEED EDGE DETECTED.",
  "WARNING: PAPER MONEY ONLY. DO NOT CONNECT TO REAL BROKER.",
  "",
  "READY.",
];

export default function Root() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!stopped) {
          setData(j);
          setError(null);
        }
      } catch (e: any) {
        if (!stopped && e?.name !== "AbortError") setError(e?.message ?? "fetch failed");
      }
      if (!stopped) timer = setTimeout(load, 6000);
    };
    load();
    return () => {
      stopped = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);

  // Reveal the boot log one line at a time. Lightweight: one setState per line.
  useEffect(() => {
    if (data) return;
    if (lineCount >= BOOT_LINES.length) return;
    const t = setTimeout(() => setLineCount((c) => c + 1), lineCount === 0 ? 120 : 145);
    return () => clearTimeout(t);
  }, [lineCount, data]);

  if (!data) {
    return (
      <div className="boot-screen min-h-screen flex items-start justify-center p-4 sm:p-8">
        <DataStream count={12} />
        <div className="card w-full max-w-2xl">
          <div className="titlebar">
            <span>■ SYSTEM BOOT</span>
            <span className="blink">●</span>
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
              <TerminalLogo size={40} />
              <div>
                <div className="font-display text-3xl text-phos glow-phos leading-none">FABINVESTS</div>
                <div className="label">leveraged paper terminal · fake money</div>
              </div>
            </div>
            <pre className="text-xs sm:text-sm leading-relaxed text-phos whitespace-pre-wrap">
              {BOOT_LINES.slice(0, lineCount).join("\n")}
            </pre>
            <div className="text-xs sm:text-sm text-phos cursor mt-1" aria-hidden="true" />
            {error && (
              <p className="mt-4 text-alert text-xs">
                ! UPLINK FAULT ({error}) — RETRYING. TERMINAL WILL NOT PRETEND IT SUCCEEDED.
              </p>
            )}
            {lineCount >= BOOT_LINES.length && !error && (
              <p className="mt-4 text-amberdim text-xs blink-slow">
                AWAITING ENGINE HEARTBEAT… (elapsed {Math.round((Date.now() - started.current) / 1000)}s)
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  return <DashboardV2 data={data} />;
}
