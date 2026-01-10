import { config } from "./config.js";
import { checkMasterAdminAccess } from "./api.js";

function getLiff_() {
  return typeof window !== "undefined" ? window.liff : null;
}

export async function initLiffLoginAndCheckAccess({ setStatusText }) {
  const liffId = String(config.LIFF_ID || "").trim();
  if (!liffId) {
    throw new Error("CONFIG_LIFF_ID_REQUIRED");
  }

  const liff = getLiff_();
  if (!liff) {
    throw new Error("LIFF_SDK_NOT_LOADED");
  }

  setStatusText?.("LINE 登入初始化中…");
  await liff.init({ liffId });

  if (!liff.isLoggedIn()) {
    setStatusText?.("導向 LINE 登入中…");
    liff.login();
    return { ok: false, redirected: true };
  }

  setStatusText?.("讀取 LINE 使用者資料中…");
  const profile = await liff.getProfile();
  const userId = String(profile?.userId || "").trim();
  const displayName = String(profile?.displayName || "").trim();
  if (!userId) throw new Error("LIFF_NO_USER_ID");

  setStatusText?.("權限驗證中…");
  const res = await checkMasterAdminAccess({
    masterId: String(config.MASTER_ID || "").trim(),
    userId,
    displayName,
  });

  if (!res || res.ok !== true) {
    throw new Error(res?.error || res?.err || "AUTH_CHECK_FAILED");
  }

  return {
    ok: true,
    allowed: !!res.allowed,
    reason: String(res.reason || "").trim(),
    userId,
    displayName,
    user: res.user || null,
    raw: res,
  };
}
