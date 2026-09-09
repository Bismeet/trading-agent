from __future__ import annotations

import asyncio
import datetime
import logging
import os
import sys
import threading
import time
import traceback
import uuid
from typing import Any

from cli.main import ANALYST_AGENT_NAMES, ANALYST_ORDER, ANALYST_REPORT_MAP, classify_message_type
from cli.stats_handler import StatsCallbackHandler
from cli.utils import detect_asset_type, normalize_ticker_symbol, resolve_backend_url
from tradingagents.default_config import DEFAULT_CONFIG
from web.backend.services import store as job_store
from tradingagents.graph.analyst_execution import (
    AnalystWallTimeTracker,
    build_analyst_execution_plan,
    get_initial_analyst_node,
    sync_analyst_tracker_from_chunk,
)
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.graph.checkpointer import (
    checkpoint_step,
    get_checkpointer,
    load_run_metadata,
    save_run_metadata,
    thread_id,
)
from tradingagents.llm_clients.api_key_env import get_api_key_env
from web.backend.schemas import (
    AgentActivityEvent,
    AnalysisRequest,
    AnalysisRunSnapshot,
    RunStats,
)
from web.backend.services import store as job_store
from web.backend.services.history import (
    get_run_from_history,
    list_history,
    save_run_to_history,
)
from web.backend.services import store as job_store

logger = logging.getLogger("web.backend.runner")

ALL_AGENTS = [
    "Market Analyst",
    "Sentiment Analyst",
    "News Analyst",
    "Fundamentals Analyst",
    "Bull Researcher",
    "Bear Researcher",
    "Research Manager",
    "Trader",
    "Aggressive Analyst",
    "Conservative Analyst",
    "Neutral Analyst",
    "Portfolio Manager",
]


class _RunCancelled(Exception):
    """Raised inside the pipeline loop when a user cancellation is requested."""


