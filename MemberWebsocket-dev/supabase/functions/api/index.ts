import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type ClientType = "member" | "points" | "event" | "calendar" | "admin";
type Json = Record<string, unknown>;

const MAX_REQUEST_BYTES = 40_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;
const TIER_KEYS = ["general", "silver", "gold", "platinum"] as const;
const TIER_LABELS: Record<string,string> = { general:"一般會員",silver:"銀級會員",gold:"金級會員",platinum:"白金會員" };
const STYLE_KEYS = ["forest","midnight","ocean","sunset","lavender","rose","gold","platinum","mint","cherry"] as const;
const WRITE_ACTIONS = new Set([
  "user.member.profile.save",
  "admin.member.update",
  "admin.member-tiers.save",
  "admin.pointcards.save",
  "admin.pointcards.reorder",
  "admin.pointcards.archive",
  "admin.pointcards.delete",
  "admin.pointcards.remove",
  "admin.tickets.save",
  "admin.event-tickets.save",
  "admin.event-tickets.delete",
  "admin.calendar-items.save",
  "admin.calendar-items.delete",
  "admin.calendar-items.batch",
  "admin.stamps.add",
  "admin.service_minutes.add",
  "admin.member-grants.add",
  "admin.grant-message-presets.save",
  "user.pointcard.ticket.redeem",
  "user.event.ticket.claim",
  "user.event.ticket.redeem",
]);

class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io")
    .split(",").map((value) => value.trim()).filter(Boolean));
}

function corsHeaders(origin: string | null): HeadersInit {
  const resolved = origin && allowedOrigins().has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": resolved,
    "Access-Control-Allow-Headers": "content-type, apikey",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function json(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = error instanceof ApiError ? error : mapDatabaseError(error);
  return json(origin, {
    ok: false,
    status: apiError.status,
    error: { code: apiError.code, message: apiError.message, details: apiError.details },
  }, apiError.status);
}

function mapDatabaseError(error: unknown): ApiError {
  const message = String((error as { message?: string })?.message || "");
  const rules: Array<[string, number, string, string]> = [
    ["CONFLICT",409,"CONFLICT","資料已被其他操作更新，請重新整理後再試。"],
    ["MEMBERSHIP_REQUIRED",403,"MEMBERSHIP_REQUIRED","請先完成會員加入後再使用此功能。"],
    ["MEMBER_NOT_FOUND",404,"MEMBER_NOT_FOUND","找不到指定會員。"],
    ["POINT_CARD_NOT_FOUND",404,"POINT_CARD_NOT_FOUND","找不到指定集點卡。"],
    ["POINT_CARD_NOT_AVAILABLE",409,"POINT_CARD_NOT_AVAILABLE","這張集點卡目前無法使用。"],
    ["POINT_CARD_EXPIRED",409,"POINT_CARD_EXPIRED","這張集點卡已超過使用期限。"],
    ["INSUFFICIENT_POINTS",409,"INSUFFICIENT_POINTS","目前點數不足，無法使用這張票券。"],
    ["TICKET_NOT_FOUND",404,"TICKET_NOT_FOUND","找不到這張票券。"],
    ["TICKET_NOT_AVAILABLE",409,"TICKET_NOT_AVAILABLE","這張票券目前無法使用。"],
    ["TICKET_TEMPLATE_NOT_FOUND",400,"TICKET_TEMPLATE_NOT_FOUND","選取的票券不存在。"],
    ["EVENT_TICKET_NOT_AVAILABLE",409,"EVENT_TICKET_NOT_AVAILABLE","這張活動票券目前無法使用。"],
    ["EVENT_NOT_STARTED",409,"EVENT_NOT_STARTED","活動尚未開始。"],
    ["EVENT_ENDED",409,"EVENT_ENDED","活動已結束。"],
    ["EVENT_QUOTA_REACHED",409,"EVENT_QUOTA_REACHED","活動票券已達發放上限。"],
    ["TIER_NOT_ALLOWED",403,"TIER_NOT_ALLOWED","目前會員等級不適用這張票券。"],
    ["CLAIM_NOT_FOUND",404,"CLAIM_NOT_FOUND","找不到已領取的活動票券。"],
    ["CLAIM_NOT_AVAILABLE",409,"CLAIM_NOT_AVAILABLE","這張活動票券目前無法使用。"],
    ["INVALID_REQUEST_ID",400,"INVALID_REQUEST_ID","操作識別碼格式不正確。"],
    ["INVALID_POINT_AMOUNT",400,"INVALID_POINT_AMOUNT","點數必須是 1–100 的整數。"],
    ["INVALID_SERVICE_MINUTES",400,"INVALID_SERVICE_MINUTES","服務時間必須是 1–1440 分鐘。"],
    ["INVALID_TIER_SETTINGS",400,"INVALID_TIER_SETTINGS","會員等級門檻設定不合法。"],
    ["INVALID_CARD_ORDERS",400,"INVALID_CARD_ORDERS","集點卡排序資料不合法。"],
    ["INVALID_CALENDAR_BATCH",400,"INVALID_CALENDAR_BATCH","日曆批次操作必須是 1–20 筆。"],
    ["CALENDAR_ITEM_NOT_FOUND",404,"CALENDAR_ITEM_NOT_FOUND","找不到日曆項目。"],
  ];
  for (const [needle,status,code,userMessage] of rules) {
    if (message.includes(needle)) return new ApiError(status,code,userMessage);
  }
  return new ApiError(500,"DATABASE_ERROR","資料庫暫時無法完成操作。");
}

function clientTypeForAction(action: string): ClientType {
  if (action === "user.member.bootstrap" || action === "user.member.profile.save") return "member";
  if (action === "user.pointcard.bootstrap" || action === "user.pointcard.detail" || action.startsWith("user.pointcard.ticket.")) return "points";
  if (action === "user.event.bootstrap" || action === "user.event.ticket.detail" || action.startsWith("user.event.ticket.")) return "event";
  if (action === "user.calendar.bootstrap" || action === "user.calendar.date.details") return "calendar";
  if (action.startsWith("admin.")) return "admin";
  throw new ApiError(404,"ACTION_NOT_FOUND","不支援的 API action。");
}

function channelIdFor(clientType: ClientType): string {
  const keys: Record<ClientType,string> = {
    member: "LINE_MEMBER_CHANNEL_ID",
    points: "LINE_POINTS_CHANNEL_ID",
    event: "LINE_EVENT_CHANNEL_ID",
    calendar: "LINE_CALENDAR_CHANNEL_ID",
    admin: "LINE_ADMIN_CHANNEL_ID",
  };
  const defaults: Record<ClientType,string> = {
    member: "2010787602",
    points: "2010787602",
    event: "2010787602",
    calendar: "2010787602",
    admin: "2010791619",
  };
  const value = env(keys[clientType]) || defaults[clientType];
  if (!/^\d{5,30}$/.test(value)) throw new ApiError(503,"AUTH_CONFIG_MISSING","LINE 驗證設定尚未完成。");
  return value;
}

async function verifyLineIdToken(idToken: string, clientType: ClientType): Promise<{ lineUserId: string; displayName: string }> {
  const expectedChannelId = channelIdFor(clientType);
  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: expectedChannelId }),
    });
  } catch {
    throw new ApiError(503,"LINE_AUTH_UNAVAILABLE","LINE 身分驗證服務暫時無法使用。");
  }
  let payload: Json;
  try { payload = await response.json(); }
  catch { throw new ApiError(503,"LINE_AUTH_UNAVAILABLE","LINE 身分驗證服務暫時無法使用。"); }

  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud.trim() : "";
  const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const exp = Number(payload.exp || 0);
  if (!response.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401,"AUTH_INVALID","LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub, displayName: String(payload.name || "LINE 使用者").slice(0,120) };
}

function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503,"SUPABASE_CONFIG_MISSING","Supabase server 設定尚未完成。");
  return createClient(url,key,{ auth: { persistSession: false, autoRefreshToken: false } });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2,"0")).join("");
}

function requestId(prefix = "REQ"): string {
  return prefix + "-" + crypto.randomUUID().replaceAll("-","");
}

function asText(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0,max);
}

function requireText(value: unknown, label: string, max = 100): string {
  const text = asText(value,max);
  if (!text) throw new ApiError(400,"INVALID_INPUT",label + "不可空白。");
  return text;
}

function requireStatus(value: unknown): "active"|"draft"|"archived" {
  const status = asText(value,20);
  if (!["active","draft","archived"].includes(status)) throw new ApiError(400,"INVALID_STATUS","請選擇公開狀態。");
  return status as "active"|"draft"|"archived";
}

function requireAccent(value: unknown): string {
  const color = asText(value,20);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ApiError(400,"INVALID_ACCENT","識別色格式不正確。");
  return color.toLowerCase();
}

function safeStyle(value: unknown): string {
  const style = asText(value,30);
  return (STYLE_KEYS as readonly string[]).includes(style) ? style : "forest";
}

function normalizeTierKeys(value: unknown, allowEmpty = false): string[] {
  const values = Array.isArray(value) ? value.map((item) => asText(item,20)).filter((item) => (TIER_KEYS as readonly string[]).includes(item)) : [];
  const unique = [...new Set(values)];
  if (!allowEmpty && !unique.length) throw new ApiError(400,"INVALID_TIER_ACCESS","至少選擇一個會員等級。");
  return unique;
}

