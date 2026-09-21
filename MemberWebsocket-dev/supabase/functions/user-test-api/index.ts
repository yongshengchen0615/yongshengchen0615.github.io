import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { readJsonObject } from "../_shared/request-body.ts";
import { resolveTestSession, TestModeAuthError } from "../_shared/test-mode-auth.ts";

type Json = Record<string, unknown>;
type Surface = "member" | "points" | "event" | "calendar" | "booking";
type QaCase = {
  key: string;
  status: "passed" | "failed" | "skipped";
  message: string;
  expected: Json;
  actual: Json;
};

const MAX_REQUEST_BYTES = 20_000;
const STORE_SERVICE_ID = "00000000-0000-4000-8000-000000000010";
const SURFACES = new Set<Surface>(["member","points","event","calendar","booking"]);

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

function asText(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0, max);
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

function reply(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function failReply(origin: string | null, error: unknown): Response {
  const e = error instanceof ApiError
    ? error
    : new ApiError(500, "USER_QA_ERROR", "用戶端自動化測試服務暫時無法完成操作。");
  return reply(origin, {
    ok: false,
    status: e.status,
    error: { code: e.code, message: e.message, details: e.details },
  }, e.status);
}

function db() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function passed(key: string, message: string, expected: Json, actual: Json): QaCase {
  return { key, status: "passed", message, expected, actual };
}

function failed(key: string, message: string, expected: Json, actual: Json): QaCase {
  return { key, status: "failed", message, expected, actual };
}

function skipped(key: string, message: string, expected: Json, actual: Json): QaCase {
  return { key, status: "skipped", message, expected, actual };
}

function suffix(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
}

function isoDateAdd(date: string, days: number): string {
  const parsed = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(500, "INVALID_SERVER_DATE", "伺服器日期格式異常。");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function callFunction(slug: string, token: string, body: Json): Promise<{ status: number; ok: boolean; data: Json; error: Json }> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(url + "/functions/v1/" + slug, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ ...body, testSessionToken: token, idToken: "" }),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = JSON.parse(text || "{}"); } catch {}
  return {
    status: response.status,
    ok: response.ok && payload?.ok === true,
    data: payload?.data && typeof payload.data === "object" ? payload.data : {},
    error: payload?.error && typeof payload.error === "object" ? payload.error : {},
  };
}

function functionError(result: { status: number; error: Json }, fallback: string): ApiError {
  return new ApiError(
    result.status || 500,
    asText(result.error.code, 120) || "DOWNSTREAM_ERROR",
    asText(result.error.message, 500) || fallback,
    result.error.details ?? null,
  );
}

async function cleanupBooking(s: any, bookingId: string): Promise<boolean> {
  if (!bookingId) return true;
  await s.from("booking_completion_settlements").delete().eq("booking_id", bookingId);
  await s.from("booking_audit_events").delete().eq("target_id", bookingId);
  const deleted = await s.from("bookings").delete().eq("id", bookingId);
  if (deleted.error) return false;
  const check = await s.from("bookings").select("id").eq("id", bookingId).maybeSingle();
  return !check.error && !check.data;
}

