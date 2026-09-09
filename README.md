# FabRich — Autonomous AI Leveraged Trading Engine

> **Paper Trading & Simulation Engine**: Real market observations, simulated orders and execution. No guaranteed edge. Returns are not proof of skill. High leverage can wipe out simulated collateral. Never connect this project to real-money execution. This is not financial advice.
>
> 🤖 **AI Agent & Auditor Blueprint**: For an exhaustive, ground-truth audit manual detailing every single file, perpetual derivative formula, risk guardrail, fail-closed contract, and diagnostic procedure for AI agents, refer to [**`AI_AGENT_AUDIT_README.md`**](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/AI_AGENT_AUDIT_README.md).

FabRich is a self-contained, autonomous paper-trading platform designed for simulated cryptocurrency and equity derivatives trading. It integrates deterministic quantitative strategies with an embedded **TauricResearch TradingAgents** multi-agent AI research and decision filter layer, rule-based multi-agent risk councils, next-tick order execution, realistic exchange mechanics (perpetual funding, taker/maker fees, quadratic slippage, mark-to-market liquidation), continuous learning and memory persistence, and an interactive real-time web dashboard.

---

## 1. Architecture Overview

FabRich separates quantitative signal generation, AI research filtering, and exchange execution into strictly defined, fail-closed layers:

```mermaid
flowchart TD
  subgraph StratLayer ["1. Deterministic Strategy Layer"]
    MarketData[Market Feeds\nYahoo Finance / Crypto] --> StratGen[Strategies: TSMOM, Donchian, RSI2Dip,\nMomTrend, ORB, IBreakout]
    StratGen --> Candidate[Candidate Trade Intent]
  end

  subgraph AILayer ["2. Embedded Tauric AI Research Filter (ai/tauric/)"]
    Candidate --> AIGate[scripts/v2/ai_gate.mjs\nSHA-256 Deduplication & Async Queue]
    AIGate -->|POST /api/hybrid/decision| TauricServer[Embedded Tauric FastAPI\nport 8000]
    TauricServer --> MultiAgentGraph[TradingAgents Graph:\nAnalysts -> Bull/Bear Debate ->\nTrader -> Risk Debate -> Portfolio]
    MultiAgentGraph --> DecisionVerdict{Model Verdict:\nBuy/Sell vs Hold}
    DecisionVerdict -->|Approved| AIApproved[AI APPROVED]
    DecisionVerdict -->|Rejected / Timeout / Error| AIRejected[AI REJECTED\n(Fail Closed)]
  end

  subgraph RiskLayer ["3. FabRich Risk & Council Layer"]
    AIApproved --> Council[Agent Council:\nAnalyst -> Risk -> Investor]
    Council --> Sizing[Kelly & Volatility Sizing\nLeverage & Wallet Clamping]
    Sizing --> Pending[data/pending.v2.json\nNext-Tick Order Queue]
  end

  subgraph ExecLayer ["4. Execution & Accounting Engine (scripts/v2/engine.mjs)"]
    Pending --> NextTickBarrier[Next-Tick Barrier (t+1)\nFresh Market Observation]
    NextTickBarrier --> Fills[Paper Execution:\nAdverse Fill, Slippage, Fees]
    Fills --> Positions[Position Tracking & Risk Exits:\nLiquidation, Stop, Target, Trail, Time]
    Positions --> PnL[P&L Calculation, Equity Curve, Funding]
  end

  subgraph LearningLayer ["5. Learning, Memory & Visibility"]
    PnL --> Brain[brain.mjs:\nStrategy Kelly Adaptation, Reflog, Lessons]
    PnL --> Dashboard[Next.js Sakura Dashboard\nhttp://localhost:3000 (AI Analysis Tab)]
  end

  AIRejected --> DropTrade[Trade Dropped\nLogged to ai_decisions.v2.jsonl]
```

### Core Authority Separation
- **Tauric AI (`ai/tauric/`):** Acts **exclusively as a non-authoritative decision filter**. It answers one question: *"Does multi-agent research support the proposed trade direction?"* It has **no authority** over leverage caps, order execution, margin sizing, wallet limits, liquidation, or position management.
- **FabRich Engine (`scripts/v2/`):** Retains **100% authoritative ownership** over order generation, sizing, margin calculations, risk checks, order lifecycle, simulated fills, fees, slippage, liquidation, P&L, learning, and persistence.

---

## 2. Trading Pipeline Lifecycle

