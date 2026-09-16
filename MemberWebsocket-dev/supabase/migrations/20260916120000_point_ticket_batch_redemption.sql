alter table public.point_cards
  add column if not exists max_tickets_per_redemption integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'point_cards_max_tickets_per_redemption_check'
      and conrelid = 'public.point_cards'::regclass
  ) then
    alter table public.point_cards
      add constraint point_cards_max_tickets_per_redemption_check
      check (max_tickets_per_redemption between 1 and 50);
  end if;
end $$;

comment on column public.point_cards.max_tickets_per_redemption is
  'Maximum number of currently available tickets from this point card that a member may redeem in one atomic redemption request.';

create or replace function public.save_point_card(
  p_actor_line_user_id text,
  p_card jsonb,
  p_expected_updated_at timestamptz
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card_id text := nullif(trim(p_card->>'cardId'),'');
  v_id uuid;
  v_now timestamptz := now();
  v_reward jsonb;
  v_template_id uuid;
  v_threshold integer;
  v_reward_row_id uuid;
  v_matched_reward_ids uuid[] := array[]::uuid[];
  v_max_tickets integer := 1;
begin
  begin
    v_max_tickets := coalesce(nullif(p_card->>'maxTicketsPerRedemption','')::integer,1);
  exception when others then
    raise exception 'INVALID_TICKET_USE_LIMIT';
  end;
  if v_max_tickets < 1 or v_max_tickets > 50 then raise exception 'INVALID_TICKET_USE_LIMIT'; end if;

  if v_card_id is null then
    v_card_id := public.new_public_id('PC');
    insert into public.point_cards(
      card_id,title,status,accent,style_key,expiry_mode,expires_on,sort_order,usage_method,usage_instructions,benefit_description,max_tickets_per_redemption,
      created_by,updated_by
    ) values(
      v_card_id,trim(p_card->>'title'),p_card->>'status',p_card->>'accent',p_card->>'styleKey',p_card->>'expiryMode',
      nullif(p_card->>'expiresOn','')::date,coalesce((select max(sort_order)+1 from public.point_cards),0),
      coalesce(p_card->>'usageMethod',''),coalesce(p_card->>'usageInstructions',''),coalesce(p_card->>'benefitDescription',''),v_max_tickets,
      p_actor_line_user_id,p_actor_line_user_id
    ) returning id into v_id;
  else
    select id into v_id from public.point_cards where card_id=v_card_id for update;
    if not found then raise exception 'POINT_CARD_NOT_FOUND'; end if;
    if p_expected_updated_at is not null and not exists(select 1 from public.point_cards where id=v_id and updated_at=p_expected_updated_at) then
      raise exception 'CONFLICT';
    end if;
    update public.point_cards set
      title=trim(p_card->>'title'),status=p_card->>'status',accent=p_card->>'accent',style_key=p_card->>'styleKey',
      expiry_mode=p_card->>'expiryMode',expires_on=nullif(p_card->>'expiresOn','')::date,
      usage_method=coalesce(p_card->>'usageMethod',''),usage_instructions=coalesce(p_card->>'usageInstructions',''),
      benefit_description=coalesce(p_card->>'benefitDescription',''),max_tickets_per_redemption=v_max_tickets,
      updated_by=p_actor_line_user_id,updated_at=v_now
    where id=v_id;
  end if;

  if jsonb_typeof(p_card->'rewards')='array' then
    for v_reward in select value from jsonb_array_elements(p_card->'rewards')
    loop
      begin
        v_threshold := (v_reward->>'thresholdStamps')::integer;
      exception when others then
        raise exception 'INVALID_REWARD_THRESHOLD';
      end;
      if v_threshold < 1 or v_threshold > 100 then raise exception 'INVALID_REWARD_THRESHOLD'; end if;

      select id into v_template_id
      from public.ticket_templates
      where ticket_template_id=v_reward->>'ticketTemplateId';
      if not found then raise exception 'TICKET_TEMPLATE_NOT_FOUND'; end if;

      v_reward_row_id := null;
      select r.id into v_reward_row_id
      from public.point_card_rewards r
      where r.point_card_id=v_id and r.threshold_stamps=v_threshold and not (r.id = any(v_matched_reward_ids))
      limit 1 for update;

      if v_reward_row_id is null then
        select r.id into v_reward_row_id
        from public.point_card_rewards r
        where r.point_card_id=v_id and r.ticket_template_id=v_template_id and not (r.id = any(v_matched_reward_ids))
        order by r.threshold_stamps limit 1 for update;
      end if;

      if v_reward_row_id is null then
        insert into public.point_card_rewards(reward_id,point_card_id,threshold_stamps,ticket_template_id)
        values(public.new_public_id('RW'),v_id,v_threshold,v_template_id)
        returning id into v_reward_row_id;
      else
        update public.point_card_rewards set threshold_stamps=v_threshold,ticket_template_id=v_template_id where id=v_reward_row_id;
      end if;
      v_matched_reward_ids := array_append(v_matched_reward_ids,v_reward_row_id);
    end loop;
  end if;

  if cardinality(v_matched_reward_ids)=0 then
    delete from public.point_card_rewards where point_card_id=v_id;
  else
    delete from public.point_card_rewards where point_card_id=v_id and not (id = any(v_matched_reward_ids));
  end if;

  insert into public.audit_logs(audit_id,actor_line_user_id,actor_role,action,target_type,target_id,result,detail)
  values(public.new_public_id('AUD'),p_actor_line_user_id,'admin','admin.pointcards.save','point_card',v_card_id,'success',
    jsonb_build_object('stableRewardIdentity',true,'rewardCount',cardinality(v_matched_reward_ids),'maxTicketsPerRedemption',v_max_tickets));
  return v_card_id;
end;
$$;

create or replace function public.redeem_point_tickets(
  p_line_user_id text,
  p_ticket_ids text[],
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member public.members%rowtype;
  v_ticket public.point_tickets%rowtype;
  v_card public.point_cards%rowtype;
  v_balance public.point_balances%rowtype;
  v_result jsonb := null;
  v_entry_id uuid;
  v_selected_count integer := 0;
  v_total_points integer := 0;
  v_processed integer := 0;
  v_points_by_card jsonb := '{}'::jsonb;
  v_existing jsonb;
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,120}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_ticket_ids is null or cardinality(p_ticket_ids) < 1 or cardinality(p_ticket_ids) > 50 then raise exception 'INVALID_TICKET_BATCH'; end if;
  if exists(select 1 from unnest(p_ticket_ids) as selected(ticket_id) where nullif(btrim(selected.ticket_id),'') is null) then raise exception 'INVALID_TICKET_BATCH'; end if;
  if (select count(distinct selected.ticket_id) from unnest(p_ticket_ids) as selected(ticket_id)) <> cardinality(p_ticket_ids) then raise exception 'INVALID_TICKET_BATCH'; end if;

  select * into v_member from public.members
  where line_user_id=p_line_user_id and membership_status='active' and status='active';
  if not found then raise exception 'MEMBERSHIP_REQUIRED'; end if;

  select detail into v_existing
  from public.audit_logs
  where actor_line_user_id=v_member.line_user_id
    and action='user.pointcard.tickets.redeem'
    and target_type='point_ticket_batch'
    and target_id=p_request_id
    and result='success'
  order by created_at desc
  limit 1;
  if found then
    return coalesce(v_existing,'{}'::jsonb) || jsonb_build_object('requestId',p_request_id,'alreadyApplied',true);
  end if;

  perform 1 from public.point_tickets pt
  where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids)
  order by pt.ticket_id
  for update;

  select count(*) into v_selected_count from public.point_tickets pt
  where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids);
  if v_selected_count <> cardinality(p_ticket_ids) then raise exception 'TICKET_NOT_FOUND'; end if;
  if exists(select 1 from public.point_tickets pt where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids) and pt.status <> 'available') then
    raise exception 'TICKET_NOT_AVAILABLE';
  end if;

  perform 1 from public.point_cards pc
  where pc.id in (select pt.point_card_id from public.point_tickets pt where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids))
  order by pc.id
  for update;

  for v_card in
    select pc.* from public.point_cards pc
    where pc.id in (select pt.point_card_id from public.point_tickets pt where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids))
    order by pc.id
  loop
    if v_card.status <> 'active' then raise exception 'POINT_CARD_NOT_AVAILABLE'; end if;
    if v_card.expiry_mode='date' and v_card.expires_on < (now() at time zone 'Asia/Taipei')::date then raise exception 'POINT_CARD_EXPIRED'; end if;

    select count(*),coalesce(sum(pt.threshold_stamps),0)::integer
      into v_selected_count,v_total_points
    from public.point_tickets pt
    where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids) and pt.point_card_id=v_card.id;

    if v_selected_count > coalesce(v_card.max_tickets_per_redemption,1) then raise exception 'TICKET_BATCH_LIMIT_EXCEEDED'; end if;

    select * into v_balance from public.point_balances
    where member_id=v_member.id and point_card_id=v_card.id
    for update;
    if not found or v_balance.stamps < v_total_points then raise exception 'INSUFFICIENT_POINTS'; end if;
  end loop;

  for v_ticket in
    select pt.* from public.point_tickets pt
    where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids)
    order by pt.point_card_id,pt.ticket_id
  loop
    v_result := null;
    if v_ticket.ticket_type='lottery' then v_result := public.pick_lottery_prize(v_ticket.prizes); end if;

    update public.point_balances
    set stamps=stamps-v_ticket.threshold_stamps,updated_at=now()
    where member_id=v_member.id and point_card_id=v_ticket.point_card_id;

    insert into public.point_entries(entry_id,member_id,point_card_id,amount,note,created_by,request_id,entry_type,reference_type,reference_id)
    values(public.new_public_id('PE'),v_member.id,v_ticket.point_card_id,-v_ticket.threshold_stamps,'票券批次核銷',v_member.line_user_id,
      p_request_id||':'||v_ticket.ticket_id,'redeem','point_ticket',v_ticket.ticket_id)
    returning id into v_entry_id;

    update public.point_tickets
    set status='used',used_at=now(),result=v_result,points_spent=v_ticket.threshold_stamps,redeem_entry_id=v_entry_id,updated_at=now()
    where id=v_ticket.id;
    v_processed := v_processed + 1;
  end loop;

  for v_card in
    select pc.* from public.point_cards pc
    where pc.id in (select pt.point_card_id from public.point_tickets pt where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids))
    order by pc.id
  loop
    perform public.issue_eligible_point_tickets(v_member.id,v_card.id);
  end loop;

  select coalesce(jsonb_object_agg(totals.card_id,totals.points_spent),'{}'::jsonb)
    into v_points_by_card
  from (
    select pc.card_id,sum(pt.threshold_stamps)::integer as points_spent
    from public.point_tickets pt join public.point_cards pc on pc.id=pt.point_card_id
    where pt.member_id=v_member.id and pt.ticket_id=any(p_ticket_ids)
    group by pc.card_id
  ) totals;

  insert into public.audit_logs(audit_id,actor_line_user_id,actor_role,action,target_type,target_id,result,detail)
  values(public.new_public_id('AUD'),v_member.line_user_id,'member','user.pointcard.tickets.redeem','point_ticket_batch',p_request_id,'success',
    jsonb_build_object('requestId',p_request_id,'ticketIds',to_jsonb(p_ticket_ids),'ticketCount',v_processed,'pointsByCard',v_points_by_card,'alreadyApplied',false));

  return jsonb_build_object('requestId',p_request_id,'ticketIds',to_jsonb(p_ticket_ids),'ticketCount',v_processed,'pointsByCard',v_points_by_card,'alreadyApplied',false);
end;
$$;

revoke all on function public.redeem_point_tickets(text,text[],text) from public, anon, authenticated;
grant execute on function public.redeem_point_tickets(text,text[],text) to service_role;
