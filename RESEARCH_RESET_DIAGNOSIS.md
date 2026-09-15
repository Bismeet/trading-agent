Work on the repository now.

This is an execution task, not a planning task.

## 1. GITHUB — CLEAN UP AND PUSH

First inspect the current git state.

Preserve all existing research work.

Do not rewrite history.

Do not delete research artifacts.

Do not modify production trading logic just for cleanup.

Create/update the main GitHub-facing documentation so that someone visiting the repository can immediately understand what this project is and what has actually been achieved.

Create a strong, polished `README.md` if the current one is inadequate.

The README should clearly explain:

- what FabInvests / trading-agent is
- what the simulator does
- architecture overview
- current strategies
- learning system
- risk/execution simulation
- research phases
- Phase 5–11 findings
- what has been proven
- what has NOT been proven
- current research status
- known limitations
- data limitations
- how to run it locally
- how to run tests
- how to start the dashboard/server
- repository structure
- development/research conventions

Be especially honest about the research results.

Do NOT market the project as profitable.

Make it clear that the research program has not established robust out-of-sample profitability.

Mention the major conclusion from the research reset:

The current system has repeatedly failed to find positive gross directional alpha from its existing OHLC-only information set, and the next research direction requires genuinely different information rather than another indicator/ML layer.

Make the README look like a serious open-source quant research project, not an academic dump.

Add appropriate sections, tables, status badges if they are actually useful, diagrams/ascii architecture where useful, and concise commands.

Do not invent badges, metrics, integrations, or capabilities.

---

# 2. DOCUMENT THE RESEARCH

Make sure the important research reports are easy to discover from GitHub.

Create/update an appropriate research index, for example:

`docs/RESEARCH.md`

or another structure consistent with the repository.

Organize the research chronologically.

For each phase provide:

- objective
- what was tested
- result
- verdict
- key lesson
- relevant report/config location

Make the research history understandable to a new contributor.

Include the Research Reset diagnosis and clearly explain why another OHLC-only directional strategy is currently not justified.

Do not alter the original reports merely to make them prettier unless necessary.

---

# 3. UI — COMPLETE RETRO 1980s COMICAL REVAMP

Now inspect the existing dashboard/UI.

Completely revamp the visual presentation into a **retro 1980s computer/trading-terminal aesthetic with a deliberately comical personality**.

Think:

**1980s hacker terminal + cheesy Wall Street trading terminal + arcade machine + absurd financial dashboard.**

The UI should feel intentionally designed, not like a modern dashboard with a green filter slapped on it.

Use the existing frontend architecture.

Do not replace the application unnecessarily.

Do not break existing functionality.

Do not change backend trading semantics merely to change the UI.

## Visual direction

Use a coherent retro aesthetic:

- CRT-style presentation
- dark terminal background
- phosphor-style typography
- pixel/monospace typography
- chunky borders
- pixelated UI elements
- terminal windows
- old-school status bars
- scanline/CRT effects where technically appropriate
- deliberately oversized indicators
- retro buttons
- ASCII-inspired decorations
- old computer status messages
- arcade-like visual feedback
- humorous financial terminology

The UI should look like something a trader in 1987 would have built if they somehow had access to the current data.

## Comical personality

Add tasteful jokes throughout the UI without compromising information clarity.

Examples of the TYPE of humor:

- `MARKET MACHINE: PROBABLY FINE`
- `PROFIT-O-METER`
- `LOSS DETECTOR: OH NO`
- `TRADING COMPUTER THINKING...`
- `VERY ADVANCED FINANCIAL TECHNOLOGY`
- `BEEP BOOP — POSITION OPEN`
- `THE MARKET HAS DECLINED TO COOPERATE`
- `ALPHA STATUS: WE ARE STILL LOOKING`
- `RISK LEVEL: PLEASE REMAIN CALM`
- `WALL STREET APPROVAL: PENDING`
- `QUANT COMPUTER: CONCERNED`
- `MISSION STATUS: DON'T GO BROKE`

