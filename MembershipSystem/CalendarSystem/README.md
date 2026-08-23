# CalendarSystem V2

以 GitHub Pages + LIFF + Google Apps Script + Google Sheets 實作的日曆系統。

## 架構

```text
MembershipSystem/CalendarSystem/
├── index.html
├── config.json
├── user/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── admin/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── gas/
│   ├── Code.gs
│   ├── Auth.gs
│   ├── CalendarService.gs
│   ├── StorageBootstrap.gs
│   └── appsscript.json
└── tests/
    ├── architecture.test.js
    ├── security.test.js
    └── gas-manifest.test.js
```

## 身分與權限模型

- **Authentication**：LIFF 取得 LINE access token，GAS 每次 API request 都呼叫 LINE Verify API 驗證 token，並確認 token 的 `client_id` 與對應 LINE Login Channel ID 一致。
- **Identity**：GAS 再以同一 access token 呼叫 LINE Profile API 取得可信任的 `userId` / `displayName`。
- **Authorization**：管理端只相信 Google Sheet `Admins` 資料表，不接受前端傳入的 role / admin flag。
- **User LIFF 與 Admin LIFF 分離**：`config.json` 分別設定 `userLiffId` 與 `adminLiffId`。
- **Session**：本系統不另外發永久 session/token；每次 request 都使用目前 LIFF access token。

## 資料表

第一次執行 `setupCalendarSystem()`，或第一次 Web App request 時，GAS 會建立新的 V2 Spreadsheet 並寫入 Script Property `CALENDAR_SYSTEM_V2_SPREADSHEET_ID`。

### Users

`line_user_id, display_name, status, last_login_at, created_at, updated_at`

### Admins

`line_user_id, display_name, role, status, first_seen_at, updated_at`

管理端第一次登入如果尚未授權，系統會自動新增：

- `role = none`
- `status = pending`

並回傳 403。管理者只需在 Google Sheet 手動把該列修改為：

- `role = admin`
- `status = active`

再次整理管理端頁面即可進入。

### CalendarItems

`item_id, type, title, start_date, end_date, all_day, start_time, end_time, description, location, status, created_by, created_at, updated_by, updated_at`

- type：`holiday | event | notice`
- status：`draft | published | archived`
- archived 為 soft delete，避免直接破壞歷史資料。

### AuditLogs

`audit_id, actor_line_user_id, actor_role, action, target_type, target_id, result, detail, created_at`

不記錄 LINE access token、secret 或 credential。

## GAS 設定

### 1. 建立 Apps Script

把 `gas/` 內的 `.gs` 與 `appsscript.json` 複製到同一個 Apps Script 專案。

### 2. 設定 Script Properties

在 Apps Script → Project Settings → Script Properties 設定：

- `CALENDAR_USER_LINE_CHANNEL_ID`：User LIFF 所屬 LINE Login Channel ID
- `CALENDAR_ADMIN_LINE_CHANNEL_ID`：Admin LIFF 所屬 LINE Login Channel ID

建議 User/Admin LINE Login Channel 建立在同一個 LINE Provider 下。

`CALENDAR_SYSTEM_V2_SPREADSHEET_ID` 不需要手動填；系統可自動建立。如果要使用既有全新 Spreadsheet，也可以自行填入。

### 3. 初始化資料表

在 Apps Script 編輯器執行：

```text
setupCalendarSystem()
```

它只會建立/確認 V2 所需工作表，不會讀取或遷移舊 CalendarSystem 的資料。

### 4. Deploy Web App

Deploy → New deployment → Web app：

- Execute as：Me
- Who has access：Anyone

Web App 必須公開可呼叫，真正的存取控制由 GAS 內的 LINE token 驗證與 `Admins` authorization 執行。

### 5. 設定前端 config.json

填入：

- `gasWebAppUrl`
- `userLiffId`
- `adminLiffId`

`config.json` 只能放 public configuration，不得放 Channel Secret、access token 或其他 secret。

### 6. LIFF Endpoint URL

User LIFF：

```text
https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/user/
```

Admin LIFF：

```text
https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/admin/
```

## API actions

所有 POST request 使用 `text/plain` JSON，以避免不必要的 CORS preflight；所有受保護 action 都需要 `accessToken`。

- `user.bootstrap`
- `user.calendar.list`
- `admin.bootstrap`
- `admin.calendar.list`
- `admin.calendar.create`
- `admin.calendar.update`
- `admin.calendar.archive`

管理端 update/archive 會帶 `expectedUpdatedAt` 做 optimistic concurrency control，避免兩個管理者互相覆蓋變更。

## 安全邊界

- 不信任 client 傳入的 LINE user id / display name / role。
- GAS 不接受 client 傳入的 admin boolean。
- LINE access token 不寫入 Sheet、log、URL 或 response。
- Admin 權限只在 server-side 判斷。
- 寫入採 Script Lock，降低併發更新造成資料破壞的風險。
- 管理操作保留 AuditLogs。
- API 做 request size、欄位長度、日期格式、enum 與 rate limit 驗證。

## 測試

Repository clone 後可執行：

```bash
node --test MembershipSystem/CalendarSystem/tests/*.test.js
```

這些測試主要驗證架構與安全不變量；GAS Web App、LINE Login 與 Google Sheet 的實際整合仍需部署後做 integration verification。
