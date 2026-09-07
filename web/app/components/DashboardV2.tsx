"use client";

import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { usd, pct, signed, tone, price, timeAgo } from "../lib/format";
import { Mascot, Sakura } from "./visuals";

const NAV = [
  { id: "overview", label: "Overview", icon: "❀" },
  { id: "positions", label: "Positions", icon: "◈" },
  { id: "episodes", label: "Episodes", icon: "↻" },
  { id: "evolution", label: "Evolution", icon: "⬆" },
  { id: "strategies", label: "Strategies", icon: "✦" },
  { id: "world", label: "World", icon: "☁" },
  { id: "lessons", label: "Lessons", icon: "✎" },
  { id: "trades", label: "Trades", icon: "≡" },
] as const;

export default function DashboardV2({ data }: { data: any }) {
  const [tab, setTab] = useState<string>("overview");
  const v2 = data?.v2 ?? {};
  const s = v2.signals ?? null;

  return (
    <div className="min-h-screen">
      <Sakura />
      <div className="mx-auto max-w-6xl flex gap-6 px-4 py-6">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 card p-5 self-start sticky top-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-sakura to-gold flex items-center justify-center text-white font-display font-bold text-lg">F</div>
            <div>
              <div className="font-display font-semibold">@FabRichhhhhh</div>
              <div className="text-xs text-inksoft">Apex Trading Bot . v2</div>
            </div>
          </div>
          <nav className="mt-6 flex flex-col gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`pill text-left px-4 py-2 text-sm transition ${tab === n.id ? "bg-white shadow text-ink font-bold" : "text-inksoft hover:bg-white/60"}`}
              >
                <span className="mr-2">{n.icon}</span>{n.label}
              </button>
            ))}
          </nav>
          <p className="mt-6 text-[11px] leading-relaxed text-inksoft">
            Simulation on real live prices. Fake money, real lessons. Honest by design, it can lose everything, it never lies.
          </p>
        </aside>

        <main className="flex-1 min-w-0">
          {/* Mobile pill nav */}
          <div className="md:hidden flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`pill whitespace-nowrap px-4 py-2 text-sm ${tab === n.id ? "bg-white shadow font-bold" : "text-inksoft"}`}
              >
                {n.icon} {n.label}
              </button>
            ))}
          </div>

          {tab === "overview" && <Overview v2={v2} s={s} />}
          {tab === "positions" && <Positions s={s} />}
          {tab === "episodes" && <Episodes v2={v2} s={s} />}
          {tab === "evolution" && <Evolution v2={v2} />}
          {tab === "strategies" && <Strategies v2={v2} />}
          {tab === "world" && <World s={s} />}
          {tab === "lessons" && <Lessons v2={v2} />}
          {tab === "trades" && <Trades v2={v2} />}
        </main>
      </div>
    </div>
  );
}

