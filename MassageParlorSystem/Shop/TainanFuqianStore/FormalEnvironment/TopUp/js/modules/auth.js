import { config } from "./config.js";
import { apiPost } from "./api.js";
import { state } from "./state.js";
import { dom } from "./dom.js";
import { getQueryParam } from "./core.js";
import { showGate } from "./ui.js";

function setIdentity_(userId, displayName) {
  state.me.userId = String(userId || "").trim();
  state.me.displayName = String(displayName || "").trim();
  try {
    localStorage.setItem("userId", state.me.userId);
    localStorage.setItem("displayName", state.me.displayName);
  } catch (_) {}
}

function getFallbackIdentity_() {
  const qUserId = String(getQueryParam("userId") || getQueryParam("userid") || "").trim();
  const qName = String(getQueryParam("name") || getQueryParam("displayName") || "").trim();
  if (qUserId) return { userId: qUserId, displayName: qName || "" };

  try {
    const lsUserId = String(localStorage.getItem("userId") || "").trim();
    const lsName = String(localStorage.getItem("displayName") || "").trim();
    if (lsUserId) return { userId: lsUserId, displayName: lsName || "" };
  } catch (_) {}

  return { userId: config.DEBUG_USER_ID || "dev_user", displayName: config.DEBUG_DISPLAY_NAME || "測試使用者" };
}

export async function initAuthAndGuard() {
  try {
    showGate("登入 / 權限檢查中…");

    if (config.USE_LIFF) {
      await liff.init({ liffId: config.LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login();
        return { ok: false, redirected: true };
      }

      const profile = await liff.getProfile();
      setIdentity_(profile.userId, profile.displayName);
    } else {
      const fb = getFallbackIdentity_();
      setIdentity_(fb.userId, fb.displayName);
    }

    if (!state.me.userId) throw new Error("missing userId");

    const ret = await apiPost({
      mode: "adminUpsertAndCheck",
      userId: state.me.userId,
      displayName: state.me.displayName,
    });

    if (!ret?.ok) throw new Error(ret?.error || "adminUpsertAndCheck failed");

    state.me.audit = String(ret.audit || ret.user?.audit || "");
    if (dom.authText) dom.authText.textContent = `${state.me.displayName || "使用者"}（${state.me.audit || "—"}）`;

    const allowed = ret.allowed === true || String(state.me.audit) === "通過";
    if (!allowed) {
      showGate(`尚未通過審核（目前：${state.me.audit || "—"}）\n\n請由管理員將你的狀態改為「通過」。`, true);
      return { ok: false, blocked: true };
    }

    return { ok: true, userId: state.me.userId, displayName: state.me.displayName, audit: state.me.audit };
  } catch (e) {
    console.error(e);
    showGate("⚠ 權限檢查失敗\n" + String(e.message || e), true);
    return { ok: false, error: String(e.message || e) };
  }
}
