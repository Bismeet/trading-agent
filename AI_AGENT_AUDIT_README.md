# FabRich AI Agent Master Audit Manual & Codebase Blueprint

> **Notice for Auditing AI Agents**: This document is the definitive, ground-truth technical audit specification for the entire **FabRich** trading engine codebase. When auditing, debugging, or enhancing this system, treat this document as the primary architectural reference. **Do not deviate from the invariants, authority boundaries, or fail-closed contracts detailed herein.**

---

## 1. System Identity & Core Philosophy

FabRich is a self-contained, autonomous paper-trading platform designed for simulated cryptocurrency and equity perpetual derivatives. It operates in a local flat-file architecture (Node.js ESM + Python 3.12 FastAPI + Next.js 16) with **no external database requirements**.

### The Core Boundary Rule (Non-Negotiable)
```
[Deterministic Quantitative Strategies]
                 ↓
      (Propose Trade Candidates)
                 ↓
  [Embedded Tauric AI Research Filter]
                 ↓
  (Non-Authoritative Advisory Verdict: APPROVE / REJECT)
                 ↓
     [FabRich Multi-Agent Risk Council]
                 ↓
   (Supreme Authority: Leverage Caps, Cluster Limits, Sizing)
                 ↓
    [Next-Tick Paper Execution Engine]
                 ↓
      [Continuous Learning & Memory]
```

1. **Deterministic Strategies Propose**: Quantitative mathematical rules (e.g. 28-day momentum, Donchian channel breakouts, RSI-2 oversold dips) generate raw trade intents ("Candidates").
2. **AI Filters (Advisory Only)**: The embedded TauricResearch TradingAgents service runs multi-agent deliberation (Market, Sentiment, News, Fundamentals analysts, Bull/Bear debate, Risk deliberation). It answers **only one question**: *"Does research support this proposed trade direction?"* It has **zero authority** over position sizing, leverage, order placement, or wallet balances.
3. **Risk Council Governs**: The rule-based FabRich Risk Council (Analyst, Risk, Investor agents) checks hard risk constraints (max 10 positions, max 4 crypto cluster, max leverage, stale quotes, portfolio drawdowns) and has **absolute veto power**.
4. **Execution Is Delayed & Realistic**: Orders enter a pending queue and execute on the **next tick ($t+1$)** with fresh price observations, quadratic adverse slippage, 0.06% taker fees, and perpetual funding costs.
5. **Fail-Closed Security**: If the AI service is unreachable, times out (>10s), returns a 401/500 error, or returns an unparseable response, the candidate **must be rejected** (`approved = false`, `reason = "AI_UNAVAILABLE"`). It **never fails open**.

---

## 2. Repository Layout & File Manifest

The repository is structured into three integrated subsystems:
- **`scripts/v2/`**: Core JavaScript/Node.js trading engine, perpetual math, risk council, and state management.
- **`ai/tauric/`**: Embedded Python multi-agent research backend (FastAPI on port 8000).
- **`web/`**: Next.js 16 real-time operator dashboard (React 19 on port 3000).
- **`data/`**: Runtime persistent storage (flat JSON and append-only JSONL files).

