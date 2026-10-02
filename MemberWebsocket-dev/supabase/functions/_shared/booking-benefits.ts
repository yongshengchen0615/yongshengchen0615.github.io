import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";
import { loadLatestPointOffers, loadLatestEventOffers } from './latest-available-offers.ts';
import { isEligibleTierActivity } from './activity-eligibility.ts';

export async function loadBookingBenefits(db: SupabaseClient, member: any, tier: string, today: string) {
  // Member and tier are resolved by the authenticated handler, never the body.
  // Fixed-size batched reads; no ticket issuance, claim or redemption occurs here.
  const [points, events, calendar, eventSettings, pointSettings] = await Promise.all([
    loadLatestPointOffers(db, String(member.id), true),
    loadLatestEventOffers(db, String(member.id), tier, true),
    db.from('calendar_items')
      .select('calendar_item_id,title,item_type,starts_on,ends_on,status,allowed_tier_keys,source_event_ticket_id,audience_type,audience_month')
      .eq('item_type', 'event').in('status', ['active', 'targeted'])
      .is('source_event_ticket_id', null).lte('starts_on', today)
      .order('starts_on', { ascending: true }),
    db.from('event_ticket_settings')
      .select('max_tickets_per_day,max_tickets_per_redemption')
      .eq('id', 1)
      .maybeSingle(),
    db.from('point_card_settings')
      .select('max_tickets_per_redemption')
      .eq('id', 1)
      .maybeSingle(),
  ]);
  if (calendar.error) throw calendar.error;
  if (eventSettings.error) throw eventSettings.error;
  if (pointSettings.error) throw pointSettings.error;
  const rawEventLimit = Number(eventSettings.data?.max_tickets_per_day || eventSettings.data?.max_tickets_per_redemption || 1);
  const eventTicketMaxPerDay = Number.isInteger(rawEventLimit) && rawEventLimit >= 1 && rawEventLimit <= 50 ? rawEventLimit : 1;
  const rawPointLimit = Number(pointSettings.data?.max_tickets_per_redemption || 1);
  const pointTicketMaxPerRedemption = Number.isInteger(rawPointLimit) && rawPointLimit >= 1 && rawPointLimit <= 50 ? rawPointLimit : 1;
  // Ticket-backed calendar activities are represented by the canonical event
  // offer above, so expired/full/used tickets cannot reappear as activities.
  const pointCardIds = [...new Set(points.map((offer) => String(offer.pointCardId || '')).filter(Boolean))];
  const pointBalancesResult = pointCardIds.length
    ? await db.from('point_balances')
        .select('point_card_id,stamps')
        .eq('member_id', String(member.id))
        .in('point_card_id', pointCardIds)
    : { data: [], error: null };
  if (pointBalancesResult.error) throw pointBalancesResult.error;
  const pointBalanceByCard = new Map(
    (pointBalancesResult.data || []).map((row: any) => [String(row.point_card_id || ''), Math.max(0, Number(row.stamps || 0))])
  );

  const activities = (calendar.data || []).filter((item: any) =>
    isEligibleTierActivity(item, tier, today, member.birthday, undefined, undefined, true)
  ).slice(0, 8);
  return {
    asOf: new Date().toISOString(),
    eventTicketMaxPerDay,
    pointTicketMaxPerRedemption,
    items: [
      ...points.map((offer) => {
        const pointBalance = pointBalanceByCard.get(String(offer.pointCardId || '')) || 0;
        const pointCost = Math.max(0, Number(offer.thresholdStamps || 0));
        const hasTicket = Boolean(offer.ticketId);
        const hasEnoughPoints = pointCost > 0 && pointBalance >= pointCost;
        return {
          kind: 'points', id: offer.rewardId, title: offer.ticketTitle,
          subtitle: `${offer.cardTitle} · 消耗 ${pointCost} 點`,
          statusLabel: hasEnoughPoints ? '可使用' : '點數不足',
          startsOn: '', endsOn: offer.expiresOn, cardId: offer.cardId, cardTitle: offer.cardTitle,
          pointCost, pointBalance,
          selectable: hasTicket && hasEnoughPoints, selectionId: offer.ticketId,
          conditionLabel: `本卡目前 ${pointBalance} 點 · 此票券需 ${pointCost} 點 · 單次預約最多使用 ${pointTicketMaxPerRedemption} 張`,
          disabledReason: !hasTicket
            ? '目前沒有可核銷的票券'
            : !hasEnoughPoints
              ? `點數不足：目前 ${pointBalance} 點，此票券需要 ${pointCost} 點`
              : '',
        };
      }),
      ...events.map((offer) => ({
        kind: 'event', id: offer.eventTicketId, title: offer.title,
        subtitle: offer.claimed ? '已領取，尚未使用' : '尚未領取；勾選即代表領取',
        statusLabel: offer.claimed ? '可使用' : '可勾選並領取', startsOn: offer.startsOn, endsOn: offer.endsOn,
        selectable: !offer.requiresLocation,
        selectionId: offer.claimId || '',
        claimRequired: !offer.claimed,
        conditionLabel: `每日最多使用 ${eventTicketMaxPerDay} 張 · 服務限制：目前未設定`,
        disabledReason: offer.requiresLocation ? '此票券需於票券頁完成定位核銷' : '',
      })),
      ...activities.map((item: any) => ({
        kind: 'calendar', id: item.calendar_item_id, title: item.title,
        subtitle: '適用於目前會員階級', statusLabel: '活動進行中',
        startsOn: item.starts_on || '', endsOn: item.ends_on || item.starts_on || '',
        selectable: false, selectionId: '',
        conditionLabel: '會員條件：目前會員階級適用 · 活動資訊僅供預約參考',
        disabledReason: '',
      })),
    ],
  };
}
