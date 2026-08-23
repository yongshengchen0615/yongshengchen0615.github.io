# MembershipSystem CalendarSystem

獨立的「營業日曆」模組。用戶端透過 LINE LIFF 登入後查看已發布的休假日、活動日與當日說明；管理端維持獨立管理憑證，只負責日曆資料管理，不提供「查看用戶端」入口。此目錄不依賴、也不修改既有 `MembershipSystem/app/` 與 `MembershipSystem/PointsCard/`。

## 目錄

```text
CalendarSystem/
├── index.html
├── config.json
├── user/
│   ├── index.html
│   ├── styles.css
│   ├── auth.css
│   └── app.js
├── admin/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── gas/
    ├── Code.gs
    ├── StorageBootstrap.gs
    └── appsscript.json
```

## Authentication / Authorization

### 用戶端

Authentication flow：

```text
User
→ LIFF init
→ LINE Login
→ liff.getIDToken()
→ POST ID Token to GAS
→ GAS calls LINE /oauth2/v2.1/verify
→ validate aud / exp
→ authenticated calendar read
```

- LIFF 必須啟用 `openid` scope。
- ID Token 只存在 JavaScript runtime memory，不寫入 `localStorage` / `sessionStorage` / URL。
- GAS 不信任前端解碼結果；身分資料由 LINE Verify ID Token API 驗證後取得。
- `calendar.month`、`calendar.day` 與 `member.me` 都必須先通過 LINE 身分驗證。
- CalendarSystem 不會因 LIFF 登入自動建立 Membership、Role 或 Permission 資料。

### 管理端

管理端與 LIFF 身分分離：

- 管理端不需要 LIFF。
- 管理端不提供「查看用戶端」入口。
- 管理端使用 `CALENDAR_ADMIN_TOKEN` 驗證。
- Authorization 一律由 GAS server-side 執行。
- 管理憑證只存在管理頁面的 `sessionStorage`，關閉分頁後即失效。

## 功能

### 用戶端

- LINE LIFF 自動登入
- 顯示已驗證的 LINE 顯示名稱與頭像
- 月曆瀏覽與上/下月切換
- 休假日、活動日視覺標示
- 點擊日期查看當日完整說明
- 顯示本月已發布事件
- 只讀取 `published` 狀態，草稿與封存資料不會回傳

### 管理端

- 管理憑證伺服器端驗證
- 新增/修改休假日與活動日
- 草稿/發布狀態
- 封存日期設定（soft delete）
- 月曆與本月事件清單同步

### GAS / Storage

第一次 API 呼叫會自動建立 Google Spreadsheet：

- `CalendarEvents`
- `AuditLogs`

`CalendarEvents` 欄位：

| 欄位 | 用途 |
|---|---|
| eventId | 事件唯一 ID |
| date | `YYYY-MM-DD` |
| type | `holiday` / `activity` |
| title | 標題 |
| description | 當日說明 |
| status | `draft` / `published` / `archived` |
| createdAt | 建立時間 |
| updatedAt | 更新時間 |

`AuditLogs` 記錄管理端新增、更新與封存操作，不儲存管理憑證或 LINE ID Token。

## 部署

### 1. LINE Developers

在與 CalendarSystem 使用者相同的 LINE Login Channel 中建立 LIFF app：

- Endpoint URL：GitHub Pages 的 `MembershipSystem/CalendarSystem/user/`
- Scope：至少勾選 `openid`
- 將 LIFF ID 寫入 `config.json` 的 `liffId`
- 記下該 LINE Login Channel 的 **Channel ID**

> 不要直接沿用其他系統的 LIFF ID，除非該 LIFF app 的 Endpoint URL 本來就是 CalendarSystem。不同前端入口應使用對應的 LIFF app 設定。

### 2. Google Apps Script

1. 建立 Google Apps Script 專案。
2. 將 `gas/Code.gs`、`gas/StorageBootstrap.gs`、`gas/appsscript.json` 同步至 GAS。
3. 在 GAS **Script Properties** 新增：
   - `CALENDAR_ADMIN_TOKEN`: 至少 32 個隨機字元的高熵管理憑證。
   - `LINE_LOGIN_CHANNEL_ID`: Calendar LIFF 所屬 LINE Login Channel 的數字 Channel ID。
4. 部署為 Web App：
   - Execute as: Me
   - Who has access: Anyone
5. 將 Web App `/exec` URL 寫入 `config.json` 的 `apiUrl`。

### 3. `config.json`

```json
{
  "apiUrl": "https://script.google.com/macros/s/.../exec",
  "liffId": "1234567890-xxxxxxxx",
  "appName": "營業日曆"
}
```

`CALENDAR_ADMIN_TOKEN` 不可提交到 GitHub、不可放在 URL、不可寫進前端程式碼。

## API

所有動作使用 `POST application/x-www-form-urlencoded`。

### User / LIFF

欄位：

- `action`
- `payload`: JSON 字串
- `idToken`: `liff.getIDToken()` 取得的 LINE ID Token

Actions：

- `member.me`
- `calendar.month`
  - payload: `{ "year": 2026, "month": 8 }`
- `calendar.day`
  - payload: `{ "date": "2026-08-23" }`

未提供、過期、Channel 不符或無法通過 LINE 驗證的 ID Token，一律不得取得日曆資料。

### Admin

欄位：

- `action`
- `payload`
- `adminToken`

Actions：

- `admin.events.list`
- `admin.event.save`
- `admin.event.delete`

## Security

- User Authentication 使用 LIFF ID Token，並在 GAS server-side 透過 LINE 驗證。
- 驗證 `aud` 必須等於 `LINE_LOGIN_CHANNEL_ID`。
- 驗證 ID Token `exp`，過期 Token 不接受。
- ID Token 驗證結果只短暫存在 GAS Cache，且 cache key 使用 Token SHA-256 fingerprint。
- ID Token、管理密鑰不寫入 log、URL、GitHub 或資料表。
- 用戶端 API rate limit 依已驗證 LINE identity 分流。
- 管理密鑰只保存在 GAS Script Properties。
- 管理 API 具備 rate limit。
- 所有日期、類型、狀態、標題與說明都在 server-side 驗證。
- 刪除採 soft delete，保留資料與 audit trail。
- 用戶端只取得已發布事件與必要 LINE profile 欄位。
- 前端所有遠端文字使用 `textContent` / `createTextNode`，不把管理輸入直接寫入 `innerHTML`。

## 驗證清單

- 未登入外部瀏覽器會導向 LINE Login。
- LINE LIFF Browser 可完成 `liff.init()` 並取得 ID Token。
- 未設定 `openid` 時，用戶端會明確顯示 ID Token 錯誤。
- 未提供 ID Token 直接呼叫 `calendar.month` / `calendar.day` 會被拒絕。
- 偽造、過期、其他 LINE Channel 的 ID Token 會被拒絕。
- 合法 LIFF 使用者可切換月份並查看已發布事件。
- 草稿不會出現在用戶端。
- 管理端沒有「查看用戶端」入口。
- 管理端不需要 LIFF 即可使用管理憑證登入。
- 未提供或錯誤管理憑證無法讀取管理資料或寫入。
- 管理端可新增、編輯、發布、改回草稿與封存。
- 封存後用戶端不再顯示。
- Event / Audit sheet 可自動建立。
