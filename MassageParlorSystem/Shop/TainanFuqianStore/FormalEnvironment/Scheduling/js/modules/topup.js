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
import { updateFeatureState } from "./featureBanner.js";
import { logUsageEvent } from "./usageLog.js";

function safeOneLine_(s, maxLen = 240) {
  const v = String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
  if (!v) return "";
  return v.length > maxLen ? v.slice(0, maxLen) + "…" : v;
}

function fireTopupEvent_({ event, userId, displayName, detailObj, detailText, eventCn }) {
  try {
    const detail = detailText
      ? safeOneLine_(detailText)
      : detailObj
        ? safeOneLine_(JSON.stringify(detailObj))
        : "";
    logUsageEvent({
      event,
      userId,
      displayName,
      detail,
      noThrottle: true,
      eventCn: eventCn || "儲值",
    }).catch(() => {});
  } catch (_) {}
}

const TOPUP_FETCH_TIMEOUT_MS = 12000;
const AUTH_FETCH_TIMEOUT_MS = 12000;

async function fetchJsonWithTimeout_(url, fetchInit, timeoutMs, invalidJsonError) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  let ctrl = null;
  let t = null;

  try {
    if (typeof AbortController !== "undefined" && ms > 0) {
      ctrl = new AbortController();
      t = setTimeout(() => {
        try {
          ctrl.abort();
        } catch (_) {}
      }, ms);
    }

    const init = ctrl ? { ...(fetchInit || {}), signal: ctrl.signal } : (fetchInit || {});
    const resp = await fetch(url, init);
    const data = await resp.json().catch(() => ({ ok: false, error: invalidJsonError || "INVALID_JSON" }));
    // 讓呼叫端可以依需要處理 HTTP code（目前仍以 data.ok 為主）
    data.__httpOk = resp.ok;
    data.__httpStatus = resp.status;
    return data;
  } catch (e) {
    // AbortController aborted
    const msg = String(e?.name || "") === "AbortError" ? "TIMEOUT" : String(e?.message || e || "FETCH_FAILED");
    return { ok: false, error: msg };
  } finally {
    if (t) clearTimeout(t);
  }
}

function postTextPlainJson_(url, bodyObj) {
  return fetchJsonWithTimeout_(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyObj || {}),
    },
    TOPUP_FETCH_TIMEOUT_MS,
    "INVALID_JSON"
  );
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
  const ret = await fetchJsonWithTimeout_(
    url,
    { method: "GET", cache: "no-store" },
    AUTH_FETCH_TIMEOUT_MS,
    "INVALID_JSON"
  );
  if (!ret || ret.ok !== true) {
    const suffix = ret && ret.__httpStatus ? "_" + ret.__httpStatus : "";
    throw new Error((ret && ret.error ? String(ret.error) : "AUTH_CHECK_FAILED") + suffix);
  }
  return ret;
}

async function authUpdateUser_(payload) {
  // 注意：AUTH 的 updateuser 若沒帶 personalStatusEnabled/scheduleEnabled... 會被重設為「否」
  // 因此這裡務必帶上 check 回傳的既有值。
  const ret = await fetchJsonWithTimeout_(
    config.AUTH_API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "updateuser", ...(payload || {}) }),
    },
    AUTH_FETCH_TIMEOUT_MS,
    "INVALID_JSON"
  );
  if (!ret || ret.ok !== true) throw new Error(ret?.error || "AUTH_UPDATEUSER_FAILED");
  return ret;
}

function isYes_(v) {
  if (v === true || v === 1 || v === "1") return true;
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (s === "是") return true;
  const sl = s.toLowerCase();
  return sl === "true" || sl === "y" || sl === "yes" || sl === "on";
}

function pickRedeemFlagTri_(redeem, key) {
  if (!redeem) return null;
  let v = redeem[key];
  if (v === undefined && redeem.features && typeof redeem.features === "object") v = redeem.features[key];
  if (v === undefined || v === null || v === "") return null;

  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;

  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s === "是") return true;
  if (s === "否") return false;
  const sl = s.toLowerCase();
  if (sl === "true" || sl === "y" || sl === "yes" || sl === "on") return true;
  if (sl === "false" || sl === "n" || sl === "no" || sl === "off") return false;
  return null;
}

