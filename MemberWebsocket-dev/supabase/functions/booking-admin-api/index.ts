import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };

const MAX_REQUEST_BYTES = 80_000;
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
function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map((v) => v.trim()).filter(Boolean));
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
function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = error instanceof ApiError ? error : mapDatabaseError(error);
  return response(origin, { ok: false, status: apiError.status, error: { code: apiError.code, message: apiError.message, details: apiError.details } }, apiError.status);
}
function mapDatabaseError(error: unknown): ApiError {
  const raw = error as { message?: string; details?: string; code?: string };
  const message = `${raw?.message || ""} ${raw?.details || ""}`;
  const rules: Array<[string, number, string, string]> = [
    ["BOOKING_SETTINGS_CONFLICT", 409, "BOOKING_SETTINGS_CONFLICT", "預約共用設定已被其他操作更新，請重新整理後再試。"],
    ["BOOKING_SETTINGS_MISSING", 503, "BOOKING_SETTINGS_MISSING", "預約共用設定尚未完成。"],
    ["INVALID_WORK_HOURS", 400, "INVALID_WORK_HOURS", "結束工作時間必須晚於開始工作時間至少 30 分鐘。"],
    ["INVALID_ADVANCE_DAYS", 400, "INVALID_ADVANCE_DAYS", "提前預約天數必須介於 0–365 天。"],
    ["INVALID_BOOKING_NOTICE", 400, "INVALID_BOOKING_NOTICE", "預約說明不可超過 2,000 字。"],
    ["BOOKING_SERVICE_TYPE_IN_USE", 409, "BOOKING_SERVICE_TYPE_IN_USE", "此項目類型仍有預約項目使用，請先修改或刪除相關預約項目。"],
    ["BOOKING_SERVICE_TYPE_NOT_FOUND", 404, "BOOKING_SERVICE_TYPE_NOT_FOUND", "找不到這個項目類型。"],
    ["DUPLICATE_SERVICE_TYPE", 409, "DUPLICATE_SERVICE_TYPE", "已有相同名稱的項目類型。"],
    ["INVALID_SERVICE_TYPE_NAME", 400, "INVALID_SERVICE_TYPE_NAME", "項目類型名稱必須是 1–80 字。"],
    ["BOOKING_SERVICE_TYPE_INVALID", 400, "BOOKING_SERVICE_TYPE_INVALID", "所選項目類型不存在，請重新選擇。"],
    ["BOOKING_SERVICE_NOT_FOUND", 404, "BOOKING_SERVICE_NOT_FOUND", "找不到這個預約項目。"],
    ["BOOKING_SERVICE_CONFLICT", 409, "BOOKING_SERVICE_CONFLICT", "預約項目已被其他操作更新，請重新整理後再試。"],
    ["BOOKING_SYSTEM_SERVICE_IMMUTABLE", 409, "BOOKING_SYSTEM_SERVICE_IMMUTABLE", "店內固定服務不可修改或刪除。"],
    ["INVALID_SERVICE_TITLE", 400, "INVALID_SERVICE_TITLE", "預約項目名稱必須是 1–100 字。"],
    ["INVALID_SERVICE_DURATION", 400, "INVALID_SERVICE_DURATION", "服務時間必須介於 1–720 分鐘。"],
    ["INVALID_SERVICE_PRICE", 400, "INVALID_SERVICE_PRICE", "價格必須是 0–10,000,000 元的整數。"],
    ["INVALID_BATCH_OPERATIONS", 400, "INVALID_BATCH_OPERATIONS", "批次操作必須包含 1–100 筆資料。"],
    ["INVALID_BATCH_OPERATION", 400, "INVALID_BATCH_OPERATION", "批次操作格式不正確。"],
    ["INVALID_SERVICE_ID", 400, "INVALID_SERVICE_ID", "預約項目識別碼格式不正確。"],
  ];
  for (const [needle, status, code, userMessage] of rules) if (message.includes(needle)) return new ApiError(status, code, userMessage);
  if (raw?.code === "23505") return new ApiError(409, "DUPLICATE_VALUE", "資料重複，請使用其他名稱。" );
  return new ApiError(500, "DATABASE_ERROR", "資料庫暫時無法完成預約管理操作。" );
}
function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。" );
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function asText(value: unknown, max = 1000): string { return String(value ?? "").trim().slice(0, max); }
function preserveText(value: unknown, max = 2000): string { return String(value ?? "").replace(/\r\n?/g, "\n").slice(0, max); }
function requireUuid(value: unknown, label: string): string {
  const text = asText(value, 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new ApiError(400, "INVALID_INPUT", `${label}格式不正確。`);
  return text;
}
function normalizeTime(value: unknown): string {
  const text = asText(value, 8);
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) throw new ApiError(400, "INVALID_WORK_HOURS", "時間格式不正確。" );
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || ![0, 30].includes(minute)) throw new ApiError(400, "INVALID_WORK_HOURS", "工作時間必須以 30 分鐘為單位。" );
  return `${match[1]}:${match[2]}`;
}
function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
async function verifyLineIdToken(idToken: string): Promise<Identity> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。" );
  const channelId = env("LINE_ADMIN_CHANNEL_ID") || "2010791619";
  let verifyResponse: Response;
  try {
    verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
  } catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。" ); }
  let payload: Json;
  try { payload = await verifyResponse.json(); } catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。" ); }
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud.trim() : "";
  const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const exp = Number(payload.exp || 0);
  if (!verifyResponse.ok || !sub || aud !== channelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。" );
  }
  return { lineUserId: sub, displayName: String(payload.name || "LINE 使用者").slice(0, 120) };
}
async function authorizeAdmin(supabase: SupabaseClient, identity: Identity): Promise<void> {
  const result = await supabase.from("admins").select("role,status").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw mapDatabaseError(result.error);
  if (!result.data || result.data.role !== "admin" || result.data.status !== "active") throw new ApiError(403, "ADMIN_REQUIRED", "管理端帳號尚未授權。" );
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function consumeRateLimit(supabase: SupabaseClient, identity: Identity, isWrite: boolean): Promise<void> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256(identity.lineUserId), p_is_write: isWrite, p_cost: 1, p_read_limit: READ_LIMIT, p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。" );
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。" );
}
function settingsClient(row: any): Json {
  return {
    workStartTime: String(row?.work_start_time || "09:00:00").slice(0, 5),
    workEndTime: String(row?.work_end_time || "17:00:00").slice(0, 5),
    minAdvanceDays: Number(row?.min_advance_days || 0),
    bookingNotice: String(row?.booking_notice || ""),
    updatedAt: row?.updated_at || null,
  };
}
function serviceClient(row: any): Json {
  return { serviceId: row.id, title: row.title, serviceType: row.service_type || "", durationMinutes: Number(row.duration_minutes || 30), priceAmount: Number(row.price_amount || 0), isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at };
}
function typeClient(row: any): Json { return { id: row.id, name: row.name, sortOrder: Number(row.sort_order || 0), createdAt: row.created_at, updatedAt: row.updated_at }; }
async function audit(supabase: SupabaseClient, identity: Identity, action: string, targetType: string, targetId: string, metadata: Json = {}): Promise<void> {
  const result = await supabase.from("booking_audit_events").insert({ actor_line_user_id: identity.lineUserId, actor_role: "admin", action, target_type: targetType, target_id: targetId, result: "success", metadata });
  if (result.error) console.error("booking admin audit failed", result.error.message);
}
async function bootstrap(supabase: SupabaseClient): Promise<Json> {
  const [settings, types, services] = await Promise.all([
    supabase.from("booking_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("booking_service_types").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("booking_services").select("*").is("deleted_at", null).neq("id", STORE_SERVICE_ID).order("created_at", { ascending: true }),
  ]);
  if (settings.error) throw mapDatabaseError(settings.error);
  if (!settings.data) throw new ApiError(503, "BOOKING_SETTINGS_MISSING", "預約共用設定尚未完成。" );
  if (types.error) throw mapDatabaseError(types.error);
  if (services.error) throw mapDatabaseError(services.error);
  return { settings: settingsClient(settings.data), serviceTypes: (types.data || []).map(typeClient), services: (services.data || []).map(serviceClient) };
}
async function settingsSave(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const workStartTime = normalizeTime(body.workStartTime);
  const workEndTime = normalizeTime(body.workEndTime);
  const minAdvanceDays = Number(body.minAdvanceDays);
  const bookingNotice = preserveText(body.bookingNotice, 2001);
  if (timeToMinutes(workEndTime) - timeToMinutes(workStartTime) < 30) throw new ApiError(400, "INVALID_WORK_HOURS", "結束工作時間必須晚於開始工作時間至少 30 分鐘。" );
  if (!Number.isInteger(minAdvanceDays) || minAdvanceDays < 0 || minAdvanceDays > 365) throw new ApiError(400, "INVALID_ADVANCE_DAYS", "提前預約天數必須介於 0–365 天。" );
  if (bookingNotice.length > 2000) throw new ApiError(400, "INVALID_BOOKING_NOTICE", "預約說明不可超過 2,000 字。" );
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  const result = await supabase.rpc("save_booking_shared_settings", {
    p_work_start_time: `${workStartTime}:00`,
    p_work_end_time: `${workEndTime}:00`,
    p_min_advance_days: minAdvanceDays,
    p_booking_notice: bookingNotice,
    p_expected_updated_at: expectedUpdatedAt || null,
    p_actor: identity.lineUserId,
  });
  if (result.error) throw mapDatabaseError(result.error);
  await audit(supabase, identity, "BOOKING_SETTINGS_UPDATED", "booking_settings", "1", { workStartTime, workEndTime, minAdvanceDays, bookingNoticeLength: bookingNotice.length });
  return { settings: settingsClient(result.data) };
}
async function typeCreate(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const name = asText(body.name, 80);
  if (!name) throw new ApiError(400, "INVALID_SERVICE_TYPE_NAME", "項目類型名稱必須是 1–80 字。" );
  const maxOrder = await supabase.from("booking_service_types").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  if (maxOrder.error) throw mapDatabaseError(maxOrder.error);
  const inserted = await supabase.from("booking_service_types").insert({ name, sort_order: Math.min(1000, Number(maxOrder.data?.sort_order || -1) + 1) }).select("*").single();
  if (inserted.error) throw mapDatabaseError(inserted.error);
  await audit(supabase, identity, "BOOKING_SERVICE_TYPE_CREATED", "booking_service_type", String(inserted.data.id), { name });
  return { serviceType: typeClient(inserted.data) };
}
async function typeUpdate(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const typeId = requireUuid(body.typeId, "項目類型");
  const name = asText(body.name, 80);
  if (!name) throw new ApiError(400, "INVALID_SERVICE_TYPE_NAME", "項目類型名稱必須是 1–80 字。" );
  const result = await supabase.rpc("rename_booking_service_type", { p_type_id: typeId, p_name: name, p_actor: identity.lineUserId });
  if (result.error) throw mapDatabaseError(result.error);
  await audit(supabase, identity, "BOOKING_SERVICE_TYPE_UPDATED", "booking_service_type", typeId, { name });
  return await bootstrap(supabase);
}
async function typeDelete(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const typeId = requireUuid(body.typeId, "項目類型");
  const result = await supabase.rpc("delete_booking_service_type", { p_type_id: typeId, p_actor: identity.lineUserId });
  if (result.error) throw mapDatabaseError(result.error);
  await audit(supabase, identity, "BOOKING_SERVICE_TYPE_DELETED", "booking_service_type", typeId);
  return await bootstrap(supabase);
}
async function serviceSave(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const serviceId = asText(body.serviceId, 60);
  if (serviceId) requireUuid(serviceId, "預約項目");
  if (serviceId === STORE_SERVICE_ID) throw new ApiError(409, "BOOKING_SYSTEM_SERVICE_IMMUTABLE", "店內固定服務不可修改或刪除。" );
  const title = asText(body.title, 100);
  const typeInput = asText(body.serviceType, 80);
  const durationMinutes = Number(body.durationMinutes);
  const priceAmount = Number(body.priceAmount);
  const isActive = body.isActive !== false;
  if (!title) throw new ApiError(400, "INVALID_SERVICE_TITLE", "預約項目名稱不可空白。" );
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) throw new ApiError(400, "INVALID_SERVICE_DURATION", "服務時間必須介於 1–720 分鐘。" );
  if (!Number.isSafeInteger(priceAmount) || priceAmount < 0 || priceAmount > 10_000_000) throw new ApiError(400, "INVALID_SERVICE_PRICE", "價格必須是 0–10,000,000 元的整數。" );
  const typeResult = await supabase.from("booking_service_types").select("name").ilike("name", typeInput).maybeSingle();
  if (typeResult.error) throw mapDatabaseError(typeResult.error);
  if (!typeResult.data) throw new ApiError(400, "BOOKING_SERVICE_TYPE_INVALID", "所選項目類型不存在，請重新選擇。" );
  const serviceType = typeResult.data.name;
  const patch = { title, description: `__TYPE__:${serviceType}`, service_type: serviceType, duration_minutes: durationMinutes, price_amount: priceAmount, is_active: isActive, counts_toward_membership: true };
  let saved: any;
  if (serviceId) {
    const current = await supabase.from("booking_services").select("updated_at").eq("id", serviceId).is("deleted_at", null).maybeSingle();
    if (current.error) throw mapDatabaseError(current.error);
    if (!current.data) throw new ApiError(404, "BOOKING_SERVICE_NOT_FOUND", "找不到這個預約項目。" );
    const expected = asText(body.expectedUpdatedAt, 80);
    if (expected && new Date(current.data.updated_at).getTime() !== new Date(expected).getTime()) throw new ApiError(409, "BOOKING_SERVICE_CONFLICT", "預約項目已被其他操作更新，請重新整理後再試。" );
    const updated = await supabase.from("booking_services").update(patch).eq("id", serviceId).is("deleted_at", null).select("*").single();
    if (updated.error) throw mapDatabaseError(updated.error);
    saved = updated.data;
    await audit(supabase, identity, "BOOKING_SERVICE_UPDATED", "booking_service", serviceId, { durationMinutes, priceAmount, serviceType });
  } else {
    const inserted = await supabase.from("booking_services").insert({ ...patch, created_by: identity.lineUserId }).select("*").single();
    if (inserted.error) throw mapDatabaseError(inserted.error);
    saved = inserted.data;
    await audit(supabase, identity, "BOOKING_SERVICE_CREATED", "booking_service", String(saved.id), { durationMinutes, priceAmount, serviceType });
  }
  return { service: serviceClient(saved) };
}
async function serviceDelete(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const serviceId = requireUuid(body.serviceId, "預約項目");
  const operation = { op: "delete", serviceId, expectedUpdatedAt: asText(body.expectedUpdatedAt, 80) };
  const result = await supabase.rpc("apply_booking_service_batch", { p_operations: [operation], p_actor: identity.lineUserId });
  if (result.error) throw mapDatabaseError(result.error);
  await audit(supabase, identity, "BOOKING_SERVICE_DELETED", "booking_service", serviceId);
  return { summary: result.data };
}
async function servicesBatch(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const operations = Array.isArray(body.operations) ? body.operations : [];
  if (!operations.length || operations.length > 100) throw new ApiError(400, "INVALID_BATCH_OPERATIONS", "批次操作必須包含 1–100 筆資料。" );
  const result = await supabase.rpc("apply_booking_service_batch", { p_operations: operations, p_actor: identity.lineUserId });
  if (result.error) throw mapDatabaseError(result.error);
  await audit(supabase, identity, "BOOKING_SERVICES_BATCH_APPLIED", "booking_service_batch", crypto.randomUUID(), { count: operations.length, summary: result.data as Json });
  return { summary: result.data };
}

