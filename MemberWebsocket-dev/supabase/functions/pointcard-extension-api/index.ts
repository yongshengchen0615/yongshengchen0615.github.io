import { createClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const MAX_REQUEST_BYTES = 20_000;

function env(name: string): string { return (Deno.env.get(name) || "").trim(); }
function asText(value: unknown, max = 1000): string { return String(value ?? "").trim().slice(0, max); }
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
function json(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" } });
}
function db() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "資料服務尚未完成設定。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function channelId(kind: "points" | "admin"): string {
  const value = env(kind === "admin" ? "LINE_ADMIN_CHANNEL_ID" : "LINE_POINTS_CHANNEL_ID") || (kind === "admin" ? "2010791619" : "2010787602");
  if (!/^\d{5,30}$/.test(value)) throw new ApiError(503, "AUTH_CONFIG_MISSING", "LINE 驗證設定尚未完成。");
  return value;
}
async function verifyLineIdToken(idToken: string, kind: "points" | "admin") {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "需要 LINE 登入。");
  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId(kind) }),
    });
  } catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }
  let payload: Json = {};
  try { payload = await response.json(); } catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }
  const sub = asText(payload.sub, 160);
  const exp = Number(payload.exp || 0);
  if (!response.ok || !sub || asText(payload.aud, 40) !== channelId(kind) || asText(payload.iss, 80) !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub, displayName: asText(payload.name, 120) || "LINE 使用者" };
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function consumeRateLimit(supabase: ReturnType<typeof db>, principal: string, isWrite: boolean, cost: number) {
  const result = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256(principal), p_is_write: isWrite, p_cost: cost, p_read_limit: 90, p_write_limit: 30,
  });
  if (result.error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!result.data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。");
}
async function requireAdmin(supabase: ReturnType<typeof db>, lineUserId: string) {
  const result = await supabase.from("admins").select("role,status").eq("line_user_id", lineUserId).maybeSingle();
  if (result.error) throw new ApiError(503, "DATABASE_ERROR", "資料庫暫時無法完成操作。");
  if (!result.data || result.data.role !== "admin" || result.data.status !== "active") throw new ApiError(403, "ADMIN_REQUIRED", "管理端帳號尚未授權。");
}
function mapRpcError(error: unknown): ApiError {
  const message = String((error as { message?: string })?.message || "");
  if (message.includes("MEMBERSHIP_REQUIRED")) return new ApiError(403, "MEMBERSHIP_REQUIRED", "請先完成會員加入後再使用此功能。");
  if (message.includes("TICKET_NOT_FOUND")) return new ApiError(404, "TICKET_NOT_FOUND", "找不到其中一張票券。");
  if (message.includes("TICKET_NOT_AVAILABLE")) return new ApiError(409, "TICKET_NOT_AVAILABLE", "其中一張票券目前已無法使用，請更新後再試。");
  if (message.includes("TICKET_BATCH_LIMIT_EXCEEDED")) return new ApiError(409, "TICKET_BATCH_LIMIT_EXCEEDED", "選取票券數超過該集點卡設定的單次使用上限。");
  if (message.includes("INSUFFICIENT_POINTS")) return new ApiError(409, "INSUFFICIENT_POINTS", "選取票券所需點數超過目前可用點數。");
  if (message.includes("POINT_CARD_EXPIRED")) return new ApiError(409, "POINT_CARD_EXPIRED", "其中一張集點卡已超過使用期限。");
  if (message.includes("POINT_CARD_NOT_AVAILABLE")) return new ApiError(409, "POINT_CARD_NOT_AVAILABLE", "其中一張集點卡目前無法使用。");
  if (message.includes("INVALID_TICKET_BATCH")) return new ApiError(400, "INVALID_TICKET_BATCH", "請選擇 1–50 張不同的票券。");
  if (message.includes("INVALID_REQUEST_ID")) return new ApiError(400, "INVALID_REQUEST_ID", "操作識別碼格式不正確。");
  return new ApiError(500, "DATABASE_ERROR", "資料庫暫時無法完成操作。");
}

