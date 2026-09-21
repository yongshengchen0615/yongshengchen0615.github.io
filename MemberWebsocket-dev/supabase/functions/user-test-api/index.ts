import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { resolveTestSession, TestModeAuthError } from "../_shared/test-mode-auth.ts";

type Json = Record<string, any>;
type Surface = "member" | "points" | "event" | "calendar" | "booking";
type QaStatus = "passed" | "failed" | "skipped";
type QaCase = {
  key: string;
  name: string;
  status: QaStatus;
  message: string;
  expected: Json;
  actual: Json;
  durationMs: number;
};

const MAX_REQUEST_BYTES = 12_000;
const STORE_SERVICE_ID = "00000000-0000-4000-8000-000000000010";
const QA_PREFIX = "QA";

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

function asText(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io")
    .split(",").map((value) => value.trim()).filter(Boolean));
}

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins().has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "content-type, apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function reply(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function db() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "QA server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function bodyJson(request: Request): Promise<Json> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "測試請求內容過大。");
  }
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "測試請求必須是 JSON object。");
  }
}

function errorResponse(origin: string | null, error: unknown): Response {
  let e: ApiError;
  if (error instanceof ApiError) e = error;
  else if (error instanceof TestModeAuthError) e = new ApiError(error.status, error.code, error.message);
  else e = new ApiError(500, "USER_QA_ERROR", "用戶端自動化測試服務暫時無法完成操作。");
  return reply(origin, { ok: false, status: e.status, error: { code: e.code, message: e.message, details: e.details } }, e.status);
}

function safeError(error: unknown): Json {
  return {
    code: asText((error as any)?.code || (error as any)?.name || "ERROR", 100),
    message: asText((error as any)?.message || "未知錯誤", 300),
  };
}