```
trading bot/
├── ai/
│   └── tauric/                             # Embedded AI Decision Service
│       ├── tradingagents/                  # Multi-agent LangGraph workflows
│       │   ├── agents/                     # Specialist analysts (market, news, social, fundamentals)
│       │   ├── graph/                      # TradingAgentsGraph orchestration & propagation
│       │   ├── llm_clients/                # Provider adapters (Meta, Google, OpenAI, Anthropic, etc.)
│       │   ├── services/                   # hybrid_decision & decision_extractor
│       │   └── default_config.py           # Provider fallbacks & config overrides
│       ├── web/backend/                    # FastAPI HTTP / WebSocket Server
│       │   ├── api/
│       │   │   ├── routes.py               # Preferences, API keys, models catalog, test-connection
│       │   │   ├── hybrid_router.py        # POST /api/hybrid/decision endpoint
│       │   │   └── websocket.py            # Streaming deliberation logs
│       │   ├── services/runner.py          # Background run manager & crash recovery
│       │   └── main.py                     # FastAPI app bootstrap & CORS
│       ├── server.py                       # Standalone launcher (port 8000)
│       ├── requirements.txt                # Python dependencies
│       └── tests/                          # Pytest suite (23 integration tests)
├── scripts/
│   ├── v2/                                 # FabRich Engine V2
│   │   ├── engine.mjs                      # Main 30-second continuous cycle loop
│   │   ├── ai_gate.mjs                     # Asynchronous AI queue & fail-closed client
│   │   ├── context_builder.mjs             # Internal state context aggregator for AI prompts
│   │   ├── strategies.mjs                  # 6 algorithmic strategy signal generators
│   │   ├── perp.mjs                        # Leverage, liquidation, fees, slippage, & funding math
│   │   ├── sizing.mjs                      # Half-Kelly, volatility scaling, & wallet clamping
│   │   ├── agents.mjs                      # Rule-based Risk Council (Analyst, Risk, Investor)
│   │   ├── controls.mjs                    # Command queue consumer (setGoal, restart, etc.)
│   │   ├── brain.mjs                       # Performance reflection, Kelly adaptation, lessons bank
│   │   ├── episode.mjs                     # Episode lifecycle ($100 → $500 target, 72h max)
│   │   ├── world.mjs                       # Macro drivers, fear & greed index, regime classification
│   │   ├── store.mjs                       # Atomic JSON & JSONL flat-file persistence
│   │   └── init.mjs                        # Idempotent state initialization
│   ├── start-all.ps1                       # Unified daemon launcher (Windows PowerShell)
│   ├── stop-all.ps1                        # Unified daemon terminator (ports 8000 & 3000)
│   ├── test_run.mjs                        # Instant single-cycle test verification script
│   └── lib.mjs                             # Math helpers: SMA, EMA, RSI, Kurtosis, Skewness
├── web/                                    # Next.js 16 Sakura Operator Dashboard
│   ├── app/
│   │   ├── api/state/route.ts              # Filesystem bridge to data/ directory
│   │   ├── api/ai/route.ts                 # Proxy to Tauric FastAPI with server-side key security
│   │   ├── components/
│   │   │   ├── DashboardV2.tsx             # Main container & tab orchestrator
│   │   │   ├── ai/AISettingsCard.tsx       # AI Provider, Model, API Key card & test button
│   │   │   ├── ai/AIPipelineFlow.tsx       # Candidate pipeline visualizer (Candidates, Approved, Rejected)
│   │   │   ├── ai/AIDecisionLedger.tsx     # Historical AI decisions audit table
│   │   │   ├── layout/TopHeader.tsx        # System liveness & 30s cycle countdown
│   │   │   └── tabs/                       # 9 Operator Views (Overview, Positions, AI Analysis, etc.)
│   │   ├── page.tsx
│   │   └── layout.tsx
│   └── package.json
├── data/                                   # Local runtime state (flat-file database, gitignored)
│   ├── state.v2.json                       # Current wallet balance, equity, open positions, regime
│   ├── signals.v2.json                     # Latest cycle strategy signals
│   ├── heartbeat.v2.json                   # Engine liveness heartbeat (<90s = alive)
│   ├── ai_pending.v2.json                  # Active in-flight AI evaluation queue
│   ├── ai_decisions.v2.jsonl               # Append-only ledger of all AI evaluations
│   ├── trades.v2.jsonl                     # Append-only journal of all executed fills and exits
│   ├── equity.v2.jsonl                     # Downsampled historical equity curve points
│   ├── episodes.jsonl                      # Completed episode summaries
│   ├── lessons.v2.jsonl                    # Evolved lessons and loss post-mortems
│   └── commands.v2.json                    # Inbound operator command queue
├── tests/                                  # Node.js engine unit test suite (78 tests)
│   ├── ai_gate.test.mjs                    # Fail-closed AI gate contracts
│   ├── context_builder.test.mjs            # AI context payload structure & determinism
│   ├── perp.test.mjs                       # Liquidation, slippage, and fee formulas
│   └── ...
├── .env                                    # Local secrets (API keys, ports) — NEVER COMMIT
├── config.json                             # System configuration & risk boundaries
├── pytest.ini                              # Pytest runner configuration
└── package.json                            # Root scripts & task commands
```

---

## 3. Subsystem Breakdown & Detailed Roles

### 3.1 The Engine Loop (`scripts/v2/engine.mjs`)
- **Cycle Interval**: Executes continuously on a **30-second cadence**.
- **Tick Sequence**:
  1. `applyQueuedCommands()`: Reads [`data/commands.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/commands.v2.json) (e.g. `setGoal`, `restart`, `closePosition`).
  2. `pollAiDecisions()`: Checks [`data/ai_pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_pending.v2.json) for completed async AI deliberations; moves resolved verdicts to [`data/ai_decisions.v2.jsonl`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_decisions.v2.jsonl).
  3. `executePendingOrders()`: Fills orders queued during tick $t-1$ using fresh tick $t$ quotes, accounting for slippage and taker fees.
  4. `evaluatePositions()`: Checks open positions against mark prices for stop-loss, take-profit, trailing stop, liquidation, or 8-hour funding rate payments.
  5. `generateSignals()`: Dispatches the 6 quantitative strategies across monitored symbols (`BTC-USD`, `ETH-USD`, `SOL-USD`, `XRP-USD`, etc.).
  6. `enqueueAiCandidates()`: Packages new signals as Candidates and enqueues them for asynchronous AI research.
  7. `runCouncilOnApproved()`: Passes AI-approved candidates to the Risk Council for final leverage and sizing verification.
  8. `checkpointState()`: Atomically writes [`data/state.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/state.v2.json) and updates [`data/heartbeat.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/heartbeat.v2.json).