async function memberProfileWrite(s: any, identity: any, token: string): Promise<QaCase> {
  const key = "MEMBER_PROFILE_WRITE";
  const expected = { writeSucceeded: true, persisted: true, restored: true };
  const beforeResult = await s.from("members")
    .select("birthday,phone,surname,salutation,updated_at")
    .eq("id", identity.memberId)
    .maybeSingle();
  if (beforeResult.error || !beforeResult.data) {
    return failed(key, "無法取得測試會員原始資料。", expected, { writeSucceeded: false, persisted: false, restored: false });
  }

  const before = beforeResult.data;
  const nextBirthday = String(before.birthday || "") === "1990-01-15" ? "1991-02-16" : "1990-01-15";
  const nextPhone = String(before.phone || "") === "+886900000001" ? "+886900000002" : "+886900000001";
  const nextSurname = String(before.surname || "") === "測" ? "驗" : "測";
  const nextSalutation = String(before.salutation || "").toLowerCase() === "mr" ? "ms" : "mr";
  let writeSucceeded = false;
  let persisted = false;
  let restored = false;
  let downstreamCode = "";

  try {
    const write = await callFunction("member-profile-api", token, {
      action: "user.member.profile.save",
      clientType: "member",
      birthday: nextBirthday,
      phone: nextPhone,
      surname: nextSurname,
      salutation: nextSalutation,
    });
    writeSucceeded = write.ok;
    downstreamCode = asText(write.error.code, 120);
    if (write.ok) {
      const verify = await s.from("members").select("birthday,phone,surname,salutation").eq("id", identity.memberId).maybeSingle();
      persisted = !verify.error
        && String(verify.data?.birthday || "") === nextBirthday
        && String(verify.data?.phone || "") === nextPhone
        && String(verify.data?.surname || "") === nextSurname
        && String(verify.data?.salutation || "").toLowerCase() === nextSalutation;
    }
  } finally {
    const restore = await s.from("members").update({
      birthday: before.birthday,
      phone: before.phone,
      surname: before.surname,
      salutation: before.salutation,
      updated_at: before.updated_at,
    }).eq("id", identity.memberId);
    if (!restore.error) {
      const check = await s.from("members").select("birthday,phone,surname,salutation").eq("id", identity.memberId).maybeSingle();
      restored = !check.error
        && String(check.data?.birthday || "") === String(before.birthday || "")
        && String(check.data?.phone || "") === String(before.phone || "")
        && String(check.data?.surname || "") === String(before.surname || "")
        && String(check.data?.salutation || "").toLowerCase() === String(before.salutation || "").toLowerCase();
    }
  }

  const actual = { writeSucceeded, persisted, restored, fieldsWritten: 4, downstreamCode };
  return writeSucceeded && persisted && restored
    ? passed(key, "會員資料已透過正式 API 寫入、驗證並還原。", expected, actual)
    : failed(key, "會員資料成功寫入或還原驗證失敗。", expected, actual);
}

