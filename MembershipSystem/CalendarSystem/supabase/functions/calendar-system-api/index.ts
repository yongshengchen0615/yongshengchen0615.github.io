import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type ClientType = "user" | "admin";
type Identity = { lineUserId: string; displayName: string };

const MAX_REQUEST_BYTES = 40_000;
const MAX_BATCH_ITEMS = 20;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;
const USER_CHANNEL_ID = "2005939681";
const ADMIN_CHANNEL_ID = "2011356226";
const CALENDAR_TYPES = new Set(["holiday", "event", "notice"]);
const CALENDAR_STATUSES = new Set(["draft", "published"]);
const WRITE_ACTIONS = new Set([
  "admin.calendar.create",
  "admin.calendar.update",
  "admin.calendar.archive",
  "admin.calendar.bulkCreate",
  "admin.calendar.bulkUpdate",
  "admin.calendar.bulkArchive",
  "admin.users.updateStatus",
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
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function json(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = String((error as { message?: string })?.message || "");
  const rules: Array<[string, number, string, string]> = [
    ["CONFLICT", 409, "CONFLICT", "資料已被其他管理者更新，請重新整理後再試。"],
    ["ITEM_NOT_FOUND", 404, "ITEM_NOT_FOUND", "找不到指定的日曆項目。"],
    ["ITEM_ARCHIVED", 409, "ITEM_ARCHIVED", "已封存項目不可再編輯。"],
    ["INVALID_CALENDAR_BATCH", 400, "INVALID_CALENDAR_BATCH", "批量操作格式不合法。"],
    ["calendar_system_items_date_range", 400, "INVALID_DATE_RANGE", "結束日期不得早於開始日期。"],
    ["calendar_system_items_time_consistency", 400, "INVALID_TIME_RANGE", "日曆時間範圍不合法。"],
  ];
  for (const [needle, status, code, userMessage] of rules) {
    if (message.includes(needle)) return new ApiError(status, code, userMessage);
  }
  return new ApiError(500, "DATABASE_ERROR", "資料庫暫時無法完成操作。");
}

function errorResponse(origin: string | null, error: unknown): Response {
  const apiError = mapError(error);
  return json(origin, {
    ok: false,
    status: apiError.status,
    error: { code: apiError.code, message: apiError.message, details: apiError.details },
  }, apiError.status);
}

function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  let key = "";
  try {
    const secretKeys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    key = String(secretKeys.default || "");
  } catch (_) {}
  if (!key) key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function asText(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0, max);
}

function requiredText(value: unknown, field: string, max: number): string {
  const text = asText(value, max);
  if (!text) throw new ApiError(400, "VALIDATION_ERROR", `${field} 為必填。`);
  return text;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

function enforceNotPast(item: Json): void {
  const startDate = asText(item.startDate, 10);
  const endDate = asText(item.endDate, 10);
  if (!validDate(startDate) || !validDate(endDate)) return;
  const today = taipeiDate();
  if (startDate < today || endDate < today) {
    throw new ApiError(400, "PAST_DATE_NOT_ALLOWED", "開始日期與結束日期不得設定為已經過去的日期。", { today });
  }
}

function validateItem(raw: unknown, requireId: boolean): Json {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    throw new ApiError(400, "INVALID_ITEM", "日曆項目格式不合法。");
  }
  const item = raw as Json;
  const itemId = requireId ? requiredText(item.itemId, "itemId", 64) : "";
  if (itemId && !/^[A-Za-z0-9-]{8,64}$/.test(itemId)) throw new ApiError(400, "INVALID_ITEM_ID", "日曆項目識別碼不合法。");

  const type = requiredText(item.type, "type", 20).toLowerCase();
  if (!CALENDAR_TYPES.has(type)) throw new ApiError(400, "INVALID_TYPE", "日曆類型不合法。");
  const status = requiredText(item.status, "status", 20).toLowerCase();
  if (!CALENDAR_STATUSES.has(status)) throw new ApiError(400, "INVALID_STATUS", "日曆狀態不合法。");
  const title = requiredText(item.title, "title", 80);
  const startDate = requiredText(item.startDate, "startDate", 10);
  const endDate = requiredText(item.endDate, "endDate", 10);
  if (!validDate(startDate) || !validDate(endDate)) throw new ApiError(400, "INVALID_DATE", "日期格式不合法。");
  if (endDate < startDate) throw new ApiError(400, "INVALID_DATE_RANGE", "結束日期不得早於開始日期。");
  const span = Math.floor((Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000);
  if (span > 366) throw new ApiError(400, "DATE_RANGE_TOO_LONG", "單一日曆項目不得超過 366 天。");

  if (typeof item.allDay !== "boolean") throw new ApiError(400, "INVALID_ALL_DAY", "allDay 必須是 boolean。");
  const allDay = item.allDay as boolean;
  let startTime = asText(item.startTime, 5);
  let endTime = asText(item.endTime, 5);
  if (allDay) {
    startTime = "";
    endTime = "";
  } else {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(startTime) || !timePattern.test(endTime)) throw new ApiError(400, "INVALID_TIME", "非全天項目必須提供合法的開始與結束時間。");
    if (startDate === endDate && endTime <= startTime) throw new ApiError(400, "INVALID_TIME_RANGE", "同一天的結束時間必須晚於開始時間。");
  }

  let color = asText(item.color, 7).toUpperCase();
  if (!color) color = ({ holiday: "#D95656", event: "#3182B8", notice: "#D3A12F" } as Record<string, string>)[type];
  if (!/^#[0-9A-F]{6}$/.test(color)) throw new ApiError(400, "INVALID_COLOR", "color 必須使用 #RRGGBB 格式。");

  return {
    itemId, type, status, title, startDate, endDate, color, allDay, startTime, endTime,
    location: asText(item.location, 120), description: asText(item.description, 1000),
  };
}

function rangeFromBody(body: Json): { startDate: string; endDate: string } | null {
  const startDate = asText(body.rangeStart, 10);
  const endDate = asText(body.rangeEnd, 10);
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate || !validDate(startDate) || !validDate(endDate) || endDate < startDate) {
    throw new ApiError(400, "INVALID_LIST_RANGE", "日曆查詢範圍不合法。");
  }
  const days = Math.floor((Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000) + 1;
  if (days > 42) throw new ApiError(400, "LIST_RANGE_TOO_LARGE", "日曆查詢最多 42 天。");
  return { startDate, endDate };
}

function rowToItem(row: any): Json {
  const time = (value: unknown) => value ? String(value).slice(0, 5) : "";
  return {
    itemId: row.item_id,
    type: row.type,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    allDay: Boolean(row.all_day),
    startTime: time(row.start_time),
    endTime: time(row.end_time),
    description: row.description || "",
    location: row.location || "",
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    color: String(row.color || "#3182B8").toUpperCase(),
  };
}

async function listItems(supabase: SupabaseClient, includeAllStatuses: boolean, range: { startDate: string; endDate: string } | null): Promise<Json[]> {
  let query = supabase.from("calendar_system_items").select("*");
  if (!includeAllStatuses) query = query.eq("status", "published");
  if (range) query = query.lte("start_date", range.endDate).gte("end_date", range.startDate);
  const { data, error } = await query.order("start_date", { ascending: true }).order("start_time", { ascending: true, nullsFirst: true }).order("title", { ascending: true });
  if (error) throw mapError(error);
  return (data || []).map(rowToItem);
}

function channelIdFor(clientType: ClientType): string {
  return clientType === "admin" ? ADMIN_CHANNEL_ID : USER_CHANNEL_ID;
}

async function verifyLineIdToken(idToken: string, clientType: ClientType): Promise<Identity> {
  const expectedChannelId = channelIdFor(clientType);
  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: expectedChannelId }),
    });
  } catch (_) {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }
  let payload: Json;
  try { payload = await response.json(); }
  catch (_) { throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。"); }

  const sub = asText(payload.sub, 120);
  const aud = asText(payload.aud, 30);
  const iss = asText(payload.iss, 120);
  const exp = Number(payload.exp || 0);
  if (!response.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }
  return { lineUserId: sub, displayName: asText(payload.name, 120) || "LINE 使用者" };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(supabase: SupabaseClient, identity: Identity, action: string, body: Json): Promise<void> {
  let cost = 1;
  if (action === "admin.calendar.bulkCreate" && Array.isArray(body.items)) cost = Math.min(MAX_BATCH_ITEMS, body.items.length);
  if (action === "admin.calendar.bulkUpdate" && Array.isArray(body.updates)) cost = Math.min(MAX_BATCH_ITEMS, body.updates.length);
  if (action === "admin.calendar.bulkArchive" && Array.isArray(body.items)) cost = Math.min(MAX_BATCH_ITEMS, body.items.length);
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_principal_hash: await sha256("calendar-system:" + identity.lineUserId),
    p_is_write: WRITE_ACTIONS.has(action),
    p_cost: Math.max(1, cost),
    p_read_limit: READ_LIMIT,
    p_write_limit: WRITE_LIMIT,
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "無法確認請求頻率限制。");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "請求過於密集，請稍後再試。", { retryAfterSeconds: 60 });
}