### 3.2 Quantitative Strategies (`scripts/v2/strategies.mjs`)
The 6 seed strategies start with status `"candidate"`, $n=0$, $\text{expectancy\_R}=0$, $\text{win\_rate}=0$, $\text{kelly}=0.12$:
1. **`tsmom`** (Time-Series Momentum): 28-day return momentum ($|r_{28}| > 0.03$) filtered by the 200-day SMA. Base leverage: 12x. Stop: 5%, Target: 10%.
2. **`donchian`** (Donchian Breakout): 20-day high breakout / 20-day low breakdown. Base leverage: 12x. Stop: 5%, Target: 8%. Exits on 10-day channel break.
3. **`rsi2dip`** (Connors RSI-2 Dip): 2-period Wilder RSI dip (<10 long, >90 short) aligned with the 200-day SMA. Base leverage: 10x. Stop: 5%, Target: 6%.
4. **`mom_trend`** (Momentum Trend): Fast EMA (12) over Slow EMA (26) with RSI filter (<78). Base leverage: 10x. Stop: 5%, Target: 8%.
5. **`orb`** (Opening Range Breakout): First 30-minute US equity session range breakout. Base leverage: 5x. Stop: 1.6%, Target: 2.8%.
6. **`ibreakout`** (Intraday 15m Breakout): 12-hour (48-bar) 15-minute channel breakout for crypto volatility. Base leverage: 15x. Stop: 1.5%, Target: 8%.

### 3.3 The AI Decision Gate (`scripts/v2/ai_gate.mjs`)
- **Deduplication**: Computes a SHA-256 fingerprint (`symbol:strategy:side:regime:rounded_price`) so duplicate signals in adjacent cycles do not re-trigger expensive AI queries.
- **Async Execution**: AI evaluation is non-blocking. Candidate trades sit in [`data/ai_pending.v2.json`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/ai_pending.v2.json) while the 30-second engine loop continues.
- **TTL (Time-To-Live)**: AI decisions have a strict **300-second (5-minute) TTL**. If an order is not filled within 5 minutes, it is dropped as expired.
- **Strict Fail-Closed Contract**:
  ```javascript
  if (!res.ok || isTimeout || parseError) {
    return {
      action: "HOLD",
      rating: "Hold",
      approved: false,
      reason: "AI_UNAVAILABLE",
      thesis: "TradingAgents AI pipeline unavailable"
    };
  }
  ```

### 3.4 The AI Context Aggregator (`scripts/v2/context_builder.mjs`)
Before sending a candidate to Tauric AI, FabRich builds a deterministic context snapshot containing:
- **Strategy Metrics**: Historical win rate, profit factor, Kelly factor, Deflated Sharpe Ratio (DSR), expectancy ($R$).
- **Lessons Bank**: Top relevant historical lessons from [`data/lessons.v2.jsonl`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/lessons.v2.jsonl) filtered by strategy, symbol, and current regime.
- **Recent Trades**: Win/loss record, total realized PnL, and last 3 fills for the symbol.
- **Current Positions**: Open position count, gross leverage, margin utilization, and crypto cluster count.
- **World Model**: Current macro regime, Fear & Greed index (crypto and equities), funding rate, and VIX.
- **Recent AI Decisions**: Approvals vs rejections count across recent cycles.

### 3.5 Embedded TauricResearch TradingAgents (`ai/tauric/`)
- **`hybrid_router.py`**: Mounts `POST /api/hybrid/decision`. Formats FabRich context into prompt sections, invokes `TradingAgentsGraph.propagate()`, and extracts the final rating:
  - **`Buy` / `Overweight`** $\to$ `approved: true` (for `long` intent).
  - **`Sell` / `Underweight`** $\to$ `approved: true` (for `short` intent).
  - **`Hold` / Contradictory rating** $\to$ `approved: false` (rejected).
