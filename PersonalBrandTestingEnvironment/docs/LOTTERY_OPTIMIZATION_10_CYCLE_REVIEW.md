# Lottery Optimization 10-Cycle Review

## Scope

Repository: `yongshengchen0615/yongshengchen0615.github.io`

Project: `PersonalBrandTestingEnvironment/`

Review baseline: `fe91489257d49f845a6ac500599dcf3e5bfd7761`

Reviewed main head after Cycle 9: `772e57620707bf473b9c65cfb747f36d38f3226b`

This document closes Cycle 10 as a review/regression gate. It intentionally does not add another production-code change because the current repository already has green Lottery and full-project CI, the targeted interaction path is structurally local-only after login preload, and no new measured LIFF/device evidence justifies another safe production optimization.

## Skill usage

Relevant project skills were re-read for the final gate:

- `.agents/skills/diagnosing-bugs/SKILL.md`: use deterministic red-capable regressions and measured evidence before performance changes.
- `.agents/skills/tdd/SKILL.md`: test public behavior seams, use red -> green vertical slices, avoid implementation-coupled tests.
- `.agents/skills/code-review/SKILL.md`: review against a fixed baseline and separate spec compliance from code-quality concerns.

Cycle 10 fixed point is the pre-campaign commit above. The final review compares the 12 campaign commits that follow it.

## 10-cycle summary

### Cycle 1 — overlap authenticated Lottery preload

The login preload previously waited for Lottery runtime loading before starting the authoritative config request. Runtime loading and the single session `getLotteryConfig` request now begin together and join before controller priming.

Structural result:

```text
before: runtime -> getLotteryConfig -> prime workspace
after:  runtime || getLotteryConfig -> prime workspace
```

No extra GAS request is introduced.

### Cycle 2 — expose GAS / Spreadsheet scan pressure

`PerformanceDiagnostics.gs` now reports operation-level scan multipliers for `getLotteryConfig` and a successful `drawLottery` path. The diagnostic remains aggregate-only and does not expose row values.

This cycle intentionally measured scan structure instead of prematurely introducing indexes, archives, or security-sensitive caching.

### Cycle 3 — protect the preload critical path in Lottery CI

The focused Lottery workflow now runs the preload critical-path regression so future loader changes cannot silently reintroduce a sequential runtime/config waterfall.

### Cycle 4 — make wheel compositing hints transient

Wheel regression tests now require `will-change: transform` only during active pending/settle motion and require it to return to `auto` after motion or under reduced-motion behavior.

This avoids permanently pinning the rotor to a compositor layer.

### Cycle 5 — broaden focused latency regression coverage

The Lottery workflow now watches and runs latency-related transport/prewarm/warm-open tests, including `shared/gas-api.js`, GAS preconnect behavior, prewarm fallback, and warm-open behavior.

This is a CI-hardening cycle rather than a production rewrite.

### Cycle 6 — release the idle Lottery rotor layer in CSS

`runtime-optimizations.css` now explicitly defaults `.member-lottery-rotor` to `will-change: auto`. JavaScript activates the hint only while motion is active.

### Cycle 7 — add privacy-safe GAS transport timing

`shared/gas-api.js` emits `persona:gas-performance` with only:

- `phase: gas_request`
- `durationMs`
- `source: fetch | fetch-error | bridge | bridge-error`

No member ID, LINE ID, request ID, ticket ID, prize ID, or business payload is included.

The existing fetch-first, bounded timeout, request correlation, constrained bridge fallback, request-secret, and origin protections remain intact.

### Cycle 8 — measure Lottery prewarm scheduling wait

The Lottery loader can emit a bounded scheduling-wait metric so LIFF/browser evidence can distinguish scheduler delay from module/network loading delay. The metric contains only phase, duration, and source.

No claim is made that this metric itself improves latency.

### Cycle 9 — protect Lottery CSS performance in focused CI

The focused Lottery workflow now runs `lottery-css-performance.test.js`, preventing future CSS changes from silently restoring an always-on compositor hint or bypassing the progressive optimization layer.

