# 美業預約系統（整合說明）

此專案為一套以 LINE LIFF + Google Apps Script(GAS) 為基礎的預約系統，包含多個前端與後端模組：

- `client/`：前台（客戶使用）
- `admin/`：管理後台（管理員使用）
- `superadmin/`：最高管理員後台（管理管理員權限）
- `technician/`：技師端（檢視個人班表與預約）
- `gas/`：Google Apps Script 後端（與 Google Sheets 同步資料）

本文檔整合各子專案的用途、重點設定、啟動與常見排查步驟。

===

## 目錄摘要

- `client/`：單頁靜態 HTML/JS，流程包含 LINE 登入、送出審核、選技師/服務/時段、送出預約。主要檔案：`index.html`, `app.js`, `styles.css`, `config.json`。
- `admin/`：管理介面，包含服務、技師、班表、休假、預約、用戶審核與管理員帳號管理。主要檔案：`index.html`, `app.js`, `styles.css`, `config.json`。採用自製 UI 與部分輔助元件（time-wheel）。
- `superadmin/`：設定誰是最高管理員與管理員權限，主要檔案同上（`index.html`, `app.js`, `config.json`）。
- `technician/`：技師專用頁面，顯示技師個人班表、可服務項目與分配給該技師的預約。主要檔案：`index.html`, `app.js`, `config.json`。
- `gas/`：Apps Script 程式碼（`Code.gs`、`appsscript.json`），負責所有讀寫 Google Sheets 的 API、權限檢查、預約衝突檢查、緩存機制等。

===

## 每個子專案重點與設定

- 共通設定（各前端資料夾的 `config.json`）
  - `gasWebAppUrl`：GAS 部署後的 Web App URL（必填）
  - `liffId`：對應 LIFF App 的 ID（若使用 LIFF 登入，必填）
  - `liffLoginRequired`：布林；設為 `false` 可於本機或開發環境跳過實際 LIFF 登入（會以測試帳號模擬）

- client/
  - 流程：載入 config -> 初始化 LIFF（若需要）-> 取得 profile -> syncLineUser -> 載入 publicData（services, technicians, schedules, reservations）
  - 常見影響預約區塊不顯示的原因：未登入 LIFF、用戶尚未通過審核（`state.user.status !== '已通過'`）、未有完成 application（需有 `customerName` 與 `phone`）、或 `gasWebAppUrl` 空白。

- admin/
  - 功能：服務 CRUD、技師 CRUD、班表維護、休假審核、用戶/預約管理
  - 權限：使用 LIFF 登入後，GAS 端會判斷該 LINE userId 是否列在 `AdminUsers` 或 `SuperAdmins` 中，並依 `pagePermissions` 與 `canManageAdmins` 控制頁面能見度與操作範圍。

- superadmin/
  - 功能：管理 `SuperAdmins` 工作表、查看所有 admin、指定哪些 admin 有管理其他 admin 權限。

- technician/
  - 功能：技師檢視個人班表、休假與分配給該技師的預約，並可以由技師本人確認預約（視需求）。

- gas/
  - 主要工作表：`Config`, `AdminUsers`, `SuperAdmins`, `Services`, `Technicians`, `Schedules`, `Users`, `Reservations`, `LeaveRequests`
  - 對外提供 API：`doGet`（publicData, adminData, technicianData, superAdminData）、`doPost`（多項 action，例如 createReservation、submitUserApplication、syncLineUser 等）
  - 重要檢查點：GAS 會在伺服器端再次驗證用戶是否已通過審核、技師班表衝突判定、避免跨日時段錯誤。

===

## 部署與本機測試步驟（快速指南）

1. 在 Google Drive 建立一個空白試算表，開啟 Apps Script，貼上 `gas/Code.gs` 與 `gas/appsscript.json`，部署為「網頁應用程式」。
   - 建議部署身分為你的帳號，並設定為「任何人（含匿名）」或依需求設定授權。部署後取得 `deploy` 的 URL，填入各前端 `config.json` 的 `gasWebAppUrl`。