async function ensureUser(supabase: SupabaseClient, identity: Identity, touchLogin: boolean): Promise<any> {
  const current = await supabase.from("calendar_system_users").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (current.error) throw mapError(current.error);
  const now = new Date().toISOString();
  if (!current.data) {
    const created = await supabase.from("calendar_system_users").insert({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      status: "active",
      last_login_at: now,
      created_at: now,
      updated_at: now,
    }).select("*").single();
    if (created.error) {
      const retry = await supabase.from("calendar_system_users").select("*").eq("line_user_id", identity.lineUserId).single();
      if (retry.error) throw mapError(created.error);
      if (retry.data.status !== "active") throw new ApiError(403, "ACCOUNT_DISABLED", "此帳號目前不可使用日曆服務。");
      return retry.data;
    }
    return created.data;
  }
  if (current.data.status !== "active") throw new ApiError(403, "ACCOUNT_DISABLED", "此帳號目前不可使用日曆服務。");
  const patch: Json = {};
  if (current.data.display_name !== identity.displayName) patch.display_name = identity.displayName;
  if (touchLogin) patch.last_login_at = now;
  if (Object.keys(patch).length) {
    patch.updated_at = now;
    const updated = await supabase.from("calendar_system_users").update(patch).eq("id", current.data.id).select("*").single();
    if (!updated.error) return updated.data;
  }
  return current.data;
}

