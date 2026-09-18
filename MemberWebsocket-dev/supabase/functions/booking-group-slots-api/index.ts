import { createClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, any>;
const STORE_SERVICE_ID = "00000000-0000-4000-8000-000000000010";
const SLOT_INTERVAL = 30;
const MAX_REQUEST_BYTES = 40000;

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

const env = (name: string) => (Deno.env.get(name) || "").trim();
const asText = (value: unknown, max = 1000) => String(value ?? "").trim().slice(0, max);
const allowedOrigins = () => new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map((value) => value.trim()).filter(Boolean));
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
  const e = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "目前無法取得多人預約時段。");
  return reply(origin, { ok: false, error: { code: e.code, message: e.message, details: e.details } }, e.status);
};
const uuid = (value: unknown, label: string) => {
  const text = asText(value, 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new ApiError(400, "INVALID_INPUT", `${label}格式不正確。`);
  return text;
};
const optionalUuid = (value: unknown, label: string) => {
  const text = asText(value, 60);
  return text ? uuid(text, label) : "";
};
const dateValue = (value: unknown) => {
  const text = asText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(400, "INVALID_DATE", "日期格式不正確。");
  return text;
};
const toMinutes = (value: string) => {
  const [hour, minute] = String(value || "").slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
};
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const taipeiDate = () => {
  const values: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") values[part.type] = part.value; });
  return `${values.year}-${values.month}-${values.day}`;
};
const taipeiMinutes = () => {
  const values: Record<string, string> = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach((part) => { if (part.type !== "literal") values[part.type] = part.value; });
  return Number(values.hour || 0) * 60 + Number(values.minute || 0);
};

function db() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "預約服務設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function verifyMember(idToken: string) {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");
  const channelId = env("LINE_MEMBER_CHANNEL_ID") || "2010787602";
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
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return String(payload.sub);
}

async function activeMember(supabase: ReturnType<typeof db>, lineUserId: string) {
  const result = await supabase.from("members").select("id,membership_status,status").eq("line_user_id", lineUserId).maybeSingle();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認會員資料。");
  if (!result.data || result.data.membership_status !== "active") throw new ApiError(403, "MEMBERSHIP_REQUIRED", "請先加入會員。");
  if (result.data.status !== "active") throw new ApiError(403, "MEMBER_DISABLED", "會員目前已停用。");
  return result.data;
}

