import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };
type ClientType = "member" | "admin";
type RequestedItem = { serviceId: string; quantity: number; service: any };

const MAX_REQUEST_BYTES = 30_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;
const SLOT_START_INTERVAL_MINUTES = 30;
const WRITE_ACTIONS = new Set([
  "user.booking.create",
  "user.booking.cancel",
  "admin.booking.settings.save",
  "admin.booking.service.save",
  "admin.booking.status.update",
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
  const apiError = error instanceof ApiError ? error : mapDatabaseError(error);
  return response(origin, {
    ok: false,
    status: apiError.status,
    error: { code: apiError.code, message: apiError.message, details: apiError.details },
  }, apiError.status);
}

function mapDatabaseError(error: unknown): ApiError {
  const raw = error as { message?: string; details?: string; code?: string };
  const message = `${raw?.message || ""} ${raw?.details || ""}`;
  const rules: Array<[string, number, string, string]> = [
    ["BOOKING_SLOT_TAKEN", 409, "BOOKING_SLOT_TAKEN", "這段時間剛剛已被其他會員預約，請選擇其他時間。"],
    ["BOOKING_TOO_EARLY", 409, "BOOKING_TOO_EARLY", "尚未符合提前預約天數，請選擇較晚的日期。"],
    ["BOOKING_TIME_PASSED", 409, "BOOKING_TIME_PASSED", "這個預約時間已經過了，請重新選擇。"],
    ["BOOKING_SERVICE_DISABLED", 409, "BOOKING_SERVICE_DISABLED", "其中一個預約項目目前未開放。"],
    ["BOOKING_SERVICE_NOT_FOUND", 404, "BOOKING_SERVICE_NOT_FOUND", "找不到其中一個預約項目。"],
    ["BOOKING_SETTINGS_MISSING", 503, "BOOKING_SETTINGS_MISSING", "預約上班時間尚未完成設定。"],
    ["INVALID_BOOKING_ITEMS", 400, "INVALID_BOOKING_ITEMS", "請至少選擇一個預約項目。"],
    ["INVALID_BOOKING_QUANTITY", 400, "INVALID_BOOKING_QUANTITY", "每個預約項目的數量只能選擇 1 或 2。"],
    ["DUPLICATE_BOOKING_SERVICE", 400, "DUPLICATE_BOOKING_SERVICE", "同一個預約項目只能選擇一次，請用數量調整。"],
    ["INVALID_BOOKING_DURATION", 400, "INVALID_BOOKING_DURATION", "預約服務總時間不正確。"],
    ["INVALID_BOOKING_SLOT", 400, "INVALID_BOOKING_SLOT", "這段預約時間超出管理員上班時間。"],
    ["REQUEST_ID_CONFLICT", 409, "REQUEST_ID_CONFLICT", "操作識別碼衝突，請重新操作。"],
    ["MEMBERSHIP_REQUIRED", 403, "MEMBERSHIP_REQUIRED", "請先加入會員並完成會員資料後再使用預約功能。"],
    ["MEMBER_DISABLED", 403, "MEMBER_DISABLED", "此會員目前已停用，無法預約。"],
    ["MEMBER_NOT_FOUND", 403, "MEMBERSHIP_REQUIRED", "請先加入會員並完成會員資料後再使用預約功能。"],
  ];
  for (const [needle, status, code, userMessage] of rules) {
    if (message.includes(needle)) return new ApiError(status, code, userMessage);
  }
  if (raw?.code === "23P01" || raw?.code === "23505") {
    return new ApiError(409, "BOOKING_SLOT_TAKEN", "這段時間已被預約，請選擇其他時間。");
  }
  return new ApiError(500, "DATABASE_ERROR", "資料庫暫時無法完成預約操作。");
}

function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function channelIdFor(clientType: ClientType): string {
  const envName = clientType === "admin" ? "LINE_ADMIN_CHANNEL_ID" : "LINE_MEMBER_CHANNEL_ID";
  const fallback = clientType === "admin" ? "2010791619" : "2010787602";
  const value = env(envName) || fallback;
  if (!/^\d{5,30}$/.test(value)) throw new ApiError(503, "AUTH_CONFIG_MISSING", "LINE 驗證設定尚未完成。");
  return value;
}

async function verifyLineIdToken(idToken: string, clientType: ClientType): Promise<Identity> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");
  const expectedChannelId = channelIdFor(clientType);
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
  try { payload = await verifyResponse.json(); }
  catch { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }

  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud.trim() : "";
  const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const exp = Number(payload.exp || 0);
  if (!verifyResponse.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub, displayName: String(payload.name || "LINE 使用者").slice(0, 120) };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(supabase: SupabaseClient, identity: Identity, action: string): Promise<void> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256(identity.lineUserId),
    p_is_write: WRITE_ACTIONS.has(action),
    p_cost: 1,
    p_read_limit: READ_LIMIT,
    p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。");
}

