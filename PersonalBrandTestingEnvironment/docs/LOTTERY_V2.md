# 會員抽獎券與轉盤 V2 架構

## 目標

會員抽獎流程採「先完成後端開獎與畫面準備，再讓中央按鈕只播放動畫」的設計。這個邊界同時解決三個核心問題：

1. 轉盤不會一邊旋轉一邊等待 GAS。
2. 網路逾時後可以沿用同一個 request ID 安全重試，不會重複使用抽獎券。
3. 轉盤按鈕啟用前，獎項設定、後端結果、Canvas 圖面與停止角度都已準備完成。

公開 API 維持：

```javascript
window.MemberLotteryDialog.configure(options);
window.MemberLotteryDialog.open(ticket);
window.MemberLotteryDialog.refreshTickets(options);
window.MemberLotteryDialog.restorePending();
window.MemberLotteryDialog.hasPending();
window.MemberLotteryDialog.canClose();
window.MemberLotteryDialog.requestClose(options);
```

## 現行完整資料流

```text
會員登入與會員資料同步
  -> 會員卡回應包含目前集點進度與可用抽獎券摘要
  -> 開啟「抽獎券」滿版清單
  -> refreshTickets({ force: true }) 重新讀取最新工作區
  -> 同時間的清單請求合併成同一個 Promise
  -> 使用者選擇一張可用券
  -> Dialog 立即進入「正在準備轉盤」且禁止關閉／切換
  -> preparation-service 強制取得最新 getLotteryConfig
  -> 驗證會員、卡片輪次、節點、轉盤類型與票券仍一致
  -> pending-request-store 建立或沿用同一個 request ID
  -> preparation-service 呼叫 drawLottery
  -> 會員 GAS 在 ScriptLock 內再次驗證會員與票券
  -> GAS 依版本化獎項機率決定結果並追加 LotteryDraws
  -> 相同 request ID 重試只重播既有結果
  -> draw 回應中的獎項設定取代較早的工作區設定
  -> workspace-mapper 驗證回應契約
  -> lottery-wheel 建立高 DPI Canvas render plan
  -> wheel-animator 預先計算每個獎項的停止角度
  -> Dialog 才切換成「可開始抽獎」

使用者點擊中央按鈕
  -> 只讀取記憶體中的 prepared response
  -> 不呼叫 getLotteryConfig、drawLottery 或其他後端 API
  -> requestAnimationFrame 執行連續由快到慢的 cubic ease-out
  -> 精確停在 GAS 回傳的獎項
  -> reduced-motion 模式直接對齊相同獎項
  -> 清除 pending request
  -> 更新會員卡與抽獎券清單
  -> 顯示開獎結果
```

## 模組責任

| 模組 | 唯一責任 |
| --- | --- |
| `contracts.js` | 抽獎券、request ID、成功回應與「可釋放／必須保留 pending」錯誤契約 |
| `workspace-service.js` | 工作區請求去重、5 秒記憶體快取、強制更新與過期請求隔離 |
| `pending-request-store.js` | pending request 的 session persistence、會員／展示模式隔離與冪等 request ID |
| `preparation-service.js` | 在轉盤啟用前取得最新設定、呼叫 `drawLottery`、合併後端權威設定及安全重試 |
| `wheel-draw-guard.js` | 只在記憶體中保存並解析 prepared draw response |
| `workspace-mapper.js` | 驗證並正規化轉盤、集點卡、票券與抽獎結果資料 |
| `wheel-animator.js` | Canvas 預繪、停止角度預計算、自然減速及 reduced-motion 對齊 |
| `dialog-view.js` | DOM、完整畫面狀態、ARIA、焦點、錯誤引導及關閉行為 |
| `demo-provider.js` | 展示模式 workspace 與 deterministic draw result |
| `dialog-controller.js` | 協調 use cases、防止快速連點／切換／重複開啟，不直接實作資料格式或動畫 |
| `member-lottery-v2.js` | Composition root，只建立並公開 `MemberLotteryDialog` facade |

## 狀態與使用者回饋

