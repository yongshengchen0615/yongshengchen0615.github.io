# 抽獎轉盤就緒延遲診斷與部署說明

## 現行 transaction boundary

轉盤 Runtime、抽獎券/獎項準備與正式開獎是三個獨立階段：

```text
會員資料同步完成
  -> 若 availableRewards > 0：低優先級預熱 Lottery Runtime（只載 JS，不打 GAS）

開啟抽獎券清單
  -> 立即顯示 currentMemberCardSummary 快照
  -> 背景 getLotteryConfig（authoritative workspace refresh）

選擇抽獎券
  -> 共用既有 WorkspaceService in-flight request
     或重用 selection freshness 內的 authoritative response
     或在需要時重新 getLotteryConfig
  -> ticket / lottery config validation
  -> Canvas draw + target angle preparation
  -> READY

使用者點中央按鈕
  -> 建立/沿用 persistent draw requestId
  -> drawLottery
  -> authoritative result
  -> animation
  -> RESULT
```

READY 之前不會呼叫 `drawLottery`，也不會建立 persistent draw requestId。Runtime 預熱不呼叫 `getLotteryConfig`，因此沒有抽獎券消耗、獎項決策或 LotteryDraws mutation。

## 為什麼 Runtime 預熱與 authoritative config 分開

會員登入後若已經有可用抽獎券，前端會使用 `MemberLotteryDialog.prewarm()` 在 idle callback（或 timeout fallback）預先載入 Lottery Runtime。沒有抽獎券或 Demo session 不會預熱。

Runtime Loader 採三階段：

1. 先載入 `module-registry.js`。
2. `lottery-wheel.js` 與 Lottery internal definition modules 平行下載。
3. 全部 definitions 完成後才載入 `member-lottery-v2.js` composition root。

這可移除原本 12 支腳本逐支等待造成的 head-of-line blocking，同時保留 module registry 的 dependency resolution correctness。

登入後不直接 prefetch `getLotteryConfig`。原因是 ticket selection 仍採短期 freshness boundary；若會員登入後停留數秒才選券，過早的 config response 會過期並造成額外 API。Authoritative refresh 因此放在 Ticket Dialog 開啟時，讓選券更容易共用同一個 in-flight response。

## WorkspaceService freshness 與 single-flight

`workspace-service` 提供：

- 5 秒 fresh cache。
- same-generation in-flight request dedupe。
- bounded stale preview（預設最多 30 秒）。
- selection `maxAgeMs`（目前 2 秒）。
- generation-based invalidation，防止舊 response 重新污染 cache。

Ticket Dialog 的 background refresh 與緊接著的 Ticket Preparation 共用同一個 WorkspaceService，因此正常快速路徑應只有一支 `getLotteryConfig`。

Selection freshness 不是抽獎 security boundary。真正的 mutation authority 仍在 `drawLottery`，但較短 freshness 可提早攔截已被其他 session 使用的 ticket。

## 正常 API 數量

會員已登入且有抽獎券的快速路徑：

```text
會員資料同步後：Runtime prewarm（0 GAS）
開 Ticket Dialog：getLotteryConfig × 1
點 Ticket：join in-flight / bounded-fresh response
點中央抽獎：drawLottery × 1
```

因此理想正常值是：

- `getLotteryConfig = 1`
- `drawLottery = 1`

若 Ticket Dialog 的 authoritative response 已超過 selection freshness 才點券，Preparation 可以再送一支 `getLotteryConfig`。這是 freshness correctness policy，不是 duplicated-request race。

## GAS read-only hot path

`getLotteryConfig_()` 的 PointCardSettings 現在由 `getMemberPointCardStatus_()` 在同一 request 內讀取一次，再直接從已計算出的 `cardStatus.rewardRules` 與 `cardStatus.availableRewards` 建立 required Lottery Type IDs。

因此 read-only config path 不再為了 required type mapping 額外掃一次 PointCardSettings。

這項優化沒有套用到 `drawLottery_()` 的 mutation path。正式 draw 仍會在 server 端重新確認：

- LINE identity / member access。
- ticket/card authoritative state。
- LotteryDraws ledger / request replay。
- latest Lottery Config。
- server-side prize selection。

不要用長時間 CacheService 或 client cache 取代 draw-time authority。

## 正式開獎延遲

使用者按中央按鈕後，`draw-service` 才送出 `drawLottery`。這段 latency 不能靠前端假結果隱藏，因為 GAS 是唯一 authority。

狀態明確區分：

