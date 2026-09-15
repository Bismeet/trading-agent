"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import {
  usd,
  pct,
  signed,
  tone,
  price,
  timeAgo,
  ageSeconds,
  pad,
  moodWord,
  NO_DATA,
  NOT_VERIFIED,
} from "../lib/format";
import { DataStream, Lamp, SegBar, AsciiRule, TitleBar, TerminalLogo } from "./visuals";

/* ==========================================================================
   RESEARCH STATUS — hard-coded, sourced from the repository's own reports.
   This is NOT live data and is NOT a signal. It is a truthful label plate.
   Sourced from RESEARCH_RESET_DIAGNOSIS.md and the Phase 5-11 reports.
   ========================================================================== */
const RESEARCH = {
  alpha: NOT_VERIFIED,
  current: "DATA / INFORMATION RESET",
  phasesRun: "9 experiments (Alpha + Phases 5-11)",
  bestVerdict: "C — no robust out-of-sample edge",
  grossEdge: "NEGATIVE BEFORE COSTS",
  infoSet: "OHLC-ONLY (5 fields, no volume)",
  nextDirection: "DIFFERENT INFORMATION, NOT ANOTHER INDICATOR",
  note:
    "Nine consecutive experiments found no positive gross directional alpha from this OHLC-only information set. Costs are not the binding constraint; information is.",
};

