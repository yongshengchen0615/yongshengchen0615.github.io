export type ContractIdentity = { lineUserId: string; displayName: string };

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
  if (!response.ok || !sub || aud !== expectedChannelId || iss !== "https://access.line.me" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw createError(401, "AUTH_INVALID", "LINE 登入已失效，請重新登入。");
  }

  return {
    lineUserId: sub,
    displayName: String(payload.name || "LINE 使用者").slice(0, 120),
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