async function requireJoinedMember(supabase: SupabaseClient, identity: Identity): Promise<any> {
  const result = await supabase.from("members").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw mapDatabaseError(result.error);
  const member = result.data;
  if (!member || member.membership_status !== "active") {
    throw new ApiError(403, "MEMBERSHIP_REQUIRED", "請先加入會員並完成會員資料後再使用預約功能。");
  }
  if (member.status !== "active") throw new ApiError(403, "MEMBER_DISABLED", "此會員目前已停用，無法預約。");
  return member;
}

async function authorizeAdmin(supabase: SupabaseClient, identity: Identity): Promise<any> {
  let result = await supabase.from("admins").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw mapDatabaseError(result.error);
  let admin = result.data;
  if (!admin) {
    const inserted = await supabase.from("admins").insert({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      role: "none",
      status: "pending",
    }).select("*").single();
    if (inserted.error) {
      result = await supabase.from("admins").select("*").eq("line_user_id", identity.lineUserId).single();
      if (result.error) throw mapDatabaseError(inserted.error);
      admin = result.data;
    } else admin = inserted.data;
  }
  if (admin.role !== "admin" || admin.status !== "active") {
    throw new ApiError(403, "ADMIN_PENDING", "管理端帳號尚未授權。", { lineUserId: identity.lineUserId });
  }
  if (identity.displayName && admin.display_name !== identity.displayName) {
    await supabase.from("admins").update({ display_name: identity.displayName, updated_at: new Date().toISOString() }).eq("id", admin.id);
  }
  return admin;
}

function asText(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0, max);
}

function requireUuid(value: unknown, label: string): string {
  const text = asText(value, 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ApiError(400, "INVALID_INPUT", `${label}格式不正確。`);
  }
  return text;
}

function requireDate(value: unknown): string {
  const text = asText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new ApiError(400, "INVALID_DATE", "請選擇正確的預約日期。");
  }
  return text;
}