function qaId(kind: string): string {
  return `${QA_PREFIX}-${kind}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function isoDateTaipei(offsetDays = 0): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function invoke(slug: string, token: string, payload: Json): Promise<Json> {
  const url = env("SUPABASE_URL");
  const gatewayKey = env("SUPABASE_ANON_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !gatewayKey) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "QA server 無法呼叫既有 API。");
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: gatewayKey },
      body: JSON.stringify({ ...payload, idToken: "", testSessionToken: token }),
    });
  } catch {
    throw new ApiError(503, "QA_API_UNAVAILABLE", `${slug} 無法連線。`);
  }
  let data: any = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data || data.ok !== true) {
    throw new ApiError(
      Number(data?.status || response.status || 500),
      asText(data?.error?.code || "QA_API_ERROR", 120),
      asText(data?.error?.message || `${slug} 拒絕測試請求。`, 400),
      data?.error?.details || null,
    );
  }
  return data.data || {};
}

async function runCase(key: string, name: string, fn: () => Promise<{ message: string; expected?: Json; actual?: Json; skipped?: boolean }>): Promise<QaCase> {
  const started = performance.now();
  try {
    const result = await fn();
    return {
      key, name,
      status: result.skipped ? "skipped" : "passed",
      message: result.message,
      expected: result.expected || {},
      actual: result.actual || {},
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    };
  } catch (error) {
    return {
      key, name, status: "failed",
      message: "成功路徑或資料還原失敗。",
      expected: { success: true, cleanup: true },
      actual: { success: false, error: safeError(error) },
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}

async function cleanupAudit(s: any, lineUserId: string, startedAt: string, targetIds: string[] = []): Promise<void> {
  let query = s.from("audit_logs").delete().eq("actor_line_user_id", lineUserId).gte("created_at", startedAt);
  if (targetIds.length) query = query.in("target_id", targetIds);
  const result = await query;
  if (result.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA audit_logs。");
}

async function memberMutationCase(s: any, identity: any, token: string): Promise<QaCase> {
  return runCase("MEMBER_PROFILE_WRITE", "會員資料成功寫入與還原", async () => {
    const startedAt = new Date().toISOString();
    const snapshot = await s.from("members").select("id,salutation").eq("id", identity.memberId).single();
    if (snapshot.error || !snapshot.data) throw new ApiError(500, "QA_MEMBER_SNAPSHOT_FAILED", "無法建立會員資料快照。");
    const original = snapshot.data.salutation ?? null;
    const next = original === "mr" ? "ms" : "mr";
    let writeOk = false;
    let cleanupOk = false;
    try {
      const result = await invoke("member-profile-api", token, {
        action: "user.member.profile.save",
        clientType: "member",
        salutation: next,
      });
      writeOk = result?.profile?.salutation === next;
      if (!writeOk) throw new ApiError(500, "QA_MEMBER_WRITE_VERIFY_FAILED", "會員資料寫入後未讀到預期值。");
      return {
        message: "實際呼叫會員資料儲存 API 成功，並在案例結束後還原原值。",
        expected: { updated: true, restored: true },
        actual: { updated: writeOk, restored: true },
      };
    } finally {
      const restored = await s.from("members").update({ salutation: original, updated_at: new Date().toISOString() }).eq("id", identity.memberId);
      if (restored.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "會員稱謂還原失敗。");
      await cleanupAudit(s, identity.lineUserId, startedAt, [identity.lineUserId]);
      cleanupOk = true;
      if (writeOk && !cleanupOk) throw new ApiError(500, "QA_CLEANUP_FAILED", "會員資料測試清理失敗。");
    }
  });
}

async function pointsMutationCase(s: any, identity: any, token: string): Promise<QaCase> {
  return runCase("POINT_TICKET_WRITE", "集點票券單筆／批次核銷成功與清理", async () => {
    const startedAt = new Date().toISOString();
    const cardId = crypto.randomUUID();
    const cardPublicId = qaId("CARD");
    const ticket1 = qaId("PT");
    const ticket2 = qaId("PT");
    const batchRequest = qaId("REDEEM");
    let cardCreated = false;
    try {
      const card = await s.from("point_cards").insert({
        id: cardId,
        card_id: cardPublicId,
        title: "QA temporary point card",
        description: "Temporary automated-test fixture",
        status: "active",
        accent: "#777777",
        style_key: "forest",
        expiry_mode: "unlimited",
        sort_order: 999999,
        usage_method: "QA",
        usage_instructions: "QA",
        benefit_description: "QA",
        created_by: "user-test-api",
        updated_by: "user-test-api",
      });
      if (card.error) throw new ApiError(500, "QA_POINT_FIXTURE_FAILED", "無法建立 QA 集點卡。");
      cardCreated = true;

      const balance = await s.from("point_balances").insert({ member_id: identity.memberId, point_card_id: cardId, stamps: 2 });
      if (balance.error) throw new ApiError(500, "QA_POINT_FIXTURE_FAILED", "無法建立 QA 點數餘額。");

      const tickets = await s.from("point_tickets").insert([
        {
          ticket_id: ticket1, member_id: identity.memberId, point_card_id: cardId,
          threshold_stamps: 1, ticket_type: "coupon", ticket_title: "QA single redeem",
          ticket_description: "QA", usage_method: "QA", usage_instructions: "QA", prizes: [], status: "available",
        },
        {
          ticket_id: ticket2, member_id: identity.memberId, point_card_id: cardId,
          threshold_stamps: 1, ticket_type: "coupon", ticket_title: "QA batch redeem",
          ticket_description: "QA", usage_method: "QA", usage_instructions: "QA", prizes: [], status: "available",
        },
      ]);
      if (tickets.error) throw new ApiError(500, "QA_POINT_FIXTURE_FAILED", "無法建立 QA 票券。");

      const single = await invoke("api", token, {
        action: "user.pointcard.ticket.redeem",
        clientType: "points",
        ticketId: ticket1,
      });
      if (single?.ticket?.status !== "used") throw new ApiError(500, "QA_POINT_SINGLE_VERIFY_FAILED", "單筆核銷沒有變成 used。");

      const batch = await invoke("pointcard-extension-api", token, {
        operation: "member.redeem",
        ticketIds: [ticket2],
        requestId: batchRequest,
      });
      const finalBalance = await s.from("point_balances").select("stamps").eq("member_id", identity.memberId).eq("point_card_id", cardId).single();
      if (finalBalance.error || Number(finalBalance.data?.stamps) !== 0) {
        throw new ApiError(500, "QA_POINT_BALANCE_VERIFY_FAILED", "核銷後 QA 點數餘額不正確。");
      }
      return {
        message: "單筆核銷與批次核銷都實際成功，QA 卡片／票券／點數／紀錄已清理。",
        expected: { singleStatus: "used", batchApplied: true, finalStamps: 0, cleanup: true },
        actual: {
          singleStatus: single?.ticket?.status || "",
          batchApplied: Number(batch?.ticketCount || 0) === 1 || Array.isArray(batch?.tickets),
          finalStamps: Number(finalBalance.data?.stamps || 0),
          cleanup: true,
        },
      };
    } finally {
      const qaEntries = await s.from("point_entries").delete().eq("member_id", identity.memberId).eq("point_card_id", cardId);
      if (qaEntries.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA point_entries。");
      const qaTickets = await s.from("point_tickets").delete().eq("member_id", identity.memberId).eq("point_card_id", cardId);
      if (qaTickets.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA point_tickets。");
      const qaBalance = await s.from("point_balances").delete().eq("member_id", identity.memberId).eq("point_card_id", cardId);
      if (qaBalance.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA point_balances。");
      if (cardCreated) {
        const qaCard = await s.from("point_cards").delete().eq("id", cardId);
        if (qaCard.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA point_card。");
      }
      const audits = await s.from("audit_logs").delete().eq("actor_line_user_id", identity.lineUserId).gte("created_at", startedAt).or(`target_id.eq.${ticket1},target_id.eq.${ticket2},target_id.eq.${batchRequest}`);
      if (audits.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA 點數 audit。");
    }
  });
}

async function eventMutationCase(s: any, identity: any, token: string): Promise<QaCase> {
  return runCase("EVENT_TICKET_WRITE", "活動票券領取／核銷成功與清理", async () => {
    const startedAt = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const eventPublicId = qaId("EVENT");
    let claimId = "";
    const tier = await s.rpc("current_tier_key", { p_member_id: identity.memberId });
    if (tier.error || !tier.data) throw new ApiError(500, "QA_TIER_LOOKUP_FAILED", "無法確認測試會員等級。");
    try {
      const fixture = await s.from("event_tickets").insert({
        id: eventId,
        event_ticket_id: eventPublicId,
        title: "QA temporary event ticket",
        ticket_type: "coupon",
        description: "Temporary automated-test fixture",
        usage_method: "QA",
        usage_instructions: "QA",
        prizes: [],
        status: "active",
        starts_on: isoDateTaipei(-1),
        ends_on: isoDateTaipei(1),
        quota: 1,
        accent: "#777777",
        allowed_tier_keys: [String(tier.data)],
        created_by: "user-test-api",
        updated_by: "user-test-api",
      });
      if (fixture.error) throw new ApiError(500, "QA_EVENT_FIXTURE_FAILED", "無法建立 QA 活動票券。");

      const claimed = await invoke("api", token, {
        action: "user.event.ticket.claim",
        clientType: "event",
        eventTicketId: eventPublicId,
      });
      claimId = asText(claimed?.ticket?.claimId || claimed?.ticket?.claim_id, 120);
      if (!claimId || claimed?.ticket?.status !== "available") {
        throw new ApiError(500, "QA_EVENT_CLAIM_VERIFY_FAILED", "活動票券領取後對外狀態不是 available。");
      }

      const redeemed = await invoke("api", token, {
        action: "user.event.ticket.redeem",
        clientType: "event",
        claimId,
      });
      if (redeemed?.ticket?.status !== "used") throw new ApiError(500, "QA_EVENT_REDEEM_VERIFY_FAILED", "活動票券核銷後未變成 used。");

      return {
        message: "活動票券領取與核銷都經由正式 API 成功，QA claim/event/audit 已清理。",
        expected: { claimed: true, used: true, cleanup: true },
        actual: { claimed: true, used: redeemed?.ticket?.status === "used", cleanup: true },
      };
    } finally {
      const claims = await s.from("event_ticket_claims").delete().eq("event_ticket_id", eventId).eq("member_id", identity.memberId);
      if (claims.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA event claims。");
      const event = await s.from("event_tickets").delete().eq("id", eventId);
      if (event.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA event fixture。");
      let audits = s.from("audit_logs").delete().eq("actor_line_user_id", identity.lineUserId).gte("created_at", startedAt);
      if (claimId) audits = audits.or(`target_id.eq.${eventPublicId},target_id.eq.${claimId}`);
      else audits = audits.eq("target_id", eventPublicId);
      const cleaned = await audits;
      if (cleaned.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA event audit。");
    }
  });
}

async function createTempService(s: any): Promise<{ id: string; title: string }> {
  const id = crypto.randomUUID();
  const title = qaId("SERVICE");
  const result = await s.from("booking_services").insert({
    id,
    title,
    description: "__TYPE__:QA",
    work_start_time: "09:00:00",
    work_end_time: "17:00:00",
    slot_minutes: 30,
    min_advance_days: 0,
    available_weekdays: [0,1,2,3,4,5,6],
    is_active: true,
    created_by: "user-test-api",
    duration_minutes: 30,
    price_amount: 1,
    service_type: "QA",
    counts_toward_membership: false,
    requires_companion_service: false,
  });
  if (result.error) throw new ApiError(500, "QA_BOOKING_FIXTURE_FAILED", "無法建立 QA 預約項目。");
  return { id, title };
}

async function findBaseSlot(token: string, serviceId: string, settings: any): Promise<{ date: string; startTime: string } | null> {
  const minAdvance = Math.max(0, Number(settings?.minAdvanceDays ?? settings?.min_advance_days ?? 0));
  const maxAdvance = Math.max(0, Number(settings?.maxAdvanceDays ?? settings?.max_advance_days ?? 0));
  const today = isoDateTaipei(0);
  const first = addDays(today, Math.max(1, minAdvance));
  const maxTries = maxAdvance > 0 ? Math.max(1, Math.min(10, maxAdvance - Math.max(1, minAdvance) + 1)) : 10;
  for (let i = 0; i < maxTries; i += 1) {
    const date = addDays(first, i);
    const result = await invoke("booking-api", token, {
      action: "user.booking.slots",
      clientType: "member",
      bookingDate: date,
      items: [{ serviceId, quantity: 1 }],
    });
    const slot = Array.isArray(result?.slots) ? result.slots.find((x: any) => x?.available) : null;
    if (slot?.startTime) return { date, startTime: String(slot.startTime).slice(0, 5) };
  }
  return null;
}

async function bookingMutationCase(s: any, identity: any, token: string): Promise<QaCase> {
  return runCase("BOOKING_WRITE", "預約新增／修改／取消成功與清理", async () => {
    const startedAt = new Date().toISOString();
    const service = await createTempService(s);
    let bookingId = "";
    try {
      const settingsResult = await s.from("booking_settings").select("*").eq("id", 1).single();
      if (settingsResult.error) throw new ApiError(500, "QA_BOOKING_SETTINGS_FAILED", "無法讀取預約設定。");
      const slot = await findBaseSlot(token, service.id, settingsResult.data);
      if (!slot) {
        return { skipped: true, message: "目前允許的預約區間沒有可用時段，成功寫入案例略過。", expected: { availableSlot: true }, actual: { availableSlot: false } };
      }

      const request1 = "BOOK-" + qaId("B").replaceAll("_", "-");
      const created = await invoke("booking-api", token, {
        action: "user.booking.create",
        clientType: "member",
        requestId: request1,
        bookingDate: slot.date,
        startTime: slot.startTime,
        items: [{ serviceId: service.id, quantity: 1 }],
        memberNote: "QA create",
      });
      bookingId = asText(created?.booking?.bookingId || created?.booking?.id, 80);
      const updatedAt = asText(created?.booking?.updatedAt || created?.booking?.updated_at, 100);
      if (!bookingId || !updatedAt) throw new ApiError(500, "QA_BOOKING_CREATE_VERIFY_FAILED", "預約建立後缺少 bookingId/updatedAt。");

      const request2 = "BOOK-" + qaId("U").replaceAll("_", "-");
      const updated = await invoke("booking-api", token, {
        action: "user.booking.update",
        clientType: "member",
        bookingId,
        expectedUpdatedAt: updatedAt,
        requestId: request2,
        bookingDate: slot.date,
        startTime: slot.startTime,
        items: [{ serviceId: service.id, quantity: 1 }],
        memberNote: "QA update",
      });
      if (!updated?.booking) throw new ApiError(500, "QA_BOOKING_UPDATE_VERIFY_FAILED", "預約修改後未回傳 booking。");

      const cancelled = await invoke("booking-api", token, {
        action: "user.booking.cancel",
        clientType: "member",
        bookingId,
      });
      if (cancelled?.booking?.status !== "cancel_requested") {
        throw new ApiError(500, "QA_BOOKING_CANCEL_VERIFY_FAILED", "取消申請後狀態不是 cancel_requested。");
      }

      return {
        message: "預約新增、修改、取消申請都經由正式 API 成功，QA booking/service/audit 已清理。",
        expected: { created: true, updated: true, cancelRequested: true, cleanup: true },
        actual: { created: true, updated: Boolean(updated?.booking), cancelRequested: true, cleanup: true },
      };
    } finally {
      if (bookingId) {
        const bookingAudit = await s.from("booking_audit_events").delete().eq("target_id", bookingId);
        if (bookingAudit.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 booking_audit_events。");
        const audit = await s.from("audit_logs").delete().eq("actor_line_user_id", identity.lineUserId).gte("created_at", startedAt).eq("target_id", bookingId);
        if (audit.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 booking audit_logs。");
        const booking = await s.from("bookings").delete().eq("id", bookingId).eq("member_id", identity.memberId);
        if (booking.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA booking。");
      }
      const svc = await s.from("booking_services").delete().eq("id", service.id);
      if (svc.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理 QA booking service。");
    }
  });
}

async function findGroupSlot(token: string, serviceId: string, primaryTechnicianId: string, settings: any): Promise<{ date: string; startTime: string } | null> {
  const minAdvance = Math.max(0, Number(settings?.minAdvanceDays ?? settings?.min_advance_days ?? 0));
  const maxAdvance = Math.max(0, Number(settings?.maxAdvanceDays ?? settings?.max_advance_days ?? 0));
  const today = isoDateTaipei(0);
  const first = addDays(today, Math.max(1, minAdvance));
  const maxTries = maxAdvance > 0 ? Math.max(1, Math.min(10, maxAdvance - Math.max(1, minAdvance) + 1)) : 10;
  const participants = [
    { technicianId: primaryTechnicianId, items: [{ serviceId, quantity: 1 }] },
    { technicianId: null, items: [{ serviceId, quantity: 1 }] },
  ];
  for (let i = 0; i < maxTries; i += 1) {
    const date = addDays(first, i);
    const result = await invoke("booking-group-api", token, {
      action: "user.booking.group.slots",
      clientType: "member",
      bookingDate: date,
      participants,
    });
    const slot = Array.isArray(result?.slots) ? result.slots.find((x: any) => x?.available) : null;
    if (slot?.startTime) return { date, startTime: String(slot.startTime).slice(0, 5) };
  }
  return null;
}

async function groupBookingMutationCase(s: any, identity: any, token: string): Promise<QaCase> {
  return runCase("BOOKING_GROUP_WRITE", "多人預約新增／修改成功與清理", async () => {
    const startedAt = new Date().toISOString();
    const service = await createTempService(s);
    let bookingId = "";
    try {
      const bootstrap = await invoke("booking-group-api", token, {
        action: "user.booking.group.bootstrap",
        clientType: "member",
      });
      const primary = asText(bootstrap?.settings?.primaryTechnicianId, 80);
      const maxPartySize = Number(bootstrap?.settings?.maxPartySize || 1);
      const techExists = Array.isArray(bootstrap?.technicians) && bootstrap.technicians.some((t: any) => String(t?.technicianId || t?.id || "") === primary);
      if (!primary || !techExists) {
        return {
          skipped: true,
          message: "目前未設定可用主要技師，因此多人預約成功路徑無法建立合法 fixture。",
          expected: { primaryTechnicianConfigured: true },
          actual: { primaryTechnicianConfigured: Boolean(primary), active: techExists },
        };
      }
      if (maxPartySize < 2) {
        return {
          skipped: true,
          message: "目前多人預約上限小於 2 人，無法執行真正的多人成功路徑。",
          expected: { maxPartySizeAtLeast: 2 },
          actual: { maxPartySize },
        };
      }
      const settingsResult = await s.from("booking_settings").select("*").eq("id", 1).single();
      if (settingsResult.error) throw new ApiError(500, "QA_BOOKING_SETTINGS_FAILED", "無法讀取預約設定。");
      const slot = await findGroupSlot(token, service.id, primary, settingsResult.data);
      if (!slot) {
        return { skipped: true, message: "目前允許的區間沒有多人預約可用時段。", expected: { availableSlot: true }, actual: { availableSlot: false } };
      }
      const participants = [
        { technicianId: primary, items: [{ serviceId: service.id, quantity: 1 }] },
        { technicianId: null, items: [{ serviceId: service.id, quantity: 1 }] },
      ];
      const created = await invoke("booking-group-api", token, {
        action: "user.booking.group.create",
        clientType: "member",
        requestId: "BOOK-" + qaId("GB").replaceAll("_", "-"),
        bookingDate: slot.date,
        startTime: slot.startTime,
        participants,
        memberNote: "QA group create",
        contactSource: "member",
      });
      bookingId = asText(created?.booking?.bookingId || created?.booking?.id, 80);
      const updatedAt = asText(created?.booking?.updatedAt || created?.booking?.updated_at, 100);
      if (!bookingId || !updatedAt) throw new ApiError(500, "QA_GROUP_CREATE_VERIFY_FAILED", "多人預約建立後缺少識別或版本。");

      const updated = await invoke("booking-group-api", token, {
        action: "user.booking.group.update",
        clientType: "member",
        bookingId,
        expectedUpdatedAt: updatedAt,
        requestId: "BOOK-" + qaId("GU").replaceAll("_", "-"),
        bookingDate: slot.date,
        startTime: slot.startTime,
        participants,
        memberNote: "QA group update",
        contactSource: "member",
      });
      if (!updated?.booking) throw new ApiError(500, "QA_GROUP_UPDATE_VERIFY_FAILED", "多人預約修改未回傳 booking。");

      const cancelled = await invoke("booking-api", token, {
        action: "user.booking.cancel",
        clientType: "member",
        bookingId,
      });
      if (cancelled?.booking?.status !== "cancel_requested") {
        throw new ApiError(500, "QA_GROUP_CANCEL_VERIFY_FAILED", "多人預約取消申請後狀態不是 cancel_requested。");
      }

      return {
        message: "2 人預約新增、修改與取消申請都經由正式 API 成功，participant/reservation 會隨 QA booking 一起清理。",
        expected: { participantCount: 2, created: true, updated: true, cancelRequested: true, cleanup: true },
        actual: {
          participantCount: Array.isArray(created?.booking?.participants) ? created.booking.participants.length : Number(created?.booking?.partySize || 0),
          created: true,
          updated: Boolean(updated?.booking),
          cancelRequested: true,
          cleanup: true,
        },
      };
    } finally {
      if (bookingId) {
        const bookingAudit = await s.from("booking_audit_events").delete().eq("target_id", bookingId);
        if (bookingAudit.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理多人預約 booking audit。");
        const audit = await s.from("audit_logs").delete().eq("actor_line_user_id", identity.lineUserId).gte("created_at", startedAt).eq("target_id", bookingId);
        if (audit.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理多人預約 audit_logs。");
        const booking = await s.from("bookings").delete().eq("id", bookingId).eq("member_id", identity.memberId);
        if (booking.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理多人預約 booking。");
      }
      const svc = await s.from("booking_services").delete().eq("id", service.id);
      if (svc.error) throw new ApiError(500, "QA_CLEANUP_FAILED", "無法清理多人預約 QA service。");
    }
  });
}

async function calendarBoundaryCase(s: any, token: string): Promise<QaCase> {
  return runCase("CALENDAR_READ_ONLY", "日曆 Server-side 寫入權限邊界", async () => {
    const before = await s.from("calendar_items").select("*", { count: "exact", head: true });
    if (before.error) throw new ApiError(500, "QA_CALENDAR_COUNT_FAILED", "無法讀取日曆資料數量。");

    const url = env("SUPABASE_URL");
    const gatewayKey = env("SUPABASE_ANON_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !gatewayKey) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "QA server 無法呼叫日曆權限測試。");

    const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: gatewayKey },
      body: JSON.stringify({
        action: "admin.calendar-items.save",
        clientType: "calendar",
        idToken: "",
        testSessionToken: token,
        calendarItem: {
          title: "QA SHOULD NOT WRITE",
          itemType: "event",
          status: "active",
          startsOn: "2099-01-01",
        },
      }),
    });
    let payload: any = {};
    try { payload = await response.json(); } catch {}

    const after = await s.from("calendar_items").select("*", { count: "exact", head: true });
    if (after.error) throw new ApiError(500, "QA_CALENDAR_COUNT_FAILED", "無法再次讀取日曆資料數量。");

    const denied = !response.ok && [401,403,404].includes(response.status);
    const unchanged = Number(before.count || 0) === Number(after.count || 0);
    if (!denied || !unchanged) {
      throw new ApiError(500, "QA_CALENDAR_AUTH_BOUNDARY_FAILED", "測試會員的管理端日曆寫入沒有被正確拒絕或資料被改動。", {
        httpStatus: response.status,
        errorCode: payload?.error?.code || "",
        before: Number(before.count || 0),
        after: Number(after.count || 0),
      });
    }
    return {
      message: "測試會員嘗試管理端日曆寫入時被 Server-side Authorization 拒絕，資料筆數保持不變。",
      expected: { denied: true, rowCountUnchanged: true },
      actual: {
        denied,
        httpStatus: response.status,
        errorCode: asText(payload?.error?.code, 120),
        rowCountUnchanged: unchanged,
      },
    };
  });
}

async function surfaceCases(s: any, identity: any, token: string, surface: Surface): Promise<QaCase[]> {
  if (surface === "member") return [await memberMutationCase(s, identity, token)];
  if (surface === "points") return [await pointsMutationCase(s, identity, token)];
  if (surface === "event") return [await eventMutationCase(s, identity, token)];
  if (surface === "calendar") return [await calendarBoundaryCase(s, token)];
  return [
    await bookingMutationCase(s, identity, token),
    await groupBookingMutationCase(s, identity, token),
  ];
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return errorResponse(origin, new ApiError(405, "METHOD_NOT_ALLOWED", "只支援 POST。"));
  if (origin && !allowedOrigins().has(origin)) return errorResponse(origin, new ApiError(403, "ORIGIN_DENIED", "此來源不可使用用戶端 QA。"));

  try {
    const body = await bodyJson(request);
    const action = asText(body.action, 80);
    const surface = asText(body.surface, 20) as Surface;
    if (action !== "user.qa.mutations") throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的 QA 操作。");
    if (!["member","points","event","calendar","booking"].includes(surface)) {
      throw new ApiError(400, "INVALID_SURFACE", "不支援的用戶端頁面。");
    }

    const token = asText(body.testSessionToken, 200);
    const s = db();
    const identity = await resolveTestSession(s, token);
    const member = await s.from("members")
      .select("id,is_test_account,status,membership_status")
      .eq("id", identity.memberId).maybeSingle();
    if (member.error || !member.data || member.data.is_test_account !== true || member.data.status !== "active" || member.data.membership_status !== "active") {
      throw new ApiError(403, "TEST_ACCOUNT_REQUIRED", "只有有效測試帳號可以執行成功寫入 QA。");
    }

    const cases = await surfaceCases(s, identity, token, surface);
    return reply(origin, {
      ok: true,
      status: 200,
      data: {
        surface,
        cases,
        summary: {
          passed: cases.filter((x) => x.status === "passed").length,
          failed: cases.filter((x) => x.status === "failed").length,
          skipped: cases.filter((x) => x.status === "skipped").length,
        },
      },
    });
  } catch (error) {
    return errorResponse(origin, error);
  }
});
