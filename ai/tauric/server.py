"""FabRich Tauric AI Service Launcher.

Starts the embedded TauricResearch TradingAgents decision service on localhost.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Add ai/tauric to sys.path so tradingagents, web, and cli resolve cleanly
AI_ROOT = Path(__file__).resolve().parent
REPO_ROOT = AI_ROOT.parent.parent

if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))

# Load .env from FabRich repository root
from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")
load_dotenv(AI_ROOT / ".env")

import uvicorn
from web.backend.main import app

def start_server(host: str = "127.0.0.1", port: int = 8000):
    print(f"Starting FabRich Tauric AI Service on http://{host}:{port}")
    print(f"Hybrid Decision Endpoint: http://{host}:{port}/api/hybrid/decision")
    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == "__main__":
    port = int(os.environ.get("TAURIC_PORT", os.environ.get("PORT", "8000")))
    host = os.environ.get("TAURIC_HOST", "127.0.0.1")
    start_server(host=host, port=port)
