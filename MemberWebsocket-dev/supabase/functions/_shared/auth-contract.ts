export type ContractIdentity = { lineUserId: string; displayName: string; issuedAtMs: number };

type ErrorFactory = (status: number, code: string, message: string, details?: unknown) => Error;

export async function verifyLineIdTokenContract(args: {
  idToken: string;
  expectedChannelId: string;
  createError: ErrorFactory;
}): Promise<ContractIdentity> {
  const { idToken, expectedChannelId, createError } = args;
  if (!idToken) throw createError(401, "AUTH_REQUIRED", "請先使用 LINE 登入。");

  let response: Response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: expectedChannelId }),
    });
  } catch {
    throw createError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }

  let payload: Record<string, unknown>;
  try {
    payload = await response.json();
  } catch {
    throw createError(503, "LINE_AUTH_UNAVAILABLE", "LINE 身分驗證服務暫時無法使用。");
  }

  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud.trim() : "";
  const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const exp = Number(payload.exp || 0);
  const iat = Number(payload.iat || 0);
  if (!response.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now() || !Number.isFinite(iat) || iat <= 0) {
    throw createError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }

  const identity = {
    lineUserId: sub,
    displayName: String(payload.name || "LINE 使用者").slice(0, 120),
    issuedAtMs: iat * 1000,
  };

  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) throw createError(503, "SUPABASE_CONFIG_MISSING", "Supabase server 設定尚未完成。");

  const { createClient } = await import("npm:@supabase/supabase-js@2.57.0");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [settingsResult, adminResult, memberResult] = await Promise.all([
    supabase.from("test_mode_settings").select("maintenance_enabled,maintenance_message,maintenance_revoked_after").eq("id", true).maybeSingle(),
    supabase.from("admins").select("role,status").eq("line_user_id", sub).maybeSingle(),
    supabase.from("members").select("force_logout_after").eq("line_user_id", sub).maybeSingle(),
  ]);
  if (settingsResult.error || adminResult.error || memberResult.error) {
    throw createError(503, "ACCESS_CONTROL_UNAVAILABLE", "目前無法確認會員存取狀態。");
  }

  const isActiveAdmin = adminResult.data?.role === "admin" && adminResult.data?.status === "active";
  if (!isActiveAdmin && settingsResult.data?.maintenance_enabled === true) {
    throw createError(503, "SYSTEM_MAINTENANCE", String(settingsResult.data?.maintenance_message || "").trim() || "系統維護中，請稍後再試。");
  }

  const memberRevokedAtMs = memberResult.data?.force_logout_after ? new Date(memberResult.data.force_logout_after).getTime() : 0;
  const maintenanceRevokedAtMs = settingsResult.data?.maintenance_revoked_after ? new Date(settingsResult.data.maintenance_revoked_after).getTime() : 0;
  const revokedAtMs = Math.max(
    Number.isFinite(memberRevokedAtMs) ? memberRevokedAtMs : 0,
    Number.isFinite(maintenanceRevokedAtMs) ? maintenanceRevokedAtMs : 0,
  );
  if (!isActiveAdmin && revokedAtMs > 0 && identity.issuedAtMs <= revokedAtMs) {
    throw createError(401, "SESSION_REVOKED", "您的登入工作階段已結束，請重新登入。");
  }

  return identity;
}

export async function requireActiveAdminContract(args: {
  supabase: any;
  identity: { lineUserId: string; displayName?: string };
  createError: ErrorFactory;
}): Promise<any> {
  const { supabase, identity, createError } = args;
  let result = await supabase.from("admins").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
  if (result.error) throw createError(500, "DATABASE_ERROR", "目前無法確認管理端權限。");
  let admin = result.data;

  if (!admin) {
    const inserted = await supabase.from("admins").insert({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      role: "none",
      status: "pending",
    }).select("*").single();

    if (inserted.error) {
      result = await supabase.from("admins").select("*").eq("line_user_id", identity.lineUserId).maybeSingle();
      if (result.error || !result.data) throw createError(500, "DATABASE_ERROR", "目前無法建立管理端授權紀錄。");
      admin = result.data;
    } else {
      admin = inserted.data;
    }
  }

  if (admin.role !== "admin" || admin.status !== "active") {
    // Client-visible authorization errors must not echo the LINE user id or other identity PII.
    throw createError(403, "ADMIN_PENDING", "管理端帳號尚未授權。");
  }

  if (identity.displayName && admin.display_name !== identity.displayName) {
    await supabase.from("admins").update({
      display_name: identity.displayName,
      updated_at: new Date().toISOString(),
    }).eq("id", admin.id);
    admin.display_name = identity.displayName;
  }
  return admin;
}
