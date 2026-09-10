# CalendarSystem V3

以 **GitHub Pages + LINE LIFF + Supabase Edge Functions + PostgreSQL** 實作的獨立日曆系統。

V3 runtime **完全不使用 Google Apps Script 或 Google Sheets**。

## 架構

```text
Browser / LIFF
  ├─ User LIFF  2005939681-390hQmGR
  └─ Admin LIFF 2011356226-HwBcyRfS
          │
          │ HTTPS POST + current LINE ID Token
          ▼
Supabase Edge Function: calendar-system-api
          │
          ├─ LINE ID Token Verify API
          ├─ Server-side Admin authorization
          ├─ Validation / Rate limit / Audit
          ▼
PostgreSQL
  ├─ calendar_system_users
  ├─ calendar_system_items
  ├─ admins                    # 共用既有管理員授權資料
  ├─ audit_logs                # 共用既有稽核紀錄
  └─ calendar_system_apply_batch(...)
```

Repository：

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
│   ├── app.js
│   ├── bulk-actions.js
│   ├── bulk-create-ux.js
│   └── user-access.js
├── shared/
├── supabase/
│   ├── README.md
│   └── migrations/
│       └── 001_calendar_system.sql
└── tests/
```

## Supabase production

- Project ref：`dbuquirnaskrwcamdxki`
- Region：`ap-northeast-1`
- Edge Function：`calendar-system-api`
- API：`https://dbuquirnaskrwcamdxki.supabase.co/functions/v1/calendar-system-api`
- Business timezone：`Asia/Taipei`

`config.json` 只有 public configuration：

```json
{
  "supabaseFunctionUrl": "https://dbuquirnaskrwcamdxki.supabase.co/functions/v1/calendar-system-api",
  "userLiffId": "2005939681-390hQmGR",
  "adminLiffId": "2011356226-HwBcyRfS"
}
```

不得把 Supabase secret/service key、LINE Channel Secret、ID Token 或其他 credential 放進 `config.json` 或 GitHub Pages。

## Authentication

Authentication 仍由 LINE LIFF 提供：

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

本系統不把 LINE ID Token 寫入 PostgreSQL、URL、localStorage、sessionStorage、analytics 或 audit log。

## Authorization

真正的 Authorization 一律在 Supabase Edge Function 執行。

管理端流程：

```text
LINE ID Token
→ LINE server-side verification
→ identity.lineUserId
→ Supabase admins
→ role == admin
→ status == active
→ action authorization
→ database operation
```

第一次使用 Admin LIFF，但 `admins` 尚無該 identity 時，Server 只建立：

- `role = none`
- `status = pending`

這筆資料**沒有管理權限**。需由已授權管理者在 Supabase 將它明確改成：

- `role = admin`
- `status = active`

前端 hide/disable button 只屬 UX，不是安全邊界。

## Database

### calendar_system_users

保存獨立 CalendarSystem 的使用者服務狀態：

- `line_user_id`
- `display_name`
- `status`：`active | disabled`
- `last_login_at`
- `created_at`
- `updated_at`

這不是 Role 或 Membership。它只表示這個 Identity 是否允許使用 CalendarSystem。

### calendar_system_items

- `item_id`
- `type`：`holiday | event | notice`
- `title`
- `start_date`
- `end_date`
- `all_day`
- `start_time`
- `end_time`
- `description`
- `location`
- `status`：`draft | published | archived`
- `color`
- `created_by`
- `created_at`
- `updated_by`
- `updated_at`

`archived` 為 soft delete。

V3 **沒有共用既有 MembershipSystem 的 `calendar_items`**，因為兩邊欄位與 business rule 不同；強行共用會讓獨立日曆與會員日曆形成錯誤耦合。

### RLS / table access

`calendar_system_users` 與 `calendar_system_items` 都啟用 RLS，而且 `anon` / `authenticated` browser role 沒有直接 table privilege。

GitHub Pages 不直接操作 Data API；所有資料存取必須經過 Edge Function。Supabase secret/service credential 只存在 server environment。

## Calendar business rules

- Admin 不可新增或修改已經過去的日期；判斷時區為 `Asia/Taipei`。
- `end_date >= start_date`。
- 單一事項不得跨越超過 366 天。
- 全天事項不保存開始/結束時間。
- 非全天事項必須提供合法開始與結束時間。
- 同一天的非全天事項，結束時間必須晚於開始時間。
- color 使用 `#RRGGBB`。
- User 只能取得 `published`。
- Admin 可以看 `draft` / `published` / `archived`，UI 預設不顯示已封存項目於可操作清單。

## Concurrency / batch

Update / archive 都帶 `expectedUpdatedAt` 做 optimistic concurrency control。

批量新增、修改、封存單次最多 20 筆，透過 PostgreSQL `calendar_system_apply_batch(...)` 執行；RPC 對更新資料使用 row lock，整批在單一 transaction 內完成。任一筆驗證或 concurrency 失敗，整批 rollback。

## API actions

所有 request 都是 HTTPS POST JSON body，受保護操作都需要目前 LIFF ID Token。

User：

- `user.bootstrap`
- `user.calendar.list`

Admin：

- `admin.bootstrap`
- `admin.calendar.list`
- `admin.calendar.create`
- `admin.calendar.update`
- `admin.calendar.archive`
- `admin.calendar.bulkCreate`
- `admin.calendar.bulkUpdate`
- `admin.calendar.bulkArchive`
- `admin.users.list`
- `admin.users.updateStatus`

月曆一般查詢使用 `rangeStart` + `rangeEnd`，最多連續 42 天。批量編輯需要完整管理清單時可省略 range。

## Rate limit

Server 使用 Supabase database rate-limit RPC：

- Read：90 / minute
- Write：30 / minute
- Batch write 依實際筆數計算 cost

Rate limit 依已驗證的 LINE Identity 計算，不信任 client 自行傳入 user id。

## Audit

需要保留的管理事件包含：

- Admin login
- Calendar item create/update/archive
- CalendarSystem user status change

Audit 不保存 ID Token、secret 或 credential。

## LIFF Endpoint URL

User：

```text
https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/user/
```

Admin：

```text
https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/admin/
```

User/Admin LIFF 都需要 `openid` scope；若需要 LINE profile 顯示資料則也保留 `profile` scope。

## 資料遷移範圍

V3 backend/schema 已切換到 Supabase，但**不會自動讀取或匯入舊 Google Sheet 資料**。

如果舊 CalendarSystem 的 `Users` / `CalendarItems` 有需要保留的歷史資料，必須另做一次性資料遷移：

1. 匯出舊資料。
2. 驗證日期、enum、時間、color 與 duplicate item ID。
3. 轉換成 V3 schema。
4. 先在 transaction/staging 驗證筆數與資料完整性。
5. 再匯入 production。

不要為了省步驟讓正式 V3 runtime 保留舊 backend fallback，否則就不再是「完全不使用 GAS」。

## 測試

Repository clone 後：

```bash
node --test MembershipSystem/CalendarSystem/tests/*.test.js
```

測試應至少覆蓋：

- Supabase-only architecture invariant
- LIFF ID Token 使用方式
- Server-side authorization boundary
- RLS / browser direct-access restriction
- Calendar input validation
- optimistic concurrency
- batch limit / soft archive
- 42-day visible range
- User mobile swipe / desktop wheel navigation
- DOM injection regression
- credential persistence regression

實際 LINE Login、LIFF Channel、Edge Function outbound LINE Verify 與 production network 仍屬 integration verification，需用真實 LIFF session 測試。
