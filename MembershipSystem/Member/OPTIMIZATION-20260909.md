# Member 全量即時資料載入

範圍：`MembershipSystem/Member/` 的五個 LIFF 前端與 GAS／Google Sheets 資料傳輸。此版採用「每次進入畫面都直接取得 GAS 當次最新資料」：不再使用前端 IndexedDB 顯示快照、GAS bootstrap 回應快取、資料修訂版或 `unchanged` 協商。

## 目前資料流

| 頁面 | 授權後的完整初始回應 | 進入畫面的條件 |
|---|---|---|
| 會員卡 | 本人會員資料、服務分鐘與階級進度 | `member.bootstrap` 完成並渲染 |
| 集點卡 | 所有可見卡、每張完整節點與票券、完整使用歷史 | `pointcard.bootstrap` 回傳全部 `cardDetails` 並通過完整性檢查 |
| 活動票券 | 所有可見票券完整說明／獎項、完整已使用紀錄 | `event.bootstrap` 回傳完整票券並通過完整性檢查 |
| 日曆 | 所有啟用日期及其完整說明、階級資格與安全連結 | `calendar.bootstrap` 完成並渲染 |
| 管理端 | 所有會員、階級、集點卡／票券、活動票券、日曆與統計 | `admin.bootstrap` 回傳完整欄位並通過完整性檢查 |

所有 API 仍先經 `Code.gs`、LINE ID token 驗證、會員或管理權限檢查，再由 GAS service 從 Sheets 建立當次回應。每次手動「更新」也會進行相同的完整讀取。相同未完成讀取可在同一瀏覽器工作階段合併成一個 POST；完成或失敗後不保留結果，下一次讀取必定再次向 GAS 請求。

## 保留的安全與寫入規則

- LINE ID token 與 surface Channel 綁定、會員本人資料範圍、管理員授權、會員階級與票券資格仍由 GAS 判定。
- 寫入不自動重送；回應不確定時鎖定操作並要求重新整理確認。
- `expectedUpdatedAt` 的管理端衝突檢查保留，因為它保護寫入不覆蓋他人的較新變更，並非讀取資料版本快取。
- 舊 `MembershipSystemSyncCache` 僅會被刪除，不會讀取或寫入；ID token 與會員個資不會落地。

## 影響與限制

完整載入會增加首次開啟的傳輸量、GAS／Sheets 讀取量與資料量大的等待時間；這是以即時性換取的明確設計。若 GAS 回應不完整或讀取失敗，前端不會呈現舊資料或半完成畫面，而會保留載入／錯誤狀態。這不表示已完成 LINE 裝置或已部署環境驗證。

## 本地驗證

從 repository root 執行：

```bash
node --test MembershipSystem/Member/tests/*.test.js
```

此外應解析所有 GAS 檔案、檢查瀏覽器 JavaScript 語法、執行 `git diff --check`，並確認程式碼中沒有資料修訂版、payload read-through cache 或 IndexedDB snapshot API。

## 部署與回退

本次不修改 config、LINE 設定、Spreadsheet schema 或 GitHub Actions，也不會自動部署。應先發佈 Member GAS，再發佈五個前端資產，並以真實 LINE 帳號驗證首次進入前會等待完整資料、Google Sheet 直接修改後下一次開啟會反映、以及管理端全量資料的等待時間。回退可還原這組前後端變更並切回既有 GAS deployment，不需要變更或清空任何 Sheet 資料。
