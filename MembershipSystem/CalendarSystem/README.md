# MembershipSystem CalendarSystem

獨立的「營業日曆」模組。用戶端與管理端使用不同 LIFF App；用戶端只讀取已發布休假日、活動日與當日說明，管理端只負責日曆資料管理且不提供「查看用戶端」入口。

## Authentication / Authorization

### 用戶端

```text
User
→ User LIFF App
→ LINE Login
→ liff.getIDToken()
→ GAS
→ LINE Verify ID Token API
→ validate USER_LINE_LOGIN_CHANNEL_ID / aud / exp
→ calendar read
```

### 管理端

```text
Admin
→ Admin LIFF App
→ LINE Login
→ liff.getIDToken()
→ GAS verifies ADMIN_LINE_LOGIN_CHANNEL_ID / aud / exp
→ lookup AdminPermissions by verified LINE sub
→ status=active AND canManageCalendar=TRUE
→ admin action
```

管理端**沒有額外的管理密碼、管理 token 或管理憑證輸入框**。

- Admin LIFF 負責 Authentication：確認「你是誰」。
- `AdminPermissions.canManageCalendar` 負責 Authorization：確認「你能不能管理日曆」。
- 管理權限一定由 GAS server-side 查表判斷，前端 UI 不是安全邊界。
- Admin ID Token 只存在 JavaScript runtime memory，不寫入 `localStorage`、`sessionStorage` 或 URL。

> 建議 User LIFF 與 Admin LIFF 位於不同 LINE Login Channel，分別設定 `USER_LINE_LOGIN_CHANNEL_ID` 與 `ADMIN_LINE_LOGIN_CHANNEL_ID`。這樣 User LIFF Token 無法通過 Admin channel 驗證。

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

第一次 API 呼叫會自動建立 Google Spreadsheet：

- `CalendarEvents`
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

管理端建立、更新、封存事件時，Audit actor 使用通過 Admin LIFF 驗證的 LINE `sub`。不記錄 LINE ID Token。

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
USER_LINE_LOGIN_CHANNEL_ID=<User LIFF 所屬 LINE Login Channel ID>
ADMIN_LINE_LOGIN_CHANNEL_ID=<Admin LIFF 所屬 LINE Login Channel ID>
```

為相容前一版，用戶端若未設定 `USER_LINE_LOGIN_CHANNEL_ID`，暫時會 fallback 到舊的 `LINE_LOGIN_CHANNEL_ID`。新部署應使用 `USER_LINE_LOGIN_CHANNEL_ID`。

不再需要：

```text
CALENDAR_ADMIN_TOKEN
```

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

- `member.me`
- `calendar.month`
- `calendar.day`

### Admin

欄位：

- `action`
- `payload`
- `idToken`

Actions：

- `admin.session`：建立/讀取自己的 `AdminPermissions` 狀態，不代表已授權
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
- 未登入 Admin LIFF 不得取得管理資料。
- Admin 第一次登入會自動建立 `AdminPermissions`，權限預設 `FALSE`。
- `FALSE` 或 `disabled` 不得讀取、建立、修改或封存事件。
- 手動改為 `TRUE + active` 後才能操作管理 API。
- 同一 `lineUserId` 重複資料必須 fail closed。
- 管理端不存在管理密碼 / token 輸入。
- 管理端沒有「查看用戶端」入口。
- 草稿不會出現在用戶端。
- 封存後用戶端不再顯示。
