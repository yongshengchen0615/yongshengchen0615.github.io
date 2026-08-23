# MembershipSystem CalendarSystem

獨立的「營業日曆」模組。用戶端與管理端使用不同 LIFF App；用戶端只讀取已發布休假日、活動日與當日說明，管理端只負責日曆資料管理且不提供「查看用戶端」入口。此目錄不依賴、也不修改既有 `MembershipSystem/app/` 與 `MembershipSystem/PointsCard/`。

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
├── tests/
│   └── liff-auth.test.js
└── gas/
    ├── Code.gs
    ├── StorageBootstrap.gs
    └── appsscript.json
```

## Authentication / Authorization

### 用戶端

```text
User
→ User LIFF App
→ LINE Login
→ liff.getIDToken()
→ GAS
→ LINE Verify ID Token API
→ validate user channel aud / exp
→ calendar read
```

- 使用 `config.json` 的 `liffId`。
- LIFF 必須啟用 `openid` scope；需要顯示名稱與頭像時建議同時啟用 `profile`。
- ID Token 只存在 JavaScript runtime memory，不寫入 `localStorage` / `sessionStorage` / URL。
- `member.me`、`calendar.month`、`calendar.day` 都必須通過 GAS server-side LINE 驗證。

### 管理端

```text
Admin
→ Admin LIFF App
→ LINE Login
→ liff.getIDToken()
→ GAS verifies admin channel aud / exp
→ CALENDAR_ADMIN_TOKEN authorization
→ admin action
```

- 使用 `config.json` 的 `adminLiffId`，不得與用戶端 LIFF ID 共用。
- 管理端 LIFF 負責 Authentication；`CALENDAR_ADMIN_TOKEN` 負責 Authorization。
- 管理 API 同時要求有效的管理端 LINE ID Token 與管理憑證。
- 管理憑證只存在管理頁面的 `sessionStorage`；LINE ID Token 只存在 runtime memory。
- 管理端不提供「查看用戶端」入口。

> 如果希望後端能強制區分「這枚 Token 一定來自管理端身份域」，請讓 User LIFF 與 Admin LIFF 位於不同 LINE Login Channel，並分別設定 `USER_LINE_LOGIN_CHANNEL_ID` 與 `ADMIN_LINE_LOGIN_CHANNEL_ID`。若兩個 LIFF App 放在同一個 LINE Login Channel，LINE ID Token 的 `aud` 會是同一個 Channel ID，後端只能確認 Channel，無法從 ID Token 判斷是哪一個 LIFF App 發出的。

## 功能

### 用戶端

- User LIFF 自動登入
- 顯示已驗證的 LINE 顯示名稱與頭像
- 月曆瀏覽與上/下月切換
- 休假日、活動日視覺標示
- 點擊日期查看當日完整說明
- 只取得 `published` 事件

### 管理端

- Admin LIFF 自動登入
- 管理憑證 server-side authorization
- 新增/修改休假日與活動日
- 草稿/發布狀態
- 封存日期設定（soft delete）
- AuditLogs 記錄實際管理端 LINE `sub` 作為 actor

## Storage

第一次 API 呼叫會自動建立 Google Spreadsheet：

- `CalendarEvents`
- `AuditLogs`

`CalendarEvents`：

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

Audit 不儲存管理憑證或 LINE ID Token。

## 部署

### 1. 建立 User LIFF

Endpoint URL：

```text
https://<github-pages-host>/MembershipSystem/CalendarSystem/user/
```

`config.json`：

```json
{
  "apiUrl": "https://script.google.com/macros/s/.../exec",
  "liffId": "USER_LIFF_ID",
  "adminLiffId": "ADMIN_LIFF_ID",
  "appName": "營業日曆"
}
```

### 2. 建立 Admin LIFF

Endpoint URL：

```text
https://<github-pages-host>/MembershipSystem/CalendarSystem/admin/
```

Admin LIFF 必須是另一個 LIFF App。若需要最強隔離，放到另一個 LINE Login Channel。

### 3. GAS Script Properties

```text
CALENDAR_ADMIN_TOKEN=<至少32字元高熵管理憑證>
USER_LINE_LOGIN_CHANNEL_ID=<User LIFF 所屬 LINE Login Channel ID>
ADMIN_LINE_LOGIN_CHANNEL_ID=<Admin LIFF 所屬 LINE Login Channel ID>
```

為相容前一版，若尚未設定 `USER_LINE_LOGIN_CHANNEL_ID`，用戶端驗證暫時會 fallback 到舊的 `LINE_LOGIN_CHANNEL_ID`；新部署應改用 `USER_LINE_LOGIN_CHANNEL_ID`。

### 4. GAS Web App

- Execute as: Me
- Who has access: Anyone
- 將 `/exec` URL 寫入 `config.json.apiUrl`

`CALENDAR_ADMIN_TOKEN` 不可提交到 GitHub、不可放 URL、不可寫進前端程式碼。

## API

所有動作使用 `POST application/x-www-form-urlencoded`。

### User

欄位：`action`、`payload`、`idToken`

Actions：

- `member.me`
- `calendar.month`
- `calendar.day`

### Admin

欄位：`action`、`payload`、`idToken`、`adminToken`

Actions：

- `admin.events.list`
- `admin.event.save`
- `admin.event.delete`

## Security

- User / Admin ID Token 都在 GAS server-side 呼叫 LINE `/oauth2/v2.1/verify` 驗證。
- User 驗證 `USER_LINE_LOGIN_CHANNEL_ID`，Admin 驗證 `ADMIN_LINE_LOGIN_CHANNEL_ID`。
- 驗證 `aud` 與 `exp`；過期或 Channel 不符 Token 一律拒絕。
- ID Token cache key 使用 SHA-256 fingerprint，不保存原始 Token。
- Admin API 需要 LINE Authentication + 管理憑證 Authorization。
- 管理憑證只保存在 GAS Script Properties；前端只在目前分頁 `sessionStorage` 暫存。
- ID Token、管理憑證不寫入 log、URL、GitHub 或資料表。
- 所有事件輸入都在 server-side 驗證。
- 刪除採 soft delete，保留 audit trail。
- 前端遠端文字使用 `textContent` / `createTextNode`，不直接寫入 `innerHTML`。

## 驗證清單

- User URL 使用 User LIFF ID。
- Admin URL 使用 Admin LIFF ID。
- User / Admin LIFF ID 不相同。
- 未登入 User LIFF 不得取得日曆資料。
- 未登入 Admin LIFF 不得取得管理資料。
- User Token 不可通過設定為不同 Channel 的 Admin 驗證。
- Admin Token 不可通過設定為不同 Channel 的 User 驗證。
- Admin API 缺少管理憑證仍必須被拒絕。
- 管理端沒有「查看用戶端」入口。
- 草稿不會出現在用戶端。
- 管理端可新增、編輯、發布、改回草稿與封存。
