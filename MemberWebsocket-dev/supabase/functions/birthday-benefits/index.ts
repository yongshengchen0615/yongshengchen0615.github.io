import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function asText(value: unknown, max = 1000): string {
  return String(value ?? "").trim().slice(0, max);
}

function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ApiError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

function reply(origin: string | null, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

async function verifyAdmin(
  supabase: SupabaseClient,
  idToken: string,
): Promise<{ lineUserId: string; displayName: string }> {
  if (!idToken) throw new ApiError(401, "AUTH_REQUIRED", "請先使用 LINE 管理端登入。");
  const channelId = env("LINE_ADMIN_CHANNEL_ID") || "2010791619";
  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
  } catch {
    throw new ApiError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }

  const payload: Json = await response.json().catch(() => ({}));
  const sub = asText(payload.sub, 120);
  const aud = asText(payload.aud, 60);
  const iss = asText(payload.iss, 100);
  const exp = Number(payload.exp || 0);
  if (!response.ok || !sub || aud !== channelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new ApiError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }

  const admin = await supabase.from("admins").select("role,status").eq("line_user_id", sub).maybeSingle();
  if (admin.error) throw new ApiError(500, "DATABASE_ERROR", "無法確認管理員權限。");
  if (!admin.data || admin.data.status !== "active" || admin.data.role !== "admin") {
    throw new ApiError(403, "ADMIN_REQUIRED", "此功能僅限已授權管理員使用。");
  }

  return { lineUserId: sub, displayName: asText(payload.name || "管理員", 120) };
}

function normalizeTiers(value: unknown): string[] {
  const allowed = ["general", "silver", "gold", "platinum"];
  const values = Array.isArray(value)
    ? value.map((item) => asText(item, 20)).filter((item) => allowed.includes(item))
    : [];
  return [...new Set(values)];
}

function validateSettings(input: Json): Json {
  const titleTemplate = asText(input.titleTemplate, 100);
  const description = asText(input.description, 240);
  const usageMethod = asText(input.usageMethod, 120);
  const usageInstructions = asText(input.usageInstructions, 500);
  const accent = asText(input.accent, 20).toLowerCase();
  const allowedTierKeys = normalizeTiers(input.allowedTierKeys);

  if (!titleTemplate || !description || !usageMethod || !usageInstructions) {
    throw new ApiError(400, "INVALID_INPUT", "壽星優惠名稱、說明與使用規則不可空白。");
  }
  if (!/^#[0-9a-f]{6}$/.test(accent)) throw new ApiError(400, "INVALID_ACCENT", "識別色格式不正確。");
  if (!allowedTierKeys.length) throw new ApiError(400, "INVALID_TIERS", "請至少選擇一個適用會員等級。");

  return {
    enabled: Boolean(input.enabled),
    title_template: titleTemplate,
    description,
    usage_method: usageMethod,
    usage_instructions: usageInstructions,
    accent,
    allowed_tier_keys: allowedTierKeys,
    notify_line: Boolean(input.notifyLine),
  };
}

async function settingsPayload(supabase: SupabaseClient): Promise<Json> {
  const result = await supabase.from("birthday_benefit_settings").select("*").eq("singleton", true).single();
  if (result.error) throw new ApiError(500, "DATABASE_ERROR", "壽星優惠設定暫時無法讀取。");
  const row = result.data;

  const taipeiDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month] = taipeiDate.split("-").map(Number);
  const grants = await supabase
    .from("birthday_benefit_grants")
    .select("id,status,notified_at,created_at", { count: "exact" })
    .eq("benefit_year", year)
    .eq("benefit_month", month);

  return {
    settings: {
      enabled: row.enabled,
      titleTemplate: row.title_template,
      description: row.description,
      usageMethod: row.usage_method,
      usageInstructions: row.usage_instructions,
      accent: row.accent,
      allowedTierKeys: row.allowed_tier_keys,
      notifyLine: row.notify_line,
      updatedAt: row.updated_at,
    },
    current: { year, month, issuedCount: grants.count || 0 },
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return reply(origin, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "只支援 POST。" } }, 405);
  if (origin && !allowedOrigins().has(origin)) return reply(origin, { ok: false, error: { code: "ORIGIN_DENIED", message: "不允許的來源。" } }, 403);

  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 20_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "請求內容過大。");
    const body: Json = await request.json().catch(() => ({}));
    const action = asText(body.action, 80);
    const supabase = dbClient();
    const identity = await verifyAdmin(supabase, asText(body.idToken, 10_000));

    if (action === "admin.birthday-benefit.get") {
      return reply(origin, { ok: true, data: await settingsPayload(supabase) });
    }

    if (action === "admin.birthday-benefit.save") {
      const patch = validateSettings((body.settings && typeof body.settings === "object" ? body.settings : {}) as Json);
      const result = await supabase
        .from("birthday_benefit_settings")
        .update({ ...patch, updated_by: identity.lineUserId, updated_at: new Date().toISOString() })
        .eq("singleton", true);
      if (result.error) throw new ApiError(500, "DATABASE_ERROR", "壽星優惠設定暫時無法儲存。");

      await supabase.from("audit_logs").insert({
        audit_id: "AUD-" + crypto.randomUUID().replaceAll("-", ""),
        actor_line_user_id: identity.lineUserId,
        actor_role: "admin",
        action: "admin.birthday-benefit.save",
        target_type: "birthday_benefit_settings",
        target_id: "singleton",
        result: "success",
        detail: {
          enabled: patch.enabled,
          notifyLine: patch.notify_line,
          allowedTierKeys: patch.allowed_tier_keys,
        },
      });
      return reply(origin, { ok: true, data: await settingsPayload(supabase) });
    }

    if (action === "admin.birthday-benefit.run") {
      const run = await supabase.rpc("issue_birthday_benefits");
      if (run.error) throw new ApiError(500, "ISSUE_FAILED", "壽星優惠發放失敗，請稍後再試。");
      await supabase.from("audit_logs").insert({
        audit_id: "AUD-" + crypto.randomUUID().replaceAll("-", ""),
        actor_line_user_id: identity.lineUserId,
        actor_role: "admin",
        action: "admin.birthday-benefit.run",
        target_type: "birthday_benefit",
        target_id: "current-month",
        result: "success",
        detail: run.data,
      });
      return reply(origin, { ok: true, data: { run: run.data, ...await settingsPayload(supabase) } });
    }

    throw new ApiError(404, "ACTION_NOT_FOUND", "不支援的壽星優惠操作。");
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL_ERROR", "壽星優惠服務暫時無法完成操作。");
    return reply(origin, { ok: false, error: { code: apiError.code, message: apiError.message } }, apiError.status);
  }
});