function Spark({ points, up }: { points: any[]; up: boolean }) {
  if (!points?.length) return <div className="h-16 flex items-center justify-center text-inksoft text-sm">—</div>;
  const d = points.map((p) => ({ v: p.equity }));
  return (
    <div className="h-16" aria-label="equity sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Area type="monotone" dataKey="v" stroke={up ? "#1f9d62" : "#e5566f"} fill={up ? "#1f9d6230" : "#e5566f30"} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Overview({ v2, s }: { v2: any; s: any }) {
  if (!s) return <p className="card p-6 text-inksoft">No signals yet — is the engine running? (node scripts/v2/engine.mjs)</p>;
  const lastEp = (v2.episodes ?? [])[(v2.episodes ?? []).length - 1];
  const ag = s.aggression ?? {};
  const life = s.lifetime ?? {};
  const g = s.goal ?? {};
  const hoursLeft = g.deadlineHours != null && g.startedAt
    ? Math.max(0, g.deadlineHours - (Date.now() - g.startedAt) / 3600000) : null;
  const up = (s.totalPnl ?? 0) >= 0;
  const capPct = ag.leverageCeiling ? (100 * (ag.leverageCap ?? 0)) / ag.leverageCeiling : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        {lastEp ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl">{lastEp.blownUp ? "💀" : lastEp.endReason === "goal" ? "🎯" : "✨"}</span>
            <div>
              <div className="font-display font-semibold">
                While you were away: run {lastEp.episodeNum} {lastEp.blownUp ? "blew up" : lastEp.endReason === "goal" ? "hit the goal" : "finished"}
              </div>
              <div className={`text-sm tnum ${tone(lastEp.returnPct)}`}>
                {pct(lastEp.returnPct)} · {timeAgo(lastEp.endedAt)} · now generation {s.generation}, {ag.leverageCap}x, Kelly {(ag.kellyFraction ?? 0).toFixed(2)}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌱</span>
            <div className="font-display font-semibold">Run {s.episodeNum} in progress</div>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-6">
          <div className="text-sm text-inksoft">Account Equity . Episode {s.episodeNum}</div>
          <div className={`font-display text-4xl font-bold tnum mt-1 ${tone(s.totalPnl)}`}>{usd(s.equity)}</div>
          <div className={`text-sm tnum ${tone(s.totalPnl)}`}>
            {signed(s.totalPnl)} ({pct(s.totalPnlPct)}) this run . from {usd(s.startingCapital, 0)}
          </div>
          <div className="mt-1 text-xs text-inksoft tnum text-right">
            gross lev {s.grossLeverage != null ? s.grossLeverage.toFixed(1) + "x" : "—"} · DD {(s.maxDrawdownPct ?? 0).toFixed(1)}%
          </div>
          <Spark points={v2.equity} up={up} />
          <div className="mt-4">
            <div className="flex justify-between text-xs text-inksoft">
              <span>Goal . {usd(g.target, 0)}</span>
              <span>{g.deadlineHours >= 1000 ? "no deadline, fast as it can" : hoursLeft != null ? `${hoursLeft.toFixed(1)}h left` : "—"}</span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-white/70 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sakura via-gold to-up"
                style={{ width: `${Math.max(0, Math.min(100, s.progressPct ?? 0))}%` }}
              />
            </div>
            <div className="mt-1 text-xs tnum text-inksoft">{s.progressPct != null ? s.progressPct.toFixed(1) + "%" : "—"}</div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="card p-5 flex items-center gap-4">
            <div className="relative">
              <Mascot size={52} mood="happy" />
              <span className="live-dot absolute -top-1 -right-1 w-3 h-3 rounded-full bg-up" />
            </div>
            <div className="text-sm">
              <div className="font-display font-semibold">The Bot</div>
              <div className="text-inksoft tnum">
                gen {s.generation} · run {s.episodeNum} · blowups {life.totalBlowups ?? 0} · best {pct(life.bestEpisodeReturnPct)}
              </div>
              <div className="text-inksoft text-xs">last tick {timeAgo(s.ts)} · regime {s.regime}</div>
            </div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-inksoft">Aggression . earned leverage</div>
            <div className="mt-2 h-3 rounded-full bg-gradient-to-r from-up via-gold to-down relative">
              <div className="absolute -top-1 w-5 h-5 rounded-full bg-white border-2 border-ink" style={{ left: `calc(${Math.min(100, capPct)}% - 10px)` }} />
            </div>
            <div className="mt-2 flex justify-between text-sm tnum">
              <span>{ag.leverageCap}x cap / {ag.leverageCeiling}x ceiling</span>
              <span>Kelly {((ag.kellyFraction ?? 0) * 100).toFixed(0)}% · level {ag.unlockedLevel ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      <PositionGrid positions={s.positions ?? []} />

      <div className="card-quiet p-4 text-sm text-inksoft flex flex-wrap gap-x-6 gap-y-1">
        <span>World regime: <b className="text-ink">{s.world?.regime ?? "—"}</b></span>
        <span>Funding 8h: <b className="text-ink tnum">{s.fundingRate != null ? (s.fundingRate * 100).toFixed(4) + "%" : "—"}</b></span>
        <span>Crypto F&amp;G: <b className="text-ink">{s.world?.fearGreedCrypto?.value ?? "—"}</b></span>
      </div>
    </div>
  );
}
function Runway({ p }: { p: any }) {
  // runway = 100*s*(mark-liq)/mark (docs/08 recommendation)
  if (!Number.isFinite(p.mark) || !Number.isFinite(p.liqPrice) || p.mark <= 0) return <span className="text-inksoft text-xs">—</span>;
  const d = (100 * (p.side === "short" ? -1 : 1) * (p.mark - p.liqPrice)) / p.mark;
  const cls = d < 4 ? "text-downink" : d < 12 ? "text-gold" : "text-upink";
  const bar = d < 4 ? "bg-down" : d < 12 ? "bg-gold" : "bg-up";
  const label = d < 4 ? "danger" : d < 12 ? "watch" : "safe";
  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-white/70 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, d))}%` }} />
      </div>
      <div className={`text-[11px] mt-1 ${cls}`}>{d.toFixed(1)}% from liquidation · {label}</div>
    </div>
  );
}

function PositionGrid({ positions }: { positions: any[] }) {
  if (!positions.length) return <div className="card-quiet p-4 text-sm text-inksoft">No open positions</div>;
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {positions.map((p: any) => (
        <div key={p.symbol} className="card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`pill px-2 py-0.5 text-xs font-bold ${p.side === "long" ? "text-upink" : "text-downink"}`}>
                {p.side === "long" ? "LONG" : "SHORT"}
              </span>
              <span className="font-display font-semibold">{String(p.symbol).replace("-USD", "")}</span>
              <span className="text-xs text-inksoft tnum">{p.leverage}x · {p.strategy_id ?? "manual"}</span>
            </div>
            <div className={`text-sm tnum ${tone(p.uPnl)}`}>{signed(p.uPnl)} ({pct(p.roiPct)})</div>
          </div>
          <div className="mt-2 grid grid-cols-3 text-xs text-inksoft tnum">
            <span>Entry {price(p.entry)}</span>
            <span>Mark {price(p.mark)}</span>
            <span>Notional {usd(p.notional, 0)}</span>
          </div>
          <Runway p={p} />
        </div>
      ))}
    </div>
  );
}

function Positions({ s }: { s: any }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="card-quiet p-4 text-sm text-inksoft">
        Liquidation is computed on a smoothed mark price, with real fees + funding + slippage. The bar shows how close each position is to being wiped out.
      </p>
      <PositionGrid positions={s?.positions ?? []} />
    </div>
  );
}
function Episodes({ v2, s }: { v2: any; s: any }) {
  const eps: any[] = v2.episodes ?? [];
  const maxAbs = Math.max(1, ...eps.map((e) => Math.abs(e.returnPct ?? 0)));
  return (
    <div className="flex flex-col gap-4">
      <p className="card-quiet p-4 text-sm text-inksoft">
        Each run goes until it hits the goal, runs out of time, or blows up, then resets and tries again, sharper.
      </p>
      {eps.length >= 3 && (
        <div className="card p-5 flex items-end gap-1 h-32" aria-label="run return timeline">
          {eps.map((e, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`Run ${e.episodeNum}: ${pct(e.returnPct)}`}>
              {e.blownUp && <span className="text-xs">💀</span>}
              <div
                className={`w-full rounded-t ${e.blownUp ? "bg-down" : (e.returnPct ?? 0) >= 0 ? "bg-up" : "bg-gold"}`}
                style={{ height: `${Math.max(4, (Math.abs(e.returnPct ?? 0) / maxAbs) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      )}
      {eps.length < 3 && s && (
        <div className="card p-4 text-sm text-inksoft">Run {s.episodeNum} in progress — timeline appears after 3 finished runs.</div>
      )}
      <div className="card p-5">
        <h2 className="font-display font-semibold mb-3">Finished Runs</h2>
        {eps.length === 0 && <p className="text-sm text-inksoft">No finished runs yet.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm tnum">
            <tbody>
              {[...eps].reverse().map((e, i) => (
                <tr key={i} className="border-t border-white/60">
                  <td className="py-2">Run {e.episodeNum}</td>
                  <td className="text-inksoft">{e.endReason}{e.blownUp ? " 💀" : ""}</td>
                  <td className="text-inksoft">peak {usd(e.peakEquity, 0)}</td>
                  <td className="text-inksoft">DD {(e.maxDrawdownPct ?? 0).toFixed(0)}%</td>
                  <td className={`text-right font-bold ${tone(e.returnPct)}`}>{pct(e.returnPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Evolution({ v2 }: { v2: any }) {
  const gens: any[] = v2.generations ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Evolution, Level-Ups</h1>
      <p className="card-quiet p-4 text-sm text-inksoft">
        Every finished run banks a lesson and may promote or retire a strategy, retune Kelly, and unlock (or claw back) leverage.
      </p>
      {gens.length === 0 ? (
        <div className="card p-8 flex flex-col items-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="text-inksoft">No level-ups yet</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {gens.map((g, i) => (
            <div key={i} className="card p-5">
              <div className="font-display font-semibold">Gen {g.generation} after run #{g.episodeNum}</div>
              <div className="text-sm text-inksoft tnum mt-1">
                leverage {g.aggression?.leverageCap}x · Kelly {((g.aggression?.kellyFraction ?? 0) * 100).toFixed(0)}%
              </div>
              <p className="text-sm mt-2">{g.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Strategies({ v2 }: { v2: any }) {
  const list: any[] = v2.strategies ?? [];
  const statusCls: Record<string, string> = {
    active: "text-upink", candidate: "text-lav", probation: "text-gold", retired: "text-downink",
  };
  const allCandidates = list.length > 0 && list.every((s) => s.status === "candidate");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Strategy Book</h1>
      <p className="card-quiet p-4 text-sm text-inksoft">
        A strategy only earns active after it proves a real edge (statistical gates + Deflated Sharpe). Losers get retired.
      </p>
      {allCandidates && (
        <p className="card-quiet p-3 text-xs text-inksoft">All strategies are early candidates — still being evaluated on real closed trades.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {list.map((s) => (
          <div key={s.id} className="card p-5">
            <div className="flex justify-between items-center">
              <span className="font-display font-semibold">{s.name ?? s.id}</span>
              <span className={`pill px-2 py-0.5 text-xs font-bold ${statusCls[s.status] ?? "text-inksoft"}`}>{s.status}</span>
            </div>
            <div className="text-xs text-inksoft tnum mt-1">n {s.n ?? 0} · Kelly {((s.kelly ?? 0) * 100).toFixed(0)}%</div>
            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
              <div className="card-quiet p-2"><div className={`tnum font-bold ${tone(s.expectancy_R)}`}>{s.expectancy_R != null ? s.expectancy_R.toFixed(2) : "—"}</div><div className="text-[10px] text-inksoft">Exp R</div></div>
              <div className="card-quiet p-2"><div className="tnum font-bold">{s.profit_factor != null ? s.profit_factor.toFixed(2) : "—"}</div><div className="text-[10px] text-inksoft">PF</div></div>
              <div className="card-quiet p-2"><div className="tnum font-bold">{s.dsr != null ? s.dsr.toFixed(2) : "—"}</div><div className="text-[10px] text-inksoft">DSR</div></div>
              <div className="card-quiet p-2"><div className="tnum font-bold">{((s.confidence ?? 0) * 100).toFixed(0)}%</div><div className="text-[10px] text-inksoft">Conf</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
const BAND_WORDS: Record<string, string> = {
  extreme_fear: "Extreme Fear", fear: "Fear", neutral: "Neutral", greed: "Greed", extreme_greed: "Extreme Greed", unknown: "—",
};

function Gauge({ label, g }: { label: string; g: any }) {
  const v = g?.value;
  const band = BAND_WORDS[g?.band] ?? "—";
  return (
    <div className="card p-5">
      <div className="text-sm text-inksoft">{label}</div>
      <div className="font-display text-3xl font-bold tnum mt-1">{v ?? "—"}</div>
      <div className="text-xs text-inksoft">{band}{g?._stale ? " · stale" : ""}</div>
      <div className="mt-2 h-3 rounded-full bg-gradient-to-r from-down via-gold to-up relative">
        {v != null && (
          <div className="absolute -top-1 w-4 h-4 rounded-full bg-white border-2 border-ink" style={{ left: `calc(${Math.max(0, Math.min(100, v))}% - 8px)` }} />
        )}
      </div>
    </div>
  );
}

function World({ s }: { s: any }) {
  const w = s?.world ?? null;
  const row = (k: string, val: any) => (
    <div className="flex justify-between text-sm py-1 border-t border-white/50">
      <span className="text-inksoft">{k}</span><span className="tnum">{val ?? "—"}</span>
    </div>
  );
  const headlines = [...(w?.fed?.titles ?? []), ...(w?.headlines ?? [])];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Gauge label="Crypto Fear & Greed" g={w?.fearGreedCrypto} />
        <Gauge label="Stock Fear & Greed" g={w?.fearGreedStocks} />
      </div>
      <div className="card p-5">
        <h2 className="font-display font-semibold mb-2">Macro &amp; Flow</h2>
        {row("Regime", w?.regime)}
        {row("Funding 8h", w?.fundingRate != null ? (w.fundingRate * 100).toFixed(4) + "%" : "—")}
        {row("Crypto OI", w?.oiUsd != null ? usd(w.oiUsd, 0) : "—")}
        {row("Whales", w?.whaleCrowd)}
        {row("News mood", w?.newsMood ? `${w.newsMood.mean.toFixed(2)}${w.newsMood.mixed ? " (mixed)" : ""}` : "—")}
        {row("Put/Call", w?.putCall?.ratio != null ? w.putCall.ratio.toFixed(2) : "—")}
        {w?.macro && (
          <p className="text-xs text-inksoft mt-2">
            {(w.macro.drivers ?? []).join(" · ") || "no strong macro drivers"}
            {w.macro._stale ? " · stale" : ""}
          </p>
        )}
      </div>
      <div className="card-quiet p-4">
        <h2 className="font-display font-semibold text-sm mb-1">Thesis</h2>
        <p className="text-sm text-inksoft">{w?.thesis ?? "No thesis yet — the source specifies no thesis generator."}</p>
      </div>
      <div className="card p-5">
        <h2 className="font-display font-semibold mb-2">Headlines</h2>
        {headlines.length === 0 && <p className="text-sm text-inksoft">—</p>}
        <ul className="text-sm flex flex-col gap-1">
          {headlines.slice(0, 12).map((h, i) => <li key={i} className="border-t border-white/50 pt-1">{h}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Lessons({ v2 }: { v2: any }) {
  const mem: any[] = v2.memory ?? [];
  const kindCls = (k: string) => (k === "blowup" ? "text-downink" : k === "win" ? "text-upink" : "text-gold");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Lessons Banked</h1>
      <p className="card-quiet p-4 text-sm text-inksoft">
        The bot learns harder from blow-ups than wins. Each is tagged to a market regime.
      </p>
      {mem.length === 0 ? (
        <div className="card p-8 flex flex-col items-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="text-inksoft">No lessons yet — they arrive when runs finish.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {mem.map((m, i) => (
            <div key={m.id ?? i} className="card p-4">
              <div className="flex justify-between items-center">
                <span className={`font-display font-semibold ${kindCls(m.kind)}`}>{m.title}</span>
                <span className="text-xs text-inksoft">{m.kind} · imp {m.importance}</span>
              </div>
              <p className="text-sm mt-1">{m.text}</p>
              <div className="text-xs text-inksoft mt-1">regime {m.regime ?? "—"} · {timeAgo(m.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Trades({ v2 }: { v2: any }) {
  const trades: any[] = v2.trades ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Recent Fills</h1>
      {trades.length === 0 && <div className="card-quiet p-4 text-sm text-inksoft">No fills yet</div>}
      <div className="flex flex-col gap-2">
        {trades.map((f, i) => (
          <div key={f.eventId ?? i} className="card-quiet p-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`pill px-2 py-0.5 text-xs font-bold ${f.op === "open" ? "text-lav" : "text-inksoft"}`}>{f.op}</span>
              <span className={`font-bold ${f.side === "long" ? "text-upink" : "text-downink"}`}>{f.side === "long" ? "LONG" : "SHORT"}</span>
              <span className="font-display">{String(f.symbol).replace("-USD", "")}</span>
              <span className="text-xs text-inksoft tnum">{f.leverage}x · {f.reason ?? "—"}</span>
            </div>
            <div className={`tnum ${f.op === "close" ? tone(f.net_pnl) : "text-inksoft"}`}>
              {f.op === "close" ? signed(f.net_pnl) : usd(f.margin)}
              <span className="text-xs text-inksoft ml-2">{timeAgo(f.ts)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