async function pointTicketWrite(s: any, identity: any, token: string): Promise<QaCase> {
  const key = "POINT_TICKET_WRITE";
  const expected = { singleRedeem: true, batchRedeem: true, finalBalance: 0, cleanup: true };
  const tag = suffix();
  let cardId = "";
  let ticket1 = "";
  let ticket2 = "";
  let singleRedeem = false;
  let batchRedeem = false;
  let finalBalance = -1;
  let cleanup = false;
  let errorCode = "";

  try {
    const card = await s.from("point_cards").insert({
      card_id: "QA-PC-" + tag,
      title: "QA 自動化測試卡",
      description: "Temporary automated QA card",
      status: "active",
      accent: "#5f7769",
      style_key: "forest",
      expiry_mode: "unlimited",
      sort_order: 999999,
      usage_method: "QA only",
      usage_instructions: "Temporary automated QA record",
      benefit_description: "QA only",
      created_by: "qa:" + identity.lineUserId,
      updated_by: "qa:" + identity.lineUserId,
    }).select("id").single();
    if (card.error || !card.data) throw new ApiError(500, "QA_POINT_CARD_CREATE_FAILED", "無法建立臨時 QA 集點卡。");
    cardId = String(card.data.id);

    const balance = await s.from("point_balances").insert({
      member_id: identity.memberId,
      point_card_id: cardId,
      stamps: 2,
    });
    if (balance.error) throw new ApiError(500, "QA_POINT_BALANCE_CREATE_FAILED", "無法建立臨時 QA 點數。");

    ticket1 = "QA-PT-S-" + tag;
    ticket2 = "QA-PT-B-" + tag;
    const tickets = await s.from("point_tickets").insert([
      {
        ticket_id: ticket1,
        member_id: identity.memberId,
        point_card_id: cardId,
        threshold_stamps: 1,
        ticket_type: "coupon",
        ticket_title: "QA 單筆核銷",
        ticket_description: "Temporary QA ticket",
        usage_method: "QA",
        usage_instructions: "QA",
        prizes: [],
        status: "available",
      },
      {
        ticket_id: ticket2,
        member_id: identity.memberId,
        point_card_id: cardId,
        threshold_stamps: 1,
        ticket_type: "coupon",
        ticket_title: "QA 批次核銷",
        ticket_description: "Temporary QA ticket",
        usage_method: "QA",
        usage_instructions: "QA",
        prizes: [],
        status: "available",
      },
    ]);
    if (tickets.error) throw new ApiError(500, "QA_POINT_TICKET_CREATE_FAILED", "無法建立臨時 QA 票券。");

    const single = await callFunction("api", token, {
      action: "user.pointcard.ticket.redeem",
      clientType: "points",
      ticketId: ticket1,
    });
    singleRedeem = single.ok;
    if (!single.ok) throw functionError(single, "單筆票券核銷失敗。");

    const batch = await callFunction("pointcard-extension-api", token, {
      operation: "member.redeem",
      ticketIds: [ticket2],
      requestId: "QA_" + tag,
    });
    batchRedeem = batch.ok;
    if (!batch.ok) throw functionError(batch, "批次票券核銷失敗。");

    const balanceCheck = await s.from("point_balances")
      .select("stamps")
      .eq("member_id", identity.memberId)
      .eq("point_card_id", cardId)
      .maybeSingle();
    if (!balanceCheck.error && balanceCheck.data) finalBalance = Number(balanceCheck.data.stamps);
  } catch (error) {
    errorCode = error instanceof ApiError ? error.code : "QA_POINT_WRITE_ERROR";
  } finally {
    if (cardId) {
      await s.from("point_tickets").delete().eq("point_card_id", cardId).eq("member_id", identity.memberId);
      await s.from("point_entries").delete().eq("point_card_id", cardId).eq("member_id", identity.memberId);
      await s.from("point_balances").delete().eq("point_card_id", cardId).eq("member_id", identity.memberId);
      await s.from("point_cards").delete().eq("id", cardId);
      const check = await s.from("point_cards").select("id").eq("id", cardId).maybeSingle();
      cleanup = !check.error && !check.data;
    }
  }

  const actual = { singleRedeem, batchRedeem, finalBalance, cleanup, errorCode };
  return singleRedeem && batchRedeem && finalBalance === 0 && cleanup
    ? passed(key, "臨時集點票券已走過單筆與批次正式核銷流程，並完整清理。", expected, actual)
    : failed(key, "集點票券成功核銷或清理驗證失敗。", expected, actual);
}

async function eventTicketWrite(s: any, identity: any, token: string): Promise<QaCase> {
  const key = "EVENT_TICKET_WRITE";
  const expected = { claimed: true, redeemed: true, cleanup: true };
  const tag = suffix();
  let rowId = "";
  let claimId = "";
  let claimed = false;
  let redeemed = false;
  let cleanup = false;
  let errorCode = "";

  try {
    const today = new Date().toISOString().slice(0, 10);
    const inserted = await s.from("event_tickets").insert({
      event_ticket_id: "QA-EVT-" + tag,
      title: "QA 自動化活動票券",
      ticket_type: "coupon",
      description: "Temporary automated QA ticket",
      usage_method: "QA",
      usage_instructions: "Temporary automated QA record",
      prizes: [],
      status: "active",
      starts_on: isoDateAdd(today, -1),
      ends_on: isoDateAdd(today, 1),
      quota: 10,
      accent: "#5f7769",
      allowed_tier_keys: ["general","silver","gold","platinum"],
      created_by: "qa:" + identity.lineUserId,
      updated_by: "qa:" + identity.lineUserId,
    }).select("id,event_ticket_id").single();
    if (inserted.error || !inserted.data) throw new ApiError(500, "QA_EVENT_CREATE_FAILED", "無法建立臨時 QA 活動票券。");
    rowId = String(inserted.data.id);

    const claim = await callFunction("api", token, {
      action: "user.event.ticket.claim",
      clientType: "event",
      eventTicketId: inserted.data.event_ticket_id,
    });
    claimed = claim.ok;
    if (!claim.ok) throw functionError(claim, "活動票券領取失敗。");

    const claimRow = await s.from("event_ticket_claims")
      .select("claim_id,status")
      .eq("event_ticket_id", rowId)
      .eq("member_id", identity.memberId)
      .maybeSingle();
    if (claimRow.error || !claimRow.data) throw new ApiError(500, "QA_EVENT_CLAIM_MISSING", "領券後找不到 Claim。");
    claimId = String(claimRow.data.claim_id);

    const redeem = await callFunction("api", token, {
      action: "user.event.ticket.redeem",
      clientType: "event",
      claimId,
    });
    redeemed = redeem.ok;
    if (!redeem.ok) throw functionError(redeem, "活動票券核銷失敗。");

    const verify = await s.from("event_ticket_claims")
      .select("status,used_at")
      .eq("claim_id", claimId)
      .maybeSingle();
    redeemed = redeemed && !verify.error && verify.data?.status === "used" && Boolean(verify.data?.used_at);
  } catch (error) {
    errorCode = error instanceof ApiError ? error.code : "QA_EVENT_WRITE_ERROR";
  } finally {
    if (rowId) {
      await s.from("event_ticket_claims").delete().eq("event_ticket_id", rowId).eq("member_id", identity.memberId);
      await s.from("calendar_items").delete().eq("source_event_ticket_id", rowId);
      await s.from("event_tickets").delete().eq("id", rowId);
      const check = await s.from("event_tickets").select("id").eq("id", rowId).maybeSingle();
      cleanup = !check.error && !check.data;
    }
  }

  const actual = { claimed, redeemed, cleanup, errorCode };
  return claimed && redeemed && cleanup
    ? passed(key, "臨時活動票券已完成正式領取、核銷並清理。", expected, actual)
    : failed(key, "活動票券領取、核銷或清理驗證失敗。", expected, actual);
}