function normalizeTime(value: unknown): string {
  const text = asText(value, 8);
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) throw new ApiError(400, "INVALID_TIME", "時間格式不正確。");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || ![0, 30].includes(minute)) throw new ApiError(400, "INVALID_TIME", "時間必須以 30 分鐘為起始邊界。");
  return `${match[1]}:${match[2]}`;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = String(value || "").slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function taipeiDate(): string {
  const parts: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") parts[part.type] = part.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function taipeiMinutes(): number {
  const parts: Record<string, string> = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") parts[part.type] = part.value; });
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function settingsClient(row: any): Json {
  return {
    workStartTime: String(row?.work_start_time || "09:00:00").slice(0, 5),
    workEndTime: String(row?.work_end_time || "17:00:00").slice(0, 5),
    updatedAt: row?.updated_at || null,
  };
}

function serviceClient(row: any): Json {
  return {
    serviceId: row.id,
    title: row.title,
    description: row.description || "",
    durationMinutes: Number(row.duration_minutes || 30),
    minAdvanceDays: Number(row.min_advance_days || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemClient(row: any): Json {
  return {
    serviceId: row.service_id,
    serviceTitle: row.service_title || "預約項目",
    unitDurationMinutes: Number(row.unit_duration_minutes || 0),
    quantity: Number(row.quantity || 1),
    subtotalMinutes: Number(row.unit_duration_minutes || 0) * Number(row.quantity || 1),
  };
}

function bookingClient(row: any, items: any[] = []): Json {
  const member = row.members || row.member || null;
  const mappedItems = items.map(itemClient);
  return {
    bookingId: row.id,
    requestId: row.request_id,
    serviceId: row.service_id,
    serviceTitle: mappedItems.length ? mappedItems.map((item: any) => item.serviceTitle).join(" + ") : "預約項目",
    items: mappedItems,
    totalDurationMinutes: Number(row.total_duration_minutes || 30),
    memberId: row.member_id,
    memberDisplayName: member?.display_name || "",
    memberCode: member?.member_code || "",
    bookingDate: row.booking_date,
    startTime: String(row.start_time || "").slice(0, 5),
    endTime: String(row.end_time || "").slice(0, 5),
    status: row.status,
    memberNote: row.member_note || "",
    adminNote: row.admin_note || "",
    confirmedAt: row.confirmed_at,
    rejectedAt: row.rejected_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hydrateBookings(supabase: SupabaseClient, rows: any[]): Promise<Json[]> {
  if (!rows.length) return [];
  const bookingIds = rows.map((row) => row.id);
  const itemResult = await supabase.from("booking_items")
    .select("booking_id,service_id,service_title,unit_duration_minutes,quantity")
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: true });
  if (itemResult.error) throw mapDatabaseError(itemResult.error);
  const grouped = new Map<string, any[]>();
  for (const item of itemResult.data || []) {
    const values = grouped.get(item.booking_id) || [];
    values.push(item);
    grouped.set(item.booking_id, values);
  }
  return rows.map((row) => bookingClient(row, grouped.get(row.id) || []));
}

async function bookingSettings(supabase: SupabaseClient): Promise<any> {
  const result = await supabase.from("booking_settings").select("*").eq("id", 1).maybeSingle();
  if (result.error) throw mapDatabaseError(result.error);
  if (!result.data) throw new ApiError(503, "BOOKING_SETTINGS_MISSING", "預約上班時間尚未完成設定。");
  return result.data;
}

async function activeServices(supabase: SupabaseClient): Promise<any[]> {
  const result = await supabase.from("booking_services").select("*").eq("is_active", true).order("created_at", { ascending: true });
  if (result.error) throw mapDatabaseError(result.error);
  return result.data || [];
}

async function normalizeRequestedItems(supabase: SupabaseClient, body: Json): Promise<RequestedItem[]> {
  const rawItems = Array.isArray(body.items) && body.items.length
    ? body.items
    : body.serviceId ? [{ serviceId: body.serviceId, quantity: 1 }] : [];
  if (!rawItems.length || rawItems.length > 20) throw new ApiError(400, "INVALID_BOOKING_ITEMS", "請至少選擇一個預約項目。");

  const seen = new Set<string>();
  const normalized: RequestedItem[] = [];
  for (const raw of rawItems) {
    const item = raw && typeof raw === "object" ? raw as Json : {};
    const serviceId = requireUuid(item.serviceId, "預約項目");
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2) {
      throw new ApiError(400, "INVALID_BOOKING_QUANTITY", "每個預約項目的數量只能選擇 1 或 2。");
    }
    if (seen.has(serviceId)) throw new ApiError(400, "DUPLICATE_BOOKING_SERVICE", "同一個預約項目只能選擇一次，請用數量調整。");
    seen.add(serviceId);

    const serviceResult = await supabase.from("booking_services").select("*").eq("id", serviceId).maybeSingle();
    if (serviceResult.error) throw mapDatabaseError(serviceResult.error);
    if (!serviceResult.data) throw new ApiError(404, "BOOKING_SERVICE_NOT_FOUND", "找不到其中一個預約項目。");
    if (!serviceResult.data.is_active) throw new ApiError(409, "BOOKING_SERVICE_DISABLED", "其中一個預約項目目前未開放。");
    normalized.push({ serviceId, quantity, service: serviceResult.data });
  }
  return normalized;
}

function totalDuration(items: RequestedItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.service.duration_minutes || 0) * item.quantity, 0);
}

function maximumAdvanceDays(items: RequestedItem[]): number {
  return items.reduce((max, item) => Math.max(max, Number(item.service.min_advance_days || 0)), 0);
}

async function generateSlots(supabase: SupabaseClient, body: Json): Promise<Json> {
  const date = requireDate(body.bookingDate);
  const items = await normalizeRequestedItems(supabase, body);
  const settings = await bookingSettings(supabase);
  const duration = totalDuration(items);
  if (duration < 1 || duration > 1440) throw new ApiError(400, "INVALID_BOOKING_DURATION", "預約服務總時間不正確。");

  const today = taipeiDate();
  const earliestBookingDate = addDays(today, maximumAdvanceDays(items));
  if (date < earliestBookingDate) {
    return {
      settings: settingsClient(settings),
      totalDurationMinutes: duration,
      earliestBookingDate,
      slots: [],
    };
  }

  const bookings = await supabase.from("bookings")
    .select("start_time,end_time")
    .eq("booking_date", date)
    .in("status", ["pending", "confirmed"]);
  if (bookings.error) throw mapDatabaseError(bookings.error);
  const occupied = (bookings.data || []).map((row: any) => ({
    start: timeToMinutes(row.start_time),
    end: timeToMinutes(row.end_time),
  }));

  const workStart = timeToMinutes(settings.work_start_time);
  const workEnd = timeToMinutes(settings.work_end_time);
  const nowMinutes = taipeiMinutes();
  const slots: Json[] = [];
  for (let cursor = workStart; cursor + duration <= workEnd; cursor += SLOT_START_INTERVAL_MINUTES) {
    const candidateEnd = cursor + duration;
    const overlap = occupied.some((range: any) => cursor < range.end && candidateEnd > range.start);
    const passed = date === today && cursor <= nowMinutes;
    slots.push({
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(candidateEnd),
      available: !overlap && !passed,
    });
  }

  return {
    settings: settingsClient(settings),
    totalDurationMinutes: duration,
    earliestBookingDate,
    slots,
  };
}

async function audit(supabase: SupabaseClient, identity: Identity, role: "member" | "admin", action: string, targetType: string, targetId: string, metadata: Json = {}): Promise<void> {
  const result = await supabase.from("booking_audit_events").insert({
    actor_line_user_id: identity.lineUserId,
    actor_role: role,
    action,
    target_type: targetType,
    target_id: targetId,
    result: "success",
    metadata,
  });
  if (result.error) console.error("booking audit insert failed", result.error.message);
}

async function userBootstrap(supabase: SupabaseClient, member: any): Promise<Json> {
  const [settings, services, bookingResult] = await Promise.all([
    bookingSettings(supabase),
    activeServices(supabase),
    supabase.from("bookings")
      .select("*")
      .eq("member_id", member.id)
      .order("booking_date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(50),
  ]);
  if ((bookingResult as any).error) throw mapDatabaseError((bookingResult as any).error);
  return {
    today: taipeiDate(),
    settings: settingsClient(settings),
    services: services.map(serviceClient),
    bookings: await hydrateBookings(supabase, ((bookingResult as any).data || []) as any[]),
  };
}

async function userCreate(supabase: SupabaseClient, identity: Identity, member: any, body: Json): Promise<Json> {
  const bookingDate = requireDate(body.bookingDate);
  const startTime = normalizeTime(body.startTime);
  const requestId = asText(body.requestId, 100);
  if (!/^BOOK-[A-Za-z0-9-]{8,95}$/.test(requestId)) throw new ApiError(400, "INVALID_REQUEST_ID", "操作識別碼格式不正確。");
  const memberNote = asText(body.memberNote, 500);
  const items = await normalizeRequestedItems(supabase, body);
  const rpcItems = items.map((item) => ({ serviceId: item.serviceId, quantity: item.quantity }));

  const created = await supabase.rpc("create_booking_bundle_request", {
    p_request_id: requestId,
    p_member_id: member.id,
    p_booking_date: bookingDate,
    p_start_time: `${startTime}:00`,
    p_items: rpcItems,
    p_member_note: memberNote,
  });
  if (created.error) throw mapDatabaseError(created.error);
  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  if (!row) throw new ApiError(500, "BOOKING_CREATE_FAILED", "預約未完成，請稍後再試。");
  const hydrated = await hydrateBookings(supabase, [row]);
  await audit(supabase, identity, "member", "BOOKING_REQUESTED", "booking", String(row.id), {
    bookingDate,
    startTime,
    totalDurationMinutes: totalDuration(items),
    items: rpcItems,
  });
  return { booking: hydrated[0] };
}

async function userCancel(supabase: SupabaseClient, identity: Identity, member: any, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const existing = await supabase.from("bookings").select("*").eq("id", bookingId).eq("member_id", member.id).maybeSingle();
  if (existing.error) throw mapDatabaseError(existing.error);
  const booking = existing.data;
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "找不到這筆預約。");
  if (!["pending", "confirmed"].includes(booking.status)) throw new ApiError(409, "BOOKING_NOT_CANCELLABLE", "這筆預約目前無法取消。");
  const today = taipeiDate();
  if (booking.booking_date < today || (booking.booking_date === today && timeToMinutes(String(booking.start_time).slice(0, 5)) <= taipeiMinutes())) {
    throw new ApiError(409, "BOOKING_TIME_PASSED", "預約時間已經過了，無法取消。");
  }

  const updated = await supabase.from("bookings").update({
    status: "cancelled",
    cancelled_by: identity.lineUserId,
    cancelled_at: new Date().toISOString(),
  }).eq("id", bookingId).eq("member_id", member.id).in("status", ["pending", "confirmed"]).select("*").single();
  if (updated.error) throw mapDatabaseError(updated.error);
  const hydrated = await hydrateBookings(supabase, [updated.data]);
  await audit(supabase, identity, "member", "BOOKING_CANCELLED", "booking", bookingId);
  return { booking: hydrated[0] };
}

async function adminSettingsSave(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const workStartTime = normalizeTime(body.workStartTime);
  const workEndTime = normalizeTime(body.workEndTime);
  if (timeToMinutes(workEndTime) - timeToMinutes(workStartTime) < SLOT_START_INTERVAL_MINUTES) {
    throw new ApiError(400, "INVALID_WORK_HOURS", "結束工作時間必須晚於開始工作時間至少 30 分鐘。");
  }
  const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
  const current = await bookingSettings(supabase);
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) {
    throw new ApiError(409, "CONFLICT", "上班時間已被其他操作更新，請重新整理後再試。");
  }
  const updated = await supabase.from("booking_settings").update({
    work_start_time: `${workStartTime}:00`,
    work_end_time: `${workEndTime}:00`,
    updated_by: identity.lineUserId,
  }).eq("id", 1).select("*").single();
  if (updated.error) throw mapDatabaseError(updated.error);
  await audit(supabase, identity, "admin", "BOOKING_SETTINGS_UPDATED", "booking_settings", "1", {
    workStartTime,
    workEndTime,
  });
  return { settings: settingsClient(updated.data) };
}

