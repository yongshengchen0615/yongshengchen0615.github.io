import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string };

const MAX_REQUEST_BYTES = 10_000;
const READ_LIMIT = 90;
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const HOLIDAY_LIMIT = 500;

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
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
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
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(500, "INTERNAL_ERROR", "預約日曆暫時無法載入。");
  return response(origin, {
    ok: false,
    status: apiError.status,
    error: { code: apiError.code, message: apiError.message, details: apiError.details },
  }, apiError.status);
}

function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function memberChannelId(): string {
  const value = env("LINE_MEMBER_CHANNEL_ID") || "2010787602";
  if (!/^\d{5,30}$/.test(value)) throw new ApiError(503, "AUTH_CONFIG_MISSING", "LINE 驗證設定尚未完成。");
  return value;
}

async function verifyLineIdToken(idToken: string): Promise<Identity> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");
  const expectedChannelId = memberChannelId();
  let verifyResponse: Response;
  try {
    verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: expectedChannelId }),
    });
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }

  let payload: Json;
  try {
    payload = await verifyResponse.json();
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }

  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud.trim() : "";
  const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const exp = Number(payload.exp || 0);
  if (!verifyResponse.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(supabase: SupabaseClient, identity: Identity): Promise<void> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256(identity.lineUserId),
    p_is_write: false,
    p_cost: 1,
    p_read_limit: READ_LIMIT,
    p_write_limit: 30,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。");
}

async function requireJoinedMember(supabase: SupabaseClient, identity: Identity): Promise<void> {
  const result = await supabase.from("members")
    .select("id,membership_status,status")
    .eq("line_user_id", identity.lineUserId)
    .maybeSingle();
  if (result.error) throw new ApiError(503, "DATABASE_ERROR", "會員資料暫時無法確認。");
  const member = result.data;
  if (!member || member.membership_status !== "active") {
    throw new ApiError(403, "MEMBERSHIP_REQUIRED", "請先加入會員並完成會員資料後再使用預約功能。");
  }
  if (member.status !== "active") throw new ApiError(403, "MEMBER_DISABLED", "此會員目前已停用，無法預約。");
}

function requireMonth(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) throw new ApiError(400, "INVALID_MONTH", "月份格式不正確。");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) {
    throw new ApiError(400, "INVALID_MONTH", "月份超出可查詢範圍。");
  }
  return text;
}

function nextMonthStart(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function taipeiDate(): string {
  const parts: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

async function loadCalendar(supabase: SupabaseClient, month: string): Promise<Json> {
  const settingsResult = await supabase.from("booking_settings")
    .select("min_advance_days,booking_notice")
    .eq("id", 1)
    .maybeSingle();
  if (settingsResult.error || !settingsResult.data) {
    throw new ApiError(503, "BOOKING_SETTINGS_MISSING", "預約共用設定暫時無法載入。");
  }
  const minAdvanceDays = Number(settingsResult.data.min_advance_days || 0);
  if (!Number.isInteger(minAdvanceDays) || minAdvanceDays < 0 || minAdvanceDays > 365) {
    throw new ApiError(503, "BOOKING_SETTINGS_INVALID", "預約共用設定不正確。");
  }
  const bookingNotice = String(settingsResult.data.booking_notice || "");

  const startDate = `${month}-01`;
  const endDate = nextMonthStart(month);
  const rows: Array<{ booking_date: string; start_time: string; end_time: string }> = [];

  const holidaysResult = await supabase.from("calendar_items")
    .select("calendar_item_id,title,description,starts_on,ends_on")
    .eq("item_type", "holiday")
    .eq("status", "active")
    .lt("starts_on", endDate)
    .gte("ends_on", startDate)
    .order("starts_on", { ascending: true })
    .limit(HOLIDAY_LIMIT + 1);
  if (holidaysResult.error) throw new ApiError(503, "DATABASE_ERROR", "休假日資料暫時無法載入。");
  if ((holidaysResult.data || []).length > HOLIDAY_LIMIT) {
    throw new ApiError(503, "HOLIDAY_RESULT_LIMIT", "本月休假日資料量過大，請稍後再試。");
  }

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const result = await supabase.from("bookings")
      .select("booking_date,start_time,end_time")
      .gte("booking_date", startDate)
      .lt("booking_date", endDate)
      .in("status", ["pending", "confirmed"])
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(from, to);

    if (result.error) throw new ApiError(503, "DATABASE_ERROR", "預約日曆暫時無法載入。");
    const pageRows = (result.data || []) as Array<{ booking_date: string; start_time: string; end_time: string }>;
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) throw new ApiError(503, "CALENDAR_RESULT_LIMIT", "本月預約資料量過大，請稍後再試。");
  }

  const grouped = new Map<string, Array<{ startTime: string; endTime: string }>>();
  for (const row of rows) {
    const date = String(row.booking_date || "").slice(0, 10);
    const startTime = String(row.start_time || "").slice(0, 5);
    const endTime = String(row.end_time || "").slice(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) continue;
    const intervals = grouped.get(date) || [];
    intervals.push({ startTime, endTime });
    grouped.set(date, intervals);
  }

  const holidays = (holidaysResult.data || []).map((row: any) => ({
    calendarItemId: String(row.calendar_item_id || ""),
    title: String(row.title || "休假日"),
    description: String(row.description || ""),
    startsOn: String(row.starts_on || "").slice(0, 10),
    endsOn: String(row.ends_on || row.starts_on || "").slice(0, 10),
  })).filter((row: any) => /^\d{4}-\d{2}-\d{2}$/.test(row.startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(row.endsOn));

  const today = taipeiDate();
  return {
    month,
    today,
    settings: { minAdvanceDays, bookingNotice },
    earliestBookingDate: addDays(today, minAdvanceDays),
    occupiedDates: [...grouped.entries()].map(([date, intervals]) => ({ date, intervals })),
    holidays,
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().has(origin)) {
    return response(null, { ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "不允許的來源。" } }, 403);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return errorResponse(origin, new ApiError(405, "METHOD_NOT_ALLOWED", "只支援 POST 請求。"));

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
    }

    let body: Json;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ApiError(400, "INVALID_JSON", "請求格式不正確。");
    }

    const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
    const month = requireMonth(body.month);
    const identity = await verifyLineIdToken(idToken);
    const supabase = dbClient();
    await consumeRateLimit(supabase, identity);
    await requireJoinedMember(supabase, identity);
    const data = await loadCalendar(supabase, month);
    return response(origin, { ok: true, data });
  } catch (error) {
    return errorResponse(origin, error);
  }
});