async function normalizeGroup(supabase: ReturnType<typeof db>, body: Json) {
  const settingsResult = await supabase.from("booking_settings").select("*").eq("id", 1).single();
  if (settingsResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取預約設定。");
  const settings = settingsResult.data;
  const rawParticipants = Array.isArray(body.participants) ? body.participants : [];
  if (rawParticipants.length < 1 || rawParticipants.length > Number(settings.max_party_size || 1)) {
    throw new ApiError(400, "INVALID_PARTY_SIZE", "預約人數超出目前允許範圍。");
  }
  const primaryId = optionalUuid(settings.primary_technician_id, "主要技師");
  if (!primaryId) throw new ApiError(409, "BOOKING_PRIMARY_TECHNICIAN_MISSING", "管理端尚未設定主要技師。");

  const techResult = await supabase.from("booking_technicians").select("id,is_active").eq("is_active", true);
  if (techResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取技師設定。");
  const activeTechnicians = new Set((techResult.data || []).map((row: any) => String(row.id)));
  if (!activeTechnicians.has(primaryId)) throw new ApiError(409, "BOOKING_PRIMARY_TECHNICIAN_DISABLED", "主要技師目前未開放預約。");

  const serviceIds = new Set<string>();
  const selectedTechnicians = new Set<string>();
  const normalized: Json[] = [];
  let primarySelected = false;
  for (const participant of rawParticipants) {
    if (!participant || !Array.isArray(participant.items) || participant.items.length < 1 || participant.items.length > 20) {
      throw new ApiError(400, "INVALID_BOOKING_ITEMS", "每一位預約人都至少要選擇一個項目。");
    }
    const technicianId = optionalUuid(participant.technicianId, "技師");
    if (technicianId) {
      if (!activeTechnicians.has(technicianId)) throw new ApiError(409, "BOOKING_TECHNICIAN_DISABLED", "選擇的技師目前未開放預約。");
      if (selectedTechnicians.has(technicianId)) throw new ApiError(400, "DUPLICATE_PARTICIPANT_TECHNICIAN", "同一位技師不能同時安排給兩位預約人。");
      selectedTechnicians.add(technicianId);
      if (technicianId === primaryId) primarySelected = true;
    }
    const seen = new Set<string>();
    const items: Json[] = [];
    for (const rawItem of participant.items) {
      const serviceId = uuid(rawItem.serviceId, "預約項目");
      const quantity = Number(rawItem.quantity ?? 1);
      if (serviceId === STORE_SERVICE_ID) throw new ApiError(400, "INVALID_BOOKING_ITEMS", "店內服務由系統自動加入。");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2) throw new ApiError(400, "INVALID_BOOKING_QUANTITY", "項目數量不正確。");
      if (seen.has(serviceId)) throw new ApiError(400, "DUPLICATE_BOOKING_SERVICE", "同一位預約人的相同項目不可重複列出。");
      seen.add(serviceId);
      serviceIds.add(serviceId);
      items.push({ serviceId, quantity });
    }
    normalized.push({ technicianId: technicianId || null, items });
  }
  if (!primarySelected) throw new ApiError(400, "BOOKING_PRIMARY_TECHNICIAN_REQUIRED", "每筆預約至少要有一位選擇主要技師。");

  const servicesResult = await supabase.from("booking_services").select("id,is_active,duration_minutes,price_amount").in("id", [...serviceIds, STORE_SERVICE_ID]);
  if (servicesResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取預約項目。");
  const serviceMap = new Map((servicesResult.data || []).map((row: any) => [String(row.id), row]));
  const storeService = serviceMap.get(STORE_SERVICE_ID);
  if (!storeService || !storeService.is_active) throw new ApiError(409, "BOOKING_SERVICE_DISABLED", "店內服務目前未開放。");

  let maxParticipantServiceMinutes = 0;
  let totalAmount = Number(storeService.price_amount || 0);
  const assignments: Json[] = [];
  for (const participant of normalized) {
    let participantServiceMinutes = 0;
    for (const item of participant.items) {
      const service = serviceMap.get(item.serviceId);
      if (!service) throw new ApiError(404, "BOOKING_SERVICE_NOT_FOUND", "找不到其中一個預約項目。");
      if (!service.is_active) throw new ApiError(409, "BOOKING_SERVICE_DISABLED", "其中一個預約項目目前未開放。");
      participantServiceMinutes += Number(service.duration_minutes || 0) * Number(item.quantity || 1);
      totalAmount += Number(service.price_amount || 0) * Number(item.quantity || 1);
    }
    maxParticipantServiceMinutes = Math.max(maxParticipantServiceMinutes, participantServiceMinutes);
    if (participant.technicianId) assignments.push({ technicianId: participant.technicianId, durationMinutes: participantServiceMinutes });
  }

  const storeServiceMinutes = Number(storeService.duration_minutes || 0);
  const totalDurationMinutes = maxParticipantServiceMinutes + storeServiceMinutes;
  if (totalDurationMinutes < 1 || totalDurationMinutes > 1440) throw new ApiError(400, "INVALID_BOOKING_DURATION", "預約總時間不正確。");
  return { settings, primaryId, participants: normalized, assignments, totalDurationMinutes, totalAmount, storeServiceMinutes };
}

async function slots(supabase: ReturnType<typeof db>, member: any, body: Json) {
  const group = await normalizeGroup(supabase, body);
  const bookingDate = dateValue(body.bookingDate);
  const today = taipeiDate();
  const earliestDate = addDays(today, Number(group.settings.min_advance_days || 0));
  if (bookingDate < earliestDate) {
    return {
      settings: { maxPartySize: Number(group.settings.max_party_size || 1), primaryTechnicianId: group.primaryId },
      totalDurationMinutes: group.totalDurationMinutes,
      totalAmount: group.totalAmount,
      slots: [],
    };
  }

  let excludedBookingId = "";
  if (body.bookingId) {
    excludedBookingId = uuid(body.bookingId, "預約");
    const bookingResult = await supabase.from("bookings").select("id,status").eq("id", excludedBookingId).eq("member_id", member.id).maybeSingle();
    if (bookingResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認修改中的預約。");
    if (!bookingResult.data || !["pending", "confirmed"].includes(bookingResult.data.status)) throw new ApiError(409, "BOOKING_NOT_EDITABLE", "找不到可修改的預約。");
  }

  const primaryRows = await supabase.from("bookings")
    .select("id,start_time,end_time")
    .eq("booking_date", bookingDate)
    .eq("technician_id", group.primaryId)
    .eq("party_size", 1)
    .in("status", ["pending", "confirmed"]);
  if (primaryRows.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取主要技師時段。");
  const primaryOccupied = (primaryRows.data || [])
    .filter((row: any) => String(row.id) !== excludedBookingId)
    .map((row: any) => ({ start: toMinutes(row.start_time), end: toMinutes(row.end_time) }));

  const technicianIds = [...new Set(group.assignments.map((assignment: any) => String(assignment.technicianId)))];
  let reservationRows: any[] = [];
  if (technicianIds.length) {
    const reservationResult = await supabase.from("booking_participant_reservations")
      .select("booking_id,technician_id,start_time,end_time")
      .eq("booking_date", bookingDate)
      .eq("is_active", true)
      .in("technician_id", technicianIds);
    if (reservationResult.error) throw new ApiError(500, "DATABASE_ERROR", "無法讀取技師預約時段。");
    reservationRows = (reservationResult.data || []).filter((row: any) => String(row.booking_id) !== excludedBookingId);
  }
  const occupiedByTechnician = new Map<string, any[]>();
  for (const row of reservationRows) {
    const key = String(row.technician_id || "");
    const list = occupiedByTechnician.get(key) || [];
    list.push({ start: toMinutes(row.start_time), end: toMinutes(row.end_time) });
    occupiedByTechnician.set(key, list);
  }

  const workStart = toMinutes(group.settings.work_start_time);
  const workEnd = toMinutes(group.settings.work_end_time);
  const nowMinutes = taipeiMinutes();
  const output: Json[] = [];
  for (let start = workStart; start + group.totalDurationMinutes <= workEnd; start += SLOT_INTERVAL) {
    const groupEnd = start + group.totalDurationMinutes;
    const primaryOverlap = primaryOccupied.some((occupied: any) => start < occupied.end && groupEnd > occupied.start);
    const assignmentOverlap = group.assignments.some((assignment: any) => {
      const participantEnd = start + Number(assignment.durationMinutes || 0);
      return (occupiedByTechnician.get(String(assignment.technicianId)) || [])
        .some((occupied: any) => start < occupied.end && participantEnd > occupied.start);
    });
    const passed = bookingDate === today && start <= nowMinutes;
    output.push({ startTime: toTime(start), endTime: toTime(groupEnd), available: !primaryOverlap && !assignmentOverlap && !passed });
  }

  return {
    settings: { maxPartySize: Number(group.settings.max_party_size || 1), primaryTechnicianId: group.primaryId },
    totalDurationMinutes: group.totalDurationMinutes,
    totalAmount: group.totalAmount,
    slots: output,
  };
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
    if (asText(body.action, 100) !== "user.booking.group.slots" || asText(body.clientType, 20) !== "member") {
      throw new ApiError(403, "CLIENT_ACTION_MISMATCH", "操作端與功能不相符。");
    }
    const lineUserId = await verifyMember(asText(body.idToken, 5000));
    const supabase = db();
    const member = await activeMember(supabase, lineUserId);
    return reply(origin, { ok: true, data: await slots(supabase, member, body) });
  } catch (error) {
    return fail(origin, error);
  }
});
