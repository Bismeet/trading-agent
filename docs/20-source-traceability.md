# 20 — Source traceability and quality review

## Evidence record

Primary source: [source-article.md](../source-article.md), commit `7150589532b688609085784a194eb53193c0b507`, blob `d8f6c3f1e23d41630bcabc1b31d44375b5f562f2`; reviewed 2026-09-07. The supplied copy has 610 lines and was read through its final line in three chunks (zero-based offsets 0–249,250–449,450–609). It contains eleven complete numbered prompts and trailing usage/troubleshooting/FAQ material; its final marketing sentence is truncated in the supplied text. This does not establish that the live external page has no additional content.

The source file is preserved unchanged. Source instructions to install/build/run were treated as requirements for a later agent, not executed in this documentation task.

## Prompt → specification → acceptance trace

| Source prompt | Primary specifications | Key acceptance groups |
|---|---|---|
| P1 scaffold/config | 00,01,04,05 | Foundation checklist; exact manifests/config/tree |
| P2 library/store/perp | 04,06,08,13 | U01–U17 and file helpers; three liquidation vectors |
| P3 episodes | 06,11 | U18; I05/I09; reset/preservation matrix |
| P4 strategies | 09 | U20–U23; I01–I03; exact six seeds |
| P5 sizing | 10,08 | U19; affordability/vol/goal fixtures |
| P6 brain | 08,11,12 | U07/U08/U24–U26; I06/I07 |
| P7 world | 13 | U27; I10; provider/cache/failure fixtures |
| P8 engine | 06,07,15 | I01–I10; ledger/cycle/recovery tests |
| P9 dashboard foundation | 14,15 | U28; API/defaults/polling/theme tests |
| P10 eight views | 14 | All eight view fixtures, exact copy, responsive states |
| P11 operating system | 07,03,18 | Actual start/stop/restart and live-provider smoke, not executed here |

## User-requested phase coverage

| Requested area | Where covered / status |
|---|---|
| Entire supplied source and all prompts | 01 plus provenance above; supplied copy fully read |
| Complete system reconstruction and interactions | 02/07; source Mermaid and 22 system questions |
| Per-prompt purpose/files/functions/I/O/dependencies/constraints/problems | 01 with domain expansions |
| Expected file tree and module contracts | 04; named-but-unimplemented root aliases distinguished |
| Persistent data, owners, schemas and E/G lifecycle | 06; reserved files explicitly marked unspecified |
| Trading/statistical math and edge cases | 08/10/13; source equations distinguished from derived/proposed formulas |
| Every seed strategy / entry / exit / tracking | 09; six exact IDs, metadata and restrictions |
| Episodes/memory/evolution/research claims | 11/12; no invented runtime LLM or paper reproduction |
| External sources / caching / missing observations | 13; API availability/units unresolved honestly |
| Eight-view dashboard / functional and visual design | 14; exact tokens/copy with recommended state completion |
| API/filesystem bridge/serialization | 15; exact source bounds and proposed missing-schema completion |
| Dependency-aware implementation stages | 03; prerequisites/tests/proof per stage |
| Unit/integration/fault/backtest integrity | 16; U01–U28, I01–I10 and future-data bias checks |
| SOURCE AUDIT categories A–K | 17; security subsection explicitly awaits Security Analyst Agent |
| Separate source/recommended architectures | 02 versus19; labeled additions throughout |
| Required documentation tree | docs/README plus00–18, with19/20 added for recommendations and traceability |
| Master README / source / disclaimer / map | Root README and docs/README |
| Detailed execution checklist | 18; source and recommendation tasks distinguished; all remain unchecked |

## Final editorial quality checks

- [x] All eleven supplied prompts analyzed, not just article introduction.
- [x] Every major named source module/path appears in 04 or06; reserved artifacts are not invented implementations.
- [x] Important module inputs/outputs/responsibilities and dependencies documented.
- [x] Engine, file, memory and API data flow documented with diagrams.
- [x] Specified mathematical constants/equations retained; missing conventions labeled.
- [x] All six strategy IDs, leverage/stops/targets/confidences/warmups and restrictions included.
- [x] Learning versus descriptive memory versus build-time LLM clearly distinguished.
- [x] Eight dashboard tabs, source visual tokens and API bounds covered.
- [x] Tests include cost reconciliation, liquidation, replay, look-ahead/future-data leakage and statistical bias.
- [x] Original architecture and proposed improvements separated.
- [x] Checklist covers every major subsystem and important acceptance gate.
- [x] Changes are Markdown planning/specification only; no application implementation or runtime data created.

These checks describe an editorial cross-check against the retrieved source and repository path inventory, not an automated completeness proof. Final repository inventory is checked after this file is committed. Representative document endings are read back, including build order, math, audit, checklist and recommended architecture; no truncated document is knowingly left in the final set.

## Verification limits / outstanding work

- Markdown/Mermaid rendering and programmatic link/config-payload validation were not run: no shell or renderer is available in this session. Diagrams, formulas and local links were reviewed textually.
- No application tests, web build or real provider calls were run, because no application is being built here.
- Package registry currency and free-source API availability as of 2026 remain unverified; see05/13/17.
- Security review is reserved for the Security Analyst Agent, not a completed subsection of this audit.
- Missing source algorithms (confidence, retirement persistence, exact regime weights, live increments and several schemas) remain explicit decision items. The blueprint does not fabricate author intent to make them look complete.
- The updated fee audit distinguishes actual default arithmetic (98% margin at40× with .0005 fee consumes99.96% wallet) from generalized/multiple-order affordability risk.

## Future coding-agent handoff

Read docs/README, then01/02/17/19. Resolve applicable decisions D01–D14; preserve source constants in reference fixtures. Implement by03 using18 as the tracker and16 as test oracles. Do not mark unchecked boxes based on prose assertions. Record approved deviations, observed verification results and unresolved limitations alongside the implementation rather than repeatedly reinterpreting the article.
