# TradingAgents x FabRich Hybrid AI Integration Guide

This document describes the architectural integration of the embedded **TauricResearch TradingAgents** system (located under `ai/tauric/`) as an autonomous AI decision and filtering layer inside the consolidated **FabRich** single-repository trading engine.

---

## 1. System Architecture & Boundaries

```mermaid
flowchart TD
    subgraph FabRich ["FabRich Trading Platform (Port 3000 / Daemon)"]
        MD[Market Data Gatherer] --> STRAT[Deterministic Strategies\ntsmom, donchian, rsi2dip, mom_trend, orb, ibreakout]
        STRAT --> RAW[Candidate Trade Intents]
        
        subgraph AIGate ["AI Gate Layer (scripts/v2/ai_gate.mjs)"]
            RAW --> DEDUP{Signal Fingerprint\nDeduplication}
            DEDUP -->|New Signal| AIPEND[(ai_pending.v2.json\nAsynchronous Queue)]
            DEDUP -->|Unchanged Signal| DROP[Skip Duplicate Call]
            AIPEND --> WORKER[Asynchronous Dispatcher\nNon-Blocking Fetch]
        end
        
        AIPEND --> VALID{Valid & Fresh Approval?\nAge <= decisionTtlSeconds}
        VALID -->|Approved & Fresh| COUNCIL[FabRich Agent Council\nAnalyst -> Risk -> Investor]
        VALID -->|Expired / Rejected / Failed| NOPENDING[Reject Intent - Fail Closed]
        
        COUNCIL -->|Vetoed| REJECTED[Log Veto in agents.v2.jsonl]
        COUNCIL -->|Approved| SIZING[FabRich Sizing Engine\nMargin & Affordability]
        SIZING --> PENDING[(pending.v2.json\nNext-Tick Queue)]
        
        PENDING --> NEXTTICK[Next-Tick Execution (t+1)\nFresh Quote & Execution Barrier]
        NEXTTICK --> PAPER[Paper Execution\nFills, Slippage, Fees, Liquidation]
        PAPER --> PL[P&L, Episodes, Strategies.json Learning]
        
        DASH[FabRich Next.js Dashboard\nOverview, Positions, Episodes, AI Analysis]
    end

    subgraph Tauric ["TauricResearch TradingAgents (Port 8000)"]
        ENDPOINT["POST /api/hybrid/decision"]
        PIPELINE["Full Graph Pipeline:
        - Market / Sentiment / News / Fundamentals Analysts
        - Bull / Bear Debate
        - Research Manager
        - Trader Proposal
        - Aggressive / Conservative Risk Debate
        - Portfolio Manager Decision"]
        ENDPOINT --> PIPELINE
    end

    WORKER -->|HTTP POST JSON| ENDPOINT
    ENDPOINT -->|HybridDecision JSON| WORKER
    WORKER --> AILOG[(ai_decisions.v2.jsonl\nAudit Trail)]
    AILOG --> DASH
    PL --> DASH
```

### Core Authority Separation
- **FabRich (The Execution Authority):** Retains 100% authoritative ownership over market data ingestion, deterministic strategy signals, order sizing, margin calculations, leverage clamping, stale-data protection, liquidation math, execution fills, fees, slippage, and P&L accounting.
- **TradingAgents (The AI Filter Layer):** Acts purely as an additive, non-authoritative research gate. It evaluates proposed candidate trades and returns `APPROVE` or `REJECT`. It cannot execute orders, modify wallet balance, create unprompted symbols, or override risk rules.

---

## 2. Order Lifecycle & Data Flow

1. **Deterministic Candidate Generation:**
   On cycle tick $t$, FabRich's deterministic strategies (`runStrategies`) generate raw trade intents (e.g. `TSMOM Long BTC-USD`).
2. **Fingerprinting & Deduplication:**
   `fingerprintCandidate` computes a SHA-256 hash of `symbol:strategy_id:side:regime:roundedPrice`. If an identical request is already pending or has an unexpired cached decision, redundant API calls are skipped.
