"""Persistent job store: SQLite-backed single source of truth for web analyses.

Replaces the previous in-memory-only `active_runs` dict so browser refresh,
backend restart, and reconnects all read the same authoritative state.
Designed so the table maps 1:1 to PostgreSQL later (plain SQL, no ORM magic).
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger("web.backend.store")

_STORE_DIR = Path(os.path.expanduser("~")) / ".tradingagents" / "web_jobs"
_DB_PATH = _STORE_DIR / "jobs.db"

# Valid state transitions for the analysis lifecycle state machine.
TRANSITIONS: dict[str, set[str]] = {
    "created": {"starting", "pending", "cancelled"},
    "pending": {"starting", "running", "failed", "cancelled", "recovering"},
    "starting": {"running", "pending", "failed", "cancelled", "recovering"},
    "running": {"checkpointing", "completed", "failed", "cancelled", "recovering"},
    "checkpointing": {"running", "failed", "cancelled"},
    "recovering": {"running", "failed", "cancelled"},
    "completed": set(),
    "failed": {"starting", "pending"},  # explicit resume/retry only
    "cancelled": {"starting", "pending"},  # explicit restart only
}

TERMINAL = {"completed", "failed", "cancelled"}

_lock = threading.RLock()


def _connect() -> sqlite3.Connection:
    _STORE_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                run_id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                analysis_date TEXT NOT NULL,
                config_json TEXT NOT NULL DEFAULT '{}',
                request_params_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'created',
                current_agent TEXT,
                current_activity TEXT,
                progress_percent INTEGER NOT NULL DEFAULT 0,
                agent_statuses_json TEXT NOT NULL DEFAULT '{}',
                usage_json TEXT NOT NULL DEFAULT '{}',
                reports_json TEXT NOT NULL DEFAULT '{}',
                final_report TEXT,
                trade_signal TEXT,
                error_summary TEXT,
                error_details TEXT,
                failing_agent TEXT,
                wall_time_summary TEXT,
                checkpoint_info TEXT,
                idempotency_key TEXT UNIQUE,
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                last_heartbeat TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                ts TEXT NOT NULL,
                event_json TEXT NOT NULL,
                UNIQUE(run_id, seq)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq)"
        )
        conn.commit()


def _now_iso() -> str:
    import datetime

    return datetime.datetime.now().isoformat()


def create_job(
    run_id: str,
    ticker: str,
    analysis_date: str,
    config: dict[str, Any],
    request_params: dict[str, Any],
    idempotency_key: str | None = None,
    agent_statuses: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Insert a new job. Raises sqlite3.IntegrityError on duplicate idempotency key."""
    now = _now_iso()
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "llm_calls": 0,
        "tool_calls": 0,
        "estimated": False,
        "provider": str(request_params.get("llm_provider", "")),
    }
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO jobs (run_id, ticker, analysis_date, config_json,
                request_params_json, status, agent_statuses_json, usage_json,
                reports_json, idempotency_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'created', ?, ?, '{}', ?, ?, ?)
            """,
            (
                run_id,
                ticker,
                analysis_date,
                json.dumps(config),
                json.dumps(request_params),
                json.dumps(agent_statuses or {}),
                json.dumps(usage),
                idempotency_key,
                now,
                now,
            ),
        )
        conn.commit()
    row = get_job(run_id)
    assert row is not None
    return row


def get_job(run_id: str) -> dict[str, Any] | None:
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute("SELECT * FROM jobs WHERE run_id = ?", (run_id,))
        row = cur.fetchone()
        if not row:
            return None
        return _row_to_job(dict(row))


def _row_to_job(row: dict[str, Any]) -> dict[str, Any]:
    def _j(key: str, default: Any) -> Any:
        try:
            return json.loads(row.get(key) or json.dumps(default))
        except Exception:
            return default

    row["config"] = _j("config_json", {})
    row["request_params"] = _j("request_params_json", {})
    row["agent_statuses"] = _j("agent_statuses_json", {})
    row["usage"] = _j("usage_json", {})
    row["reports"] = _j("reports_json", {})
    return row


def find_by_idempotency(key: str) -> dict[str, Any] | None:
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute("SELECT * FROM jobs WHERE idempotency_key = ?", (key,))
        row = cur.fetchone()
        return _row_to_job(dict(row)) if row else None


def find_running_by_ticker_date(ticker: str, analysis_date: str) -> dict[str, Any] | None:
    """Return a non-terminal job for the same ticker+date (duplicate-click guard)."""
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            """
            SELECT * FROM jobs
            WHERE upper(ticker) = upper(?) AND analysis_date = ?
              AND status NOT IN ('completed','failed','cancelled')
            ORDER BY updated_at DESC LIMIT 1
            """,
            (ticker, analysis_date),
        )
        row = cur.fetchone()
        return _row_to_job(dict(row)) if row else None


def transition(run_id: str, to_status: str, patch: dict[str, Any] | None = None) -> dict[str, Any]:
    """Atomically validate + apply a state transition. Raises ValueError if illegal."""
    init_db()
    now = _now_iso()
    patch = dict(patch or {})
    with _lock, _connect() as conn:
        cur = conn.execute("SELECT * FROM jobs WHERE run_id = ?", (run_id,))
        row = cur.fetchone()
        if not row:
            raise KeyError(run_id)
        current = dict(row)["status"]
        if to_status != current and to_status not in TRANSITIONS.get(current, set()):
            raise ValueError(f"illegal transition {current} -> {to_status}")
        cols: dict[str, Any] = {"status": to_status, "updated_at": now}
        existing_started = dict(row)["started_at"]
        if to_status in ("starting", "running") and not existing_started:
            cols["started_at"] = now
        if to_status in TERMINAL:
            cols["completed_at"] = now
        cols["last_heartbeat"] = now
        for key, val in patch.items():
            if key in (
                "current_agent", "current_activity", "progress_percent",
                "final_report", "trade_signal", "error_summary", "error_details",
                "failing_agent", "wall_time_summary", "checkpoint_info",
                "started_at", "completed_at", "retry_count",
            ):
                cols[key] = val
            elif key in ("agent_statuses", "usage", "reports", "config", "request_params"):
                cols[key + "_json"] = val if isinstance(val, str) else json.dumps(val)
            elif key.endswith("_json"):
                cols[key] = val if isinstance(val, str) else json.dumps(val)
        set_clause = ", ".join(f"{c} = ?" for c in cols)
        conn.execute(
            f"UPDATE jobs SET {set_clause} WHERE run_id = ?", (*cols.values(), run_id)
        )
        conn.commit()
    updated = get_job(run_id)
    assert updated is not None
    return updated


def heartbeat(run_id: str) -> None:
    init_db()
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE jobs SET last_heartbeat = ?, updated_at = ? WHERE run_id = ?",
            (_now_iso(), _now_iso(), run_id),
        )
        conn.commit()


def append_event(run_id: str, event: dict[str, Any]) -> int:
    """Persist a trace event with a monotonic seq; returns seq."""
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) AS m FROM events WHERE run_id = ?",
            (run_id,),
        )
        seq = int(cur.fetchone()["m"]) + 1
        stored = {**event, "seq": seq}
        conn.execute(
            "INSERT INTO events (run_id, seq, ts, event_json) VALUES (?, ?, ?, ?)",
            (run_id, seq, event.get("timestamp") or _now_iso(), json.dumps(stored)),
        )
        conn.commit()
        return seq


def get_events(run_id: str, after_seq: int = -1, limit: int = 5000) -> list[dict[str, Any]]:
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "SELECT event_json FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
            (run_id, after_seq, limit),
        )
        out = []
        for r in cur.fetchall():
            try:
                out.append(json.loads(r["event_json"]))
            except Exception:
                continue
        return out


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        return [_row_to_job(dict(r)) for r in cur.fetchall()]


def list_interrupted() -> list[dict[str, Any]]:
    """Jobs left non-terminal (e.g. backend crashed mid-run) for startup recovery."""
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM jobs WHERE status IN ('starting','running','checkpointing','recovering')"
        )
        return [_row_to_job(dict(r)) for r in cur.fetchall()]


def delete_job(run_id: str) -> bool:
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute("DELETE FROM jobs WHERE run_id = ?", (run_id,))
        conn.execute("DELETE FROM events WHERE run_id = ?", (run_id,))
        conn.commit()
        return (cur.rowcount or 0) > 0


