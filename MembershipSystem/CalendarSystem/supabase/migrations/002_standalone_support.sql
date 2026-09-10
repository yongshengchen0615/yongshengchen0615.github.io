-- CalendarSystem standalone Supabase support schema.
-- This project must not depend on MemberWebsocket-dev tables or RPCs.

create extension if not exists pgcrypto;

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null default '',
  role text not null default 'none' check (role in ('none','admin')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null unique,
  actor_line_user_id text null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text null,
  result text not null,
  detail jsonb null,
  created_at timestamptz not null default now()
);

create table if not exists public.api_rate_limits (
  principal_hash text not null,
  bucket_at timestamptz not null,
  bucket_type text not null check (bucket_type in ('read','write')),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (principal_hash,bucket_at,bucket_type)
);

create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

alter table public.admins enable row level security;
alter table public.audit_logs enable row level security;
alter table public.api_rate_limits enable row level security;

revoke all on table public.admins from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;
revoke all on table public.api_rate_limits from anon, authenticated;

grant select, insert, update, delete on table public.admins to service_role;
grant select, insert, update, delete on table public.audit_logs to service_role;
grant select, insert, update, delete on table public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_principal_hash text,
  p_is_write boolean,
  p_cost integer default 1,
  p_read_limit integer default 90,
  p_write_limit integer default 30
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz := date_trunc('minute', now());
  v_type text := case when p_is_write then 'write' else 'read' end;
  v_limit integer := case when p_is_write then p_write_limit else p_read_limit end;
  v_count integer;
begin
  if p_cost < 1 or p_cost > 20 then return false; end if;

  insert into public.api_rate_limits(principal_hash,bucket_at,bucket_type,request_count)
  values(p_principal_hash,v_bucket,v_type,p_cost)
  on conflict(principal_hash,bucket_at,bucket_type)
  do update set request_count = public.api_rate_limits.request_count + excluded.request_count
  returning request_count into v_count;

  delete from public.api_rate_limits where bucket_at < now() - interval '2 hours';
  return v_count <= v_limit;
end;
$$;

revoke all on function public.consume_api_rate_limit(text,boolean,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,boolean,integer,integer,integer) to service_role;
