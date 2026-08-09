# 會員抽獎券與轉盤 V2 架構

## 核心原則：設定預載、點擊才正式抽獎

正式會員抽獎採 **Config Preload + Click-time Server-authoritative Draw + Deterministic Reveal** 模型。

交易邊界只有一個：**使用者按下中央「開始抽獎」按鈕。**

登入與開券階段只做唯讀準備：

1. 會員登入完成後預載 `getLotteryConfig`。
2. 保留 authoritative ticket / lottery config session snapshot。
3. 使用者選券時驗證該券仍存在於 `availableRewards`。
4. 預先繪製 Canvas、建立 prize target angles。
5. 開啟轉盤後中央按鈕才可操作。
6. 按下中央按鈕時建立／沿用 persistent requestId。
7. 同一時間開始轉盤加速，並正式呼叫 `drawLottery`。
8. GAS 重新驗證會員、ticket、config 與 request replay，決定 prize 並 append `LotteryDraws`。
9. 前端取得 authoritative draw 後，從目前速度連續進入 cruise / deceleration，精準停在 prize center。
10. 完成動畫後才更新結果 UI；pending request 在成功完成後清除。

因此：

```text
登入 ≠ 抽獎
開券 ≠ 抽獎
準備轉盤 ≠ 抽獎
按下中央按鈕 = 正式抽獎 transaction boundary
```

## 為什麼不用登入預抽

先前 Prepared Draw 模型會在 authenticated preload 階段逐張呼叫 `drawLottery`，再用 browser session cache 與 virtual card 把已經 server-side 使用的票券呈現成「尚未揭曉」。

這會造成：

- 使用者沒有按抽獎，server ledger 卻已經產生 draw。
- 清除 sessionStorage、WebView 重建或跨裝置時，presentation state 與 ledger 可能分離。
- 未揭曉 prize 提前存在瀏覽器。
- 多張票券會增加登入 preload 的 GAS mutation 數量與 latency。
- 客服與產品文案難以清楚說明「何時算正式使用票券」。

V2 現在不保存 unrevealed prepared prize，也不建立 presentation-only virtual card。

## Readiness 狀態

```text
AUTHENTICATED
  -> CONFIG_LOADING
  -> SESSION_CONFIG_READY
  -> RUNTIME_READY
  -> TICKET_SELECTABLE
  -> WHEEL_PREPARED
  -> CLICK_TO_DRAW
  -> DRAW_REQUEST_IN_FLIGHT
  -> AUTHORITATIVE_RESULT
  -> DECELERATING
  -> RESULT
```

`member-lottery-loader.js` 負責 authenticated session config preload 與 lazy runtime load。

`member-lottery-v2.js` 只是一個薄的 composition root，直接建立 `lottery.dialog-controller`，不得攔截或預執行 `drawLottery`。

## 公開 facade

```javascript
window.MemberLotteryDialog.configure(options);
window.MemberLotteryDialog.open(ticket);
window.MemberLotteryDialog.refreshTickets(options);
window.MemberLotteryDialog.restorePending();
window.MemberLotteryDialog.hasPending();
window.MemberLotteryDialog.canClose();
window.MemberLotteryDialog.requestClose(options);
```

loader 額外提供 lazy-load / preload facade，但載入正式 runtime 後仍由同一 controller 處理 ticket / draw state。

## 正式資料流

### 1. 會員登入 / config preload

```text
會員登入成功
  -> member-lottery-loader
  -> loadSessionConfig()
  -> rawRequest("getLotteryConfig")
  -> 保存 member-scoped in-memory session snapshot
  -> lazy-load Lottery runtime
  -> controller.refreshTickets()
       -> 透過 loader sessionRequest 讀本機 snapshot
       -> 不呼叫 drawLottery
  -> session ready
```

允許的 backend action：

```text
getLotteryConfig
```

禁止：

```text
drawLottery
```

### 2. 使用者點選抽獎券

```text
Ticket Dialog
  -> 使用者點 ticket
  -> prepareForOpen(ticket)
  -> preparation-service 取得 session config snapshot
  -> 驗證 ticket 仍存在於 availableRewards
  -> 找到 lottery type
  -> wheel-animator.prepare()
  -> Canvas / prize target angles 完成
  -> 開啟 Lottery Dialog
  -> READY
```

這一段仍然是 read-only，不建立 pending draw request，也不消耗 ticket。

