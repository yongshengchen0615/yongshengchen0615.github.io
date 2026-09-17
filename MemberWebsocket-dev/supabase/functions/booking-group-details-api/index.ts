import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const STORE_SERVICE_ID = "00000000-0000-4000-8000-000000000010";
const MAX_REQUEST_BYTES = 30000;

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const env = (name: string) => (Deno.env.get(name) || "").trim();
const allowedOrigins = () => new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map((v) => v.trim()).filter(Boolean));
const cors = (origin: string | null): HeadersInit => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins().has(origin) ? origin : "",
  "Access-Control-Allow-Headers": "content-type, apikey",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
});
const reply = (origin: string | null, payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
});
const fail = (origin: string | null, error: unknown) => {
  const e = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "目前無法取得多人預約明細。");
  return reply(origin, { ok: false, error: { code: e.code, message: e.message } }, e.status);
};
const asText = (value: unknown, max = 1000) => String(value ?? "").trim().slice(0, max);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function db() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "預約資料服務設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function verifyAdmin(idToken: string) {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入管理端。");
  const channelId = env("LINE_ADMIN_CHANNEL_ID") || "2010791619";
  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證暫時無法使用。");
  }
  const payload = await response.json().catch(() => ({}));
  const exp = Number(payload.exp || 0);
  if (!response.ok || !payload.sub || payload.aud !== channelId || payload.iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 管理端登入已失效，請重新登入。");
  }
  return String(payload.sub);
}

async function authorizeAdmin(supabase: ReturnType<typeof db>, lineUserId: string) {
  const result = await supabase.from("admins").select("id,role,status").eq("line_user_id", lineUserId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認管理員權限。");
  if (!result.data || result.data.role !== "admin" || result.data.status !== "active") {
    throw new ApiError(403, "ADMIN_PENDING", "管理端帳號尚未授權。");
  }
}

function itemClient(row: any) {
  const quantity = Math.max(1, Number(row.quantity || 1));
  const unitDurationMinutes = Math.max(0, Number(row.unit_duration_minutes || 0));
  const unitPriceAmount = Math.max(0, Number(row.unit_price_amount || 0));
  return {
    serviceId: String(row.service_id || ""),
    serviceTitle: String(row.service_title || "預約項目"),
    unitDurationMinutes,
    unitPriceAmount,
    quantity,
    subtotalMinutes: unitDurationMinutes * quantity,
    subtotalAmount: unitPriceAmount * quantity,
  };
}

async function groupDetails(supabase: ReturnType<typeof db>, body: Record<string, any>) {
  const rawIds = Array.isArray(body.bookingIds) ? body.bookingIds : [];
  const bookingIds = [...new Set(rawIds.map((id) => asText(id, 60)).filter(Boolean))];
  if (!bookingIds.length) return { bookingGroups: {} };
  if (bookingIds.length > 250 || bookingIds.some((id) => !isUuid(id))) {
    throw new ApiError(400, "INVALID_BOOKING_IDS", "預約識別資料格式不正確。");
  }

  const [settingsResult, storeResult, participantsResult] = await Promise.all([
    supabase.from("booking_settings").select("primary_technician_id").eq("id", 1).single(),
    supabase.from("booking_services").select("duration_minutes").eq("id", STORE_SERVICE_ID).maybeSingle(),
    supabase.from("booking_participants")
      .select("id,booking_id,position,technician_id,booking_technicians(name)")
      .in("booking_id", bookingIds)
      .order("position", { ascending: true }),
  ]);
  if (settingsResult.error || participantsResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取多人預約資料。");
  if (storeResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取店內服務時間。");

  const primaryTechnicianId = String(settingsResult.data?.primary_technician_id || "");
  const storeServiceMinutes = Math.max(0, Number(storeResult.data?.duration_minutes || 0));
  const participants = participantsResult.data || [];
  const participantIds = participants.map((row: any) => String(row.id));
  let itemRows: any[] = [];
  if (participantIds.length) {
    const itemResult = await supabase.from("booking_participant_items")
      .select("participant_id,service_id,service_title,unit_duration_minutes,unit_price_amount,quantity")
      .in("participant_id", participantIds)
      .order("created_at", { ascending: true });
    if (itemResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取多人預約項目。");
    itemRows = itemResult.data || [];
  }

  const itemsByParticipant = new Map<string, any[]>();
  for (const row of itemRows) {
    const key = String(row.participant_id || "");
    const list = itemsByParticipant.get(key) || [];
    list.push(itemClient(row));
    itemsByParticipant.set(key, list);
  }

  const groups = new Map<string, any[]>();
  for (const row of participants as any[]) {
    const items = itemsByParticipant.get(String(row.id)) || [];
    const serviceMinutes = items.reduce((sum, item) => sum + Number(item.subtotalMinutes || 0), 0);
    const amount = items.reduce((sum, item) => sum + Number(item.subtotalAmount || 0), 0);
    const technicianId = String(row.technician_id || "");
    const list = groups.get(String(row.booking_id)) || [];
    list.push({
      position: Number(row.position || list.length + 1),
      technicianId,
      technicianName: technicianId ? String((row.booking_technicians as any)?.name || "未命名技師") : "現場安排",
      isPrimaryTechnician: Boolean(technicianId && technicianId === primaryTechnicianId),
      items,
      serviceMinutes,
      storeServiceMinutes,
      totalMinutes: items.length ? serviceMinutes + storeServiceMinutes : 0,
      amount,
    });
    groups.set(String(row.booking_id), list);
  }

  const bookingGroups: Record<string, any> = {};
  for (const bookingId of bookingIds) {
    const rows = (groups.get(bookingId) || []).sort((a, b) => a.position - b.position);
    bookingGroups[bookingId] = {
      partySize: rows.length,
      participants: rows,
      totalDurationMinutes: rows.reduce((max, row) => Math.max(max, Number(row.totalMinutes || 0)), 0),
      totalAmount: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    };
  }
  return { bookingGroups, primaryTechnicianId, storeServiceMinutes };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return reply(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return reply(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);

  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    const body = raw ? JSON.parse(raw) : {};
    if (asText(body.action, 100) !== "admin.booking.group.details" || asText(body.clientType, 20) !== "admin") {
      throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");
    }
    const lineUserId = await verifyAdmin(asText(body.idToken, 5000));
    const supabase = db();
    await authorizeAdmin(supabase, lineUserId);
    const data = await groupDetails(supabase, body);
    return reply(origin, { ok: true, data });
  } catch (error) {
    return fail(origin, error);
  }
});
