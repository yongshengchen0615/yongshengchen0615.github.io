# Member UI／UX、效能與傳輸優化

分析基準：`dad096cb425b18092c857443326eb5caff6e95ca`，範圍為 `MembershipSystem/Member/` 的 48 個原始檔案。修改沿用原有獨立 LIFF 前端、GAS、Google Sheets 與視覺主題，未更換框架。

## 核心判斷

目前已有摘要回傳、會員範圍讀取、伺服器快取、IndexedDB 版本同步、管理端分頁與延後載入。下一步的效益集中在移除多餘往返、控制等待時間及修正非同步流程；不需要重寫系統。

| 優先級 | 原始碼確認的問題 | 本次處理 |
|---|---|---|
| P1 | 管理端面板收到新版本後，refreshData 會等待仍指向自己的 panelLoads Promise，形成循環等待 | 重建前釋放舊請求，清理時確認仍是同一個 Promise；加入可重現回歸測試 |
| P1 | 讀取單次 20 秒、重試一次加 400ms，可能等待約 40.4 秒 | 單次 API 讀取含重試共用 9 秒預算；完整讀完 response body 才停止計時 |
| P1 | LIFF 初始化與跳轉等待沒有失敗出口 | 每階段最多等待 8 秒；遲到的初始化完成不繼續取得 token 或送出後端請求 |
| P1 | IndexedDB open／交易未回呼時，登入、切卡或登出可能一直等待 | open 與交易各 500ms 後放棄快取；遲到的連線會關閉；寫入快取不阻塞主要畫面 |
| P1 | 集點卡冷啟動需依序取得 bootstrap、首張卡 detail | 新增 includeActiveCard，使用同一份已授權快照回傳一張完整卡片；其餘卡片按需讀取 |
| P1 | full 與 compact 使用同一個伺服器 payload cache key，可能混用回應形狀 | 將 compact、includeActiveCard、activeCardId 納入 cache key；同步 schema 升為 3 使舊快照重新驗證 |
| P2 | 相同讀取同時發出時沒有統一合併 | 依 API 位址、surface、token、action、payload 合併 in-flight 讀取；完成或失敗後移除 |
| P2 | 資料就緒後仍等待 220–700ms 的進度條動畫 | 立即完成進度並交還操作 |
| P2 | 集點卡或活動票券更新失敗會把整個工作畫面換成錯誤頁 | 暫時性讀取錯誤就地提示並保留畫面；身分／會員資格錯誤仍退出工作畫面 |
| P2 | 切卡等待沒有及時顯示正確載入狀態，舊請求可能污染新的快照 | 先呈現選取卡與載入提示，僅允許對應快照接收明細；失敗可再次選取或按更新 |
| P2 | 對話框只有 Escape／關閉後返回焦點，缺少 Tab 邊界；集點卡頁籤缺少方向鍵 | 加入對話框 Tab／Shift+Tab 循環及集點卡左右／Home／End 操作 |
| P2 | 公開 config.json 每次 no-store，不能使用 HTTP 驗證快取 | 改用 no-cache，仍向伺服器驗證是否更新；API 與會員資料維持 no-store |

## 資料流與影響

| 頁面 | 主要資料路徑 | 本次影響 |
|---|---|---|
| 會員卡 | config → LIFF → member.bootstrap → 會員狀態／服務分鐘／等級 | 有界等待、移除動畫延遲、生日視窗鍵盤操作 |
| 集點卡 | config → LIFF → 本機版本候選 → pointcard.bootstrap → 必要時 detail | 初次開啟首張卡通常 2 次 API 減為 1 次；後续卡片仍由伺服器授權讀取 |
| 活動票券 | config → LIFF → event.bootstrap → 點開票券才取 detail | 快取不阻塞就緒；更新失敗保留原畫面 |
| 行事曆 | config → LIFF → calendar.bootstrap → 點日期才取 details | 保留三個月份摘要與按需明細；有界快取、移除動畫延遲 |
| 管理端 | config → LIFF → admin.bootstrap；summary 背景讀取；面板按需 list | 修正版本更新循環等待，合併重複請求，維持背景統計不阻塞 |

所有 API 仍先經 `Code.gs` → LINE token 驗證 → 會員／管理權限檢查 → GAS service → Sheets／cache。首次集點卡 inline detail 取用與獨立 detail 相同的函式，不額外放寬資料範圍。

## 可以證實與不能推定的結果

- 在新前後端一起使用、首次無快取且至少一張卡時，首張卡資料路徑由兩次 API 變成一次，並共用同一個後端快照。這是往返次數減少 50%，不是總流量或總載入時間減少 50%。
- 資料就緒後移除 220–700ms 的人工等待。
- 同時呼叫完全相同的讀取只產生一個 POST；不保存已完成 API 結果，不合併寫入。
- 9 秒是單一 API 讀取流程的等待預算。設定、LIFF、API 是不同階段，且瀏覽器背景分頁可能延後 timer，不能宣稱整段登入一定在 9 或 10 秒內成功。
- 縮短 timeout 不等於 GAS 執行變快；極慢冷啟動會較早提示重試。需要實機採樣來評估成功率與 P95。
- 未宣稱傳輸位元組下降比例、LCP、INP、CLS 或正式環境 P95 已達標。