/* A comically-labelled but strictly honest status plate. */
function ResearchPanel() {
  const rows: [string, string, string][] = [
    ["ALPHA STATUS", RESEARCH.alpha, "text-amber"],
    ["CURRENT RESEARCH", RESEARCH.current, "text-cyan"],
    ["PHASES RUN", RESEARCH.phasesRun, "text-ink"],
    ["BEST OUTCOME", RESEARCH.bestVerdict, "text-amber"],
    ["GROSS DIRECTIONAL EDGE", RESEARCH.grossEdge, "text-alert"],
    ["INFORMATION SET", RESEARCH.infoSet, "text-alert"],
    ["NEXT DIRECTION", RESEARCH.nextDirection, "text-inksoft"],
  ];
  return (
    <div className="card">
      <TitleBar title="■ RESEARCH STATUS" right={<span className="blink">◆</span>} />
      <div className="p-4">
        <div className="well p-3 mb-3">
          <div className="label">QUANT COMPUTER</div>
          <div className="font-display text-2xl text-amber glow-amber leading-none mt-1">
            CONCERNED
          </div>
          <div className="text-[11px] text-inksoft mt-1">
            The market has declined to cooperate. We are still looking.
          </div>
        </div>
        <table className="term-table">
          <tbody>
            {rows.map(([k, v, cls]) => (
              <tr key={k}>
                <td className="text-inksoft whitespace-nowrap align-top">{k}</td>
                <td className={`text-right font-bold ${cls}`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-inksoft mt-3 leading-relaxed">{RESEARCH.note}</p>
        <p className="text-[10px] text-inksofter mt-2">
          Static plaque sourced from RESEARCH_RESET_DIAGNOSIS.md · not a live signal.
        </p>
      </div>
    </div>
  );
}

/* ==========================================================================
   HEALTH — derives ONLY from values the backend actually provides.
   Missing inputs render as NO DATA rather than an invented number.
   ========================================================================== */
function HealthPanel({ s, serverTs }: { s: any; serverTs?: number }) {
  const quoteAge = ageSeconds(s?.ts);
  const serverAge = ageSeconds(serverTs);
  const equity = s?.equity;
  const hardFloor = s?.hardFloor ?? null;

  // quote freshness: engine loop is 30s (config.v2.strategies.loopSeconds).
  const quoteState =
    quoteAge == null
      ? { word: NO_DATA, tone: "text-inksoft", ok: false }
      : quoteAge <= 90
        ? { word: "FRESH", tone: "text-phos", ok: true }
        : quoteAge <= 300
          ? { word: "AGING", tone: "text-amber", ok: true }
          : { word: "STALE !!", tone: "text-alert", ok: false };

  const uplinkState =
    serverAge == null
      ? { word: NO_DATA, tone: "text-inksoft", ok: false }
      : serverAge <= 15
        ? { word: "ONLINE", tone: "text-phos", ok: true }
        : { word: "LAGGING", tone: "text-amber", ok: false };

  const riskGates = s?.survival
    ? s.survival.enabled
      ? s.survivalBlocked
        ? { word: "BLOCKING NEW ENTRIES", tone: "text-amber" }
        : { word: "ARMED · ABOVE WATER", tone: "text-phos" }
      : { word: "DISABLED", tone: "text-inksoft" }
    : { word: NO_DATA, tone: "text-inksoft" };

  const floor = hardFloor && equity != null ? ((equity - hardFloor) / hardFloor) * 100 : null;

  const row = (label: string, word: string, cls: string, ok: boolean) => (
    <div className="flex items-center justify-between py-1 border-b border-grid last:border-0">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <Lamp on={ok} blink={!ok} tone={cls} label={`${label}: ${word}`} />
        <span className={`font-term text-xs font-bold ${cls}`}>{word}</span>
      </span>
    </div>
  );

  return (
    <div className="card">
      <TitleBar
        title="■ SYSTEM HEALTH"
        right={
          <span className={quoteState.ok ? "text-phos" : "text-alert"}>
            {quoteState.ok ? "NOMINAL" : "ATTENTION"}
          </span>
        }
      />
      <div className="p-4">
        {row("ENGINE UPLINK", uplinkState.word, uplinkState.tone, uplinkState.ok)}
        {row("QUOTE FRESHNESS", quoteState.word, quoteState.tone, quoteState.ok)}
        {row("RISK GATE", riskGates.word, riskGates.tone, !riskGates.word.startsWith("BLOCK"))}
        {row(
          "CALIBRATION",
          s?.learning?.confidence ?? "INSUFFICIENT DATA",
          s?.learning?.confidence === "INSUFFICIENT DATA" ? "text-amber" : "text-phos",
          s?.learning?.confidence !== "INSUFFICIENT DATA",
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-[11px] tnum">
          <span className="label">LAST TICK</span>
          <span className="text-right text-inksoft">{timeAgo(s?.ts)}</span>
          <span className="label">SERVER TS</span>
          <span className="text-right text-inksoft">{timeAgo(serverTs)}</span>
          <span className="label">SURVIVAL FLOOR</span>
          <span className="text-right text-inksoft">{hardFloor != null ? usd(hardFloor) : NO_DATA}</span>
          <span className="label">DIST. TO FLOOR</span>
          <span className={`text-right ${floor == null ? "text-inksoft" : floor < 5 ? "text-alert" : "text-inksoft"}`}>
            {floor == null ? NO_DATA : floor.toFixed(2) + "%"}
          </span>
        </div>
        {quoteAge != null && quoteAge > 300 && (
          <p className="text-[11px] text-alert mt-3">
            ! STALE DATA — quotes older than 5 minutes. The engine may be stopped or the
            survival gate may be suspended. Numbers below are the LAST KNOWN values.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---- Decision Council: last deliberation from the analyst/risk/investor set ---- */
function AgentLog({ s }: { s: any }) {
  const d = s?.agents?.decisions;
  const last = Array.isArray(d) ? d[d.length - 1] : null;
  return (
    <div className="card">
      <TitleBar
        title="■ DECISION COUNCIL"
        right={<span className="font-normal normal-case">analyst → risk → investor · rules only, no AI</span>}
      />
      <div className="p-4">
        {!last ? (
          <p className="text-xs text-inksoft">
            NO DATA — no trade intents deliberated yet this cycle.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="tnum font-bold">
                {last.symbol} {String(last.side).toUpperCase()}
              </span>
              <span className={last.approved ? "text-upink font-bold" : "text-downink font-bold"}>
                {last.approved ? "[ APPROVED ]" : "[ REJECTED ]"}
              </span>
              <span className="text-inksoft text-xs">by {last.strategy_id ?? "manual"}</span>
            </div>
            <ul className="mt-3 grid md:grid-cols-3 gap-2 text-xs">
              {(last.verdicts ?? []).map((v: any, i: number) => (
                <li key={i} className={`card-quiet p-2 ${v.vote === "veto" ? "text-downink" : "text-upink"}`}>
                  <b className="uppercase">{v.agent}</b>: {v.vote}
                  {v.reasons?.[0] && (
                    <div className="text-inksoft mt-0.5">
                      {v.reasons[0]}
                      {v.reasons.length > 1 ? ` +${v.reasons.length - 1} more` : ""}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Contextual learner diagnostics (Phase 2 §16) ---- */
function LearningCard({ s }: { s: any }) {
  const d = s?.learning ?? {};
  const cells = Array.isArray(d.top) ? d.top : [];
  const last = Array.isArray(d.lastDecisions) ? d.lastDecisions[d.lastDecisions.length - 1] : null;
  return (
    <div className="card">
      <TitleBar
        title="■ CONTEXTUAL LEARNER"
        right={<span className="font-normal normal-case">local bandit · no LLM · {d.cells ?? 0} cells</span>}
      />
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            ["EXPERIENCES", d.experiences ?? 0, "text-ink"],
            ["EVIDENCE n≥5", d.cells5 ?? 0, "text-ink"],
            ["EVIDENCE n≥20", d.cells20 ?? 0, "text-ink"],
            ["BLOCKED", d.blocked ?? 0, "text-downink"],
            ["ABSTAIN RATE", d.abstainRate != null ? (100 * d.abstainRate).toFixed(0) + "%" : NO_DATA, "text-gold"],
            ["CANDIDATES", d.candidates ?? 0, "text-ink"],
          ].map(([k, v, cls]) => (
            <div key={String(k)} className="well p-2 text-center">
              <div className="label">{k}</div>
              <div className={`font-display text-xl ${cls}`}>{v}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3 text-[11px] tnum">
          <span className="label">EXECUTED</span>
          <span className="text-right text-inksoft">{d.executedCount ?? 0}</span>
          <span className="label">SHADOW OPENED</span>
          <span className="text-right text-inksoft">{d.shadowOpened ?? 0}</span>
          <span className="label">SHADOW RESOLVED</span>
          <span className="text-right text-inksoft">{d.shadowResolved ?? 0}</span>
          <span className="label">COHORTS</span>
          <span className="text-right text-inksoft">{d.cohorts ?? 0}</span>
        </div>

        {cells.length > 0 && (
          <table className="term-table mt-3">
            <thead>
              <tr>
                <th>CONTEXT CELL</th>
                <th className="text-right">n</th>
                <th className="text-right">EXPECTANCY</th>
              </tr>
            </thead>
            <tbody>
              {cells.slice(0, 4).map((c: any, i: number) => (
                <tr key={i}>
                  <td className="text-inksoft">{c.key}</td>
                  <td className="text-right tnum">{c.n}</td>
                  <td className={`text-right tnum ${c.expectancyR >= 0 ? "text-upink" : "text-downink"}`}>
                    {c.expectancyR >= 0 ? "+" : ""}
                    {c.expectancyR.toFixed(3)}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {d.strategyDistribution && Object.keys(d.strategyDistribution).length > 0 && (
          <div className="mt-2 text-[11px] text-inksoft tnum">
            strategy distribution:{" "}
            {Object.entries(d.strategyDistribution)
              .sort((a: any, b: any) => b[1] - a[1])
              .map(([k, v]: any) => `${k} ${Math.round((100 * v) / Math.max(1, d.executedCount ?? v))}%`)
              .join(" · ")}
          </div>
        )}

        <div className="mt-3 flex items-baseline gap-2">
          <span className="label">LEARNING CONFIDENCE</span>
          <b className={d.confidence === "INSUFFICIENT DATA" ? "text-amber" : "text-ink"}>
            {d.confidence ?? "INSUFFICIENT DATA"}
          </b>
        </div>
        {d.confidenceWhy && <p className="text-[11px] text-inksoft">Why: {d.confidenceWhy}.</p>}
        {last && (
          <div className="mt-2 text-[11px] text-inksoft">
            last: <b className="text-ink">{last.decision}</b>
            {last.selected ? ` → ${last.selected}` : ""} · {last.symbol} · {last.reason ?? ""}
          </div>
        )}
        <p className="mt-2 text-[11px] text-inksofter">
          Past outcomes change ranking, size and abstention. Risk gates always win. Shadow trades
          are counterfactuals only — never real P&L. The learner cannot modify signal logic.
        </p>
      </div>
    </div>
  );
}

/* ---- Owner control panel (manual restart / goal / survival) ---- */
function ControlPanel({ s }: { s: any }) {
  const [capital, setCapital] = useState("100");
  const [goal, setGoal] = useState("500");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const post = async (body: any, label: string) => {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      setMsg(
        j.ok
          ? { ok: true, text: "QUEUED — engine applies it within ~30s." }
          : { ok: false, text: j.error ?? "failed" },
      );
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "request failed" });
    } finally {
      setBusy(null);
    }
  };

  const survivalOn = !!s?.survival?.enabled;
  const cap = Number(capital),
    tgt = Number(goal),
    hrs = Number(hours);
  const restartValid = cap >= 1 && tgt > cap && hrs >= 1 && hrs <= 8760;

  return (
    <div className="card">
      <TitleBar
        title="■ OWNER CONTROL"
        right={
          survivalOn ? (
            <span className={s?.survivalBlocked ? "text-alert" : "text-amber"}>
              SURVIVAL {s?.survivalBlocked ? "· WAITING TO BE ABOVE WATER" : "· ARMED, 5x CAP"}
            </span>
          ) : (
            <span className="text-inksoft">survival off</span>
          )
        }
      />
      <div className="p-4">
        <p className="text-[11px] text-inksoft">
          MANDATE: survive on your own. Losses are not acceptable; long term we only need profit.
          Survival mode enforces this as far as honestly possible — no new positions while
          underwater, 5x max once above water. It <b>cannot</b> guarantee profits.
        </p>

        <div className="grid sm:grid-cols-4 gap-3 mt-4">
          <label className="label">
            STARTING CAPITAL ($)
            <input
              type="number"
              min="1"
              step="1"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-base tnum outline-none"
            />
          </label>
          <label className="label">
            GOAL TARGET ($)
            <input
              type="number"
              min="1"
              step="1"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-base tnum outline-none"
            />
          </label>
          <label className="label">
            RUN DURATION (HOURS)
            <input
              type="number"
              min="1"
              max="8760"
              step="1"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-base tnum outline-none"
            />
          </label>
          <div className="flex items-end">
            <button
              disabled={!restartValid || busy !== null}
              onClick={() => {
                if (
                  confirm(
                    `RESTART EPISODE with $${cap}, goal $${tgt}, ${hrs}h?\n\nOpen positions are settled and the current run is archived.`,
                  )
                )
                  post(
                    { action: "restart", startingCapital: cap, target: tgt, maxHours: hrs, survival: survivalOn },
                    "restart",
                  );
              }}
              className="pill w-full px-3 py-2 text-sm font-bold btn-amber"
            >
              {busy === "restart" ? "…" : "RESTART EPISODE"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-3">
          <button
            disabled={busy !== null || !(Number(goal) > 0)}
            onClick={() => post({ action: "setGoal", target: Number(goal), deadlineHours: hrs }, "goal")}
            className="pill px-4 py-2 text-sm font-bold"
          >
            {busy === "goal" ? "…" : "APPLY GOAL ONLY"}
          </button>
          <button
            disabled={busy !== null || survivalOn}
            onClick={() => post({ action: "setSurvival", enabled: true }, "surv")}
            className="pill px-4 py-2 text-sm font-bold"
          >
            ENABLE SURVIVAL
          </button>
          <button
            disabled={busy !== null || !survivalOn}
            onClick={() => post({ action: "setSurvival", enabled: false }, "surv")}
            className="pill px-4 py-2 text-sm btn-alert"
          >
            DISABLE SURVIVAL
          </button>
        </div>

        {msg && (
          <p className={`text-xs mt-2 ${msg.ok ? "text-upink" : "text-downink"}`}>
            {msg.ok ? "> " : "! "}
            {msg.text}
          </p>
        )}
        <p className="text-[11px] text-inksofter mt-2">
          Restart settles + archives the current run, then starts a fresh one. Goal-only applies to
          the current run using its own progress baseline.
        </p>
      </div>
    </div>
  );
}

const NAV = [
  { id: "overview", label: "MAIN", key: "F1" },
  { id: "research", label: "RESEARCH", key: "F2" },
  { id: "positions", label: "POSITIONS", key: "F3" },
  { id: "episodes", label: "EPISODES", key: "F4" },
  { id: "evolution", label: "EVOLUTION", key: "F5" },
  { id: "strategies", label: "STRATEGIES", key: "F6" },
  { id: "world", label: "WORLD", key: "F7" },
  { id: "lessons", label: "LESSONS", key: "F8" },
  { id: "trades", label: "TRADES", key: "F9" },
] as const;

export default function DashboardV2({ data }: { data: any }) {
  const [tab, setTab] = useState<string>("overview");
  const v2 = data?.v2 ?? {};
  const s = v2.signals ?? null;
  const [now, setNow] = useState(() => Date.now());

  // lightweight clock for the status bar (1s, no data fetching)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const quoteAge = ageSeconds(s?.ts);
  const uplinkOk = quoteAge != null && quoteAge <= 300;
  const equity = s?.equity;
  const totalPnl = s?.totalPnl;

  return (
    <div className="min-h-screen">
      <DataStream count={14} />

      {/* ============================ TOP STATUS BAR ============================ */}
      <header className="sticky top-0 z-40 border-b-2 border-phosdeep bg-term/95 backdrop-blur-none">
        <div className="mx-auto max-w-7xl px-3 py-2 flex items-center gap-3 flex-wrap">
          <TerminalLogo size={26} />
          <div className="font-display text-2xl text-phos glow-phos leading-none whitespace-nowrap">
            FABINVESTS
            <span className="text-phosdim text-lg ml-2">FX-2000</span>
          </div>

          <div className="hidden lg:flex items-center gap-4 ml-4 text-[11px] tnum">
            <span className="flex items-center gap-2">
              <Lamp on={uplinkOk} blink={!uplinkOk} tone={uplinkOk ? "text-phos" : "text-alert"} />
              <span className={uplinkOk ? "text-phos" : "text-alert"}>
                {uplinkOk ? "ENGINE UPLINK" : "UPLINK LOST"}
              </span>
            </span>
            <span className="text-inksoft">
              EQUITY <b className={tone(totalPnl)}>{equity != null ? usd(equity) : NO_DATA}</b>
            </span>
            <span className="text-inksoft">
              P&amp;L <b className={tone(totalPnl)}>{totalPnl != null ? signed(totalPnl) : NO_DATA}</b>
            </span>
            <span className="text-inksoft">
              RUN <b className="text-ink">#{pad(s?.episodeNum)}</b>
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3 text-[11px] tnum">
            <span className="text-amber font-bold">ALPHA: {NOT_VERIFIED}</span>
            <span className="text-inksofter hidden sm:inline">
              {new Date(now).toISOString().slice(11, 19)} UTC
            </span>
            <span className="blink text-phos" aria-hidden="true">
              ●
            </span>
          </div>
        </div>

        {/* ---------------------- marquee ticker ---------------------- */}
        <div className="marquee text-[11px] text-amberdim py-0.5">
          <span>
            *** FABINVESTS FX-2000 *** REAL OBSERVATIONS · FAKE MONEY · NO GUARANTEED EDGE *** ALPHA
            STATUS: WE ARE STILL LOOKING *** NINE RESEARCH PHASES COMPLETE · NO ROBUST OUT-OF-SAMPLE
            EDGE FOUND *** MISSION STATUS: DON&apos;T GO BROKE *** NEVER CONNECT THIS TERMINAL TO
            REAL-MONEY EXECUTION *** THIS IS NOT FINANCIAL ADVICE ***
          </span>
        </div>
      </header>

      {/* ============================== FUNCTION KEYS ============================== */}
      <div className="mx-auto max-w-7xl px-3 pt-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`pill whitespace-nowrap px-3 py-1.5 text-[11px] font-bold ${
                tab === n.id ? "bg-phosdeep text-phos" : "text-inksoft"
              }`}
              aria-current={tab === n.id ? "page" : undefined}
            >
              <span className="text-inksofter mr-1">{n.key}</span>
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-3 py-4">
        {tab === "overview" && <Overview v2={v2} s={s} serverTs={data?.serverTs} />}
        {tab === "research" && <Research />}
        {tab === "positions" && <Positions s={s} />}
        {tab === "episodes" && <Episodes v2={v2} s={s} />}
        {tab === "evolution" && <Evolution v2={v2} />}
        {tab === "strategies" && <Strategies v2={v2} />}
        {tab === "world" && <World s={s} />}
        {tab === "lessons" && <Lessons v2={v2} />}
        {tab === "trades" && <Trades v2={v2} />}
      </main>

      {/* ================================ FOOTER ================================ */}
      <footer className="mx-auto max-w-7xl px-3 pb-8">
        <AsciiRule text="FABINVESTS TERMINAL FX-2000 · PAPER ONLY" />
        <p className="text-[10px] text-inksofter mt-2 leading-relaxed">
          Real observations, fake money. No guaranteed edge. Never connect this simulator to
          real-money execution. This is not financial advice. The research program has NOT
          established robust out-of-sample profitability. All figures shown are simulated.
        </p>
      </footer>
    </div>
  );
}

function Spark({ points, up }: { points: any[]; up: boolean }) {
  if (!points?.length)
    return (
      <div className="well h-16 flex items-center justify-center text-inksoft text-xs">{NO_DATA}</div>
    );
  const d = points.map((p) => ({ v: p.equity }));
  return (
    <div className="well h-16 mt-3" aria-label="equity sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={up ? "#33ff66" : "#ff4444"}
            fill={up ? "#33ff6630" : "#ff444430"}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================== OVERVIEW ============================== */
function Overview({ v2, s, serverTs }: { v2: any; s: any; serverTs?: number }) {
  if (!s)
    return (
      <div className="card p-6">
        <div className="font-display text-2xl text-amber glow-amber">NO SIGNALS RECEIVED</div>
        <p className="text-sm text-inksoft mt-2">
          The API responded but <code className="text-cyan">signals.v2.json</code> is empty or
          missing. Is the engine running?
        </p>
        <p className="text-xs text-inksoft mt-2 font-term">
          &gt; node scripts/v2/engine.mjs
        </p>
      </div>
    );

  const lastEp = (v2.episodes ?? [])[(v2.episodes ?? []).length - 1];
  const ag = s.aggression ?? {};
  const life = s.lifetime ?? {};
  const g = s.goal ?? {};
  const hoursLeft =
    g.deadlineHours != null && g.startedAt
      ? Math.max(0, g.deadlineHours - (Date.now() - g.startedAt) / 3600000)
      : null;
  const up = (s.totalPnl ?? 0) >= 0;
  const capPct = ag.leverageCeiling ? (100 * (ag.leverageCap ?? 0)) / ag.leverageCeiling : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* previous-run banner */}
      {lastEp ? (
        <div className="card">
          <TitleBar
            title="■ LAST COMPLETED RUN"
            right={
              <span className={lastEp.blownUp ? "text-alert" : "text-phos"}>
                {lastEp.blownUp ? "WIPEOUT" : lastEp.endReason === "goal" ? "GOAL" : "ENDED"}
              </span>
            }
          />
          <div className="p-4 flex items-center gap-3 flex-wrap">
            <div className="font-display text-3xl text-inksoft">#{pad(lastEp.episodeNum)}</div>
            <div>
              <div className="text-sm">
                Run {lastEp.episodeNum}{" "}
                {lastEp.blownUp
                  ? "BLEW UP"
                  : lastEp.endReason === "goal"
                    ? "HIT THE GOAL"
                    : "FINISHED"}
              </div>
              <div className={`text-sm tnum ${tone(lastEp.returnPct)}`}>
                {pct(lastEp.returnPct)} · {timeAgo(lastEp.endedAt)} · now generation {s.generation},{" "}
                {ag.leverageCap}x, Kelly {(ag.kellyFraction ?? 0).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-4">
          <div className="text-sm">
            RUN <b className="text-phos">#{pad(s.episodeNum)}</b> IN PROGRESS
          </div>
        </div>
      )}

      {/* hero: equity + bot state */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <TitleBar
            title={`■ ACCOUNT EQUITY · EPISODE ${pad(s.episodeNum)}`}
            right={<span className={tone(s.totalPnl)}>{moodWord(s.totalPnlPct)}</span>}
          />
          <div className="p-5">
            <div className={`readout text-5xl sm:text-6xl ${tone(s.totalPnl)}`}>
              {usd(s.equity)}
            </div>
            <div className={`text-sm tnum mt-2 ${tone(s.totalPnl)}`}>
              {signed(s.totalPnl)} ({pct(s.totalPnlPct)}) this run · from {usd(s.startingCapital, 0)}
            </div>
            <Spark points={v2.equity} up={up} />
            <div className="mt-4">
              <div className="flex justify-between text-[11px] tnum">
                <span className="label">GOAL {usd(g.target, 0)}</span>
                <span className="text-inksoft">
                  {g.deadlineHours >= 1000
                    ? "no deadline, fast as it can"
                    : hoursLeft != null
                      ? `${hoursLeft.toFixed(1)}h left`
                      : NO_DATA}
                </span>
              </div>
              <div className="mt-2">
                <SegBar
                  value={s.progressPct ?? 0}
                  max={100}
                  segments={24}
                  tone={up ? "text-phos" : "text-alert"}
                />
              </div>
              <div className="mt-1 text-xs tnum text-inksoft">
                {s.progressPct != null ? s.progressPct.toFixed(1) + "% TO GOAL" : NO_DATA}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              {[
                ["GROSS LEV", s.grossLeverage != null ? s.grossLeverage.toFixed(1) + "x" : NO_DATA],
                ["MAX DD", s.maxDrawdownPct != null ? s.maxDrawdownPct.toFixed(1) + "%" : NO_DATA],
                ["GEN", String(s.generation ?? NO_DATA)],
                ["REGIME", String(s.regime ?? NO_DATA)],
              ].map(([k, v]) => (
                <div key={k} className="well p-2 text-center">
                  <div className="label">{k}</div>
                  <div className="font-display text-lg text-ink">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <HealthPanel s={s} serverTs={serverTs} />
          <div className="card">
            <TitleBar title="■ AGGREGATE STATE" right={<span className="text-inksoft">earned leverage</span>} />
            <div className="p-4">
              <SegBar
                value={capPct}
                max={100}
                segments={20}
                tone={capPct > 66 ? "text-alert" : capPct > 33 ? "text-amber" : "text-phos"}
              />
              <div className="mt-2 flex justify-between text-xs tnum">
                <span className="text-inksoft">
                  {ag.leverageCap ?? NO_DATA}x CAP / {ag.leverageCeiling ?? NO_DATA}x CEILING
                </span>
                <span className="text-inksoft">
                  KELLY {((ag.kellyFraction ?? 0) * 100).toFixed(0)}% · LVL {ag.unlockedLevel ?? 0}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-[11px] tnum">
                <span className="label">RUNS</span>
                <span className="text-right text-inksoft">{s.episodeNum ?? NO_DATA}</span>
                <span className="label">WIPEOUTS</span>
                <span className="text-right text-alert">{life.totalBlowups ?? 0}</span>
                <span className="label">BEST RUN</span>
                <span className="text-right text-upink">{pct(life.bestEpisodeReturnPct)}</span>
                <span className="label">LAST TICK</span>
                <span className="text-right text-inksoft">{timeAgo(s.ts)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* positions */}
      <SectionTitle label="OPEN POSITIONS" right={`${(s.positions ?? []).length} HELD`} />
      <PositionGrid positions={s.positions ?? []} />

      {/* comical + useful panels */}
      <div className="grid lg:grid-cols-2 gap-4">
        <ProfitOMeter s={s} />
        <LossDetector s={s} />
      </div>

      <AgentLog s={s} />
      <LearningCard s={s} />
      <ControlPanel s={s} />

      <div className="card-quiet p-4 text-[11px] flex flex-wrap gap-x-6 gap-y-1">
        <span className="text-inksoft">
          WORLD REGIME: <b className="text-ink">{s.world?.regime ?? NO_DATA}</b>
        </span>
        <span className="text-inksoft">
          FUNDING 8H:{" "}
          <b className="text-ink tnum">
            {s.fundingRate != null ? (s.fundingRate * 100).toFixed(4) + "%" : NO_DATA}
          </b>
        </span>
        <span className="text-inksoft">
          CRYPTO F&amp;G: <b className="text-ink">{s.world?.fearGreedCrypto?.value ?? NO_DATA}</b>
        </span>
      </div>
    </div>
  );
}

function SectionTitle({ label, right }: { label: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between mt-2">
      <h2 className="font-display text-2xl text-phos glow-phos">{label}</h2>
      {right && <span className="label">{right}</span>}
    </div>
  );
}

/* ============================== COMICAL PANELS ============================== */
/* Both panels are strictly derived from real values. Where a value does not
   exist they say so rather than inventing a score. */

function ProfitOMeter({ s }: { s: any }) {
  const pnlPct = s?.totalPnlPct;
  const has = pnlPct != null && Number.isFinite(pnlPct);
  // map -50%..+50% onto 0..100 for the needle; clamped, never extrapolated as truth
  const needle = has ? Math.max(0, Math.min(100, ((pnlPct + 50) / 100) * 100)) : 50;
  return (
    <div className="card">
      <TitleBar title="■ PROFIT-O-METER 3000" right={<span className="text-inksoft">very advanced financial technology</span>} />
      <div className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="label">THIS RUN, HONESTLY</div>
            <div className={`readout text-4xl ${tone(pnlPct)}`}>{has ? pct(pnlPct) : NO_DATA}</div>
          </div>
          <div className="font-display text-xl text-inksoft">#{pad(s?.episodeNum)}</div>
        </div>
        <div className="relative mt-4 h-6">
          <div className="absolute inset-x-0 top-2 seg-bar h-3">
            {Array.from({ length: 24 }, (_, i) => (
              <span
                key={i}
                className={`seg ${
                  i < 8 ? "on text-alert" : i < 16 ? "on text-amber" : "on text-phos"
                }`}
              />
            ))}
          </div>
          <div
            className="absolute -top-0.5 w-1 h-6 bg-ink shadow-[0_0_8px_#d8ffe2]"
            style={{ left: `calc(${needle}% - 2px)` }}
            aria-hidden="true"
          />
        </div>
        <div className="flex justify-between text-[10px] text-inksofter mt-1">
          <span>-50%</span>
          <span className="text-inksoft">BREAK EVEN</span>
          <span>+50%</span>
        </div>
        <p className="text-[11px] text-inksoft mt-3">
          Scale is fixed at ±50% of the run. It is a display, not a forecast, and it has never
          predicted anything correctly.
        </p>
      </div>
    </div>
  );
}

function LossDetector({ s }: { s: any }) {
  const dd = s?.maxDrawdownPct;
  const pnl = s?.totalPnl;
  const ddLevel = dd == null ? null : dd > 20 ? "SEVERE" : dd > 10 ? "ELEVATED" : dd > 0 ? "MILD" : "NONE";
  const cls = dd == null ? "text-inksoft" : dd > 20 ? "text-alert" : dd > 10 ? "text-amber" : "text-phos";
  return (
    <div className="card">
      <TitleBar title="■ LOSS DETECTOR" right={<span className={pnl != null && pnl < 0 ? "text-alert" : "text-phos"}>{pnl != null && pnl < 0 ? "OH NO" : "PROBABLY FINE"}</span>} />
      <div className="p-4">
        <div className="label">MAX DRAWDOWN THIS RUN</div>
        <div className={`readout text-4xl ${cls}`}>{dd != null ? dd.toFixed(2) + "%" : NO_DATA}</div>
        <div className={`text-sm mt-1 ${cls}`}>RISK LEVEL: {ddLevel ?? NO_DATA}</div>
        <div className="mt-3">
          <SegBar
            value={dd ?? 0}
            max={50}
            segments={20}
            tone={dd == null ? "text-inksoft" : dd > 20 ? "text-alert" : dd > 10 ? "text-amber" : "text-phos"}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-[11px] tnum">
          <span className="label">NET P&amp;L</span>
          <span className={`text-right ${tone(pnl)}`}>{pnl != null ? signed(pnl) : NO_DATA}</span>
          <span className="label">KILL SWITCH (DD HALT)</span>
          <span className="text-right text-inksoft">{s?.ddHaltPct != null ? s.ddHaltPct + "%" : NO_DATA}</span>
          <span className="label">HARD FLOOR</span>
          <span className="text-right text-inksoft">{s?.hardFloor != null ? usd(s.hardFloor) : NO_DATA}</span>
        </div>
        <p className="text-[11px] text-inksoft mt-3">
          PLEASE REMAIN CALM. Risk gates are enforced by the engine, not by this display.
        </p>
      </div>
    </div>
  );
}

/* ============================== RESEARCH TAB ============================== */
function Research() {
  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <TitleBar title="■ RESEARCH PROGRAM" right={<span className="text-amber">NOT FOR TRADING</span>} />
        <div className="p-5">
          <div className="font-display text-4xl text-amber glow-amber">ALPHA STATUS: {RESEARCH.alpha}</div>
          <p className="text-sm text-inksoft mt-3 max-w-3xl leading-relaxed">
            This terminal runs a <b className="text-ink">paper-trading simulator</b>, and separately
            runs an <b className="text-ink">offline research program</b>. The research program has
            completed nine experiments. None produced a tradeable, robust out-of-sample edge. The
            numbers on the trading tabs are <b className="text-ink">simulated account state</b>, not
            evidence of profitability.
          </p>
          <div className="well p-3 mt-4">
            <div className="label">CURRENT RESEARCH</div>
            <div className="font-display text-2xl text-cyan mt-1">{RESEARCH.current}</div>
            <p className="text-[11px] text-inksoft mt-1">
              The next step is genuinely different <b>information</b> — not another indicator, and
              not another ML layer over the same five OHLC fields.
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <TitleBar title="■ WHAT WAS TESTED" />
          <div className="p-4">
            <table className="term-table">
              <thead>
                <tr>
                  <th>PHASE</th>
                  <th>SUBJECT</th>
                  <th className="text-right">VERDICT</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["ALPHA", "8 signal families", "C — STOP", "text-alert"],
                  ["P5", "strategy calibration", "A — infra only", "text-amber"],
                  ["P6", "risk geometry", "B — no improvement", "text-amber"],
                  ["P7", "signal co-firing", "B — still negative", "text-amber"],
                  ["P8", "portfolio management", "B — risk only", "text-amber"],
                  ["P9", "final system", "C — no net edge", "text-alert"],
                  ["P10", "regime × side × horizon", "C — no robust edge", "text-alert"],
                  ["P11", "cross-sectional rotation", "C — no robust alpha", "text-alert"],
                ].map(([p, subj, v, cls]) => (
                  <tr key={String(p)}>
                    <td className="text-inksoft whitespace-nowrap">{p}</td>
                    <td className="text-ink">{subj}</td>
                    <td className={`text-right font-bold ${cls}`}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-inksofter mt-3">
              Full detail: docs/RESEARCH.md · RESEARCH_RESET_DIAGNOSIS.md
            </p>
          </div>
        </div>

        <div className="card">
          <TitleBar title="■ PROVEN VS NOT PROVEN" />
          <div className="p-4 flex flex-col gap-3">
            <div>
              <div className="label text-phos mb-1">ESTABLISHED</div>
              <ul className="text-xs flex flex-col gap-1">
                <li className="text-inksoft">■ The simulator runs deterministically and reproducibly.</li>
                <li className="text-inksoft">■ Costs are modelled and are NOT the binding constraint at low turnover.</li>
                <li className="text-inksoft">■ The learning layer changes ranking/size, never signal logic.</li>
                <li className="text-inksoft">■ Leakage audits pass; the negative results are not artefacts.</li>
              </ul>
            </div>
            <div className="border-t border-grid pt-3">
              <div className="label text-alert mb-1">NOT ESTABLISHED</div>
              <ul className="text-xs flex flex-col gap-1">
                <li className="text-inksoft">■ Positive gross directional alpha from OHLC-only data.</li>
                <li className="text-inksoft">■ Any robust out-of-sample net profitability.</li>
                <li className="text-inksoft">■ That the learner improves real results (history too thin).</li>
                <li className="text-inksoft">■ Anything about real-money execution.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <TitleBar title="■ DATA LIMITATIONS" right={<span className="text-alert">KNOWN</span>} />
        <div className="p-4">
          <table className="term-table">
            <thead>
              <tr>
                <th>DATA CLASS</th>
                <th>PRESENT</th>
                <th>NOTE</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["OHLC PRICE", "YES", "ts/open/high/low/close — daily 5y, hourly 730d, 15m 60d", "text-phos"],
                ["VOLUME", "NO", "not carried by any panel", "text-alert"],
                ["FUNDING HISTORY", "NO", "live snapshot only, no series offline", "text-alert"],
                ["OPEN INTEREST HISTORY", "NO", "live snapshot only", "text-alert"],
                ["ORDER FLOW / BOOK", "NO", "never available in this lineage", "text-alert"],
                ["DELISTING METADATA", "NO", "universe is survivorship-biased upward", "text-alert"],
                ["UNIVERSE SIZE", "14", "10 equities + 4 index-adjacent, chosen with hindsight", "text-amber"],
              ].map(([k, v, note, cls]) => (
                <tr key={String(k)}>
                  <td className="text-ink whitespace-nowrap">{k}</td>
                  <td className={`font-bold ${cls}`}>{v}</td>
                  <td className="text-inksoft text-[11px]">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================== POSITIONS ============================== */
function Runway({ p }: { p: any }) {
  // runway = 100*s*(mark-liq)/mark (docs/08 recommendation)
  if (!Number.isFinite(p.mark) || !Number.isFinite(p.liqPrice) || p.mark <= 0)
    return <span className="text-inksoft text-xs">{NO_DATA}</span>;
  const d = (100 * (p.side === "short" ? -1 : 1) * (p.mark - p.liqPrice)) / p.mark;
  const cls = d < 4 ? "text-alert" : d < 12 ? "text-amber" : "text-phos";
  const label = d < 4 ? "DANGER" : d < 12 ? "WATCH" : "SAFE";
  return (
    <div className="mt-2">
      <SegBar value={Math.max(0, Math.min(100, d))} max={100} segments={20} tone={cls} />
      <div className={`text-[11px] mt-1 ${cls}`}>
        {d.toFixed(1)}% FROM LIQUIDATION · {label}
      </div>
    </div>
  );
}

function PositionGrid({ positions }: { positions: any[] }) {
  if (!positions.length)
    return (
      <div className="card-quiet p-4 text-xs text-inksoft">
        NO OPEN POSITIONS — the bot is flat and thinking about it.
      </div>
    );
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {positions.map((p: any) => (
        <div key={p.symbol} className="card">
          <TitleBar
            title={`■ ${String(p.symbol).replace("-USD", "")}`}
            right={
              <span className={p.side === "long" ? "text-upink" : "text-downink"}>
                {p.side === "long" ? "LONG" : "SHORT"}
              </span>
            }
          />
          <div className="p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-inksoft tnum">
                {p.leverage}x · {p.strategy_id ?? "manual"}
              </span>
              <span className={`tnum text-sm font-bold ${tone(p.uPnl)}`}>
                {signed(p.uPnl)} ({pct(p.roiPct)})
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-[11px] tnum">
              <div className="well p-2">
                <div className="label">ENTRY</div>
                <div className="text-ink">{price(p.entry)}</div>
              </div>
              <div className="well p-2">
                <div className="label">MARK</div>
                <div className="text-ink">{price(p.mark)}</div>
              </div>
              <div className="well p-2">
                <div className="label">NOTIONAL</div>
                <div className="text-ink">{p.notional != null ? usd(p.notional, 0) : NO_DATA}</div>
              </div>
            </div>
            <Runway p={p} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Positions({ s }: { s: any }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="card-quiet p-4 text-xs text-inksoft">
        Liquidation is computed on a smoothed mark price, with real fees + funding + slippage. The
        bar shows how close each position is to being wiped out. BEEP BOOP — POSITION OPEN.
      </div>
      <PositionGrid positions={s?.positions ?? []} />
    </div>
  );
}

/* ============================== EPISODES ============================== */
function Episodes({ v2, s }: { v2: any; s: any }) {
  const eps: any[] = v2.episodes ?? [];
  const maxAbs = Math.max(1, ...eps.map((e) => Math.abs(e.returnPct ?? 0)));
  return (
    <div className="flex flex-col gap-4">
      <div className="card-quiet p-4 text-xs text-inksoft">
        Each run goes until it hits the goal, runs out of time, or blows up, then resets and tries
        again. Past performance of a simulated account is not a prediction of anything.
      </div>
      {eps.length >= 3 && (
        <div className="card">
          <TitleBar title="■ RUN RETURN TIMELINE" />
          <div className="p-5 flex items-end gap-1 h-36" aria-label="run return timeline">
            {eps.map((e, i) => (
              <div
                key={i}
                className="flex-1 flex flex-col items-center justify-end h-full"
                title={`Run ${e.episodeNum}: ${pct(e.returnPct)}`}
              >
                {e.blownUp && <span className="text-xs text-alert">X</span>}
                <div
                  className={`w-full ${
                    e.blownUp ? "bg-down" : (e.returnPct ?? 0) >= 0 ? "bg-up" : "bg-gold"
                  }`}
                  style={{ height: `${Math.max(3, (Math.abs(e.returnPct ?? 0) / maxAbs) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {eps.length < 3 && s && (
        <div className="card-quiet p-4 text-xs text-inksoft">
          RUN #{pad(s.episodeNum)} IN PROGRESS — timeline appears after 3 finished runs.
        </div>
      )}
      <div className="card">
        <TitleBar title="■ FINISHED RUNS" right={<span>{eps.length}</span>} />
        <div className="p-4 overflow-x-auto">
          {eps.length === 0 ? (
            <p className="text-xs text-inksoft">NO DATA — no finished runs yet.</p>
          ) : (
            <table className="term-table">
              <thead>
                <tr>
                  <th>RUN</th>
                  <th>END</th>
                  <th>PEAK</th>
                  <th>DD</th>
                  <th className="text-right">RETURN</th>
                </tr>
              </thead>
              <tbody>
                {[...eps].reverse().map((e, i) => (
                  <tr key={i}>
                    <td>#{pad(e.episodeNum)}</td>
                    <td className="text-inksoft">
                      {e.endReason}
                      {e.blownUp ? " [WIPEOUT]" : ""}
                    </td>
                    <td className="text-inksoft tnum">{usd(e.peakEquity, 0)}</td>
                    <td className="text-inksoft tnum">{(e.maxDrawdownPct ?? 0).toFixed(0)}%</td>
                    <td className={`text-right font-bold tnum ${tone(e.returnPct)}`}>
                      {pct(e.returnPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== EVOLUTION ============================== */
function Evolution({ v2 }: { v2: any }) {
  const gens: any[] = v2.generations ?? [];
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle label="EVOLUTION / LEVEL-UPS" right={`${gens.length} RECORDS`} />
      <div className="card-quiet p-4 text-xs text-inksoft">
        Every finished run banks a lesson and may promote or retire a strategy, retune Kelly, and
        unlock (or claw back) leverage.
      </div>
      {gens.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="font-display text-2xl text-inksoft">NO LEVEL-UPS YET</div>
          <p className="text-xs text-inksoft mt-2">The bot is still a beginner. Give it time.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {gens.map((g, i) => (
            <div key={i} className="card">
              <TitleBar title={`■ GEN ${g.generation}`} right={<span>after run #{pad(g.episodeNum)}</span>} />
              <div className="p-4">
                <div className="text-sm text-inksoft tnum">
                  leverage {g.aggression?.leverageCap}x · Kelly{" "}
                  {((g.aggression?.kellyFraction ?? 0) * 100).toFixed(0)}%
                </div>
                <p className="text-sm mt-2 text-ink">{g.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== STRATEGIES ============================== */
function Strategies({ v2 }: { v2: any }) {
  const list: any[] = v2.strategies ?? [];
  const statusCls: Record<string, string> = {
    active: "text-phos",
    candidate: "text-cyan",
    probation: "text-amber",
    retired: "text-alert",
  };
  const allCandidates = list.length > 0 && list.every((s) => s.status === "candidate");
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle label="STRATEGY BOOK" right={`${list.length} REGISTERED`} />
      <div className="card-quiet p-4 text-xs text-inksoft">
        A strategy only earns <b className="text-phos">active</b> after it proves a real edge
        (statistical gates + Deflated Sharpe). Losers get retired. No strategy has cleared that bar
        yet, which is the honest and expected state.
      </div>
      {allCandidates && (
        <p className="card-quiet p-3 text-[11px] text-amber">
          ! ALL STRATEGIES REMAIN CANDIDATES — still being evaluated on real closed trades.
        </p>
      )}
      {list.length === 0 && (
        <div className="card p-4 text-xs text-inksoft">NO DATA — no strategies registered.</div>
      )}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((s) => (
          <div key={s.id} className="card">
            <TitleBar
              title={`■ ${(s.name ?? s.id).toUpperCase()}`}
              right={<span className={statusCls[s.status] ?? "text-inksoft"}>{s.status}</span>}
            />
            <div className="p-4">
              <div className="text-[11px] text-inksoft tnum">
                n {s.n ?? 0} · Kelly {((s.kelly ?? 0) * 100).toFixed(0)}%
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[
                  ["EXP R", s.expectancy_R != null ? s.expectancy_R.toFixed(2) : NO_DATA, tone(s.expectancy_R)],
                  ["PF", s.profit_factor != null ? s.profit_factor.toFixed(2) : NO_DATA, "text-ink"],
                  ["DSR", s.dsr != null ? s.dsr.toFixed(2) : NO_DATA, "text-ink"],
                  [
                    "CONF",
                    s.confidence != null ? ((s.confidence ?? 0) * 100).toFixed(0) + "%" : NO_DATA,
                    "text-ink",
                  ],
                ].map(([k, v, cls]) => (
                  <div key={String(k)} className="well p-2">
                    <div className={`font-display text-lg ${cls}`}>{v}</div>
                    <div className="label text-[9px]">{k}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== WORLD ============================== */
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
    <div className="card">
      <TitleBar title={`■ ${label.toUpperCase()}`} right={g?._stale ? <span className="text-amber">STALE</span> : null} />
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <div className="readout text-4xl text-ink">{v ?? NO_DATA}</div>
          <div className="text-xs text-inksoft">
            {band}
            {g?._stale ? " · STALE" : ""}
          </div>
        </div>
        <div className="mt-3">
          <SegBar value={v ?? 0} max={100} segments={20} tone="text-amber" />
        </div>
        <div className="flex justify-between text-[10px] text-inksofter mt-1">
          <span>FEAR</span>
          <span>GREED</span>
        </div>
      </div>
    </div>
  );
}

function World({ s }: { s: any }) {
  const w = s?.world ?? null;
  const row = (k: string, val: any) => (
    <div className="flex justify-between text-xs py-1.5 border-b border-grid last:border-0">
      <span className="label">{k}</span>
      <span className="tnum text-ink">{val ?? NO_DATA}</span>
    </div>
  );
  const headlines = [...(w?.fed?.titles ?? []), ...(w?.headlines ?? [])];
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle label="WORLD MODEL" right="CONTEXT ONLY — NOT A SIGNAL" />
      <p className="card-quiet p-4 text-xs text-inksoft">
        The world model is a display and veto layer. Per the repository audit, news, social and
        macro observations <b>never touch position sizing</b>. Funding history does not exist
        offline, so it cannot be backtested.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Gauge label="Crypto Fear & Greed" g={w?.fearGreedCrypto} />
        <Gauge label="Stock Fear & Greed" g={w?.fearGreedStocks} />
      </div>
      <div className="card">
        <TitleBar title="■ MACRO & FLOW" />
        <div className="p-4">
          {row("REGIME", w?.regime)}
          {row("FUNDING 8H", w?.fundingRate != null ? (w.fundingRate * 100).toFixed(4) + "%" : NO_DATA)}
          {row("CRYPTO OI", w?.oiUsd != null ? usd(w.oiUsd, 0) : NO_DATA)}
          {row("WHALES", w?.whaleCrowd)}
          {row(
            "NEWS MOOD",
            w?.newsMood ? `${w.newsMood.mean.toFixed(2)}${w.newsMood.mixed ? " (mixed)" : ""}` : NO_DATA,
          )}
          {row("PUT/CALL", w?.putCall?.ratio != null ? w.putCall.ratio.toFixed(2) : NO_DATA)}
          {w?.macro && (
            <p className="text-[11px] text-inksoft mt-2">
              {(w.macro.drivers ?? []).join(" · ") || "no strong macro drivers"}
              {w.macro._stale ? " · STALE" : ""}
            </p>
          )}
          <p className="text-[10px] text-inksofter mt-3">
            FUNDING AND OI ARE LIVE SNAPSHOTS ONLY — no history is stored, so neither is
            backtestable and neither is used as a signal.
          </p>
        </div>
      </div>
      <div className="card">
        <TitleBar title="■ THESIS" />
        <div className="p-4">
          <p className="text-xs text-inksoft">
            {w?.thesis ?? "NO DATA — the source specifies no thesis generator, so none is invented."}
          </p>
        </div>
      </div>
      <div className="card">
        <TitleBar title="■ HEADLINES" right={<span>{headlines.length}</span>} />
        <div className="p-4">
          {headlines.length === 0 ? (
            <p className="text-xs text-inksoft">NO DATA — no headlines cached.</p>
          ) : (
            <ul className="text-xs flex flex-col gap-1">
              {headlines.slice(0, 12).map((h, i) => (
                <li key={i} className="border-b border-grid pb-1 last:border-0 text-inksoft">
                  <span className="text-inksofter mr-2">{pad(i + 1)}</span>
                  {h}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== LESSONS ============================== */
function Lessons({ v2 }: { v2: any }) {
  const mem: any[] = v2.memory ?? [];
  const kindCls = (k: string) =>
    k === "blowup" ? "text-alert" : k === "win" ? "text-phos" : "text-amber";
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle label="LESSONS BANKED" right={`${mem.length} RECORDS`} />
      <div className="card-quiet p-4 text-xs text-inksoft">
        The bot learns harder from blow-ups than wins. Each lesson is tagged to a market regime.
        Note: per the audit, lesson text is <b>display-only</b> — it does not edit trading rules.
      </div>
      {mem.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="font-display text-2xl text-inksoft">NO LESSONS YET</div>
          <p className="text-xs text-inksoft mt-2">They arrive when runs finish.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {mem.map((m, i) => (
            <div key={m.id ?? i} className="card">
              <TitleBar
                title={`■ ${String(m.title ?? "LESSON").toUpperCase()}`}
                right={
                  <span className={kindCls(m.kind)}>
                    {m.kind} · imp {m.importance}
                  </span>
                }
              />
              <div className="p-4">
                <p className="text-sm text-ink">{m.text}</p>
                <div className="text-[11px] text-inksoft mt-1">
                  regime {m.regime ?? "—"} · {timeAgo(m.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== TRADES ============================== */
function Trades({ v2 }: { v2: any }) {
  const trades: any[] = v2.trades ?? [];
  const wins = trades.filter((f) => f.op === "close" && (f.net_pnl ?? 0) > 0).length;
  const closes = trades.filter((f) => f.op === "close").length;
  const winRate = closes > 0 ? (100 * wins) / closes : null;
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle label="RECENT FILLS" right={`${trades.length} SHOWN`} />
      <div className="grid grid-cols-3 gap-3">
        {[
          ["FILLS SHOWN", String(trades.length)],
          ["CLOSED", String(closes)],
          ["WIN RATE", winRate != null ? winRate.toFixed(1) + "%" : NO_DATA],
        ].map(([k, v]) => (
          <div key={k} className="well p-3 text-center">
            <div className="label">{k}</div>
            <div className="font-display text-2xl text-ink">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-inksofter">
        Win rate is computed over the fills currently returned by the API, not the lifetime record.
      </p>
      {trades.length === 0 ? (
        <div className="card-quiet p-4 text-xs text-inksoft">NO DATA — no fills yet.</div>
      ) : (
        <div className="card">
          <TitleBar title="■ TAPE" />
          <div className="p-4 overflow-x-auto">
            <table className="term-table">
              <thead>
                <tr>
                  <th>OP</th>
                  <th>SIDE</th>
                  <th>SYMBOL</th>
                  <th>LEV</th>
                  <th>STRATEGY</th>
                  <th className="text-right">P&amp;L</th>
                  <th className="text-right">WHEN</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((f, i) => (
                  <tr key={f.eventId ?? i}>
                    <td className={f.op === "open" ? "text-cyan" : "text-inksoft"}>
                      {String(f.op).toUpperCase()}
                    </td>
                    <td className={f.side === "long" ? "text-upink" : "text-downink"}>
                      {String(f.side).toUpperCase()}
                    </td>
                    <td className="text-ink">{String(f.symbol).replace("-USD", "")}</td>
                    <td className="text-inksoft tnum">{f.leverage}x</td>
                    <td className="text-inksoft">{f.reason ?? "—"}</td>
                    <td className={`text-right tnum ${f.op === "close" ? tone(f.net_pnl) : "text-inksoft"}`}>
                      {f.op === "close" ? signed(f.net_pnl) : usd(f.margin)}
                    </td>
                    <td className="text-right text-inksoft text-[11px]">{timeAgo(f.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