function normalizePrizes(value: unknown, required: boolean): Array<{ prizeTitle: string; prizeDescription: string; winRate: number }> {
  if (!required) return [];
  if (!Array.isArray(value) || !value.length) throw new ApiError(400,"INVALID_PRIZES","抽獎券至少需要一個獎項。");
  const prizes = value.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Json : {};
    const prizeTitle = requireText(item.prizeTitle,"獎項名稱",100);
    const prizeDescription = asText(item.prizeDescription,500);
    const winRate = Number(item.winRate);
    if (!Number.isFinite(winRate) || winRate < 0 || winRate > 100) throw new ApiError(400,"INVALID_PRIZES","獎項機率必須介於 0–100%。");
    return { prizeTitle, prizeDescription, winRate: Number(winRate.toFixed(4)) };
  });
  const total = prizes.reduce((sum,item) => sum + item.winRate,0);
  if (Math.abs(total - 100) > 0.001) throw new ApiError(400,"INVALID_PRIZES","抽獎獎項機率合計必須為 100%。");
  return prizes;
}

async function consumeRateLimit(supabase: SupabaseClient, principal: string, action: string, body: Json): Promise<void> {
  const cost = action === "admin.calendar-items.batch" && Array.isArray(body.calendarItemOperations)
    ? Math.max(1,Math.min(20,body.calendarItemOperations.length)) : 1;
  const { data, error } = await supabase.rpc("consume_api_rate_limit",{
    p_principal_hash: await sha256(principal),
    p_is_write: WRITE_ACTIONS.has(action),
    p_cost: cost,
    p_read_limit: READ_LIMIT,
    p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503,"RATE_LIMIT_UNAVAILABLE","無法確認請求頻率限制。");
  if (!data) throw new ApiError(429,"RATE_LIMITED","請求過於密集，請稍後再試。");
}

async function ensureMember(supabase: SupabaseClient, identity: { lineUserId: string; displayName: string }): Promise<any> {
  let { data: member, error } = await supabase.from("members").select("*").eq("line_user_id",identity.lineUserId).maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!member) {
    const memberCode = "M" + crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase();
    const inserted = await supabase.from("members").insert({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      member_code: memberCode,
      last_login_at: new Date().toISOString(),
    }).select("*").single();
    if (inserted.error) {
      const retry = await supabase.from("members").select("*").eq("line_user_id",identity.lineUserId).single();
      if (retry.error) throw mapDatabaseError(inserted.error);
      member = retry.data;
    } else member = inserted.data;
  } else {
    const patch: Json = { last_login_at: new Date().toISOString() };
    if (identity.displayName && identity.displayName !== member.display_name) patch.display_name = identity.displayName;
    const updated = await supabase.from("members").update(patch).eq("id",member.id).select("*").single();
    if (!updated.error) member = updated.data;
  }
  return member;
}

async function requireJoinedMember(supabase: SupabaseClient, identity: { lineUserId: string; displayName: string }): Promise<any> {
  const member = await ensureMember(supabase,identity);
  if (member.membership_status !== "active") throw new ApiError(403,"MEMBERSHIP_REQUIRED","請先完成會員加入後再使用此功能。");
  if (member.status !== "active") throw new ApiError(403,"MEMBER_DISABLED","此會員目前已停用。");
  return member;
}

async function tierSettings(supabase: SupabaseClient): Promise<any[]> {
  const { data, error } = await supabase.from("membership_tier_settings").select("*").order("required_service_minutes",{ ascending: true });
  if (error) throw mapDatabaseError(error);
  return data || [];
}

function tierSettingsClient(rows: any[]): any[] {
  return rows.map((row) => ({
    tierKey: row.tier_key,
    label: row.tier_label,
    requiredServiceMinutes: Number(row.required_service_minutes || 0),
    styleKey: row.style_key || "forest",
    updatedAt: row.updated_at,
  }));
}

async function serviceMinutesForMembers(supabase: SupabaseClient, memberIds: string[]): Promise<Map<string,number>> {
  const result = new Map<string,number>(memberIds.map((id) => [id,0]));
  if (!memberIds.length) return result;
  const { data, error } = await supabase.from("service_time_entries").select("member_id,minutes").in("member_id",memberIds);
  if (error) throw mapDatabaseError(error);
  for (const row of data || []) result.set(row.member_id,(result.get(row.member_id) || 0) + Number(row.minutes || 0));
  return result;
}

function tierForMinutes(settings: any[], minutes: number): any {
  let current = settings[0] || { tier_key:"general",tier_label:"一般會員",required_service_minutes:0,style_key:"forest" };
  for (const row of settings) if (Number(row.required_service_minutes) <= minutes) current = row;
  return current;
}

function profileFrom(member: any, settings: any[], serviceMinutesTotal: number): Json {
  const current = tierForMinutes(settings,serviceMinutesTotal);
  const index = Math.max(0,settings.findIndex((row) => row.tier_key === current.tier_key));
  const next = settings[index + 1] || null;
  return {
    lineUserId: member.line_user_id,
    displayName: member.display_name || "LINE 使用者",
    memberCode: member.member_code,
    status: member.status,
    joinedAt: member.joined_at || member.created_at,
    birthday: member.birthday || "",
    phone: member.phone || "",
    profileComplete: member.membership_status === "active" && Boolean(member.birthday && member.phone),
    membershipRequired: member.membership_status !== "active",
    serviceMinutesTotal,
    tierKey: current.tier_key,
    tier: current.tier_label,
    tierStyleKey: current.style_key || "forest",
    tierProgress: {
      serviceMinutesTotal,
      currentRequiredServiceMinutes: Number(current.required_service_minutes || 0),
      nextTierKey: next?.tier_key || "",
      nextTierLabel: next?.tier_label || "",
      nextRequiredServiceMinutes: next ? Number(next.required_service_minutes || 0) : null,
      remainingServiceMinutes: next ? Math.max(0,Number(next.required_service_minutes || 0) - serviceMinutesTotal) : 0,
      isHighestTier: !next && current.tier_key === TIER_KEYS[TIER_KEYS.length - 1],
    },
  };
}

async function profileFor(supabase: SupabaseClient, member: any): Promise<Json> {
  const settings = await tierSettings(supabase);
  const totals = await serviceMinutesForMembers(supabase,[member.id]);
  return profileFrom(member,settings,totals.get(member.id) || 0);
}

async function authorizeAdmin(supabase: SupabaseClient, identity: { lineUserId: string; displayName: string }): Promise<any> {
  let { data: admin, error } = await supabase.from("admins").select("*").eq("line_user_id",identity.lineUserId).maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!admin) {
    const inserted = await supabase.from("admins").insert({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      role: "none",
      status: "pending",
    }).select("*").single();
    if (inserted.error) {
      const retry = await supabase.from("admins").select("*").eq("line_user_id",identity.lineUserId).single();
      if (retry.error) throw mapDatabaseError(inserted.error);
      admin = retry.data;
    } else admin = inserted.data;
  }
  if (admin.role !== "admin" || admin.status !== "active") {
    throw new ApiError(403,"ADMIN_PENDING","管理端帳號尚未授權。",{ lineUserId: identity.lineUserId });
  }
  if (identity.displayName && admin.display_name !== identity.displayName) {
    await supabase.from("admins").update({ display_name: identity.displayName, updated_at: new Date().toISOString() }).eq("id",admin.id);
    admin.display_name = identity.displayName;
  }
  return admin;
}

async function membersPage(supabase: SupabaseClient, page = 1, pageSize = 100, query = ""): Promise<{ members: any[]; memberPage: Json }> {
  const safePageSize = Math.max(1,Math.min(100,Math.floor(Number(pageSize) || 100)));
  const safePage = Math.max(1,Math.floor(Number(page) || 1));
  const normalizedQuery = asText(query,100).toLowerCase();
  let q = supabase.from("members").select("*",{ count:"exact" });
  if (normalizedQuery) q = q.or(`display_name.ilike.%${normalizedQuery.replaceAll(",","")}%,member_code.ilike.%${normalizedQuery.replaceAll(",","")}%`);
  const start = (safePage - 1) * safePageSize;
  const { data, count, error } = await q.order("created_at",{ ascending:false }).range(start,start + safePageSize - 1);
  if (error) throw mapDatabaseError(error);
  const rows = data || [];
  const settings = await tierSettings(supabase);
  const totals = await serviceMinutesForMembers(supabase,rows.map((row) => row.id));
  const members = rows.map((member) => {
    const minutes = totals.get(member.id) || 0;
    const tier = tierForMinutes(settings,minutes);
    return {
      lineUserId: member.line_user_id,
      displayName: member.display_name,
      memberCode: member.member_code,
      status: member.status,
      joinedAt: member.joined_at || member.created_at,
      serviceMinutesTotal: minutes,
      tierKey: tier.tier_key,
      tier: tier.tier_label,
      tierStyleKey: tier.style_key,
      updatedAt: member.updated_at,
    };
  });
  const total = Number(count || 0);
  const totalPages = Math.max(1,Math.ceil(total / safePageSize));
  return { members, memberPage: { page: Math.min(safePage,totalPages), pageSize: safePageSize, total, totalPages, query: normalizedQuery } };
}

