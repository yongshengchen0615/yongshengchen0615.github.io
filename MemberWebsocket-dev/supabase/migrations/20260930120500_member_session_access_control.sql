-- P1 member security: server-side session revocation and maintenance access control.
-- Formal members authenticate with LINE ID tokens, so revocation is enforced with a per-member
-- issued-at cutoff instead of relying on Supabase Auth sessions.

alter table public.members
  add column if not exists session_revoked_before timestamptz;

comment on column public.members.session_revoked_before is
  'Reject member LINE ID tokens whose iat is at or before this server-side cutoff. Null means no administrative revocation cutoff.';

create or replace function public.admin_force_logout_member(
  p_member_line_user_id text,
  p_actor text
)
returns table(
  revoked_at timestamptz,
  revoked_test_sessions integer,
  closed_presence_sessions integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_target text := nullif(btrim(coalesce(p_member_line_user_id, '')), '');
  v_member_id uuid;
  v_now timestamptz := clock_timestamp();
  v_test_sessions integer := 0;
  v_presence_sessions integer := 0;
begin
  if v_actor is null or not exists (
    select 1
    from public.admins a
    where a.line_user_id = v_actor
      and a.role = 'admin'
      and a.status = 'active'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if v_target is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  select m.id
    into v_member_id
  from public.members m
  where m.line_user_id = v_target;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.admins a
    where a.line_user_id = v_target
      and a.role = 'admin'
      and a.status = 'active'
  ) then
    raise exception 'ADMIN_FORCE_LOGOUT_ADMIN_FORBIDDEN';
  end if;

  update public.members
     set session_revoked_before = v_now,
         updated_at = now()
   where id = v_member_id;

  update public.test_login_sessions
     set revoked_at = coalesce(revoked_at, v_now)
   where member_id = v_member_id
     and revoked_at is null;
  get diagnostics v_test_sessions = row_count;

  update public.member_presence_sessions
     set last_seen_at = v_now,
         offline_at = v_now,
         offline_reason = 'admin_force_logout',
         updated_at = v_now
   where member_id = v_member_id
     and offline_at is null;
  get diagnostics v_presence_sessions = row_count;

  insert into public.audit_logs (
    audit_id,
    actor_line_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    result,
    detail
  ) values (
    'AUD-' || replace(gen_random_uuid()::text, '-', ''),
    v_actor,
    'admin',
    'admin.member.force_logout',
    'member',
    v_member_id::text,
    'success',
    jsonb_build_object(
      'revokedTestSessions', v_test_sessions,
      'closedPresenceSessions', v_presence_sessions
    )
  );

  insert into public.realtime_events(scope, event_type)
  values ('all', 'security.member.force_logout');

  return query
  select v_now, v_test_sessions, v_presence_sessions;
end;
$function$;

revoke all on function public.admin_force_logout_member(text, text) from public;
revoke all on function public.admin_force_logout_member(text, text) from anon;
revoke all on function public.admin_force_logout_member(text, text) from authenticated;
grant execute on function public.admin_force_logout_member(text, text) to service_role;

create or replace function public.enforce_maintenance_session_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_members integer := 0;
  v_test_sessions integer := 0;
  v_presence_sessions integer := 0;
  v_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    v_changed := new.maintenance_enabled is true;
  else
    v_changed := new.maintenance_enabled is distinct from old.maintenance_enabled;
  end if;

  if not v_changed then
    return new;
  end if;

  if new.maintenance_enabled is true then
    update public.members m
       set session_revoked_before = v_now,
           updated_at = now()
     where not exists (
       select 1
       from public.admins a
       where a.line_user_id = m.line_user_id
         and a.role = 'admin'
         and a.status = 'active'
     );
    get diagnostics v_members = row_count;

    update public.test_login_sessions s
       set revoked_at = coalesce(s.revoked_at, v_now)
     where s.revoked_at is null
       and exists (
         select 1
         from public.members m
         where m.id = s.member_id
           and not exists (
             select 1
             from public.admins a
             where a.line_user_id = m.line_user_id
               and a.role = 'admin'
               and a.status = 'active'
           )
       );
    get diagnostics v_test_sessions = row_count;

    update public.member_presence_sessions p
       set last_seen_at = v_now,
           offline_at = v_now,
           offline_reason = 'maintenance',
           updated_at = v_now
     where p.offline_at is null
       and exists (
         select 1
         from public.members m
         where m.id = p.member_id
           and not exists (
             select 1
             from public.admins a
             where a.line_user_id = m.line_user_id
               and a.role = 'admin'
               and a.status = 'active'
           )
       );
    get diagnostics v_presence_sessions = row_count;

    insert into public.audit_logs (
      audit_id,
      actor_line_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      result,
      detail
    ) values (
      'AUD-' || replace(gen_random_uuid()::text, '-', ''),
      new.updated_by,
      'admin',
      'admin.maintenance.enable',
      'maintenance',
      'singleton',
      'success',
      jsonb_build_object(
        'revokedMembers', v_members,
        'revokedTestSessions', v_test_sessions,
        'closedPresenceSessions', v_presence_sessions
      )
    );

    insert into public.realtime_events(scope, event_type)
    values ('all', 'security.maintenance.enabled');
  else
    insert into public.audit_logs (
      audit_id,
      actor_line_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      result,
      detail
    ) values (
      'AUD-' || replace(gen_random_uuid()::text, '-', ''),
      new.updated_by,
      'admin',
      'admin.maintenance.disable',
      'maintenance',
      'singleton',
      'success',
      jsonb_build_object('sessionsRestored', false)
    );

    insert into public.realtime_events(scope, event_type)
    values ('all', 'security.maintenance.disabled');
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_maintenance_session_policy() from public;
revoke all on function public.enforce_maintenance_session_policy() from anon;
revoke all on function public.enforce_maintenance_session_policy() from authenticated;

drop trigger if exists test_mode_settings_maintenance_session_policy
  on public.test_mode_settings;

create trigger test_mode_settings_maintenance_session_policy
after insert or update on public.test_mode_settings
for each row
execute function public.enforce_maintenance_session_policy();

-- The project can already be in maintenance when this migration is deployed.
-- Reconcile formal member sessions immediately without tearing down the explicitly
-- authorized QA test-login channel that may currently be running.
do $block$
declare
  v_now timestamptz := clock_timestamp();
begin
  if exists (
    select 1
    from public.test_mode_settings
    where id = true
      and maintenance_enabled is true
  ) then
    update public.members m
       set session_revoked_before = v_now,
           updated_at = now()
     where not exists (
       select 1
       from public.admins a
       where a.line_user_id = m.line_user_id
         and a.role = 'admin'
         and a.status = 'active'
     );

    update public.member_presence_sessions p
       set last_seen_at = v_now,
           offline_at = v_now,
           offline_reason = 'maintenance',
           updated_at = v_now
     where p.offline_at is null
       and exists (
         select 1
         from public.members m
         where m.id = p.member_id
           and not exists (
             select 1
             from public.admins a
             where a.line_user_id = m.line_user_id
               and a.role = 'admin'
               and a.status = 'active'
           )
       );

    insert into public.realtime_events(scope, event_type)
    values ('all', 'security.maintenance.reconciled');
  end if;
end;
$block$;
