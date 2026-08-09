# 會員抽獎券與轉盤 V2 架構

## 核心原則：登入預抽、前端揭曉

正式會員抽獎採 **Prepared Draw + Local Reveal** 模型。

真正具有交易性的工作會在會員完成登入、Lottery runtime preload 後執行：

1. 取得登入 session 的 `getLotteryConfig` 工作區。
2. 對目前可用的每張抽獎券呼叫既有 server-authoritative `drawLottery`。
3. GAS 重新驗證會員、ticket、authoritative config 與 request replay。
4. GAS 決定 prize 並 append `LotteryDraws`。
5. 前端只保存本次 session 揭曉需要的 compact prepared result。
6. 之後使用者開啟抽獎券、點「點我抽獎」、播放轉盤、顯示結果，**都不再呼叫 GAS**。

因此「點我抽獎」的產品語意是 **揭曉已由後端正式完成的抽獎結果**，不是 click-time 才進行隨機抽獎。

這個模型的主要目的，是把網路延遲、Spreadsheet I/O 與 GAS transaction 完全移出可見的轉盤流程，讓動畫只處理本機視效。

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

`member-lottery-v2.js` 會在既有 `lottery.dialog-controller` 外包一層 prepared-reveal orchestration，不新增其他 public global。

## 正式資料流

```text
==============================
會員登入 / Lottery preload
==============================

會員登入成功
  -> member-lottery-loader 載入 Lottery runtime
  -> loadSessionConfig() 取得 session workspace
  -> controller facade refreshTickets()
  -> member-lottery-v2 prepared facade 取得 workspace snapshot
  -> 讀取目前 availableRewards
  -> 對每張尚未 prepared 的 ticket：
       -> 建立 requestId
       -> sourceRequest("drawLottery")
       -> GAS 驗證 LINE / member / ticket / config / replay
       -> GAS 決定 prize
       -> append LotteryDraws
       -> 回 authoritative result
       -> compact prepared result
       -> sessionStorage cache
  -> 以 virtual card 保留「尚未揭曉」票券的前端顯示
  -> PREPARED READY


==============================
使用者開啟抽獎券
==============================

選擇 ticket
  -> prepared facade 確認該 ticket 有 prepared result
  -> inner preparation-service 讀 local workspace adapter
  -> 本機驗證 ticket
  -> workspace-mapper 正規化
  -> wheel-animator.prepare()
  -> Canvas / prize target angles 完成
  -> Dialog READY

此階段 0 次 GAS request。


==============================
使用者點「點我抽獎」
==============================

CLICK
  -> inner controller 鎖定重複 click
  -> draw-service 建立 / 沿用 UI reveal requestId
  -> draw-service 呼叫 options.request("drawLottery")
  -> prepared facade 攔截該 action
  -> 從 session prepared cache 取得 authoritative result
  -> 不呼叫 sourceRequest / GAS
  -> workspace-mapper 驗證 result
  -> wheel-animator 播放揭曉動畫
  -> 精準停在 prepared prize center
  -> 更新 virtual card
  -> 從 prepared cache 移除已揭曉 ticket
  -> RESULT
```

## 網路邊界

### 允許呼叫 GAS 的階段

只有 Lottery UI 進入前的 authenticated preload 可以做正式抽獎交易：

```text
LOGIN / PRELOAD
  -> getLotteryConfig
  -> drawLottery(ticket A)
  -> drawLottery(ticket B)
  -> ...
```

### 不允許呼叫 GAS 的階段

以下流程必須全部是 local-only：

```text
OPEN TICKET
PREPARING
READY
CLICK
WHEEL ANIMATION
SETTLE
RESULT
RETURN TO TICKETS
```

production path 中 `member-lottery-v2.js` 會攔截 inner controller 的：

```text
getLotteryConfig

drawLottery
```

並回傳已準備好的本機 workspace / prepared result。

## Prepared result cache

prepared result 使用 `sessionStorage`，key prefix：

```text
persona-member-lottery-prepared:
```

每筆只保存揭曉需要的資料：

