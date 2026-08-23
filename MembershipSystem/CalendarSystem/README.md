# MembershipSystem CalendarSystem

獨立的「營業日曆」模組。用戶端與管理端使用不同 LIFF App；用戶端只讀取已發布休假日、活動日與當日說明，管理端只負責日曆資料管理且不提供「查看用戶端」入口。

## Authentication / Authorization

### 用戶端

```text
User
→ User LIFF App
→ LINE Authentication
→ liff.getIDToken()
→ GAS
→ LINE Verify ID Token API
→ validate USER_LINE_LOGIN_CHANNEL_ID / aud / exp
→ record LineIdentities(surface=user)
→ calendar read
```

### 管理端

```text
Admin
→ Admin LIFF App
→ LINE Authentication
→ liff.getIDToken()
→ GAS verifies ADMIN_LINE_LOGIN_CHANNEL_ID / aud / exp
→ record LineIdentities(surface=admin)
→ lookup AdminPermissions by verified LINE sub
→ status=active AND canManageCalendar=TRUE
→ admin action
```

管理端**沒有額外的管理密碼、管理 token 或管理憑證輸入框**。

- Admin LIFF 負責 Authentication：確認「你是誰」。
- `AdminPermissions.canManageCalendar` 負責 Authorization：確認「你能不能管理日曆」。
- 管理權限一定由 GAS server-side 查表判斷，前端 UI 不是安全邊界。
- User / Admin ID Token 都只存在 JavaScript runtime memory，不寫入 `localStorage`、`sessionStorage` 或 URL。

### 每次進入都重新驗證

User 與 Admin 每次重新進入各自頁面，都必須重新取得 LIFF 登入狀態並把 ID Token 送到 GAS 做 server-side LINE Verify。

執行環境差異：

- **LIFF Browser**：LINE 官方機制是在 `liff.init()` 時自動完成登入，不能再呼叫 `liff.login()` 強制顯示另一個登入畫面；但 GAS 仍會在每次頁面進入時重新驗證 ID Token。
- **外部瀏覽器 / 非 LIFF Browser**：本專案每次進入頁面會清除現有 LIFF 登入狀態，再重新走 `liff.login()`。

因此「每次進入都必須 Authentication」是 server-side 安全邊界；是否看到 LINE 登入畫面取決於 LINE 執行環境。

> 建議 User LIFF 與 Admin LIFF 位於不同 LINE Login Channel，分別設定 `USER_LINE_LOGIN_CHANNEL_ID` 與 `ADMIN_LINE_LOGIN_CHANNEL_ID`。這樣 User LIFF Token 無法通過 Admin channel 驗證。

## LineIdentities

User 或 Admin 每次成功完成 LINE 驗證後，GAS 都會建立或更新 `LineIdentities`。

唯一識別邏輯為：

```text
lineUserId + surface
```

欄位：

| 欄位 | 用途 |
|---|---|
| lineUserId | LINE Verify API 驗證後的 `sub` |
| surface | `user` / `admin` |
| displayName | 驗證後 LINE 顯示名稱 |
| pictureUrl | 驗證後 LINE 頭像 URL |
| firstSeenAt | 第一次成功登入時間 |
| lastLoginAt | 最近一次成功登入時間 |
| loginCount | 成功登入次數 |

第一次成功登入會建立 `loginCount=1`；後續每次成功登入更新 `lastLoginAt` 並遞增 `loginCount`。

相同 `lineUserId + surface` 如果出現重複資料，GAS 會以 `DATA_INTEGRITY_ERROR` fail closed，不任意挑選資料列。

## AdminPermissions

第一次用 Admin LIFF 登入時，如果 `AdminPermissions` 找不到該 LINE `sub`，GAS 會自動新增一筆：

| 欄位 | 預設值 / 用途 |
|---|---|
| lineUserId | LINE Verify API 驗證後的 `sub`，不可自行猜測 |
| displayName | 驗證後的 LINE 顯示名稱 |
| canManageCalendar | `FALSE`，預設拒絕管理權限 |
| status | `active` |
| note | 手動備註 |
| firstSeenAt | 第一次進入 Admin LIFF 的時間 |

要授權管理員時，直接在 Google Sheet 手動修改：

```text
canManageCalendar = TRUE
status = active
```

要停權時可使用任一方式：

```text
canManageCalendar = FALSE
```

或：

```text
status = disabled
```

修改後管理端按「重新檢查權限」即可重新向 GAS 查詢。

### 安全規則

- 新帳號一律建立為 `canManageCalendar=FALSE`，採 fail-closed。
- 相同 `lineUserId` 若出現兩筆以上，GAS 以 `DATA_INTEGRITY_ERROR` 拒絕授權，不任選其中一筆。
- `displayName` 只作顯示，不參與授權。
- `lineUserId` 只接受 LINE server-side Verify 後取得的 `sub`。
- 每一個 `admin.events.list`、`admin.event.save`、`admin.event.delete` 都重新查 `AdminPermissions`，不是只在前端登入時檢查一次。