async function calendarReadOnly(s: any, identity: any, token: string): Promise<QaCase> {
  const key = "CALENDAR_READ_ONLY";
  const expected = { testSessionCannotAdminWrite: true, calendarCountUnchanged: true };
  const before = await s.from("calendar_items").select("*", { count: "exact", head: true });
  const attempt = await callFunction("api", token, {
    action: "admin.calendar-items.save",
    clientType: "admin",
    calendarItem: {
      title: "QA SHOULD NOT WRITE",
      itemType: "event",
      startsOn: new Date().toISOString().slice(0, 10),
      status: "active",
    },
  });
  const after = await s.from("calendar_items").select("*", { count: "exact", head: true });
  const rejected = !attempt.ok && [401,403].includes(attempt.status);
  const unchanged = !before.error && !after.error && Number(before.count || 0) === Number(after.count || 0);
  const actual = {
    testSessionCannotAdminWrite: rejected,
    httpStatus: attempt.status,
    errorCode: asText(attempt.error.code, 120),
    calendarCountUnchanged: unchanged,
  };
  return rejected && unchanged
    ? passed(key, "測試會員 Session 無法越權寫入管理端日曆，資料筆數未改變。", expected, actual)
    : failed(key, "日曆寫入權限邊界或資料不變性驗證失敗。", expected, actual);
}

function bookingItems(services: any[]): { items: Json[]; normal: any | null } {
  const normal = services.find((service: any) =>
    String(service?.serviceId || "") !== STORE_SERVICE_ID
    && service?.requiresCompanionService !== true
    && Number(service?.durationMinutes || 0) > 0
  ) || null;
  const store = services.find((service: any) => String(service?.serviceId || "") === STORE_SERVICE_ID) || null;
  const items: Json[] = [];
  if (normal) items.push({ serviceId: normal.serviceId, quantity: 1 });
  if (store) items.push({ serviceId: store.serviceId, quantity: 1 });
  return { items, normal };
}

