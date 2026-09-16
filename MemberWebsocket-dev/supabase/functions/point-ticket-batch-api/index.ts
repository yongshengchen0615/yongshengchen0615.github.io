import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };

const MAX_REQUEST_BYTES = 40_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;
const USER_ACTIONS = new Set([
  "user.pointcard.tickets.overview",
  "user.pointcard.tickets.redeem",
]);
const ADMIN_ACTIONS = new Set([
  "admin.pointcards.ticket-limits",
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

function mapDatabaseError(error: unknown): ApiError {
  const message = String((error as { message?: string })?.message || "");
  const rules: Array<[string, number, string, string]> = [
    ["INVALID_REQUEST_ID",400,"INVALID_REQUEST_ID","操作識別碼格式不正確。"],
    ["INVALID_TICKET_BATCH",400,"INVALID_TICKET_BATCH","請至少選擇 1 張、最多 50 張票券，且不可重複選取。"],
    ["TICKET_BATCH_LIMIT_EXCEEDED",409,"TICKET_BATCH_LIMIT_EXCEEDED","選取張數超過其中一張集點卡設定的單次使用上限。"],
    ["MEMBERSHIP_REQUIRED",403,"MEMBERSHIP_REQUIRED","請先完成會員加入後再使用此功能。"],
    ["TICKET_NOT_FOUND",404,"TICKET_NOT_FOUND","部分票券已不存在，請重新整理後再試。"],
    ["TICKET_NOT_AVAILABLE",409,"TICKET_NOT_AVAILABLE","部分票券已不是可使用狀態，請重新整理後再試。"],
    ["POINT_CARD_NOT_AVAILABLE",409,"POINT_CARD_NOT_AVAILABLE","部分集點卡目前無法使用。"],
    ["POINT_CARD_EXPIRED",409,"POINT_CARD_EXPIRED","部分集點卡已超過使用期限。"],
    ["INSUFFICIENT_POINTS",409,"INSUFFICIENT_POINTS","選取票券所需點數超過目前可用點數。"],
  ];
  for (const [needle,status,code,userMessage] of rules) {
    if (message.includes(needle)) return new ApiError(status,code,userMessage);
  }
  return new ApiError(500,"DATABASE_ERROR","資料庫暫時無法完成操作。");
}

function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = error instanceof ApiError ? error : mapDatabaseError(error);
  return json(origin, {
    ok: false,
    status: apiError.status,
    error: { code: apiError.code, message: apiError.message, details: apiError.details },
  }, apiError.status);
}

function asText(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0,max);
}

async function readBody(request: Request): Promise<Json> {
  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) throw new ApiError(413,"REQUEST_TOO_LARGE","請求內容過大。");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413,"REQUEST_TOO_LARGE","請求內容過大。");
  let value: unknown;
  try { value = JSON.parse(raw || "{}"); }
  catch { throw new ApiError(400,"INVALID_JSON","請求格式不正確。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400,"INVALID_JSON","請求格式不正確。");
  return value as Json;
}

function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503,"SUPABASE_CONFIG_MISSING","Supabase server 設定尚未完成。");
  return createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
}

function channelIdForAction(action: string): string {
  const key = ADMIN_ACTIONS.has(action) ? "LINE_ADMIN_CHANNEL_ID" : "LINE_POINTS_CHANNEL_ID";
  const fallback = ADMIN_ACTIONS.has(action) ? "2010791619" : "2010787602";
  const value = env(key) || fallback;
  if (!/^\d{5,30}$/.test(value)) throw new ApiError(503,"AUTH_CONFIG_MISSING","LINE 驗證設定尚未完成。");
  return value;
}

async function verifyLineIdToken(idToken: string, action: string): Promise<Identity> {
  const expectedChannelId = channelIdForAction(action);
  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded" },
      body:new URLSearchParams({ id_token:idToken,client_id:expectedChannelId }),
    });
  } catch {
    throw new ApiError(503,"LINE_AUTH_UNAVAILABLE","LINE 身分驗證服務暫時無法使用。");
  }
  let payload: Json;
  try { payload = await response.json(); }
  catch { throw new ApiError(503,"LINE_AUTH_UNAVAILABLE","LINE 身分驗證服務暫時無法使用。"); }
  const sub = asText(payload.sub,120);
  const aud = asText(payload.aud,120);
  const iss = asText(payload.iss,120);
  const exp = Number(payload.exp || 0);
  if (!response.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401,"AUTH_INVALID","LINE 登入已失效，請重新登入。");
  }
  return { lineUserId:sub,displayName:asText(payload.name,120) || "LINE 使用者" };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2,"0")).join("");
}

