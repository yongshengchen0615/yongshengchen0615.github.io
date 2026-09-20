export type TestModeIdentity = {
  lineUserId: string;
  displayName: string;
  memberId: string;
  isTestAccount: true;
};

export type TestDeviceClass = "pc" | "mobile";

function maintenanceMessage(settings: any): string {
  return String(settings?.maintenance_message || "").trim() || "系統維護中，請稍後再試。";
}

function deviceLoginAllowed(settings: any, deviceClass: TestDeviceClass): boolean {
  return deviceClass === "mobile"
    ? settings?.allow_mobile_test_login === true
    : settings?.allow_pc_test_login === true;
}

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
    throw new TestModeAuthError(401, "TEST_SESSION_INVALID", "測試登入已失效，請重新選擇測試帳號。");
  }

  const tokenHash = await sha256Hex(token);
  const [settingsResult, sessionResult] = await Promise.all([
    supabase
      .from("test_mode_settings")
      .select("enabled,maintenance_enabled,allow_pc_test_login,allow_mobile_test_login,maintenance_message")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("test_login_sessions")
      .select("id,member_id,device_class,expires_at,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle(),
  ]);

  if (settingsResult.error || sessionResult.error) {
    throw new TestModeAuthError(503, "TEST_SESSION_UNAVAILABLE", "目前無法確認測試登入狀態。");
  }

  if (!settingsResult.data?.maintenance_enabled) {
    throw new TestModeAuthError(403, "TEST_MODE_LOGIN_DISABLED", "目前未啟用系統維護測試登入。");
  }
  if (!settingsResult.data?.enabled) {
    throw new TestModeAuthError(503, "SYSTEM_MAINTENANCE", maintenanceMessage(settingsResult.data));
  }

  const session = sessionResult.data;
  const deviceClass = session?.device_class === "mobile"
    ? "mobile"
    : session?.device_class === "pc"
      ? "pc"
      : null;
  if (!deviceClass) {
    throw new TestModeAuthError(401, "TEST_SESSION_INVALID", "測試登入已失效，請重新選擇測試帳號。");
  }
  if (!deviceLoginAllowed(settingsResult.data, deviceClass)) {
    throw new TestModeAuthError(503, "SYSTEM_MAINTENANCE", maintenanceMessage(settingsResult.data));
  }
  const expiresAt = session?.expires_at ? new Date(session.expires_at).getTime() : 0;
  if (!session || session.revoked_at || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TestModeAuthError(401, "TEST_SESSION_EXPIRED", "測試登入已過期，請重新選擇測試帳號。");
  }

  const memberResult = await supabase
    .from("members")
    .select("id,line_user_id,display_name,status,membership_status,is_test_account")
    .eq("id", session.member_id)
    .maybeSingle();

  if (memberResult.error) {
    throw new TestModeAuthError(503, "TEST_SESSION_UNAVAILABLE", "目前無法確認測試登入狀態。");
  }

  const member = memberResult.data;
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
    isTestAccount: true,
  };
}

export async function resolveUserTestIdentity(
  supabase: any,
  rawToken: string,
): Promise<TestModeIdentity | null> {
  const settingsResult = await supabase
    .from("test_mode_settings")
    .select("enabled,maintenance_enabled,allow_pc_test_login,allow_mobile_test_login,maintenance_message")
    .eq("id", true)
    .maybeSingle();

  if (settingsResult.error) {
    throw new TestModeAuthError(503, "TEST_MODE_CHECK_FAILED", "目前無法確認系統維護狀態。");
  }

  if (!settingsResult.data?.maintenance_enabled) return null;
  if (!settingsResult.data?.enabled) {
    throw new TestModeAuthError(503, "SYSTEM_MAINTENANCE", maintenanceMessage(settingsResult.data));
  }

  const token = String(rawToken || "").trim();
  if (!token) {
    throw new TestModeAuthError(503, "SYSTEM_MAINTENANCE", maintenanceMessage(settingsResult.data));
  }

  return await resolveTestSession(supabase, token);
}