Do not overuse jokes.

The dashboard must remain genuinely useful.

Humor should be part of the identity.

---

# 4. DASHBOARD INFORMATION ARCHITECTURE

Make the important information immediately visible.

Prioritize:

### System status

- engine status
- server status
- current episode
- current equity
- wallet balance
- P\&L
- drawdown
- exposure
- open positions

### Trading

- current positions
- entry
- mark
- unrealized P\&L
- leverage
- liquidation information
- strategy
- side

### Research

Make the research status visible somewhere appropriate.

For example:

`ALPHA STATUS: NOT VERIFIED`

and:

`CURRENT RESEARCH: DATA / INFORMATION RESET`

Do NOT display fake "AI confidence" or invented predictions.

### Activity

- recent trades
- recent decisions
- recent events
- learning activity where applicable

### Health

- data freshness
- quote status
- stale-data warnings
- risk gate status
- server/engine health

---

# 5. RETRO INTERACTION

Add subtle interaction details where appropriate:

- CRT flicker/scanline effect
- blinking terminal indicators
- pixel-style status lights
- animated loading states
- terminal boot sequence
- humorous error/status messages

Keep animations lightweight.

Do not create performance problems.

Provide accessibility-friendly fallbacks if animations are disabled.

---

# 6. RESPONSIVE DESIGN

The UI must still work properly on:

- desktop
- laptop
- smaller browser windows

Do not sacrifice usability for the retro aesthetic.

The aesthetic should be strong while maintaining readable numbers and charts.

---

# 7. IMPORTANT DATA INTEGRITY RULE

The UI must display real values from the existing backend/data.

Do NOT fabricate:

- P\&L
- profits
- win rates
- alpha scores
- predictions
- positions
- trades
- strategy performance

If a value does not exist, display an honest state such as:

`NO DATA`

`NOT AVAILABLE`

or

`NOT VERIFIED`

Do not turn research conclusions into fake live signals.

---

# 8. SERVER

After implementing the UI:

Determine the repository's correct server/start command from its package scripts and existing documentation.

Start the server.

Verify that:

- it actually starts
- the dashboard loads
- backend APIs work
- existing dashboard data renders
- no obvious console/runtime errors exist
- the retro UI is actually visible
- existing functionality remains operational

Do not merely run the command and assume success.

Actually verify the application.

If the project has separate frontend/backend processes, start whatever is necessary for the dashboard to function.

---

# 9. TESTING

Run the existing complete test suite.

Do not weaken tests.

If UI tests/build checks exist, run them too.

Fix genuine regressions caused by your changes.

Do not alter backend behavior to make UI tests pass.

---

# 10. GIT

Once everything is complete:

Run:

`git status`

Review every changed file.

The change set should contain only intentional work.

Do not commit:

- secrets
- API keys
- credentials
- temporary files
- logs
- generated junk
- node_modules
- local machine configuration

Add/update `.gitignore` only if genuinely necessary.

Create a clean commit with a useful message, for example:

`Revamp dashboard with retro 80s terminal UI`

Then push the commit to the repository's configured remote and current working branch.

Do NOT force-push.

Do NOT rewrite history.

If the remote rejects the push because of authentication or permissions, report the exact reason instead of pretending it succeeded.

---

# 11. FINAL VERIFICATION

After pushing:

Verify:

- git working tree status
- latest commit
- remote/branch
- server is running
- dashboard URL/port
- tests passing
- no production trading logic changed
- README is GitHub-ready
- research documentation is discoverable
- retro UI is functional

Give me a concise final report containing:

### Git

- branch
- commit hash
- push status

### UI

- what was revamped
- dashboard URL/port

### Tests

- result

### Production safety

- whether trading/backend logic was changed

### Documentation

- README/research docs created or updated

### Server

- whether it is currently running

Do the work now.

**Do not stop at a plan. Execute it, verify it, commit it, push it, and start the server.**
















