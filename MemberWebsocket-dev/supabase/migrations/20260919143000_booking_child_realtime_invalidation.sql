-- Ensure every booking data surface that can change independently emits a
-- transactional invalidation event. The shared trigger function writes one
-- member + admin invalidation per SQL statement, and clients refetch their
-- authoritative bootstrap payload after receiving the event.

drop trigger if exists realtime_booking_items_change on public.booking_items;
create trigger realtime_booking_items_change
after insert or update or delete on public.booking_items
for each statement execute function public.notify_booking_realtime_change();

drop trigger if exists realtime_booking_technicians_change on public.booking_technicians;
create trigger realtime_booking_technicians_change
after insert or update or delete on public.booking_technicians
for each statement execute function public.notify_booking_realtime_change();

drop trigger if exists realtime_booking_participants_change on public.booking_participants;
create trigger realtime_booking_participants_change
after insert or update or delete on public.booking_participants
for each statement execute function public.notify_booking_realtime_change();

drop trigger if exists realtime_booking_participant_items_change on public.booking_participant_items;
create trigger realtime_booking_participant_items_change
after insert or update or delete on public.booking_participant_items
for each statement execute function public.notify_booking_realtime_change();

drop trigger if exists realtime_booking_participant_reservations_change on public.booking_participant_reservations;
create trigger realtime_booking_participant_reservations_change
after insert or update or delete on public.booking_participant_reservations
for each statement execute function public.notify_booking_realtime_change();
