import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };

const MAX_REQUEST_BYTES = 20_000;
const WRITE_LIMIT = 30;

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
function asText(value: unknown, max = 1000): string { return String(value ?? "").trim().slice(0, max); }
function requireUuid(value: unknown, label: string): string {
  const text = asText(value, 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ApiError(400, "INVALID_INPUT", `${label}格式不正確。`);
  }
  return text;
}
function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function readBody(request: Request): Promise<Json> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("invalid object");
    return value as Json;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "請求格式不正確。");
  }
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
  const payload = await verifyResponse.json().catch(() => ({})) as Json;
  const sub = asText(payload.sub, 100);
  const aud = asText(payload.aud, 100);
  const iss = asText(payload.iss, 100);
  const exp = Number(payload.exp || 0);
  if (!verifyResponse.ok || !sub || aud !== channelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub, displayName: asText(payload.name, 120) || "LINE 使用者" };
}
async function authorizeAdmin(supabase: SupabaseClient, identity: Identity): Promise<void> {
  const result = await supabase.from("admins").select("role,status").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認管理員權限。");
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
    p_principal_hash: await sha256(identity.lineUserId),
    p_is_write: true,
    p_cost: 1,
    p_read_limit: 90,
    p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "操作過於密集，請稍後再試。");
}
async function audit(supabase: SupabaseClient, identity: Identity, technicianId: string, technicianName: string): Promise<void> {
  const result = await supabase.from("booking_audit_events").insert({
    actor_line_user_id: identity.lineUserId,
    actor_role: "admin",
    action: "BOOKING_TECHNICIAN_DELETED",
    target_type: "booking_technician",
    target_id: technicianId,
    result: "success",
    metadata: { name: technicianName },
  });
  if (result.error) console.error("booking technician delete audit failed", result.error.message);
}
async function referenceCount(supabase: SupabaseClient, table: string, technicianId: string): Promise<number> {
  const result = await supabase.from(table).select("technician_id", { count: "exact", head: true }).eq("technician_id", technicianId);
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認技師預約關聯。");
  return Number(result.count || 0);
}
async function deleteTechnician(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const technicianId = requireUuid(body.technicianId, "技師");
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    throw new ApiError(400, "INVALID_INPUT", "缺少技師資料版本，請重新整理後再試。");
  }

  const technician = await supabase.from("booking_technicians").select("id,name,updated_at").eq("id", technicianId).maybeSingle();
  if (technician.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取技師資料。");
  if (!technician.data) throw new ApiError(404, "BOOKING_TECHNICIAN_NOT_FOUND", "找不到這位技師。");
  if (String(technician.data.updated_at || "") !== expectedUpdatedAt) {
    throw new ApiError(409, "CONFLICT", "技師資料已被其他操作更新，請重新整理後再試。");
  }

  const settings = await supabase.from("booking_settings").select("primary_technician_id").eq("id", 1).maybeSingle();
  if (settings.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認主要技師設定。");
  if (String(settings.data?.primary_technician_id || "") === technicianId) {
    throw new ApiError(409, "BOOKING_TECHNICIAN_PRIMARY", "主要技師不可刪除，請先指定其他主要技師。");
  }

  const [bookings, participants, reservations] = await Promise.all([
    referenceCount(supabase, "bookings", technicianId),
    referenceCount(supabase, "booking_participants", technicianId),
    referenceCount(supabase, "booking_participant_reservations", technicianId),
  ]);
  if (bookings + participants + reservations > 0) {
    throw new ApiError(409, "BOOKING_TECHNICIAN_IN_USE", "此技師已有預約紀錄，為保留歷史資料不可永久刪除；請改為停用。");
  }

  const deleted = await supabase.from("booking_technicians")
    .delete()
    .eq("id", technicianId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (deleted.error) throw new ApiError(500, "DATABASE_ERROR", "技師刪除失敗。");
  if (!deleted.data) throw new ApiError(409, "CONFLICT", "技師資料已被其他操作更新，請重新整理後再試。");

  await audit(supabase, identity, technicianId, String(technician.data.name || ""));
  return { deletedTechnicianId: technicianId };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return response(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return response(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);

  try {
    const body = await readBody(request);
    const action = asText(body.action, 100);
    if (action !== "admin.booking.resources.technician.delete" || asText(body.clientType, 20) !== "admin") {
      throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");
    }
    const identity = await verifyLineIdToken(asText(body.idToken, 5000));
    const supabase = dbClient();
    await authorizeAdmin(supabase, identity);
    await consumeRateLimit(supabase, identity);
    const data = await deleteTechnician(supabase, identity, body);
    return response(origin, { ok: true, data });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "技師刪除服務暫時無法使用。");
    return response(origin, { ok: false, error: { code: apiError.code, message: apiError.message, details: apiError.details } }, apiError.status);
  }
});
