/**
 * topup.js
 *
 * Scheduling 端的「儲值序號」整合：
 * - 呼叫 TopUp GAS（mode=serials_redeem_public）核銷序號 → 取得 amount
 * - 將 amount 視為「增加的使用天數」
 * - 呼叫 AUTH GAS（mode=check / updateuser）把天數寫回 Users
 * - 成功後更新 usage banner
 */

import { config } from "./config.js";
import { state } from "./state.js";
import { showLoadingHint, hideLoadingHint, updateUsageBanner, showGate } from "./uiHelpers.js";

function postTextPlainJson_(url, bodyObj) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj || {}),
  })
    .then((r) => r.json())
    .catch(() => ({ ok: false, error: "INVALID_JSON" }));
}

// 注意：測試環境會用 local_dev 等非 LINE userId。
// 需求：只要有 userId 就可以儲值 → 需要 TopUp GAS 部署版本放寬驗證（見 TopUp/gas/TOPUP_API_URL.gs）。

async function authCheck_(userId, displayName) {
  const url =
    config.AUTH_API_URL +
    "?mode=check&userId=" +
    encodeURIComponent(userId) +
    "&displayName=" +
    encodeURIComponent(displayName || "");
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("AUTH_CHECK_HTTP_" + resp.status);
  return await resp.json();
}

async function authUpdateUser_(payload) {
  // 注意：AUTH 的 updateuser 若沒帶 personalStatusEnabled/scheduleEnabled... 會被重設為「否」
  // 因此這裡務必帶上 check 回傳的既有值。
  const ret = await postTextPlainJson_(config.AUTH_API_URL, { mode: "updateuser", ...(payload || {}) });
  if (!ret || ret.ok !== true) throw new Error(ret?.error || "AUTH_UPDATEUSER_FAILED");
  return ret;
}

