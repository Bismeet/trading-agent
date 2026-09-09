# 14 — Dashboard specification

## SOURCE REQUIREMENT — functional foundation (P9/P10)

App Router, TypeScript, Tailwind v4. `page.tsx` renders Root. Root is a client component fetching `/api/state` every **6 seconds**, cache `no-store`; friendly loading screen with small Mascot before data arrives; then `<DashboardV2 data={data}>`. No mutations or order controls are specified. Every view uses the same GET response; separate per-tab endpoints are not source requirements.

DashboardV2 reads `data.v2` signals, episodes, generations, strategies, memory, equity and trades. World/brain come from signals. Desktop left sidebar becomes horizontally scrolling pill navigation on mobile. Max-width 6xl container; glass `.card`/`.card-quiet`; body never scrolls sideways, wide rows scroll inside their card. Navigation exactly: **Overview, Positions, Episodes, Evolution, Strategies, World, Lessons, Trades**. Each has a small icon; icon library/names unspecified.

Sidebar: round pink-to-gold F badge; display name exactly `@FabRichhhhhh` (source UI literal, not a verified GitLab username); label `Apex Trading Bot . v2`. Bottom exact text: “Simulation on real live prices. Fake money, real lessons. Honest by design, it can lose everything, it never lies.” Metadata title literal: `@FabRichhhhhh . Trading Bot`.

## SOURCE REQUIREMENT — eight view contracts

| View / purpose | Required data and metrics | Components, charts, tables and exact behavior |
|---|---|---|
| Overview / current run | signals equity/P&L/start/episode/goal/grossLeverage/maxDrawdown; latest episode; aggression/lifetime/generation; equity curve; positions; world | “while you were away” banner: skull blowup, target goal, sparkle otherwise; run, colored return, time ago, new generation/leverage/Kelly. No finished run: seedling “Run 1 in progress”. Equity card “Account Equity . Episode N”, large serif value, profit USD/% and “this run . from $X”, leverage/DD right; green/red sparkline; goal bar “Goal . $500”, hours left or “no deadline, fast as it can” when deadline≥1000h, progress and sakura→gold→green fill. “The Bot” card: live dot/Mascot, generation/runs/blowups/best run/last tick. “Aggression . earned leverage” dial current cap/ceiling, green→gold→red, Kelly%, unlock level. Positions grid and small World card |
| Positions / collateral exposure | signal positions side,symbol,leverage,strategy_id,uPnl,roiPct,entry,mark,notional,liqPrice | LONG green/SHORT red pill, strip -USD from display symbol, leverage/strategy, colored P&L/ROI, Entry/Mark/Notional, liquidation runway. Distance<4% red “danger”; <12% gold “watch”; otherwise green “safe”; drain toward liquidation. Exact note below |
| Episodes / run history | episodes endReason/return/number/time/peak/DD/blownUp | Intro exact below. After ≥3 finished runs, return-scaled bar timeline: green win, gold small loss, red+skull blowup; earlier “in progress” card. “Finished Runs” list run/end reason/peak/DD/colored return. Small-loss boundary unspecified |
| Evolution / account dial history | generations run association, generation, leverage/Kelly,note | Title “Evolution, Level-Ups”; intro below; generation cards “Gen N after run #X”, leverage/Kelly/plain-English note. Empty: sleepy Mascot, “No level-ups yet” |
| Strategies / statistical evidence | strategies name/status/n/kelly/expectancy/PF/DSR/confidence | Title “Strategy Book”; intro below. Cards with status active green/candidate lavender/probation gold/retired red; n and Kelly; four-cell grid Exp R (colored), PF, DSR, Conf. All early candidates: evaluation note |
| World / optional context | signals.world fearGreedCrypto/fearGreedStocks, regime,fundingRate,oiUsd,whaleCrowd,newsMood,putCall,macro,thesis,fed,headlines | Two FNG labeled gauges, band words Extreme Fear…Extreme Greed, red→gold→green bar/marker. “Macro & Flow”: Regime, Funding 8h, Crypto OI, Whales, News mood, Put/Call. Macro line, quiet blossom thesis card, Headlines list of Fed/news lines |
| Lessons / retained lessons | memory title/kind/text/regime/importance | Title “Lessons Banked”; intro below; cards with kind blowup red/win green/else gold, text and regime/importance. Empty: sleepy Mascot and note |
| Trades / execution record | trades open/close,side,symbol,leverage,reason,close realized profit/open margin | Title “Recent Fills”; per fill open/close pill, LONG/SHORT, symbol/leverage/reason; right side colored realized profit for close or margin for open. Includes AI badges (`AI: APPROVED`) |
| AI Analysis / research pipeline | `data.v2.ai.pending`, `data.v2.ai.decisions` | Title “AI Analysis (Tauric Multi-Agent)”; status badge (healthy/fail-closed), model provider; active pending candidates, approved/rejected decision cards; deep-dive drawer with analyst debate transcripts; full historical decision audit ledger |