### Cycle 10 — final architecture, security, UX, and performance gate

No new production change is introduced in Cycle 10. The current evidence supports stopping rather than manufacturing a tenth optimization.

Reasons:

1. latest main Lottery CI is green;
2. latest full-project CI is green;
3. login preload starts runtime/config in parallel;
4. later ticket refresh/open paths are covered as local-only;
5. formal draw remains server-authoritative;
6. pending spin remains prize-agnostic and continuous;
7. CSS compositor lifetime is bounded;
8. remaining GAS scale decisions require real row-count/latency evidence;
9. remaining LIFF tuning requires iOS/Android measurements.

## Final data flow

```text
unauthenticated page
  -> no Lottery runtime/config request

authenticated member detected
  -> start Lottery runtime load
  -> start one authoritative getLotteryConfig in parallel
  -> join both
  -> seed member-scoped in-memory session workspace
  -> LOTTERY_SESSION_READY

later ticket list / refresh
  -> local session/host state only
  -> no getLotteryConfig network request

select ticket
  -> local session snapshot
  -> read-only validation/preparation
  -> Canvas prepare
  -> open wheel READY
  -> no config network request

central draw click
  -> PendingRequestStore.ensure persistent requestId
  -> drawLottery
  -> prize-agnostic pending spin starts immediately
  -> GAS revalidates current member/ticket/config/idempotency
  -> GAS selects prize and persists LotteryDraw
  -> authoritative response updates local session state
  -> animator settles from current rotation
```

## Final network target

Expected normal interaction structure:

| Stage | getLotteryConfig | drawLottery |
| --- | ---: | ---: |
| authenticated login preload | 1 | 0 |
| open ticket list | 0 | 0 |
| refresh/reopen ticket list | 0 | 0 |
| select ticket | 0 | 0 |
| prepare Canvas | 0 | 0 |
| open wheel | 0 | 0 |
| central draw click | 0 | 1 |
| show next ticket after successful draw | 0 | 0 |

This is a structural contract. Real transport fallback may physically retry the same logical request under timeout/fallback conditions; idempotency/request correlation must remain intact.

## HTML review

Current Lottery HTML responsibilities should remain lightweight:

- host page loads the lazy Lottery facade rather than every internal module;
- dialog semantics and accessible controls are covered by project tests;
- Lottery internal runtime is not on the unauthenticated startup execution path;
- no additional eager Lottery markup/script expansion is justified without device evidence.

No Cycle 10 HTML production change is recommended.

## CSS review

Current performance-specific safeguards include:

- `.member-lottery-rotor { will-change: auto; }` while idle;
- JavaScript enables `transform` compositing only during active motion;
- reduced-data mode removes nonessential backdrop filtering;
- reduced-motion behavior is covered by wheel regressions;
- progressive `content-visibility` remains isolated in the runtime optimization layer.

No always-on `will-change`, `transition: all`, or new persistent GPU hint should be introduced without profiling evidence.

## JavaScript review

High-value invariants now covered by regressions:

- authenticated session preload single-flights;
- runtime and config preload overlap;
- post-login config reads use member-scoped in-memory state;
- ticket refresh cannot start new Lottery config I/O;
- open without prepared state fails closed;
- draw request ID is created only for formal draw;
- duplicate draw clicks coalesce;
- ambiguous failures retain request ID for safe retry;
- definitive no-draw failures clear pending state;
- pending spin is prize-agnostic;
- authoritative config changes redraw targets without resetting pending rotation;
- reduced-motion avoids continuous pending frames;
- compositor hint is released when motion stops.

Remaining JavaScript tuning should be driven by LIFF timing/profiling, not constants changed by guesswork.

## GAS / Spreadsheet review

`getLotteryConfig` has already been reduced to one complete PointCardSettings snapshot per request and is used once during authenticated session preload.

