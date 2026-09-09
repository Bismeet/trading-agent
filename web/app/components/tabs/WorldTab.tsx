"use client";

import React from "react";
import { usd } from "../../lib/format";
import { SectionExplainer } from "../ui/SectionExplainer";

const BAND_WORDS: Record<string, string> = {
  extreme_fear: "Extreme Fear",
  fear: "Fear",
  neutral: "Neutral",
  greed: "Greed",
  extreme_greed: "Extreme Greed",
  unknown: "—",
};

function Gauge({ label, g }: { label: string; g: any }) {
  const v = g?.value;
  const band = BAND_WORDS[g?.band] ?? "—";

  return (
    <div className="card-fintech p-5 flex flex-col justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-inksoft">{label}</div>
        <div className="font-display text-3xl font-bold tnum mt-2 text-ink">
          {v ?? "—"}
        </div>
        <div className="text-xs text-inksoft mt-0.5">
          {band}
          {g?._stale ? " · stale feed" : ""}
        </div>
      </div>

      <div className="mt-4">
        <div className="h-2.5 rounded-full bg-black/5 overflow-hidden p-0.5 border border-white/80 relative">
          <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 w-full" />
        </div>
        {v != null && (
          <div className="relative mt-1">
            <div
              className="absolute -top-3 w-4 h-4 rounded-full bg-white border-2 border-ink shadow-sm -ml-2"
              style={{ left: `${Math.max(0, Math.min(100, v))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface WorldTabProps {
  s: any;
}

export function WorldTab({ s }: WorldTabProps) {
  const w = s?.world ?? null;
  const row = (k: string, val: any) => (
    <div className="flex justify-between items-center text-xs sm:text-sm py-2 border-b border-black/5 last:border-0">
      <span className="text-inksoft font-medium">{k}</span>
      <span className="tnum font-bold text-ink">{val ?? "—"}</span>
    </div>
  );

  const headlines = [...(w?.fed?.titles ?? []), ...(w?.headlines ?? [])];

  return (
    <div className="flex flex-col gap-6">
      <SectionExplainer
        title="World / Macro"
        definition="external macro regime, multi-timeframe market conditions, and environment context."
        details="Aggregates market-wide sentiment indicators, crypto and equity fear & greed indexes, Federal Reserve rate forecasts, news feeds, and funding regimes."
      />

      {/* Header Banner */}
      <div className="card-fintech p-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
          World Macro &amp; Liquidity Flow
        </h1>
        <p className="text-xs text-inksoft mt-0.5">
          Real-time macro catalysts, cross-asset sentiment gauges, and derivative positioning indicators ingested by the engine.
        </p>
      </div>

      {/* Gauges Grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Gauge label="Crypto Fear & Greed Index" g={w?.fearGreedCrypto} />
        <Gauge label="Stock Market Fear & Greed" g={w?.fearGreedStocks} />
      </div>

      {/* Macro Indicators & Market Drivers */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-fintech p-5">
          <h2 className="font-display font-semibold text-base text-ink mb-2">
            Derivative &amp; Flow Metrics
          </h2>
          {row("Market Regime", w?.regime)}
          {row("Funding Rate (8h)", w?.fundingRate != null ? `${(w.fundingRate * 100).toFixed(4)}%` : "—")}
          {row("Aggregate Crypto OI", w?.oiUsd != null ? usd(w.oiUsd, 0) : "—")}
          {row("Whale vs Retail Skew", w?.whaleCrowd)}
          {row("News Headline Sentiment", w?.newsMood ? `${w.newsMood.mean.toFixed(2)}${w.newsMood.mixed ? " (mixed)" : ""}` : "—")}
          {row("Put / Call Volume Ratio", w?.putCall?.ratio != null ? w.putCall.ratio.toFixed(2) : "—")}

          {w?.macro && (
            <div className="mt-3 pt-2.5 border-t border-black/5 text-xs text-inksoft">
              <span className="font-semibold text-ink">Active Macro Drivers: </span>
              {(w.macro.drivers ?? []).join(" · ") || "None currently dominant"}
              {w.macro._stale ? " (stale)" : ""}
            </div>
          )}
        </div>

        {/* Global Market Thesis */}
        <div className="card-fintech p-5 flex flex-col justify-between">
          <div>
            <h2 className="font-display font-semibold text-base text-ink mb-2">
              Macro Hypothesis
            </h2>
            <p className="text-xs sm:text-sm text-ink leading-relaxed bg-white/60 p-3 rounded-xl border border-white/80">
              {w?.thesis ?? "Macro thesis generator currently neutral. No high-conviction directional bias established across macro drivers."}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-black/5 text-[11px] text-inksoft">
            Observation cycle active · Synchronized to live market feeds
          </div>
        </div>
      </div>

      {/* Headlines Feed */}
      <div className="card-fintech p-5">
        <h2 className="font-display font-semibold text-base text-ink mb-3">
          Breaking Catalysts &amp; Fed Headlines
        </h2>

        {headlines.length === 0 ? (
          <p className="text-xs text-inksoft py-4">No new headlines ingested in this window.</p>
        ) : (
          <ul className="text-xs sm:text-sm flex flex-col divide-y divide-black/5">
            {headlines.slice(0, 16).map((h, i) => (
              <li key={i} className="py-2.5 text-ink leading-snug flex items-start gap-2">
                <span className="text-sakura/90 text-xs shrink-0 mt-0.5">●</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default WorldTab;
