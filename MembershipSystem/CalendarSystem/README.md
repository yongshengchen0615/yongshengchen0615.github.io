# CalendarSystem V3.1

以 **GitHub Pages + LINE LIFF + 獨立 Supabase Edge Functions + PostgreSQL** 實作的日曆系統。

V3.1 runtime **完全不使用 Google Apps Script / Google Sheets，也不依賴 MemberWebsocket-dev Supabase 專案**。

## 架構

```text
Browser / LIFF
  ├─ User LIFF  2005939681-390hQmGR
  └─ Admin LIFF 2011356226-HwBcyRfS
          │
          │ HTTPS POST + current LINE ID Token
          ▼
CalendarSystem Supabase Project
  └─ Edge Function: calendar-system-api
          │
          ├─ LINE ID Token Verify API
          ├─ Server-side Admin authorization
          ├─ Validation / Rate limit / Audit
          ▼
PostgreSQL
  ├─ calendar_system_users
  ├─ calendar_system_items
  ├─ admins
  ├─ audit_logs
  ├─ api_rate_limits
  ├─ consume_api_rate_limit(...)
  └─ calendar_system_apply_batch(...)
```

上述 tables / RPC 全部存在於 CalendarSystem 自己的 Supabase project，不與會員系統共用 Database、Admin table、Audit table 或 Rate Limit state。

## Supabase production

- Project name：`CalendarSystem`
- Project ref：`zrdpsobxaehqukacjjss`
- Region：`ap-northeast-1`
- Edge Function：`calendar-system-api`
- API：`https://zrdpsobxaehqukacjjss.supabase.co/functions/v1/calendar-system-api`
- Business timezone：`Asia/Taipei`

`config.json` 只有 public configuration：

```json
{
  "supabaseFunctionUrl": "https://zrdpsobxaehqukacjjss.supabase.co/functions/v1/calendar-system-api",
  "userLiffId": "2005939681-390hQmGR",
  "adminLiffId": "2011356226-HwBcyRfS"
}
```

不得把 Supabase secret/service key、LINE Channel Secret、ID Token 或其他 credential 放進 `config.json` 或 GitHub Pages。

## Authentication

Authentication 由 LINE LIFF 提供：

1. Browser 執行 `liff.init()`。
2. 使用者完成 LINE Login。
3. Browser 使用 `liff.getIDToken()` 取得短期 LINE ID Token。
4. Token 只透過 HTTPS POST body 傳到 `calendar-system-api`。
5. Edge Function POST 到 LINE ID Token Verify API。
6. Server 驗證 `sub`、`aud`、`iss`、`exp` 後才建立可信任 Identity。

User/Admin 使用不同 LIFF 與不同 LINE Login Channel：

- User Channel ID：`2005939681`
- Admin Channel ID：`2011356226`

因此 User LIFF token 不可拿去呼叫 Admin surface，反之亦然。

## Authorization

真正的 Authorization 一律在 CalendarSystem Supabase Edge Function 執行：

```text
LINE ID Token
→ LINE server-side verification
→ identity.lineUserId
→ CalendarSystem.admins
→ role == admin
→ status == active
→ action authorization
→ database operation
```

第一次使用 Admin LIFF，但 `admins` 尚無該 identity 時，Server 只建立 `role = none`、`status = pending`，沒有管理權限；需在 **CalendarSystem Supabase project** 明確改成 `role = admin`、`status = active`。

前端 hide/disable button 只屬 UX，不是安全邊界。

## Database

### calendar_system_users

保存 CalendarSystem 使用者服務狀態：`line_user_id`、`display_name`、`status`、`last_login_at`、timestamps。`status` 只有 `active | disabled`，不是 Role 或 Membership。

### calendar_system_items

保存 `holiday | event | notice`，支援全天/時間、日期區間、說明、地點、顏色、`draft | published | archived` 與 audit metadata。`archived` 為 soft delete。

### admins / audit_logs / api_rate_limits

這三個元件是 CalendarSystem project 內的獨立安全資料，不再使用 MemberWebsocket-dev 的同名資料。

### RLS / table access

所有 backend tables 啟用 RLS，`anon` / `authenticated` browser role 沒有直接 table privilege。GitHub Pages 不直接操作 Data API；所有資料存取必須經過 Edge Function，Supabase secret/service credential 只存在 server environment。

## Calendar business rules

- Admin 不可新增或修改已經過去的日期；時區 `Asia/Taipei`。
- `end_date >= start_date`。
- 單一事項不得跨越超過 366 天。
- 全天事項不保存開始/結束時間。
- 非全天事項必須提供合法開始與結束時間。
- 同一天非全天事項的結束時間必須晚於開始時間。
- color 使用 `#RRGGBB`。
- User 只能取得 `published`。
- Admin 可讀取 `draft` / `published` / `archived`。

## Concurrency / batch

Update / archive 都帶 `expectedUpdatedAt` 做 optimistic concurrency control。批量新增、修改、封存單次最多 20 筆，透過 `calendar_system_apply_batch(...)` 在 PostgreSQL 單一 transaction 中執行並使用 row lock；任一筆失敗則整批 rollback。

## API actions

User：`user.bootstrap`、`user.calendar.list`。

Admin：`admin.bootstrap`、`admin.calendar.list`、`admin.calendar.create`、`admin.calendar.update`、`admin.calendar.archive`、`admin.calendar.bulkCreate`、`admin.calendar.bulkUpdate`、`admin.calendar.bulkArchive`、`admin.users.list`、`admin.users.updateStatus`。

月曆一般查詢使用 `rangeStart` + `rangeEnd`，最多連續 42 天。

## Rate limit / Audit

Server 依驗證後的 LINE Identity 執行 rate limit：Read 90/minute、Write 30/minute，Batch write 依筆數計 cost。Audit 記錄 Admin login、Calendar create/update/archive 與 CalendarSystem user status change；不得保存 ID Token、password、secret 或完整 credential。

## LIFF Endpoint URL

User：`https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/user/`

Admin：`https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/admin/`

## Supabase migrations

- `supabase/migrations/001_calendar_system.sql`：Calendar user/item 與 batch RPC。
- `supabase/migrations/002_standalone_support.sql`：CalendarSystem 自己的 Admin、Audit、Rate Limit 與 rate-limit RPC。

## Testing

Repository clone 後執行：

```bash
node --test MembershipSystem/CalendarSystem/tests/*.test.js
```

實際 LINE Login、LIFF Channel、Edge Function outbound LINE Verify 與 production network 仍屬 integration verification，需用真實 LIFF session 測試。
