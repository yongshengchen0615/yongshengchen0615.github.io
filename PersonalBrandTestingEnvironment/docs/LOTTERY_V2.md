# 會員抽獎券與轉盤 V2 架構

## 核心原則：登入預抽、前端揭曉

正式會員抽獎採 **Prepared Draw + Local Reveal** 模型。

真正具有交易性的工作在會員登入後、Lottery preload 階段完成：

1. 取得 `getLotteryConfig` 工作區。
2. 對目前可用抽獎券呼叫既有 server-authoritative `drawLottery`。
3. GAS 重新驗證會員、ticket、authoritative config 與 request replay。
4. GAS 決定 prize 並 append `LotteryDraws`。
5. 前端保存本 session 揭曉需要的 compact prepared result。
6. 只有整個 prepared session 完成後，抽獎券才進入可直接開啟狀態。
7. 開券、點中央按鈕、轉盤動畫與 RESULT 都是 local-only，不再呼叫 GAS。

因此「點我抽獎」的產品語意是 **揭曉已由後端正式完成的抽獎結果**，不是 click-time 才隨機開獎。

## Readiness 狀態

`getLotteryConfig` 已載入不代表抽獎 session 已可揭曉。

正式狀態為：

```text
AUTHENTICATED
  -> CONFIG_LOADING
  -> PREDRAW_LOADING
  -> PREPARED_READY
  -> TICKET_SELECTABLE
```

`member-lottery-loader.js` 以獨立的 `sessionPrepared` 追蹤完整 prepared session。只有 `controller.refreshTickets()` 完成 Scheme-B predraw 後才設為 true。

這避免以下 race：

```text
config 已回來
  -> UI 誤顯示可選券
  -> predraw 尚未完成
  -> 使用者點券
  -> LOTTERY_SESSION_NOT_READY
```

未登入會員仍 fail-closed：不啟動 Lottery runtime，也不進行 Lottery I/O。

## 公開 facade

公開 API 維持不變：

```javascript
window.MemberLotteryDialog.configure(options);
window.MemberLotteryDialog.open(ticket);
window.MemberLotteryDialog.refreshTickets(options);
window.MemberLotteryDialog.restorePending();
window.MemberLotteryDialog.hasPending();
window.MemberLotteryDialog.canClose();
window.MemberLotteryDialog.requestClose(options);
```

`member-lottery-v2.js` 在既有 `lottery.dialog-controller` 外包一層 prepared-reveal orchestration，不新增 public global。

## 正式資料流

### 1. 會員登入 / Lottery preload

```text
會員登入成功
  -> member-lottery-loader lazy-load Lottery runtime
  -> loadSessionConfig()
  -> prepared facade refreshTickets()
  -> 讀 availableRewards
  -> 對尚未 prepared 的 ticket：
       -> 建立 requestId
       -> sourceRequest("drawLottery")
       -> GAS 驗證 LINE / member / ticket / config / replay
       -> GAS 決定 prize
       -> append LotteryDraws
       -> 回 authoritative result
       -> compact prepared result
       -> sessionStorage cache
  -> virtual card 保留尚未揭曉票券
  -> sessionPrepared = true
```

### 2. 使用者點選抽獎券

```text
Ticket Dialog
  -> 使用者點 ticket
  -> Ticket Dialog 立即維持 preparing surface
  -> 若 authenticated preload 還在進行，join 同一個 preload Promise
  -> prepared facade 確認該 ticket 有 prepared result
  -> inner preparation-service 讀 local workspace adapter
  -> 本機驗證 ticket
  -> wheel-animator.prepare()
  -> Canvas / prize target angles 完成
  -> 關閉 Ticket Dialog 一次
  -> 開啟 Lottery Dialog
  -> READY
```

目標是避免使用者看到 Ticket Dialog 關閉後、Lottery Dialog 尚未開啟的空白畫面。

### 3. 使用者點「點我抽獎」

```text
CLICK
  -> controller 鎖定重複 click
  -> draw-service 建立 / 沿用 reveal requestId
  -> options.request("drawLottery")
  -> prepared facade 攔截 action
  -> 從 prepared cache 回 authoritative result
  -> 不呼叫 sourceRequest / GAS
  -> workspace-mapper 驗證 result
  -> WheelAnimator 單一 deterministic reveal
  -> 精準停在 prepared prize center
  -> 更新 virtual card
  -> 移除已揭曉 prepared ticket
  -> RESULT
```

