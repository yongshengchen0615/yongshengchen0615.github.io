export type ContractIdentity = { lineUserId: string; displayName: string; issuedAt: number };

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
  const now = Date.now();
  if (
    !response.ok
    || !sub
    || aud !== expectedChannelId
    || iss !== "https://access.line.me"
    || !Number.isFinite(exp)
    || exp * 1000 <= now
    || !Number.isFinite(iat)
    || iat <= 0
    || iat * 1000 > now + 5 * 60 * 1000
  ) {
    throw createError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }

  return {
    lineUserId: sub,
    displayName: String(payload.name || "LINE 使用者").slice(0, 120),
    issuedAt: iat,
  };
}

export async function requireActiveAdminContract(args: {
  supabase: any;
  identity: ContractIdentity;
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


export async function requireMemberAccessContract(args: {
  supabase: any;
  identity: ContractIdentity;
  createError: ErrorFactory;
}): Promise<any | null> {
  const { supabase, identity, createError } = args;
  const [settingsResult, memberResult] = await Promise.all([
    supabase
      .from("test_mode_settings")
      .select("maintenance_enabled,maintenance_message")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("members")
      .select("id,line_user_id,session_revoked_before")
      .eq("line_user_id", identity.lineUserId)
      .maybeSingle(),
  ]);

  if (settingsResult.error || memberResult.error) {
    throw createError(503, "MEMBER_ACCESS_UNAVAILABLE", "目前無法確認會員存取狀態。");
  }

  if (settingsResult.data?.maintenance_enabled === true) {
    const message = String(settingsResult.data.maintenance_message || "").trim().slice(0, 500);
    throw createError(503, "SYSTEM_MAINTENANCE", message || "系統維護中，請稍後再試。");
  }

  const member = memberResult.data;
  const revokedBefore = member?.session_revoked_before
    ? new Date(member.session_revoked_before).getTime()
    : 0;
  const issuedAtMs = Number(identity.issuedAt || 0) * 1000;
  if (
    member
    && Number.isFinite(revokedBefore)
    && revokedBefore > 0
    && (!Number.isFinite(issuedAtMs) || issuedAtMs <= revokedBefore)
  ) {
    throw createError(401, "SESSION_REVOKED", "您的登入工作階段已由管理員結束，請重新登入。");
  }

  return member || null;
}