async function route(supabase: SupabaseClient, identity: Identity, action: string, body: Json): Promise<Json> {
  if (action === "admin.booking.manage.bootstrap") return await bootstrap(supabase);
  if (action === "admin.booking.settings.save") return await settingsSave(supabase, identity, body);
  if (action === "admin.booking.type.create") return await typeCreate(supabase, identity, body);
  if (action === "admin.booking.type.update") return await typeUpdate(supabase, identity, body);
  if (action === "admin.booking.type.delete") return await typeDelete(supabase, identity, body);
  if (action === "admin.booking.service.save") return await serviceSave(supabase, identity, body);
  if (action === "admin.booking.service.delete") return await serviceDelete(supabase, identity, body);
  if (action === "admin.booking.services.batch") return await servicesBatch(supabase, identity, body);
  throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的預約管理操作。" );
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return response(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return response(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。" );
    let body: Json;
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, "INVALID_JSON", "請求格式不正確。" ); }
    const action = asText(body.action, 100);
    if (!action.startsWith("admin.booking.")) throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。" );
    const identity = await verifyLineIdToken(asText(body.idToken, 5000));
    const supabase = dbClient();
    await authorizeAdmin(supabase, identity);
    await consumeRateLimit(supabase, identity, action !== "admin.booking.manage.bootstrap");
    const data = await route(supabase, identity, action, body);
    return response(origin, { ok: true, status: 200, data });
  } catch (error) { return errorResponse(origin, error); }
});