async function adminServiceSave(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const serviceId = asText(body.serviceId, 60);
  if (serviceId) requireUuid(serviceId, "預約項目");
  const title = asText(body.title, 100);
  if (!title) throw new ApiError(400, "INVALID_INPUT", "預約項目名稱不可空白。");
  const description = asText(body.description, 1000);
  const minAdvanceDays = Number(body.minAdvanceDays);
  if (!Number.isInteger(minAdvanceDays) || minAdvanceDays < 0 || minAdvanceDays > 365) {
    throw new ApiError(400, "INVALID_ADVANCE_DAYS", "提前預約天數必須介於 0–365 天。");
  }
  const isActive = body.isActive !== false;

  let current: any = null;
  if (serviceId) {
    const currentResult = await supabase.from("booking_services").select("*").eq("id", serviceId).maybeSingle();
    if (currentResult.error) throw mapDatabaseError(currentResult.error);
    current = currentResult.data;
    if (!current) throw new ApiError(404, "BOOKING_SERVICE_NOT_FOUND", "找不到這個預約項目。");
    const expectedUpdatedAt = asText(body.expectedUpdatedAt, 80);
    if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) {
      throw new ApiError(409, "CONFLICT", "此預約項目已被其他操作更新，請重新整理後再試。");
    }
  }

  const durationMinutes = body.durationMinutes === undefined || body.durationMinutes === null || body.durationMinutes === ""
    ? Number(current?.duration_minutes || 30)
    : Number(body.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
    throw new ApiError(400, "INVALID_SERVICE_DURATION", "項目服務時間必須介於 1–720 分鐘。");
  }

  const patch = {
    title,
    description,
    duration_minutes: durationMinutes,
    min_advance_days: minAdvanceDays,
    is_active: isActive,
  };

  let saved: any;
  if (serviceId) {
    const updated = await supabase.from("booking_services").update(patch).eq("id", serviceId).select("*").single();
    if (updated.error) throw mapDatabaseError(updated.error);
    saved = updated.data;
    await audit(supabase, identity, "admin", "BOOKING_SERVICE_UPDATED", "booking_service", serviceId);
  } else {
    const inserted = await supabase.from("booking_services").insert({ ...patch, created_by: identity.lineUserId }).select("*").single();
    if (inserted.error) throw mapDatabaseError(inserted.error);
    saved = inserted.data;
    await audit(supabase, identity, "admin", "BOOKING_SERVICE_CREATED", "booking_service", String(saved.id));
  }
  return { service: serviceClient(saved) };
}

