# CalendarSystem Supabase backend

CalendarSystem V3.1 uses its **own Supabase project**. Google Apps Script, Google Sheets, and `MemberWebsocket-dev` are not part of the runtime architecture.

## Production project

- Supabase project name: `CalendarSystem`
- Supabase project ref: `zrdpsobxaehqukacjjss`
- Region: `ap-northeast-1`
- Edge Function: `calendar-system-api`
- Public endpoint: `https://zrdpsobxaehqukacjjss.supabase.co/functions/v1/calendar-system-api`
- Business timezone: `Asia/Taipei`

The Edge Function uses custom LINE LIFF authentication, so Supabase platform JWT verification is disabled for this function. The function verifies the LIFF ID token with LINE before any data access.

## LIFF surfaces

- User LIFF: `2005939681-390hQmGR` → LINE Login Channel ID `2005939681`
- Admin LIFF: `2011356226-HwBcyRfS` → LINE Login Channel ID `2011356226`

The server validates `aud`, `iss`, `exp`, and `sub`; User/Admin tokens are not interchangeable.

## Database ownership

This project owns all CalendarSystem persistence and security state:

- `calendar_system_users`
- `calendar_system_items`
- `admins`
- `audit_logs`
- `api_rate_limits`
- `calendar_system_apply_batch(...)`
- `consume_api_rate_limit(...)`

No table, RPC, role state, audit state, or rate-limit state is read from `MemberWebsocket-dev`.

`migrations/001_calendar_system.sql` defines the Calendar user/item schema and transactional batch RPC. `migrations/002_standalone_support.sql` defines the CalendarSystem-specific Admin, Audit, and rate-limit components.

All backend tables have RLS enabled and browser roles (`anon`, `authenticated`) have no direct table privileges. GitHub Pages accesses data only through the Edge Function. Supabase secret/service credentials remain server-side.

## Authorization

Admin authorization is server-side and uses the **CalendarSystem project's own** `admins` table:

- `role = admin`
- `status = active`

A first-time Admin LIFF login is created as `role = none`, `status = pending` until explicitly approved in this CalendarSystem project.

## API contract

User actions: `user.bootstrap`, `user.calendar.list`.

Admin actions: `admin.bootstrap`, `admin.calendar.list`, `admin.calendar.create`, `admin.calendar.update`, `admin.calendar.archive`, `admin.calendar.bulkCreate`, `admin.calendar.bulkUpdate`, `admin.calendar.bulkArchive`, `admin.users.list`, `admin.users.updateStatus`.

Every request includes the current LIFF ID token in the HTTPS POST body. Tokens are not persisted to PostgreSQL, browser storage, URLs, analytics, or audit logs.

## Concurrency and batch writes

Single update/archive and bulk update/archive require `expectedUpdatedAt`. `calendar_system_apply_batch` locks affected rows and executes at most 20 operations in one PostgreSQL transaction; a failed batch operation rolls back the whole batch.