## Storage

`setupCalendarStorage()` 或第一次需要 Storage 的 API 呼叫會 ensure 以下工作表存在：

- `CalendarEvents`
- `LineIdentities`
- `AdminPermissions`
- `AuditLogs`

### CalendarEvents

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

### AdminPermissions

| 欄位 | 用途 |
|---|---|
| lineUserId | Admin LINE identity |
| displayName | 顯示名稱 |
| canManageCalendar | 日曆管理 Permission |
| status | `active` / `disabled` |
| note | 管理備註 |
| firstSeenAt | 首次登入時間 |

### AuditLogs

- User / Admin 成功登入會記錄 `LOGIN_SUCCESS`。
- 首次建立 LINE 身分會記錄 `LINE_IDENTITY_CREATED`。
- 管理端建立、更新、封存事件時，Audit actor 使用通過 Admin LIFF 驗證的 LINE `sub`。
- 不記錄 LINE ID Token、Access Token、Secret。

> 因為權限是直接手動修改 Google Sheet，Google Sheet 內的權限欄位變更不會由 CalendarSystem API 產生 Audit Event；如果需要完整的「誰改了誰的權限」稽核，後續應改成受保護的權限管理 API，而不是直接編輯 Sheet。

## 部署

### config.json

```json
{
  "apiUrl": "https://script.google.com/macros/s/.../exec",
  "liffId": "USER_LIFF_ID",
  "adminLiffId": "ADMIN_LIFF_ID",
  "appName": "營業日曆"
}
```

User LIFF Endpoint：

```text
https://<github-pages-host>/MembershipSystem/CalendarSystem/user/
```

Admin LIFF Endpoint：

```text
https://<github-pages-host>/MembershipSystem/CalendarSystem/admin/
```

兩個 LIFF 都至少需要 `openid` scope；需要顯示名稱與頭像時建議同時啟用 `profile`。

### GAS Script Properties

```text
CALENDAR_SPREADSHEET_ID=<Calendar Spreadsheet ID>
USER_LINE_LOGIN_CHANNEL_ID=<User LIFF 所屬 LINE Login Channel ID>
ADMIN_LINE_LOGIN_CHANNEL_ID=<Admin LIFF 所屬 LINE Login Channel ID>
```

為相容前一版，用戶端若未設定 `USER_LINE_LOGIN_CHANNEL_ID`，暫時會 fallback 到舊的 `LINE_LOGIN_CHANNEL_ID`。新部署應使用 `USER_LINE_LOGIN_CHANNEL_ID`。

不再需要：

```text
CALENDAR_ADMIN_TOKEN
```

### appsscript.json

使用 `UrlFetchApp` 呼叫 LINE Verify API，因此至少需要：

```text
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/script.external_request
```

修改 OAuth scopes 後，需要重新授權 Apps Script，再建立新的 Web App deployment version。

### GAS Web App

- Execute as: Me
- Who has access: Anyone
- 將 `/exec` URL 寫入 `config.json.apiUrl`

## API

所有動作使用 `POST application/x-www-form-urlencoded`。

### User

欄位：

- `action`
- `payload`
- `idToken`

Actions：

- `member.me`：驗證 LINE 身分並建立/更新 `LineIdentities(surface=user)`
- `calendar.month`
- `calendar.day`

### Admin

欄位：

- `action`
- `payload`
- `idToken`

Actions：

- `admin.session`：驗證 LINE 身分、建立/更新 `LineIdentities(surface=admin)`、建立/讀取自己的 `AdminPermissions` 狀態；不代表已授權
- `admin.events.list`
- `admin.event.save`
- `admin.event.delete`

後三個管理 API 必須同時滿足：

```text
Valid Admin LIFF Identity
AND
AdminPermissions.status = active
AND
AdminPermissions.canManageCalendar = TRUE
```

## Verification Checklist

- User URL 使用 User LIFF ID。
- Admin URL 使用 Admin LIFF ID。
- 每次重新進入 User/Admin 頁面都重新執行 LINE Authentication flow。
- 外部瀏覽器不沿用既有 LIFF login session 直接進入功能頁。
- LIFF Browser 每次進入都由 `liff.init()` 自動取得登入身分，再由 GAS 驗證 ID Token。
- User 第一次成功登入會建立 `LineIdentities(surface=user)`。
- Admin 第一次成功登入會建立 `LineIdentities(surface=admin)`。
- Admin 第一次成功登入會自動建立 `AdminPermissions`，權限預設 `FALSE`。
- 每次成功登入更新 `lastLoginAt` 與 `loginCount`。
- `FALSE` 或 `disabled` 不得讀取、建立、修改或封存事件。
- 手動改為 `TRUE + active` 後才能操作管理 API。
- 同一 identity / permission 出現重複資料必須 fail closed。
- 管理端不存在管理密碼 / token 輸入。
- 管理端沒有「查看用戶端」入口。
- 草稿不會出現在用戶端。
- 封存後用戶端不再顯示。