async function authorizeAdmin(supabase: SupabaseClient, identity: Identity): Promise<any> {
  const current = await supabase.from("admins").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (current.error) throw mapError(current.error);
  let admin = current.data;
  if (!admin) {
    const created = await supabase.from("admins").insert({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      role: "none",
      status: "pending",
    }).select("*").single();
    if (created.error) throw mapError(created.error);
    admin = created.data;
  }
  if (admin.role !== "admin" || admin.status !== "active") {
    throw new ApiError(403, "ADMIN_PENDING", "管理端帳號尚未授權。", { lineUserId: identity.lineUserId });
  }
  if (identity.displayName && admin.display_name !== identity.displayName) {
    await supabase.from("admins").update({ display_name: identity.displayName, updated_at: new Date().toISOString() }).eq("id", admin.id);
    admin.display_name = identity.displayName;
  }
  return admin;
}

async function audit(supabase: SupabaseClient, identity: Identity, role: string, action: string, targetType: string, targetId: string | null, detail: Json | null = null): Promise<void> {
  const result = await supabase.from("audit_logs").insert({
    audit_id: "AUD-" + crypto.randomUUID().replaceAll("-", ""),
    actor_line_user_id: identity.lineUserId,
    actor_role: role,
    action,
    target_type: targetType,
    target_id: targetId,
    result: "success",
    detail,
  });
  if (result.error) console.error("[calendar-system-api] audit insert failed", result.error.code || "unknown");
}

async function applyOperations(supabase: SupabaseClient, actor: Identity, operations: Json[]): Promise<Json[]> {
  const { data, error } = await supabase.rpc("calendar_system_apply_batch", {
    p_actor_line_user_id: actor.lineUserId,
    p_operations: operations,
  });
  if (error) throw mapError(error);
  const rows = Array.isArray(data) ? data : [];
  return rows.map((entry: any) => ({ action: entry.action, item: rowToItem(entry.item) }));
}

