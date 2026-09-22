import { createClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type CaseResult = {
  passed: boolean;
  code: string;
  message: string;
  expected: unknown;
  actual: unknown;
};

const MAX_REQUEST_BYTES = 20_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return new Set(
    (env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
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
  const resolved = error instanceof ApiError
    ? error
    : new ApiError(500, "TEST_CONTROL_ERROR", "自動化測試服務暫時無法完成操作。");
  return response(origin, {
    ok: false,
    status: resolved.status,
    error: {
      code: resolved.code,
      message: resolved.message,
      details: resolved.details,
    },
  }, resolved.status);
}

async function readBody(request: Request): Promise<Json> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "請求內容過大。");
  }
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Json;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "請求內容必須是有效 JSON。");
  }
}

function dbClient(): any {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function adminChannelId(): string {
  const value = env("LINE_ADMIN_CHANNEL_ID") || "2010791619";
  if (!/^\d{5,30}$/.test(value)) {
    throw new ApiError(503, "AUTH_CONFIG_MISSING", "LINE 管理端驗證設定尚未完成。");
  }
  return value;
}

async function verifyAdminIdentity(idToken: string): Promise<{ lineUserId: string; displayName: string }> {
  const token = asText(idToken, 10_000);
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "需要管理端 LINE 登入。");

  let verifyResponse: Response;
  try {
    verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token, client_id: adminChannelId() }),
    });
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }

  let payload: Json = {};
  try { payload = await verifyResponse.json(); } catch {}
  const sub = asText(payload.sub, 120);
  if (!verifyResponse.ok || !sub) {
    throw new ApiError(401, "AUTH_INVALID", "管理端 LINE 登入已失效，請重新登入。");
  }
  return {
    lineUserId: sub,
    displayName: asText(payload.name || "管理員", 120),
  };
}

async function authorizeAdmin(supabase: any, identity: { lineUserId: string }): Promise<void> {
  const result = await supabase
    .from("admins")
    .select("id,role,status")
    .eq("line_user_id", identity.lineUserId)
    .maybeSingle();
  if (result.error) throw new ApiError(503, "ADMIN_CHECK_FAILED", "目前無法確認管理員權限。");
  if (!result.data || result.data.role !== "admin" || result.data.status !== "active") {
    throw new ApiError(403, "ADMIN_REQUIRED", "此 LINE 帳號沒有管理員權限。");
  }
}

function runCode(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return "QA-" + date + "-" + suffix;
}

function caseDefinitions(suite: string): Array<{ key: string; name: string; domain: string }> {
  const quick = [
    { key: "ENVIRONMENT_ACCESS", name: "測試環境可用性", domain: "Environment" },
    { key: "TEST_ACCOUNT_INTEGRITY", name: "測試會員資料完整性", domain: "Member" },
    { key: "SESSION_SECURITY", name: "測試 Session 安全性", domain: "Authentication" },
    { key: "POINTS_INTEGRITY", name: "集點資料一致性", domain: "Points" },
    { key: "FIXED_TICKET_INTEGRITY", name: "固定／活動票券一致性", domain: "Tickets" },
    { key: "LINE_SUPPRESSION", name: "測試會員 LINE 通知阻擋", domain: "Notification" },
  ];
  if (suite === "quick") return quick;
  return quick.concat([
    { key: "BOOKING_INTEGRITY", name: "預約與技師時段一致性", domain: "Booking" },
    { key: "PRESENCE_INTEGRITY", name: "會員上線狀態一致性", domain: "Presence" },
  ]);
}