- **Supported Providers**: 12 providers managed in `openai_client.py` and `routes.py`:
  - `meta` (Meta Muse Spark models via `https://api.meta.ai/v1`)
  - `google` (Gemini 2.5 Flash / Flash Lite)
  - `openai` (GPT-4o, o1, o3-mini)
  - `anthropic` (Claude 3.7 / 3.5 Sonnet)
  - `groq` (Llama 3.3 70B, DeepSeek R1 Distill)
  - `deepseek` (DeepSeek Chat V3, DeepSeek Reasoner R1)
  - `openrouter`, `kimi`, `nvidia`, `mistral`, `qwen`, `xai`

### 3.6 Perpetual Derivatives Mathematics (`scripts/v2/perp.mjs`)
- **Initial Margin ($M$)**:
  $$\text{Margin} = \frac{\text{Quantity} \times \text{Entry Price}}{\text{Leverage}}$$
- **Maintenance Margin ($MM$)**:
  $$MM = \text{Position Notional} \times 0.03 \quad (3\% \text{ maintenance requirement})$$
- **Mark Price**:
  Smoothed EMA of quotes ($0.2$ weight fresh quote, $0.8$ prior EMA) to prevent liquidation wick manipulation.
- **Liquidation Price ($P_{\text{liq}}$)**:
  - For Longs: $P_{\text{liq}} = \text{Entry} \times \left(1 - \frac{1}{\text{Leverage}} + 0.03\right)$
  - For Shorts: $P_{\text{liq}} = \text{Entry} \times \left(1 + \frac{1}{\text{Leverage}} - 0.03\right)$
- **Fee Structure**:
  - Taker Fee: $0.06\%$ ($0.0006$) of gross position notional on open and close.
  - Maker Fee: $0.02\%$ ($0.0002$).
- **Quadratic Adverse Slippage**:
  $$\text{Slippage} = \text{Quote Price} \times \left(\text{Base Spread} + \text{Impact} \times \left(\frac{\text{Notional}}{\text{Liquidity Depth}}\right)^2\right)$$
- **Funding Payments**:
  Accrues every 8 hours (00:00, 08:00, 16:00 UTC). Longs pay shorts when funding rate is positive; shorts pay longs when funding rate is negative.

### 3.7 Multi-Agent Risk Council (`scripts/v2/agents.mjs`)
Three deterministic rule-based agents inspect all candidates:
1. **Analyst Agent**: Enforces market regime coherence (e.g. vetoes long trades during `broad_down` or `crypto_down` regimes).
2. **Risk Agent**:
   - Max 10 simultaneous open positions portfolio-wide.
   - Max 4 simultaneous open cryptocurrency positions (**Crypto Correlation Cluster** guard).
   - Maximum gross leverage ceiling (Crypto 12x, US Equities 20x, Indian Equities 10x).
   - Drawdown brake: Halves sizing if intraday equity drops >10%.
3. **Investor Agent**: Vetoes trades if the market quote is stale (>5 minutes old) or if wallet balance has insufficient collateral.

---

## 4. Key Concepts Explained

### 4.1 What is a "Candidate"?
A **Candidate** is a raw trade idea generated by one of the 6 algorithmic strategies during an engine tick. It includes the instrument, side (`long`/`short`), entry price, stop-loss, take-profit, strategy attribution, and internal system context. A Candidate is **not an order**; it cannot touch collateral or execute until it clears both the AI Decision Filter and the Risk Council.

### 4.2 Why do Candidate Counts Fluctuate?
- **30-Second Continuous Evaluation**: Every 30 seconds, market candles update. The 6 strategies recalculate indicators across all monitored symbols.
- **New Setups**: As price crosses channel boundaries or momentum thresholds, new trade intents are proposed, incrementing the total Candidates count.
- **State Windowing**: In the UI, the candidate list aggregates active pending evaluations and recent decisions from the current session.

### 4.3 Why are Candidates Rejection-Prone (Fail-Closed)?
If the dashboard shows a high number of **REJECTED** candidates, it is typically because of the **Fail-Closed Gate**:
- When the AI service cannot connect to the model provider (e.g., an invalid API key returning `401 Unauthorized`, an API rate limit `429`, or a request timeout), the system refuses to gamble funds.
- It tags the candidate `AI_UNAVAILABLE` and drops it immediately.
- This is an **intentional protective feature**, not a crash.

---

## 5. Persistent State & Flat-File Data Contracts

All data resides in [`data/`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/data/). Every file is human-readable and gitignored:

| File | Format | Description | Authority |
| :--- | :--- | :--- | :--- |
| `state.v2.json` | JSON | Active account snapshot: wallet balance, total equity, open positions, risk state, cycles count. | `scripts/v2/engine.mjs` |
| `signals.v2.json` | JSON | Signals generated in the latest 30s cycle. | `scripts/v2/strategies.mjs` |
| `heartbeat.v2.json` | JSON | Engine heartbeat timestamp (`{ ts, cycle, alive }`). Older than 90s = stale. | `scripts/v2/engine.mjs` |
| `ai_pending.v2.json` | JSON | Active queue of candidate requests currently awaiting AI analysis. | `scripts/v2/ai_gate.mjs` |
| `ai_decisions.v2.jsonl`| JSONL | Immutable append-only log of every AI decision, thesis, rating, and latency. | `scripts/v2/ai_gate.mjs` |
| `trades.v2.jsonl` | JSONL | Immutable log of executed fills, closing PnL, exit reasons, slippage, and fees. | `scripts/v2/engine.mjs` |
| `equity.v2.jsonl` | JSONL | Timestamped equity points for historical performance graphing. | `scripts/v2/engine.mjs` |
| `episodes.jsonl` | JSONL | Historical record of completed episodes ($100 $\to$ $500 target or blowup). | `scripts/v2/episode.mjs` |
| `lessons.v2.jsonl` | JSONL | Evolved memory lessons, loss cluster summaries, and strategy takeaways. | `scripts/v2/brain.mjs` |
| `commands.v2.json` | JSON | Inbound control queue (consumed by engine at next tick). | UI / Operator |

---

## 6. Verification & Audit Procedure for AI Agents

When tasked with auditing or verifying this repository, execute the following diagnostic sequence:

### Step 1: Verify Codebase Tests
Run the complete automated test suites across both runtimes:
```powershell
# 1. Run Node.js engine unit tests (78 tests)
npm test

# 2. Run Python Tauric AI integration tests (23 tests)
npm run test:ai

# 3. Verify Next.js frontend compilation
npm --prefix web run build
```
*Expected Result: All tests must pass with 0 errors.*

### Step 2: Audit Process Liveness
Check that all three core background daemons are active:
- **Trading Engine**: `node scripts/v2/engine.mjs` (Updates `data/heartbeat.v2.json` every 30s)
- **Tauric AI Service**: `ai/tauric/server.py` (Listening on `http://127.0.0.1:8000`)
- **Web Dashboard**: `npm --prefix web run dev` (Listening on `http://localhost:3000`)

### Step 3: Audit AI Connectivity & Credentials
Verify the AI service health and active provider configuration:
```powershell
# Test Tauric health check
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health"

# Test active provider configuration
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/config/active"

# Run a live test connection for the active provider
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/config/test-connection" -Method POST -ContentType "application/json" -Body '{"provider":"meta","model":"muse-spark-1.3-contributor"}'
```
*Note: If the test returns `{"ok": false, "error": "Invalid API key"}`, candidates will fail closed with `AI_UNAVAILABLE`.*

### Step 4: Audit Decision Flow & Rejections
Inspect the last 5 AI deliberations to identify rejection causes:
```powershell
node -e "const fs = require('fs'); const lines = fs.readFileSync('data/ai_decisions.v2.jsonl', 'utf8').trim().split('\n').filter(Boolean); lines.slice(-5).forEach(l => { const j = JSON.parse(l); console.log(j.generated_at, j.symbol, j.side, j.decision, j.thesis, j.error); });"
```

### Step 5: Test a Single Engine Tick Safely
To test the engine without waiting for 30-second loop timers:
```powershell
node scripts/v2/engine.mjs --once
```

---

## 7. AI Agent Guardrails & Invariants

When modifying or refactoring this codebase, **an AI agent must strictly observe these constraints**:

1. **NEVER weaken or bypass the Fail-Closed rule**:
   - If AI analysis fails, times out, or errors, `approved` must remain `false`. Never implement a "fallback to auto-approve" mode.
2. **NEVER grant execution authority to the AI**:
   - The AI service in `ai/tauric/` must never place orders, modify wallet balances, or bypass the Risk Council in `scripts/v2/agents.mjs`.
3. **NEVER modify perpetual math invariants**:
   - Maintenance margin is fixed at 3%.
   - Taker fees are fixed at 0.06%.
   - Liquidation occurs immediately when mark price crosses liquidation price.
4. **NEVER store live secrets in source code**:
   - API keys belong in [`.env`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/.env) and `~/.tradingagents/web_preferences.json`.
   - Never commit `.env` or print unmasked keys in log files.
5. **ALWAYS preserve atomic state persistence**:
   - Use `store.writeJSONAtomic()` or append-only JSONL writers. Never write partially formed JSON to `data/state.v2.json`.
6. **ALWAYS keep remotes synchronized**:
   - Push all verified commits to `origin main`.
