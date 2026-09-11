import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };

const MAX_REQUEST_BYTES = 30_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;
const STORE_SERVICE_ID = "00000000-0000-4000-8000-000000000010";

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
function requireUuid(value: unknown, label: string): string {
  const text = asText(value, 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ApiError(400, "INVALID_INPUT", `${label}格式不正確。`);
  }
  return text;
}
function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map((value) => value.trim()).filter(Boolean));
}
function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins().has(origin) ? origin : "",
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
function mapDatabaseError(error: unknown): ApiError {
  const raw = error as { message?: string; details?: string; code?: string };
  const message = `${raw?.message || ""} ${raw?.details || ""}`;
  const rules: Array<[string, number, string, string]> = [
    ["BOOKING_CONFLICT", 409, "BOOKING_CONFLICT", "預約已被其他操作更新，請重新整理後再試。"],
    ["BOOKING_NOT_FOUND", 404, "BOOKING_NOT_FOUND", "找不到這筆預約。"],
    ["BOOKING_NOT_EDITABLE", 409, "BOOKING_NOT_EDITABLE", "這筆預約目前無法修改服務項目。"],
    ["BOOKING_SERVICE_NOT_FOUND", 404, "BOOKING_SERVICE_NOT_FOUND", "找不到其中一個服務項目。"],
    ["BOOKING_SYSTEM_SERVICE_IMMUTABLE", 409, "BOOKING_SYSTEM_SERVICE_IMMUTABLE", "店內固定服務不可手動修改。"],
    ["INVALID_BOOKING_ITEMS", 400, "INVALID_BOOKING_ITEMS", "請至少選擇一個服務項目。"],
    ["INVALID_BOOKING_QUANTITY", 400, "INVALID_BOOKING_QUANTITY", "每個服務項目的數量只能是 1 或 2。"],
    ["DUPLICATE_BOOKING_SERVICE", 400, "DUPLICATE_BOOKING_SERVICE", "同一個服務項目只能選擇一次。"],
  ];
  for (const [needle, status, code, userMessage] of rules) if (message.includes(needle)) return new ApiError(status, code, userMessage);
  return new ApiError(500, "DATABASE_ERROR", "資料庫暫時無法完成預約操作。");
}
function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = error instanceof ApiError ? error : mapDatabaseError(error);
  return response(origin, { ok: false, status: apiError.status, error: { code: apiError.code, message: apiError.message, details: apiError.details } }, apiError.status);
}
function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function verifyLineIdToken(idToken: string): Promise<Identity> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");
  const channelId = env("LINE_ADMIN_CHANNEL_ID") || "2010791619";
  let verifyResponse: Response;
  try {
    verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }
  let payload: Json;
  try { payload = await verifyResponse.json(); }
  catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud.trim() : "";
  const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const exp = Number(payload.exp || 0);
  if (!verifyResponse.ok || !sub || aud !== channelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub, displayName: String(payload.name || "LINE 使用者").slice(0, 120) };
}
async function authorizeAdmin(supabase: SupabaseClient, identity: Identity): Promise<void> {
  const result = await supabase.from("admins").select("role,status").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw mapDatabaseError(result.error);
  if (!result.data || result.data.role !== "admin" || result.data.status !== "active") {
    throw new ApiError(403, "ADMIN_REQUIRED", "管理端帳號尚未授權。");
  }
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function consumeRateLimit(supabase: SupabaseClient, identity: Identity): Promise<void> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256(identity.lineUserId), p_is_write: true, p_cost: 1,
    p_read_limit: READ_LIMIT, p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。");
}
function normalizeItems(value: unknown): Array<{ serviceId: string; quantity: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new ApiError(400, "INVALID_BOOKING_ITEMS", "請至少選擇一個服務項目。");
  const seen = new Set<string>();
  return value.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Json : {};
    const serviceId = requireUuid(item.serviceId, "服務項目");
    const quantity = Number(item.quantity ?? 1);
    if (serviceId === STORE_SERVICE_ID) throw new ApiError(409, "BOOKING_SYSTEM_SERVICE_IMMUTABLE", "店內固定服務不可手動修改。");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2) throw new ApiError(400, "INVALID_BOOKING_QUANTITY", "每個服務項目的數量只能是 1 或 2。");
    if (seen.has(serviceId)) throw new ApiError(400, "DUPLICATE_BOOKING_SERVICE", "同一個服務項目只能選擇一次。");
    seen.add(serviceId);
    return { serviceId, quantity };
  });
}
function itemClient(row: any): Json {
  const quantity = Number(row.quantity || 1);
  const unitDurationMinutes = Number(row.unit_duration_minutes || 0);
  const unitPriceAmount = Number(row.unit_price_amount || 0);
  return {
    serviceId: row.service_id,
    serviceTitle: row.service_title || "服務項目",
    serviceType: row.service_type || "",
    countsTowardMembership: Boolean(row.counts_toward_membership),
    unitDurationMinutes,
    unitPriceAmount,
    quantity,
    subtotalMinutes: unitDurationMinutes * quantity,
    subtotalAmount: unitPriceAmount * quantity,
  };
}
async function hydrateBooking(supabase: SupabaseClient, bookingId: string): Promise<Json> {
  const bookingResult = await supabase.from("bookings").select("*, members(display_name, member_code)").eq("id", bookingId).maybeSingle();
  if (bookingResult.error) throw mapDatabaseError(bookingResult.error);
  if (!bookingResult.data) throw new ApiError(404, "BOOKING_NOT_FOUND", "找不到這筆預約。");
  const itemResult = await supabase.from("booking_items")
    .select("booking_id,service_id,service_title,service_type,counts_toward_membership,unit_duration_minutes,unit_price_amount,quantity,created_at")
    .eq("booking_id", bookingId).order("created_at", { ascending: true });
  if (itemResult.error) throw mapDatabaseError(itemResult.error);
  const items = (itemResult.data || []).map(itemClient);
  const member = bookingResult.data.members || null;
  return {
    bookingId: bookingResult.data.id,
    requestId: bookingResult.data.request_id,
    serviceId: bookingResult.data.service_id,
    serviceTitle: items.filter((item: any) => item.serviceId !== STORE_SERVICE_ID).map((item: any) => item.serviceTitle).join(" + ") || "服務項目",
    items,
    totalDurationMinutes: Number(bookingResult.data.total_duration_minutes || 0),
    actualServiceMinutes: items.filter((item: any) => item.countsTowardMembership).reduce((sum: number, item: any) => sum + Number(item.subtotalMinutes || 0), 0),
    totalAmount: items.reduce((sum: number, item: any) => sum + Number(item.subtotalAmount || 0), 0),
    memberId: bookingResult.data.member_id,
    memberDisplayName: member?.display_name || "",
    memberCode: member?.member_code || "",
    bookingDate: bookingResult.data.booking_date,
    startTime: String(bookingResult.data.start_time || "").slice(0, 5),
    endTime: String(bookingResult.data.end_time || "").slice(0, 5),
    status: bookingResult.data.status,
    memberNote: bookingResult.data.member_note || "",
    adminNote: bookingResult.data.admin_note || "",
    completedAt: bookingResult.data.completed_at || null,
    confirmedAt: bookingResult.data.confirmed_at || null,
    rejectedAt: bookingResult.data.rejected_at || null,
    cancelledAt: bookingResult.data.cancelled_at || null,
    createdAt: bookingResult.data.created_at,
    updatedAt: bookingResult.data.updated_at,
  };
}
async function audit(supabase: SupabaseClient, identity: Identity, action: string, bookingId: string, metadata: Json = {}): Promise<void> {
  const result = await supabase.from("booking_audit_events").insert({
    actor_line_user_id: identity.lineUserId, actor_role: "admin", action,
    target_type: "booking", target_id: bookingId, result: "success", metadata,
  });
  if (result.error) console.error("booking admin audit failed", result.error.message);
}
async function updateItems(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new ApiError(400, "INVALID_INPUT", "缺少預約版本，請重新整理。");
  const items = normalizeItems(body.items);
  const result = await supabase.rpc("admin_update_booking_items_request", {
    p_booking_id: bookingId,
    p_expected_updated_at: expectedUpdatedAt,
    p_actor: identity.lineUserId,
    p_items: items,
  });
  if (result.error) throw mapDatabaseError(result.error);
  return { booking: await hydrateBooking(supabase, bookingId) };
}
async function completeBooking(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  const adminNote = asText(body.adminNote, 500);
  const existing = await supabase.from("bookings").select("id,status,updated_at").eq("id", bookingId).maybeSingle();
  if (existing.error) throw mapDatabaseError(existing.error);
  if (!existing.data) throw new ApiError(404, "BOOKING_NOT_FOUND", "找不到這筆預約。");
  if (!expectedUpdatedAt || expectedUpdatedAt !== existing.data.updated_at) throw new ApiError(409, "BOOKING_CONFLICT", "預約已更新，請重新整理後再確認。");
  if (existing.data.status !== "confirmed") throw new ApiError(409, "INVALID_BOOKING_TRANSITION", "只有已確認的預約可以標記服務完成。");
  const now = new Date().toISOString();
  const updated = await supabase.from("bookings").update({
    status: "completed", admin_note: adminNote, completed_by: identity.lineUserId, completed_at: now,
  }).eq("id", bookingId).eq("status", "confirmed").eq("updated_at", expectedUpdatedAt).select("id").maybeSingle();
  if (updated.error) throw mapDatabaseError(updated.error);
  if (!updated.data) throw new ApiError(409, "BOOKING_CONFLICT", "預約已更新，請重新整理後再確認。");
  await audit(supabase, identity, "BOOKING_COMPLETED", bookingId, { previousStatus: "confirmed", endTimeRestrictionBypassed: true });
  return { booking: await hydrateBooking(supabase, bookingId) };
}
async function route(supabase: SupabaseClient, identity: Identity, action: string, body: Json): Promise<Json> {
  if (action === "admin.booking.items.update") return await updateItems(supabase, identity, body);
  if (action === "admin.booking.status.complete") return await completeBooking(supabase, identity, body);
  throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的管理端預約操作。");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return response(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return response(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    let body: Json;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { throw new ApiError(400, "INVALID_JSON", "請求格式不正確。"); }
    const action = asText(body.action, 100);
    if (!action.startsWith("admin.booking.")) throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");
    const identity = await verifyLineIdToken(asText(body.idToken, 5000));
    const supabase = dbClient();
    await authorizeAdmin(supabase, identity);
    await consumeRateLimit(supabase, identity);
    const data = await route(supabase, identity, action, body);
    return response(origin, { ok: true, status: 200, data });
  } catch (error) {
    return errorResponse(origin, error);
  }
});
