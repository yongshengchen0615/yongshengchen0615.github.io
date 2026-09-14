-- Integration test against a configured development database. Always rolls back.
-- pg_net sends only after COMMIT, so no LINE messages leave this transaction.
begin;
update booking_notifications.config set enabled=false where id;
do $$
declare
  booking uuid := gen_random_uuid();
  member_id uuid;
  member_line text;
  admin_line text;
  service public.booking_services%rowtype;
  store_service public.booking_services%rowtype;
  duration integer;
  job booking_notifications.outbox%rowtype;
  request net.http_request_queue%rowtype;
  expected_count integer;
  previous_retry_key text;
  test_response_id bigint := -987654321;
begin
  select id,line_user_id into member_id,member_line from public.members limit 1;
  select line_user_id into admin_line from public.admins where status='active' and role='admin' limit 1;
  if member_id is null or admin_line is null then raise exception 'Test requires member and active administrator'; end if;
  select * into store_service from public.booking_services where id='00000000-0000-4000-8000-000000000010';
  select * into service from public.booking_services where is_active and deleted_at is null and id<>store_service.id limit 1;
  if service.id is null then raise exception 'Test requires active booking service'; end if;
  duration := service.duration_minutes+store_service.duration_minutes;
  insert into public.bookings(id,request_id,service_id,member_id,booking_date,start_time,end_time,total_duration_minutes,contact_surname,contact_salutation)
    values(booking,'notification-test-'||booking,store_service.id,member_id,'2099-12-30','09:00',
      time '09:00'+make_interval(mins=>duration),duration,'測試','mr');
  insert into public.booking_items(booking_id,service_id,service_title,unit_duration_minutes,quantity)
    values(booking,service.id,service.title,service.duration_minutes,1),
      (booking,store_service.id,store_service.title,store_service.duration_minutes,1);
  set constraints all immediate;
  select count(*) into expected_count from public.admins where role='admin' and status='active' and line_user_id ~ '^U[0-9a-f]{32}$';
  if (select count(*) from booking_notifications.outbox where booking_id=booking) <> expected_count then raise exception 'New booking recipient count mismatch'; end if;
  if not exists(select 1 from booking_notifications.outbox where booking_id=booking and channel='admin'
    and recipient=admin_line and message_text like '%新預約%' and position(service.title in message_text)>0
    and message_text like '%測試先生%' and message_text like '%2099/12/30%') then raise exception 'New booking message missing final snapshot'; end if;
  update public.bookings set admin_note='no notification for note edit' where id=booking;
  if (select count(*) from booking_notifications.outbox where booking_id=booking) <> expected_count then raise exception 'Duplicate create notification'; end if;
  update public.bookings set status='confirmed',confirmed_by=admin_line,confirmed_at=now() where id=booking;
  if (select count(*) from booking_notifications.outbox where booking_id=booking and channel='member' and recipient=member_line and message_text like '%預約已確認%')<>1 then raise exception 'Confirmation must notify owning member'; end if;
  update public.bookings set status='confirmed',admin_note='repeat confirmation' where id=booking;
  if (select count(*) from booking_notifications.outbox where booking_id=booking and channel='member')<>1 then raise exception 'Repeated confirmation duplicated notification'; end if;
  update public.bookings set status='rejected' where id=booking;
  if (select count(*) from booking_notifications.outbox where booking_id=booking) <> expected_count+1 then raise exception 'Unrequested status sent notification'; end if;

  -- Only the fixture member job is due; real queued work is not touched.
  update booking_notifications.outbox set next_attempt_at=now()+interval '1 day' where booking_id<>booking or channel='admin';
  select * into job from booking_notifications.outbox where booking_id=booking and channel='member';
  update booking_notifications.config set enabled=true where id;
  perform booking_notifications.dispatch();
  select * into request from net.http_request_queue where url like '%/booking-line-notifications' order by id desc limit 1;
  if request.id is null or request.headers ? 'Authorization' then raise exception 'Wake-up contains LINE credentials or is missing'; end if;
  if convert_from(request.body,'UTF8')::jsonb <> '{}'::jsonb then raise exception 'Wake-up should not contain personal data'; end if;
  select * into job from public.claim_booking_notifications(20) where id=job.id;
  if job.id is null or job.status<>'sending' or job.attempt_count<>1 then raise exception 'Claim failed'; end if;
  if exists(select 1 from public.claim_booking_notifications(20)) then raise exception 'Concurrent claim duplicated a leased job'; end if;
  perform public.finish_booking_notification(job.id,job.attempt_count,false,true,500,'test-500');
  if (select status from booking_notifications.outbox where id=job.id)<>'pending' then raise exception '500 did not retry'; end if;
  previous_retry_key := job.id::text;
  update booking_notifications.outbox set next_attempt_at=now() where id=job.id;
  select * into job from public.claim_booking_notifications(20) where id=job.id;
  if job.id::text<>previous_retry_key or job.attempt_count<>2 then raise exception 'Retry identity changed'; end if;
  if public.finish_booking_notification(job.id,1,true,false,200,'stale') then raise exception 'Stale lease changed delivery status'; end if;
  perform public.finish_booking_notification(job.id,2,true,false,409,'already-accepted');
  if (select status from booking_notifications.outbox where id=job.id)<>'accepted' then raise exception 'Accepted retry not finalized'; end if;
  update booking_notifications.outbox set status='sending' where id=job.id;
  perform public.finish_booking_notification(job.id,2,false,false,400,'test-400');
  if (select status from booking_notifications.outbox where id=job.id)<>'failed' then raise exception 'Permanent 400 error was retried'; end if;
  update booking_notifications.outbox set status='pending',attempt_count=5,next_attempt_at=now() where id=job.id;
  perform public.claim_booking_notifications(20);
  if (select status from booking_notifications.outbox where id=job.id)<>'failed' then raise exception 'Retry limit not enforced'; end if;
  update booking_notifications.outbox set status='sending',attempt_count=1,first_attempt_at=now()-interval '13 hours',next_attempt_at=now() where id=job.id;
  perform public.claim_booking_notifications(20);
  if (select status from booking_notifications.outbox where id=job.id)<>'failed' then raise exception 'Expired retry window not enforced'; end if;
  select * into job from booking_notifications.outbox where booking_id=booking and channel='admin' limit 1;
  update public.admins set status='disabled' where line_user_id=job.recipient;
  update booking_notifications.outbox set next_attempt_at=now() where id=job.id;
  perform public.claim_booking_notifications(20);
  if (select status from booking_notifications.outbox where id=job.id)<>'skipped' then raise exception 'Disabled admin would receive message'; end if;
  if has_function_privilege('anon','public.booking_notification_config()','EXECUTE') or
    has_function_privilege('authenticated','public.booking_notification_config()','EXECUTE') or
    has_function_privilege('anon','public.claim_booking_notifications(integer)','EXECUTE') or
    has_function_privilege('authenticated','public.claim_booking_notifications(integer)','EXECUTE') then raise exception 'Client can access delivery RPCs'; end if;
  if has_schema_privilege('anon','booking_notifications','USAGE') or has_schema_privilege('authenticated','booking_notifications','USAGE')
    or has_function_privilege('anon','booking_notifications.dispatch(integer)','EXECUTE')
    or has_function_privilege('authenticated','booking_notifications.dispatch(integer)','EXECUTE') then raise exception 'Client can access private notifications'; end if;
end;
$$;
rollback;
select 'PASS: event routing, snapshots, deduplication, leases, retries, permission checks; all test changes rolled back' as result;
