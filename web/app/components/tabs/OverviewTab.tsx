"use client";

import React, { useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { usd, pct, signed, tone, price, timeAgo } from "../../lib/format";
import { MetricCard } from "../ui/MetricCard";
import { StatusBadge } from "../ui/StatusBadge";
import { LiquidRunwayMeter } from "../ui/LiquidRunwayMeter";
import { GlassButton } from "../ui/GlassButton";
import { Mascot } from "../visuals";

function Spark({ points, up }: { points: any[]; up: boolean }) {
  if (!points?.length) {
    return <div className="h-14 flex items-center justify-center text-inksoft text-xs">—</div>;
  }
  const d = points.map((p) => ({ v: p.equity }));
  return (
    <div className="h-14" aria-label="equity sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={up ? "#157a4a" : "#c0354f"}
            fill={up ? "#1f9d6225" : "#e5566f25"}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Multimodal Decision Council Log (analyst -> risk -> investor)
function AgentCouncilCard({ s }: { s: any }) {
  const d = s?.agents?.decisions;
  const last = Array.isArray(d) ? d[d.length - 1] : null;

  return (
    <div className="card-fintech p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">⚖️</span>
          <h3 className="font-display font-semibold text-sm text-ink">
            Deterministic Decision Council
          </h3>
        </div>
        <span className="text-[11px] text-inksoft">
          analyst ➔ risk ➔ investor · multimodal rules
        </span>
      </div>

      {!last ? (
        <p className="text-xs text-inksoft mt-1">No candidate trade intents evaluated yet this cycle.</p>
      ) : (
        <div className="mt-2 text-xs">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-bold text-ink tnum text-sm">{last.symbol}</span>
            <StatusBadge status={last.side || "long"} size="sm" />
            <StatusBadge
              status={last.approved ? "approved" : "rejected"}
              label={last.approved ? "COUNCIL APPROVED" : "COUNCIL REJECTED"}
              size="sm"
            />
            <span className="text-inksoft">by {last.strategy_id ?? "manual"}</span>
          </div>

          <ul className="grid sm:grid-cols-3 gap-2">
            {(last.verdicts ?? []).map((v: any, i: number) => (
              <li
                key={i}
                className={`p-2.5 rounded-lg border text-xs ${
                  v.vote === "veto"
                    ? "bg-rose-500/10 border-rose-500/25 text-rose-900"
                    : "bg-emerald-500/10 border-emerald-500/25 text-emerald-900"
                }`}
              >
                <div className="font-bold capitalize flex items-center justify-between">
                  <span>{v.agent}</span>
                  <span className="text-[10px] uppercase font-mono">{v.vote}</span>
                </div>
                {v.reasons?.[0] && (
                  <div className="text-inksoft mt-1 text-[11px] leading-snug">
                    {v.reasons[0]}
                    {v.reasons.length > 1 ? ` (+${v.reasons.length - 1} more)` : ""}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Administrative Control Panel (settle, restart, goal, survival)
function ControlPanel({ s }: { s: any }) {
  const [capital, setCapital] = useState("100");
  const [goal, setGoal] = useState("500");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const post = async (body: any, label: string) => {
    setBusy(label);
    setMsg(null);
    try {
      const withToken = {
        ...body,
        clientToken: body.clientToken ?? `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withToken),
      });
      const j = await res.json();
      setMsg(j.ok ? { ok: true, text: `Queued — engine applies command within ~30s.` } : { ok: false, text: j.error ?? "failed" });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "request failed" });
    } finally {
      setBusy(null);
    }
  };

  const survivalOn = !!s?.survival?.enabled;
  const cap = Number(capital), tgt = Number(goal), hrs = Number(hours);
  const restartValid = cap >= 1 && tgt > cap && hrs >= 1 && hrs <= 8760;

  return (
    <div className="card-fintech p-5">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">⚙️</span>
          <h3 className="font-display font-semibold text-sm text-ink">
            Episode &amp; Execution Controls
          </h3>
          <span className="text-xs text-inksoft">
            ({survivalOn ? "Survival Mode Active" : "Standard Mode"})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-inksoft">{isExpanded ? "Hide Controls ▲" : "Configure Controls ▼"}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-black/5 flex flex-col gap-4">
          <p className="text-xs text-inksoft leading-relaxed">
            Administrative mandate controls. Restart archives current run metrics and resets starting equity. Survival mode prevents new positions while underwater and limits max leverage to 5x.
          </p>

          <div className="grid sm:grid-cols-4 gap-3 text-xs">
            <label className="text-inksoft font-medium">
              Starting Capital ($)
              <input
                type="number"
                min="1"
                step="1"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white/80 border border-white/90 text-ink tnum outline-none focus:ring-1 focus:ring-sakura"
              />
            </label>

            <label className="text-inksoft font-medium">
              Goal Target ($)
              <input
                type="number"
                min="1"
                step="1"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white/80 border border-white/90 text-ink tnum outline-none focus:ring-1 focus:ring-sakura"
              />
            </label>

            <label className="text-inksoft font-medium">
              Duration (hours)
              <input
                type="number"
                min="1"
                max="8760"
                step="1"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white/80 border border-white/90 text-ink tnum outline-none focus:ring-1 focus:ring-sakura"
              />
            </label>

            <div className="flex items-end">
              <GlassButton
                variant="primary"
                disabled={!restartValid || busy !== null}
                busy={busy === "restart"}
                onClick={() => {
                  if (
                    confirm(
                      `Restart Episode with $${cap}, goal $${tgt}, ${hrs}h? Open positions are settled and the current run is archived.`
                    )
                  ) {
                    post(
                      {
                        action: "restart",
                        startingCapital: cap,
                        target: tgt,
                        maxHours: hrs,
                        survival: survivalOn,
                      },
                      "restart"
                    );
                  }
                }}
                className="w-full"
              >
                Restart Episode
              </GlassButton>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2">
            <GlassButton
              size="sm"
              disabled={busy !== null || !(Number(goal) > 0)}
              busy={busy === "goal"}
              onClick={() => post({ action: "setGoal", target: Number(goal), deadlineHours: hrs }, "goal")}
            >
              Apply Goal Only
            </GlassButton>

            <GlassButton
              size="sm"
              variant={survivalOn ? "subtle" : "success"}
              disabled={busy !== null || survivalOn}
              onClick={() => post({ action: "setSurvival", enabled: true }, "surv")}
            >
              Enable Survival
            </GlassButton>

            <GlassButton
              size="sm"
              variant="danger"
              disabled={busy !== null || !survivalOn}
              onClick={() => post({ action: "setSurvival", enabled: false }, "surv")}
            >
              Disable Survival
            </GlassButton>
          </div>

          {msg && (
            <p className={`text-xs ${msg.ok ? "text-emerald-700 font-semibold" : "text-rose-700"}`}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface OverviewTabProps {
  v2: any;
  s: any;
  onNavigateToTab?: (tab: string) => void;
  onSelectCandidate?: (candidate: any) => void;
}

export function OverviewTab({
  v2,
  s,
  onNavigateToTab,
  onSelectCandidate,
}: OverviewTabProps) {
  if (!s) {
    return (
      <div className="card-fintech p-10 text-center flex flex-col items-center gap-3">
        <Mascot size={64} mood="sleepy" />
        <p className="font-display font-semibold text-lg text-ink">Engine warming up...</p>
        <p className="text-xs text-inksoft max-w-sm">
          No live signals detected yet. Make sure the background engine is running:{" "}
          <code className="bg-black/5 px-2 py-0.5 rounded font-mono">node scripts/v2/engine.mjs</code>
        </p>
      </div>
    );
  }

  const lastEp = (v2.episodes ?? [])[(v2.episodes ?? []).length - 1];
  const ag = s.aggression ?? {};
  const g = s.goal ?? {};
  const up = (s.totalPnl ?? 0) >= 0;
  const positions: any[] = s.positions ?? [];
  const trades: any[] = (v2.trades ?? []).slice(0, 6);
  const aiDecisions: any[] = (v2.ai?.decisions ?? []).slice(0, 6);

  const hoursLeft =
    g.deadlineHours != null && g.startedAt
      ? Math.max(0, g.deadlineHours - (Date.now() - g.startedAt) / 3600000)
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Episode Banner */}
      {lastEp && (
        <div className="card-fintech p-4 bg-gradient-to-r from-cream via-cream2 to-cream flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{lastEp.blownUp ? "💀" : lastEp.endReason === "goal" ? "🎯" : "✨"}</span>
            <div>
              <div className="font-display font-semibold text-sm sm:text-base text-ink">
                Run #{lastEp.episodeNum} {lastEp.blownUp ? "settled at liquidation" : lastEp.endReason === "goal" ? "hit target goal" : "completed"}
              </div>
              <div className={`text-xs tnum font-semibold ${tone(lastEp.returnPct)}`}>
                {pct(lastEp.returnPct)} return · {timeAgo(lastEp.endedAt)} · Generation {s.generation}, {ag.leverageCap}x Cap
              </div>
            </div>
          </div>

          <span className="text-xs text-inksoft font-medium">
            Active Run #{s.episodeNum} in progress
          </span>
        </div>
      )}

      {/* 2. Primary KPI Metrics Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Equity Card */}
        <MetricCard
          label={`Equity (Run #${s.episodeNum})`}
          value={usd(s.equity)}
          subValue={`From ${usd(s.startingCapital, 0)} starting`}
          tone={up ? "up" : "down"}
          sparkline={<Spark points={v2.equity} up={up} />}
        />

        {/* Session P&L Card */}
        <MetricCard
          label="Total P&L"
          value={signed(s.totalPnl)}
          subValue={`${pct(s.totalPnlPct)} return on equity`}
          tone={up ? "up" : "down"}
          badge={
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              up ? "bg-emerald-500/15 text-emerald-800" : "bg-rose-500/15 text-rose-800"
            }`}>
              {up ? "Profitable" : "Drawdown"}
            </span>
          }
          footer={
            <div className="flex items-center justify-between text-inksoft tnum">
              <span>Gross Lev: {s.grossLeverage != null ? `${s.grossLeverage.toFixed(1)}x` : "—"}</span>
              <span>Max DD: {(s.maxDrawdownPct ?? 0).toFixed(1)}%</span>
            </div>
          }
        />

        {/* Goal Progress Card */}
        <MetricCard
          label="Target Goal"
          value={usd(g.target, 0)}
          subValue={hoursLeft != null ? `${hoursLeft.toFixed(1)}h remaining` : "No time limit"}
          footer={
            <div className="w-full">
              <div className="flex justify-between text-[11px] text-inksoft mb-1 tnum">
                <span>Progress</span>
                <span className="font-bold text-ink">{s.progressPct != null ? s.progressPct.toFixed(1) : 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-black/5 overflow-hidden p-0.5 border border-white/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sakura via-gold to-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, s.progressPct ?? 0))}%` }}
                />
              </div>
            </div>
          }
        />

        {/* Bot Aggression & Evolution Level */}
        <MetricCard
          label="Earned Aggression"
          value={`${ag.leverageCap ?? 1}x Cap`}
          subValue={`Ceiling: ${ag.leverageCeiling ?? 20}x · Kelly ${((ag.kellyFraction ?? 0) * 100).toFixed(0)}%`}
          footer={
            <div className="flex items-center justify-between text-inksoft">
              <span>Gen {s.generation} · Regime</span>
              <span className="font-semibold text-ink uppercase text-[10px]">{s.regime ?? "—"}</span>
            </div>
          }
        />
      </div>

      {/* 3. High-Priority Section: Active Positions */}
      <div className="card-fintech p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-base text-ink">Active Positions</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-black/5 text-ink tnum">
              {positions.length}
            </span>
          </div>

          {onNavigateToTab && (
            <button
              onClick={() => onNavigateToTab("positions")}
              className="text-xs font-semibold text-inksoft hover:text-ink cursor-pointer"
            >
              View all positions ➔
            </button>
          )}
        </div>

        {positions.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-black/2 border border-black/5 text-xs text-inksoft">
            No active positions open. The bot is observing the market and filtering trade candidates.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {positions.map((p: any) => {
              const hasAi = !!p.openMeta?.ai;
              const aiApproved = p.openMeta?.ai?.approved;

              return (
                <div key={p.symbol} className="p-4 rounded-xl bg-white/70 border border-white/80 shadow-2xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-base text-ink">
                        {String(p.symbol).replace("-USD", "")}
                      </span>
                      <StatusBadge status={p.side || "long"} size="sm" />
                      <span className="text-xs text-inksoft tnum font-medium">
                        {p.leverage}x
                      </span>
                    </div>
                    <div className={`text-sm tnum font-bold ${tone(p.uPnl)}`}>
                      {signed(p.uPnl)} <span className="text-xs">({pct(p.roiPct)})</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs text-inksoft tnum py-1.5 border-t border-black/5">
                    <div>Entry: <b className="text-ink font-semibold">{price(p.entry)}</b></div>
                    <div>Mark: <b className="text-ink font-semibold">{price(p.mark)}</b></div>
                    <div>Notional: <b className="text-ink font-semibold">{usd(p.notional, 0)}</b></div>
                  </div>

                  {/* Liquidation runway */}
                  <LiquidRunwayMeter
                    mark={p.mark}
                    liqPrice={p.liqPrice}
                    side={p.side}
                  />

                  {/* AI attribution badge */}
                  {hasAi && (
                    <div className="mt-2.5 pt-2 border-t border-black/5 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          status={aiApproved ? "approved" : "rejected"}
                          label={aiApproved ? "AI Approved" : "AI Rejected"}
                          size="sm"
                        />
                        <span className="text-inksoft truncate max-w-[160px]">
                          {p.openMeta?.ai?.thesis || p.openMeta?.ai?.rating}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-inksoft">
                        {p.openMeta?.ai?.provider || "Tauric"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Split Activity Section: Recent Fills & Recent AI Decisions */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Left: Recent Fills */}
        <div className="card-fintech p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm text-ink">Recent Fills</h3>
            {onNavigateToTab && (
              <button
                onClick={() => onNavigateToTab("trades")}
                className="text-xs text-inksoft hover:text-ink cursor-pointer"
              >
                All fills ➔
              </button>
            )}
          </div>

          {trades.length === 0 ? (
            <p className="text-xs text-inksoft py-4">No fills recorded yet this session.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {trades.map((f: any, i: number) => (
                <div
                  key={f.eventId || i}
                  className="p-2.5 rounded-lg bg-white/60 border border-white/70 text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-ink">
                      {String(f.symbol).replace("-USD", "")}
                    </span>
                    <StatusBadge status={f.side || "long"} size="sm" />
                    <span className="text-[10px] text-inksoft font-medium uppercase">
                      {f.op}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`tnum font-bold ${f.op === "close" ? tone(f.net_pnl) : "text-ink"}`}>
                      {f.op === "close" ? signed(f.net_pnl) : usd(f.margin)}
                    </span>
                    <span className="text-[10px] text-inksoft tnum">
                      {timeAgo(f.ts)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Recent AI Decisions */}
        <div className="card-fintech p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm text-ink">Recent AI Decisions</h3>
            {onNavigateToTab && (
              <button
                onClick={() => onNavigateToTab("ai")}
                className="text-xs text-inksoft hover:text-ink cursor-pointer"
              >
                AI Desk ➔
              </button>
            )}
          </div>

          {aiDecisions.length === 0 ? (
            <p className="text-xs text-inksoft py-4">No recent AI decisions logged yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {aiDecisions.map((d: any, i: number) => {
                const decStr = String(d.decision || "").toUpperCase();
                const isApp = decStr.includes("APPROVE");

                return (
                  <div
                    key={d.request_id || i}
                    onClick={() => {
                      if (onSelectCandidate) onSelectCandidate(d);
                      if (onNavigateToTab) onNavigateToTab("ai");
                    }}
                    className="p-2.5 rounded-lg bg-white/60 border border-white/70 text-xs flex items-center justify-between gap-2 hover:bg-white cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-ink">
                        {String(d.symbol).replace("-USD", "")}
                      </span>
                      <StatusBadge
                        status={isApp ? "approved" : "rejected"}
                        label={d.decision}
                        size="sm"
                      />
                      <span className="text-inksoft truncate max-w-[120px]">
                        {d.strategy_id}
                      </span>
                    </div>

                    <div className="text-[10px] text-inksoft tnum shrink-0">
                      {timeAgo(d.generated_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. Deterministic Decision Council */}
      <AgentCouncilCard s={s} />

      {/* 6. Administrative Control Panel (Below Operational Trading Data) */}
      <ControlPanel s={s} />
    </div>
  );
}

export default OverviewTab;