function runClient(row: any): Json {
  return {
    id: row.id,
    runCode: row.run_code,
    suite: row.suite,
    environment: row.environment,
    status: row.status,
    totalCases: Number(row.total_cases || 0),
    passedCases: Number(row.passed_cases || 0),
    failedCases: Number(row.failed_cases || 0),
    summary: row.summary || {},
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stepClient(row: any): Json {
  return {
    id: row.id,
    order: Number(row.step_order || 0),
    key: row.step_key,
    name: row.name,
    status: row.status,
    expected: row.expected ?? {},
    actual: row.actual ?? {},
    message: row.message || "",
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}

function caseClient(row: any, steps: any[]): Json {
  return {
    id: row.id,
    order: Number(row.case_order || 0),
    key: row.case_key,
    name: row.name,
    domain: row.domain,
    memberId: row.member_id || null,
    status: row.status,
    failureCode: row.failure_code || "",
    failureMessage: row.failure_message || "",
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    steps: steps.map(stepClient),
  };
}

async function runView(supabase: any, runId: string): Promise<Json> {
  const runResult = await supabase
    .from("automation_test_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (runResult.error) throw new ApiError(503, "TEST_RUN_READ_FAILED", "目前無法讀取測試執行紀錄。");
  if (!runResult.data) throw new ApiError(404, "TEST_RUN_NOT_FOUND", "找不到指定的測試執行紀錄。");

  const casesResult = await supabase
    .from("automation_test_cases")
    .select("*")
    .eq("run_id", runId)
    .order("case_order", { ascending: true });
  if (casesResult.error) throw new ApiError(503, "TEST_CASE_READ_FAILED", "目前無法讀取測試案例。");
  const cases = casesResult.data || [];
  const caseIds = cases.map((row: any) => row.id);

  let steps: any[] = [];
  if (caseIds.length) {
    const stepsResult = await supabase
      .from("automation_test_steps")
      .select("*")
      .in("case_id", caseIds)
      .order("step_order", { ascending: true });
    if (stepsResult.error) throw new ApiError(503, "TEST_STEP_READ_FAILED", "目前無法讀取測試步驟。");
    steps = stepsResult.data || [];
  }

  const byCase = new Map<string, any[]>();
  for (const step of steps) {
    const list = byCase.get(step.case_id) || [];
    list.push(step);
    byCase.set(step.case_id, list);
  }

  return {
    run: runClient(runResult.data),
    cases: cases.map((row: any) => caseClient(row, byCase.get(row.id) || [])),
  };
}

async function recentRuns(supabase: any): Promise<Json[]> {
  const result = await supabase
    .from("automation_test_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);
  if (result.error) throw new ApiError(503, "TEST_HISTORY_READ_FAILED", "目前無法讀取歷史測試紀錄。");
  return (result.data || []).map(runClient);
}

async function testMembers(supabase: any): Promise<any[]> {
  const result = await supabase
    .from("members")
    .select("id,line_user_id,display_name,member_code,status,membership_status,birthday,phone,surname,salutation")
    .eq("is_test_account", true)
    .order("test_account_sequence", { ascending: true, nullsFirst: false });
  if (result.error) throw new ApiError(503, "TEST_MEMBER_READ_FAILED", "目前無法讀取測試會員資料。");
  return result.data || [];
}

function pass(message: string, expected: unknown, actual: unknown): CaseResult {
  return { passed: true, code: "", message, expected, actual };
}

function fail(code: string, message: string, expected: unknown, actual: unknown): CaseResult {
  return { passed: false, code, message, expected, actual };
}

async function evaluateEnvironment(supabase: any): Promise<CaseResult> {
  const [settingsResult, memberCountResult] = await Promise.all([
    supabase
      .from("test_mode_settings")
      .select("maintenance_enabled,allow_pc_test_login,allow_mobile_test_login,updated_at")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("is_test_account", true)
      .eq("status", "active")
      .eq("membership_status", "active"),
  ]);
  if (settingsResult.error || memberCountResult.error) {
    throw new ApiError(503, "ENVIRONMENT_READ_FAILED", "無法讀取測試環境狀態。");
  }

  const row = settingsResult.data;
  const settingsRowPresent = Boolean(row);
  const flagsAreBoolean = Boolean(
    row &&
    typeof row.maintenance_enabled === "boolean" &&
    typeof row.allow_pc_test_login === "boolean" &&
    typeof row.allow_mobile_test_login === "boolean"
  );
  const actual = {
    settingsRowPresent,
    settingsFlagsValid: flagsAreBoolean,
    maintenanceEnabled: row?.maintenance_enabled === true,
    pcLoginEnabled: row?.allow_pc_test_login === true,
    mobileLoginEnabled: row?.allow_mobile_test_login === true,
    activeTestAccounts: Number(memberCountResult.count || 0),
    updatedAt: row?.updated_at || null,
    note: "自動化 Runner 使用管理端 server-side 權限；維護模式與裝置測試登入開關可為關閉。",
  };
  const expected = {
    settingsRowPresent: true,
    settingsFlagsValid: true,
    activeTestAccountsAtLeast: 1,
  };
  const ok = settingsRowPresent && flagsAreBoolean && actual.activeTestAccounts >= 1;
  return ok
    ? pass("測試設定可讀，且存在可用測試會員；維護模式與裝置登入開關不影響 server-side 自動化測試。", expected, actual)
    : fail("TEST_ENVIRONMENT_NOT_READY", "測試設定不存在、欄位格式異常，或沒有可用測試會員。", expected, actual);
}

async function evaluateTestAccounts(supabase: any): Promise<CaseResult> {
  const rows = await testMembers(supabase);
  const today = new Date().toISOString().slice(0, 10);
  const invalid: string[] = [];
  let active = 0;
  for (const row of rows) {
    if (row.status === "active" && row.membership_status === "active") active += 1;
    const phone = asText(row.phone, 30).replace(/[()\s-]/g, "");
    const profileOk = Boolean(
      row.status === "active" &&
      row.membership_status === "active" &&
      row.birthday &&
      String(row.birthday) <= today &&
      /^\+?\d{8,15}$/.test(phone) &&
      asText(row.surname, 40) &&
      ["mr", "ms"].includes(asText(row.salutation, 10).toLowerCase()),
    );
    if (!profileOk && invalid.length < 5) invalid.push(asText(row.member_code, 30) || row.id);
  }
  const actual = {
    totalTestAccounts: rows.length,
    activeTestAccounts: active,
    invalidProfileCount: rows.length - active + Math.max(0, invalid.length - (rows.length - active)),
    sampleInvalidMemberCodes: invalid,
  };
  const invalidCount = rows.filter((row: any) => {
    const phone = asText(row.phone, 30).replace(/[()\s-]/g, "");
    return !(
      row.status === "active" &&
      row.membership_status === "active" &&
      row.birthday &&
      String(row.birthday) <= today &&
      /^\+?\d{8,15}$/.test(phone) &&
      asText(row.surname, 40) &&
      ["mr", "ms"].includes(asText(row.salutation, 10).toLowerCase())
    );
  }).length;
  actual.invalidProfileCount = invalidCount;
  const expected = { totalTestAccountsAtLeast: 1, invalidProfileCount: 0 };
  return rows.length > 0 && invalidCount === 0
    ? pass("測試會員皆具備可用且合法的個人資料。", expected, actual)
    : fail("TEST_ACCOUNT_PROFILE_INVALID", "部分測試會員資料不完整或不符合驗證規則。", expected, actual);
}

async function evaluateSessions(supabase: any): Promise<CaseResult> {
  const members = await testMembers(supabase);
  const memberIds = new Set(members.map((row: any) => row.id));
  const result = await supabase
    .from("test_login_sessions")
    .select("id,token_hash,member_id,expires_at,revoked_at,device_class");
  if (result.error) throw new ApiError(503, "TEST_SESSION_READ_FAILED", "無法讀取測試登入 Session。");

  const rows = result.data || [];
  const now = Date.now();
  let invalidHash = 0;
  let nonTestMember = 0;
  let invalidActiveDevice = 0;
  let activeSessions = 0;
  for (const row of rows) {
    if (!/^[a-f0-9]{64}$/.test(asText(row.token_hash, 80))) invalidHash += 1;
    if (!memberIds.has(row.member_id)) nonTestMember += 1;
    const active = !row.revoked_at && new Date(row.expires_at).getTime() > now;
    if (active) {
      activeSessions += 1;
      if (!["pc", "mobile"].includes(asText(row.device_class, 10))) invalidActiveDevice += 1;
    }
  }
  const actual = {
    totalSessionRows: rows.length,
    activeSessions,
    invalidTokenHashRows: invalidHash,
    sessionsLinkedToNonTestMember: nonTestMember,
    activeSessionsWithInvalidDeviceClass: invalidActiveDevice,
  };
  const expected = {
    invalidTokenHashRows: 0,
    sessionsLinkedToNonTestMember: 0,
    activeSessionsWithInvalidDeviceClass: 0,
  };
  const ok = invalidHash === 0 && nonTestMember === 0 && invalidActiveDevice === 0;
  return ok
    ? pass("測試 Session token hash、會員綁定與裝置類型皆符合安全規則。", expected, actual)
    : fail("TEST_SESSION_INVARIANT_FAILED", "測試 Session 存在不符合安全規則的資料。", expected, actual);
}

async function evaluatePoints(supabase: any): Promise<CaseResult> {
  const members = await testMembers(supabase);
  const ids = members.map((row: any) => row.id);
  if (!ids.length) return fail("NO_TEST_ACCOUNTS", "沒有可驗證的測試會員。", { testAccountsAtLeast: 1 }, { testAccounts: 0 });

  const [balanceResult, entryResult, ticketResult] = await Promise.all([
    supabase.from("point_balances").select("member_id,point_card_id,stamps").in("member_id", ids),
    supabase.from("point_entries").select("member_id,point_card_id,amount").in("member_id", ids),
    supabase.from("point_tickets").select("id,status,member_id,points_spent").in("member_id", ids),
  ]);
  if (balanceResult.error || entryResult.error || ticketResult.error) {
    throw new ApiError(503, "POINT_DATA_READ_FAILED", "無法讀取測試會員集點資料。");
  }

  const balances = balanceResult.data || [];
  const entries = entryResult.data || [];
  const tickets = ticketResult.data || [];
  const sums = new Map<string, number>();
  for (const row of entries) {
    const key = row.member_id + "|" + row.point_card_id;
    sums.set(key, (sums.get(key) || 0) + Number(row.amount || 0));
  }
  const balanceMap = new Map<string, number>();
  let negativeBalances = 0;
  for (const row of balances) {
    const key = row.member_id + "|" + row.point_card_id;
    const value = Number(row.stamps || 0);
    balanceMap.set(key, value);
    if (value < 0) negativeBalances += 1;
  }
  const keys = new Set([...sums.keys(), ...balanceMap.keys()]);
  let mismatches = 0;
  for (const key of keys) {
    if ((sums.get(key) || 0) !== (balanceMap.get(key) || 0)) mismatches += 1;
  }
  const invalidTicketSpend = tickets.filter((row: any) => Number(row.points_spent || 0) < 0).length;
  const actual = {
    balanceRows: balances.length,
    entryRows: entries.length,
    ticketRows: tickets.length,
    negativeBalanceRows: negativeBalances,
    derivedBalanceMismatches: mismatches,
    negativeTicketSpendRows: invalidTicketSpend,
  };
  const expected = {
    negativeBalanceRows: 0,
    derivedBalanceMismatches: 0,
    negativeTicketSpendRows: 0,
  };
  const ok = negativeBalances === 0 && mismatches === 0 && invalidTicketSpend === 0;
  return ok
    ? pass("集點餘額與集點流水一致，未發現負數或衍生值錯誤。", expected, actual)
    : fail("POINT_DATA_INCONSISTENT", "集點餘額與集點流水存在不一致。", expected, actual);
}

async function evaluateTickets(supabase: any): Promise<CaseResult> {
  const members = await testMembers(supabase);
  const ids = members.map((row: any) => row.id);
  if (!ids.length) return fail("NO_TEST_ACCOUNTS", "沒有可驗證的測試會員。", { testAccountsAtLeast: 1 }, { testAccounts: 0 });

  const [grantResult, claimResult] = await Promise.all([
    supabase
      .from("fixed_ticket_grants")
      .select("id,fixed_ticket_template_id,member_id,cycle_key,event_ticket_id,claim_id,status")
      .in("member_id", ids),
    supabase
      .from("event_ticket_claims")
      .select("id,claim_id,member_id,event_ticket_id,status")
      .in("member_id", ids),
  ]);
  if (grantResult.error || claimResult.error) {
    throw new ApiError(503, "TICKET_DATA_READ_FAILED", "無法讀取測試會員票券資料。");
  }

  const grants = grantResult.data || [];
  const claims = claimResult.data || [];
  const claimIds = new Set(claims.map((row: any) => asText(row.claim_id, 160)).filter(Boolean));
  const grantKeys = new Set<string>();
  let duplicateGrantCycles = 0;
  let issuedGrantMissingClaim = 0;
  for (const row of grants) {
    const key = row.fixed_ticket_template_id + "|" + row.member_id + "|" + row.cycle_key;
    if (grantKeys.has(key)) duplicateGrantCycles += 1;
    grantKeys.add(key);
    if (row.status === "issued") {
      if (!row.event_ticket_id || !row.claim_id || !claimIds.has(asText(row.claim_id, 160))) {
        issuedGrantMissingClaim += 1;
      }
    }
  }
  const actual = {
    fixedTicketGrantRows: grants.length,
    eventTicketClaimRows: claims.length,
    duplicateGrantCycles,
    issuedGrantMissingClaim,
  };
  const expected = { duplicateGrantCycles: 0, issuedGrantMissingClaim: 0 };
  const ok = duplicateGrantCycles === 0 && issuedGrantMissingClaim === 0;
  return ok
    ? pass("固定票券發放與活動票券 Claim 關聯一致。", expected, actual)
    : fail("TICKET_LINK_INCONSISTENT", "固定票券或活動票券關聯存在異常。", expected, actual);
}

async function evaluateBooking(supabase: any): Promise<CaseResult> {
  const members = await testMembers(supabase);
  const ids = members.map((row: any) => row.id);
  if (!ids.length) return fail("NO_TEST_ACCOUNTS", "沒有可驗證的測試會員。", { testAccountsAtLeast: 1 }, { testAccounts: 0 });

  const bookingResult = await supabase
    .from("bookings")
    .select("id,booking_date,start_time,end_time,status,total_duration_minutes,technician_id")
    .in("member_id", ids);
  if (bookingResult.error) throw new ApiError(503, "BOOKING_READ_FAILED", "無法讀取測試會員預約資料。");
  const bookings = bookingResult.data || [];
  const bookingIds = bookings.map((row: any) => row.id);

  let reservations: any[] = [];
  if (bookingIds.length) {
    const reservationResult = await supabase
      .from("booking_participant_reservations")
      .select("participant_id,booking_id,technician_id,booking_date,start_time,end_time,is_active")
      .in("booking_id", bookingIds);
    if (reservationResult.error) throw new ApiError(503, "BOOKING_RESERVATION_READ_FAILED", "無法讀取預約技師時段。");
    reservations = reservationResult.data || [];
  }

  let invalidDurationRows = 0;
  for (const row of bookings) {
    if (!row.start_time || !row.end_time || String(row.start_time) >= String(row.end_time) || Number(row.total_duration_minutes || 0) <= 0) {
      invalidDurationRows += 1;
    }
  }

  const active = reservations.filter((row: any) => row.is_active === true);
  const groups = new Map<string, any[]>();
  for (const row of active) {
    const key = row.technician_id + "|" + row.booking_date;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  let overlappingReservations = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (String(list[j].start_time) >= String(list[i].end_time)) break;
        if (
          list[i].booking_id !== list[j].booking_id &&
          String(list[i].start_time) < String(list[j].end_time) &&
          String(list[j].start_time) < String(list[i].end_time)
        ) {
          overlappingReservations += 1;
        }
      }
    }
  }

  const actual = {
    bookingRows: bookings.length,
    activeParticipantReservations: active.length,
    invalidDurationRows,
    overlappingTechnicianReservations: overlappingReservations,
  };
  const expected = { invalidDurationRows: 0, overlappingTechnicianReservations: 0 };
  const ok = invalidDurationRows === 0 && overlappingReservations === 0;
  return ok
    ? pass("測試會員預約時間與技師占用時段沒有衝突。", expected, actual)
    : fail("BOOKING_INVARIANT_FAILED", "預約時間或技師占用時段存在資料異常。", expected, actual);
}

async function evaluatePresence(supabase: any): Promise<CaseResult> {
  const members = await testMembers(supabase);
  const ids = members.map((row: any) => row.id);
  if (!ids.length) return fail("NO_TEST_ACCOUNTS", "沒有可驗證的測試會員。", { testAccountsAtLeast: 1 }, { testAccounts: 0 });

  const result = await supabase
    .from("member_presence_sessions")
    .select("id,member_id,surface,last_seen_at,offline_at")
    .in("member_id", ids)
    .is("offline_at", null);
  if (result.error) throw new ApiError(503, "PRESENCE_READ_FAILED", "無法讀取測試會員上線狀態。");

  const rows = result.data || [];
  const staleThresholdMs = 3 * 60 * 1000;
  const stale = rows.filter((row: any) => {
    const lastSeen = new Date(row.last_seen_at).getTime();
    return !Number.isFinite(lastSeen) || Date.now() - lastSeen > staleThresholdMs;
  });
  const actual = {
    openPresenceSessions: rows.length,
    stalePresenceSessions: stale.length,
    staleThresholdSeconds: staleThresholdMs / 1000,
    surfaces: [...new Set(rows.map((row: any) => asText(row.surface, 30)).filter(Boolean))],
  };
  const expected = { stalePresenceSessions: 0 };
  return stale.length === 0
    ? pass("目前開啟的 Presence session 都在心跳容許範圍內。", expected, actual)
    : fail("STALE_PRESENCE_SESSION", "發現已超過心跳期限但仍標示在線的測試會員 session。", expected, actual);
}

async function evaluateLineSuppression(supabase: any): Promise<CaseResult> {
  const rpc = await supabase.rpc("automation_test_notification_snapshot");
  if (rpc.error) throw new ApiError(503, "NOTIFICATION_SNAPSHOT_FAILED", "無法讀取測試會員通知佇列。");
  const actual = rpc.data || {};
  const scheduled = Number(actual.scheduledGrantMessages || 0);
  const bookingOutbox = Number(actual.bookingOutboxMessages || 0);
  const testRecipientOutbox = Number(actual.testRecipientOutboxMessages || 0);
  const normalized = {
    scheduledGrantMessages: scheduled,
    bookingOutboxMessages: bookingOutbox,
    testRecipientOutboxMessages: testRecipientOutbox,
  };
  const expected = {
    scheduledGrantMessages: 0,
    bookingOutboxMessages: 0,
    testRecipientOutboxMessages: 0,
  };
  const ok = scheduled === 0 && bookingOutbox === 0 && testRecipientOutbox === 0;
  return ok
    ? pass("測試會員沒有建立任何 LINE 發送佇列。", expected, normalized)
    : fail("TEST_MEMBER_LINE_QUEUE_DETECTED", "測試會員出現 LINE 發送佇列，需立即檢查通知邊界。", expected, normalized);
}

async function evaluateCase(supabase: any, caseKey: string): Promise<CaseResult> {
  if (caseKey === "ENVIRONMENT_ACCESS") return evaluateEnvironment(supabase);
  if (caseKey === "TEST_ACCOUNT_INTEGRITY") return evaluateTestAccounts(supabase);
  if (caseKey === "SESSION_SECURITY") return evaluateSessions(supabase);
  if (caseKey === "POINTS_INTEGRITY") return evaluatePoints(supabase);
  if (caseKey === "FIXED_TICKET_INTEGRITY") return evaluateTickets(supabase);
  if (caseKey === "LINE_SUPPRESSION") return evaluateLineSuppression(supabase);
  if (caseKey === "BOOKING_INTEGRITY") return evaluateBooking(supabase);
  if (caseKey === "PRESENCE_INTEGRITY") return evaluatePresence(supabase);
  throw new ApiError(500, "UNKNOWN_TEST_CASE", "自動化測試案例未註冊。");
}

async function insertStep(
  supabase: any,
  caseId: string,
  order: number,
  key: string,
  name: string,
  status: string,
  expected: unknown,
  actual: unknown,
  message: string,
  startedAt: string,
  durationMs: number,
): Promise<void> {
  const now = new Date().toISOString();
  const result = await supabase.from("automation_test_steps").insert({
    case_id: caseId,
    step_order: order,
    step_key: key,
    name,
    status,
    expected,
    actual,
    message,
    started_at: startedAt,
    completed_at: now,
    duration_ms: Math.max(0, Math.round(durationMs)),
    updated_at: now,
  });
  if (result.error) throw new ApiError(503, "TEST_STEP_WRITE_FAILED", "目前無法寫入測試步驟。");
}

async function executeCase(supabase: any, testCase: any): Promise<void> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const startResult = await supabase
    .from("automation_test_cases")
    .update({
      status: "running",
      started_at: startedAt,
      updated_at: startedAt,
      failure_code: null,
      failure_message: null,
    })
    .eq("id", testCase.id)
    .eq("status", "queued");
  if (startResult.error) throw new ApiError(503, "TEST_CASE_START_FAILED", "目前無法啟動測試案例。");

  try {
    const collectStartedAt = new Date().toISOString();
    const collectMs = Date.now();
    const result = await evaluateCase(supabase, testCase.case_key);
    await insertStep(
      supabase,
      testCase.id,
      1,
      "collect",
      "收集目前測試數據",
      "passed",
      {},
      result.actual,
      "已取得本案例需要的安全測試快照。",
      collectStartedAt,
      Date.now() - collectMs,
    );
    await insertStep(
      supabase,
      testCase.id,
      2,
      "validate",
      "驗證預期條件",
      result.passed ? "passed" : "failed",
      result.expected,
      result.actual,
      result.message,
      new Date().toISOString(),
      0,
    );

    const completedAt = new Date().toISOString();
    const update = await supabase
      .from("automation_test_cases")
      .update({
        status: result.passed ? "passed" : "failed",
        failure_code: result.passed ? null : result.code,
        failure_message: result.passed ? null : result.message,
        completed_at: completedAt,
        duration_ms: Date.now() - startedMs,
        updated_at: completedAt,
      })
      .eq("id", testCase.id);
    if (update.error) throw new ApiError(503, "TEST_CASE_FINISH_FAILED", "目前無法完成測試案例。");
  } catch (error) {
    const e = error instanceof ApiError
      ? error
      : new ApiError(500, "CASE_EXECUTION_ERROR", "測試案例執行時發生未預期錯誤。");
    try {
      await insertStep(
        supabase,
        testCase.id,
        1,
        "collect",
        "收集目前測試數據",
        "failed",
        {},
        { errorCode: e.code },
        e.message,
        startedAt,
        Date.now() - startedMs,
      );
    } catch {}
    const completedAt = new Date().toISOString();
    await supabase
      .from("automation_test_cases")
      .update({
        status: "failed",
        failure_code: e.code,
        failure_message: e.message,
        completed_at: completedAt,
        duration_ms: Date.now() - startedMs,
        updated_at: completedAt,
      })
      .eq("id", testCase.id);
  }
}

async function refreshCounters(supabase: any, runId: string): Promise<{ total: number; passed: number; failed: number }> {
  const result = await supabase
    .from("automation_test_cases")
    .select("status")
    .eq("run_id", runId);
  if (result.error) throw new ApiError(503, "TEST_COUNTER_READ_FAILED", "無法更新測試進度。");
  const rows = result.data || [];
  const counters = {
    total: rows.length,
    passed: rows.filter((row: any) => row.status === "passed").length,
    failed: rows.filter((row: any) => row.status === "failed").length,
  };
  const now = new Date().toISOString();
  const update = await supabase
    .from("automation_test_runs")
    .update({
      total_cases: counters.total,
      passed_cases: counters.passed,
      failed_cases: counters.failed,
      updated_at: now,
    })
    .eq("id", runId);
  if (update.error) throw new ApiError(503, "TEST_COUNTER_WRITE_FAILED", "無法更新測試進度。");
  return counters;
}


function safeBrowserSnapshot(value: unknown, maxChars = 5000): unknown {
  if (value === undefined) return {};
  let serialized = "";
  try { serialized = JSON.stringify(value ?? {}); }
  catch { throw new ApiError(400, "INVALID_BROWSER_SNAPSHOT", "E2E 測試資料必須可安全序列化。"); }
  if (serialized.length > maxChars) {
    throw new ApiError(413, "BROWSER_SNAPSHOT_TOO_LARGE", "單一 E2E 測試快照過大。");
  }
  try { return JSON.parse(serialized); }
  catch { return {}; }
}

async function recordBrowserRun(
  supabase: any,
  identity: { lineUserId: string },
  body: Json,
): Promise<Json> {
  const suite = asText(body.suite, 20);
  if (!["quick", "full"].includes(suite)) {
    throw new ApiError(400, "INVALID_TEST_SUITE", "瀏覽器 E2E 測試類型必須是 quick 或 full。");
  }
  const runnerKind = asText(body.runnerKind, 40);
  if (!["admin-browser", "paired-browser"].includes(runnerKind)) {
    throw new ApiError(400, "INVALID_RUNNER_KIND", "不支援的瀏覽器 E2E Runner。");
  }

  const rawCases = Array.isArray(body.cases) ? body.cases : [];
  if (!rawCases.length || rawCases.length > 80) {
    throw new ApiError(400, "INVALID_BROWSER_CASES", "瀏覽器 E2E 案例數量必須介於 1–80。");
  }

  let memberId: string | null = null;
  const requestedMemberId = asText(body.memberId, 80);
  if (requestedMemberId) {
    if (!UUID_RE.test(requestedMemberId)) throw new ApiError(400, "INVALID_MEMBER_ID", "測試會員識別不正確。");
    const member = await supabase
      .from("members")
      .select("id,is_test_account,status,membership_status")
      .eq("id", requestedMemberId)
      .maybeSingle();
    if (member.error) throw new ApiError(503, "TEST_MEMBER_READ_FAILED", "目前無法確認協同測試會員。");
    if (!member.data || member.data.is_test_account !== true || member.data.status !== "active" || member.data.membership_status !== "active") {
      throw new ApiError(403, "TEST_ACCOUNT_UNAVAILABLE", "協同測試只能綁定啟用中的測試會員。");
    }
    memberId = String(member.data.id);
  }

  const normalized = rawCases.map((raw: any, index: number) => {
    const status = asText(raw?.status, 20);
    if (!["passed", "failed", "skipped"].includes(status)) {
      throw new ApiError(400, "INVALID_BROWSER_CASE_STATUS", "瀏覽器 E2E 案例狀態不正確。");
    }
    const key = asText(raw?.key, 100) || "BROWSER_CASE_" + String(index + 1);
    const name = asText(raw?.name, 180) || key;
    const domain = asText(raw?.domain, 120) || "Browser E2E";
    const message = asText(raw?.message, 1000);
    const durationMs = Math.max(0, Math.min(600000, Math.trunc(Number(raw?.durationMs) || 0)));
    return {
      key, name, domain, status, message, durationMs,
      expected: safeBrowserSnapshot(raw?.expected),
      actual: safeBrowserSnapshot(raw?.actual),
    };
  });

  const passed = normalized.filter((item) => item.status === "passed").length;
  const failed = normalized.filter((item) => item.status === "failed").length;
  const skipped = normalized.filter((item) => item.status === "skipped").length;
  const now = new Date().toISOString();
  const runInsert = await supabase.from("automation_test_runs").insert({
    run_code: runCode(),
    suite,
    environment: "MemberWebsocket-dev",
    status: failed ? "failed" : "passed",
    triggered_by: identity.lineUserId,
    total_cases: normalized.length,
    passed_cases: passed,
    failed_cases: failed,
    summary: {
      runnerVersion: "admin-browser-e2e-20260922-1",
      runnerKind,
      skippedCases: skipped,
      memberId,
    },
    started_at: now,
    completed_at: now,
    updated_at: now,
  }).select("id").single();
  if (runInsert.error || !runInsert.data) {
    throw new ApiError(503, "BROWSER_RUN_CREATE_FAILED", "目前無法建立瀏覽器 E2E 測試紀錄。");
  }

  const runId = String(runInsert.data.id);
  try {
    const caseRows = normalized.map((item, index) => ({
      run_id: runId,
      case_order: index + 1,
      case_key: item.key,
      name: item.name,
      domain: item.domain,
      member_id: memberId,
      status: item.status,
      failure_code: item.status === "failed" ? "BROWSER_E2E_FAILED" : null,
      failure_message: item.status === "failed" ? item.message : null,
      started_at: now,
      completed_at: now,
      duration_ms: item.durationMs,
      updated_at: now,
    }));
    const inserted = await supabase.from("automation_test_cases").insert(caseRows).select("id,case_order");
    if (inserted.error || (inserted.data || []).length !== normalized.length) {
      throw new ApiError(503, "BROWSER_CASE_WRITE_FAILED", "無法完整寫入瀏覽器 E2E 案例。");
    }
    const caseIds = new Map((inserted.data || []).map((row: any) => [Number(row.case_order), String(row.id)]));
    const stepRows = normalized.map((item, index) => ({
      case_id: caseIds.get(index + 1),
      step_order: 1,
      step_key: "browser",
      name: "瀏覽器真人操作驗證",
      status: item.status,
      expected: item.expected,
      actual: item.actual,
      message: item.message,
      started_at: now,
      completed_at: now,
      duration_ms: item.durationMs,
      updated_at: now,
    }));
    if (stepRows.some((row) => !row.case_id)) {
      throw new ApiError(503, "BROWSER_CASE_ID_MISMATCH", "瀏覽器 E2E 案例紀錄對應失敗。");
    }
    const steps = await supabase.from("automation_test_steps").insert(stepRows);
    if (steps.error) throw new ApiError(503, "BROWSER_STEP_WRITE_FAILED", "無法寫入瀏覽器 E2E 步驟。");
  } catch (error) {
    await supabase.from("automation_test_runs").delete().eq("id", runId);
    throw error;
  }
  return runView(supabase, runId);
}

async function createRun(supabase: any, identity: { lineUserId: string }, suite: string): Promise<Json> {
  if (!["quick", "full"].includes(suite)) {
    throw new ApiError(400, "INVALID_TEST_SUITE", "測試類型必須是 quick 或 full。");
  }
  const defs = caseDefinitions(suite);
  const runInsert = await supabase
    .from("automation_test_runs")
    .insert({
      run_code: runCode(),
      suite,
      environment: "MemberWebsocket-dev",
      status: "queued",
      triggered_by: identity.lineUserId,
      total_cases: defs.length,
      passed_cases: 0,
      failed_cases: 0,
      summary: { runnerVersion: "test-control-20260921-2" },
    })
    .select("id")
    .single();
  if (runInsert.error) throw new ApiError(503, "TEST_RUN_CREATE_FAILED", "目前無法建立自動化測試。");

  const runId = runInsert.data.id;
  const caseInsert = await supabase.from("automation_test_cases").insert(
    defs.map((def, index) => ({
      run_id: runId,
      case_order: index + 1,
      case_key: def.key,
      name: def.name,
      domain: def.domain,
      status: "queued",
    })),
  );
  if (caseInsert.error) {
    await supabase.from("automation_test_runs").delete().eq("id", runId);
    throw new ApiError(503, "TEST_CASE_CREATE_FAILED", "目前無法建立自動化測試案例。");
  }
  return runView(supabase, runId);
}

async function executeRun(supabase: any, runId: string): Promise<Json> {
  if (!UUID_RE.test(runId)) throw new ApiError(400, "INVALID_RUN_ID", "測試執行識別不正確。");

  const now = new Date().toISOString();
  const claim = await supabase
    .from("automation_test_runs")
    .update({ status: "running", started_at: now, updated_at: now })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (claim.error) throw new ApiError(503, "TEST_RUN_START_FAILED", "目前無法啟動自動化測試。");
  if (!claim.data) throw new ApiError(409, "TEST_RUN_ALREADY_STARTED", "此測試已啟動或已完成。");

  const caseResult = await supabase
    .from("automation_test_cases")
    .select("*")
    .eq("run_id", runId)
    .order("case_order", { ascending: true });
  if (caseResult.error) throw new ApiError(503, "TEST_CASE_READ_FAILED", "目前無法讀取測試案例。");

  for (const testCase of caseResult.data || []) {
    await executeCase(supabase, testCase);
    await refreshCounters(supabase, runId);
  }

  const counters = await refreshCounters(supabase, runId);
  const completedAt = new Date().toISOString();
  const finalStatus = counters.failed === 0 ? "passed" : "failed";
  const finalUpdate = await supabase
    .from("automation_test_runs")
    .update({
      status: finalStatus,
      completed_at: completedAt,
      updated_at: completedAt,
      summary: {
        runnerVersion: "test-control-20260921-2",
        completedCases: counters.passed + counters.failed,
        totalCases: counters.total,
        passedCases: counters.passed,
        failedCases: counters.failed,
      },
    })
    .eq("id", runId);
  if (finalUpdate.error) throw new ApiError(503, "TEST_RUN_FINISH_FAILED", "目前無法完成自動化測試。");
  return runView(supabase, runId);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return errorResponse(origin, new ApiError(405, "METHOD_NOT_ALLOWED", "只支援 POST。"));
  }
  if (origin && !allowedOrigins().has(origin)) {
    return errorResponse(origin, new ApiError(403, "ORIGIN_NOT_ALLOWED", "此網站來源未被允許使用自動化測試服務。"));
  }

  try {
    const body = await readBody(request);
    if (asText(body.clientType, 20) !== "admin") {
      throw new ApiError(403, "ADMIN_SURFACE_REQUIRED", "請從管理端使用自動化測試。");
    }
    const action = asText(body.action, 80);
    const supabase = dbClient();
    const identity = await verifyAdminIdentity(asText(body.idToken, 10_000));
    await authorizeAdmin(supabase, identity);

    if (action === "admin.test-control.list") {
      return response(origin, {
        ok: true,
        status: 200,
        data: { runs: await recentRuns(supabase) },
      });
    }

    if (action === "admin.test-control.status") {
      const runId = asText(body.runId, 80);
      if (!UUID_RE.test(runId)) throw new ApiError(400, "INVALID_RUN_ID", "測試執行識別不正確。");
      return response(origin, {
        ok: true,
        status: 200,
        data: {
          ...(await runView(supabase, runId)),
          runs: await recentRuns(supabase),
        },
      });
    }

    if (action === "admin.test-control.create") {
      const suite = asText(body.suite, 20);
      const created = await createRun(supabase, identity, suite);
      return response(origin, {
        ok: true,
        status: 201,
        data: {
          ...created,
          runs: await recentRuns(supabase),
        },
      }, 201);
    }

    if (action === "admin.test-control.record-browser-run") {
      const recorded = await recordBrowserRun(supabase, identity, body);
      return response(origin, {
        ok: true,
        status: 201,
        data: {
          ...recorded,
          runs: await recentRuns(supabase),
        },
      }, 201);
    }

    if (action === "admin.test-control.execute") {
      const runId = asText(body.runId, 80);
      const executed = await executeRun(supabase, runId);
      return response(origin, {
        ok: true,
        status: 200,
        data: {
          ...executed,
          runs: await recentRuns(supabase),
        },
      });
    }

    throw new ApiError(404, "ACTION_NOT_FOUND", "找不到指定的自動化測試操作。");
  } catch (error) {
    return errorResponse(origin, error);
  }
});