async function redeemTickets(origin: string | null, body: Json) {
  const identity = await verifyLineIdToken(asText(body.idToken, 10000), "points");
  const ticketIds = Array.isArray(body.ticketIds) ? [...new Set(body.ticketIds.map((v) => asText(v, 120)).filter(Boolean))] : [];
  if (ticketIds.length < 1 || ticketIds.length > 50 || ticketIds.length !== (Array.isArray(body.ticketIds) ? body.ticketIds.length : 0)) {
    throw new ApiError(400, "INVALID_TICKET_BATCH", "請選擇 1–50 張不同的票券。");
  }
  const requestId = asText(body.requestId, 120);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) throw new ApiError(400, "INVALID_REQUEST_ID", "操作識別碼格式不正確。");
  const supabase = db();
  await consumeRateLimit(supabase, identity.lineUserId, true, ticketIds.length);
  const rpc = await supabase.rpc("redeem_point_tickets", { p_line_user_id: identity.lineUserId, p_ticket_ids: ticketIds, p_request_id: requestId });
  if (rpc.error) throw mapRpcError(rpc.error);

  const member = await supabase.from("members").select("id").eq("line_user_id", identity.lineUserId).single();
  if (member.error) throw new ApiError(500, "DATABASE_ERROR", "資料庫暫時無法完成操作。");
  const used = await supabase.from("point_tickets")
    .select("ticket_id,ticket_type,ticket_title,threshold_stamps,points_spent,result,used_at,point_cards(card_id,title)")
    .eq("member_id", member.data.id).in("ticket_id", ticketIds);
  if (used.error) throw new ApiError(500, "DATABASE_ERROR", "票券已處理，但無法載入使用結果；請重新整理確認。");
  return json(origin, { ok: true, status: 200, data: {
    requestId, alreadyApplied: Boolean((rpc.data as Json)?.alreadyApplied),
    ticketCount: Number((rpc.data as Json)?.ticketCount || ticketIds.length),
    pointsByCard: (rpc.data as Json)?.pointsByCard || {},
    tickets: (used.data || []).map((row: any) => ({
      ticketId: row.ticket_id, ticketType: row.ticket_type, ticketTitle: row.ticket_title,
      pointsSpent: Number(row.points_spent || row.threshold_stamps || 0), result: row.result || null,
      usedAt: row.used_at || "", cardId: row.point_cards?.card_id || "", cardTitle: row.point_cards?.title || "集點卡",
    })),
  } });
}

async function listLimits(origin: string | null, body: Json) {
  const identity = await verifyLineIdToken(asText(body.idToken, 10000), "admin");
  const supabase = db();
  await consumeRateLimit(supabase, identity.lineUserId, false, 1);
  await requireAdmin(supabase, identity.lineUserId);
  const result = await supabase.from("point_cards").select("card_id,max_tickets_per_redemption,updated_at");
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取集點卡使用上限。");
  return json(origin, { ok: true, status: 200, data: { limits: (result.data || []).map((row: any) => ({
    cardId: row.card_id, maxTicketsPerRedemption: Number(row.max_tickets_per_redemption || 1), updatedAt: row.updated_at,
  })) } });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  try {
    if (origin && !allowedOrigins().has(origin)) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "此網站來源未被允許使用會員 API。");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "不支援的 HTTP method。");
    const raw = await request.text();
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "Request body 大小不合法。");
    let body: Json;
    try { body = JSON.parse(raw); } catch { throw new ApiError(400, "INVALID_JSON", "Request body 必須是 JSON。"); }
    if (!body || Array.isArray(body) || typeof body !== "object") throw new ApiError(400, "INVALID_REQUEST", "Request body 格式不合法。");
    const operation = asText(body.operation, 60);
    if (operation === "member.redeem") return await redeemTickets(origin, body);
    if (operation === "admin.limits.list") return await listLimits(origin, body);
    throw new ApiError(404, "OPERATION_NOT_FOUND", "不支援的操作。");
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "服務暫時無法完成操作。");
    return json(origin, { ok: false, status: apiError.status, error: { code: apiError.code, message: apiError.message } }, apiError.status);
  }
});