async function findBookingSlot(token: string, slug: string, action: string, itemsOrParticipants: Json, today: string, minDays: number, maxDays: number): Promise<{ date: string; startTime: string }> {
  const startOffset = Math.max(1, Number.isInteger(minDays) ? minDays : 0);
  const lastOffset = maxDays > 0 ? Math.min(maxDays, startOffset + 20) : startOffset + 14;
  for (let offset = startOffset; offset <= lastOffset; offset += 1) {
    const date = isoDateAdd(today, offset);
    const response = await callFunction(slug, token, {
      action,
      clientType: "member",
      bookingDate: date,
      ...itemsOrParticipants,
    });
    if (!response.ok) continue;
    const slots = Array.isArray((response.data as any).slots) ? (response.data as any).slots : [];
    const available = slots.find((slot: any) => slot && slot.available === true && /^\d{2}:\d{2}$/.test(String(slot.startTime || "")));
    if (available) return { date, startTime: String(available.startTime) };
  }
  throw new ApiError(409, "QA_NO_BOOKING_SLOT", "目前預約設定找不到可供 QA 使用的安全時段。");
}

async function bookingWrite(s: any, identity: any, token: string): Promise<QaCase> {
  const key = "BOOKING_WRITE";
  const expected = { created: true, updated: true, cancellationRequested: true, cleanup: true };
  let bookingId = "";
  let created = false;
  let updated = false;
  let cancellationRequested = false;
  let cleanup = false;
  let errorCode = "";

  try {
    const bootstrap = await callFunction("booking-api", token, {
      action: "user.booking.bootstrap",
      clientType: "member",
    });
    if (!bootstrap.ok) throw functionError(bootstrap, "無法讀取預約 Bootstrap。");
    const services = Array.isArray((bootstrap.data as any).services) ? (bootstrap.data as any).services : [];
    const setup = bookingItems(services);
    if (!setup.normal || !setup.items.length) {
      return skipped(key, "目前沒有可供自動化測試的主要預約項目。", expected, { created: false, updated: false, cancellationRequested: false, cleanup: true });
    }
    const settings: any = (bootstrap.data as any).settings || {};
    const today = asText((bootstrap.data as any).today, 10);
    const slot = await findBookingSlot(
      token,
      "booking-api",
      "user.booking.slots",
      { items: setup.items },
      today,
      Number(settings.minAdvanceDays || 0),
      Number(settings.maxAdvanceDays || 0),
    );

    const create = await callFunction("booking-api", token, {
      action: "user.booking.create",
      clientType: "member",
      requestId: "BOOK-QA-" + suffix(),
      bookingDate: slot.date,
      startTime: slot.startTime,
      items: setup.items,
      memberNote: "QA automated create",
    });
    if (!create.ok) throw functionError(create, "QA 預約新增失敗。");
    const booking: any = (create.data as any).booking || {};
    bookingId = asText(booking.bookingId, 80);
    created = Boolean(bookingId && booking.status === "pending");
    if (!created) throw new ApiError(500, "QA_BOOKING_CREATE_VERIFY_FAILED", "新增後預約狀態不符合預期。");

    const update = await callFunction("booking-api", token, {
      action: "user.booking.update",
      clientType: "member",
      bookingId,
      expectedUpdatedAt: booking.updatedAt,
      requestId: "BOOK-QA-" + suffix(),
      bookingDate: slot.date,
      startTime: slot.startTime,
      items: setup.items,
      memberNote: "QA automated update",
    });
    if (!update.ok) throw functionError(update, "QA 預約修改失敗。");
    const updatedBooking: any = (update.data as any).booking || {};
    updated = asText(updatedBooking.memberNote, 500) === "QA automated update";
    if (!updated) throw new ApiError(500, "QA_BOOKING_UPDATE_VERIFY_FAILED", "修改後預約內容未同步。");

    const cancel = await callFunction("booking-api", token, {
      action: "user.booking.cancel",
      clientType: "member",
      bookingId,
    });
    if (!cancel.ok) throw functionError(cancel, "QA 預約取消申請失敗。");
    const cancelledBooking: any = (cancel.data as any).booking || {};
    cancellationRequested = cancelledBooking.status === "cancel_requested";
  } catch (error) {
    errorCode = error instanceof ApiError ? error.code : "QA_BOOKING_WRITE_ERROR";
  } finally {
    cleanup = await cleanupBooking(s, bookingId);
  }

  const actual = { created, updated, cancellationRequested, cleanup, errorCode };
  return created && updated && cancellationRequested && cleanup
    ? passed(key, "預約已走過正式新增、修改、取消申請流程，並清除 QA 資料。", expected, actual)
    : failed(key, "預約新增、修改、取消申請或清理驗證失敗。", expected, actual);
}