```text
ticket
  cardRoundKey
  lotteryTypeId
  cardNumber
  milestonePoints

prepared draw
  drawId
  configVersion
  prizeId
  prizeLabel
  prizeColor
  drawnAt

lotteryType
  authoritative lottery config

totalPoints
pendingRequestId
```

cache 以 member + LIFF scope 隔離，最多保存 50 筆，對齊既有 available reward response cap。

## Virtual card

GAS 在 preload 階段正式 append `LotteryDraws` 後，server-side card ledger 已將該 ticket 視為使用。

但對使用者而言，尚未播放揭曉動畫的 prepared ticket 仍應出現在抽獎券列表。

因此 prepared facade 會建立 **virtual card**：

- backend card 是 authoritative persistence state。
- prepared cache 中尚未揭曉的 tickets 暫時重新加入 `availableRewards`。
- `availableDraws` 等於尚未揭曉 prepared tickets 數量。
- 每揭曉一張，就從 virtual card / prepared cache 移除一張。

這個 virtual card 只負責 presentation，不會覆寫 GAS 的 authoritative ledger。

## 舊版 pending request 相容

如果部署方案 B 時，使用者 sessionStorage 已存在舊架構留下的 pending request：

```text
persona-member-lottery-round-request:<liff>:<member>
```

登入 preload 會先讀取該 pending request，並使用 **原 requestId** 呼叫 `drawLottery`：

- GAS 若先前已完成 draw，會 replay 原結果。
- GAS 若先前沒有完成，會以同一 requestId 完成一次 draw。
- 取得的 authoritative result 會轉成 prepared result。
- 之後 UI 的 retry / reveal 都只使用本機 prepared result，不再呼叫 GAS。

因此升級不需要放棄既有 idempotency recovery。

## 模組責任

| 模組 | 責任 |
| --- | --- |
| `contracts.js` | Ticket、request ID、錯誤分類與 API contract |
| `pending-request-store.js` | inner controller 的 reveal request ID / reload recovery |
| `workspace-service.js` | inner controller workspace cache；production prepared path 的 request 已被 local adapter 攔截 |
| `preparation-service.js` | 本機 workspace / ticket 驗證；禁止直接呼叫 `drawLottery` |
| `draw-service.js` | 維持 controller transaction/retry 介面；production `drawLottery` request 由 prepared adapter 本機回覆 |
| `workspace-mapper.js` | 嚴格驗證 workspace、lottery、card 與 prepared authoritative result |
| `wheel-animator.js` | Canvas、prize target、旋轉與停獎視效 |
| `dialog-view.js` | PREPARING / READY / ERROR / RESULT UI 與 prepared-reveal 文案 |
| `dialog-controller.js` | 既有 `PREPARING → READY → DRAWING → ANIMATING → RESULT` UI orchestration |
| `member-lottery-v2.js` | **Prepared Draw orchestration、session cache、virtual card、local request adapter** |
| `member-lottery-loader.js` | lazy runtime + login session config preload |
| `gas/client/Code.gs` | authoritative validation、prize selection、LotteryDraws persistence、request replay |

## 後端安全邊界

方案 B **沒有把中獎機率或 prize selection 移到前端**。

真正的 pre-draw 仍使用現有 `drawLottery_()`，因此 GAS 仍負責：

- 驗證 LINE ID Token。
- 驗證會員存在且 access allowed。
- 從 server-side ledger 推導可用 ticket。
- 驗證 `cardRoundKey` / `lotteryTypeId`。
- 讀取 authoritative LotteryPrizes config。
- 由 GAS 決定 prize。
- append-only 寫入 `LotteryDraws`。
- 以 `(lineUserId, requestId)` replay 相同結果，避免 double draw。

前端 prepared cache **不能指定 prize，也不能新增有效 LotteryDraws 紀錄**。

## 重要安全與產品取捨

### 1. 結果可被進階使用者提前查看

因為 UI reveal 階段要求 0 server call，browser 在按下中央按鈕以前就必須擁有 `prizeId`。