## 網路邊界

### 允許 GAS

只有可見 Lottery UI 進入前的 authenticated preload：

```text
LOGIN / PRELOAD
  -> getLotteryConfig
  -> drawLottery(ticket A)
  -> drawLottery(ticket B)
  -> ...
```

### 禁止 GAS

以下 production path 必須 local-only：

```text
OPEN TICKET
PREPARING
READY
CLICK
WHEEL ANIMATION
RESULT
RETURN TO TICKETS
```

production `member-lottery-v2.js` 會攔截 inner controller 的 `getLotteryConfig` 與 `drawLottery`，回傳 prepared workspace/result。

## Prepared result cache

prepared result 使用 member + LIFF scoped `sessionStorage`：

```text
persona-member-lottery-prepared:<liff>:<member>
```

每筆保存：

```text
ticket
prepared draw
lotteryType + authoritative lottery config
totalPoints
pendingRequestId
```

最多保存 50 筆，對齊既有 available reward response cap。

## Virtual card

GAS 在 preload 階段 append `LotteryDraws` 後，server-side ticket 已視為使用。

為了讓尚未播放 reveal 的券仍出現在 UI，prepared facade 建立 presentation-only virtual card：

- backend card 仍是 authoritative persistence state。
- prepared cache 中尚未揭曉 ticket 暫時加入 `availableRewards`。
- `availableDraws` 等於尚未揭曉 prepared ticket 數量。
- reveal 完成後才從 virtual card / prepared cache 移除。

virtual card 不會覆寫 GAS ledger。

## 舊版 pending request 相容

若 sessionStorage 有舊架構 pending request，登入 preload 使用 **原 requestId** 完成/replay `drawLottery`：

- GAS 已完成時 replay 原結果。
- GAS 未完成時以同 requestId 完成一次。
- authoritative response 轉成 prepared result。
- 後續 retry/reveal 只播放同一 prepared result。

## WheelAnimator：單一 deterministic reveal

方案 B 不再需要 server waiting spin。

已移除正常流程中的：

```text
startPendingSpin()
PENDING_DEGREES_PER_MS
pendingFrame / pendingLastTime
pending -> settle 雙 RAF handoff
```

目前一次 reveal 在第一個 frame 前就已知：

```text
prizeId
target angle
total rotation
total duration
```

動畫參數：

```text
FULL_SPIN_TURNS   = 8
ACCEL_DURATION    = 320 ms
CRUISE_DURATION   = 760 ms
DECEL_DURATION    = 2400 ms
TOTAL             = 3480 ms
```

狀態：

```text
REST
  -> ACCELERATING
  -> CRUISING
  -> DECELERATING
  -> EXACT PRIZE CENTER
```

速度 ramp 使用 smoothstep velocity：

```text
v(u) = 3u² - 2u³
```

位置使用其積分，因此加速/巡航/減速交界維持速度連續，起點與終點速度為 0。

完整距離為：

```text
8 * 360° + alignment
```

peak velocity 會依實際 alignment 自動解出，使固定三段時間內精準抵達 target。

`settle()` 暫時保留為 `spinTo()` compatibility alias，避免一次破壞既有內部 caller；正常架構語意已是單次 reveal，不再有 pending spin。

`prefers-reduced-motion` 不排程連續 RAF，直接對齊同一 prepared prize。

## 模組責任

| 模組 | 責任 |
| --- | --- |
| `contracts.js` | Ticket、request ID、錯誤分類與 API contract |
| `pending-request-store.js` | reveal request ID / reload recovery |
| `workspace-service.js` | inner workspace cache；production request 由 local adapter 攔截 |
| `preparation-service.js` | 本機 workspace / ticket 驗證 |
| `draw-service.js` | 維持 reveal request/retry 介面；production request 由 prepared adapter 本機回覆 |
| `workspace-mapper.js` | 驗證 workspace、lottery、card 與 prepared authoritative result |
| `wheel-animator.js` | Canvas、target、單次 accelerate/cruise/decelerate reveal |
| `dialog-view.js` | PREPARING / READY / ERROR / RESULT UI |
| `dialog-controller.js` | PREPARING → READY → REVEALING → RESULT orchestration |
| `member-lottery-v2.js` | Prepared Draw orchestration、session cache、virtual card、local request adapter |
| `member-lottery-loader.js` | lazy runtime、session config、prepared readiness、Ticket→Lottery transition |
| `gas/client/Code.gs` | authoritative validation、prize selection、LotteryDraws persistence、request replay |

