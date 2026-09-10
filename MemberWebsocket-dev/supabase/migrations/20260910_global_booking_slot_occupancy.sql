-- Enforce global booking-slot occupancy across all booking services.
-- A pending or confirmed booking occupies the date/time for the whole booking system.

-- Fail safely if existing data already contains overlapping active bookings.
do $$
begin
  if exists (
    select 1
    from public.bookings
    where status in ('pending', 'confirmed')
    group by booking_date, start_time
    having count(*) > 1
  ) then
    raise exception 'BOOKING_GLOBAL_SLOT_MIGRATION_CONFLICT: resolve existing overlapping pending/confirmed bookings before applying this migration';
  end if;
end;
$$;

-- Replace the previous per-service uniqueness rule with a global slot rule.
drop index if exists public.bookings_active_slot_unique;

create unique index bookings_active_slot_unique
  on public.bookings(booking_date, start_time)
  where status in ('pending', 'confirmed');

comment on index public.bookings_active_slot_unique is
  'Only one pending or confirmed booking may occupy a booking date/start time across all services.';