function isExpiredCard(row: any): boolean {
  if (row.expiry_mode !== "date" || !row.expires_on) return false;
  return String(row.expires_on) < taipeiDate();
}

function taipeiDate(): string {
  const parts: Record<string,string> = {};
  new Intl.DateTimeFormat("en-CA",{ timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit" })
    .formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") parts[part.type] = part.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function mapTicketTemplate(row: any): Json {
  return {
    ticketTemplateId: row.ticket_template_id,
    title: row.title,
    ticketType: row.ticket_type,
    description: row.description || "",
    usageMethod: row.usage_method || "",
    usageInstructions: row.usage_instructions || "",
    prizes: Array.isArray(row.prizes) ? row.prizes : [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function adminCards(supabase: SupabaseClient): Promise<{ cards: any[]; tickets: any[] }> {
  const [cardsRes,rewardsRes,templatesRes] = await Promise.all([
    supabase.from("point_cards").select("*").order("sort_order",{ ascending:true }).order("created_at",{ ascending:true }),
    supabase.from("point_card_rewards").select("*").order("threshold_stamps",{ ascending:true }),
    supabase.from("ticket_templates").select("*").order("created_at",{ ascending:false }),
  ]);
  if (cardsRes.error) throw mapDatabaseError(cardsRes.error);
  if (rewardsRes.error) throw mapDatabaseError(rewardsRes.error);
  if (templatesRes.error) throw mapDatabaseError(templatesRes.error);
  const templateById = new Map((templatesRes.data || []).map((row:any) => [row.id,row]));
  const rewardsByCard = new Map<string,any[]>();
  for (const reward of rewardsRes.data || []) {
    const template = templateById.get(reward.ticket_template_id);
    if (!template) continue;
    const list = rewardsByCard.get(reward.point_card_id) || [];
    list.push({
      rewardId: reward.reward_id,
      thresholdStamps: Number(reward.threshold_stamps),
      ticketTemplateId: template.ticket_template_id,
      rewardType: template.ticket_type,
      rewardTitle: template.title,
      rewardDescription: template.description || "",
      usageMethod: template.usage_method || "",
      usageInstructions: template.usage_instructions || "",
      prizes: Array.isArray(template.prizes) ? template.prizes : [],
      updatedAt: reward.updated_at,
    });
    rewardsByCard.set(reward.point_card_id,list);
  }
  return {
    cards: (cardsRes.data || []).map((row:any) => ({
      cardId: row.card_id,
      title: row.title,
      description: row.description || "",
      status: row.status,
      accent: row.accent,
      styleKey: row.style_key,
      expiryMode: row.expiry_mode,
      expiresOn: row.expires_on || "",
      sortOrder: Number(row.sort_order || 0),
      usageMethod: row.usage_method || "",
      usageInstructions: row.usage_instructions || "",
      benefitDescription: row.benefit_description || "",
      expired: isExpiredCard(row),
      rewards: rewardsByCard.get(row.id) || [],
      rewardCount: (rewardsByCard.get(row.id) || []).length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    tickets: (templatesRes.data || []).map(mapTicketTemplate),
  };
}

function pointTicketClient(row: any, cardId = ""): Json {
  return {
    ticketId: row.ticket_id,
    cardId: cardId || row.card_id || "",
    rewardId: row.reward_id || "",
    ticketTemplateId: row.ticket_template_id || "",
    thresholdStamps: Number(row.threshold_stamps || 0),
    ticketType: row.ticket_type,
    ticketTitle: row.ticket_title,
    ticketDescription: row.ticket_description || "",
    usageMethod: row.usage_method || "",
    usageInstructions: row.usage_instructions || "",
    prizes: Array.isArray(row.prizes) ? row.prizes : [],
    status: row.status,
    earnedAt: row.earned_at,
    usedAt: row.used_at || "",
    result: row.result || null,
    pointsSpent: Number(row.points_spent || 0),
  };
}

async function pointBootstrap(supabase: SupabaseClient, member: any): Promise<Json> {
  const profile = await profileFor(supabase,member);
  const { cards: adminCardRows } = await adminCards(supabase);
  const activeCards = adminCardRows.filter((card:any) => card.status === "active");
  const rawCards = await supabase.from("point_cards").select("id,card_id").in("card_id",activeCards.map((card:any) => card.cardId));
  if (rawCards.error) throw mapDatabaseError(rawCards.error);
  const idByCard = new Map((rawCards.data || []).map((row:any) => [row.card_id,row.id]));
  for (const card of activeCards) {
    const pointCardId = idByCard.get(card.cardId);
    if (pointCardId) await supabase.rpc("issue_eligible_point_tickets",{ p_member_id: member.id, p_point_card_id: pointCardId });
  }

  const pointCardIds = [...idByCard.values()];
  const balancesRes = pointCardIds.length
    ? await supabase.from("point_balances").select("*").eq("member_id",member.id).in("point_card_id",pointCardIds)
    : { data:[], error:null };
  if (balancesRes.error) throw mapDatabaseError(balancesRes.error);
  const balanceById = new Map((balancesRes.data || []).map((row:any) => [row.point_card_id,row]));

  const ticketsRes = pointCardIds.length
    ? await supabase.from("point_tickets").select("*").eq("member_id",member.id).in("point_card_id",pointCardIds).order("created_at",{ ascending:false })
    : { data:[], error:null };
  if (ticketsRes.error) throw mapDatabaseError(ticketsRes.error);
  const availableTickets = (ticketsRes.data || []).filter((row:any) => row.status === "available");
  const usedTickets = (ticketsRes.data || []).filter((row:any) => row.status === "used");
  const cardIdByUuid = new Map((rawCards.data || []).map((row:any) => [row.id,row.card_id]));
  const ticketByCard = new Map<string,any[]>();
  for (const ticket of availableTickets) {
    const cardId = cardIdByUuid.get(ticket.point_card_id) || "";
    const list = ticketByCard.get(cardId) || [];
    list.push(pointTicketClient(ticket,cardId));
    ticketByCard.set(cardId,list);
  }

  const cards = activeCards.map((card:any) => {
    const balance = balanceById.get(idByCard.get(card.cardId));
    return { ...card, stamps: Number(balance?.stamps || 0), updatedAt: balance?.updated_at || card.updatedAt };
  });
  const cardDetails: Json = {};
  for (const card of cards) cardDetails[card.cardId] = { card, tickets: ticketByCard.get(card.cardId) || [] };

  const cardTitleByUuid = new Map((rawCards.data || []).map((row:any) => [row.id,activeCards.find((card:any) => card.cardId === row.card_id)?.title || "集點卡"]));
  const history = usedTickets.map((row:any) => ({
    activityId: "point-ticket:" + row.ticket_id,
    referenceId: row.ticket_id,
    ticketId: row.ticket_id,
    ticketType: row.ticket_type,
    ticketTitle: row.ticket_title,
    cardTitle: cardTitleByUuid.get(row.point_card_id) || "集點卡",
    pointsSpent: Number(row.points_spent || row.threshold_stamps || 0),
    result: row.result || null,
    occurredAt: row.used_at || row.updated_at,
  }));
  return { profile, cards, cardDetails, history, historyTotal: history.length };
}

function eventTicketClient(row: any, claimedCount = 0): Json {
  return {
    eventTicketId: row.event_ticket_id,
    title: row.title,
    ticketType: row.ticket_type,
    description: row.description || "",
    usageMethod: row.usage_method || "",
    usageInstructions: row.usage_instructions || "",
    prizes: Array.isArray(row.prizes) ? row.prizes : [],
    status: row.status,
    startsOn: row.starts_on || "",
    endsOn: row.ends_on || "",
    quota: Number(row.quota || 0),
    claimedCount,
    accent: row.accent,
    allowedTierKeys: Array.isArray(row.allowed_tier_keys) ? row.allowed_tier_keys : [...TIER_KEYS],
    allowedTierLabels: (Array.isArray(row.allowed_tier_keys) ? row.allowed_tier_keys : [...TIER_KEYS]).map((key:string) => TIER_LABELS[key]).filter(Boolean),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function claimClient(row: any, eventTicketId = ""): Json {
  return {
    claimId: row.claim_id,
    eventTicketId,
    ticketType: row.ticket_type,
    ticketTitle: row.ticket_title,
    ticketDescription: row.ticket_description || "",
    usageMethod: row.usage_method || "",
    usageInstructions: row.usage_instructions || "",
    prizes: Array.isArray(row.prizes) ? row.prizes : [],
    status: row.status === "claimed" ? "available" : row.status,
    claimedAt: row.claimed_at,
    usedAt: row.used_at || "",
    result: row.result || null,
  };
}

async function adminEventTickets(supabase: SupabaseClient): Promise<any[]> {
  const { data: rows, error } = await supabase.from("event_tickets").select("*").is("deleted_at",null).order("created_at",{ ascending:false });
  if (error) throw mapDatabaseError(error);
  const ids = (rows || []).map((row:any) => row.id);
  const counts = new Map<string,number>();
  if (ids.length) {
    const claims = await supabase.from("event_ticket_claims").select("event_ticket_id").in("event_ticket_id",ids);
    if (claims.error) throw mapDatabaseError(claims.error);
    for (const claim of claims.data || []) counts.set(claim.event_ticket_id,(counts.get(claim.event_ticket_id)||0)+1);
  }
  return (rows || []).map((row:any) => eventTicketClient(row,counts.get(row.id)||0));
}

async function eventBootstrap(supabase: SupabaseClient, member: any): Promise<Json> {
  const profile = await profileFor(supabase,member);
  const { data: eventRows, error } = await supabase.from("event_tickets").select("*").eq("status","active").is("deleted_at",null).order("created_at",{ ascending:false });
  if (error) throw mapDatabaseError(error);
  const ids = (eventRows || []).map((row:any) => row.id);
  const claimsRes = ids.length
    ? await supabase.from("event_ticket_claims").select("*").eq("member_id",member.id).in("event_ticket_id",ids).order("created_at",{ ascending:false })
    : { data:[], error:null };
  if (claimsRes.error) throw mapDatabaseError(claimsRes.error);
  const allHistoryRes = await supabase.from("event_ticket_claims").select("*,event_tickets(*)").eq("member_id",member.id).eq("status","used").order("used_at",{ ascending:false });
  if (allHistoryRes.error) throw mapDatabaseError(allHistoryRes.error);

  const claimByEvent = new Map((claimsRes.data || []).map((row:any) => [row.event_ticket_id,row]));
  const counts = new Map<string,number>();
  if (ids.length) {
    const countRes = await supabase.from("event_ticket_claims").select("event_ticket_id").in("event_ticket_id",ids);
    if (countRes.error) throw mapDatabaseError(countRes.error);
    for (const row of countRes.data || []) counts.set(row.event_ticket_id,(counts.get(row.event_ticket_id)||0)+1);
  }
  const today = taipeiDate();
  const offers = (eventRows || []).map((row:any) => {
    const ticket = eventTicketClient(row,counts.get(row.id)||0) as any;
    const claimRow = claimByEvent.get(row.id);
    const claim = claimRow ? claimClient(claimRow,row.event_ticket_id) : null;
    const scheduled = Boolean(row.starts_on && today < row.starts_on);
    const ended = Boolean(row.ends_on && today > row.ends_on);
    const availability = scheduled ? "scheduled" : ended ? "ended" : "active";
    const tierEligible = (row.allowed_tier_keys || []).includes(profile.tierKey);
    const soldOut = Number(row.quota || 0) > 0 && (counts.get(row.id)||0) >= Number(row.quota);
    return {
      ticket,
      claim,
      availability,
      tierEligible,
      canClaim: !claim && tierEligible && availability === "active" && !soldOut,
      canUse: Boolean(claim && claim.status === "available" && tierEligible && availability === "active"),
      soldOut,
      history: false,
    };
  });

  const usedTickets = (allHistoryRes.data || []).map((row:any) => {
    const eventRow = row.event_tickets || {};
    const ticket = {
      eventTicketId: eventRow.event_ticket_id || row.claim_id,
      title: row.ticket_title,
      ticketType: row.ticket_type,
      description: row.ticket_description,
      usageMethod: row.usage_method,
      usageInstructions: row.usage_instructions,
      prizes: row.prizes || [],
      accent: eventRow.accent || "#df6b4d",
      allowedTierKeys: eventRow.allowed_tier_keys || [...TIER_KEYS],
      startsOn: eventRow.starts_on || "",
      endsOn: eventRow.ends_on || "",
    };
    return { ticket, claim: claimClient(row,eventRow.event_ticket_id || row.claim_id), availability:"used", tierEligible:true, canClaim:false, canUse:false, soldOut:false, history:true };
  });
  return { profile, offers, usedTickets, usedTicketCount: usedTickets.length };
}

function calendarClient(row: any): Json {
  return {
    calendarItemId: row.calendar_item_id,
    title: row.title,
    itemType: row.item_type,
    description: row.description || "",
    startsOn: row.starts_on,
    endsOn: row.ends_on || "",
    status: row.status,
    accent: row.accent,
    allowedTierKeys: Array.isArray(row.allowed_tier_keys) ? row.allowed_tier_keys : [],
    linkLabel: row.link_label || "",
    linkUrl: row.link_url || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function calendarItems(supabase: SupabaseClient, activeOnly = false): Promise<any[]> {
  let query = supabase.from("calendar_items").select("*").order("starts_on",{ ascending:true }).order("created_at",{ ascending:true });
  if (activeOnly) query = query.eq("status","active");
  const { data, error } = await query;
  if (error) throw mapDatabaseError(error);
  return (data || []).map(calendarClient);
}

async function summaryStats(supabase: SupabaseClient): Promise<Json> {
  const today = taipeiDate();
  const start = new Date(today + "T00:00:00+08:00").toISOString();
  const [members,activeMembers,cards,events,todayEntries] = await Promise.all([
    supabase.from("members").select("*",{ count:"exact",head:true }),
    supabase.from("members").select("*",{ count:"exact",head:true }).eq("status","active"),
    supabase.from("point_cards").select("*",{ count:"exact",head:true }).eq("status","active"),
    supabase.from("event_tickets").select("*",{ count:"exact",head:true }).eq("status","active").is("deleted_at",null),
    supabase.from("point_entries").select("*",{ count:"exact",head:true }).gte("created_at",start).gt("amount",0),
  ]);
  for (const result of [members,activeMembers,cards,events,todayEntries]) if (result.error) throw mapDatabaseError(result.error);
  return {
    memberCount: members.count || 0,
    activeMemberCount: activeMembers.count || 0,
    activeCardCount: cards.count || 0,
    activeEventTicketCount: events.count || 0,
    todayEntryCount: todayEntries.count || 0,
  };
}

async function emitRealtime(supabase: SupabaseClient, action: string): Promise<void> {
  if (!WRITE_ACTIONS.has(action)) return;
  const scopes: ClientType[] =
    action.startsWith("admin.grant-message-presets.")
      ? ["admin"]
      : action.startsWith("admin.pointcards.") || action === "admin.tickets.save" || action === "admin.stamps.add" || action === "user.pointcard.ticket.redeem"
      ? ["points","admin"]
      : action.startsWith("admin.event-tickets.") || action.startsWith("user.event.ticket.")
        ? ["event","admin"]
        : action.startsWith("admin.calendar-items.")
          ? ["calendar","admin"]
          : ["member","points","event","calendar","admin"];
  await supabase.from("realtime_events").insert([...new Set(scopes)].map((scope) => ({ scope,event_type:action })));
}


async function grantMessagePresets(supabase: SupabaseClient, includeArchived = true): Promise<any[]> {
  let query = supabase
    .from("grant_message_presets")
    .select("*")
    .order("sort_order",{ ascending:true })
    .order("created_at",{ ascending:true });
  if (!includeArchived) query = query.eq("status","active");
  const { data,error } = await query;
  if (error) throw mapDatabaseError(error);
  return (data || []).map((row:any) => ({
    presetId:row.preset_id,
    title:row.title,
    message:row.message,
    status:row.status,
    sortOrder:Number(row.sort_order || 0),
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  }));
}

type GrantNotificationResult = {
  status: "sent" | "failed" | "skipped";
  message: string;
};

async function lineMessagingToken(supabase: SupabaseClient): Promise<string> {
  const result = await supabase.rpc("get_line_messaging_token");
  if (result.error) return "";
  return asText(result.data,10000);
}

function grantTicketItemLines(items: { label: string; status?: string }[], maxItems = 5): string[] {
  const grouped = new Map<string,{ label:string;status:string;count:number }>();
  for (const item of items) {
    const label = asText(item.label,180);
    const status = asText(item.status,40);
    if (!label) continue;
    const key = label + "\n" + status;
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key,{ label,status,count:1 });
  }

  const entries = [...grouped.values()];
  const visible = entries.slice(0,maxItems).map((item) =>
    "・" + item.label + (item.count > 1 ? " ×" + item.count : "") + (item.status ? "（" + item.status + "）" : "")
  );
  const hiddenCount = entries.slice(maxItems).reduce((sum,item) => sum + item.count,0);
  if (hiddenCount > 0) visible.push("・另有 " + hiddenCount + " 張");
  return visible;
}

async function grantAvailableTicketSection(
  supabase: SupabaseClient,
  memberId: string,
  tierKey: string,
  grantedCardIds: string[],
): Promise<string> {
  const today = taipeiDate();
  const ticketBlocks: string[] = [];

  const pointCardsResult = await supabase
    .from("point_cards")
    .select("id,card_id,title,status,expiry_mode,expires_on")
    .eq("status","active");
  if (pointCardsResult.error) throw mapDatabaseError(pointCardsResult.error);

  const activePointCards = (pointCardsResult.data || []).filter((row:any) => !isExpiredCard(row));
  const pointCardsToIssue = activePointCards.filter((row:any) => grantedCardIds.includes(String(row.card_id)));
  if (pointCardsToIssue.length) {
    await Promise.all(pointCardsToIssue.map(async (row:any) => {
      const issueResult = await supabase.rpc("issue_eligible_point_tickets",{ p_member_id:memberId,p_point_card_id:row.id });
      if (issueResult.error) throw mapDatabaseError(issueResult.error);
    }));
  }

  const internalPointCardIds = activePointCards.map((row:any) => row.id);
  const pointTicketsResult = internalPointCardIds.length
    ? await supabase
        .from("point_tickets")
        .select("ticket_id,ticket_title,point_card_id,status,created_at")
        .eq("member_id",memberId)
        .eq("status","available")
        .in("point_card_id",internalPointCardIds)
        .order("created_at",{ ascending:false })
    : { data:[],error:null };
  if (pointTicketsResult.error) throw mapDatabaseError(pointTicketsResult.error);

  const pointCardTitleById = new Map(activePointCards.map((row:any) => [String(row.id),String(row.title || "集點卡")]));
  const pointTicketItems = (pointTicketsResult.data || []).map((row:any) => ({
      label: (pointCardTitleById.get(String(row.point_card_id)) || "集點卡") + "｜" + String(row.ticket_title || "可用票券"),
    }));
  if (pointTicketItems.length) {
    ticketBlocks.push(
      "集點卡票券 " + pointTicketItems.length + " 張\n" +
      grantTicketItemLines(pointTicketItems).join("\n")
    );
  }

  const eventTicketsResult = await supabase
    .from("event_tickets")
    .select("id,title,status,starts_on,ends_on,quota,allowed_tier_keys,created_at")
    .eq("status","active")
    .is("deleted_at",null)
    .order("created_at",{ ascending:false });
  if (eventTicketsResult.error) throw mapDatabaseError(eventTicketsResult.error);

  const eligibleEventRows = (eventTicketsResult.data || []).filter((row:any) => {
    const scheduled = Boolean(row.starts_on && today < String(row.starts_on));
    const ended = Boolean(row.ends_on && today > String(row.ends_on));
    const allowedTierKeys = Array.isArray(row.allowed_tier_keys) ? row.allowed_tier_keys : [];
    return !scheduled && !ended && allowedTierKeys.includes(tierKey);
  });
  const eventIds = eligibleEventRows.map((row:any) => row.id);

  const memberClaimsResult = eventIds.length
    ? await supabase
        .from("event_ticket_claims")
        .select("event_ticket_id,status")
        .eq("member_id",memberId)
        .in("event_ticket_id",eventIds)
    : { data:[],error:null };
  if (memberClaimsResult.error) throw mapDatabaseError(memberClaimsResult.error);

  const claimCountsResult = eventIds.length
    ? await supabase
        .from("event_ticket_claims")
        .select("event_ticket_id")
        .in("event_ticket_id",eventIds)
    : { data:[],error:null };
  if (claimCountsResult.error) throw mapDatabaseError(claimCountsResult.error);

  const memberClaimByEvent = new Map((memberClaimsResult.data || []).map((row:any) => [String(row.event_ticket_id),String(row.status || "")]));
  const claimCounts = new Map<string,number>();
  for (const row of claimCountsResult.data || []) {
    const eventId = String(row.event_ticket_id);
    claimCounts.set(eventId,(claimCounts.get(eventId) || 0) + 1);
  }

  const eventTicketItems: { label:string;status:string }[] = [];
  for (const row of eligibleEventRows) {
    const eventId = String(row.id);
    const claimStatus = memberClaimByEvent.get(eventId) || "";
    if (claimStatus === "claimed" || claimStatus === "available") {
      eventTicketItems.push({ label:String(row.title || "活動票券"),status:"已領取，可使用" });
      continue;
    }
    if (claimStatus) continue;
    const quota = Number(row.quota || 0);
    const soldOut = quota > 0 && (claimCounts.get(eventId) || 0) >= quota;
    if (!soldOut) eventTicketItems.push({ label:String(row.title || "活動票券"),status:"可領取" });
  }
  if (eventTicketItems.length) {
    ticketBlocks.push(
      "活動票券 " + eventTicketItems.length + " 張\n" +
      grantTicketItemLines(eventTicketItems).join("\n")
    );
  }

  return ticketBlocks.length
    ? "【目前可用票券】\n" + ticketBlocks.join("\n\n") + "\n請至會員系統查看與使用。"
    : "";
}

async function pushGrantNotification(
  supabase: SupabaseClient,
  lineUserId: string,
  memberDisplayName: string,
  memberId: string,
  requestIdValue: string,
  points: unknown,
  serviceMinutes: number,
  presetMessage: string,
  totalServiceMinutes: number,
  tierKey: string,
  tierLabel: string,
): Promise<GrantNotificationResult> {
  const token = await lineMessagingToken(supabase);
  if (!token) return { status:"failed",message:"LINE Messaging API 尚未設定。" };

  const greetingName = asText(memberDisplayName,120) || "會員";
  const announcement = asText(presetMessage,1000);
  const sections: string[] = [];
  const pointItems = Array.isArray(points)
    ? points.filter((item) => item && typeof item === "object") as Json[]
    : [];
  const cardIds = [...new Set(pointItems.map((item) => asText(item.cardId,120)).filter(Boolean))];

  if (cardIds.length) {
    const cardsResult = await supabase.from("point_cards").select("id,card_id,title").in("card_id",cardIds);
    if (cardsResult.error) throw mapDatabaseError(cardsResult.error);
    const cards = cardsResult.data || [];
    const internalIds = cards.map((row:any) => row.id);
    const balancesResult = internalIds.length
      ? await supabase.from("point_balances").select("point_card_id,stamps").eq("member_id",memberId).in("point_card_id",internalIds)
      : { data:[],error:null };
    if (balancesResult.error) throw mapDatabaseError(balancesResult.error);

    const cardsByPublicId = new Map(cards.map((row:any) => [String(row.card_id),row]));
    const balances = new Map((balancesResult.data || []).map((row:any) => [String(row.point_card_id),Number(row.stamps || 0)]));

    for (const item of pointItems) {
      const cardId = asText(item.cardId,120);
      const amount = Number(item.amount || 0);
      if (!cardId || !Number.isFinite(amount) || amount <= 0) continue;
      const card:any = cardsByPublicId.get(cardId);
      if (!card) continue;
      sections.push(
        "【點數發放】\n" +
        String(card.title || "集點卡") + "\n" +
        "本次發放：+" + amount + " 點\n" +
        "目前點數：" + Number(balances.get(String(card.id)) || 0) + " 點"
      );
    }
  }

  if (serviceMinutes > 0) {
    sections.push(
      "【服務時間發放】\n" +
      "本次發放：+" + serviceMinutes + " 分鐘\n" +
      "目前服務時間：" + totalServiceMinutes + " 分鐘\n" +
      "會員等級：" + tierLabel
    );
  }

  if (!sections.length) return { status:"skipped",message:"本次沒有需要推播的發放內容。" };

  try {
    const ticketSection = await grantAvailableTicketSection(supabase,memberId,tierKey,cardIds);
    if (ticketSection) sections.push(ticketSection);
  } catch {
    // 票券摘要屬於附加資訊；同步失敗時仍需送出主要發放通知，避免成功發放卻沒有 LINE 訊息。
  }

  const body = {
    to: lineUserId,
    messages: [{
      type: "text",
      text: (greetingName + " 您好！\n\n" + (announcement ? announcement + "\n\n" : "") + sections.join("\n\n")).slice(0,4500),
    }],
  };

  let response: Response;
  try {
    response = await fetch("https://api.line.me/v2/bot/message/push",{
      method:"POST",
      headers:{
        "Authorization":"Bearer " + token,
        "Content-Type":"application/json",
        "X-Line-Retry-Key":crypto.randomUUID(),
      },
      body:JSON.stringify(body),
    });
  } catch {
    await supabase.from("audit_logs").insert({
      audit_id:requestId("AUD"),
      actor_line_user_id:null,
      actor_role:"system",
      action:"line.push.grant",
      target_type:"member",
      target_id:lineUserId,
      result:"failed",
      detail:{ requestId:requestIdValue,reason:"network_error" },
    });
    return { status:"failed",message:"發放已成功，但 LINE 推播連線失敗。" };
  }

  const lineRequestId = response.headers.get("x-line-request-id") || "";
  await supabase.from("audit_logs").insert({
    audit_id:requestId("AUD"),
    actor_line_user_id:null,
    actor_role:"system",
    action:"line.push.grant",
    target_type:"member",
    target_id:lineUserId,
    result:response.ok ? "success" : "failed",
    detail:{ requestId:requestIdValue,httpStatus:response.status,lineRequestId },
  });

  if (!response.ok) {
    return { status:"failed",message:"發放已成功，但 LINE 推播未送達。" };
  }
  return { status:"sent",message:"發放成功，LINE 通知已送出。" };
}

async function saveTicketTemplate(supabase: SupabaseClient, actor: string, body: Json): Promise<Json> {
  const ticket = body.ticket && typeof body.ticket === "object" ? body.ticket as Json : {};
  const ticketTemplateId = asText(ticket.ticketTemplateId,100);
  const title = requireText(ticket.title,"票券名稱",100);
  const ticketType = asText(ticket.ticketType,20);
  if (!["coupon","lottery"].includes(ticketType)) throw new ApiError(400,"INVALID_TICKET_TYPE","票券類型不合法。");
  const prizes = normalizePrizes(ticket.prizes,ticketType === "lottery");
  const payload = {
    title,
    ticket_type: ticketType,
    description: requireText(ticket.description,"票券說明",240),
    usage_method: requireText(ticket.usageMethod,"使用方式",120),
    usage_instructions: requireText(ticket.usageInstructions,"使用說明",500),
    prizes,
    status: requireStatus(ticket.status),
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };
  let row;
  if (ticketTemplateId) {
    const current = await supabase.from("ticket_templates").select("*").eq("ticket_template_id",ticketTemplateId).single();
    if (current.error) throw new ApiError(404,"TICKET_TEMPLATE_NOT_FOUND","找不到指定票券。");
    const expected = asText(body.expectedUpdatedAt,100);
    if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","票券已被其他管理者更新，請重新整理。");
    const result = await supabase.from("ticket_templates").update(payload).eq("id",current.data.id).select("*").single();
    if (result.error) throw mapDatabaseError(result.error);
    row = result.data;
  } else {
    const result = await supabase.from("ticket_templates").insert({
      ticket_template_id: requestId("TT"),
      ...payload,
      created_by: actor,
    }).select("*").single();
    if (result.error) throw mapDatabaseError(result.error);
    row = result.data;
  }
  return { ticket: mapTicketTemplate(row) };
}

async function saveEventTicket(supabase: SupabaseClient, actor: string, body: Json): Promise<Json> {
  const input = body.eventTicket && typeof body.eventTicket === "object" ? body.eventTicket as Json : {};
  const id = asText(input.eventTicketId,100);
  const ticketType = asText(input.ticketType,20);
  if (!["coupon","lottery"].includes(ticketType)) throw new ApiError(400,"INVALID_TICKET_TYPE","票券類型不合法。");
  const startsOn = asText(input.startsOn,20);
  const endsOn = asText(input.endsOn,20);
  if (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) throw new ApiError(400,"INVALID_DATE","活動開始日格式不正確。");
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw new ApiError(400,"INVALID_DATE","活動結束日格式不正確。");
  if (startsOn && endsOn && endsOn < startsOn) throw new ApiError(400,"INVALID_DATE_RANGE","活動結束日不可早於開始日。");
  const quota = Number(input.quota || 0);
  if (!Number.isInteger(quota) || quota < 0 || quota > 1_000_000) throw new ApiError(400,"INVALID_QUOTA","發放上限必須是 0–1,000,000。");
  const payload = {
    title: requireText(input.title,"活動票券名稱",100),
    ticket_type: ticketType,
    description: requireText(input.description,"票券說明",240),
    usage_method: requireText(input.usageMethod,"使用方式",120),
    usage_instructions: requireText(input.usageInstructions,"使用說明",500),
    prizes: normalizePrizes(input.prizes,ticketType === "lottery"),
    status: requireStatus(input.status),
    starts_on: startsOn || null,
    ends_on: endsOn || null,
    quota,
    accent: requireAccent(input.accent),
    allowed_tier_keys: normalizeTierKeys(input.allowedTierKeys),
    updated_by: actor,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  let row;
  if (id) {
    const current = await supabase.from("event_tickets").select("*").eq("event_ticket_id",id).is("deleted_at",null).single();
    if (current.error) throw new ApiError(404,"EVENT_TICKET_NOT_FOUND","找不到指定活動票券。");
    const expected = asText(body.expectedUpdatedAt,100);
    if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","活動票券已被其他管理者更新，請重新整理。");
    const result = await supabase.from("event_tickets").update(payload).eq("id",current.data.id).select("*").single();
    if (result.error) throw mapDatabaseError(result.error);
    row = result.data;
  } else {
    const result = await supabase.from("event_tickets").insert({
      event_ticket_id: requestId("EVT"),
      ...payload,
      created_by: actor,
    }).select("*").single();
    if (result.error) throw mapDatabaseError(result.error);
    row = result.data;
  }
  const claims = await supabase.from("event_ticket_claims").select("*",{ count:"exact",head:true }).eq("event_ticket_id",row.id);
  if (claims.error) throw mapDatabaseError(claims.error);
  return { eventTicket:eventTicketClient(row,claims.count || 0) };
}

async function handleAction(supabase: SupabaseClient, identity: { lineUserId: string; displayName: string }, action: string, body: Json): Promise<Json> {
  if (action === "user.member.bootstrap") {
    const member = await ensureMember(supabase,identity);
    return { profile: await profileFor(supabase,member) };
  }
  if (action === "user.member.profile.save") {
    const member = await ensureMember(supabase,identity);
    const birthday = asText(body.birthday,20);
    const phone = asText(body.phone,30).replace(/[()\s-]/g,"");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new ApiError(400,"INVALID_BIRTHDAY","請填寫正確的生日。");
    if (!/^\+?\d{8,15}$/.test(phone)) throw new ApiError(400,"INVALID_PHONE","請填寫正確的電話。");
    const result = await supabase.from("members").update({
      birthday,
      phone,
      membership_status: "active",
      joined_at: member.joined_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id",member.id).select("*").single();
    if (result.error) throw mapDatabaseError(result.error);
    await supabase.from("audit_logs").insert({
      audit_id: requestId("AUD"), actor_line_user_id: identity.lineUserId, actor_role:"member",
      action,target_type:"member",target_id:identity.lineUserId,result:"success",
    });
    return { profile: await profileFor(supabase,result.data) };
  }

  if (action.startsWith("user.pointcard.")) {
    const member = await requireJoinedMember(supabase,identity);
    if (action === "user.pointcard.bootstrap") return await pointBootstrap(supabase,member);
    if (action === "user.pointcard.detail") {
      const snapshot = await pointBootstrap(supabase,member);
      const cardId = asText(body.cardId,100);
      return { detail: (snapshot.cardDetails as Json)?.[cardId] || null };
    }
    if (action === "user.pointcard.ticket.redeem") {
      const ticketId = requireText(body.ticketId,"票券識別",120);
      const rpc = await supabase.rpc("redeem_point_ticket",{ p_line_user_id:identity.lineUserId,p_ticket_id:ticketId });
      if (rpc.error) throw mapDatabaseError(rpc.error);
      const ticketRes = await supabase.from("point_tickets").select("*,point_cards(card_id,title)").eq("ticket_id",ticketId).single();
      if (ticketRes.error) throw mapDatabaseError(ticketRes.error);
      const row:any = ticketRes.data;
      const balanceRes = await supabase.from("point_balances").select("*").eq("member_id",member.id).eq("point_card_id",row.point_card_id).single();
      if (balanceRes.error) throw mapDatabaseError(balanceRes.error);
      const nextRes = await supabase.from("point_tickets").select("*").eq("member_id",member.id).eq("point_card_id",row.point_card_id).eq("status","available").order("created_at",{ ascending:false });
      if (nextRes.error) throw mapDatabaseError(nextRes.error);
      const cardId = row.point_cards?.card_id || "";
      const ticket = pointTicketClient(row,cardId);
      const activity = {
        activityId:"point-ticket:" + row.ticket_id, referenceId:row.ticket_id, ticketId:row.ticket_id,
        ticketType:row.ticket_type,ticketTitle:row.ticket_title,cardTitle:row.point_cards?.title || "集點卡",
        pointsSpent:Number(row.points_spent || row.threshold_stamps),result:row.result || null,occurredAt:row.used_at || row.updated_at,
      };
      return {
        ticket,
        balance:{ cardId,stamps:Number(balanceRes.data.stamps || 0),updatedAt:balanceRes.data.updated_at },
        nextTickets:(nextRes.data || []).map((item:any) => pointTicketClient(item,cardId)),
        activity,
      };
    }
  }

  if (action.startsWith("user.event.")) {
    const member = await requireJoinedMember(supabase,identity);
    if (action === "user.event.bootstrap") return await eventBootstrap(supabase,member);
    if (action === "user.event.ticket.detail") {
      const snapshot:any = await eventBootstrap(supabase,member);
      const eventTicketId = asText(body.eventTicketId,100);
      return { offer:[...(snapshot.offers || []),...(snapshot.usedTickets || [])].find((offer:any) => String(offer.ticket?.eventTicketId || offer.claim?.eventTicketId) === eventTicketId) || null };
    }
    if (action === "user.event.ticket.claim") {
      const eventTicketId = requireText(body.eventTicketId,"活動票券識別",120);
      const rpc = await supabase.rpc("claim_event_ticket",{ p_line_user_id:identity.lineUserId,p_event_ticket_id:eventTicketId });
      if (rpc.error) throw mapDatabaseError(rpc.error);
      const claimId = String((rpc.data as Json)?.claimId || "");
      const claimRes = await supabase.from("event_ticket_claims").select("*,event_tickets(event_ticket_id)").eq("claim_id",claimId).single();
      if (claimRes.error) throw mapDatabaseError(claimRes.error);
      return { ticket:claimClient(claimRes.data,claimRes.data.event_tickets?.event_ticket_id || eventTicketId),alreadyClaimed:Boolean((rpc.data as Json)?.alreadyClaimed) };
    }
    if (action === "user.event.ticket.redeem") {
      const claimId = requireText(body.claimId,"已領取票券識別",120);
      const rpc = await supabase.rpc("redeem_event_ticket",{ p_line_user_id:identity.lineUserId,p_claim_id:claimId });
      if (rpc.error) throw mapDatabaseError(rpc.error);
      const claimRes = await supabase.from("event_ticket_claims").select("*,event_tickets(event_ticket_id)").eq("claim_id",claimId).single();
      if (claimRes.error) throw mapDatabaseError(claimRes.error);
      return { ticket:claimClient(claimRes.data,claimRes.data.event_tickets?.event_ticket_id || "") };
    }
  }

  if (action.startsWith("user.calendar.")) {
    const member = await requireJoinedMember(supabase,identity);
    const profile = await profileFor(supabase,member);
    const items = await calendarItems(supabase,true);
    if (action === "user.calendar.bootstrap") return { profile,items };
    const date = asText(body.date,20);
    return { profile,items:items.filter((item:any) => item.startsOn <= date && (item.endsOn || item.startsOn) >= date) };
  }

  if (!action.startsWith("admin.")) throw new ApiError(404,"ACTION_NOT_FOUND","不支援的 API action。");
  const admin = await authorizeAdmin(supabase,identity);

  if (action === "admin.bootstrap") {
    const [members,tierRows,cardData,eventTickets,calendar,stats,messagePresets] = await Promise.all([
      membersPage(supabase,1,100,""),
      tierSettings(supabase),
      adminCards(supabase),
      adminEventTickets(supabase),
      calendarItems(supabase,false),
      summaryStats(supabase),
      grantMessagePresets(supabase,true),
    ]);
    return {
      profile:{ displayName:admin.display_name || identity.displayName },
      role:"Admin",
      members:members.members,
      memberPage:members.memberPage,
      tierSettings:tierSettingsClient(tierRows),
      cards:cardData.cards,
      tickets:cardData.tickets,
      eventTickets,
      calendarItems:calendar,
      messagePresets,
      stats,
    };
  }
  if (action === "admin.members.list") {
    return await membersPage(supabase,Number(body.memberPage || 1),Number(body.memberPageSize || 100),asText(body.memberQuery,100));
  }
  if (action === "admin.pointcards.list") {
    const data = await adminCards(supabase);
    return { ...data,stats:await summaryStats(supabase) };
  }
  if (action === "admin.event-tickets.list") return { eventTickets:await adminEventTickets(supabase),stats:await summaryStats(supabase) };
  if (action === "admin.calendar-items.list") return { calendarItems:await calendarItems(supabase,false) };
  if (action === "admin.summary") return { stats:await summaryStats(supabase) };

  if (action === "admin.grant-message-presets.save") {
    const preset = body.messagePreset && typeof body.messagePreset === "object" ? body.messagePreset as Json : {};
    const presetId = asText(preset.presetId,120);
    const title = requireText(preset.title,"預設訊息名稱",80);
    const message = requireText(preset.message,"預設訊息內容",1000);
    const status = asText(preset.status,20);
    if (!["active","archived"].includes(status)) throw new ApiError(400,"INVALID_MESSAGE_PRESET_STATUS","預設訊息狀態不合法。");
    const sortOrder = Number(preset.sortOrder || 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) throw new ApiError(400,"INVALID_MESSAGE_PRESET_SORT","預設訊息排序不合法。");
    const now = new Date().toISOString();
    let savedPresetId = presetId;
    if (presetId) {
      const current = await supabase.from("grant_message_presets").select("*").eq("preset_id",presetId).single();
      if (current.error) throw new ApiError(404,"MESSAGE_PRESET_NOT_FOUND","找不到指定預設訊息。");
      const expected = asText(body.expectedUpdatedAt,100);
      if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","預設訊息已被其他管理者更新。");
      const updated = await supabase.from("grant_message_presets").update({
        title,message,status,sort_order:sortOrder,updated_by:identity.lineUserId,updated_at:now,
      }).eq("id",current.data.id);
      if (updated.error) throw mapDatabaseError(updated.error);
    } else {
      savedPresetId = "GMP-" + crypto.randomUUID().replaceAll("-","").slice(0,16).toUpperCase();
      const inserted = await supabase.from("grant_message_presets").insert({
        preset_id:savedPresetId,title,message,status,sort_order:sortOrder,
        created_by:identity.lineUserId,updated_by:identity.lineUserId,created_at:now,updated_at:now,
      });
      if (inserted.error) throw mapDatabaseError(inserted.error);
    }
    await supabase.from("audit_logs").insert({
      audit_id:requestId("AUD"),
      actor_line_user_id:identity.lineUserId,
      actor_role:admin.role || "admin",
      action:"GRANT_MESSAGE_PRESET_SAVE",
      target_type:"grant_message_preset",
      target_id:savedPresetId,
      result:"success",
      detail:{ status,sortOrder },
    });
    const messagePresets = await grantMessagePresets(supabase,true);
    return { messagePreset:messagePresets.find((item:any) => item.presetId === savedPresetId) || null,messagePresets };
  }

  if (action === "admin.member.update") {
    const lineUserId = requireText(body.lineUserId,"會員識別",120);
    const status = asText(body.status,20);
    if (!["active","disabled"].includes(status)) throw new ApiError(400,"INVALID_STATUS","會員狀態不合法。");
    const current = await supabase.from("members").select("*").eq("line_user_id",lineUserId).single();
    if (current.error) throw new ApiError(404,"MEMBER_NOT_FOUND","找不到指定會員。");
    const expected = asText(body.expectedUpdatedAt,100);
    if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","會員資料已被其他管理者更新。");
    const updated = await supabase.from("members").update({ status,updated_at:new Date().toISOString() }).eq("id",current.data.id).select("*").single();
    if (updated.error) throw mapDatabaseError(updated.error);
    const settings = await tierSettings(supabase);
    const totals = await serviceMinutesForMembers(supabase,[updated.data.id]);
    const minutes = totals.get(updated.data.id) || 0;
    const tier = tierForMinutes(settings,minutes);
    return { member:{ lineUserId:updated.data.line_user_id,displayName:updated.data.display_name,memberCode:updated.data.member_code,status:updated.data.status,joinedAt:updated.data.joined_at || updated.data.created_at,serviceMinutesTotal:minutes,tierKey:tier.tier_key,tier:tier.tier_label,tierStyleKey:tier.style_key,updatedAt:updated.data.updated_at } };
  }

  if (action === "admin.member-tiers.save") {
    if (!Array.isArray(body.tierSettings)) throw new ApiError(400,"INVALID_TIER_SETTINGS","會員等級設定格式不正確。");
    const rpc = await supabase.rpc("save_tier_settings",{ p_actor_line_user_id:identity.lineUserId,p_settings:body.tierSettings });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    return { tierSettings:tierSettingsClient(await tierSettings(supabase)) };
  }

  if (action === "admin.pointcards.save") {
    const card = body.card && typeof body.card === "object" ? body.card as Json : {};
    requireText(card.title,"集點卡名稱",100);
    requireStatus(card.status);
    requireAccent(card.accent);
    const expiryMode = asText(card.expiryMode,20);
    if (!["unlimited","date"].includes(expiryMode)) throw new ApiError(400,"INVALID_EXPIRY","集點卡期限設定不正確。");
    if (expiryMode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(asText(card.expiresOn,20))) throw new ApiError(400,"INVALID_EXPIRY","請選擇有效的到期日。");
    const rewards = Array.isArray(card.rewards) ? card.rewards as Json[] : [];
    const thresholds = new Set<number>();
    for (const reward of rewards) {
      const threshold = Number(reward.thresholdStamps);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100 || thresholds.has(threshold)) throw new ApiError(400,"INVALID_REWARD","兌換節點必須是 1–100 且不可重複。");
      thresholds.add(threshold);
      requireText(reward.ticketTemplateId,"兌換票券",120);
    }
    const normalized = { ...card,title:asText(card.title,100),status:asText(card.status,20),accent:requireAccent(card.accent),styleKey:safeStyle(card.styleKey),expiryMode,expiresOn:expiryMode === "date" ? asText(card.expiresOn,20) : "",usageMethod:asText(card.usageMethod,120),usageInstructions:asText(card.usageInstructions,500),benefitDescription:asText(card.benefitDescription,500),rewards };
    const rpc = await supabase.rpc("save_point_card",{ p_actor_line_user_id:identity.lineUserId,p_card:normalized,p_expected_updated_at:asText(body.expectedUpdatedAt,100) || null });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    const cards = await adminCards(supabase);
    return { card:cards.cards.find((item:any) => item.cardId === rpc.data) || null };
  }

  if (action === "admin.pointcards.reorder") {
    if (!Array.isArray(body.cardOrders)) throw new ApiError(400,"INVALID_CARD_ORDERS","排序資料格式不正確。");
    const rpc = await supabase.rpc("reorder_point_cards",{ p_actor_line_user_id:identity.lineUserId,p_orders:body.cardOrders });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    return { cards:(await adminCards(supabase)).cards };
  }

  if (action === "admin.pointcards.archive" || action === "admin.pointcards.remove") {
    const cardId = requireText(body.cardId,"集點卡識別",120);
    const current = await supabase.from("point_cards").select("*").eq("card_id",cardId).single();
    if (current.error) throw new ApiError(404,"POINT_CARD_NOT_FOUND","找不到指定集點卡。");
    const expected = asText(body.expectedUpdatedAt,100);
    if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","集點卡已被其他管理者更新。");
    const result = await supabase.from("point_cards").update({ status:"archived",updated_by:identity.lineUserId,updated_at:new Date().toISOString() }).eq("id",current.data.id);
    if (result.error) throw mapDatabaseError(result.error);
    return { card:(await adminCards(supabase)).cards.find((item:any) => item.cardId === cardId) || null };
  }

  if (action === "admin.pointcards.delete") {
    const cardId = requireText(body.cardId,"集點卡識別",120);
    const current = await supabase.from("point_cards").select("*").eq("card_id",cardId).single();
    if (current.error) throw new ApiError(404,"POINT_CARD_NOT_FOUND","找不到指定集點卡。");
    const expected = asText(body.expectedUpdatedAt,100);
    if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","集點卡已被其他管理者更新。");
    const rpc = await supabase.rpc("delete_point_card",{ p_actor_line_user_id:identity.lineUserId,p_card_id:cardId });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    return { deleted:true,cardId };
  }

  if (action === "admin.tickets.save") return await saveTicketTemplate(supabase,identity.lineUserId,body);

  if (action === "admin.event-tickets.save") return await saveEventTicket(supabase,identity.lineUserId,body);

  if (action === "admin.event-tickets.delete") {
    const eventTicketId = requireText(body.eventTicketId,"活動票券識別",120);
    const current = await supabase.from("event_tickets").select("*").eq("event_ticket_id",eventTicketId).is("deleted_at",null).single();
    if (current.error) throw new ApiError(404,"EVENT_TICKET_NOT_FOUND","找不到指定活動票券。");
    const expected = asText(body.expectedUpdatedAt,100);
    if (expected && expected !== current.data.updated_at) throw new ApiError(409,"CONFLICT","活動票券已被其他管理者更新。");
    const claims = await supabase.from("event_ticket_claims").select("*",{ count:"exact",head:true }).eq("event_ticket_id",current.data.id);
    if (claims.error) throw mapDatabaseError(claims.error);
    const update = await supabase.from("event_tickets").update({ status:"archived",deleted_at:new Date().toISOString(),updated_by:identity.lineUserId,updated_at:new Date().toISOString() }).eq("id",current.data.id);
    if (update.error) throw mapDatabaseError(update.error);
    return { deleted:true,eventTicketId,preservedClaimCount:claims.count || 0 };
  }

  if (action === "admin.calendar-items.save") {
    const item = body.calendarItem && typeof body.calendarItem === "object" ? body.calendarItem as Json : {};
    const rpc = await supabase.rpc("apply_calendar_batch",{ p_actor_line_user_id:identity.lineUserId,p_operations:[{ action:"save",calendarItem:item,expectedUpdatedAt:body.expectedUpdatedAt || "" }] });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    const id = String((rpc.data as any[])?.[0]?.calendarItemId || "");
    return { calendarItem:(await calendarItems(supabase,false)).find((entry:any) => entry.calendarItemId === id) || null };
  }
  if (action === "admin.calendar-items.delete") {
    const id = requireText(body.calendarItemId,"日曆項目識別",120);
    const rpc = await supabase.rpc("apply_calendar_batch",{ p_actor_line_user_id:identity.lineUserId,p_operations:[{ action:"delete",calendarItemId:id,expectedUpdatedAt:body.expectedUpdatedAt || "" }] });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    return { deleted:true,calendarItemId:id };
  }
  if (action === "admin.calendar-items.batch") {
    if (!Array.isArray(body.calendarItemOperations)) throw new ApiError(400,"INVALID_CALENDAR_BATCH","日曆批次操作格式不正確。");
    const rpc = await supabase.rpc("apply_calendar_batch",{ p_actor_line_user_id:identity.lineUserId,p_operations:body.calendarItemOperations });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    return { operations:rpc.data || [],calendarItems:await calendarItems(supabase,false) };
  }

  if (action === "admin.member-grants.add" || action === "admin.stamps.add" || action === "admin.service_minutes.add") {
    const lineUserId = requireText(body.lineUserId,"會員識別",120);
    const req = requireText(body.requestId,"操作識別碼",100);
    const messagePresetId = asText(body.messagePresetId,120);
    let selectedMessagePreset: any = null;
    if (messagePresetId) {
      const presetResult = await supabase.from("grant_message_presets").select("*").eq("preset_id",messagePresetId).eq("status","active").maybeSingle();
      if (presetResult.error) throw mapDatabaseError(presetResult.error);
      if (!presetResult.data) throw new ApiError(400,"MESSAGE_PRESET_NOT_AVAILABLE","選擇的預設訊息目前無法使用。");
      selectedMessagePreset = presetResult.data;
    }
    let points: unknown = body.points;
    let serviceMinutes = 0;
    if (action === "admin.stamps.add") points = [{ cardId:body.cardId,amount:Number(body.amount) }];
    if (action === "admin.service_minutes.add") serviceMinutes = Number(body.minutes || (body.serviceTime as Json)?.minutes || 0);
    if (action === "admin.member-grants.add") serviceMinutes = Number((body.serviceTime as Json)?.minutes || 0);

    const normalizedPoints = Array.isArray(points) ? points : [];
    const rpc = await supabase.rpc("grant_member_benefits",{
      p_actor_line_user_id:identity.lineUserId,
      p_member_line_user_id:lineUserId,
      p_request_id:req,
      p_points:normalizedPoints,
      p_service_minutes:serviceMinutes || 0,
      p_note:"",
    });
    if (rpc.error) throw mapDatabaseError(rpc.error);

    const grantResult = (rpc.data && typeof rpc.data === "object" ? rpc.data : {}) as Json;
    const memberRow = await supabase.from("members").select("*").eq("line_user_id",lineUserId).single();
    if (memberRow.error) throw mapDatabaseError(memberRow.error);
    const settings = await tierSettings(supabase);
    const totals = await serviceMinutesForMembers(supabase,[memberRow.data.id]);
    const minutes = totals.get(memberRow.data.id)||0;
    const tier = tierForMinutes(settings,minutes);

    let notification: GrantNotificationResult = {
      status:"skipped",
      message:"此操作已處理，不重複發送 LINE 通知。",
    };
    if (Boolean(grantResult.applied)) {
      try {
        notification = await pushGrantNotification(
          supabase,
          lineUserId,
          memberRow.data.display_name || "會員",
          memberRow.data.id,
          req,
          normalizedPoints,
          serviceMinutes,
          selectedMessagePreset?.message || "",
          minutes,
          tier.tier_key,
          tier.tier_label,
        );
      } catch {
        notification = { status:"failed",message:"發放已成功，但 LINE 推播處理失敗。" };
      }
    }

    return {
      member:{ lineUserId,displayName:memberRow.data.display_name,memberCode:memberRow.data.member_code,status:memberRow.data.status,joinedAt:memberRow.data.joined_at || memberRow.data.created_at,serviceMinutesTotal:minutes,tierKey:tier.tier_key,tier:tier.tier_label,tierStyleKey:tier.style_key,updatedAt:memberRow.data.updated_at },
      notification,
    };
  }

  throw new ApiError(404,"ACTION_NOT_FOUND","不支援的 API action。");
}

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  try {
    if (origin && !allowedOrigins().has(origin)) throw new ApiError(403,"ORIGIN_NOT_ALLOWED","此網站來源未被允許使用會員 API。");
    if (request.method === "OPTIONS") return new Response(null,{ status:204,headers:corsHeaders(origin) });
    if (request.method === "GET") return json(origin,{ ok:true,status:200,data:{ service:"MemberWebsocket Supabase Native",version:"1.0.0" } });
    if (request.method !== "POST") throw new ApiError(405,"METHOD_NOT_ALLOWED","不支援的 HTTP method。");

    const raw = await request.text();
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413,"REQUEST_TOO_LARGE","Request body 大小不合法。");
    let body: Json;
    try { body = JSON.parse(raw); } catch { throw new ApiError(400,"INVALID_JSON","Request body 必須是 JSON。"); }
    if (!body || Array.isArray(body) || typeof body !== "object") throw new ApiError(400,"INVALID_REQUEST","Request body 格式不合法。");

    const action = asText(body.action,80);
    const requestedClientType = asText(body.clientType,20);
    const idToken = asText(body.idToken,10000);
    if (!action) throw new ApiError(400,"INVALID_ACTION","API action 不合法。");
    if (!idToken) throw new ApiError(401,"AUTH_REQUIRED","需要 LINE 登入。");
    const clientType = clientTypeForAction(action);
    if (requestedClientType && requestedClientType !== clientType) throw new ApiError(400,"CLIENT_TYPE_MISMATCH","Client type 與 API action 不一致。");

    const identity = await verifyLineIdToken(idToken,clientType);
    const supabase = dbClient();
    await consumeRateLimit(supabase,identity.lineUserId,action,body);
    const data = await handleAction(supabase,identity,action,body);
    await emitRealtime(supabase,action);
    return json(origin,{ ok:true,status:200,data:data || {} },200);
  } catch (error) {
    return errorResponse(origin,error);
  }
}

export default { fetch: handleRequest };