`drawLottery` intentionally keeps fresh server-side validation and therefore remains more expensive than preview/config reads. Current aggregate diagnostics model successful-draw scan pressure across member lookup, PointRedemptions, PointCardSettings, LotteryTypes, LotteryPrizes, and LotteryDraws.

Do not introduce long-lived draw authority caches.

Next backend optimization should require evidence from:

- actual sheet row counts;
- `gas_request` latency distribution;
- operation-level diagnostic scan estimates;
- measured dominant table(s).

Only then choose bounded reverse scans, indexing, archival/partitioning, or request-scoped reuse.

## Security review

The final architecture preserves the required transaction boundary:

Before central draw click:

- no ticket consumption;
- no LotteryDraw mutation;
- no prize selection;
- no frontend winning index;
- no persistent draw transaction requestId.

On central draw click:

- DrawService/PendingRequestStore creates or reuses requestId;
- `drawLottery` reaches GAS;
- GAS performs fresh identity/member/ticket/config/idempotency validation;
- GAS selects and persists the prize;
- frontend receives only the authoritative result and animates it.

Session snapshots affect preview UX only and are not an authorization boundary.

## Performance review

Measured repository facts:

- main head reviewed: `772e57620707bf473b9c65cfb747f36d38f3226b`;
- full project regression: 260/260 pass on the latest validated main run;
- Lottery and full-project workflows are successful at that head.

Structural improvements, not fabricated timing claims:

- runtime/config preload changed from sequential to parallel;
- later Lottery interaction removes repeated config network I/O;
- compositor hint lifetime is bounded to active wheel motion;
- transport and scheduler phases now have privacy-safe telemetry;
- focused CI covers the critical preload, transport, warm-open, GAS diagnostics, and CSS performance paths.

No millisecond or percentage speedup is claimed without real LIFF measurements.

## Test coverage / final gate

The latest full suite includes coverage for:

- authenticated preload, including zero rewards;
- local-only ticket refresh;
- session snapshot advancement after draw;
- preload critical-path overlap;
- Lottery pre-open boundary;
- single authoritative draw;
- timeout/retry requestId behavior;
- pending motion and authoritative settle;
- server config change during draw;
- reduced-motion;
- Canvas/renderer failure;
- module loading;
- GAS read diagnostics;
- fetch/bridge transport constraints;
- CSS compositor lifetime.

Latest validated full-project result at the Cycle 9 head: **260 tests, 260 pass, 0 fail, 0 skipped**.

## Remaining priorities

### P1 — real LIFF iOS / Android timing evidence

Collect phase durations for login preload, GAS transport, ticket-to-ready, draw request latency, and settle. This determines whether the remaining bottleneck is network, GAS, module load, Canvas, or WebView scheduling.

### P2 — measured GAS / Spreadsheet scale bottleneck

Use actual row counts and operation diagnostics before changing read algorithms. `drawLottery` successful-path scan pressure is the main candidate because it must remain fresh and currently touches multiple large tables.

### P3 — long-session preview staleness UX

The session snapshot deliberately avoids repeated `getLotteryConfig`. If administrators change Lottery configuration during a long-lived member session, the pre-draw UI can be stale while the formal draw remains safe because GAS revalidates. Device/product evidence should determine whether a non-blocking refresh policy is worth reintroducing; do not put config loading back on the interaction critical path by default.

## Recommended next stage

Do not change more production code until real LIFF measurements are captured.

Manual verification matrix:

1. LINE iOS login with zero tickets and with tickets;
2. LINE Android login with zero tickets and with tickets;
3. open/reopen ticket list three times and confirm zero additional config requests;
4. open wheel and confirm READY without config I/O;
5. draw with 200 ms, 500 ms, 1 s, 2 s, and 5 s server latency where reproducible;
6. confirm pending animation begins immediately and settles continuously;
7. confirm only one logical draw request and the same requestId on ambiguous retry;
8. capture privacy-safe phase timings and GAS scale diagnostics.

Cycle 10 conclusion: **review/regression gate complete; no additional production change justified by current repository evidence.**