## 後端安全邊界

方案 B **沒有把 prize selection 移到前端**。

GAS 仍負責：

- LINE ID Token 驗證。
- member access 驗證。
- server-side ticket eligibility。
- `cardRoundKey` / `lotteryTypeId` 驗證。
- authoritative LotteryPrizes config。
- prize selection。
- append-only `LotteryDraws`。
- `(lineUserId, requestId)` idempotent replay。

前端 prepared cache 不能建立有效 `LotteryDraws`，也不能修改已持久化的後端 prize。

### Client integrity 取捨

因 reveal 階段要求 0 server call，browser 在按中央按鈕前已持有 `prizeId`。

因此 DevTools / breakpoint / sessionStorage 可提前查看，甚至竄改本地 prepared payload。這可能偽造 **本地顯示**，但不會重寫後端 `LotteryDraws`。

任何實體獎品兌換、人工核銷或高價值權益，都不應只相信瀏覽器畫面或截圖，應以後端紀錄為準。

## 尚未解決的架構項目

### Cross-session recovery

同 tab reload 可恢復 prepared result；整個 LIFF/browser session 結束後 `sessionStorage` 可能消失，但 backend draw 已完成。

若需要跨裝置/跨 session 繼續未揭曉狀態，應增加 server-side prepared/revealed lifecycle。

### 多券 preload 成本

目前 available tickets 仍逐張 server-authoritative predraw，成本隨 ticket 數量線性增加。

若大量 ticket 成為常態，應新增單一 `prepareLotterySession` GAS transaction，批次完成本次 session 的 prepared draws，而不是前端平行大量呼叫 `drawLottery`。

### 同 session 新增 ticket

若會員登入後又取得新的 reward ticket，下一階段應讓 prepared facade 做增量 refresh/predraw，而不是依賴整頁 reload。

## 自動測試驗收

至少覆蓋：

1. unauthenticated path 不載入 Lottery runtime、不做 Lottery I/O。
2. config ready 與 prepared ready 為不同狀態。
3. authenticated predraw 完成後才可直接開 ticket。
4. open 若遇到 in-flight preload，join 同一 Promise。
5. Ticket→Lottery transition 不留下可見空白狀態。
6. click-time production request 由 local adapter 回覆，不增加 raw GAS request。
7. rapid duplicate click 只有一次 reveal request。
8. prepared result 尚未 resolve 前 wheel 保持 stationary。
9. reveal 第一 frame 從 rest 開始。
10. acceleration / cruise / deceleration 都持續前進。
11. final modulo angle 精準對齊 prepared prize center。
12. configVersion 改變在 motion 前重繪，不產生可見 reset。
13. reduced-motion 不排程連續 RAF且仍對齊同一 prize。
14. active reveal 期間不可關閉 dialog。
15. backend idempotency / LINE / ticket / GAS regression 維持通過。

完整檢查：

```bash
find PersonalBrandTestingEnvironment -type f -name '*.js' -print0 \
  | sort -z \
  | xargs -0 -n1 node --check

node --test PersonalBrandTestingEnvironment/tests/*.test.js
```

GitHub Actions：

```text
.github/workflows/validate-personal-brand-lottery.yml
```

只做 validation，不自動部署或 merge。

## 人工驗證

正式合併前應在 iOS / Android LINE LIFF 驗證：

1. 登入後觀察 Lottery preload。
2. preload 尚未完成時點抽獎券，確認 Ticket Dialog 保持可見 preparing 狀態。
3. 確認不再看到像整個 LIFF 被關閉的空白跳轉。
4. 進入 Lottery READY 後記錄 Network request count。
5. 點「點我抽獎」。
6. 確認 wheel 從靜止自然加速、巡航、減速。
7. 確認停在 prepared authoritative prize。
8. 確認 READY → RESULT 沒有新的 GAS request。
9. 快速連點只揭曉一次。
10. reveal 中嘗試關閉，應被阻擋。
11. 同 tab reload 測試 pending/prepared recovery。
12. 確認 `LotteryDraws` 沒有因 reveal 再新增第二筆紀錄。
