-- Protect calendar rows managed by activity tickets.
-- Generic calendar delete paths must not remove these rows. The activity-ticket
-- workflow uses delete_event_ticket_calendar_item(...) instead.

create or replace function public.is_event_ticket_calendar_item(
  p_item_type text,
  p_link_url text
)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select
    coalesce(p_item_type, '') = 'event'
    and coalesce(p_link_url, '') ~ '(^|[?&])source=event-ticket-calendar(&|$)';
$function$;

create or replace function public.prevent_event_ticket_calendar_direct_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.is_event_ticket_calendar_item(old.item_type, old.link_url)
     and coalesce(current_setting('app.event_ticket_calendar_delete', true), '') <> 'allow' then
    raise exception 'EVENT_TICKET_CALENDAR_MANAGED';
  end if;
  return old;
end;
$function$;

drop trigger if exists prevent_event_ticket_calendar_direct_delete
  on public.calendar_items;

create trigger prevent_event_ticket_calendar_direct_delete
before delete on public.calendar_items
for each row
execute function public.prevent_event_ticket_calendar_direct_delete();

create or replace function public.delete_event_ticket_calendar_item(
  p_actor_line_user_id text,
  p_calendar_item_id text,
  p_event_ticket_id text,
  p_expected_updated_at text default ''
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.calendar_items%rowtype;
  v_expected timestamptz;
begin
  if length(trim(coalesce(p_actor_line_user_id, ''))) = 0
     or length(trim(coalesce(p_calendar_item_id, ''))) = 0
     or length(trim(coalesce(p_event_ticket_id, ''))) = 0 then
    raise exception 'INVALID_INPUT';
  end if;

  select *
    into v_row
  from public.calendar_items
  where calendar_item_id = p_calendar_item_id
  for update;

  if not found then
    raise exception 'CALENDAR_ITEM_NOT_FOUND';
  end if;

  if not public.is_event_ticket_calendar_item(v_row.item_type, v_row.link_url)
     or position('eventTicketId=' || p_event_ticket_id in coalesce(v_row.link_url, '')) = 0 then
    raise exception 'EVENT_TICKET_CALENDAR_SOURCE_MISMATCH';
  end if;

  if trim(coalesce(p_expected_updated_at, '')) <> '' then
    begin
      v_expected := p_expected_updated_at::timestamptz;
    exception when others then
      raise exception 'CONFLICT';
    end;
    if v_row.updated_at <> v_expected then
      raise exception 'CONFLICT';
    end if;
  end if;

  perform set_config('app.event_ticket_calendar_delete', 'allow', true);

  delete from public.calendar_items
  where calendar_item_id = p_calendar_item_id;

  insert into public.audit_logs(
    audit_id,
    actor_line_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    result,
    detail
  )
  values(
    public.new_public_id('AUD'),
    p_actor_line_user_id,
    'admin',
    'admin.event-ticket-calendar.delete',
    'calendar_item',
    p_calendar_item_id,
    'success',
    jsonb_build_object(
      'eventTicketId', p_event_ticket_id,
      'source', 'event-ticket-calendar'
    )
  );

  return true;
end;
$function$;

revoke all on function public.delete_event_ticket_calendar_item(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.delete_event_ticket_calendar_item(text,text,text,text)
  to service_role;

revoke all on function public.is_event_ticket_calendar_item(text,text)
  from public, anon, authenticated;
grant execute on function public.is_event_ticket_calendar_item(text,text)
  to service_role;
