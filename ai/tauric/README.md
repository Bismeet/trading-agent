# Embedded TauricResearch TradingAgents Service

This folder contains the self-contained, embedded **TauricResearch TradingAgents** AI research and decision service for the FabRich trading bot.

## Architecture

- **`tradingagents/`**: Core multi-agent reasoning graph (Analysts, Bull/Bear debate, Research Manager, Trader proposal, Risk debate, Portfolio decision).
- **`web/backend/`**: FastAPI service hosting the hybrid decision endpoint (`POST /api/hybrid/decision`) and telemetry routes.
- **`cli/`**: Provider catalogs and utility functions.
- **`tests/`**: Integration tests verifying hybrid decision contract and direction mapping.
- **`server.py`**: Local launcher for the FastAPI backend.
- **`requirements.txt`**: Python dependencies for the AI service.

## Running the Service

Using the FabRich local virtual environment:

```powershell
# From FabRich root
.\.venv\Scripts\python.exe ai\tauric\server.py
```

The service will listen on `http://127.0.0.1:8000`.
API documentation is accessible at `http://127.0.0.1:8000/docs`.

## Integration Contract

- **Endpoint:** `POST /api/hybrid/decision`
- **Direction Mapping:**
  - Long + Buy / Overweight -> Approved
  - Long + Hold / Underweight / Sell -> Rejected
  - Short + Sell / Underweight -> Approved
  - Short + Hold / Overweight / Buy -> Rejected
- **Fail-Closed:** Any runtime exception, timeout, or missing key returns `approved: false` with `reason: "AI_UNAVAILABLE"`.
