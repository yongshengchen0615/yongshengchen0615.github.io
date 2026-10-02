import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";
import { loadLatestPointOffers, loadLatestEventOffers } from './latest-available-offers.ts';
import { isEligibleTierActivity } from './activity-eligibility.ts';

export async function loadBookingBenefits(db: SupabaseClient, member: any, tier: string, today: string) {
  // Member and tier are resolved by the authenticated handler, never the body.
  // Fixed-size batched reads; no ticket issuance, claim or redemption occurs here.
  const [points, events, calendar] = await Promise.all([
    loadLatestPointOffers(db, String(member.id), true),
    loadLatestEventOffers(db, String(member.id), tier, true),
    db.from('calendar_items')
      .select('calendar_item_id,title,item_type,starts_on,ends_on,status,allowed_tier_keys,source_event_ticket_id,audience_type,audience_month')
      .eq('item_type', 'event').in('status', ['active', 'targeted'])
      .is('source_event_ticket_id', null).lte('starts_on', today)
      .order('starts_on', { ascending: true }),
  ]);
  if (calendar.error) throw calendar.error;
  // Ticket-backed calendar activities are represented by the canonical event
  // offer above, so expired/full/used tickets cannot reappear as activities.
  const activities = (calendar.data || []).filter((item: any) =>
    isEligibleTierActivity(item, tier, today, member.birthday, undefined, undefined, true)
  ).slice(0, 8);
  return {
    asOf: new Date().toISOString(),
    items: [
      ...points.map((offer) => ({
        kind: 'points', id: offer.rewardId, title: offer.ticketTitle,
        subtitle: `${offer.cardTitle} · 消耗 ${offer.thresholdStamps} 點`,
        statusLabel: '可使用', startsOn: '', endsOn: offer.expiresOn, cardId: offer.cardId,
        selectable: Boolean(offer.ticketId), selectionId: offer.ticketId,
        conditionLabel: '服務限制：目前未設定',
        disabledReason: offer.ticketId ? '' : '目前沒有可核銷的票券',
      })),
      ...events.map((offer) => ({
        kind: 'event', id: offer.eventTicketId, title: offer.title,
        subtitle: offer.claimed ? '已領取，尚未使用' : '符合資格，可前往領取',
        statusLabel: offer.claimed ? '可使用' : '可領取', startsOn: offer.startsOn, endsOn: offer.endsOn,
        selectable: Boolean(offer.claimed && offer.claimId && !offer.requiresLocation),
        selectionId: offer.claimId || '',
        conditionLabel: '服務限制：目前未設定',
        disabledReason: offer.requiresLocation
          ? '此票券需於票券頁完成定位核銷'
          : (offer.claimed ? '' : '請先領取票券後再於預約中選用'),
      })),
      ...activities.map((item: any) => ({
        kind: 'calendar', id: item.calendar_item_id, title: item.title,
        subtitle: '適用於目前會員階級', statusLabel: '活動進行中',
        startsOn: item.starts_on || '', endsOn: item.ends_on || item.starts_on || '',
        selectable: true, selectionId: item.calendar_item_id,
        conditionLabel: '會員條件：目前會員階級適用 · 服務限制：目前未設定',
        disabledReason: '',
      })),
    ],
  };
}
