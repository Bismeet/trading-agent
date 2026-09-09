"""LangGraph checkpoint support for resumable analysis runs.

Per-ticker SQLite databases so concurrent tickers don't contend.
"""

from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

from tradingagents.dataflows.utils import safe_ticker_component


def _db_path(data_dir: str | Path, ticker: str) -> Path:
    """Return the SQLite checkpoint DB path for a ticker."""
    # Reject ticker values that would escape the checkpoints directory.
    safe = safe_ticker_component(ticker).upper()
    p = Path(data_dir) / "checkpoints"
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{safe}.db"


def thread_id(ticker: str, date: str, signature: str = "") -> str:
    """Deterministic thread ID for a ticker+date pair.

    ``signature`` folds in graph-shape-affecting run choices so a resume under a
    different graph can't reuse this checkpoint (#1089); omitting it keeps the
    legacy ID.
    """
    base = f"{ticker.upper()}:{date}"
    if signature:
        base = f"{base}:{signature}"
    return hashlib.sha256(base.encode()).hexdigest()[:16]


@contextmanager
def get_checkpointer(data_dir: str | Path, ticker: str) -> Generator[SqliteSaver, None, None]:
    """Context manager yielding a SqliteSaver backed by a per-ticker DB."""
    db = _db_path(data_dir, ticker)
    conn = sqlite3.connect(str(db), check_same_thread=False)
    try:
        saver = SqliteSaver(conn)
        saver.setup()
        yield saver
    finally:
        conn.close()


def has_checkpoint(data_dir: str | Path, ticker: str, date: str, signature: str = "") -> bool:
    """Check whether a resumable checkpoint exists for ticker+date."""
    return checkpoint_step(data_dir, ticker, date, signature) is not None


def checkpoint_step(data_dir: str | Path, ticker: str, date: str, signature: str = "") -> int | None:
    """Return the step number of the latest checkpoint, or None if none exists."""
    db = _db_path(data_dir, ticker)
    if not db.exists():
        return None
    tid = thread_id(ticker, date, signature)
    with get_checkpointer(data_dir, ticker) as saver:
        config = {"configurable": {"thread_id": tid}}
        cp = saver.get_tuple(config)
        if cp is None:
            return None
        return cp.metadata.get("step")


def clear_all_checkpoints(data_dir: str | Path) -> int:
    """Remove all checkpoint DBs. Returns number of files deleted."""
    cp_dir = Path(data_dir) / "checkpoints"
    if not cp_dir.exists():
        return 0
    dbs = list(cp_dir.glob("*.db"))
    for db in dbs:
        db.unlink()
    return len(dbs)


def save_run_metadata(
    data_dir: str | Path,
    ticker: str,
    date: str,
    signature: str,
    metadata: dict,
) -> None:
    """Save auxiliary run metadata (stats, completed reports, agent statuses) into the checkpoint DB."""
    import datetime
    import json

    db = _db_path(data_dir, ticker)
    tid = thread_id(ticker, date, signature)
    conn = sqlite3.connect(str(db))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS run_metadata (
                thread_id TEXT PRIMARY KEY,
                metadata_json TEXT,
                updated_at TEXT
            )
            """
        )
        now_str = datetime.datetime.now().isoformat()
        conn.execute(
            """
            INSERT OR REPLACE INTO run_metadata (thread_id, metadata_json, updated_at)
            VALUES (?, ?, ?)
            """,
            (tid, json.dumps(metadata), now_str),
        )
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def load_run_metadata(
    data_dir: str | Path,
    ticker: str,
    date: str,
    signature: str = "",
) -> dict | None:
    """Load auxiliary run metadata from the checkpoint DB if present."""
    import json

    db = _db_path(data_dir, ticker)
    if not db.exists():
        return None
    tid = thread_id(ticker, date, signature)
    conn = sqlite3.connect(str(db))
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT metadata_json FROM run_metadata WHERE thread_id = ?",
            (tid,),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return json.loads(row[0])
        return None
    except Exception:
        return None
    finally:
        conn.close()


def clear_checkpoint(data_dir: str | Path, ticker: str, date: str, signature: str = "") -> None:
    """Remove checkpoint for a specific ticker+date by deleting the thread's rows."""
    db = _db_path(data_dir, ticker)
    if not db.exists():
        return
    tid = thread_id(ticker, date, signature)
    conn = sqlite3.connect(str(db))
    try:
        for table in ("writes", "checkpoints", "run_metadata"):
            try:
                conn.execute(f"DELETE FROM {table} WHERE thread_id = ?", (tid,))
            except sqlite3.OperationalError:
                # Table may not exist yet (e.g. run_metadata on a fresh DB).
                # Don't let one missing table abort the whole clear: the other
                # DELETEs must still be committed below.
                continue
        conn.commit()
    except sqlite3.OperationalError:
        pass
    finally:
        conn.close()

