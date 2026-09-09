from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from dotenv import find_dotenv, load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Load environment variables from .env in repository root or standard paths
dotenv_path = find_dotenv(usecwd=True)
if dotenv_path:
    load_dotenv(dotenv_path)
else:
    # fallback to parent directory .env
    repo_root = Path(__file__).resolve().parent.parent.parent
    root_env = repo_root / ".env"
    if root_env.exists():
        load_dotenv(root_env)

from web.backend.api.routes import router as api_router
from web.backend.api.hybrid_router import router as hybrid_router
from web.backend.api.websocket import ws_router
from web.backend.services.runner import runner_manager

import logging as _logging

_logger = _logging.getLogger("web.backend.main")


app = FastAPI(
    title="TradingAgents AI Research Dashboard API",
    description="Backend API and WebSocket service for TauricResearch TradingAgents",
    version="0.4.0",
)


@app.on_event("startup")
async def _recover_interrupted_jobs() -> None:
    """Crash recovery: resume jobs that have a real checkpoint, fail others."""
    try:
        recovered = runner_manager.recover_interrupted()
        if recovered:
            _logger.info("Recovered %d interrupted job(s): %s", len(recovered), recovered)
    except Exception as exc:
        _logger.warning("Startup recovery failed: %s", exc)

# CORS configuration: explicit origins only (credentials require non-wildcard).
_cors_origins = [o.strip() for o in os.getenv("TRADINGAGENTS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API and WebSocket routes
app.include_router(api_router)
app.include_router(ws_router)
app.include_router(hybrid_router)


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "TradingAgents Web API",
        "google_key_configured": bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")),
    }


# Frontend static files mounting (production mode)
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept /api or /ws calls
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return None
        file_path = frontend_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("web.backend.main:app", host="0.0.0.0", port=port, reload=True)
