# CalendarSystem Supabase backend

CalendarSystem V3 uses Supabase only. Google Apps Script and Google Sheets are not part of the runtime architecture.

## Production project

- Supabase project ref: `dbuquirnaskrwcamdxki`
- Edge Function: `calendar-system-api`
- Public endpoint used by GitHub Pages: `https://dbuquirnaskrwcamdxki.supabase.co/functions/v1/calendar-system-api`
- Business timezone: `Asia/Taipei`

The Edge Function uses custom LINE LIFF authentication, so Supabase platform JWT verification is disabled for this function. The function itself verifies the LIFF ID token with LINE's ID Token Verify API before any data access.

## LIFF surfaces

- User LIFF: `2005939681-390hQmGR` → LINE Login Channel ID `2005939681`
- Admin LIFF: `2011356226-HwBcyRfS` → LINE Login Channel ID `2011356226`

The server validates the token `aud`, `iss`, `exp`, and `sub`. User and Admin tokens are not interchangeable.

## Database

`migrations/001_calendar_system.sql` defines the standalone CalendarSystem tables:

- `calendar_system_users`
- `calendar_system_items`
- `calendar_system_apply_batch(...)`

The existing membership `calendar_items` table is intentionally not reused because its domain model differs from this standalone CalendarSystem.

Both CalendarSystem tables have RLS enabled and browser roles (`anon`, `authenticated`) have no direct table privileges. All reads/writes go through the Edge Function. The Edge Function secret/service key must remain in Supabase environment variables and must never be added to GitHub Pages or `config.json`.

## Authorization

Admin authorization is server-side and uses the existing `admins` table:

- `role = admin`
- `status = active`

A first-time Admin LIFF login that does not yet exist is registered as `role = none`, `status = pending`; it has no management permission until explicitly approved.

## API contract

User actions:

- `user.bootstrap`
- `user.calendar.list`

Admin actions:

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

Every request includes the current LIFF ID token in the HTTPS POST body. Tokens are not persisted to PostgreSQL, browser storage, URLs, analytics, or audit logs.

## Concurrency and batch writes

Single update/archive and bulk update/archive require `expectedUpdatedAt`. `calendar_system_apply_batch` locks affected rows and executes a maximum of 20 operations in one PostgreSQL transaction, so a failed bulk operation rolls back the entire batch.

## Deployment notes

The production schema migrations and Edge Function were applied directly to the Supabase project during the V3 migration. Future backend changes should be represented as additional SQL files in this directory and the deployed Edge Function should be exported/versioned before modification.

The previous Google Sheet data is not automatically imported by this migration. If historical CalendarSystem data must be preserved, export the old `Users`/`CalendarItems` data and perform a separate validated one-time import into the dedicated Supabase tables.
