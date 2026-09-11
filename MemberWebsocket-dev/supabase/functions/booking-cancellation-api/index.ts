import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };
type ClientType = "member" | "admin";

const MAX_REQUEST_BYTES = 20_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;
const WRITE_ACTIONS = new Set(["member.request", "admin.approve", "admin.reject"]);

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

function env(name: string): string { return (Deno.env.get(name) || "").trim(); }
function asText(value: unknown, max = 1000): string { return String(value ?? "").trim().slice(0, max); }
function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map((v) => v.trim()).filter(Boolean));
}
function corsHeaders(origin: string | null): HeadersInit {
  const resolved = origin && allowedOrigins().has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": resolved,
    "Access-Control-Allow-Headers": "content-type, apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}
function response(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" } });
}
function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "取消申請服務暫時無法完成操作。");
  return response(origin, { ok: false, status: apiError.status, error: { code: apiError.code, message: apiError.message, details: apiError.details } }, apiError.status);
}
function requireUuid(value: unknown, label: string): string {
  const text = asText(value, 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new ApiError(400, "INVALID_INPUT", `${label}格式不正確。`);
  return text;
}
function timeToMinutes(value: string): number {
  const [hour, minute] = String(value || "").slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}
function taipeiDate(): string {
  const parts: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") parts[part.type] = part.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function taipeiMinutes(): number {
  const parts: Record<string, string> = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") parts[part.type] = part.value; });
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}
function channelIdFor(clientType: ClientType): string {
  const name = clientType === "admin" ? "LINE_ADMIN_CHANNEL_ID" : "LINE_MEMBER_CHANNEL_ID";
  const fallback = clientType === "admin" ? "2010791619" : "2010787602";
  const value = env(name) || fallback;
  if (!/^\d{5,30}$/.test(value)) throw new ApiError(503, "AUTH_CONFIG_MISSING", "LINE 驗證設定尚未完成。");
  return value;
}
async function verifyLineIdToken(idToken: string, clientType: ClientType): Promise<Identity> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");
  const expectedChannelId = channelIdFor(clientType);
  let result: Response;
  try {
    result = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: expectedChannelId }),
    });
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }
  const payload = await result.json().catch(() => null) as any;
  const sub = String(payload?.sub || "").trim();
  const aud = String(payload?.aud || "").trim();
  const iss = String(payload?.iss || "").trim();
  const exp = Number(payload?.exp || 0);
  if (!result.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  return { lineUserId: sub, displayName: String(payload?.name || "LINE 使用者").slice(0, 120) };
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function consumeRateLimit(supabase: SupabaseClient, identity: Identity, action: string): Promise<void> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256(identity.lineUserId), p_is_write: WRITE_ACTIONS.has(action), p_cost: 1,
    p_read_limit: READ_LIMIT, p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。");
}
async function requireMember(supabase: SupabaseClient, identity: Identity): Promise<any> {
  const result = await supabase.from("members").select("id,status,membership_status").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認會員資料。");
  if (!result.data || result.data.membership_status !== "active") throw new ApiError(403, "MEMBERSHIP_REQUIRED", "請先加入會員並完成會員資料後再使用預約功能。");
  if (result.data.status !== "active") throw new ApiError(403, "MEMBER_DISABLED", "此會員目前已停用。");
  return result.data;
}
async function requireAdmin(supabase: SupabaseClient, identity: Identity): Promise<any> {
  const result = await supabase.from("admins").select("id,role,status").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認管理員權限。");
  if (!result.data || result.data.role !== "admin" || result.data.status !== "active") throw new ApiError(403, "ADMIN_REQUIRED", "管理端帳號尚未授權。");
  return result.data;
}
async function audit(supabase: SupabaseClient, identity: Identity, role: "member" | "admin", action: string, bookingId: string, metadata: Json = {}): Promise<void> {
  const result = await supabase.from("booking_audit_events").insert({ actor_line_user_id: identity.lineUserId, actor_role: role, action, target_type: "booking", target_id: bookingId, result: "success", metadata });
  if (result.error) console.error("booking cancellation audit failed", result.error.message);
}
function cancellationClient(row: any): Json {
  return {
    bookingId: row.id,
    status: row.status,
    sourceStatus: row.cancellation_source_status || row.status,
    bookingDate: row.booking_date,
    startTime: String(row.start_time || "").slice(0, 5),
    endTime: String(row.end_time || "").slice(0, 5),
    cancellationRequestedAt: row.cancellation_requested_at || null,
    updatedAt: row.updated_at,
  };
}
async function memberList(supabase: SupabaseClient, member: any): Promise<Json> {
  const result = await supabase.from("bookings")
    .select("id,status,booking_date,start_time,end_time,cancellation_source_status,cancellation_requested_at,updated_at")
    .eq("member_id", member.id).not("cancellation_requested_at", "is", null).is("cancellation_reviewed_at", null);
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法取得取消申請狀態。");
  return { requests: (result.data || []).map(cancellationClient) };
}
async function memberRequest(supabase: SupabaseClient, identity: Identity, member: any, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const existing = await supabase.from("bookings").select("*").eq("id", bookingId).eq("member_id", member.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取預約資料。");
  const booking = existing.data;
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "找不到這筆預約。");
  if (booking.cancellation_requested_at && !booking.cancellation_reviewed_at) return { request: cancellationClient(booking), alreadyRequested: true };
  if (!["pending", "confirmed"].includes(booking.status)) throw new ApiError(409, "BOOKING_NOT_CANCELLABLE", "這筆預約目前無法申請取消。");
  const today = taipeiDate();
  if (booking.booking_date < today || (booking.booking_date === today && timeToMinutes(String(booking.start_time).slice(0, 5)) <= taipeiMinutes())) throw new ApiError(409, "BOOKING_TIME_PASSED", "預約時間已經開始或經過，無法申請取消。");
  const now = new Date().toISOString();
  const updated = await supabase.from("bookings").update({
    cancellation_requested_at: now,
    cancellation_requested_by: identity.lineUserId,
    cancellation_source_status: booking.status,
    cancellation_reviewed_at: null,
    cancellation_reviewed_by: null,
    cancellation_decision: null,
  }).eq("id", bookingId).eq("member_id", member.id).eq("status", booking.status).eq("updated_at", booking.updated_at).select("*").maybeSingle();
  if (updated.error) throw new ApiError(500, "DATABASE_ERROR", "取消申請送出失敗。");
  if (!updated.data) throw new ApiError(409, "BOOKING_CONFLICT", "預約已更新，請重新整理後再申請取消。");
  await audit(supabase, identity, "member", "BOOKING_CANCELLATION_REQUESTED", bookingId, { sourceStatus: booking.status });
  return { request: cancellationClient(updated.data), alreadyRequested: false };
}
async function adminList(supabase: SupabaseClient): Promise<Json> {
  const result = await supabase.from("bookings")
    .select("id,status,member_id,booking_date,start_time,end_time,total_duration_minutes,member_note,admin_note,cancellation_source_status,cancellation_requested_at,updated_at,members(display_name,member_code)")
    .not("cancellation_requested_at", "is", null).is("cancellation_reviewed_at", null)
    .order("cancellation_requested_at", { ascending: true }).limit(250);
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法取得取消申請。");
  const rows = result.data || [];
  const ids = rows.map((row: any) => row.id);
  const items = ids.length ? await supabase.from("booking_items").select("booking_id,service_id,service_title,unit_duration_minutes,unit_price_amount,quantity").in("booking_id", ids).order("created_at", { ascending: true }) : { data: [], error: null } as any;
  if (items.error) throw new ApiError(500, "DATABASE_ERROR", "無法取得取消申請服務項目。");
  const grouped = new Map<string, any[]>();
  for (const item of items.data || []) {
    const list = grouped.get(item.booking_id) || [];
    list.push({ serviceId: item.service_id, serviceTitle: item.service_title, unitDurationMinutes: Number(item.unit_duration_minutes || 0), unitPriceAmount: Number(item.unit_price_amount || 0), quantity: Number(item.quantity || 1) });
    grouped.set(item.booking_id, list);
  }
  return { requests: rows.map((row: any) => ({
    ...cancellationClient(row), memberDisplayName: row.members?.display_name || "會員", memberCode: row.members?.member_code || "",
    totalDurationMinutes: Number(row.total_duration_minutes || 0), memberNote: row.member_note || "", adminNote: row.admin_note || "",
    items: grouped.get(row.id) || [],
  })) };
}
async function loadPendingRequest(supabase: SupabaseClient, bookingId: string): Promise<any> {
  const result = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取取消申請。");
  const booking = result.data;
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "找不到這筆預約。");
  if (!booking.cancellation_requested_at || booking.cancellation_reviewed_at) throw new ApiError(409, "CANCELLATION_NOT_PENDING", "這筆預約目前沒有待確認的取消申請。");
  if (!["pending", "confirmed"].includes(booking.status) || booking.status !== booking.cancellation_source_status) throw new ApiError(409, "BOOKING_CONFLICT", "預約狀態已變更，請重新整理後再處理取消申請。");
  return booking;
}
async function adminApprove(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const booking = await loadPendingRequest(supabase, bookingId);
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  if (expectedUpdatedAt && expectedUpdatedAt !== booking.updated_at) throw new ApiError(409, "BOOKING_CONFLICT", "取消申請已更新，請重新整理後再確認。");
  const now = new Date().toISOString();
  const updated = await supabase.from("bookings").update({
    status: "cancelled", cancelled_by: identity.lineUserId, cancelled_at: now,
    cancellation_reviewed_at: now, cancellation_reviewed_by: identity.lineUserId, cancellation_decision: "approved",
  }).eq("id", bookingId).eq("status", booking.status).eq("updated_at", booking.updated_at).select("*").maybeSingle();
  if (updated.error) throw new ApiError(500, "DATABASE_ERROR", "確認取消失敗。");
  if (!updated.data) throw new ApiError(409, "BOOKING_CONFLICT", "預約已更新，請重新整理後再確認。");
  await audit(supabase, identity, "admin", "BOOKING_CANCELLATION_APPROVED", bookingId, { previousStatus: booking.status });
  return { booking: cancellationClient(updated.data) };
}
async function adminReject(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const booking = await loadPendingRequest(supabase, bookingId);
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  if (expectedUpdatedAt && expectedUpdatedAt !== booking.updated_at) throw new ApiError(409, "BOOKING_CONFLICT", "取消申請已更新，請重新整理後再處理。");
  const sourceStatus = booking.cancellation_source_status;
  const now = new Date().toISOString();
  const updated = await supabase.from("bookings").update({
    cancellation_requested_at: null, cancellation_requested_by: null, cancellation_source_status: null,
    cancellation_reviewed_at: now, cancellation_reviewed_by: identity.lineUserId, cancellation_decision: "rejected",
  }).eq("id", bookingId).eq("status", booking.status).eq("updated_at", booking.updated_at).select("*").maybeSingle();
  if (updated.error) throw new ApiError(500, "DATABASE_ERROR", "保留預約失敗。");
  if (!updated.data) throw new ApiError(409, "BOOKING_CONFLICT", "預約已更新，請重新整理後再處理。");
  await audit(supabase, identity, "admin", "BOOKING_CANCELLATION_REJECTED", bookingId, { sourceStatus });
  return { booking: cancellationClient(updated.data) };
}
async function route(supabase: SupabaseClient, identity: Identity, clientType: ClientType, action: string, body: Json): Promise<Json> {
  if (clientType === "member") {
    const member = await requireMember(supabase, identity);
    if (action === "member.list") return await memberList(supabase, member);
    if (action === "member.request") return await memberRequest(supabase, identity, member, body);
    throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的會員取消操作。");
  }
  await requireAdmin(supabase, identity);
  if (action === "admin.list") return await adminList(supabase);
  if (action === "admin.approve") return await adminApprove(supabase, identity, body);
  if (action === "admin.reject") return await adminReject(supabase, identity, body);
  throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的管理端取消操作。");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return response(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return response(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    const body = raw ? JSON.parse(raw) as Json : {};
    const clientType = asText(body.clientType, 20) as ClientType;
    const action = asText(body.action, 80);
    if (!(["member", "admin"] as string[]).includes(clientType)) throw new ApiError(400, "INVALID_CLIENT_TYPE", "不支援的操作端。");
    if (!action) throw new ApiError(400, "ACTION_REQUIRED", "缺少操作名稱。");
    if ((clientType === "member" && !action.startsWith("member.")) || (clientType === "admin" && !action.startsWith("admin."))) throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");
    const identity = await verifyLineIdToken(asText(body.idToken, 5000), clientType);
    const supabase = dbClient();
    await consumeRateLimit(supabase, identity, action);
    const data = await route(supabase, identity, clientType, action, body);
    return response(origin, { ok: true, status: 200, data });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(origin, new ApiError(400, "INVALID_JSON", "請求格式不正確。"));
    return errorResponse(origin, error);
  }
});
