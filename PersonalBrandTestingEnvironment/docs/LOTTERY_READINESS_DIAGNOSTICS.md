# 抽獎轉盤就緒延遲診斷與部署說明

## 現行 transaction boundary

轉盤就緒速度與正式開獎現在是兩個獨立階段：

```text
選擇抽獎券
  -> getLotteryConfig（force refresh）
  -> ticket / lottery config validation
  -> Canvas draw + target angle preparation
  -> READY

使用者點中央按鈕
  -> 建立/沿用 requestId
  -> drawLottery
  -> authoritative result
  -> animation
  -> RESULT
```

READY 之前不會呼叫 `drawLottery`。因此「ticket-to-ready」只量測最新工作區、票券驗證與 Canvas 準備，不再把 GAS 正式開獎延遲混在一起。

## 為什麼 open(ticket) 使用 force refresh

抽獎券清單可以使用短期 cache 改善瀏覽體驗，但當使用者選定一張券準備正式抽獎時，前端必須重新確認：

- 該 `cardRoundKey` 仍存在。
- 該 ticket 的 `lotteryTypeId` 仍一致。
- 目前可用 Lottery Type / Prize Config 可被完整驗證。

所以 `preparation-service` 使用 `workspaceService.load({ force: true })`。這次網路往返是刻意保留的 correctness boundary；它不會消耗 ticket，也不會決定 prize。

`workspace-service` 仍提供：

- 5 秒 fresh cache。
- in-flight request dedupe。
- bounded stale preview（預設最多 30 秒）。
- explicit `force: true` bypass cache。
- generation-based invalidation，防止舊 response 重新污染 cache。

## 正式開獎延遲

使用者按中央按鈕後，`draw-service` 才送出 `drawLottery`。這段 latency 不能靠前端假結果隱藏，因為 GAS 是唯一 authority。

目前使用者狀態會清楚區分：

- PREPARING：正在同步最新票券與獎項，尚未開獎。
- READY：可以正式抽獎。
- DRAWING：後端正在驗證與保存本次結果。
- ANIMATING：已收到 authoritative result，播放本機動畫。
- ERROR + pending：結果不確定，使用同 request ID 安全重試。

## 診斷事件

前端仍發送匿名效能事件 `persona:lottery-performance`。detail 只包含 `phase`、`durationMs`、`source`，不包含 ID Token、request ID、會員 ID、ticket ID 或 prize。

主要 phase：

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

## 判讀方式

### `ticket_to_ready` 高

依序看：

1. `workspace_load`：GAS / network 讀取最新 config 是否慢。
2. `canvas_draw`：裝置 Canvas 是否慢。
3. `wheel_prepare`：獎項目標角度準備是否異常。

PREPARING 不含 `draw_lottery`；若在 READY 前看到 draw request，代表 transaction boundary regression。

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

## GitHub Pages 部署確認

1. 確認 Draft PR 的 validation workflows 全部通過。
2. 人工驗證 LIFF 後再合併 `main`。
3. 等 GitHub Pages 發布。
4. 使用無痕視窗或清除 LINE WebView cache 驗證新 JS。
5. Network 面板確認：
   - 選券：只有 `getLotteryConfig`。
   - READY 前：沒有 `drawLottery`。
   - 中央 click：才出現 `drawLottery`。

本次 refactor 不需要更改會員 GAS action、Spreadsheet schema 或 GAS deployment URL；若正式 Apps Script 部署版本落後 repository `main`，仍需由具 Apps Script 權限的人員建立新 deployment version。

## 回滾

本次前端 transaction refactor 不變更 Spreadsheet schema。需要回滾時：

1. Revert PR merge commit。
2. 等待 GitHub Pages 重新發布。
3. GAS / Spreadsheet 無 schema migration，因此不需要資料回滾。