async function bookingGroupWrite(s: any, identity: any, token: string): Promise<QaCase> {
  const key = "BOOKING_GROUP_WRITE";
  const expected = { created: true, updated: true, cleanup: true };
  let bookingId = "";
  let created = false;
  let updated = false;
  let cleanup = false;
  let errorCode = "";

  try {
    const [bookingBootstrap, groupBootstrap] = await Promise.all([
      callFunction("booking-api", token, { action: "user.booking.bootstrap", clientType: "member" }),
      callFunction("booking-group-api", token, { action: "user.booking.group.bootstrap", clientType: "member" }),
    ]);
    if (!bookingBootstrap.ok) throw functionError(bookingBootstrap, "無法讀取預約資料。");
    if (!groupBootstrap.ok) throw functionError(groupBootstrap, "無法讀取多人預約資源。");

    const services = Array.isArray((bookingBootstrap.data as any).services) ? (bookingBootstrap.data as any).services : [];
    const normal = bookingItems(services).normal;
    const groupSettings: any = (groupBootstrap.data as any).settings || {};
    const technicians = Array.isArray((groupBootstrap.data as any).technicians) ? (groupBootstrap.data as any).technicians : [];
    const maxPartySize = Number(groupSettings.maxPartySize || 1);
    const primaryId = asText(groupSettings.primaryTechnicianId, 80);
    if (maxPartySize < 2) {
      return skipped(key, "目前多人預約上限為 1 人，依設定略過多人成功寫入測試。", expected, { maxPartySize, cleanup: true });
    }
    if (!normal || !primaryId || !technicians.some((item: any) => item.technicianId === primaryId && item.isActive !== false)) {
      return failed(key, "多人預約已開啟，但主要技師或可測試項目設定不完整。", expected, { maxPartySize, primaryTechnicianConfigured: Boolean(primaryId), normalServiceAvailable: Boolean(normal), cleanup: true });
    }

    const participants = [
      { technicianId: primaryId, items: [{ serviceId: normal.serviceId, quantity: 1 }] },
      { technicianId: null, items: [{ serviceId: normal.serviceId, quantity: 1 }] },
    ];
    const settings: any = (bookingBootstrap.data as any).settings || {};
    const today = asText((bookingBootstrap.data as any).today, 10);
    const slot = await findBookingSlot(
      token,
      "booking-group-api",
      "user.booking.group.slots",
      { participants },
      today,
      Number(settings.minAdvanceDays || 0),
      Number(settings.maxAdvanceDays || 0),
    );

    const create = await callFunction("booking-group-api", token, {
      action: "user.booking.group.create",
      clientType: "member",
      requestId: "BOOK-QA-" + suffix(),
      bookingDate: slot.date,
      startTime: slot.startTime,
      participants,
      memberNote: "QA automated group create",
      contactSource: "member",
    });
    if (!create.ok) throw functionError(create, "多人預約新增失敗。");
    const booking: any = (create.data as any).booking || {};
    bookingId = asText(booking.bookingId, 80);
    created = Boolean(bookingId && Number(booking.partySize || 0) >= 2);
    if (!created) throw new ApiError(500, "QA_GROUP_CREATE_VERIFY_FAILED", "多人預約新增結果不符合預期。");

    const update = await callFunction("booking-group-api", token, {
      action: "user.booking.group.update",
      clientType: "member",
      bookingId,
      expectedUpdatedAt: booking.updatedAt,
      requestId: "BOOK-QA-" + suffix(),
      bookingDate: slot.date,
      startTime: slot.startTime,
      participants,
      memberNote: "QA automated group update",
      contactSource: "member",
    });
    if (!update.ok) throw functionError(update, "多人預約修改失敗。");
    const updatedBooking: any = (update.data as any).booking || {};
    updated = asText(updatedBooking.memberNote, 500) === "QA automated group update"
      && Number(updatedBooking.partySize || 0) >= 2;
  } catch (error) {
    errorCode = error instanceof ApiError ? error.code : "QA_GROUP_WRITE_ERROR";
  } finally {
    cleanup = await cleanupBooking(s, bookingId);
  }

  const actual = { created, updated, cleanup, errorCode };
  return created && updated && cleanup
    ? passed(key, "多人預約已走過正式新增與修改流程，並清除 QA 資料。", expected, actual)
    : failed(key, "多人預約新增、修改或清理驗證失敗。", expected, actual);
}