async function adminBookings(supabase: SupabaseClient): Promise<Json[]> {
  const today = taipeiDate();
  const pending = await supabase.from("bookings")
    .select("*, members(display_name, member_code)")
    .eq("status", "pending")
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(250);
  if (pending.error) throw mapDatabaseError(pending.error);

  const recent = await supabase.from("bookings")
    .select("*, members(display_name, member_code)")
    .gte("booking_date", addDays(today, -7))
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(400);
  if (recent.error) throw mapDatabaseError(recent.error);

  const rows = new Map<string, any>();
  for (const row of [...(pending.data || []), ...(recent.data || [])]) rows.set(row.id, row);
  const sorted = [...rows.values()].sort((a, b) => `${a.booking_date} ${a.start_time}`.localeCompare(`${b.booking_date} ${b.start_time}`));
  return await hydrateBookings(supabase, sorted);
}

async function adminBootstrap(supabase: SupabaseClient): Promise<Json> {
  const [settings, servicesResult, bookings] = await Promise.all([
    bookingSettings(supabase),
    supabase.from("booking_services").select("*").order("created_at", { ascending: true }),
    adminBookings(supabase),
  ]);
  if ((servicesResult as any).error) throw mapDatabaseError((servicesResult as any).error);
  return {
    today: taipeiDate(),
    settings: settingsClient(settings),
    services: ((servicesResult as any).data || []).map(serviceClient),
    bookings,
  };
}