async function consumeRateLimit(supabase: SupabaseClient, principal: string, isWrite: boolean): Promise<void> {
  const { data,error } = await supabase.rpc("consume_api_rate_limit",{
    p_principal_hash:await sha256(principal),
    p_is_write:isWrite,
    p_cost:1,
    p_read_limit:READ_LIMIT,
    p_write_limit:WRITE_LIMIT,
  });
  if (error) throw new ApiError(503,"RATE_LIMIT_UNAVAILABLE","無法確認請求頻率限制。");
  if (!data) throw new ApiError(429,"RATE_LIMITED","請求過於密集，請稍後再試。");
}

async function requireMember(supabase: SupabaseClient, identity: Identity): Promise<any> {
  const { data,error } = await supabase.from("members").select("id,line_user_id,membership_status,status").eq("line_user_id",identity.lineUserId).maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data || data.membership_status !== "active" || data.status !== "active") throw new ApiError(403,"MEMBERSHIP_REQUIRED","請先完成會員加入後再使用此功能。");
  return data;
}

async function requireAdmin(supabase: SupabaseClient, identity: Identity): Promise<any> {
  const { data,error } = await supabase.from("admins").select("id,line_user_id,role,status").eq("line_user_id",identity.lineUserId).maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data || data.role !== "admin" || data.status !== "active") throw new ApiError(403,"ADMIN_REQUIRED","此帳號沒有管理權限。");
  return data;
}