| 狀態 | 畫面與行為 |
| --- | --- |
| 載入抽獎券 | 清單顯示 `aria-busy=true`，同時間只送一個工作區請求 |
| 無抽獎券 | 顯示空狀態，不開啟轉盤 |
| 準備轉盤 | 顯示「正在準備轉盤」，禁止關閉、返回及切換票券 |
| 可開始抽獎 | Canvas、結果與停止角度已完成，中央按鈕才可操作 |
| 設定已更新 | draw 回應版本與稍早清單不同時，提示已套用最新設定 |
| 轉動中 | 禁止連點、關閉、返回與離頁；只執行本機動畫 |
| 等待確認 | 動畫完成、結果尚未確認時仍保持鎖定 |
| 抽獎成功 | 顯示獎項，確認後同步會員卡與票券清單 |
| 暫時性錯誤 | 保留相同 request ID，顯示「安全重試」及下一步 |
| 明確未開獎 | 只有後端明確證明沒有產生抽獎時才清除 pending，重新同步票券 |
| Canvas 錯誤 | 不啟用中央按鈕，提供可安全重試的錯誤引導 |

## 請求去重與快取規則

- `workspace-service` 將同時間的 `getLotteryConfig` 合併成一個 Promise。
- 一般清單可使用 5 秒記憶體快取，降低 Dialog 反覆開關造成的重複請求。
- 正式準備抽獎一律使用 `force: true`，不可用舊快取執行開獎。
- cache invalidation 會增加 generation；先前尚未完成的舊請求即使晚到，也不能重新污染快取。
- 同一張票券的快速重複 `open()` 共用一個 preparation transaction。
- 不同票券在準備期間會回覆 `LOTTERY_PREPARATION_BUSY`，不會啟動第二個 draw。
- 開獎完成後立即使工作區快取失效，再同步最新票券與會員卡。

## request ID、冪等性與錯誤恢復

- request ID 綁定會員及卡片輪次；展示模式使用獨立 namespace。
- `drawLottery` 開始前將 request ID 寫入 session storage。
- 網路中斷、GAS timeout、`BUSY`、回應格式無法確認等未知結果都保留 pending。
- 下一次重試沿用同一個 request ID；GAS 從 `LotteryDraws` 重播既有結果，不會再抽一次。
- 只有明確的 no-draw 錯誤才釋放 pending，例如票券已失效、卡片輪次尚未符合、轉盤不存在或會員權限已失效。
- 頁面重新整理或 LIFF 恢復後，`restorePending()` 會重新進入準備流程並安全查回同一結果。

## Canvas 與動畫

- 使用 `devicePixelRatio` 建立高 DPI backing store，倍率上限 3、Canvas backing size 上限 3072，兼顧清晰度與記憶體。
- `createRenderPlan()` 預先計算區塊角度、文字位置、文字顏色與 bounded label。
- `prepare()` 在中央按鈕啟用前繪製靜態轉盤並預算所有獎項的 target modulo。
- 正式動畫使用 `requestAnimationFrame`，不在 frame 中讀取 DOM layout。
- 一般模式為 3 圈、約 2.2～3.2 秒的連續 cubic ease-out，不做最後跳轉。
- `prefers-reduced-motion` 直接將相同中獎扇區對齊指針，仍保證結果正確。
- Canvas context 不可用或 renderer 失敗時 fail closed，不允許按下抽獎。

## 會員 GAS 資料一致性

- 獎項只由會員 GAS 根據版本化 `LotteryPrizes` 機率決定，前端傳入的獎項不被採信。
- `ScriptLock` 包住正式開獎的會員、票券、request ID、轉盤與 append 驗證。
- Lock 等待上限 4 秒；忙碌時回覆可沿用同 request ID 的安全重試訊息，避免使用者長時間無回饋。
- 同一個 draw operation 只讀取必要的抽獎紀錄快照，append 前再讀一次做競態重查；成功 append 後以記憶體中的新紀錄計算卡片，不再第三次全表掃描。
- `getLotteryConfig` 只在初始化／必要遷移階段短暫持鎖，讀取工作區時不長時間阻塞正式開獎。
- append 後即使前端沒有收到回應，相同 request ID 仍會重播持久化結果。
- 不改變 GAS action、request／response 對外格式或 Spreadsheet schema。

管理員 GAS 負責版本化集點卡與轉盤設定，不執行會員正式抽獎。本次已分析其 action、設定版本與輸出契約，無需修改管理員 GAS；既有測試繼續保護兩套 GAS 的 schema 相容性。

## 需要實機驗證的項目

自動化測試無法完全模擬 LINE WebView、裝置 GPU 與真實 Apps Script 延遲。正式發布前至少驗證：