async function adminStatusUpdate(supabase: SupabaseClient, identity: Identity, body: Json): Promise<Json> {
  const bookingId = requireUuid(body.bookingId, "預約");
  const nextStatus = asText(body.status, 20);
  if (!["confirmed", "rejected", "cancelled"].includes(nextStatus)) {
    throw new ApiError(400, "INVALID_BOOKING_STATUS", "不支援的預約狀態。");
  }
  const adminNote = asText(body.adminNote, 500);
  const existing = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (existing.error) throw mapDatabaseError(existing.error);
  const booking = existing.data;
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "找不到這筆預約。");

  const allowed = booking.status === "pending"
    ? ["confirmed", "rejected", "cancelled"]
    : booking.status === "confirmed" ? ["cancelled"] : [];
  if (!allowed.includes(nextStatus)) {
    throw new ApiError(409, "INVALID_BOOKING_TRANSITION", `目前狀態 ${booking.status} 無法變更為 ${nextStatus}。`);
  }

  const now = new Date().toISOString();
  const patch: Json = { status: nextStatus, admin_note: adminNote };
  if (nextStatus === "confirmed") {
    patch.confirmed_by = identity.lineUserId;
    patch.confirmed_at = now;
  } else if (nextStatus === "rejected") {
    patch.rejected_by = identity.lineUserId;
    patch.rejected_at = now;
  } else {
    patch.cancelled_by = identity.lineUserId;
    patch.cancelled_at = now;
  }

  const updated = await supabase.from("bookings").update(patch).eq("id", bookingId).eq("status", booking.status)
    .select("*, members(display_name, member_code)").single();
  if (updated.error) throw mapDatabaseError(updated.error);
  const hydrated = await hydrateBookings(supabase, [updated.data]);
  await audit(supabase, identity, "admin", `BOOKING_${nextStatus.toUpperCase()}`, "booking", bookingId, { previousStatus: booking.status });
  return { booking: hydrated[0] };
}

