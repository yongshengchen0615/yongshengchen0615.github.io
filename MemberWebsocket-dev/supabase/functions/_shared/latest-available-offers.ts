import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type JsonRow = Record<string, any>;

export type CurrentPointOffer = {
  rewardId: string;
  pointCardId: string;
  cardTitle: string;
  ticketTemplateId: string;
  ticketTitle: string;
  thresholdStamps: number;
  sortOrder: number;
};

export type AvailablePointTicketRef = {
  rewardId: string;
  pointCardId: string;
  ticketTemplateId: string;
  thresholdStamps: number;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taipeiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function relationActive(card: JsonRow | undefined, template: JsonRow | undefined, today: string): boolean {
  if (!card || !template) return false;
  if (text(card.status) !== "active" || text(template.status) !== "active") return false;
  if (text(card.expiry_mode) === "unlimited") return true;
  const expiresOn = text(card.expires_on);
  return !expiresOn || expiresOn >= today;
}

export function selectLatestPointOffers(
  rewards: JsonRow[],
  cards: JsonRow[],
  templates: JsonRow[],
  availableTickets: JsonRow[],
  today = "9999-12-31",
): CurrentPointOffer[] {
  const cardById = new Map(cards.map((row) => [text(row.id), row]));
  const templateById = new Map(templates.map((row) => [text(row.id), row]));
  const tickets: AvailablePointTicketRef[] = availableTickets.map((row) => ({
    rewardId: text(row.reward_id),
    pointCardId: text(row.point_card_id),
    ticketTemplateId: text(row.ticket_template_id),
    thresholdStamps: number(row.threshold_stamps),
  }));

  const offers: CurrentPointOffer[] = [];
  for (const reward of rewards) {
    const rewardId = text(reward.id);
    const pointCardId = text(reward.point_card_id);
    const ticketTemplateId = text(reward.ticket_template_id);
    const thresholdStamps = number(reward.threshold_stamps);
    const card = cardById.get(pointCardId);
    const template = templateById.get(ticketTemplateId);
    if (!rewardId || !pointCardId || !ticketTemplateId || thresholdStamps <= 0) continue;
    if (!relationActive(card, template, today)) continue;

    const hasAvailableTicket = tickets.some((ticket) =>
      ticket.pointCardId === pointCardId && (
        ticket.rewardId === rewardId ||
        (ticket.ticketTemplateId === ticketTemplateId && ticket.thresholdStamps === thresholdStamps)
      )
    );
    if (!hasAvailableTicket) continue;

    offers.push({
      rewardId,
      pointCardId,
      cardTitle: text(card?.title) || "集點卡",
      ticketTemplateId,
      ticketTitle: text(template?.title) || "可用優惠",
      thresholdStamps,
      sortOrder: number(card?.sort_order),
    });
  }

  return offers.sort((left, right) =>
    left.sortOrder - right.sortOrder ||
    left.thresholdStamps - right.thresholdStamps ||
    left.ticketTitle.localeCompare(right.ticketTitle, "zh-Hant")
  );
}

async function pointOfferLines(
  supabase: SupabaseClient,
  memberId: string,
  strict: boolean,
): Promise<string[]> {
  const ticketsResult = await supabase
    .from("point_tickets")
    .select("reward_id,point_card_id,ticket_template_id,threshold_stamps")
    .eq("member_id", memberId)
    .eq("status", "available")
    .limit(200);
  if (ticketsResult.error) {
    if (strict) throw ticketsResult.error;
    return [];
  }
  const tickets = ticketsResult.data || [];
  if (!tickets.length) return [];

  const cardIds = [...new Set(tickets.map((row: any) => text(row.point_card_id)).filter(Boolean))];
  if (!cardIds.length) return [];

  const rewardsResult = await supabase
    .from("point_card_rewards")
    .select("id,point_card_id,threshold_stamps,ticket_template_id")
    .in("point_card_id", cardIds);
  if (rewardsResult.error) {
    if (strict) throw rewardsResult.error;
    return [];
  }
  const rewards = rewardsResult.data || [];
  if (!rewards.length) return [];

  const templateIds = [...new Set(rewards.map((row: any) => text(row.ticket_template_id)).filter(Boolean))];
  const [cardsResult, templatesResult] = await Promise.all([
    supabase.from("point_cards").select("id,title,status,expiry_mode,expires_on,sort_order").in("id", cardIds),
    templateIds.length
      ? supabase.from("ticket_templates").select("id,title,status").in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cardsResult.error) {
    if (strict) throw cardsResult.error;
    return [];
  }
  if (templatesResult.error) {
    if (strict) throw templatesResult.error;
    return [];
  }

  return selectLatestPointOffers(
    rewards,
    cardsResult.data || [],
    templatesResult.data || [],
    tickets,
    taipeiDate(),
  ).slice(0, 12).map((offer) =>
    `・${offer.cardTitle}｜${offer.ticketTitle}｜消耗 ${offer.thresholdStamps} 點`
  );
}

async function eventOfferLines(
  supabase: SupabaseClient,
  memberId: string,
  tierKey: string,
  strict: boolean,
): Promise<string[]> {
  const today = taipeiDate();
  const eventsResult = await supabase
    .from("event_tickets")
    .select("id,title,status,starts_on,ends_on,quota,allowed_tier_keys")
    .eq("status", "active");
  if (eventsResult.error) {
    if (strict) throw eventsResult.error;
    return [];
  }

  const eligible = (eventsResult.data || []).filter((row: any) => {
    const allowed = Array.isArray(row.allowed_tier_keys) ? row.allowed_tier_keys : [];
    return (!row.starts_on || text(row.starts_on) <= today) &&
      (!row.ends_on || text(row.ends_on) >= today) &&
      (!allowed.length || allowed.includes(tierKey));
  });
  const ids = eligible.map((row: any) => row.id);
  if (!ids.length) return [];

  const claimsResult = await supabase
    .from("event_ticket_claims")
    .select("event_ticket_id,member_id,status")
    .in("event_ticket_id", ids);
  if (claimsResult.error) {
    if (strict) throw claimsResult.error;
    return [];
  }

  const claimCounts = new Map<string, number>();
  const memberClaims = new Set<string>();
  for (const claim of claimsResult.data || []) {
    if (claim.status !== "cancelled") {
      const eventId = text(claim.event_ticket_id);
      claimCounts.set(eventId, (claimCounts.get(eventId) || 0) + 1);
      if (text(claim.member_id) === memberId) memberClaims.add(eventId);
    }
  }

  return eligible
    .filter((row: any) => {
      const eventId = text(row.id);
      return memberClaims.has(eventId) || number(row.quota) === 0 || (claimCounts.get(eventId) || 0) < number(row.quota);
    })
    .slice(0, 8)
    .map((row: any) => `・${text(row.title) || "活動票券"}${memberClaims.has(text(row.id)) ? "（已領取）" : "（可領取）"}`);
}

export async function buildLatestAvailableOffersSection(
  supabase: SupabaseClient,
  memberId: string,
  tierKey: string,
  options: { strict?: boolean } = {},
): Promise<string> {
  const strict = options.strict === true;
  const [pointLines, eventLines] = await Promise.all([
    pointOfferLines(supabase, memberId, strict),
    eventOfferLines(supabase, memberId, tierKey, strict),
  ]);

  const blocks: string[] = [];
  if (pointLines.length) blocks.push("集點卡優惠（目前設定）\n" + pointLines.join("\n"));
  if (eventLines.length) blocks.push("活動票券\n" + eventLines.join("\n"));
  return blocks.length
    ? "【目前可用優惠】\n" + blocks.join("\n\n") + "\n請至會員系統查看與使用。"
    : "";
}