| 環境 | 驗證項目 |
| --- | --- |
| iOS LINE LIFF | 首次登入、票券清單、快速連點、準備期間返回、轉盤清晰度、結果確認 |
| Android LINE LIFF | 背景／前景恢復、網路切換、返回鍵、Canvas 動畫與 safe-area |
| Safari／Chrome | 一般瀏覽器登入、強制重新整理 pending 恢復、橫向與直向 |
| 慢速／不穩網路 | timeout 後「安全重試」沿用 request ID，不產生第二筆 `LotteryDraws` |
| reduced-motion | 不播放長動畫但仍精確顯示 GAS 決定的獎項 |
| 高 DPI 裝置 | Canvas 文字與區塊清晰，沒有裁切或過度記憶體使用 |

人工測試時應額外查看 `LotteryDraws`：同一 request ID 永遠只有一筆，抽獎前後終身點數相同，完成票券從清單移除。

## 測試

```bash
# 全部 JavaScript
find PersonalBrandTestingEnvironment -type f -name '*.js' -print0   | sort -z   | xargs -0 -n1 node --check

# 會員與管理員 GAS
cp PersonalBrandTestingEnvironment/gas/client/Code.gs /tmp/member-gas.js
cp PersonalBrandTestingEnvironment/gas/admin/Code.gs /tmp/admin-gas.js
node --check /tmp/member-gas.js
node --check /tmp/admin-gas.js

# 完整回歸
node --test PersonalBrandTestingEnvironment/tests/*.test.js
```

Lottery workflow 額外驗證工作區去重、preparation coalescing、動畫、Canvas、會員 GAS 冪等性及入口相容性；workflow 權限為唯讀，不會自動修改或推送 `main`。

## 中文部署步驟

### GitHub Pages／靜態前端

1. 人工審查 PR 的 Files changed、CI 與本文件。
2. 合併至 `main`，不要啟用 workflow 自動改寫入口。
3. 等待 GitHub Pages 或既有靜態發布完成。
4. 使用無痕視窗或強制重新整理驗證，避免舊 HTML／JS 快取。
5. 確認會員首頁只載入 `member-lottery-v2.js` 與新模組，不載入 `member-lottery.js`。

### 會員 GAS

1. 開啟會員端 Apps Script 專案。
2. 更新 `PersonalBrandTestingEnvironment/gas/client/Code.gs`。
3. 保留既有 `appsscript.json`、Script Properties、`LINE_CHANNEL_ID`、`SPREADSHEET_ID`、允許來源與工作表名稱。
4. 執行既有 `setup()`／health 檢查；本次沒有 schema migration。
5. 在「部署 → 管理部署作業」編輯既有 Web App，建立新版本。
6. 保留原本執行身分與存取設定，優先維持既有 `/exec` URL。
7. `/exec` URL 真的改變時，才更新 `client/config.json`。

管理員 GAS 沒有程式變更，不需要因本 PR 強制發布；若同一維護窗口也要重新發布，仍必須使用獨立管理員 Apps Script 專案及管理員 LIFF Channel。

## 回滾

### 前端

1. Revert 本 PR 的前端／動畫 commit。
2. 推送至 `main` 並等待 GitHub Pages 重新發布。
3. 強制重新整理 LINE LIFF 頁面。

### 會員 GAS

1. 在 Apps Script「管理部署作業」切回上一個可用版本。
2. 若 `/exec` URL 曾改變，將 `client/config.json` 還原。
3. 不要刪除 `LotteryDraws`、`LotteryTypes`、`LotteryPrizes`、`PointCardSettings` 或 `PointRedemptions` 作為回滾手段。

前端與 GAS 可分開回滾；資料 schema 未變更，不需要資料遷移或回滾。

## 已知限制與後續擴充

- Spreadsheet 仍是線性資料儲存；紀錄量非常大時，應先量測實際 GAS execution time，再評估分片、索引工作表或外部資料庫，不能在沒有數據時過度設計。
- 5 秒快取只存在目前頁面的記憶體，不跨分頁共享；正式抽獎永遠強制更新，因此不影響正確性。
- 舊 `client/lottery.html` deep link 與 legacy 檔案暫時保留供相容及回滾；首頁不載入 legacy runtime。
- 裝置 GPU、LINE WebView 返回行為及真實網路切換仍需人工實機驗證。