2. 在 LINE Developers 建立 LIFF App（若需 LINE 登入），將 Endpoint 設為對應前端的部署網址，並把 LIFF ID 填入各 `config.json`。
3. 部署前端：可直接用靜態主機（GitHub Pages / Netlify / Vercel）或本機靜態伺服器測試：

```bash
# 簡單本機伺服器（Node）
npx http-server client -p 8080
npx http-server admin -p 8081

# 或使用 Python（3.x）

```

4. 本機測試小技巧：若不想每次都用 LIFF 登入，可在 `client/config.json`、`admin/config.json` 將 `liffLoginRequired` 設為 `false`（會以測試用戶模擬已登入，便於本機開發），但上線前務必還原為 `true`。

===

## 常見問題與排查建議

- 問：前台預約區塊（booking form）不顯示？
  - 檢查 1：`client/config.json` 的 `gasWebAppUrl` 是否正確，若為空會顯示「尚未找到 GAS Web App URL」。
  - 檢查 2：是否完成 LINE 登入（或在開發模式下把 `liffLoginRequired` 設為 `false`）。
  - 檢查 3：該用戶在 GAS 的 `Users` 工作表中是否為 `已通過`（後端會以 `syncLineUser` 與 `submitUserApplication` 更新狀態）。
  - 檢查 4：是否已填寫並送出 application（需 `customerName` 與 `phone`），前端會以此判斷是否能進入預約流程。
  - 檢查 5：console/network：前端向 GAS 發送 `publicData`、`syncLineUser` 請求是否成功（HTTP 狀態碼與回傳 JSON ）。

- 問：LIFF SDK 載入失敗或無法登入？
  - 確認 `index.html` 已載入 `https://static.line-scdn.net/liff/edge/2/sdk.js`，並且 `config.json` 的 `liffId` 與 LINE 開發者平台一致。LIFF 預設會導向 `redirectUri`，確保 LIFF 的 endpoint 與實際頁面一致（含 https/port/path）。

- 問：GAS 回傳錯誤（例如：請先設定 liffId / 請先設定 GAS Web App URL）？
  - 從前端 `config.json` 讀取設定，若檔案無法讀取（`file://`）或 CORS/部署設定不當，都會造成此行為。建議使用靜態伺服器或托管環境測試。

- 問：時段計算或跨日班表問題？
  - GAS 與前端都做過跨午夜（overnight）時段處理；若出現預期外行為，請檢查 `Schedules` 工作表中 `startTime`、`endTime` 資料格式（HH:mm），以及班表是否標記 `isWorking`。

===

## 開發者筆記（快速定位）

- 前端主要互動點：
  - `client/app.js`：載入 config、LIFF init、syncLineUser、載入 publicData、render UI、處理預約送出
  - `admin/app.js`：載入 adminData、提供 CRUD 操作、使用 time-wheel 來編輯時段
  - `superadmin/app.js`：載入 superAdminData、管理 admin 權限
  - `technician/app.js`：技師個人資料/班表檢視與操作
- 後端（GAS）主要邏輯：
  - `gas/Code.gs`：API 路由（doGet/doPost）、資料正規化、上鎖/緩存、權限驗證（verifyAdmin/verifySuperAdmin/verifyTechnician）、預約衝突檢查（getAvailableTimeSlots 與 evaluateReservationWithinTechnicianSchedule 類似的檢查）。

===

## 我已完成的整合步驟

- 探索並檢視 `client/`, `admin/`, `superadmin/`, `technician/`, `gas/` 的主要檔案（`index.html`, `app.js`, `config.json`, `Code.gs`）。
- 在本文檔中整理各子專案用途、關鍵設定、部署與常見問題排查方法。

如需我把 README 再細分成子章節（例如：逐檔案 API 摘要、重要函式說明或建立完整版部署腳本），告訴我優先順序，我會接著產出更細的技術文件或逐步部署腳本。
- `startTime`
