from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from web.backend.services.history import get_run_from_history
from web.backend.services.runner import runner_manager

logger = logging.getLogger("web.backend.websocket")

ws_router = APIRouter()


@ws_router.websocket("/ws/analysis/{run_id}")
async def analysis_websocket_endpoint(websocket: WebSocket, run_id: str):
    """Snapshot-first stream: full persisted state, then live events from seq."""
    await websocket.accept()
    import queue as _q

    snapshot = runner_manager.get_snapshot(run_id)
    if not snapshot:
        await websocket.send_text(
            json.dumps({"activity_type": "error", "title": "Run ID not found"})
        )
        await websocket.close()
        return

    past_trace = runner_manager.get_trace(run_id)
    last_seq = max((e.get("seq", -1) for e in past_trace), default=-1)
    await websocket.send_text(
        json.dumps({
            "activity_type": "initial_state",
            "snapshot": snapshot.model_dump(),
            "trace": past_trace,
        })
    )

    # Thread-safe bridge: worker threads write to a queue.Queue; we poll it here.
    thread_q = runner_manager.subscribe(run_id)
    try:
        while True:
            try:
                event = await asyncio.to_thread(thread_q.get, True, 15.0)
                await websocket.send_text(json.dumps(event))
            except _q.Empty:
                current = runner_manager.get_snapshot(run_id)
                if current:
                    await websocket.send_text(
                        json.dumps({
                            "activity_type": "heartbeat",
                            "snapshot": current.model_dump(),
                            "stats": current.stats.model_dump(),
                            "status": current.status,
                            "progress": current.progress_percent,
                        })
                    )
                    if current.status in ("completed", "failed", "cancelled"):
                        await websocket.close()
                        return
    except WebSocketDisconnect:
        logger.debug("WebSocket client disconnected for run_id %s", run_id)
    except Exception as exc:
        logger.debug("WebSocket exception for %s: %s", run_id, exc)
    finally:
        runner_manager.unsubscribe(run_id, thread_q)