3. **Asynchronous Enqueueing:**
   The candidate is stored in [`data/ai_pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_pending.v2.json) with status `"pending"`. The main 30-second engine cycle is **never blocked**.
4. **Background AI Worker:**
   `drainAndProcessAiQueue` invokes `POST http://127.0.0.1:8000/api/hybrid/decision` in the background. Responses are parsed, validated, and appended to [`data/ai_decisions.v2.jsonl`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_decisions.v2.jsonl).
5. **Fail-Closed Evaluation & TTL Check:**
   On cycle ticks, `getValidApprovedIntents` retrieves approved candidates. If the decision age exceeds `v2.ai.decisionTtlSeconds` (default 300s), the candidate is marked `"expired"` and dropped. If TradingAgents timed out or crashed, it defaults to `"AI_UNAVAILABLE"`, dropping the trade.
6. **FabRich Multi-Agent Council:**
   Approved candidates must still pass the rule-based Council:
   - **Analyst Agent:** Regime and macro context timing check.
   - **Risk Agent:** Enforces maximum concurrent positions (10), 4-asset crypto cluster limit, and 10% drawdown brake.
   - **Investor Agent:** Validates quote freshness (<5m) and wallet affordability.
7. **Next-Tick ($t \to t+1$) Barrier:**
   Surviving orders enter `data/pending.v2.json` and are executed only on the **subsequent** tick using fresh market quotes.

---

## 3. REST API Contract (`TA_INTEGRATION.md`)

### Endpoint
```http
POST http://127.0.0.1:8000/api/hybrid/decision
Content-Type: application/json
```

### Request Payload
```json
{
  "ticker": "BTC-USD",
  "trade_date": "2026-09-09",
  "proposed_side": "long",
  "asset_type": "crypto",
  "strategy_id": "tsmom",
  "setup_tag": "momentum",
  "entry_price": 79200.0,
  "stop_price": 75240.0,
  "target_price": 87120.0,
  "trading_regime": "broad_up",
  "instrument_context": "FabRich regime=broad_up"
}
```

### Response Payload (HTTP 200)
```json
{
  "ticker": "BTC-USD",
  "trade_date": "2026-09-09",
  "action": "BUY",
  "rating": "Buy",
  "approved": true,
  "thesis": "Strong institutional momentum supported by on-chain volume continuation.",
  "entry_price": 79200.0,
  "stop_loss": 75240.0,
  "price_target": 87120.0,
  "position_sizing": null,
  "source": "TradingAgents",
  "generated_at": "2026-09-09T18:00:00Z",
  "model_provider": "google",
  "model_name": "gemini-2.5-flash",
  "fabrich_strategy_id": "tsmom",
  "fabrich_setup_tag": "momentum",
  "reason": null
}
```

### Direction & Approval Mapping
| Proposed Side | Model Rating | Approved? |
| :--- | :--- | :--- |
| **`long`** | `Buy` \| `Overweight` | **`true`** |
| **`long`** | `Hold` \| `Underweight` \| `Sell` | **`false`** |
| **`short`** | `Sell` \| `Underweight` | **`true`** |
| **`short`** | `Hold` \| `Overweight` \| `Buy` | **`false`** |

---

## 4. Failure Semantics (Fail-Closed)

On **any** failure — including network disconnects, HTTP errors, request timeouts (>10s), missing API keys, or malformed payloads — the AI gate evaluates to:
```json
{
  "action": "HOLD",
  "rating": "Hold",
  "approved": false,
  "reason": "AI_UNAVAILABLE"
}
```
**Under no circumstances can an AI failure become an automatic trade approval.**

---

## 5. Configuration (`config.json`)

```json
"v2": {
  "ai": {
    "enabled": true,
    "endpoint": "http://127.0.0.1:8000/api/hybrid/decision",
    "tradingAgentsBaseUrl": "http://127.0.0.1:8000",
    "requestTimeoutMs": 10000,
    "decisionTtlSeconds": 300,
    "pollIntervalMs": 5000
  }
}
```

- `enabled` (`boolean`): Master switch for the AI decision gate. When `false`, the engine falls back to deterministic strategy signals.
- `endpoint` (`string`): HTTP endpoint for `POST /api/hybrid/decision`.
- `requestTimeoutMs` (`integer`): HTTP request timeout (default 10,000ms).
- `decisionTtlSeconds` (`integer`): Maximum validity window for an AI approval before expiration (default 300s / 5 minutes).

---

## 6. Persisted Ledger & Audit Files

1. **[`data/ai_pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_pending.v2.json):**
   Active asynchronous queue holding requests with status: `pending`, `approved`, `rejected`, `expired`, `failed`, or `consumed`.
2. **[`data/ai_decisions.v2.jsonl`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_decisions.v2.jsonl):**
   Immutable historical audit ledger storing every AI deliberation:
   `request_id`, `trade_id`, `symbol`, `strategy_id`, `setup_tag`, `side`, `decision`, `rating`, `thesis`, `entry_price`, `stop_loss`, `target`, `generated_at`, `decision_age_ms`, `trading_regime`, `provider`, `model`, `error`.

---

## 7. Frontend Integration

FabRich remains the unified single frontend (`web/` Next.js dashboard):
1. **Dedicated AI Analysis Tab:**
   Added `{ id: "ai", label: "AI Analysis", icon: "🧠" }` to the navigation sidebar and mobile menu.
   - **Queue View:** Real-time table of pending candidates with status badges.
   - **Deep Dive Card:** Visualizes TradingAgents' Market, Sentiment, News, and Fundamentals analysts, Bull/Bear research debate, and Risk debate.
   - **Telemetry:** Shows model provider (`google`), engine (`gemini-2.5-flash`), decision latency, and fail-closed status.
   - **Decision Ledger:** Full historical table of all persisted AI decisions.
2. **Trade-Level Attribution:**
   Both the **Positions** grid and **Recent Fills** list display AI tags for every trade:
   - `Strategy: TSMOM`
   - `Signal: LONG`
   - `AI: APPROVED · Buy`
   - `AI Thesis: ...`
   - `Risk Council: APPROVED`

---

## 8. Embedded Local Startup Sequence

TauricResearch TradingAgents is embedded directly under `ai/tauric/`. All services launch from within the FabRich repository:

### Option A: Start All Services Concurrently (Recommended)
```powershell
# From FabRich root
npm run start:all
# OR:
.\scripts\start-all.ps1
```
This starts:
1. **Tauric AI Service:** `http://127.0.0.1:8000` (FastAPI backend)
2. **FabRich Engine:** 30-second continuous paper-trading loop
3. **Web Dashboard:** `http://localhost:3000` (Next.js frontend)

### Option B: Run Services Individually
```powershell
# Terminal 1: Tauric AI Decision Service
npm run ai
# (or .\.venv\Scripts\python.exe ai\tauric\server.py)

# Terminal 2: FabRich Trading Engine
node scripts/v2/engine.mjs

# Terminal 3: FabRich Next.js Web Dashboard
npm run web
# (or cd web && npm run dev)
```

To stop all background services cleanly:
```powershell
npm run stop:all
# OR:
.\scripts\stop-all.ps1
```

---

## 9. Verification & Test Results

The integrated system is validated with two complementary test suites:

```powershell
# 1. FabRich Node.js Unit Suite (70 tests including ai_gate.test.mjs)
npm test

# 2. Tauric Python Integration Suite (16 tests in ai/tauric/tests)
npm run test:ai
```

### Test Coverage (12 / 12 Passing)
- `1. buildHybridRequest`: Formats exact `TA_INTEGRATION.md` payload.
- `2. parseAndValidateDecision`: Direction mapping (`long` + `Buy`/`Overweight` approved; `short` + `Sell`/`Underweight` approved; all others rejected).
- `3. AI failure/timeout`: Network failure, abort timeout, and HTTP 500 error fail closed with `approved=false, reason=AI_UNAVAILABLE`.
- `4. Malformed output`: Null, empty, or unparseable ratings fail closed.
- `5. Decision expiration`: Approvals older than `decisionTtlSeconds` are marked expired and blocked.
- `6. Deduplication`: Duplicate candidate requests with identical fingerprints are rejected.
- `7. Risk Council preservation`: AI approvals cannot bypass 4-asset crypto cluster protection.
- `8. Position limits`: AI approvals cannot bypass maximum position cap (10).
- `9. Leverage cap`: AI approvals cannot bypass account leverage cap or survival mode 5x limit.
- `10. Stale quote protection`: AI approvals cannot bypass stale quote verification (<5m).
- `11. End-to-end asynchronous flow`: Raw intent $\to$ AI approve $\to$ Council approve $\to$ pending queue.
- `12. Execution math`: Existing fee, slippage, mark price, and P&L math remain 100% bit-exact.

### Full Suite Status
**70 / 70 tests passing green across the entire repository.**
