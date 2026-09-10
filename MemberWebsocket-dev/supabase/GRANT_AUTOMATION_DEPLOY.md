# Grant notification scheduling / calendar bonus deployment

This feature has three deployment parts. Deploy them together so the admin UI never points at a missing backend.

## 1. Apply the database migration

Apply:

`migrations/20260910_add_grant_notification_schedule_calendar_bonus.sql`

It adds:

- `calendar_items.bonus_points_enabled`
- `calendar_items.bonus_points`
- `scheduled_grant_messages`
- `save_calendar_item_with_bonus(...)`
- `grant_member_benefits_with_event_bonus(...)`
- `claim_due_grant_messages(...)`

The new internal table has RLS enabled and direct `anon` / `authenticated` access revoked. The new `SECURITY DEFINER` RPCs are executable only by `service_role`.

## 2. Deploy both Edge Functions

Deploy these functions with gateway JWT verification disabled because they implement their own authentication boundaries:

```bash
supabase functions deploy grant-automation --no-verify-jwt
supabase functions deploy scheduled-grant-messages --no-verify-jwt
```

`grant-automation` verifies the Admin LIFF ID token against LINE and then checks the `admins` table server-side before allowing a protected operation.

`scheduled-grant-messages` requires a separate service-to-service secret in the `x-dispatch-secret` header.

Set a strong random dispatcher secret in the Edge Function environment:

```bash
supabase secrets set GRANT_MESSAGE_DISPATCH_SECRET='<strong-random-secret>'
```

Do not put this secret in GitHub, `config.json`, browser JavaScript, logs, or analytics.

## 3. Schedule the dispatcher

Enable Supabase Cron / `pg_cron` and `pg_net`, then store the same dispatcher secret plus the project URL and publishable key in Vault. Example names used below:

- `grant_automation_project_url`
- `grant_automation_publishable_key`
- `grant_message_dispatch_secret`

Then create a once-per-minute Cron job:

```sql
select cron.schedule(
  'dispatch-scheduled-grant-messages',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name='grant_automation_project_url'
      order by updated_at desc
      limit 1
    ) || '/functions/v1/scheduled-grant-messages',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name='grant_automation_publishable_key'
        order by updated_at desc
        limit 1
      ),
      'x-dispatch-secret',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name='grant_message_dispatch_secret'
        order by updated_at desc
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Use the existing project URL / publishable key; generate the dispatcher secret separately. Do not use the `service_role` key in this Cron request.

## Expected behavior

- **Immediate**: points/service time are written first, then LINE is pushed immediately.
- **Scheduled**: points/service time are written immediately; the final notification text is stored in the queue and sent at the selected Taiwan time.
- **No message**: points/service time are written with no LINE push.
- **Calendar event bonus**: active event bonus points are determined server-side using the event date range and the member tier before the current grant. The bonus is added once to every point card selected in that grant. Multiple active events stack.
- A repeated grant `requestId` does not duplicate the point/service-time transaction. A scheduled queue entry is unique by `request_id`.

## Verification checklist

1. Save an event with bonus disabled; grant points and confirm only base points are added.
2. Save an active event for today with +2 bonus; grant 3 points and confirm the entry/balance increases by 5.
3. Create two active events (+2 and +3); grant 3 points and confirm 8 total points are added to each selected card.
4. Grant service time only; confirm no event bonus is created.
5. Select **不傳送**; confirm grant succeeds and LINE receives nothing.
6. Select **立即傳送**; confirm LINE message includes base points, event bonus, service time, tier, and currently usable tickets when available.
7. Select **預約傳送** for a future time; confirm grant is immediate, one queue row is `pending`, and the dispatcher changes it to `sent` after delivery.
8. Retry the same `requestId`; confirm no duplicate point/service-time entry is created.
9. Disable/suspend a non-admin account and confirm the automation endpoint rejects admin writes.
