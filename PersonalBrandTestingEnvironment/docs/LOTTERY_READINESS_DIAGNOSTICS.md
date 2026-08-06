# 抽獎轉盤就緒延遲診斷與部署說明

## 核心結論

PR #13 已完成「先由 GAS 決定並保存結果，再讓中央按鈕只播放動畫」的安全架構；本次問題不是動畫時間，而是選券後的準備流程仍會串行等待重複的工作區讀取。

修改前的正常路徑：

```text
開啟抽獎券清單
  -> refreshTickets({ force: true })
  -> getLotteryConfig
  -> 使用者選券
  -> preparation-service.load({ force: true })
  -> 再次 getLotteryConfig
  -> drawLottery
  -> Canvas 與停止角度
  -> 中央按鈕可用
```

修改後：

```text
開啟抽獎券清單
  -> getLotteryConfig（同時間請求去重並保存工作區）
  -> 使用者選券
  -> 立即重用已載入的工作區做前置驗證
  -> drawLottery（唯一必要的正式交易）
  -> 使用後端權威設定建立 Canvas 與停止角度
  -> 中央按鈕立即可用
```

重用的工作區只用於前置顯示與快速驗證。正式 `drawLottery` 仍會在 GAS 內重新確認會員權限、抽獎券、卡片輪次、指定轉盤與設定版本，並回傳本次開獎的權威設定。因此即使前置快取較舊，也不能決定獎項或繞過後端驗證。

## 已確認根因

1. 抽獎券清單開啟時已呼叫一次 `getLotteryConfig`。
2. 選券後 `preparation-service` 又使用 `force: true` 呼叫第二次 `getLotteryConfig`。
3. 第二次設定請求與 `drawLottery` 串行，中央按鈕必須等待兩次 GAS 往返。
4. UI 只顯示「正在準備轉盤」，無法辨識卡在工作區、正式開獎或 Canvas。

## 修改內容

- `workspace-service` 支援 `allowStale` 的預覽快取重用；明確 `force: true` 仍會重新同步。
- 選券準備使用既有工作區，省略第二次設定往返。
- `drawLottery` 仍只呼叫一次，重試仍沿用相同 request ID。
- GAS 回傳的 `lottery` 與 `lotteryType` 仍覆蓋前端工作區，設定更新時保持正確。
- UI 顯示「確認抽獎券／取得最新獎項／保存抽獎結果／建立轉盤」。
- 超過 1.8 秒顯示慢速網路與安全重試說明。
- 發送匿名階段耗時事件：
  - `workspace_load`
  - `workspace_validation`
  - `draw_lottery`
  - `preparation_service`
  - `canvas_draw`
  - `wheel_prepare`
  - `ticket_to_ready`

事件名稱為 `persona:lottery-performance`，detail 只包含 `phase`、`durationMs` 與 `source`，不包含 Token、request ID、會員 ID、卡片 ID、獎項或試算表資料。

## 正式裝置量測

在瀏覽器 DevTools Console 執行：

```javascript
window.addEventListener("persona:lottery-performance", (event) => {
  console.table(event.detail);
});
```

然後依序：

1. 登入會員。
2. 開啟抽獎券清單。
3. 選擇一張券。
4. 等中央按鈕啟用。
5. 記錄 `draw_lottery` 與 `ticket_to_ready`。

判讀方式：

- `workspace_load` 是 `fresh-cache` 或 `stale-preview-cache`：選券後沒有第二次設定網路請求。
- `draw_lottery` 很高：瓶頸在會員 GAS、Sheets 或網路。
- `canvas_draw`／`wheel_prepare` 很高：瓶頸在裝置 Canvas 或獎項數量。
- `ticket_to_ready` 明顯高於其他階段總和：需要檢查主執行緒或額外 UI 工作。

## 部署確認

### GitHub Pages

1. 合併 PR 後等待 Pages 發布完成。
2. 使用無痕視窗開啟會員頁。
3. DevTools Network 勾選 Disable cache 後重新整理。
4. 確認 `workspace-service.js` 含 `allowStale`。
5. 確認 `preparation-service.js` 的正式準備路徑沒有 `load({ force: true })`。
6. Repository 沒有 Service Worker；若仍看到舊檔，優先檢查瀏覽器、LINE WebView 或 CDN 快取。

### 會員 GAS

本次沒有修改 `gas/client/Code.gs`，因此不需要為本 PR 重新發布會員 GAS。

但 PR #13 曾修改會員 GAS。如果 PR #13 合併後尚未在 Apps Script「管理部署作業」建立新版本，正式環境仍可能使用舊 GAS。請確認：

1. 會員 Apps Script 的 `Code.gs` 與目前 `main` 一致。
2. 既有 Web App 已建立新版本。
3. 執行身分與存取權限未改變。
4. `client/config.json` 的 `/exec` URL 指向該部署。

GitHub repository 無法直接證明 Apps Script 管理介面目前選用哪個 deployment version，必須由具備 Apps Script 權限的人員確認。

## 安全與冪等性

- 獎項仍只由會員 GAS 決定。
- 中央按鈕只在後端結果已保存且 Canvas 已完成後啟用。
- 點擊中央按鈕後零後端請求。
- timeout、BUSY、網路中斷仍保留 pending request。
- 只有後端明確未開獎才清除 pending request。
- Spreadsheet schema、GAS action 與 response contract 均未變更。

## 回滾

1. Revert 本 PR 的 merge commit。
2. 等待 GitHub Pages 重新發布。
3. 本 PR 沒有 GAS 或 Spreadsheet 變更，不需要 GAS／資料回滾。
