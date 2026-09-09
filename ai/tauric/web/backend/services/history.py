from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from web.backend.schemas import AnalysisRunSnapshot

_HISTORY_DIR = Path(os.path.expanduser("~")) / ".tradingagents" / "web_history" / "runs"


def _ensure_history_dir() -> Path:
    _HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    return _HISTORY_DIR


def save_run_to_history(snapshot: AnalysisRunSnapshot, trace_events: list[dict[str, Any]] | None = None) -> None:
    """Save an analysis run snapshot and its trace events to persistent history."""
    directory = _ensure_history_dir()
    filepath = directory / f"{snapshot.run_id}.json"
    data = {
        "snapshot": snapshot.model_dump(),
        "trace": trace_events or [],
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_run_from_history(run_id: str) -> dict[str, Any] | None:
    """Load a run from persistent history by run_id."""
    directory = _ensure_history_dir()
    filepath = directory / f"{run_id}.json"
    if not filepath.exists():
        return None
    try:
        with open(filepath, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def list_history(limit: int = 50) -> list[dict[str, Any]]:
    """List recent runs from history ordered by started_at descending."""
    directory = _ensure_history_dir()
    runs = []
    for filepath in directory.glob("*.json"):
        try:
            with open(filepath, encoding="utf-8") as f:
                item = json.load(f)
                snapshot = item.get("snapshot", {})
                runs.append({
                    "run_id": snapshot.get("run_id"),
                    "ticker": snapshot.get("ticker"),
                    "analysis_date": snapshot.get("analysis_date"),
                    "status": snapshot.get("status"),
                    "trade_signal": snapshot.get("trade_signal"),
                    "model": snapshot.get("request_params", {}).get("deep_think_llm"),
                    "provider": snapshot.get("request_params", {}).get("llm_provider"),
                    "research_depth": snapshot.get("request_params", {}).get("research_depth"),
                    "started_at": snapshot.get("started_at"),
                    "completed_at": snapshot.get("completed_at"),
                    "stats": snapshot.get("stats", {}),
                    "error_summary": snapshot.get("error_summary"),
                })
        except Exception:
            continue

    # Sort newest first
    runs.sort(key=lambda r: r.get("started_at") or "", reverse=True)
    return runs[:limit]


def delete_run_from_history(run_id: str) -> bool:
    """Delete a run from persistent history."""
    directory = _ensure_history_dir()
    filepath = directory / f"{run_id}.json"
    if filepath.exists():
        filepath.unlink()
        return True
    return False