function taipeiDate(): string {
  const parts: Record<string,string> = {};
  new Intl.DateTimeFormat("en-CA",{ timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit" })
    .formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") parts[part.type] = part.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isExpiredCard(row: any): boolean {
  return row.expiry_mode === "date" && Boolean(row.expires_on) && String(row.expires_on) < taipeiDate();
}

function ticketClient(row: any): Json {
  return {
    ticketId:String(row.ticket_id || ""),
    thresholdStamps:Number(row.threshold_stamps || 0),
    ticketType:String(row.ticket_type || "coupon"),
    ticketTitle:String(row.ticket_title || "票券"),
    ticketDescription:String(row.ticket_description || ""),
    usageMethod:String(row.usage_method || ""),
    usageInstructions:String(row.usage_instructions || ""),
    prizes:Array.isArray(row.prizes) ? row.prizes : [],
    status:String(row.status || ""),
    earnedAt:row.earned_at || "",
    usedAt:row.used_at || "",
    result:row.result || null,
    pointsSpent:Number(row.points_spent || 0),
  };
}

async function memberOverview(supabase: SupabaseClient, member: any): Promise<Json> {
  const cardsRes = await supabase.from("point_cards")
    .select("id,card_id,title,accent,status,expiry_mode,expires_on,sort_order,max_tickets_per_redemption")
    .eq("status","active")
    .order("sort_order",{ ascending:true })
    .order("created_at",{ ascending:true });
  if (cardsRes.error) throw mapDatabaseError(cardsRes.error);
  const cards = (cardsRes.data || []).filter((row:any) => !isExpiredCard(row));
  for (const card of cards) {
    const issue = await supabase.rpc("issue_eligible_point_tickets",{ p_member_id:member.id,p_point_card_id:card.id });
    if (issue.error) throw mapDatabaseError(issue.error);
  }
  const ids = cards.map((row:any) => row.id);
  const balancesRes = ids.length
    ? await supabase.from("point_balances").select("point_card_id,stamps,updated_at").eq("member_id",member.id).in("point_card_id",ids)
    : { data:[],error:null };
  if (balancesRes.error) throw mapDatabaseError(balancesRes.error);
  const ticketsRes = ids.length
    ? await supabase.from("point_tickets")
        .select("ticket_id,point_card_id,threshold_stamps,ticket_type,ticket_title,ticket_description,usage_method,usage_instructions,prizes,status,earned_at,used_at,result,points_spent")
        .eq("member_id",member.id).eq("status","available").in("point_card_id",ids)
        .order("earned_at",{ ascending:false })
    : { data:[],error:null };
  if (ticketsRes.error) throw mapDatabaseError(ticketsRes.error);
  const balanceByCard = new Map((balancesRes.data || []).map((row:any) => [String(row.point_card_id),row]));
  const ticketsByCard = new Map<string,any[]>();
  for (const row of ticketsRes.data || []) {
    const key = String(row.point_card_id);
    const items = ticketsByCard.get(key) || [];
    items.push(ticketClient(row));
    ticketsByCard.set(key,items);
  }
  const clientCards = cards.map((row:any) => {
    const balance = balanceByCard.get(String(row.id));
    const tickets = ticketsByCard.get(String(row.id)) || [];
    return {
      cardId:String(row.card_id),
      title:String(row.title || "集點卡"),
      accent:String(row.accent || "#e47845"),
      maxTicketsPerRedemption:Math.max(1,Math.min(50,Number(row.max_tickets_per_redemption || 1))),
      stamps:Number(balance?.stamps || 0),
      tickets,
      availableTicketCount:tickets.length,
    };
  });
  return {
    cards:clientCards,
    totalAvailable:clientCards.reduce((sum:any,card:any) => Number(sum) + Number(card.availableTicketCount || 0),0),
  };
}

function normalizeTicketIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new ApiError(400,"INVALID_TICKET_BATCH","請至少選擇 1 張、最多 50 張票券。");
  const ids = value.map((item) => asText(item,120));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new ApiError(400,"INVALID_TICKET_BATCH","票券選擇資料不正確或包含重複項目。");
  return ids;
}

async function emitRealtime(supabase: SupabaseClient): Promise<void> {
  const result = await supabase.from("realtime_events").insert([
    { scope:"points",event_type:"user.pointcard.tickets.redeem" },
    { scope:"admin",event_type:"user.pointcard.tickets.redeem" },
  ]);
  if (result.error) console.warn("realtime invalidation failed");
}

async function handleAction(supabase: SupabaseClient, identity: Identity, action: string, body: Json): Promise<Json> {
  if (action === "admin.pointcards.ticket-limits") {
    await requireAdmin(supabase,identity);
    const result = await supabase.from("point_cards").select("card_id,max_tickets_per_redemption,updated_at").order("sort_order",{ ascending:true });
    if (result.error) throw mapDatabaseError(result.error);
    return {
      cards:(result.data || []).map((row:any) => ({
        cardId:String(row.card_id),
        maxTicketsPerRedemption:Math.max(1,Math.min(50,Number(row.max_tickets_per_redemption || 1))),
        updatedAt:row.updated_at,
      })),
    };
  }

  const member = await requireMember(supabase,identity);
  if (action === "user.pointcard.tickets.overview") return await memberOverview(supabase,member);

  if (action === "user.pointcard.tickets.redeem") {
    const ticketIds = normalizeTicketIds(body.ticketIds);
    const requestId = asText(body.requestId,120);
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) throw new ApiError(400,"INVALID_REQUEST_ID","操作識別碼格式不正確。");
    const rpc = await supabase.rpc("redeem_point_tickets",{
      p_line_user_id:identity.lineUserId,
      p_ticket_ids:ticketIds,
      p_request_id:requestId,
    });
    if (rpc.error) throw mapDatabaseError(rpc.error);
    const redeemedRes = await supabase.from("point_tickets")
      .select("ticket_id,point_card_id,threshold_stamps,ticket_type,ticket_title,ticket_description,usage_method,usage_instructions,prizes,status,earned_at,used_at,result,points_spent,point_cards(card_id,title)")
      .eq("member_id",member.id).in("ticket_id",ticketIds);
    if (redeemedRes.error) throw mapDatabaseError(redeemedRes.error);
    await emitRealtime(supabase);
    return {
      redemption:rpc.data || {},
      redeemedTickets:(redeemedRes.data || []).map((row:any) => ({
        ...ticketClient(row),
        cardId:String(row.point_cards?.card_id || ""),
        cardTitle:String(row.point_cards?.title || "集點卡"),
      })),
      overview:await memberOverview(supabase,member),
    };
  }
  throw new ApiError(404,"ACTION_NOT_FOUND","不支援的 API action。");
}

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  try {
    if (origin && !allowedOrigins().has(origin)) throw new ApiError(403,"ORIGIN_NOT_ALLOWED","此網站來源未被允許使用會員 API。");
    if (request.method === "OPTIONS") return new Response(null,{ status:204,headers:corsHeaders(origin) });
    if (request.method === "GET") return json(origin,{ ok:true,status:200,data:{ service:"Point Ticket Batch API",version:"1.0.0" } });
    if (request.method !== "POST") throw new ApiError(405,"METHOD_NOT_ALLOWED","不支援的 HTTP method。");
    const body = await readBody(request);
    const action = asText(body.action,100);
    const idToken = asText(body.idToken,10000);
    if (!USER_ACTIONS.has(action) && !ADMIN_ACTIONS.has(action)) throw new ApiError(404,"ACTION_NOT_FOUND","不支援的 API action。");
    if (!idToken) throw new ApiError(401,"AUTH_REQUIRED","需要 LINE 登入。");
    const identity = await verifyLineIdToken(idToken,action);
    const supabase = dbClient();
    const isWrite = action === "user.pointcard.tickets.redeem";
    await consumeRateLimit(supabase,identity.lineUserId,isWrite);
    const data = await handleAction(supabase,identity,action,body);
    return json(origin,{ ok:true,status:200,data },200);
  } catch (error) {
    return errorResponse(origin,error);
  }
}

Deno.serve(handleRequest);
