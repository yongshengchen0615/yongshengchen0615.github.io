import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };

const MAX_REQUEST_BYTES = 20_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;

class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

function env(name: string): string { return (Deno.env.get(name) || "").trim(); }
function asText(value: unknown, max = 1000): string { return String(value ?? "").trim().slice(0, max); }
function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map(v => v.trim()).filter(Boolean));
}
function corsHeaders(origin: string | null): HeadersInit {
  const resolved = origin && allowedOrigins().has(origin) ? origin : "";
  return { "Access-Control-Allow-Origin": resolved, "Access-Control-Allow-Headers": "content-type, apikey", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Max-Age": "86400", "Cache-Control": "no-store", "Vary": "Origin" };
}
function response(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" } });
}
function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL"); const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function verifyLineIdToken(idToken: string): Promise<Identity> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");
  const channelId = env("LINE_MEMBER_CHANNEL_ID") || "2010787602";
  let verifyResponse: Response;
  try {
    verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ id_token: idToken, client_id: channelId }) });
  } catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }
  let payload: Json;
  try { payload = await verifyResponse.json(); } catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }
  const sub = asText(payload.sub, 120); const aud = asText(payload.aud, 60); const iss = asText(payload.iss, 100); const exp = Number(payload.exp || 0);
  if (!verifyResponse.ok || !sub || aud !== channelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  return { lineUserId: sub, displayName: asText(payload.name || "LINE 使用者", 120) };
}
async function consumeRateLimit(supabase: SupabaseClient, identity: Identity, write: boolean): Promise<void> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", { p_principal_hash: await sha256(identity.lineUserId), p_is_write: write, p_cost: 1, p_read_limit: READ_LIMIT, p_write_limit: WRITE_LIMIT });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。");
}
async function ensureMember(supabase: SupabaseClient, identity: Identity): Promise<any> {
  let result = await supabase.from("members").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "會員資料暫時無法讀取。");
  let member = result.data;
  if (!member) {
    const inserted = await supabase.from("members").insert({ line_user_id: identity.lineUserId, display_name: identity.displayName, member_code: "M" + crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase(), last_login_at: new Date().toISOString() }).select("*").single();
    if (inserted.error) {
      result = await supabase.from("members").select("*").eq("line_user_id", identity.lineUserId).single();
      if (result.error) throw new ApiError(500, "DATABASE_ERROR", "會員資料暫時無法建立。");
      member = result.data;
    } else member = inserted.data;
  } else {
    const patch: Json = { last_login_at: new Date().toISOString() };
    if (identity.displayName && identity.displayName !== member.display_name) patch.display_name = identity.displayName;
    const updated = await supabase.from("members").update(patch).eq("id", member.id).select("*").single();
    if (!updated.error) member = updated.data;
  }
  return member;
}
async function tierSettings(supabase: SupabaseClient): Promise<any[]> {
  const result = await supabase.from("membership_tier_settings").select("*").order("required_service_minutes", { ascending: true });
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "會員階級資料暫時無法讀取。");
  return result.data || [];
}
async function serviceMinutesTotal(supabase: SupabaseClient, memberId: string): Promise<number> {
  const result = await supabase.from("service_time_entries").select("minutes").eq("member_id", memberId);
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "會員服務時間暫時無法讀取。");
  return (result.data || []).reduce((sum: number, row: any) => sum + Number(row.minutes || 0), 0);
}
async function profileFor(supabase: SupabaseClient, member: any): Promise<Json> {
  const [settings, total] = await Promise.all([tierSettings(supabase), serviceMinutesTotal(supabase, member.id)]);
  let current = settings[0] || { tier_key: "general", tier_label: "一般會員", required_service_minutes: 0, style_key: "forest" };
  for (const row of settings) if (Number(row.required_service_minutes || 0) <= total) current = row;
  const index = Math.max(0, settings.findIndex(row => row.tier_key === current.tier_key));
  const next = settings[index + 1] || null;
  const surname = asText(member.surname, 40);
  const salutation = asText(member.salutation, 10).toLowerCase();
  return {
    lineUserId: member.line_user_id,
    displayName: member.display_name || "LINE 使用者",
    memberCode: member.member_code,
    status: member.status,
    joinedAt: member.joined_at || member.created_at,
    birthday: member.birthday || "",
    phone: member.phone || "",
    surname,
    salutation,
    salutationLabel: salutation === "mr" ? "先生" : salutation === "ms" ? "小姐" : "",
    profileComplete: member.membership_status === "active" && Boolean(member.birthday && member.phone && surname && ["mr", "ms"].includes(salutation)),
    membershipRequired: member.membership_status !== "active",
    serviceMinutesTotal: total,
    tierKey: current.tier_key,
    tier: current.tier_label,
    tierStyleKey: current.style_key || "forest",
    tierProgress: {
      serviceMinutesTotal: total,
      currentRequiredServiceMinutes: Number(current.required_service_minutes || 0),
      nextTierKey: next?.tier_key || "",
      nextTierLabel: next?.tier_label || "",
      nextRequiredServiceMinutes: next ? Number(next.required_service_minutes || 0) : null,
      remainingServiceMinutes: next ? Math.max(0, Number(next.required_service_minutes || 0) - total) : 0,
      isHighestTier: !next,
    },
  };
}
function normalizePhone(value: unknown): string { return asText(value, 30).replace(/[()\s-]/g, ""); }

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return response(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return response(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);
  try {
    const raw = await request.text();
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容大小不合法。");
    let body: Json; try { body = JSON.parse(raw); } catch { throw new ApiError(400, "INVALID_JSON", "請求格式不正確。"); }
    const action = asText(body.action, 80);
    if (!["user.member.bootstrap", "user.member.profile.save"].includes(action) || asText(body.clientType, 20) !== "member") throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");
    const identity = await verifyLineIdToken(asText(body.idToken, 10_000));
    const supabase = dbClient();
    await consumeRateLimit(supabase, identity, action === "user.member.profile.save");
    const member = await ensureMember(supabase, identity);
    if (action === "user.member.bootstrap") return response(origin, { ok: true, status: 200, data: { profile: await profileFor(supabase, member) } });

    const birthday = asText(body.birthday, 20);
    const phone = normalizePhone(body.phone);
    const surname = asText(body.surname, 40);
    const salutation = asText(body.salutation, 10).toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Number.isNaN(Date.parse(`${birthday}T00:00:00Z`))) throw new ApiError(400, "INVALID_BIRTHDAY", "請填寫正確的生日。");
    if (!/^\+?\d{8,15}$/.test(phone)) throw new ApiError(400, "INVALID_PHONE", "請填寫正確的電話。");
    if (!surname || surname.length > 40) throw new ApiError(400, "INVALID_SURNAME", "請填寫姓氏。");
    if (!["mr", "ms"].includes(salutation)) throw new ApiError(400, "INVALID_SALUTATION", "請選擇先生或小姐。");

    const updated = await supabase.from("members").update({ birthday, phone, surname, salutation, membership_status: "active", joined_at: member.joined_at || new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", member.id).select("*").single();
    if (updated.error) throw new ApiError(500, "DATABASE_ERROR", "會員資料暫時無法儲存。");
    await supabase.from("audit_logs").insert({ audit_id: "AUD-" + crypto.randomUUID().replaceAll("-", ""), actor_line_user_id: identity.lineUserId, actor_role: "member", action, target_type: "member", target_id: identity.lineUserId, result: "success", detail: { profileFields: ["birthday", "phone", "surname", "salutation"] } });
    return response(origin, { ok: true, status: 200, data: { profile: await profileFor(supabase, updated.data) } });
  } catch (error) {
    const e = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "會員資料服務暫時無法完成操作。");
    return response(origin, { ok: false, status: e.status, error: { code: e.code, message: e.message, details: e.details } }, e.status);
  }
});