### 3. 使用者按中央按鈕

```text
CLICK
  -> controller lock duplicate click
  -> DrawService.ensure(ticket)
       -> 建立或沿用 member + LIFF scoped persistent requestId
  -> emit persona:lottery-draw-start
  -> WheelAnimator startPendingSpin()
       -> acceleration
       -> cruise while network is pending
  -> request("drawLottery", ticket, requestId)
  -> GAS authoritative validation
  -> append/replay LotteryDraws
  -> authoritative response
  -> workspace-mapper validation
  -> WheelAnimator.settle(draw, authoritativeLottery)
       -> preserve current rotation/velocity
       -> optional cruise distance
       -> smooth deceleration
       -> exact prize center
  -> DrawService.complete()
  -> host card / totalPoints update
  -> RESULT
```

## Request id 與 retry

pending request 使用：

```text
persona-member-lottery-round-request:<liff>:<member>
```

保存：

```text
requestId
cardRoundKey
lotteryTypeId
```

原則：

- requestId 在中央 click 時才建立。
- network timeout / reload / retry 必須沿用同 requestId。
- GAS 以 request replay 確保相同 requestId 不重複產生 draw。
- definitive no-draw error 才能清除 pending request。
- authoritative draw 成功且 reveal 完成後才 `complete()`。

sessionStorage 只保存 request recovery metadata，不保存未揭曉 prize。

## WheelAnimator

### 尚未取得結果

中央 click 後立刻開始：

```text
REST
  -> ACCELERATING
  -> CRUISING / WAITING_FOR_SERVER
```

目前 pending target speed 約：

```text
1.2 degree / ms
```

加速使用 smoothstep velocity：

```text
v(u) = 3u² - 2u³
```

### authoritative result 回來後

不重設 transform，不從 0 重新開始。

從當前：

```text
rotation
velocity
```

計算：

```text
prize center alignment
minimum extra turns
deceleration distance
required cruise distance
```

然後：

```text
CURRENT CRUISE VELOCITY
  -> optional cruise
  -> smooth deceleration
  -> EXACT PRIZE CENTER
```

減速曲線保持起始速度連續，終點速度為 0。

`prefers-reduced-motion` 不執行持續 pending animation；authoritative result 回來後直接使用 reduced-motion reveal path。

## 網路邊界

### 允許 GAS

```text
LOGIN / SESSION PRELOAD
  -> getLotteryConfig

CENTRAL DRAW CLICK
  -> drawLottery
```

### 不應呼叫 GAS

```text
OPEN TICKET DIALOG
SELECT TICKET / PREPARE WHEEL
OPEN LOTTERY DIALOG
CANVAS PREPARE
ANIMATION AFTER RESULT
RESULT UI
RETURN TO TICKETS
```

例外：pending draw 的 retry/replay 仍可使用同一 requestId 呼叫 `drawLottery`，由 GAS 回傳同一 authoritative result。

## 模組責任

| 模組 | 責任 |
| --- | --- |
| `member-lottery-loader.js` | authenticated config preload、lazy runtime、session config adapter |
| `member-lottery-v2.js` | 薄 composition root；不得 predraw |
| `lottery/workspace-service.js` | config snapshot cache / stale control |
| `lottery/preparation-service.js` | read-only ticket 與 lottery config 驗證 |
| `lottery/pending-request-store.js` | click-time persistent requestId recovery |
| `lottery/draw-service.js` | 唯一 production draw mutation owner；觸發 draw-start motion signal |
| `lottery/workspace-mapper.js` | authoritative response normalization / validation |
| `lottery/wheel-animator.js` | prepare、pending acceleration、continuous settle、exact target |
| `lottery/dialog-view.js` | dialog state / controls / result presentation |
| `lottery/dialog-controller.js` | orchestration、busy state、retry / close policy |

## 測試 contract

以下必須是 regression tests 的長期 contract：

```text
refresh/preload does NOT call drawLottery
prepareForOpen does NOT call drawLottery
open does NOT call drawLottery
central click calls drawLottery exactly once
rapid duplicate clicks do not create another draw
retry/reload reuses the same requestId
authoritative response settles on the returned prize
no unrevealed prize is cached by member-lottery-v2
reduced-motion path still aligns the authoritative prize
```

CI 不應再把「登入預抽」視為正確規格。