## 驗證

從 repository 根目錄執行（Node.js 22；不需 npm install）：

```bash
node --test MembershipSystem/Member/tests/*.test.js
```

基準 102 項全部通過；修改後 122 項全部通過。新增 20 項情境測試覆蓋：相同讀取合併、帳號／端點／參數隔離、失敗後再試、payload 不得覆寫身分與 action、寫入不合併、逾時 abort、LIFF 遲到結果、IndexedDB 卡住、對話框焦點、首張卡 inline detail 與独立 API 一致、其他帳號票券不可見、過期／封存／空資料、未加入會員、回應形狀快取隔離與管理端循環等待。

### 視覺與正式環境限制

線上會員卡頁面可進入初始化，但此雲端瀏覽器跳轉 LINE 後收到 `400 Bad Request`，因此未完成登入後 UI／UX 截圖審查，不能據此判定使用者的 LIFF 設定必然錯誤。本機測試頁的瀏覽器連線亦未成功，沒有宣稱完成視覺或實機驗證；本次 UI 調整以現有程式結構及行為測試為依據。

### 部署前手動驗收

1. 在測試 GAS 部署新版本，先確認 `/exec` 的 API 版本為 `1.16.0`，再測試新前端；既有前端可繼續使用，新前端遇到舊後端沒有 inline detail 時保留獨立 detail fallback。
2. 用兩個不同 LINE 測試帳號依序開啟五個 LIFF；確認本人資料、未加入會員導引、非管理員拒絕與停用會員處理。
3. 集點卡首次開啟在 Network 應只有 bootstrap 取得首張卡；切到其他卡才送 detail。更新已選卡時檢查仍顯示該卡；快取未變更時不得渲染其他帳號的資料。
4. 快速切換 A → B → A，並在切換中更新：遲到回應不可替換目前畫面或新的快照。失敗後再次選卡可重試。
5. 開啟集點卡／活動票券後模擬離線並按更新：保留內容、提供更新失敗提示；恢復連線再按更新可正常使用。核銷與領取仍必須由伺服器成功驗證。
6. 用測試票券驗證一次核銷、餘額、歷史、連按防護與回應不確定後的按鈕鎖定；不要使用真實優惠權益做測試。
7. 管理端停在集點卡面板，另由测试帳號修改設定，再重新讀取：面板應重新載入且不會無限等待。
8. 在 320／390／768px 與桌面、LINE WebView 上確認長文字換行、訊息可見、垂直捲動、鍵盤焦點、Tab／Shift+Tab、左右方向鍵及關閉視窗後焦點。
9. 各主要路徑收集至少 30 次冷／暖啟動與慢速網路樣本，記錄成功率、主要畫面可操作時間、請求數、傳輸大小與 P95，再决定是否需要更深的 GAS／Sheets 優化。

## 部署與回退

本次不修改 config、LINE 設定、Spreadsheet schema 或 GitHub Actions，不自動核銷、合併或部署。`deploy-membership-gas.yml` 目前指向 `MembershipSystem/app/gas/`，不是本專案的 `Member/gas/`；不能假設合併此 PR 就會部署 Member GAS。需使用既有 Member GAS 發布流程更新對應 Apps Script deployment。

建議先更新 GAS，再發布前端；前端仍可對舊後端使用原有 detail 路徑。回退可還原此變更並切回 GAS 既有 deployment version，不需要清空資料表。不同回應形狀使用各自的短期伺服器快取，舊 IndexedDB 快照會在版本確認時重新取得。

## 下一階段方案

| 方案 | 收益 | 成本與限制 | 建議 |
|---|---|---|---|
| 延續現有架構，先修等待／往返／快取 | 改動範圍較小，可沿用現有測試與部署 | Sheets 冷啟動和大量歷史仍需實測 | 本次採用 |
| 依實測熱點減少 Sheets 掃描、限制大清單与加入量測 | 可改善資料量成長後的延遲 | 需真實資料量、查詢分布與監控數據 | 下一步優先 |
| 改為資料庫及獨立 API | 更適合高併發、查詢與交易 | 遷移、維運、權限與成本明顯增加 | 有容量證據再評估 |

技術依據：[Google Apps Script 最佳實務](https://developers.google.com/apps-script/guides/support/best-practices)建議減少服務呼叫及批次處理；[LINE LIFF 開發文件](https://developers.line.biz/en/docs/liff/developing-liff-apps/)說明初始化與登入回跳流程。本次仍保留 repository 明確規定的外部瀏覽器重新登入行為。