- RUNTIME PREWARM：背景載入程式，不讀 GAS。
- PREPARING：正在同步/驗證 ticket 與獎項，尚未開獎。
- READY：可以正式抽獎。
- DRAWING：後端正在驗證與保存本次結果。
- ANIMATING：已收到 authoritative result，播放本機動畫。
- ERROR + pending：結果不確定，使用同 request ID 安全重試。

## 診斷事件

前端發送匿名效能事件 `persona:lottery-performance`。detail 只包含 `phase`、`durationMs`、`source`，不包含 ID Token、request ID、會員 ID、ticket ID 或 prize。

主要 phase：

- `lottery_runtime_load`
- `workspace_load`
- `preparation_service`
- `canvas_draw`
- `wheel_prepare`
- `ticket_to_ready`
- `draw_lottery`

瀏覽器 DevTools：

```javascript
window.addEventListener("persona:lottery-performance", (event) => {
  console.table(event.detail);
});
```

### `lottery_runtime_load` 高

優先檢查：

1. GitHub Pages / LINE WebView 的 asset cache。
2. Registry 是否先完成、definitions 是否平行下載。
3. 是否有單一 module 下載錯誤導致整組 fail closed。

### `ticket_to_ready` 高

依序看：

1. `workspace_load`：GAS / network 讀取最新 config 是否慢。
2. `canvas_draw`：裝置 Canvas 是否慢。
3. `wheel_prepare`：獎項目標角度準備是否異常。

PREPARING 不含 `draw_lottery`；若 READY 前看到 draw request，代表 transaction boundary regression。

### `draw_lottery` 高

瓶頸在正式交易：

- LINE token verification（未命中短期驗證 cache）。
- Google Sheets read/validation。
- ScriptLock contention。
- 網路或 Apps Script runtime。

不要用 client-side prize prediction 或提前 draw 來掩蓋這段時間；應從 GAS/Sheet 規模與量測處理。

### 動畫卡頓

正式動畫不讀網路，也不每 frame 重畫 Canvas。若 `draw_lottery` 已完成但轉盤仍不流暢，才檢查 GPU、CSS transform、requestAnimationFrame 與裝置負載。

## 安全重試量測

測試 timeout / 網路中斷時：

1. 點中央按鈕。
2. 在 request 已送出後中斷網路。
3. 確認 UI 顯示 pending / 安全重試。
4. 恢復網路後重試。
5. 檢查 `LotteryDraws`：同一 request ID 只有一筆。
6. 第二次回應必須是原 draw 的 replay，而非新 prize。

快速雙擊亦應只出現一次 `draw_lottery` in-flight request。

## Authoritative config 更新

READY 與 CLICK 之間管理員可能發布新 Lottery Config。前端 READY 時顯示的 config 不是開獎 authority；`drawLottery` 會使用後端最新 config。

若 draw response 的 `configVersion` 改變：

- `workspace-mapper` 驗證 authoritative lottery。
- `wheel-animator` 在動畫前重新建立必要 Canvas / target angles。
- 不再額外呼叫 `getLotteryConfig`。
- 最終指針仍必須停在 authoritative prize center。

## Legacy URL

`client/lottery.html` 不再是一套獨立 Lottery App，只保留 compatibility redirect 到：

```text
client/?panel=tickets
```

Query/hash 會保留。正式 runtime 不再載入 `client/lottery.js` 或 `client/member-lottery.js`。

## GitHub Pages / GAS 部署確認

1. 確認 Draft PR validation workflows 全部通過。
2. 人工驗證 LIFF 後再合併 `main`。
3. 等 GitHub Pages 發布前端。
4. 因 `gas/client/Code.gs` 有版本變更，Apps Script 需要建立新的 Web App deployment version；既有 `/exec` URL、Script Properties 與 Spreadsheet schema 不需要變更。
5. 使用無痕視窗或清除 LINE WebView cache 驗證新 JS。
6. Network 面板確認：
   - 有 ticket 的登入後 idle：只載 Lottery Runtime assets，不送 `getLotteryConfig`。
   - 開 Ticket Dialog：開始 `getLotteryConfig`。
   - 緊接著選券：共用同一 config request / bounded-fresh response。
   - READY 前：沒有 `drawLottery`。
   - 中央 click：才出現 `drawLottery`，且不額外 `getLotteryConfig`。

## 回滾

本次變更不修改 Spreadsheet schema。需要回滾時：

1. Revert PR merge commit。
2. 等待 GitHub Pages 重新發布。
3. GAS 建立一個使用前一版 `Code.gs` 的 deployment version。
4. Spreadsheet 無 schema migration，因此不需要資料回滾。
