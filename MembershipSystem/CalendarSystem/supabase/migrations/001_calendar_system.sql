-- CalendarSystem V3 dedicated Supabase schema.
-- This intentionally does not reuse public.calendar_items because that table belongs
-- to the MembershipSystem calendar surface and has a different domain model.

create table if not exists public.calendar_system_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active','disabled')),
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_system_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,
  type text not null check (type in ('holiday','event','notice')),
  title text not null check (char_length(title) between 1 and 80),
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time null,
  end_time time null,
  description text not null default '' check (char_length(description) <= 1000),
  location text not null default '' check (char_length(location) <= 120),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  color text not null default '#3182B8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint calendar_system_items_date_range check (end_date >= start_date),
  constraint calendar_system_items_time_consistency check (
    (all_day and start_time is null and end_time is null)
    or
    (not all_day and start_time is not null and end_time is not null and (end_date > start_date or end_time > start_time))
  )
);

create index if not exists calendar_system_items_range_idx
  on public.calendar_system_items (start_date, end_date);
create index if not exists calendar_system_items_status_range_idx
  on public.calendar_system_items (status, start_date, end_date);
create index if not exists calendar_system_users_last_login_idx
  on public.calendar_system_users (last_login_at desc);

alter table public.calendar_system_users enable row level security;
alter table public.calendar_system_items enable row level security;

-- These tables are backend-only. GitHub Pages never queries them through Data API.
revoke all on table public.calendar_system_users from anon, authenticated;
revoke all on table public.calendar_system_items from anon, authenticated;
grant select, insert, update, delete on table public.calendar_system_users to service_role;
grant select, insert, update, delete on table public.calendar_system_items to service_role;

create or replace function public.calendar_system_apply_batch(
  p_actor_line_user_id text,
  p_operations jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_op jsonb;
  v_item jsonb;
  v_action text;
  v_expected timestamptz;
  v_row public.calendar_system_items%rowtype;
  v_result jsonb := '[]'::jsonb;
  v_now timestamptz;
begin
  if p_actor_line_user_id is null or btrim(p_actor_line_user_id) = '' then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array'
     or jsonb_array_length(p_operations) < 1 or jsonb_array_length(p_operations) > 20 then
    raise exception 'INVALID_CALENDAR_BATCH';
  end if;

  for v_op in select value from jsonb_array_elements(p_operations)
  loop
    v_action := v_op->>'action';
    v_now := clock_timestamp();

    if v_action = 'create' then
      v_item := v_op->'item';
      insert into public.calendar_system_items (
        item_id,type,title,start_date,end_date,all_day,start_time,end_time,
        description,location,status,created_by,created_at,updated_by,updated_at,color
      ) values (
        gen_random_uuid()::text,v_item->>'type',v_item->>'title',(v_item->>'startDate')::date,
        (v_item->>'endDate')::date,(v_item->>'allDay')::boolean,nullif(v_item->>'startTime','')::time,
        nullif(v_item->>'endTime','')::time,coalesce(v_item->>'description',''),coalesce(v_item->>'location',''),
        v_item->>'status',p_actor_line_user_id,v_now,p_actor_line_user_id,v_now,v_item->>'color'
      ) returning * into v_row;

    elsif v_action = 'update' then
      v_item := v_op->'item';
      if coalesce(v_op->>'expectedUpdatedAt','') = '' then raise exception 'CONFLICT'; end if;
      v_expected := (v_op->>'expectedUpdatedAt')::timestamptz;
      select * into v_row from public.calendar_system_items where item_id = v_item->>'itemId' for update;
      if not found then raise exception 'ITEM_NOT_FOUND'; end if;
      if v_row.status = 'archived' then raise exception 'ITEM_ARCHIVED'; end if;
      if v_row.updated_at <> v_expected then raise exception 'CONFLICT'; end if;
      update public.calendar_system_items set
        type=v_item->>'type',title=v_item->>'title',start_date=(v_item->>'startDate')::date,
        end_date=(v_item->>'endDate')::date,all_day=(v_item->>'allDay')::boolean,
        start_time=nullif(v_item->>'startTime','')::time,end_time=nullif(v_item->>'endTime','')::time,
        description=coalesce(v_item->>'description',''),location=coalesce(v_item->>'location',''),
        status=v_item->>'status',color=v_item->>'color',updated_by=p_actor_line_user_id,updated_at=v_now
      where id=v_row.id returning * into v_row;

    elsif v_action = 'archive' then
      if coalesce(v_op->>'expectedUpdatedAt','') = '' then raise exception 'CONFLICT'; end if;
      v_expected := (v_op->>'expectedUpdatedAt')::timestamptz;
      select * into v_row from public.calendar_system_items where item_id = v_op->>'itemId' for update;
      if not found then raise exception 'ITEM_NOT_FOUND'; end if;
      if v_row.updated_at <> v_expected then raise exception 'CONFLICT'; end if;
      if v_row.status <> 'archived' then
        update public.calendar_system_items set
          status='archived',updated_by=p_actor_line_user_id,updated_at=v_now
        where id=v_row.id returning * into v_row;
      end if;
    else
      raise exception 'INVALID_CALENDAR_BATCH';
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'action',v_action,
      'item',to_jsonb(v_row)
    ));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.calendar_system_apply_batch(text,jsonb) from public, anon, authenticated;
grant execute on function public.calendar_system_apply_batch(text,jsonb) to service_role;
