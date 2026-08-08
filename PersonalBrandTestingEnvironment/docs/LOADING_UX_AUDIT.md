# Progressive Loading / Loading UX Audit

Status: analysis baseline for `agent/progressive-loading-lottery-pending-spin`.

## Primary finding

The Lottery READY path already prepares the selected ticket, authoritative workspace, prize configuration, Canvas, and target mapping before the central draw button is enabled. The remaining user-visible dead time begins after the central draw click: the controller starts the authoritative `drawLottery` request and does not start wheel motion until that request returns.

## Loading classification

| Feature | Priority | Current trigger | Blocking work | Recommended UX / loading policy |
| --- | --- | --- | --- | --- |
| Page boot | P0 | page load | public config, critical JS/CSS, LIFF bootstrap | keep critical-only; avoid feature detail fetches |
| LIFF initialization | P0 | page load | LIFF SDK/runtime initialization | explicit boot state only while page is unusable |
| Member summary | P0 | authenticated boot | member sync and summary render | stable summary skeleton if network wait is visible |
| Point card | P0/P1 | member summary | current card summary | render current summary as soon as available; background refresh where safe |
| Point history | P2/P3 | history open | historical rows | lazy-load on demand; prefer bounded/paginated server response as data grows |
| Rewards | P1/P2 | member/reward panel | current eligible reward state | render summary first; defer historical detail |
| Lottery tickets | P1 | member summary / ticket dialog | current ticket snapshot plus authoritative refresh | stale-while-revalidate; do not block the snapshot |
| Lottery runtime | P1/P2 | eligible ticket appears | dynamic Lottery modules and wheel renderer | idle/task prewarm only when an eligible reward exists |
| Lottery preparation | P1 | ticket selection | `getLotteryConfig`, validation, Canvas draw, target mapping | dialog preparing state; finish before READY |
| Lottery draw | P0 after explicit click | central draw click | authoritative `drawLottery` | start non-authoritative pending spin immediately after persistent request creation; settle only after server result |
| Lottery result | P0 after draw response | server response | authoritative mapping and deceleration | natural continuous settle; no extra config fetch |

## Lottery target flow

```text
eligible reward
  -> background runtime prewarm (JS only)

ticket open
  -> immediate current snapshot
  -> authoritative workspace refresh in background

ticket select
  -> PREPARING
  -> join in-flight / bounded-fresh workspace or fetch getLotteryConfig
  -> validate ticket + config
  -> draw Canvas + prepare target map
  -> READY

central draw click
  -> create/reuse persistent draw requestId
  -> startPendingSpin() (no prize knowledge)
  || drawLottery authoritative request
  -> authoritative prize response
  -> settle from current rotation to server prize
  -> result
```

## Safety invariants

- READY has no persistent draw request ID and no `drawLottery`.
- Pending spin is presentation only; it must not select, predict, or encode a prize/winning index.
- The server remains authoritative for ticket validation, current Lottery configuration, prize selection, idempotency, and LotteryDraw persistence.
- Transient/unknown draw failures retain the same persistent request ID for safe retry.
- No additional `getLotteryConfig` is permitted on the central draw click.

## Next evidence

After the pending-spin change is green in CI, profile real LINE iOS and Android sessions with existing privacy-safe phases (`gas_request`, `lottery_runtime_prewarm_wait`, `lottery_runtime_load`, workspace/preparation/ticket-to-ready/draw phases) before changing freshness or transport timeout policies.