async function route(supabase: SupabaseClient, identity: Identity, clientType: ClientType, action: string, body: Json): Promise<Json> {
  if (clientType === "member") {
    const member = await requireJoinedMember(supabase, identity);
    if (action === "user.booking.bootstrap") return await userBootstrap(supabase, member);
    if (action === "user.booking.slots") return await generateSlots(supabase, body);
    if (action === "user.booking.create") return await userCreate(supabase, identity, member, body);
    if (action === "user.booking.cancel") return await userCancel(supabase, identity, member, body);
    throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的會員預約操作。");
  }

  await authorizeAdmin(supabase, identity);
  if (action === "admin.booking.bootstrap") return await adminBootstrap(supabase);
  if (action === "admin.booking.settings.save") return await adminSettingsSave(supabase, identity, body);
  if (action === "admin.booking.service.save") return await adminServiceSave(supabase, identity, body);
  if (action === "admin.booking.status.update") return await adminStatusUpdate(supabase, identity, body);
  throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的管理端預約操作。");
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
    let body: Json;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { throw new ApiError(400, "INVALID_JSON", "請求格式不正確。"); }

    const action = asText(body.action, 80);
    const clientType = asText(body.clientType, 20) as ClientType;
    if (!action) throw new ApiError(400, "ACTION_REQUIRED", "缺少操作名稱。");
    if (!["member", "admin"].includes(clientType)) throw new ApiError(400, "INVALID_CLIENT_TYPE", "不支援的操作端。");
    const expectedPrefix = clientType === "admin" ? "admin.booking." : "user.booking.";
    if (!action.startsWith(expectedPrefix)) throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");

    const identity = await verifyLineIdToken(asText(body.idToken, 5000), clientType);
    const supabase = dbClient();
    await consumeRateLimit(supabase, identity, action);
    const data = await route(supabase, identity, clientType, action, body);
    return response(origin, { ok: true, status: 200, data });
  } catch (error) {
    return errorResponse(origin, error);
  }
});