async function handleAction(supabase: SupabaseClient, identity: Identity, action: string, body: Json): Promise<Json> {
  if (action === "user.bootstrap" || action === "user.calendar.list") {
    await ensureUser(supabase, identity, action === "user.bootstrap");
    const range = rangeFromBody(body);
    const items = await listItems(supabase, false, range);
    if (action === "user.bootstrap") return { profile: { lineUserId: identity.lineUserId, displayName: identity.displayName }, items };
    return { items };
  }

  const admin = await authorizeAdmin(supabase, identity);
  const role = admin.role || "admin";

  if (action === "admin.bootstrap") {
    const items = await listItems(supabase, true, rangeFromBody(body));
    await audit(supabase, identity, role, "ADMIN_LOGIN", "calendar_system_admin_access", identity.lineUserId, null);
    return { profile: { lineUserId: identity.lineUserId, displayName: identity.displayName }, role, items };
  }
  if (action === "admin.calendar.list") return { items: await listItems(supabase, true, rangeFromBody(body)) };

  if (action === "admin.calendar.create") {
    const item = validateItem(body.item, false);
    enforceNotPast(item);
    const result = await applyOperations(supabase, identity, [{ action: "create", item }]);
    const saved = result[0]?.item || null;
    await audit(supabase, identity, role, "CALENDAR_SYSTEM_ITEM_CREATE", "calendar_system_item", asText(saved?.itemId, 64), { type: item.type, status: item.status });
    return { item: saved };
  }
  if (action === "admin.calendar.update") {
    const item = validateItem(body.item, true);
    enforceNotPast(item);
    const expectedUpdatedAt = requiredText(body.expectedUpdatedAt, "expectedUpdatedAt", 80);
    const result = await applyOperations(supabase, identity, [{ action: "update", item, expectedUpdatedAt }]);
    const saved = result[0]?.item || null;
    await audit(supabase, identity, role, "CALENDAR_SYSTEM_ITEM_UPDATE", "calendar_system_item", asText(saved?.itemId, 64), { type: item.type, status: item.status });
    return { item: saved };
  }
  if (action === "admin.calendar.archive") {
    const itemId = requiredText(body.itemId, "itemId", 64);
    const expectedUpdatedAt = requiredText(body.expectedUpdatedAt, "expectedUpdatedAt", 80);
    const result = await applyOperations(supabase, identity, [{ action: "archive", itemId, expectedUpdatedAt }]);
    const saved = result[0]?.item || null;
    await audit(supabase, identity, role, "CALENDAR_SYSTEM_ITEM_ARCHIVE", "calendar_system_item", itemId, { softDelete: true });
    return { item: saved };
  }

  if (action === "admin.calendar.bulkCreate") {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BATCH_ITEMS) throw new ApiError(400, "INVALID_CALENDAR_BATCH", "批量新增必須是 1–20 筆。");
    const operations = body.items.map((raw) => {
      const item = validateItem(raw, false);
      enforceNotPast(item);
      return { action: "create", item };
    });
    const result = await applyOperations(supabase, identity, operations);
    for (const entry of result) await audit(supabase, identity, role, "CALENDAR_SYSTEM_ITEM_CREATE", "calendar_system_item", asText((entry.item as Json)?.itemId, 64), { bulk: true });
    return { count: result.length, items: result.map((entry) => entry.item) };
  }
  if (action === "admin.calendar.bulkUpdate") {
    if (!Array.isArray(body.updates) || body.updates.length < 1 || body.updates.length > MAX_BATCH_ITEMS) throw new ApiError(400, "INVALID_CALENDAR_BATCH", "批量修改必須是 1–20 筆。");
    const operations = body.updates.map((raw) => {
      const update = raw && typeof raw === "object" ? raw as Json : {};
      const item = validateItem(update.item, true);
      enforceNotPast(item);
      return { action: "update", item, expectedUpdatedAt: requiredText(update.expectedUpdatedAt, "expectedUpdatedAt", 80) };
    });
    const result = await applyOperations(supabase, identity, operations);
    for (const entry of result) await audit(supabase, identity, role, "CALENDAR_SYSTEM_ITEM_UPDATE", "calendar_system_item", asText((entry.item as Json)?.itemId, 64), { bulk: true });
    return { count: result.length, items: result.map((entry) => entry.item) };
  }
  if (action === "admin.calendar.bulkArchive") {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BATCH_ITEMS) throw new ApiError(400, "INVALID_CALENDAR_BATCH", "批量移除必須是 1–20 筆。");
    const operations = body.items.map((raw) => {
      const item = raw && typeof raw === "object" ? raw as Json : {};
      return { action: "archive", itemId: requiredText(item.itemId, "itemId", 64), expectedUpdatedAt: requiredText(item.expectedUpdatedAt, "expectedUpdatedAt", 80) };
    });
    const result = await applyOperations(supabase, identity, operations);
    for (const entry of result) await audit(supabase, identity, role, "CALENDAR_SYSTEM_ITEM_ARCHIVE", "calendar_system_item", asText((entry.item as Json)?.itemId, 64), { bulk: true, softDelete: true });
    return { count: result.length, items: result.map((entry) => entry.item) };
  }

  if (action === "admin.users.list") {
    const { data, error } = await supabase.from("calendar_system_users").select("*").order("last_login_at", { ascending: false }).order("display_name", { ascending: true });
    if (error) throw mapError(error);
    return { users: (data || []).map((row: any) => ({
      lineUserId: row.line_user_id,
      displayName: row.display_name,
      status: row.status,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) };
  }
  if (action === "admin.users.updateStatus") {
    const lineUserId = requiredText(body.lineUserId, "lineUserId", 120);
    const status = requiredText(body.status, "status", 20).toLowerCase();
    if (!new Set(["active", "disabled"]).has(status)) throw new ApiError(400, "INVALID_USER_STATUS", "用戶使用權限狀態不合法。");
    const expectedUpdatedAt = requiredText(body.expectedUpdatedAt, "expectedUpdatedAt", 80);
    const current = await supabase.from("calendar_system_users").select("*").eq("line_user_id", lineUserId).single();
    if (current.error) throw new ApiError(404, "USER_NOT_FOUND", "找不到指定用戶。");
    if (String(current.data.updated_at) !== expectedUpdatedAt) throw new ApiError(409, "CONFLICT", "用戶權限已被其他管理員更新。");
    const now = new Date().toISOString();
    const updated = await supabase.from("calendar_system_users").update({ status, updated_at: now })
      .eq("id", current.data.id).eq("updated_at", expectedUpdatedAt).select("*").maybeSingle();
    if (updated.error) throw mapError(updated.error);
    if (!updated.data) throw new ApiError(409, "CONFLICT", "用戶權限已被其他管理員更新。");
    await audit(supabase, identity, role, "USER_ACCOUNT_STATUS_CHANGED", "calendar_system_user", lineUserId, { from: current.data.status, to: status });
    return { user: {
      lineUserId: updated.data.line_user_id,
      displayName: updated.data.display_name,
      status: updated.data.status,
      lastLoginAt: updated.data.last_login_at,
      createdAt: updated.data.created_at,
      updatedAt: updated.data.updated_at,
    } };
  }

  throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的 API action。");
}

function clientTypeForAction(action: string): ClientType {
  if (action.startsWith("user.")) return "user";
  if (action.startsWith("admin.")) return "admin";
  throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的 API action。");
}

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  try {
    if (origin && !allowedOrigins().has(origin)) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "此網站來源未被允許使用日曆 API。");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method === "GET") return json(origin, { ok: true, status: 200, data: { service: "CalendarSystem Supabase", version: "3.0.0" } });
    if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "不支援的 HTTP method。");

    const raw = await request.text();
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "Request body 大小不合法。");
    let body: Json;
    try { body = JSON.parse(raw); }
    catch (_) { throw new ApiError(400, "INVALID_JSON", "Request body 必須是 JSON。"); }
    if (!body || Array.isArray(body) || typeof body !== "object") throw new ApiError(400, "INVALID_REQUEST", "Request body 格式不合法。");

    const action = requiredText(body.action, "action", 80);
    const requestedClientType = asText(body.clientType, 20);
    const idToken = requiredText(body.idToken, "idToken", 10_000);
    const clientType = clientTypeForAction(action);
    if (requestedClientType && requestedClientType !== clientType) throw new ApiError(400, "CLIENT_TYPE_MISMATCH", "Client type 與 API action 不一致。");

    const identity = await verifyLineIdToken(idToken, clientType);
    const supabase = dbClient();
    await consumeRateLimit(supabase, identity, action, body);
    const data = await handleAction(supabase, identity, action, body);
    return json(origin, { ok: true, status: 200, data }, 200);
  } catch (error) {
    return errorResponse(origin, error);
  }
}

export default { fetch: handleRequest };