Exact source copy:

- Positions: “Liquidation is computed on a smoothed mark price, with real fees + funding + slippage. The bar shows how close each position is to being wiped out.”
- Episodes: “Each run goes until it hits the goal, runs out of time, or blows up, then resets and tries again, sharper.”
- Evolution: “Every finished run banks a lesson and may promote or retire a strategy, retune Kelly, and unlock (or claw back) leverage.”
- Strategy Book: “A strategy only earns active after it proves a real edge (statistical gates + Deflated Sharpe). Losers get retired.”
- Lessons: “The bot learns harder from blow-ups than wins. Each is tagged to a market regime.”

These are required source UI strings, not independently validated scientific claims. Recommended explanatory caveats must be labeled additions.

## SOURCE REQUIREMENT — visual/design system (P9)

`globals.css` starts with Tailwind `@import "tailwindcss"` and an `@theme` declaration. Exact tokens:

| Token | Value |
|---|---|
| --color-cream / --color-cream2 | #fff7f0 / #fdeee3 |
| --color-sakura / --color-sakurasoft | #ff9eaa / #ffd2d9 |
| --color-lav / --color-lavsoft | #807ea8 / #cdcaeb |
| --color-gold | #e3c16f |
| --color-ink / --color-inksoft | #562135 / #8a5a68 |
| --color-up / --color-down | #1f9d62 / #e5566f |
| --color-downink / --color-upink | #c0354f / #157a4a |
| --font-display | "Fraunces", "Times New Roman", serif |
| --font-jp | "Zen Maru Gothic", sans-serif |
| --font-body | "M PLUS Rounded 1c", ui-rounded, sans-serif |

Load Google Fonts Fraunces, Zen Maru Gothic, M PLUS Rounded 1c in root layout; font weights/load method unspecified. html/body padding and margin 0. Body font body, ink text, background #fbeee6, antialias smoothing, min-height 100vh. Root layout places fixed sky and sun behind children.

Exact CSS property specification (not an application stylesheet):