async function lineSuppression(s: any): Promise<QaCase> {
  const key = "LINE_SUPPRESSION";
  const expected = {
    scheduledGrantMessages: 0,
    bookingOutboxMessages: 0,
    testRecipientOutboxMessages: 0,
  };
  const snapshot = await s.rpc("automation_test_notification_snapshot");
  if (snapshot.error) {
    return failed(key, "無法讀取測試會員 LINE 通知佇列。", expected, {
      snapshotAvailable: false,
      errorCode: asText(snapshot.error.code, 120),
    });
  }
  const data: any = snapshot.data || {};
  const actual = {
    scheduledGrantMessages: Number(data.scheduledGrantMessages || 0),
    bookingOutboxMessages: Number(data.bookingOutboxMessages || 0),
    testRecipientOutboxMessages: Number(data.testRecipientOutboxMessages || 0),
  };
  const ok = actual.scheduledGrantMessages === 0
    && actual.bookingOutboxMessages === 0
    && actual.testRecipientOutboxMessages === 0;
  return ok
    ? passed(key, "測試會員沒有建立任何 LINE 發送佇列。", expected, actual)
    : failed(key, "測試會員出現 LINE 發送佇列，通知隔離邊界失敗。", expected, actual);
}

const QA_CASE_NAMES: Record<string,string> = {
  MEMBER_PROFILE_WRITE: "會員資料正式寫入／驗證／還原",
  POINT_TICKET_WRITE: "集點票券正式核銷／清理",
  EVENT_TICKET_WRITE: "活動票券正式領取／核銷／清理",
  CALENDAR_READ_ONLY: "日曆寫入權限邊界",
  BOOKING_WRITE: "預約新增／修改／取消／清理",
  BOOKING_GROUP_WRITE: "多人預約新增／修改／清理",
  LINE_SUPPRESSION: "測試會員 LINE 通知隔離",
};

