export type TestModeIdentity = {
  lineUserId: string;
  displayName: string;
  memberId: string;
  adminLineUserId: string;
  isTestAccount: true;
};

export class TestModeAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveTestSession(
  supabase: any,
  rawToken: string,
): Promise<TestModeIdentity> {
  const token = String(rawToken || "").trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new TestModeAuthError(401, "TEST_SESSION_INVALID", "測試登入已失效，請重新由管理員登入。");
  }

  const tokenHash = await sha256Hex(token);
  const [settingsResult, sessionResult] = await Promise.all([
    supabase
      .from("test_mode_settings")
      .select("enabled,allow_admin_user_login")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("test_login_sessions")
      .select("id,admin_line_user_id,member_id,expires_at,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle(),
  ]);

  if (settingsResult.error || sessionResult.error) {
    throw new TestModeAuthError(503, "TEST_SESSION_UNAVAILABLE", "目前無法確認測試登入狀態。");
  }

  const settings = settingsResult.data;
  if (!settings?.enabled || !settings?.allow_admin_user_login) {
    throw new TestModeAuthError(403, "TEST_MODE_LOGIN_DISABLED", "目前未開放管理員測試登入。");
  }

  const session = sessionResult.data;
  const expiresAt = session?.expires_at ? new Date(session.expires_at).getTime() : 0;
  if (!session || session.revoked_at || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TestModeAuthError(401, "TEST_SESSION_EXPIRED", "測試登入已過期，請重新由管理員登入。");
  }

  const [memberResult, adminResult] = await Promise.all([
    supabase
      .from("members")
      .select("id,line_user_id,display_name,status,membership_status,is_test_account")
      .eq("id", session.member_id)
      .maybeSingle(),
    supabase
      .from("admins")
      .select("line_user_id,role,status")
      .eq("line_user_id", session.admin_line_user_id)
      .maybeSingle(),
  ]);

  if (memberResult.error || adminResult.error) {
    throw new TestModeAuthError(503, "TEST_SESSION_UNAVAILABLE", "目前無法確認測試登入狀態。");
  }

  const member = memberResult.data;
  const admin = adminResult.data;
  if (!admin || admin.role !== "admin" || admin.status !== "active") {
    throw new TestModeAuthError(403, "TEST_ADMIN_DISABLED", "管理員權限已失效，請重新登入。");
  }
  if (
    !member
    || member.is_test_account !== true
    || member.status !== "active"
    || member.membership_status !== "active"
  ) {
    throw new TestModeAuthError(403, "TEST_ACCOUNT_UNAVAILABLE", "選擇的測試帳號目前無法使用。");
  }

  const touch = await supabase
    .from("test_login_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id)
    .is("revoked_at", null);
  if (touch.error) {
    throw new TestModeAuthError(503, "TEST_SESSION_UNAVAILABLE", "目前無法更新測試登入狀態。");
  }

  return {
    lineUserId: String(member.line_user_id),
    displayName: String(member.display_name || "測試會員"),
    memberId: String(member.id),
    adminLineUserId: String(session.admin_line_user_id),
    isTestAccount: true,
  };
}

export async function resolveUserTestIdentity(
  supabase: any,
  rawToken: string,
): Promise<TestModeIdentity | null> {
  const settingsResult = await supabase
    .from("test_mode_settings")
    .select("enabled,maintenance_message")
    .eq("id", true)
    .maybeSingle();

  if (settingsResult.error) {
    throw new TestModeAuthError(503, "TEST_MODE_CHECK_FAILED", "目前無法確認系統維護狀態。");
  }

  if (!settingsResult.data?.enabled) return null;

  const token = String(rawToken || "").trim();
  if (!token) {
    throw new TestModeAuthError(
      503,
      "SYSTEM_MAINTENANCE",
      String(settingsResult.data?.maintenance_message || "").trim() || "系統維護中，請稍後再試。",
    );
  }

  return await resolveTestSession(supabase, token);
}