### Concrete Lifecycle Example (Approved Trade)
1. **Strategy Generation ($t$):** `TSMOM` identifies upward 28-day momentum on `BTC-USD` and creates a candidate `long` intent.
2. **Asynchronous Enqueueing:** `ai_gate.mjs` computes a SHA-256 fingerprint (`symbol:strategy:side:regime:price`) and enqueues the candidate to [`data/ai_pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_pending.v2.json). The 30s engine loop continues uninterrupted.
3. **Tauric AI Deliberation:** The embedded AI service (`http://127.0.0.1:8000/api/hybrid/decision`) dispatches market, sentiment, news, and fundamentals analysts to debate the setup. If the resulting rating is `Buy` or `Overweight`, the candidate is **APPROVED**.
4. **Audit Logging:** The deliberation, thesis, and model metrics are saved to [`data/ai_decisions.v2.jsonl`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_decisions.v2.jsonl).
5. **FabRich Risk Council:** The approved candidate is passed to the rule-based Council:
   - *Analyst Agent:* Checks regime compatibility.
   - *Risk Agent:* Verifies position limit (max 10), crypto cluster limit (max 4 crypto positions), and portfolio drawdown brakes.
   - *Investor Agent:* Verifies quote freshness (<5m) and available collateral.
6. **Position Sizing:** Half-Kelly fraction scaled by current volatility and episode progress calculates margin and leverage (capped per market: 20x US, 12x crypto, 10x IN).
7. **Next-Tick Execution ($t \to t+1$):** Sized order enters [`data/pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/pending.v2.json). It is filled on the **next tick** using fresh price observations, applying taker fees (0.06%) and quadratic slippage.
8. **Position Lifecycle:** Position is monitored every tick for liquidation (mark-to-market EMA), stop-loss, take-profit, trailing stops, and funding payments (at 00:00, 08:00, 16:00 UTC).
9. **Learning & Evolution:** Upon close, trade P&L updates strategy Kelly fractions, win rates, and generational lesson banks in [`data/strategies.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/strategies.v2.json).

### Rejection Case
If the AI graph returns `Hold`, `Underweight`, or `Sell` for a `long` setup, the decision is marked `rejected`. The intent is immediately dropped and no order is placed.

### Failure Case (Fail Closed)
If the AI service experiences a timeout (>10s), network disconnect, missing API credentials, or unparseable response, the gate automatically returns:
```json
{
  "action": "HOLD",
  "rating": "Hold",
  "approved": false,
  "reason": "AI_UNAVAILABLE"
}
```
**Under no circumstances can an AI failure or timeout bypass safety rules or trigger an order.**

---

## 3. Directory Structure

FabRich is a completely consolidated, self-contained single repository. No external folders or parent dependencies are needed:

```text
trading bot/
├── ai/
│   └── tauric/                     # Embedded TauricResearch TradingAgents AI service
│       ├── tradingagents/          # Multi-agent LangGraph workflows & analysts
│       ├── web/backend/            # FastAPI decision backend & routes
│       ├── cli/                    # Model catalog & utilities
│       ├── tests/                  # Pytest integration tests (16 tests)
│       ├── requirements.txt        # Python dependencies
│       ├── server.py               # Standalone FastAPI launcher (port 8000)
│       └── README.md
├── scripts/
│   ├── v2/
│   │   ├── engine.mjs              # Main trading loop (30s continuous cycle)
│   │   ├── ai_gate.mjs             # AI decision client, deduplication, & queue
│   │   ├── strategies.mjs          # 6 deterministic strategy seed generators
│   │   ├── perp.mjs                # Leverage, funding, fees, mark & liquidation math
│   │   ├── sizing.mjs              # Kelly, volatility, & wallet sizing
│   │   ├── agents.mjs              # Rule-based multi-agent risk council
│   │   ├── controls.mjs            # CLI commands (setGoal, restart, etc.)
│   │   ├── brain.mjs               # Statistics, memory, lessons, & evolution
│   │   ├── episode.mjs             # $100 -> $500 episode lifecycle & resets
│   │   ├── world.mjs               # Macro, fear & greed, & news collectors
│   │   ├── store.mjs               # Atomic JSON/JSONL store & V2 paths
│   │   └── init.mjs                # Idempotent state initialization
│   ├── start-all.ps1               # Unified PowerShell launcher
│   ├── stop-all.ps1                # Unified PowerShell stopper & port cleaner
│   ├── start_all.mjs               # Cross-platform Node.js launcher
│   └── stop_all.mjs                # Cross-platform Node.js stopper
├── web/                            # Next.js 16 Sakura Web Dashboard
│   ├── app/
│   │   ├── api/state/route.ts      # Filesystem bridge exposing engine & AI state
│   │   ├── api/ai/route.ts         # Secure backend proxy to Tauric FastAPI
│   │   ├── components/             # React components: DashboardV2, AI Analysis tab
│   │   ├── page.tsx
│   │   └── layout.tsx
│   └── package.json
├── tests/                          # Node.js test suite (70 unit tests)
│   ├── ai_gate.test.mjs            # AI gate contracts & fail-closed tests
│   ├── controls.test.mjs
│   ├── reliability.test.mjs
│   └── ...
├── data/                           # Local runtime state & journals (gitignored)
│   ├── state.v2.json               # Current account, wallet, & positions
│   ├── ai_pending.v2.json          # Active asynchronous AI decision queue
│   ├── ai_decisions.v2.jsonl       # Immutable AI audit ledger
│   ├── heartbeat.v2.json           # Live engine cycle status & timestamp
│   └── ...
├── docs/                           # Architectural & technical specifications
│   ├── TRADINGAGENTS_HYBRID_INTEGRATION.md
│   └── ...
├── .venv/                          # Dedicated local Python virtual environment
├── .env                            # Local secrets & API credentials (gitignored)
├── .env.example                    # Clean variable template (no secrets)
├── config.json                     # System configuration & risk boundaries
├── pytest.ini                      # Python test runner configuration
└── package.json                    # Root scripts & dependencies
```

---

## 4. Environment Variables & Security

Configuration credentials reside in [`.env`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/.env). A template with safe placeholder names is provided in [`.env.example`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/.env.example):

```bash
# Copy template to .env
cp .env.example .env
```

### Key Variables
- `GOOGLE_API_KEY`: Primary LLM provider key for Tauric multi-agent reasoning (Google Gemini).
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`: Optional secondary/fallback LLM providers.
- `PORT`: Next.js web dashboard port (default: `3000`).
- `TAURIC_PORT`: Tauric FastAPI service port (default: `8000`).
- `TAURIC_HOST`: Tauric service bind address (default: `127.0.0.1`).
- `TRADINGAGENTS_HYBRID_TIMEOUT_S`: Maximum per-request timeout in seconds (default: `600`).

### Security Invariants
- **Never commit `.env`**: [`.gitignore`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/.gitignore) excludes `.env`, `.venv/`, `data/`, and `logs/`.
- **Browser Protection**: Frontend client code **never** accesses external LLM credentials directly. All web interactions route through the local Next.js proxy endpoint (`/api/ai`), keeping keys private on the server.

---

## 5. Startup & Operational Commands

### Start All Services
Launches the Tauric AI service (port 8000), FabRich trading engine (30s cycle), and Next.js web dashboard (port 3000):

```powershell
# Using npm (cross-platform)
npm run start:all

# OR using PowerShell directly
.\scripts\start-all.ps1
```

Once started:
- **Web Dashboard:** Open [http://localhost:3000](http://localhost:3000) (Click **AI Analysis** tab `🧠`).
- **AI Service Telemetry:** Open [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).
- **Health Check:** `http://127.0.0.1:8000/api/health`.

### Stop All Services
Cleanly terminates background processes and frees ports 8000 and 3000:

```powershell
# Using npm (cross-platform)
npm run stop:all

# OR using PowerShell directly
.\scripts\stop-all.ps1
```

### Running Individual Services
```powershell
# 1. Tauric AI Service
npm run ai
# OR: .\.venv\Scripts\python.exe ai\tauric\server.py

# 2. FabRich Trading Engine (continuous 30s cycle)
node scripts/v2/engine.mjs

# 3. Single Engine Cycle (run once for testing)
node scripts/v2/engine.mjs --once

# 4. Next.js Web Frontend
npm run web
# OR: cd web && npm run dev
```

---

## 6. Testing & Quality Verification

Run the full verification suites across both JavaScript and Python layers:

```powershell
# Run Node.js engine unit tests (70 tests)
npm test

# Run Tauric Python AI integration tests (16 tests)
npm run test:ai

# Build Next.js frontend production bundle
npm --prefix web run build
```

---

## 7. Interactive Dashboard: AI Analysis View

The web UI includes an **AI Analysis** tab (`🧠`) with live insight into the hybrid reasoning layer:
- **AI Status Banner:** Shows real-time backend health, active LLM model provider, decision latency, and fail-closed state.
- **Queue Pipeline:** Live cards displaying candidates currently in-flight, approved, or rejected.
- **Deep-Dive Drawer:** Detailed multi-agent analyst breakdown (Market, Sentiment, News, Fundamentals) and Bull/Bear research debate transcripts for each candidate.
- **Trade Attribution:** Positions grid and recent fills display AI badges alongside strategy signals (e.g. `Strategy: TSMOM · AI: APPROVED (Buy)`).

---

## 8. Risk Management Guardrails

FabRich enforces multi-tiered, non-bypassable risk controls:
1. **Leverage Clamping:** Hard ceiling per asset class (Crypto 12x, US Equities 20x, Indian Equities 10x). Capped at 5x during underwater survival modes.
2. **Crypto Correlation Cluster:** Maximum of 4 simultaneous open cryptocurrency positions across the entire portfolio to avoid concentrated downside.
3. **Stale Data Protection:** Quotes older than 5 minutes are flagged stale; opening orders on stale quotes are vetoed.
4. **Drawdown Circuit Breakers:** A 10% intraday equity drop triggers immediate defensive position sizing and council vetoes.
5. **Next-Tick Execution Barrier:** All orders are queued to [`data/pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/pending.v2.json) and filled on tick $t+1$ with fresh observations, preventing lookahead bias.