async function persistUserQaRun(
  s: any,
  identity: any,
  surface: Surface,
  cases: QaCase[],
): Promise<{ runId: string; runCode: string }> {
  const now = new Date().toISOString();
  const passedCount = cases.filter((item) => item.status === "passed").length;
  const failedCount = cases.filter((item) => item.status === "failed").length;
  const skippedCount = cases.filter((item) => item.status === "skipped").length;
  const runCode = "UQA-" + Date.now().toString(36).toUpperCase() + "-" + suffix().slice(0, 8);
  const finalStatus = failedCount > 0 ? "failed" : "passed";

  const runInsert = await s.from("automation_test_runs").insert({
    run_code: runCode,
    suite: "full",
    environment: "MemberWebsocket-dev",
    status: finalStatus,
    triggered_by: identity.lineUserId,
    total_cases: cases.length,
    passed_cases: passedCount,
    failed_cases: failedCount,
    summary: {
      runnerVersion: "user-test-api-20260921-11",
      source: "member-client",
      surface,
      skippedCases: skippedCount,
      memberId: identity.memberId,
    },
    started_at: now,
    completed_at: now,
    updated_at: now,
  }).select("id").single();
  if (runInsert.error || !runInsert.data) {
    throw new ApiError(503, "QA_RECORD_WRITE_FAILED", "測試已執行，但無法建立會員測試紀錄。");
  }

  const runId = String(runInsert.data.id);
  try {
    const caseInsert = await s.from("automation_test_cases").insert(
      cases.map((item, index) => {
        const actual = item.actual && typeof item.actual === "object" ? item.actual as Json : {};
        const failureCode = item.status === "failed"
          ? asText((actual as any).errorCode || (actual as any).downstreamCode, 120) || "QA_ASSERTION_FAILED"
          : null;
        return {
          run_id: runId,
          case_order: index + 1,
          case_key: item.key,
          name: QA_CASE_NAMES[item.key] || item.key,
          domain: "Member client / " + surface,
          member_id: identity.memberId,
          status: item.status,
          failure_code: failureCode,
          failure_message: item.status === "failed" ? asText(item.message, 500) : null,
          started_at: now,
          completed_at: now,
          updated_at: now,
        };
      }),
    ).select("id,case_key");
    if (caseInsert.error) throw new ApiError(503, "QA_RECORD_CASE_WRITE_FAILED", "無法寫入會員測試案例紀錄。");

    const caseIdByKey = new Map((caseInsert.data || []).map((row: any) => [String(row.case_key), String(row.id)]));
    const steps = cases.map((item) => ({
      case_id: caseIdByKey.get(item.key),
      step_order: 1,
      step_key: "verify",
      name: "正式流程驗證結果",
      status: item.status,
      expected: item.expected ?? {},
      actual: item.actual ?? {},
      message: asText(item.message, 1000),
      started_at: now,
      completed_at: now,
      duration_ms: 0,
      updated_at: now,
    })).filter((row) => Boolean(row.case_id));
    if (steps.length !== cases.length) throw new ApiError(503, "QA_RECORD_CASE_MISMATCH", "會員測試案例紀錄建立不完整。");
    const stepInsert = await s.from("automation_test_steps").insert(steps);
    if (stepInsert.error) throw new ApiError(503, "QA_RECORD_STEP_WRITE_FAILED", "無法寫入會員測試驗證資料。");
  } catch (error) {
    await s.from("automation_test_runs").delete().eq("id", runId);
    throw error;
  }

  return { runId, runCode };
}

async function runSurfaceCases(s: any, identity: any, token: string, surface: Surface): Promise<QaCase[]> {
  let cases: QaCase[];
  if (surface === "member") cases = [await memberProfileWrite(s, identity, token)];
  else if (surface === "points") cases = [await pointTicketWrite(s, identity, token)];
  else if (surface === "event") cases = [await eventTicketWrite(s, identity, token)];
  else if (surface === "calendar") cases = [await calendarReadOnly(s, identity, token)];
  else cases = [
    await bookingWrite(s, identity, token),
    await bookingGroupWrite(s, identity, token),
  ];
  cases.push(await lineSuppression(s));
  return cases;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return failReply(origin, new ApiError(405, "METHOD_NOT_ALLOWED", "只支援 POST。"));
  if (origin && !allowedOrigins().has(origin)) return failReply(origin, new ApiError(403, "ORIGIN_NOT_ALLOWED", "此網站來源未被允許使用用戶端 QA 服務。"));

  try {
    const body = await readJsonObject(request, MAX_REQUEST_BYTES, ApiError);
    if (asText(body.action, 80) !== "user.qa.mutations") {
      throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的 QA 操作。");
    }
    const surface = asText(body.surface, 20) as Surface;
    if (!SURFACES.has(surface)) throw new ApiError(400, "INVALID_SURFACE", "不支援的用戶端測試頁面。");

    const token = asText(body.testSessionToken, 200);
    if (!token) throw new ApiError(401, "TEST_SESSION_REQUIRED", "需要有效的測試帳號 Session。");

    const s = db();
    let identity;
    try {
      identity = await resolveTestSession(s, token);
    } catch (error) {
      if (error instanceof TestModeAuthError) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
    if (identity.isTestAccount !== true) throw new ApiError(403, "TEST_ACCOUNT_REQUIRED", "此功能只允許測試帳號使用。");

    const cases = await runSurfaceCases(s, identity, token, surface);
    const recordedRun = await persistUserQaRun(s, identity, surface, cases);
    return reply(origin, {
      ok: true,
      status: 200,
      data: {
        surface,
        cases,
        runId: recordedRun.runId,
        runCode: recordedRun.runCode,
        recordPersisted: true,
      },
    });
  } catch (error) {
    return failReply(origin, error);
  }
});