class AnalysisExecutionManager:
    """Manages active and historical analysis runs with pub/sub event broadcasting."""

    def __init__(self) -> None:
        self.active_runs: dict[str, AnalysisRunSnapshot] = {}
        self.trace_events: dict[str, list[dict[str, Any]]] = {}
        self.subscribers: dict[str, list] = {}
        self._lock = threading.Lock()
        self._start_lock = threading.Lock()
        self._cancel_events: dict[str, threading.Event] = {}
        # Persistent job store is the source of truth across refresh/restart.
        try:
            job_store.init_db()
        except Exception:
            pass

    def _find_prior_run(self, ticker: str, date: str) -> tuple[AnalysisRunSnapshot | None, list[dict[str, Any]]]:
        """Find the most relevant prior run for a ticker and date to resume from."""
        ticker_upper = ticker.upper().strip()
        candidates: list[tuple[AnalysisRunSnapshot, list[dict[str, Any]]]] = []

        with self._lock:
            for r_id, snap in self.active_runs.items():
                if snap.ticker.upper().strip() == ticker_upper and str(snap.analysis_date) == str(date):
                    candidates.append((snap, list(self.trace_events.get(r_id, []))))

        # Check history
        try:
            hist_runs = list_history(limit=30)
            for item in hist_runs:
                if item.get("ticker", "").upper().strip() == ticker_upper and str(item.get("analysis_date")) == str(date):
                    r_id = item.get("run_id")
                    if r_id:
                        detail = get_run_from_history(r_id)
                        if detail and detail.get("snapshot"):
                            try:
                                snap = AnalysisRunSnapshot.model_validate(detail["snapshot"])
                                candidates.append((snap, detail.get("trace", [])))
                            except Exception:
                                pass
        except Exception:
            pass

        if not candidates:
            return None, []

        def score_candidate(cand: tuple[AnalysisRunSnapshot, list[dict[str, Any]]]) -> tuple[int, int, int]:
            s = cand[0]
            rep_count = sum(1 for v in s.reports.values() if v) if s.reports else 0
            tokens = (s.stats.tokens_in + s.stats.tokens_out) if s.stats else 0
            calls = s.stats.llm_calls if s.stats else 0
            return (rep_count, tokens, calls)

        candidates.sort(key=score_candidate, reverse=True)
        return candidates[0]

    def create_run(self, request: AnalysisRequest) -> str:
        run_id = f"run_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Initial agent statuses
        selected_analyst_keys = [a.lower() for a in request.selected_analysts]
        agent_statuses: dict[str, str] = {}
        for key in request.selected_analysts:
            if key in ANALYST_AGENT_NAMES:
                agent_statuses[ANALYST_AGENT_NAMES[key]] = "waiting"

        # Fixed agents
        fixed_agents = [
            "Bull Researcher",
            "Bear Researcher",
            "Research Manager",
            "Trader",
            "Aggressive Analyst",
            "Conservative Analyst",
            "Neutral Analyst",
            "Portfolio Manager",
        ]
        for ag in fixed_agents:
            agent_statuses[ag] = "waiting"

        canonical_ticker = normalize_ticker_symbol(request.ticker)
        asset_type = detect_asset_type(canonical_ticker)
        signature = f"analysts={','.join(sorted(selected_analyst_keys))}:depth={request.research_depth}:risk={request.research_depth}:asset={asset_type.value}"

        prior_snapshot: AnalysisRunSnapshot | None = None
        prior_trace: list[dict[str, Any]] = []

        # 1. Lookup prior snapshot if resuming
        if getattr(request, "resume_from_run_id", None):
            prior_snapshot = self.get_snapshot(request.resume_from_run_id)
            if not prior_snapshot:
                hist = get_run_from_history(request.resume_from_run_id)
                if hist and hist.get("snapshot"):
                    try:
                        prior_snapshot = AnalysisRunSnapshot.model_validate(hist["snapshot"])
                        prior_trace = hist.get("trace", [])
                    except Exception:
                        pass
            else:
                prior_trace = self.get_trace(request.resume_from_run_id)

        if not prior_snapshot and request.checkpoint_enabled:
            prior_snapshot, prior_trace = self._find_prior_run(canonical_ticker, request.analysis_date)

        # 2. Inherit prior stats if available
        initial_stats = RunStats()
        if prior_snapshot and prior_snapshot.stats:
            initial_stats.llm_calls = prior_snapshot.stats.llm_calls
            initial_stats.tool_calls = prior_snapshot.stats.tool_calls
            initial_stats.tokens_in = prior_snapshot.stats.tokens_in
            initial_stats.tokens_out = prior_snapshot.stats.tokens_out
            initial_stats.elapsed_seconds = prior_snapshot.stats.elapsed_seconds

        # 3. Check SQLite auxiliary metadata
        sqlite_meta = load_run_metadata(
            DEFAULT_CONFIG["data_cache_dir"],
            canonical_ticker,
            request.analysis_date,
            signature,
        )
        if sqlite_meta and sqlite_meta.get("stats"):
            st = sqlite_meta["stats"]
            if (st.get("llm_calls", 0) > initial_stats.llm_calls) or (
                st.get("tokens_in", 0) + st.get("tokens_out", 0)
                > initial_stats.tokens_in + initial_stats.tokens_out
            ):
                initial_stats.llm_calls = st.get("llm_calls", 0)
                initial_stats.tool_calls = st.get("tool_calls", 0)
                initial_stats.tokens_in = st.get("tokens_in", 0)
                initial_stats.tokens_out = st.get("tokens_out", 0)
                initial_stats.elapsed_seconds = st.get("elapsed_seconds", 0.0)

        # 4. Recover completed reports and agent statuses from prior snapshot and SQLite
        reports: dict[str, str | None] = {}
        if prior_snapshot and prior_snapshot.reports:
            for k, v in prior_snapshot.reports.items():
                if v:
                    reports[k] = v

        try:
            tid = thread_id(canonical_ticker, str(request.analysis_date), signature)
            with get_checkpointer(DEFAULT_CONFIG["data_cache_dir"], canonical_ticker) as saver:
                cp_tuple = saver.get_tuple({"configurable": {"thread_id": tid}})
                if cp_tuple and cp_tuple.checkpoint:
                    ch_vals = cp_tuple.checkpoint.get("channel_values", {})
                    # Analyst reports
                    if ch_vals.get("market_report"):
                        reports["market_report"] = ch_vals["market_report"]
                        agent_statuses["Market Analyst"] = "completed"
                    if ch_vals.get("sentiment_report"):
                        reports["sentiment_report"] = ch_vals["sentiment_report"]
                        agent_statuses["Sentiment Analyst"] = "completed"
                    if ch_vals.get("news_report"):
                        reports["news_report"] = ch_vals["news_report"]
                        agent_statuses["News Analyst"] = "completed"
                    if ch_vals.get("fundamentals_report"):
                        reports["fundamentals_report"] = ch_vals["fundamentals_report"]
                        agent_statuses["Fundamentals Analyst"] = "completed"

                    # Investment debate state
                    inv = ch_vals.get("investment_debate_state", {})
                    if isinstance(inv, dict):
                        if inv.get("bull_history"):
                            reports["bull_history"] = inv["bull_history"]
                            agent_statuses["Bull Researcher"] = "completed"
                        if inv.get("bear_history"):
                            reports["bear_history"] = inv["bear_history"]
                            agent_statuses["Bear Researcher"] = "completed"
                        if inv.get("judge_decision"):
                            reports["investment_plan"] = inv["judge_decision"]
                            agent_statuses["Research Manager"] = "completed"

                    # Trader investment plan
                    if ch_vals.get("trader_investment_plan"):
                        reports["trader_investment_plan"] = ch_vals["trader_investment_plan"]
                        agent_statuses["Trader"] = "completed"

                    # Risk debate state
                    risk = ch_vals.get("risk_debate_state", {})
                    if isinstance(risk, dict):
                        if risk.get("aggressive_history"):
                            reports["aggressive_history"] = risk["aggressive_history"]
                            agent_statuses["Aggressive Analyst"] = "completed"
                        if risk.get("conservative_history"):
                            reports["conservative_history"] = risk["conservative_history"]
                            agent_statuses["Conservative Analyst"] = "completed"
                        if risk.get("neutral_history"):
                            reports["neutral_history"] = risk["neutral_history"]
                            agent_statuses["Neutral Analyst"] = "completed"
                        if risk.get("judge_decision"):
                            reports["final_trade_decision"] = risk["judge_decision"]
                            agent_statuses["Portfolio Manager"] = "completed"
        except Exception as err:
            logger.warning("Error inspecting SQLite checkpoint for initial snapshot: %s", err)

        if prior_snapshot and prior_snapshot.agent_statuses:
            for ag, st in prior_snapshot.agent_statuses.items():
                if st == "completed":
                    agent_statuses[ag] = "completed"

        completed_count = sum(1 for s in agent_statuses.values() if s == "completed")
        all_completed = (completed_count == len(agent_statuses)) and (completed_count > 0)

        current_agent = None
        if all_completed:
            init_progress = 100
            init_status = "completed"
            init_activity = "Analysis successfully completed"
        elif completed_count > 0:
            init_progress = min(int((completed_count / len(agent_statuses)) * 95), 95)
            init_status = "pending"
            init_activity = f"Resuming from checkpoint ({completed_count} phases preserved)..."
            for a_key in selected_analyst_keys:
                a_name = ANALYST_AGENT_NAMES[a_key]
                if agent_statuses.get(a_name) != "completed":
                    current_agent = a_name
                    break
            if not current_agent:
                for ag in fixed_agents:
                    if agent_statuses.get(ag) != "completed":
                        current_agent = ag
                        break
        else:
            init_progress = 0
            init_status = "pending"
            init_activity = "Initializing analysis graph..."

        initial_trace_list = list(prior_trace) if prior_trace else []
        if completed_count > 0:
            initial_trace_list.append({
                "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
                "activity_type": "info",
                "title": f"Resumed analysis from checkpoint ({completed_count} phases restored)",
                "details": f"Preserved {completed_count} completed phases, {initial_stats.llm_calls} LLM calls, and {initial_stats.tokens_in + initial_stats.tokens_out} tokens.",
                "metadata": {"resumed": True, "completed_phases": completed_count},
            })

        final_report = prior_snapshot.final_report if prior_snapshot else None
        trade_signal = prior_snapshot.trade_signal if prior_snapshot else None

        snapshot = AnalysisRunSnapshot(
            run_id=run_id,
            ticker=request.ticker.upper().strip(),
            analysis_date=request.analysis_date,
            status=init_status,
            progress_percent=init_progress,
            current_agent=current_agent,
            current_activity=init_activity,
            agent_statuses=agent_statuses,
            selected_analysts=selected_analyst_keys,
            stats=initial_stats,
            reports=reports,
            final_report=final_report,
            trade_signal=trade_signal,
            started_at=now_str,
            completed_at=now_str if all_completed else None,
            request_params=request.model_dump(),
        )

        with self._lock:
            self.active_runs[run_id] = snapshot
            self.trace_events[run_id] = initial_trace_list
            self.subscribers[run_id] = []

        return run_id

    def get_snapshot(self, run_id: str) -> AnalysisRunSnapshot | None:
        with self._lock:
            snap = self.active_runs.get(run_id)
        if snap is not None:
            return snap
        # Backend restarted or caller only has history: SQLite is the fallback
        # source of truth, then the legacy history file.
        try:
            job = job_store.get_job(run_id)
        except Exception:
            job = None
        if job:
            try:
                return self._job_to_snapshot(job)
            except Exception:
                pass
        try:
            hist = get_run_from_history(run_id)
            if hist and hist.get("snapshot"):
                return AnalysisRunSnapshot.model_validate(hist["snapshot"])
        except Exception:
            pass
        return None

    def _job_to_snapshot(self, job: dict) -> AnalysisRunSnapshot:
        usage = job.get("usage") or {}
        elapsed = usage.get("elapsed_seconds", 0.0) or 0.0
        return AnalysisRunSnapshot(
            run_id=job["run_id"],
            ticker=job.get("ticker", ""),
            analysis_date=job.get("analysis_date", ""),
            status=job.get("status", "pending"),
            progress_percent=int(job.get("progress_percent", 0) or 0),
            current_agent=job.get("current_agent"),
            current_activity=job.get("current_activity"),
            agent_statuses=job.get("agent_statuses") or {},
            selected_analysts=(job.get("request_params") or {}).get("selected_analysts", []),
            stats=RunStats(
                llm_calls=int(usage.get("llm_calls", 0) or 0),
                tool_calls=int(usage.get("tool_calls", 0) or 0),
                tokens_in=int(usage.get("input_tokens", 0) or 0),
                tokens_out=int(usage.get("output_tokens", 0) or 0),
                elapsed_seconds=float(elapsed),
            ),
            reports=job.get("reports") or {},
            final_report=job.get("final_report"),
            trade_signal=job.get("trade_signal"),
            error_summary=job.get("error_summary"),
            error_details=job.get("error_details"),
            failing_agent=job.get("failing_agent"),
            wall_time_summary=job.get("wall_time_summary"),
            started_at=job.get("started_at"),
            completed_at=job.get("completed_at"),
            request_params=job.get("request_params") or {},
            usage_estimated=bool(usage.get("estimated", False)),
            usage_provider=usage.get("provider"),
        )

    def get_trace(self, run_id: str) -> list[dict[str, Any]]:
        with self._lock:
            trace = list(self.trace_events.get(run_id, []))
        if trace:
            return trace
        try:
            events = job_store.get_events(run_id)
        except Exception:
            events = []
        if events:
            return events
        try:
            hist = get_run_from_history(run_id)
            if hist:
                return hist.get("trace", [])
        except Exception:
            pass
        return []

    def subscribe(self, run_id: str, queue=None):
        """Thread-safe subscribe. Returns a queue.Queue when queue is None."""
        import queue as _queue_mod

        with self._lock:
            if run_id not in self.subscribers:
                self.subscribers[run_id] = []
            if queue is None:
                queue = _queue_mod.Queue()
            self.subscribers[run_id].append(queue)
            return queue

    def unsubscribe(self, run_id: str, queue=None) -> None:
        with self._lock:
            if run_id in self.subscribers and queue in self.subscribers[run_id]:
                self.subscribers[run_id].remove(queue)

    def broadcast_event(self, run_id: str, event_data: dict[str, Any]) -> None:
        with self._lock:
            if run_id in self.trace_events:
                self.trace_events[run_id].append(event_data)
            subs = list(self.subscribers.get(run_id, []))
            snapshot = self.active_runs.get(run_id)

        # Persist to the SQLite job store (single source of truth) + legacy file.
        try:
            event_copy = dict(event_data)
            seq = job_store.append_event(run_id, event_copy)
            event_data["seq"] = seq
        except Exception:
            pass
        if snapshot is not None:
            try:
                self._persist_snapshot(snapshot)
            except Exception:
                pass

        for queue in subs:
            try:
                # queue.Queue (thread-safe) preferred; deliver via loop when the
                # subscriber passed an asyncio.Queue from the WS event loop.
                if isinstance(queue, asyncio.Queue):
                    try:
                        loop = queue._loop  # type: ignore[attr-defined]
                        loop.call_soon_threadsafe(queue.put_nowait, event_data)
                    except Exception:
                        queue.put_nowait(event_data)
                else:
                    queue.put_nowait(event_data)
            except Exception:
                pass

    def _persist_snapshot(self, snapshot: AnalysisRunSnapshot) -> None:
        """Mirror in-memory snapshot into SQLite + legacy history file."""
        usage = snapshot.stats.model_dump()
        usage_payload = {
            "input_tokens": usage.get("tokens_in", 0),
            "output_tokens": usage.get("tokens_out", 0),
            "total_tokens": usage.get("tokens_in", 0) + usage.get("tokens_out", 0),
            "llm_calls": usage.get("llm_calls", 0),
            "tool_calls": usage.get("tool_calls", 0),
            "estimated": bool(getattr(snapshot, "usage_estimated", False)),
            "provider": getattr(snapshot, "usage_provider", None) or (snapshot.request_params or {}).get("llm_provider"),
            "elapsed_seconds": usage.get("elapsed_seconds", 0.0),
        }
        try:
            existing = job_store.get_job(snapshot.run_id)
        except Exception:
            existing = None
        if existing is None:
            try:
                job_store.create_job(
                    snapshot.run_id, snapshot.ticker, snapshot.analysis_date,
                    {}, snapshot.request_params or {},
                    self._idem_key(snapshot.request_params or {}, snapshot.ticker, snapshot.analysis_date),
                    dict(snapshot.agent_statuses or {}),
                )
            except Exception:
                logger.warning(
                    "[analysis_id=%s] event=job_row_create_failed", snapshot.run_id,
                    exc_info=True,
                )
        else:
            # Never overwrite a terminal job with a stale in-memory copy.
            if existing.get("status") in job_store.TERMINAL and snapshot.status not in job_store.TERMINAL:
                return
        try:
            job_store.transition(snapshot.run_id, snapshot.status, {
                "current_agent": snapshot.current_agent,
                "current_activity": snapshot.current_activity,
                "progress_percent": snapshot.progress_percent,
                "agent_statuses": dict(snapshot.agent_statuses or {}),
                "usage": usage_payload,
                "reports": dict(snapshot.reports or {}),
                "final_report": snapshot.final_report,
                "trade_signal": snapshot.trade_signal,
                "error_summary": snapshot.error_summary,
                "error_details": snapshot.error_details,
                "failing_agent": snapshot.failing_agent,
                "wall_time_summary": snapshot.wall_time_summary,
                "completed_at": snapshot.completed_at,
            })
        except ValueError:
            # Same-state re-save (e.g. running -> running patch): apply directly.
            try:
                job_store.heartbeat(snapshot.run_id)
            except Exception:
                pass
        except Exception:
            pass
        try:
            save_run_to_history(snapshot, list(self.trace_events.get(snapshot.run_id, [])))
        except Exception:
            pass

    def start_analysis_thread(self, run_id: str, loop: asyncio.AbstractEventLoop | None) -> None:
        self._cancel_events[run_id] = threading.Event()
        thread = threading.Thread(
            target=self._run_pipeline,
            args=(run_id, loop),
            name=f"TradingAgents-{run_id}",
            daemon=True,
        )
        thread.start()

    def cancel_run(self, run_id: str, reason: str = "Analysis cancelled by user") -> bool:
        with self._lock:
            snapshot = self.active_runs.get(run_id)
            if not snapshot:
                return False
            snapshot.status = "failed"
            snapshot.error_summary = reason
            snapshot.current_activity = reason
            if snapshot.current_agent:
                snapshot.agent_statuses[snapshot.current_agent] = "failed"

        self.broadcast_event(
            run_id,
            {
                "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
                "activity_type": "error",
                "title": reason,
                "agent": snapshot.current_agent,
                "details": reason,
                "metadata": {"status": "failed", "error": reason},
            },
        )
        save_run_to_history(snapshot, self.get_trace(run_id))
        return True

    # ------------------------------------------------------------------
    # Reliable job lifecycle: idempotent start / cancel / resume /
    # crash recovery. SQLite job store is the source of truth.
    # ------------------------------------------------------------------

    @staticmethod
    def _idem_key(params: dict[str, Any], ticker: str, date: str) -> str:
        """Canonical idempotency key: same ticker+date+config == same run."""
        return (
            f"{ticker}:{date}:{params.get('llm_provider', '')}:"
            f"{params.get('deep_think_llm', '')}:{params.get('quick_think_llm', '')}:"
            f"{','.join(sorted(a.lower() for a in (params.get('selected_analysts') or [])))}:"
            f"{params.get('research_depth', 1)}"
        )

    def _run_signature(self, request_params: dict[str, Any]) -> str:
        """Signature matching create_run's checkpoint thread key."""
        analysts = sorted(a.lower() for a in (request_params.get("selected_analysts") or []))
        depth = request_params.get("research_depth", 1)
        try:
            asset_val = detect_asset_type(
                normalize_ticker_symbol(request_params.get("ticker", ""))
            ).value
        except Exception:
            asset_val = "stock"
        return f"analysts={','.join(analysts)}:depth={depth}:risk={depth}:asset={asset_val}"

    def _register_snapshot(self, run_id: str, snapshot: AnalysisRunSnapshot) -> None:
        """Re-register a persisted snapshot after backend restart so pipeline
        mutations are visible and persisted again."""
        with self._lock:
            if run_id not in self.active_runs:
                self.active_runs[run_id] = snapshot
                try:
                    self.trace_events[run_id] = list(job_store.get_events(run_id))
                except Exception:
                    self.trace_events[run_id] = []
                self.subscribers[run_id] = []

    def _event_loop_or_none(self) -> asyncio.AbstractEventLoop | None:
        try:
            return asyncio.get_running_loop()
        except RuntimeError:
            return None

    def start(self, request: AnalysisRequest, idempotency_key: str | None = None) -> AnalysisRunSnapshot:
        """Idempotently start an analysis; returns the authoritative snapshot.

        Duplicate RUN clicks (same ticker+date+config) and reconnects never
        create a second execution: the live job is returned instead.
        """
        ticker = normalize_ticker_symbol(request.ticker)
        with self._start_lock:
            key = idempotency_key or self._idem_key(
                request.model_dump(), ticker, request.analysis_date
            )
            existing = job_store.find_by_idempotency(key)
            if existing and existing.get("status") not in job_store.TERMINAL:
                snap = self.get_snapshot(existing["run_id"])
                if snap:
                    logger.info(
                        "[analysis_id=%s] event=start_deduped ticker=%s via=idempotency_key",
                        existing["run_id"], ticker,
                    )
                    return snap
            if not getattr(request, "resume_from_run_id", None):
                live = job_store.find_running_by_ticker_date(ticker, request.analysis_date)
                if live:
                    snap = self.get_snapshot(live["run_id"])
                    if snap and snap.status not in job_store.TERMINAL:
                        logger.info(
                            "[analysis_id=%s] event=start_deduped ticker=%s via=ticker_date",
                            live["run_id"], ticker,
                        )
                        return snap
            run_id = self.create_run(request)
            snapshot = self.get_snapshot(run_id)
            assert snapshot is not None
            # Persist the job row immediately so duplicate-click guards and
            # refresh recovery work before the first pipeline event.
            self._persist_snapshot(snapshot)
            try:
                job_store.transition(run_id, "starting", {"current_activity": "Starting analysis"})
            except ValueError:
                pass
            self.start_analysis_thread(run_id, self._event_loop_or_none())
            logger.info(
                "[analysis_id=%s] ticker=%s event=started provider=%s",
                run_id, ticker, request.llm_provider,
            )
            return snapshot

    def cancel(self, run_id: str) -> bool:
        """Cancel a running analysis. Cooperative: pipeline aborts between chunks."""
        job = job_store.get_job(run_id)
        if not job or job.get("status") in job_store.TERMINAL:
            return False
        evt = self._cancel_events.setdefault(run_id, threading.Event())
        evt.set()
        with self._lock:
            snapshot = self.active_runs.get(run_id)
        if snapshot is None:
            snapshot = self.get_snapshot(run_id)
        if snapshot is None:
            return False
        snapshot.status = "cancelled"
        snapshot.current_agent = None
        snapshot.current_activity = "Analysis cancelled by user"
        snapshot.completed_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.broadcast_event(run_id, {
            "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
            "activity_type": "info",
            "title": "Analysis cancelled by user",
            "metadata": {"status": "cancelled"},
        })
        self._persist_snapshot(snapshot)
        logger.info("[analysis_id=%s] ticker=%s event=cancelled", run_id, job.get("ticker"))
        return True

    def resume(self, run_id: str) -> AnalysisRunSnapshot:
        """Resume a failed/cancelled run from its latest valid checkpoint.

        Reuses the same run_id; accumulated stats/trace/reports are preserved
        and the real LangGraph checkpoint (keyed by ticker+date+signature)
        lets propagate continue from the last completed node.
        """
        job = job_store.get_job(run_id)
        if not job:
            raise KeyError(run_id)
        if job.get("status") == "completed":
            # Completed analyses are immutable: never relaunch, never overwrite.
            snap = self.get_snapshot(run_id)
            if snap:
                return snap
            raise KeyError(run_id)
        if job.get("status") not in job_store.TERMINAL:
            snap = self.get_snapshot(run_id)
            if snap:
                return snap
            raise KeyError(run_id)
        with self._lock:
            snap = self.active_runs.get(run_id)
        if snap is None:
            snap = self.get_snapshot(run_id)
        if snap is None:
            raise KeyError(run_id)
        with self._start_lock:
            try:
                job_store.transition(run_id, "starting", {
                    "current_activity": "Resuming from latest valid checkpoint",
                    "retry_count": int(job.get("retry_count", 0) or 0) + 1,
                })
            except ValueError:
                pass
            try:
                job_store.transition(run_id, "pending", {
                    "current_activity": "Resuming from latest valid checkpoint",
                })
            except ValueError:
                pass
            self._register_snapshot(run_id, snap)
            self.start_analysis_thread(run_id, self._event_loop_or_none())
        logger.info("[analysis_id=%s] ticker=%s event=resume_requested", run_id, job.get("ticker"))
        updated = self.get_snapshot(run_id)
        assert updated is not None
        return updated

    def recover_interrupted(self) -> list[str]:
        """Backend-startup crash recovery.

        Never blindly restarts: only jobs with a REAL LangGraph checkpoint are
        resumed (as RECOVERING); the rest are marked failed with the reason.
        Completed/failed/cancelled jobs are never touched.
        """
        recovered: list[str] = []
        try:
            interrupted = job_store.list_interrupted()
        except Exception:
            return recovered
        for job in interrupted:
            run_id = job["run_id"]
            with self._lock:
                alive = run_id in self.active_runs
            if alive:
                continue
            ticker = job.get("ticker", "")
            params = job.get("request_params") or {}
            signature = self._run_signature(params)
            try:
                step = checkpoint_step(
                    DEFAULT_CONFIG["data_cache_dir"], ticker,
                    str(job.get("analysis_date", "")), signature,
                )
            except Exception:
                step = None
            if step is not None:
                snap = self.get_snapshot(run_id)
                if not snap:
                    continue
                try:
                    job_store.transition(run_id, "recovering", {
                        "current_activity": f"Recovering from checkpoint (step {step})",
                    })
                except ValueError:
                    pass
                self._register_snapshot(run_id, snap)
                self.start_analysis_thread(run_id, self._event_loop_or_none())
                recovered.append(run_id)
                logger.info(
                    "[analysis_id=%s] ticker=%s event=recovered_from_checkpoint step=%s",
                    run_id, ticker, step,
                )
            else:
                try:
                    job_store.transition(run_id, "failed", {
                        "error_summary": (
                            "Backend restarted before any checkpoint was saved; "
                            "no recoverable state. Please start a new analysis."
                        ),
                        "current_activity": "Recovery not possible",
                    })
                except ValueError:
                    pass
                logger.warning(
                    "[analysis_id=%s] ticker=%s event=recovery_impossible_no_checkpoint",
                    run_id, ticker,
                )
        return recovered

    def _format_activity_title(self, agent: str | None, tool_name: str | None, args: dict | None) -> str:
        if tool_name:
            tool_actions = {
                "get_stock_data": "Fetching historical OHLCV data",
                "get_indicators": "Calculating technical indicators",
                "get_verified_market_snapshot": "Validating deterministic market snapshot",
                "get_news": "Fetching company news and updates",
                "get_global_news": "Scanning macro & global headlines",
                "get_insider_transactions": "Auditing insider trades",
                "get_macro_indicators": "Querying macroeconomic indicators",
                "get_prediction_markets": "Checking prediction market odds",
                "get_fundamentals": "Pulling financial ratios & overview",
                "get_balance_sheet": "Reviewing balance sheet",
                "get_cashflow": "Analyzing cash flow statements",
                "get_income_statement": "Analyzing income statements",
            }
            return tool_actions.get(tool_name, f"Executing {tool_name}")

        if agent:
            if "Analyst" in agent:
                return f"{agent} synthesizing findings and writing report"
            if "Researcher" in agent:
                return f"{agent} articulating thesis arguments"
            if "Research Manager" in agent:
                return "Research Manager evaluating thesis & counter-thesis"
            if "Trader" in agent:
                return "Trader formulating strategic execution plan"
            if "Risk" in agent or "Aggressive" in agent or "Conservative" in agent or "Neutral" in agent:
                return f"{agent} debating risk assessment"
            if "Portfolio Manager" in agent:
                return "Portfolio Manager formulating final allocation decision"

        return "Processing agent workflow"

    def _sanitize_args(self, args: Any) -> dict:
        """Sanitize arguments for safe frontend display (strip secrets)."""
        if not isinstance(args, dict):
            return {"value": str(args)}
        sanitized = {}
        for k, v in args.items():
            k_lower = str(k).lower()
            if any(secret in k_lower for secret in ("key", "token", "secret", "password", "auth")):
                sanitized[k] = "******"
            else:
                sanitized[k] = v
        return sanitized

    def _run_pipeline(self, run_id: str, loop: asyncio.AbstractEventLoop) -> None:
        snapshot = self.get_snapshot(run_id)
        if not snapshot:
            return

        request_dict = snapshot.request_params
        ticker = snapshot.ticker
        analysis_date = snapshot.analysis_date
        selected_analysts = snapshot.selected_analysts

        start_wall_time = time.time()
        stats_handler = StatsCallbackHandler()

        # Base stats to accumulate on top of when resuming
        base_llm_calls = snapshot.stats.llm_calls
        base_tool_calls = snapshot.stats.tool_calls
        base_tokens_in = snapshot.stats.tokens_in
        base_tokens_out = snapshot.stats.tokens_out
        base_elapsed_seconds = snapshot.stats.elapsed_seconds

        def push_event(activity_type: str, title: str, details: str | None = None, **kwargs):
            timestamp = datetime.datetime.now().strftime("%H:%M:%S")
            event = {
                "timestamp": timestamp,
                "activity_type": activity_type,
                "title": title,
                "details": details,
                **kwargs,
            }
            try:
                if loop is not None and loop.is_running():
                    loop.call_soon_threadsafe(self.broadcast_event, run_id, event)
                else:
                    self.broadcast_event(run_id, event)
            except RuntimeError:
                self.broadcast_event(run_id, event)

        def update_stats():
            raw_stats = stats_handler.get_stats()
            elapsed = (time.time() - start_wall_time) + base_elapsed_seconds
            snapshot.stats.llm_calls = base_llm_calls + raw_stats["llm_calls"]
            snapshot.stats.tool_calls = base_tool_calls + raw_stats["tool_calls"]
            snapshot.stats.tokens_in = base_tokens_in + raw_stats["tokens_in"]
            snapshot.stats.tokens_out = base_tokens_out + raw_stats["tokens_out"]
            snapshot.stats.elapsed_seconds = round(elapsed, 1)
            # Canonical usage flags: exact when provider usage metadata was
            # present for every LLM call, estimated otherwise.
            snapshot.usage_estimated = bool(raw_stats.get("estimated", False))
            snapshot.usage_provider = request_dict.get("llm_provider")

            push_event(
                "stats_update",
                "Stats update",
                metadata=snapshot.stats.model_dump(),
            )

            try:
                if "config" in locals() and "canonical_ticker" in locals() and "graph" in locals():
                    save_run_metadata(
                        config["data_cache_dir"],
                        canonical_ticker,
                        str(analysis_date),
                        graph._run_signature(asset_type.value),
                        {
                            "stats": snapshot.stats.model_dump(),
                            "agent_statuses": snapshot.agent_statuses,
                            "reports": {k: v for k, v in snapshot.reports.items() if v},
                        },
                    )
            except Exception:
                pass

        try:
            snapshot.status = "running"
            push_event("status_change", f"Started analysis for {ticker} on {analysis_date}")

            # 1. Normalize ticker and asset type
            canonical_ticker = normalize_ticker_symbol(ticker)
            asset_type = detect_asset_type(canonical_ticker)
            push_event("info", f"Resolved ticker: {canonical_ticker} (Asset type: {asset_type.value})")

            # 2. Build configuration
            config = DEFAULT_CONFIG.copy()
            research_depth = request_dict.get("research_depth", 1)
            config["max_debate_rounds"] = research_depth
            config["max_risk_discuss_rounds"] = research_depth
            config["llm_provider"] = request_dict.get("llm_provider", "google")
            config["deep_think_llm"] = request_dict.get("deep_think_llm", "gemini-3.5-flash")
            config["quick_think_llm"] = request_dict.get("quick_think_llm", "gemini-3.5-flash")
            config["output_language"] = request_dict.get("output_language", "English")
            config["checkpoint_enabled"] = bool(request_dict.get("checkpoint_enabled", True))
            config["llm_max_retries"] = 4

            provider = str(config["llm_provider"]).lower().strip()

            # Apply custom runtime API key if specified in request
            api_key = request_dict.get("api_key")
            if api_key and str(api_key).strip():
                clean_key = str(api_key).strip()
                env_var = get_api_key_env(provider)
                if env_var:
                    os.environ[env_var] = clean_key
                if provider == "google":
                    os.environ["GOOGLE_API_KEY"] = clean_key
                    os.environ["GEMINI_API_KEY"] = clean_key
                elif provider == "openrouter":
                    os.environ["OPENROUTER_API_KEY"] = clean_key
                elif provider == "openai":
                    os.environ["OPENAI_API_KEY"] = clean_key
                elif provider == "anthropic":
                    os.environ["ANTHROPIC_API_KEY"] = clean_key
                elif provider == "deepseek":
                    os.environ["DEEPSEEK_API_KEY"] = clean_key
                elif provider == "nvidia":
                    os.environ["NVIDIA_API_KEY"] = clean_key
                elif provider == "meta":
                    os.environ["META_API_KEY"] = clean_key
                    os.environ["META_MUSE_API_KEY"] = clean_key
                push_event("info", f"Using custom runtime API key for {provider}")

            # Cap max_tokens on OpenRouter so balance estimation does not fail with 402
            if provider == "openrouter" and not config.get("max_tokens"):
                config["max_tokens"] = 8192

            # Provider thinking knobs
            thinking_mode = request_dict.get("thinking_mode")
            if provider == "google" and thinking_mode:
                # Gemini 2.5/2.0/1.5 does not take the thinking_level parameter (only Gemini 3.x)
                deep_m = str(config.get("deep_think_llm", "")).lower()
                if any(v in deep_m for v in ("2.5", "2.0", "1.5")):
                    config["google_thinking_level"] = None
                else:
                    config["google_thinking_level"] = thinking_mode
            elif provider == "openai" and thinking_mode:
                config["openai_reasoning_effort"] = thinking_mode
            elif provider == "anthropic" and thinking_mode:
                config["anthropic_effort"] = thinking_mode

            config["backend_url"] = resolve_backend_url(provider)

            # 3. Execution plan and trackers
            selected_set = set(selected_analysts)
            selected_analyst_keys = [a for a in ANALYST_ORDER if a in selected_set]
            analyst_execution_plan = build_analyst_execution_plan(selected_analyst_keys)
            wall_time_tracker = AnalystWallTimeTracker(analyst_execution_plan)

            # 4. Instantiate Graph with StatsCallbackHandler
            push_event("info", f"Compiling trading graph with provider: {config['llm_provider']}, model: {config['deep_think_llm']}")
            graph = TradingAgentsGraph(
                selected_analyst_keys,
                config=config,
                debug=True,
                callbacks=[stats_handler],
            )

            # Prepare initial state
            instrument_context = graph.resolve_instrument_context(canonical_ticker, asset_type.value)
            init_agent_state = graph.propagator.create_initial_state(
                canonical_ticker,
                analysis_date,
                asset_type=asset_type.value,
                instrument_context=instrument_context,
            )
            args = graph.propagator.get_graph_args(callbacks=[stats_handler])

            checkpoint_tid = graph.begin_checkpoint(canonical_ticker, analysis_date, asset_type.value)
            if checkpoint_tid is not None:
                args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = checkpoint_tid

            is_resuming = getattr(graph, "_resuming", False)
            if is_resuming:
                push_event(
                    "info",
                    f"Resuming analysis for {canonical_ticker} on {analysis_date} from saved checkpoint! Completed phases will be reused without repeating.",
                )

                # Broadcast all completed agent statuses to connected clients
                for ag_name, ag_st in snapshot.agent_statuses.items():
                    if ag_st == "completed":
                        push_event(
                            "agent_status",
                            f"{ag_name} -> completed (restored from checkpoint)",
                            agent=ag_name,
                            metadata={"agent": ag_name, "status": "completed"},
                        )

                # Broadcast reports
                for r_key, r_content in snapshot.reports.items():
                    if r_content:
                        push_event(
                            "report_update",
                            f"Restored {r_key} from checkpoint",
                            metadata={"section": r_key, "content": r_content},
                        )

                # Broadcast stats
                push_event("stats_update", "Stats restored from checkpoint", metadata=snapshot.stats.model_dump())

                # Find the next agent to set in_progress
                next_agent = None
                for a_key in selected_analyst_keys:
                    a_name = ANALYST_AGENT_NAMES[a_key]
                    if snapshot.agent_statuses.get(a_name) != "completed":
                        next_agent = a_name
                        break
                if not next_agent:
                    fixed_order = [
                        "Bull Researcher",
                        "Bear Researcher",
                        "Research Manager",
                        "Trader",
                        "Aggressive Analyst",
                        "Conservative Analyst",
                        "Neutral Analyst",
                        "Portfolio Manager",
                    ]
                    for ag in fixed_order:
                        if snapshot.agent_statuses.get(ag) != "completed":
                            next_agent = ag
                            break

                if next_agent:
                    snapshot.agent_statuses[next_agent] = "in_progress"
                    snapshot.current_agent = next_agent
                    snapshot.current_activity = f"{next_agent} in progress"
                    push_event(
                        "agent_status",
                        f"{next_agent} is now in progress",
                        agent=next_agent,
                        metadata={"status": "in_progress", "agent": next_agent},
                    )
                else:
                    logger.info("All phases already completed in checkpoint. Finalizing run.")
                    snapshot.progress_percent = 100
                    snapshot.status = "completed"
                    snapshot.current_agent = None
                    snapshot.current_activity = "Analysis successfully completed"
                    snapshot.completed_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    update_stats()
                    push_event(
                        "complete",
                        f"Completed analysis for {canonical_ticker} (restored from checkpoint)",
                        metadata={"signal": snapshot.trade_signal},
                    )
                    save_run_to_history(snapshot, self.get_trace(run_id))
                    return
            else:
                first_analyst = get_initial_analyst_node(analyst_execution_plan)
                snapshot.agent_statuses[first_analyst] = "in_progress"
                snapshot.current_agent = first_analyst
                snapshot.current_activity = f"{first_analyst} initialized and researching"
                wall_time_tracker.mark_started(selected_analyst_keys[0])

                push_event(
                    "agent_status",
                    f"{first_analyst} is now in progress",
                    agent=first_analyst,
                    metadata={"status": "in_progress", "agent": first_analyst},
                )

            trace = []
            processed_msg_ids = set()

            def compute_progress() -> int:
                completed_count = sum(1 for s in snapshot.agent_statuses.values() if s == "completed")
                total = len(snapshot.agent_statuses)
                if total == 0:
                    return 0
                if completed_count == total:
                    return 100
                return min(int((completed_count / total) * 95), 95)

            snapshot.progress_percent = compute_progress()

            # Helper for agent transitions
            def set_agent_status(ag_name: str, new_status: str, activity_text: str | None = None):
                snapshot.agent_statuses[ag_name] = new_status
                if new_status == "in_progress":
                    snapshot.current_agent = ag_name
                    if activity_text:
                        snapshot.current_activity = activity_text
                snapshot.progress_percent = compute_progress()
                push_event(
                    "agent_status",
                    f"{ag_name} -> {new_status}",
                    agent=ag_name,
                    details=activity_text,
                    metadata={
                        "agent": ag_name,
                        "status": new_status,
                        "progress": snapshot.progress_percent,
                    },
                )


            try:
                for chunk in graph.graph.stream(graph.checkpoint_input(init_agent_state), **args):
                    cancel_evt = self._cancel_events.get(run_id)
                    if cancel_evt is not None and cancel_evt.is_set():
                        raise _RunCancelled()
                    update_stats()

                    # 1. Process chunk messages
                    for msg in chunk.get("messages", []):
                        m_id = getattr(msg, "id", None)
                        if m_id:
                            if m_id in processed_msg_ids:
                                continue
                            processed_msg_ids.add(m_id)

                        msg_type, content = classify_message_type(msg)
                        if content and content.strip():
                            push_event(
                                "message",
                                f"[{msg_type}] {content[:120]}..." if len(content) > 120 else f"[{msg_type}] {content}",
                                details=content,
                                metadata={"type": msg_type},
                            )

                        # Process tool calls
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                                tc_args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
                                sanitized_args = self._sanitize_args(tc_args)
                                activity_title = self._format_activity_title(snapshot.current_agent, name, tc_args)
                                snapshot.current_activity = activity_title
                                push_event(
                                    "tool_call",
                                    activity_title,
                                    details=str(sanitized_args),
                                    agent=snapshot.current_agent,
                                    metadata={"tool_name": name, "args": sanitized_args},
                                )

                    # 2. Analyst statuses and reports
                    sync_analyst_tracker_from_chunk(wall_time_tracker, chunk)
                    found_active_analyst = False

                    for analyst_key in ANALYST_ORDER:
                        if analyst_key not in selected_analyst_keys:
                            continue
                        agent_name = ANALYST_AGENT_NAMES[analyst_key]
                        report_key = ANALYST_REPORT_MAP[analyst_key]

                        if chunk.get(report_key):
                            snapshot.reports[report_key] = chunk[report_key]
                            set_agent_status(agent_name, "completed")
                            push_event(
                                "report_update",
                                f"{agent_name} finalized report",
                                agent=agent_name,
                                metadata={"section": report_key, "content": chunk[report_key]},
                            )
                        elif snapshot.reports.get(report_key):
                            set_agent_status(agent_name, "completed")
                        elif not found_active_analyst:
                            set_agent_status(agent_name, "in_progress", f"{agent_name} analyzing data")
                            found_active_analyst = True
                        else:
                            if snapshot.agent_statuses.get(agent_name) not in ("in_progress", "completed"):
                                set_agent_status(agent_name, "waiting")

                    # If all analysts completed, start Bull Researcher
                    if not found_active_analyst and snapshot.agent_statuses.get("Bull Researcher") == "waiting":
                        set_agent_status("Bull Researcher", "in_progress", "Formulating bullish thesis")

                    # 3. Investment debate state
                    if chunk.get("investment_debate_state"):
                        debate_state = chunk["investment_debate_state"]
                        bull_hist = debate_state.get("bull_history", "").strip()
                        bear_hist = debate_state.get("bear_history", "").strip()
                        judge = debate_state.get("judge_decision", "").strip()

                        if bull_hist:
                            snapshot.reports["bull_history"] = bull_hist
                            set_agent_status("Bull Researcher", "completed")
                            if snapshot.agent_statuses.get("Bear Researcher") != "completed":
                                set_agent_status("Bear Researcher", "in_progress", "Formulating counter-arguments")
                            push_event(
                                "report_update",
                                "Bull Researcher argument submitted",
                                agent="Bull Researcher",
                                metadata={"section": "bull_history", "content": bull_hist},
                            )

                        if bear_hist:
                            snapshot.reports["bear_history"] = bear_hist
                            set_agent_status("Bear Researcher", "completed")
                            if snapshot.agent_statuses.get("Research Manager") != "completed":
                                set_agent_status("Research Manager", "in_progress", "Evaluating investment debate")
                            push_event(
                                "report_update",
                                "Bear Researcher counter-argument submitted",
                                agent="Bear Researcher",
                                metadata={"section": "bear_history", "content": bear_hist},
                            )

                        if judge:
                            snapshot.reports["investment_plan"] = judge
                            set_agent_status("Bull Researcher", "completed")
                            set_agent_status("Bear Researcher", "completed")
                            set_agent_status("Research Manager", "completed")
                            set_agent_status("Trader", "in_progress", "Formulating trade allocation strategy")
                            push_event(
                                "report_update",
                                "Research Manager delivered investment decision",
                                agent="Research Manager",
                                metadata={"section": "investment_plan", "content": judge},
                            )

                    # 4. Trader investment plan
                    if chunk.get("trader_investment_plan"):
                        snapshot.reports["trader_investment_plan"] = chunk["trader_investment_plan"]
                        set_agent_status("Trader", "completed")
                        set_agent_status("Aggressive Analyst", "in_progress", "Debating aggressive risk posture")
                        push_event(
                            "report_update",
                            "Trader investment plan finalized",
                            agent="Trader",
                            metadata={"section": "trader_investment_plan", "content": chunk["trader_investment_plan"]},
                        )

                    # 5. Risk debate state
                    if chunk.get("risk_debate_state"):
                        risk_state = chunk["risk_debate_state"]
                        agg_hist = risk_state.get("aggressive_history", "").strip()
                        con_hist = risk_state.get("conservative_history", "").strip()
                        neu_hist = risk_state.get("neutral_history", "").strip()
                        risk_judge = risk_state.get("judge_decision", "").strip()

                        if agg_hist:
                            snapshot.reports["aggressive_history"] = agg_hist
                            set_agent_status("Aggressive Analyst", "completed")
                            if snapshot.agent_statuses.get("Conservative Analyst") != "completed":
                                set_agent_status("Conservative Analyst", "in_progress", "Debating conservative risk posture")
                            push_event(
                                "report_update",
                                "Aggressive Analyst debate submitted",
                                agent="Aggressive Analyst",
                                metadata={"section": "aggressive_history", "content": agg_hist},
                            )
                        if con_hist:
                            snapshot.reports["conservative_history"] = con_hist
                            set_agent_status("Conservative Analyst", "completed")
                            if snapshot.agent_statuses.get("Neutral Analyst") != "completed":
                                set_agent_status("Neutral Analyst", "in_progress", "Debating neutral risk posture")
                            push_event(
                                "report_update",
                                "Conservative Analyst debate submitted",
                                agent="Conservative Analyst",
                                metadata={"section": "conservative_history", "content": con_hist},
                            )
                        if neu_hist:
                            snapshot.reports["neutral_history"] = neu_hist
                            set_agent_status("Neutral Analyst", "completed")
                            if snapshot.agent_statuses.get("Portfolio Manager") != "completed":
                                set_agent_status("Portfolio Manager", "in_progress", "Synthesizing final trade decision")
                            push_event(
                                "report_update",
                                "Neutral Analyst debate submitted",
                                agent="Neutral Analyst",
                                metadata={"section": "neutral_history", "content": neu_hist},
                            )
                        if risk_judge:
                            snapshot.reports["final_trade_decision"] = risk_judge
                            set_agent_status("Aggressive Analyst", "completed")
                            set_agent_status("Conservative Analyst", "completed")
                            set_agent_status("Neutral Analyst", "completed")
                            set_agent_status("Portfolio Manager", "completed")
                            push_event(
                                "report_update",
                                "Portfolio Manager rendered final trade decision",
                                agent="Portfolio Manager",
                                metadata={"section": "final_trade_decision", "content": risk_judge},
                            )

                    snapshot.progress_percent = compute_progress()
                    trace.append(chunk)

                graph.clear_checkpoint_on_success(canonical_ticker, analysis_date, asset_type.value)
            finally:
                graph.end_checkpoint()

            # Merge all chunks into final state
            final_state = {}
            for chunk in trace:
                final_state.update(chunk)

            # Mark all agents completed
            for ag in snapshot.agent_statuses:
                snapshot.agent_statuses[ag] = "completed"

            # Build consolidated final markdown report
            report_sections = []
            if any(snapshot.reports.get(k) for k in ("market_report", "sentiment_report", "news_report", "fundamentals_report")):
                report_sections.append("## Analyst Team Reports")
                if snapshot.reports.get("market_report"):
                    report_sections.append(f"### Market Analysis\n\n{snapshot.reports['market_report']}")
                if snapshot.reports.get("sentiment_report"):
                    report_sections.append(f"### Social Sentiment Analysis\n\n{snapshot.reports['sentiment_report']}")
                if snapshot.reports.get("news_report"):
                    report_sections.append(f"### News Analysis\n\n{snapshot.reports['news_report']}")
                if snapshot.reports.get("fundamentals_report"):
                    report_sections.append(f"### Fundamentals Analysis\n\n{snapshot.reports['fundamentals_report']}")

            if snapshot.reports.get("bull_history") or snapshot.reports.get("bear_history") or snapshot.reports.get("investment_plan"):
                report_sections.append("## Research Team Debate & Decision")
                if snapshot.reports.get("bull_history"):
                    report_sections.append(f"### Bull Thesis\n\n{snapshot.reports['bull_history']}")
                if snapshot.reports.get("bear_history"):
                    report_sections.append(f"### Bear Thesis\n\n{snapshot.reports['bear_history']}")
                if snapshot.reports.get("investment_plan"):
                    report_sections.append(f"### Research Manager Decision\n\n{snapshot.reports['investment_plan']}")

            if snapshot.reports.get("trader_investment_plan"):
                report_sections.append(f"## Trading Team Plan\n\n{snapshot.reports['trader_investment_plan']}")

            if snapshot.reports.get("final_trade_decision"):
                report_sections.append(f"## Portfolio Management Decision\n\n{snapshot.reports['final_trade_decision']}")

            snapshot.final_report = "\n\n".join(report_sections)

            # Extract signal
            if final_state.get("final_trade_decision"):
                try:
                    signal = graph.process_signal(final_state["final_trade_decision"])
                    snapshot.trade_signal = str(signal).upper().strip()
                except Exception as ex:
                    logger.warning("Error processing trade signal: %s", ex)
                    # fallback regex or substring
                    text = final_state["final_trade_decision"].upper()
                    if "BUY" in text:
                        snapshot.trade_signal = "BUY"
                    elif "SELL" in text:
                        snapshot.trade_signal = "SELL"
                    elif "HOLD" in text:
                        snapshot.trade_signal = "HOLD"
                    else:
                        snapshot.trade_signal = "NEUTRAL"

            # Save on-disk reports using graph.save_reports
            try:
                graph.save_reports(final_state, canonical_ticker)
            except Exception as ex:
                logger.debug("Could not run save_reports: %s", ex)

            # Wrap up
            wall_time_summary = wall_time_tracker.format_summary()
            snapshot.wall_time_summary = wall_time_summary
            snapshot.progress_percent = 100
            snapshot.status = "completed"
            snapshot.current_agent = None
            snapshot.current_activity = "Analysis successfully completed"
            snapshot.completed_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            update_stats()

            push_event(
                "complete",
                f"Completed analysis for {canonical_ticker}",
                details=wall_time_summary,
                metadata={"signal": snapshot.trade_signal},
            )

            # Persist to history
            save_run_to_history(snapshot, self.get_trace(run_id))

        except _RunCancelled:
            snapshot.status = "cancelled"
            snapshot.current_agent = None
            snapshot.current_activity = "Analysis cancelled by user"
            snapshot.completed_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            update_stats()
            push_event(
                "info",
                "Analysis cancelled by user",
                metadata={"status": "cancelled"},
            )
            self._persist_snapshot(snapshot)
            save_run_to_history(snapshot, self.get_trace(run_id))
            return
        except Exception as exc:
            logger.error("Analysis pipeline failed: %s", exc, exc_info=True)
            tb = traceback.format_exc()
            err_str = str(exc)
            failing_agent = snapshot.current_agent or "Pipeline Setup"
            snapshot.agent_statuses[failing_agent] = "failed"
            snapshot.status = "failed"
            snapshot.failing_agent = failing_agent
            prov_label = locals().get("provider") or (config.get("llm_provider") if "config" in locals() and isinstance(config, dict) else "selected provider")

            if "503" in err_str or "UNAVAILABLE" in err_str:
                clean_err = "Model temporarily unavailable (503 UNAVAILABLE): High demand spike. Please try again in a moment."
            elif "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                clean_err = "API quota exceeded (429 RESOURCE_EXHAUSTED): Quota limit reached on model free tier. Please wait a moment or switch your API key."
            elif "402" in err_str or "requires more credits" in err_str or "billing_not_configured" in err_str:
                if str(prov_label).lower() == "openrouter":
                    clean_err = "OpenRouter credits exhausted (402 Payment Required): Please top up your OpenRouter balance, switch your API key, or use an active free model (e.g. nvidia/nemotron-3-super-120b-a12b:free or nex-agi/nex-n2.5-mini:free)."
                else:
                    clean_err = f"{str(prov_label).title()} billing error or credits exhausted (402 Payment Required): Please verify billing for {prov_label} or switch provider/model in the dashboard (e.g. OpenRouter free models or Gemini Flash Lite)."
            elif "401" in err_str or "invalid_api_key" in err_str or "Unauthorized" in err_str or "API_KEY_INVALID" in err_str:
                clean_err = f"Authentication failed: Invalid API key for provider '{prov_label}'. Please update your key in the dashboard."
            elif "API key for provider" in err_str and "is not set" in err_str:
                clean_err = err_str
            elif "RemoteProtocolError" in err_str:
                clean_err = "Server disconnected without sending a response: Network or API connection reset. Please retry."
            elif "INVALID_ARGUMENT" in err_str and "Thinking level" in err_str:
                clean_err = "Thinking level is not supported for this model series. Please disable thinking mode or switch models."
            else:
                clean_err = f"{exc}"

            snapshot.error_summary = clean_err
            snapshot.error_details = tb
            snapshot.current_activity = f"Failed in {failing_agent}: {clean_err}"
            update_stats()

            push_event(
                "error",
                f"Error in {failing_agent}: {clean_err}",
                details=tb,
                agent=failing_agent,
                metadata={"error": clean_err, "agent": failing_agent},
            )

            # Persist failed run to history as well
            save_run_to_history(snapshot, self.get_trace(run_id))


runner_manager = AnalysisExecutionManager()