因此使用者若使用 DevTools / breakpoint / sessionStorage inspection，理論上能提前知道 prepared result。

這是 Prepared Draw + Local Reveal 的固有限制，不能靠前端加密真正消除。

如果未來產品要求「按下前絕對無法知道結果」，就必須回到 click-time server-authoritative draw。

### 2. 真正開獎時間是 preload 時間

`LotteryDraws.drawn_at` 代表 GAS pre-draw 的實際時間，不是使用者按「點我抽獎」的動畫時間。

### 3. sessionStorage 是 session scoped

同一 browser/LIFF tab reload 可以恢復 prepared results。

如果整個 tab / LIFF session 被終止，前端 prepared cache 可能消失；但後端 `LotteryDraws` 已經安全存在，不會 double draw。

若產品要求跨裝置、跨 session 必須繼續「尚未揭曉」狀態，下一版應增加 server-side prepared/revealed lifecycle，而不是把前端 cache 當 authoritative data。

## Canvas 與動畫

方案 B 的交易與動畫已完全解耦：動畫期間沒有 GAS round-trip。

目前仍沿用既有 WheelAnimator：

- Canvas 在準備時建立。
- prize target 由 authoritative prepared lottery config 建立。
- `FINAL_SPIN_TURNS = 3`。
- settle duration 約 2200–3200ms。
- cubic ease-out：`1 - (1 - progress)^3`。
- `prefers-reduced-motion` 對齊同一 prepared prize。

由於 prepared result 在 click 前已存在，後續可以安全把目前 pending-spin + settle 簡化成單一 deterministic `spinTo(prizeId)` 動畫，而不需要再改 GAS transaction。

## 自動測試驗收

方案 B 至少需要覆蓋：

1. authenticated refresh/preload 會先取得 workspace。
2. 有 available ticket 時，preload 會正式呼叫 `drawLottery`。
3. prepared result 會寫入 member-scoped sessionStorage。
4. 打開 ticket 時只讀 local workspace。
5. click-time `drawLottery` 介面由 local adapter 回覆，不增加 raw GAS request。
6. local result 的 ticket / lotteryType / prize 必須一致。
7. reveal 後 virtual card 移除該 ticket。
8. rapid duplicate click 不會產生第二個 authoritative GAS draw。
9. 舊 pending request 使用原 requestId 在 preload 時安全恢復。
10. reduced-motion 與一般 animation 停在同一 prize。
11. demo mode 保留既有獨立流程。
12. lazy runtime boundary 不被破壞。

完整檢查：

```bash
find PersonalBrandTestingEnvironment -type f -name '*.js' -print0 \
  | sort -z \
  | xargs -0 -n1 node --check

node -e 'const fs=require("node:fs"); for (const f of process.argv.slice(1)) JSON.parse(fs.readFileSync(f,"utf8"));' \
  $(find PersonalBrandTestingEnvironment -type f -name '*.json' | sort)

node --test PersonalBrandTestingEnvironment/tests/*.test.js
```

GitHub Actions 專項 workflow：

```text
.github/workflows/validate-personal-brand-lottery.yml
```

只做 validation，不部署、不自動 merge。

## 人工驗證

正式合併前應在 iOS / Android LINE LIFF 驗證：

1. 登入後等待 Lottery preload 完成。
2. 在進入 ticket UI 前確認 GAS 已為可用 ticket 建立 `LotteryDraws`。
3. 開啟 DevTools / GAS diagnostics，記錄目前 request count。
4. 開抽獎券。
5. 點「點我抽獎」。
6. 等待轉盤停獎與 RESULT。
7. 確認步驟 4–6 **沒有任何新的 GAS request**。
8. 快速連點中央按鈕，確認只播放一次有效 reveal。
9. 同 tab reload，確認尚未揭曉 prepared result 可恢復。
10. 驗證 reveal 後抽獎券從 virtual list 移除。
11. 確認 LotteryDraws 沒有因 reveal 再新增第二筆紀錄。
12. 確認轉盤停在 prepared authoritative prize。