function yyyyMmDdTpe_() {
  // Scheduling 端目前沒有 tz helper；以使用者裝置當地日期即可（AUTH 端會 parse loose）。
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getIdentitySync_() {
  // 1) state（auth.js 會落地到 state.user / state.userId）
  let userId = String(state?.user?.userId || state?.userId || "").trim();
  let displayName = String(state?.user?.displayName || state?.displayName || "").trim();

  // 2) window（auth.js 也會寫到 window.currentUserId）
  if (!userId) userId = String(window.currentUserId || "").trim();
  if (!displayName) displayName = String(window.currentDisplayName || "").trim();

  // 3) localStorage（避免 Gate 狀態/某些模組順序導致 state 尚未就緒）
  try {
    if (!userId) userId = String(localStorage.getItem("userId") || "").trim();
    if (!displayName) displayName = String(localStorage.getItem("displayName") || "").trim();
  } catch (_) {}

  return { userId, displayName };
}

async function ensureIdentity_() {
  const base = getIdentitySync_();
  if (base.userId) return base;

  // 4) LIFF profile（最後手段）
  try {
    if (window.liff && typeof window.liff.isLoggedIn === "function" && window.liff.isLoggedIn()) {
      const p = await window.liff.getProfile();
      const userId = String(p?.userId || "").trim();
      const displayName = String(p?.displayName || "").trim();
      if (userId) {
        state.user = state.user || {};
        state.user.userId = userId;
        state.user.displayName = displayName;
        state.userId = userId;
        state.displayName = displayName;
        try {
          localStorage.setItem("userId", userId);
          localStorage.setItem("displayName", displayName);
        } catch (_) {}
        window.currentUserId = userId;
        window.currentDisplayName = displayName;
        return { userId, displayName };
      }
    }
  } catch (_) {}

  return base;
}

export function isTopupEnabled() {
  return !!String(config.TOPUP_API_URL || "").trim();
}

/**
 * 儲值主流程（可在 Gate 或 App 內呼叫）。
 * @param {object} opts
 * @param {"gate"|"app"} [opts.context]
 * @param {boolean} [opts.reloadOnSuccess] Gate 情境建議 true
 */
export async function runTopupFlow({ context = "app", reloadOnSuccess = false } = {}) {
  if (!isTopupEnabled()) {
    if (context === "gate") showGate("⚠ 尚未設定 TOPUP_API_URL，無法使用儲值功能。", true);
    else alert("尚未設定 TOPUP_API_URL，無法使用儲值功能。");
    return { ok: false, error: "TOPUP_DISABLED" };
  }

  const identity = await ensureIdentity_();
  const userIdSafe = String(identity.userId || "").trim();
  const displayNameSafe = String(identity.displayName || "").trim();

  // Debug: help diagnose USER_ID_REQUIRED reported from TopUp GAS
  try {
    console.log("[TopUp] identity", {
      userId: userIdSafe,
      displayName: displayNameSafe,
      stateUserId: String(state?.user?.userId || state?.userId || "").trim(),
      windowCurrentUserId: String(window.currentUserId || "").trim(),
      localStorageUserId: (() => {
        try {
          return String(localStorage.getItem("userId") || "").trim();
        } catch (_) {
          return "";
        }
      })(),
    });
  } catch (_) {}

  if (!userIdSafe) {
    if (context === "gate") showGate("⚠ 無法取得 userId，請重新登入後再試。", true);
    else alert("無法取得 userId，請重新登入後再試。");
    return { ok: false, error: "MISSING_USER_ID" };
  }

  const serial = (prompt("請輸入儲值序號", "") ?? "").trim();
  if (!serial) return { ok: false, cancelled: true };

  showLoadingHint("儲值核銷中…");
  try {
    // 1) redeem serial → amount
    const redeemPayload = {
      mode: "serials_redeem_public",
      serial,
      // 只要有 userId 就可以儲值（含 local_dev）
      userId: userIdSafe,
      userID: userIdSafe, // compat
      uid: userIdSafe, // compat
      displayName: displayNameSafe,
      user: { userId: userIdSafe, displayName: displayNameSafe }, // compat
      note: `Scheduling|origUserId=${encodeURIComponent(userIdSafe)}`,
    };
    const redeem = await postTextPlainJson_(config.TOPUP_API_URL, redeemPayload);
    if (!redeem || redeem.ok !== true) {
      const e = new Error(redeem?.error || "REDEEM_FAILED");
      // attach some debug context (won't be sent to server)
      e.details = { userId: userIdSafe, hasDisplayName: !!displayNameSafe };
      throw e;
    }

    const amount = Number(redeem.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");

    // 2) read current auth status (contains remainingDays & feature flags)
    const check = await authCheck_(userIdSafe, displayNameSafe);
    const currentRd = Number(check?.remainingDays);
    const currentRemainingDays = Number.isFinite(currentRd) ? currentRd : 0;

    // 規則：TopUp 的 amount 直接視為「增加天數」
    const addDays = Math.floor(amount);
    const newRemainingDays = currentRemainingDays + addDays;

    // 3) write back to AUTH Users
    // remainingDays = usageDays - 1 (when startDate=today) → usageDays = remainingDays + 1
    const usageDays = Math.max(1, Math.floor(newRemainingDays) + 1);
    const startDate = yyyyMmDdTpe_();

    await authUpdateUser_({
      userId: userIdSafe,
      audit: check?.audit,
      masterCode: check?.masterCode,
      pushEnabled: check?.pushEnabled,
      personalStatusEnabled: check?.personalStatusEnabled,
      scheduleEnabled: check?.scheduleEnabled,
      performanceEnabled: check?.performanceEnabled,
      startDate,
      usageDays,
    });

    // 4) verify + update banner
    const check2 = await authCheck_(userIdSafe, displayNameSafe);
    updateUsageBanner(check2?.displayName || displayNameSafe, check2?.remainingDays);

    hideLoadingHint();

    const msg = `儲值成功\n\n序號：${serial}\n增加天數：${addDays} 天`;
    if (reloadOnSuccess) {
      alert(msg + "\n\n將重新整理以重新驗證權限。");
      location.reload();
      return { ok: true, reloaded: true };
    }

    alert(msg);
    return { ok: true, addDays, newRemainingDays };
  } catch (e) {
    console.error("[TopUp] failed:", e);
    hideLoadingHint();
    let errMsg = String(e?.message || e || "儲值失敗");
    if (errMsg === "USER_ID_REQUIRED") {
      errMsg = "USER_ID_REQUIRED（TopUp 收到的 userId 是空的）\n" + "目前本機計算 userId=" + (userIdSafe || "(empty)");
    }
    if (context === "gate") showGate("⚠ 儲值失敗\n" + errMsg, true);
    else alert("儲值失敗：" + errMsg);
    return { ok: false, error: errMsg };
  }
}