function normalizeSyncEnabled_(redeem) {
  if (!redeem) return true;
  let v = redeem.syncEnabled;
  if (v === undefined && redeem.features && typeof redeem.features === "object") v = redeem.features.syncEnabled;
  // Backward compatible default: treat missing as enabled
  if (v === undefined || v === null || v === "") return true;

  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;

  const s = String(v ?? "").trim();
  if (!s) return true;
  if (s === "是") return true;
  if (s === "否") return false;
  const sl = s.toLowerCase();
  if (sl === "true" || sl === "y" || sl === "yes" || sl === "on") return true;
  if (sl === "false" || sl === "n" || sl === "no" || sl === "off") return false;
  return true;
}

function mergeYesNo_(currentYesNo, redeemTri) {
  if (redeemTri === null) return isYes_(currentYesNo) ? "是" : "否";
  return redeemTri ? "是" : "否";
}

function yyyyMmDdTpe_() {
  // Scheduling 端目前沒有 tz helper；以使用者裝置當地日期即可（AUTH 端會 parse loose）。
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yyyyMmDdAddDays_(baseKey, deltaDays) {
  const key = String(baseKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return yyyyMmDdTpe_();
  const [y, m, d] = key.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  const add = Number(deltaDays) || 0;
  dt.setDate(dt.getDate() + add);
  const pad = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
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

  // 使用者主動點擊進來的入口（gate/app）
  if (userIdSafe) {
    fireTopupEvent_({
      event: "topup_open",
      userId: userIdSafe,
      displayName: displayNameSafe,
      detailObj: { context, reloadOnSuccess: !!reloadOnSuccess },
      eventCn: "儲值開啟",
    });
  }

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
  if (!serial) {
    fireTopupEvent_({
      event: "topup_cancel",
      userId: userIdSafe,
      displayName: displayNameSafe,
      detailObj: { context, reason: "empty_or_cancel" },
      eventCn: "儲值取消",
    });
    return { ok: false, cancelled: true };
  }

  fireTopupEvent_({
    event: "topup_submit",
    userId: userIdSafe,
    displayName: displayNameSafe,
    detailObj: { context, serialLen: serial.length },
    eventCn: "儲值送出",
  });

  showLoadingHint("儲值核銷中…");
  let stage = "redeem";
  try {
    let addDays = null;
    let currentRemainingDays = null;
    let newRemainingDays = null;

    // redeem + auth_check 可併行：縮短關鍵路徑等待（redeem 失敗時 check 結果會被丟棄）
    stage = "redeem+auth_check";
    const checkPromise = authCheck_(userIdSafe, displayNameSafe)
      .then((r) => ({ ok: true, value: r }))
      .catch((err) => ({ ok: false, error: err }));

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
    // 允許 amount=0：代表只同步功能開通設定，不增加天數
    if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_AMOUNT");

    // 2) read current auth status (contains remainingDays & feature flags)
    stage = "auth_check";
    const checkWrap = await checkPromise;
    if (!checkWrap.ok) throw checkWrap.error || new Error("AUTH_CHECK_FAILED");
    const check = checkWrap.value;
    const currentRd = Number(check?.remainingDays);
    currentRemainingDays = Number.isFinite(currentRd) ? currentRd : 0;

    // 規則：TopUp 的 amount 直接視為「增加天數」；amount=0 代表不加天數
    addDays = Math.floor(amount);
    newRemainingDays = currentRemainingDays + addDays;

    // 3) write back to AUTH Users
    // 注意：AUTH updateuser 若不帶 startDate/usageDays，後端會清空欄位。
    // 因此即使 amount=0，也要送一組能「維持現況 remainingDays」的 startDate/usageDays。
    let startDate = yyyyMmDdTpe_();
    let usageDays = 1;

    if (addDays > 0) {
      // 走既有模式：把 remainingDays rebased 到 today，維持/延長到期日
      usageDays = Math.max(1, Math.floor(newRemainingDays) + 1);
      startDate = yyyyMmDdTpe_();
    } else {
      // amount=0：只改功能，不改到期狀態
      // 若 remainingDays >= 0：用 startDate=today, usageDays=remaining+1 保持不變
      // 若 remainingDays < 0：用 usageDays=1, startDate=today+remainingDays 保持「過期幅度」不變
      if (Number.isFinite(currentRemainingDays)) {
        if (currentRemainingDays >= 0) {
          usageDays = Math.max(1, Math.floor(currentRemainingDays) + 1);
          startDate = yyyyMmDdTpe_();
        } else {
          usageDays = 1;
          startDate = yyyyMmDdAddDays_(yyyyMmDdTpe_(), Math.floor(currentRemainingDays));
        }
      } else {
        // remainingDays 無法判定：保守做法是清空會讓 remainingDays=null（不建議，但避免誤延長）
        // 仍送出最小安全值：usageDays=1, startDate=today-9999（等同長期過期）
        usageDays = 1;
        startDate = yyyyMmDdAddDays_(yyyyMmDdTpe_(), -9999);
      }
    }

    // AUTH 端欄位是「是/否」，且 updateuser 若漏帶會被重設。
    // 規則：
    // - 若序號有明確帶回 true/false → 覆寫
    // - 若序號未設定（null/undefined/空白）→ 沿用原本 check 值
    const redeemPush = pickRedeemFlagTri_(redeem, "pushEnabled");
    const redeemPersonal = pickRedeemFlagTri_(redeem, "personalStatusEnabled");
    const redeemSchedule = pickRedeemFlagTri_(redeem, "scheduleEnabled");
    const redeemPerformance = pickRedeemFlagTri_(redeem, "performanceEnabled");

    // 若序號設定「不同步」，則僅增加天數，不套用功能開通設定
    const syncEnabled = normalizeSyncEnabled_(redeem);
    const effRedeemPush = syncEnabled ? redeemPush : null;
    const effRedeemPersonal = syncEnabled ? redeemPersonal : null;
    const effRedeemSchedule = syncEnabled ? redeemSchedule : null;
    const effRedeemPerformance = syncEnabled ? redeemPerformance : null;

    const newPushEnabled = mergeYesNo_(check?.pushEnabled, effRedeemPush);
    const newPersonalStatusEnabled = mergeYesNo_(check?.personalStatusEnabled, effRedeemPersonal);
    const newScheduleEnabled = mergeYesNo_(check?.scheduleEnabled, effRedeemSchedule);
    const newPerformanceEnabled = mergeYesNo_(check?.performanceEnabled, effRedeemPerformance);

    stage = "auth_update";
    await authUpdateUser_({
      userId: userIdSafe,
      audit: check?.audit,
      masterCode: check?.masterCode,
      pushEnabled: newPushEnabled,
      personalStatusEnabled: newPersonalStatusEnabled,
      scheduleEnabled: newScheduleEnabled,
      performanceEnabled: newPerformanceEnabled,
      // 若序號設定不同步，後端只更新 Users（天數/欄位），不觸發衍生表同步
      skipSync: syncEnabled ? 0 : 1,
      startDate,
      usageDays,
    });

    // 4) 先用本地計算值更新 UI，最後驗證改成背景執行（少一次關鍵路徑往返）
    stage = "ui_update";
    updateUsageBanner(displayNameSafe, newRemainingDays);
    try {
      updateFeatureState({
        pushEnabled: newPushEnabled,
        personalStatusEnabled: newPersonalStatusEnabled,
        scheduleEnabled: newScheduleEnabled,
        performanceEnabled: newPerformanceEnabled,
      });
    } catch (_) {}

    hideLoadingHint();

    // background verify (best-effort)
    authCheck_(userIdSafe, displayNameSafe)
      .then((check2) => {
        try {
          updateUsageBanner(check2?.displayName || displayNameSafe, check2?.remainingDays);
        } catch (_) {}
        try {
          updateFeatureState(check2);
        } catch (_) {}
      })
      .catch(() => {});

    fireTopupEvent_({
      event: "topup_success",
      userId: userIdSafe,
      displayName: displayNameSafe,
      detailObj: {
        context,
        addDays,
        remainingDaysBefore: currentRemainingDays,
        remainingDaysAfter: newRemainingDays,
        syncEnabled,
        features: {
          pushEnabled: newPushEnabled,
          personalStatusEnabled: newPersonalStatusEnabled,
          scheduleEnabled: newScheduleEnabled,
          performanceEnabled: newPerformanceEnabled,
        },
        reloadOnSuccess: !!reloadOnSuccess,
        verified: false,
      },
      eventCn: "儲值成功",
    });

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

    fireTopupEvent_({
      event: "topup_fail",
      userId: userIdSafe,
      displayName: displayNameSafe,
      detailObj: {
        context,
        stage: typeof stage === "string" ? stage : "unknown",
        error: safeOneLine_(errMsg, 300),
      },
      eventCn: "儲值失敗",
    });

    if (context === "gate") showGate("⚠ 儲值失敗\n" + errMsg, true);
    else alert("儲值失敗：" + errMsg);
    return { ok: false, error: errMsg };
  }
}