- `.sky`: fixed, inset 0, z-index −2; background `radial-gradient(120% 80% at 78% 8%, #ffe7c4 0%, rgba(255,231,196,0) 42%), radial-gradient(90% 70% at 20% 0%, #ffd9e0 0%, rgba(255,217,224,0) 45%), linear-gradient(180deg, #fef0e6 0%, #fbe5e6 38%, #efe6f3 72%, #e7e3f1 100%)`.
- `.sun`: fixed top 6%, right 12%, 190px square, z-index −2, radius 9999px; background `radial-gradient(circle, #ffe9b8 0%, #ffd1a6 45%, rgba(255,209,166,0) 72%)`; blur 2px, opacity .85.
- `.card`: background rgba(255,252,249,.72), backdrop blur 14px, 1px solid rgba(255,255,255,.7), radius 28px; shadow `0 10px 34px -16px rgba(123,74,90,.32), 0 2px 8px -4px rgba(123,74,90,.15)`.
- `.card-quiet`: background rgba(255,252,249,.55), border 1px solid rgba(255,255,255,.6), radius 24px.
- `.pill`: radius 9999px, background rgba(255,255,255,.6), border 1px solid rgba(255,255,255,.7).
- `.font-display`/`.font-jp`: corresponding variables. `.tnum`: font-variant-numeric tabular-nums.
- `.petal`: fixed top −8%, z-index −1, 14px square, `radial-gradient(circle at 30% 30%, #ffd6dd, #ff9eaa)`, radius `12px 1px 12px 1px`, opacity 0, pointer-events none, animation `fall linear infinite`.
- `fall`: 0% translateY(−10vh) translateX(0) rotate(0deg), opacity 0; 10% opacity .9; 90% opacity .8; 100% translateY(112vh) translateX(60px) rotate(320deg), opacity 0.
- `floaty`: 0%/100% translateY(0), 50% translateY(−6px); `.floaty` animation 4s ease-in-out infinite.
- `pulsering`: 0% shadow `0 0 0 0 rgba(31,157,98,.45)`; 70% `0 0 0 10px rgba(31,157,98,0)`; 100% `0 0 0 0 rgba(31,157,98,0)`; `.live-dot` animation 2.2s infinite.
- WebKit scrollbar width/height 9px; thumb rgba(192,158,170,.4), radius 9999px; track transparent.

Sakura: approximately 16 SVG/client falling petals with deterministic pseudorandom positions so server/client match; durations/seeds not supplied. Mascot({size,mood}): lavender rounded robot head, dark screen, glowing happy eyes or closed sleeping curves, pink antenna, smile and blush; floaty class. Exact SVG geometry/mood union unspecified. Do not add an undeclared icon/animation package merely because components need icons.

## Formatting helpers — P9

`usd(n,dp=2)`: US dollars, null→dash. `pct(n)`: sign and percent. `signed(n)`: signed dollar value. `tone(n)`: n≥0→text-upink else text-downink. `price(n)`: four decimals below 1, otherwise two. `timeAgo(ts)`: forms “5s ago”, “3m ago”, “2h ago”, “1d ago”. Nonfinite inputs, pct precision and future timestamps: SOURCE DOES NOT SPECIFY. These helpers format display only; never feed rounded values back into financial decisions.

## States, polling and interactions — RECOMMENDED IMPROVEMENT

Source specifies loading at Root, selected empty views, periodic refresh and navigation, but not a complete error/loading state model for each view. Proposed completion:

| View | Empty | Loading/error/stale completion |
|---|---|---|
| Overview | Source run-in-progress note; no fabricated finished return | Retain last-good snapshot with age/error; distinguish engine stopped from API alive |
| Positions | “No open positions”; no fake sample position | Do not show a safe runway without valid mark/liq; unavailable values dash |
| Episodes | Source early in-progress state | Preserve finished list across refresh; distinguish zero records from failed file read |
| Evolution | Source sleepy “No level-ups yet” | Show snapshot age; never animate invented generations |
| Strategies | Evaluation note; genuinely empty registry explanation | Missing metrics dash, not proof of zero losses; status comes from engine |
| World | Per-source dash/unknown | Independently mark stale/failed sources and observation age; no centered FNG marker for missing value |
| Lessons | Source sleepy note | Missing memory file versus no lessons distinguishable in response metadata |
| Trades | “No fills yet” | Do not append duplicate rows on polling; stable event keys |

Use keyboard-operable navigation, semantic headings, accessible chart labels, non-color status text, reduced-motion support, readable contrast and responsive internal scrolling. Preserve selected tab between polls; no whole-screen loading flash after every fetch. Avoid overlapping requests, abort on unmount, back off repeated failures, and make a manual retry available. These are recommendations, not additional source endpoints. Segment current-run sparkline by episode; reset capital must not look like earned profit.
