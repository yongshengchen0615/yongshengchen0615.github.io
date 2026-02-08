/**
 * auth.js（完整可貼可覆蓋版）
 *
 * 權限驗證 / Gate 流程：
 * - LIFF 模式：liff.init/login/getProfile
 * - 非 LIFF 模式：從 query/localStorage 取 userId/name
 * - 呼叫 AUTH GAS：check / register
 * - 依 rules 決定是否允許進入
 *
 * ✅ 本版修正：
 * - 取得 userId 後，一律落地到 state + localStorage（userId/displayName）
 * - 非 LIFF 模式：優先 query/userId，其次 localStorage.userId，再 fallback dev_user
 * - 避免其他模組（例如 performance.js）讀不到 userId 而報「缺少 userId」
 */

import { config } from "./config.js";
import { state } from "./state.js";
import { dom } from "./dom.js";
import { getQueryParam } from "./core.js";
import { showGate, openApp, updateUsageBanner } from "./uiHelpers.js";
import { updateFeatureState } from "./featureBanner.js";
import { showNotMasterHint } from "./scheduleUi.js";
import { hidePersonalTools, loadAndShowPersonalTools } from "./personalTools.js";
import { parseIsMaster, parseTechNo, normalizeTechNo, updateMyMasterStatusUI } from "./myMasterStatus.js";
import { logUsageEvent } from "./usageLog.js";
import { isTopupEnabled, runTopupFlow } from "./topup.js";

// Gate overlay actions (event delegation)
if (dom.gateEl) {
  dom.gateEl.addEventListener("click", async (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest("#gateTopupBtn") : null;
    if (!btn) return;
    ev.preventDefault();
    await runTopupFlow({ context: "gate", reloadOnSuccess: true });
  });
}

/* =====================================================
 * ✅ Identity helpers（state + localStorage 落地）
 * ===================================================== */

function setClientIdentity_(userId, displayName) {
  const uid = String(userId || "").trim();
  const name = String(displayName || "").trim();

  // state.user（推薦）
  state.user = state.user || {};
  state.user.userId = uid;
  state.user.displayName = name;

  // 兼容：有些舊模組可能讀 state.userId/state.displayName
  state.userId = uid;
  state.displayName = name;

  try {
    localStorage.setItem("userId", uid);
    localStorage.setItem("displayName", name);

    // 兼容舊 dev key（可保留）
    if (uid) localStorage.setItem("devUserId", uid);
    if (name) localStorage.setItem("devDisplayName", name);
  } catch (_) {}
}

function getFallbackIdentity_() {
  // 1) query
  const qUserId = String(getQueryParam("userId") || getQueryParam("userid") || "").trim();
  const qName = String(getQueryParam("name") || getQueryParam("displayName") || "").trim();
  if (qUserId) return { userId: qUserId, displayName: qName || "" };

  // 2) localStorage（正式 key）
  try {
    const lsUserId = String(localStorage.getItem("userId") || "").trim();
    const lsName = String(localStorage.getItem("displayName") || "").trim();
    if (lsUserId) return { userId: lsUserId, displayName: lsName || "" };
  } catch (_) {}

  // 3) localStorage（舊 dev key）
  try {
    const devUserId = String(localStorage.getItem("devUserId") || "").trim();
    const devName = String(localStorage.getItem("devDisplayName") || "").trim();
    if (devUserId) return { userId: devUserId, displayName: devName || "" };
  } catch (_) {}

  // 4) fallback
  return { userId: "dev_user", displayName: "使用者" };
}

/* =====================================================
 * Existing helpers
 * ===================================================== */

function normalizeBoolOn(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "on" || s === "true" || s === "1" || s === "是" || s === "y" || s === "yes";
}

function normalizeCheckResult(data, displayNameFromClient) {
  const status = (data && data.status) || "none";
  const audit = (data && data.audit) || "";
  const serverDisplayName = (data && data.displayName) || "";
  const displayName = (serverDisplayName || displayNameFromClient || "").trim();

  const scheduleEnabled = (data && data.scheduleEnabled) || "否";
  const pushEnabled = (data && data.pushEnabled) || "否";
  const personalStatusEnabled = (data && data.personalStatusEnabled) || "否";
  const performanceEnabled = (data && data.performanceEnabled) || "否";
  const bookingEnabled = (data && data.bookingEnabled) || "否";

  const storeId = String((data && (data.storeId || data.StoreId)) || "").trim();

  let remainingDays = null;
  if (data && data.remainingDays !== undefined && data.remainingDays !== null) {
    const n = Number(data.remainingDays);
    if (!Number.isNaN(n)) remainingDays = n;
  }

  const flags = {
    maintenance: normalizeBoolOn(data && (data.maintenance ?? data.systemMaintenance)),
    blocked: normalizeBoolOn(data && (data.blocked ?? data.banned ?? data.disabled)),
    forceUpdate: normalizeBoolOn(data && (data.forceUpdate ?? data.mustUpdate)),
  };

  const messages = {
    maintenanceMsg: (data && (data.maintenanceMsg || data.systemMaintenanceMsg)) || "",
    blockedMsg: (data && (data.blockedMsg || data.bannedMsg || data.disabledMsg)) || "",
    forceUpdateMsg: (data && (data.forceUpdateMsg || data.mustUpdateMsg)) || "",
  };

  const isMaster = parseIsMaster(data || {});
  const techNo = parseTechNo(data || {});

  return {
    status,
    audit,
    displayName,
    serverDisplayName,
    scheduleEnabled,
    pushEnabled,
    personalStatusEnabled,
    performanceEnabled,
    bookingEnabled,
    storeId,
    remainingDays,
    flags,
    messages,
    raw: data || {},
    justRegistered: false,
    isMaster,
    techNo,
  };
}

/**
 * Gate 規則：
 * - approved + 未過期 → allow
 * - scheduleEnabled=否 不再擋（只影響 UI 顯示）
 */
function decideGateAction(r) {
  const hasRd = typeof r.remainingDays === "number" && !Number.isNaN(r.remainingDays);
  const notExpired = hasRd ? r.remainingDays >= 0 : false;
  const auditRaw = String(r.audit || "");
  const auditNorm = auditRaw.replace(/[\s\u200B-\u200D\uFEFF]/g, "");
  const isAuditMaintenance = auditNorm.includes("系統維護") || auditNorm.includes("系统维护");

  const rules = [
    {
      id: "MAINTENANCE",
      when: () => r.flags.maintenance === true || isAuditMaintenance,
      action: () => ({
        allow: false,
        message: isAuditMaintenance
          ? "目前系統維護中\n不開放使用"
          : "🛠️ 系統維護中\n" + (String(r.messages.maintenanceMsg || "").trim() || "請稍後再試。"),
      }),
    },
    {
      id: "BLOCKED",
      when: () => r.flags.blocked === true,
      action: () => ({
        allow: false,
        message: "⛔ 帳號已停用/封鎖\n" + (String(r.messages.blockedMsg || "").trim() || "如需協助請聯絡管理員。"),
      }),
    },
    {
      id: "FORCE_UPDATE",
      when: () => r.flags.forceUpdate === true,
      action: () => ({
        allow: false,
        message: "⬆️ 需要更新\n" + (String(r.messages.forceUpdateMsg || "").trim() || "請更新至最新版本後再使用。"),
      }),
    },

    // approved + 未過期 → allow
    {
      id: "APPROVED_OK",
      when: () => r.status === "approved" && notExpired,
      action: () => ({ allow: true }),
    },

    // approved 但過期/未設定期限 → 擋
    {
      id: "APPROVED_BUT_LOCKED",
      when: () => r.status === "approved",
      action: () => {
        let msg = "此帳號已通過審核，但目前無法使用看板。\n\n";
        msg += "原因：使用期限已到期或未設定期限。\n";
        if (isTopupEnabled()) {
          msg += "\n你可以先使用儲值序號延長期限：\n";
          msg += '<div style="margin-top:12px;"><button id="gateTopupBtn" class="btn btn-ghost" type="button">💳 輸入序號儲值</button></div>';
        } else {
          msg += "\n請聯絡管理員協助開通或延長使用期限。";
        }
        return { allow: false, message: msg };
      },
    },

    {
      id: "PENDING",
      when: () => r.status === "pending",
      action: () => {
        if (isAuditMaintenance) {
          return { allow: false, message: "目前系統維護中\n不開放使用" };
        }

        const auditText = r.audit || "待審核";
        let msg = "此帳號目前尚未通過審核。\n";
        msg += "目前審核狀態：「" + auditText + "」。\n\n";
        if (r.justRegistered) msg += "✅ 已自動送出審核申請。\n\n";
        msg +=
          auditText === "拒絕" || auditText === "停用"
            ? "如需重新申請或有疑問，請聯絡管理員。"
            : "若你已經等待一段時間，請聯絡管理員確認審核進度。";
        return { allow: false, message: msg };
      },
    },
  ];

  for (const rule of rules) {
    if (rule.when()) return { ruleId: rule.id, ...rule.action() };
  }

  return { ruleId: "UNKNOWN", allow: false, message: "⚠ 無法確認使用權限，請稍後再試。", isError: true };
}

async function checkOrRegisterUser(userId, displayNameFromClient) {
  const url =
    config.AUTH_API_URL +
    "?mode=check&userId=" +
    encodeURIComponent(userId) +
    "&displayName=" +
    encodeURIComponent(displayNameFromClient || "");
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("Check HTTP " + resp.status);

  const data = await resp.json();
  let r = normalizeCheckResult(data, displayNameFromClient);

  // ✅ 如果後端以 audit 告知「系統維護」，不要走自動註冊/審核 UI。
  {
    const auditNorm = String(r.audit || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    if (auditNorm.includes("系統維護") || auditNorm.includes("系统维护")) return r;
  }

  if (r.status === "approved" || r.status === "pending") return r;

  try {
    await registerUser(userId, r.displayName || displayNameFromClient || "");
    r.status = "pending";
    r.audit = r.audit || "待審核";
    r.justRegistered = true;

    // 使用者第一次送出審核（自動註冊）
    logUsageEvent({
      event: "audit_first_request",
      userId,
      displayName: r.displayName || displayNameFromClient || "",
      detail: "auto_register",
      eventCn: "首次註冊申請",
    });

    return r;
  } catch (e) {
    console.error("[Register] 寫入 AUTH GAS 失敗：", e);
    r.status = "error";
    r.justRegistered = false;
    return r;
  }
}

async function registerUser(userId, displayName) {
  const url =
    config.AUTH_API_URL +
    "?mode=register" +
    "&userId=" +
    encodeURIComponent(userId) +
    "&displayName=" +
    encodeURIComponent(displayName || "");

  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("Register HTTP " + resp.status);
  return await resp.json();
}

async function onAuthorized({ userId, displayName, result }) {
  // ✅ 落地身份（給其他模組用）
  setClientIdentity_(userId, displayName);

  // 讓其他模組可取到最新剩餘天數（儲值成功後也會更新 banner）
  try {
    state.user = state.user || {};
    state.user.remainingDays = result.remainingDays;
    state.user.audit = result.audit;
    state.user.storeId = String(result.storeId || "").trim();

    // 兼容：有些模組可能讀 state.storeId
    state.storeId = state.user.storeId;
  } catch (_) {}

  // 確保 state.myMaster 存在（給 scheduleUi/feature UI 判斷用）
  state.myMaster = state.myMaster || {};
  state.feature = state.feature || {};

  // 記錄師傅身分
  state.myMaster.isMaster = !!result.isMaster;
  state.myMaster.techNo = normalizeTechNo(result.techNo || result.masterCode || "");

  // features（會同步 chips + 功能按鈕顯示/排班 UI）
  updateFeatureState(result);

  // 紀錄審核狀態（每次開啟/驗證都會嘗試送出；由 USAGE_LOG_MIN_INTERVAL_MS 節流）
  try {
    logUsageEvent({
      event: "audit_status",
      userId,
      displayName: result.displayName || displayName,
      detail: JSON.stringify({
        status: result.status,
        audit: result.audit,
        remainingDays: result.remainingDays,
        scheduleEnabled: result.scheduleEnabled,
        pushEnabled: result.pushEnabled,
        personalStatusEnabled: result.personalStatusEnabled,
        performanceEnabled: result.performanceEnabled,
        bookingEnabled: result.bookingEnabled,
      }),
      eventCn: "審核狀態",
    });
  } catch {}

  // Gate 規則
  const gate = decideGateAction(result);
  if (!gate.allow) {
    // 使用者開啟時仍在審核中
    if (gate.ruleId === "PENDING") {
      logUsageEvent({
        event: "audit_pending_open",
        userId,
        displayName: result.displayName || displayName,
        detail: String(result.audit || "pending") + (result.justRegistered ? "|justRegistered" : ""),
        eventCn: "待審核開啟",
      });
    }

    hidePersonalTools();
    if (dom.myMasterStatusEl) dom.myMasterStatusEl.style.display = "none";
    showNotMasterHint(false);
    showGate(gate.message, gate.isError);
    return { ok: false };
  }

  showGate("驗證通過，正在載入資料…");
  openApp();
  updateUsageBanner(result.displayName || displayName, result.remainingDays);

  updateMyMasterStatusUI();

  // 個人快捷
  const personalOk = String(result.personalStatusEnabled || "").trim() === "是";
  if (personalOk) await loadAndShowPersonalTools(userId);
  else hidePersonalTools();

  // 保留原本全域（方便除錯）
  window.currentUserId = userId;
  window.currentDisplayName = displayName;

  return { ok: true, userId, displayName, result };
}

/**
 * 非 LIFF 模式初始化 + 權限驗證（Gate）。
 * - 會從 query 讀取 `userId` / `name`，或讀 localStorage
 * - 會呼叫 AUTH API 確認是否允許進入
 */
export async function initNoLiffAndGuard() {
  showGate("✅ 未啟用 LINE 登入\n正在確認使用權限…");

  try {
    const fb = getFallbackIdentity_();
    const userId = String(fb.userId || "").trim();
    const displayName = String(fb.displayName || "").trim();

    if (!userId) {
      showGate("缺少 userId（未登入/未取得 profile）", true);
      return { ok: false };
    }

    // ✅ 先落地（避免後續模組搶先讀）
    setClientIdentity_(userId, displayName);

    const result = await checkOrRegisterUser(userId, displayName);
    return await onAuthorized({ userId, displayName, result });
  } catch (err) {
    console.error("[NoLIFF] 驗證失敗：", err);
    hidePersonalTools();
    if (dom.myMasterStatusEl) dom.myMasterStatusEl.style.display = "none";
    showNotMasterHint(false);
    showGate("⚠ 權限驗證失敗，請稍後再試。", true);
    return { ok: false };
  }
}

/**
 * LIFF 模式初始化 + 權限驗證（Gate）。
 * - 會做 liff.init / login / getProfile
 * - 會呼叫 AUTH API 確認是否允許進入
 */
export async function initLiffAndGuard() {
  showGate("正在啟動 LIFF…");

  try {
    if (!window.liff) throw new Error("LIFF_SDK_MISSING");
    await window.liff.init({ liffId: config.LIFF_ID });

    if (!window.liff.isLoggedIn()) {
      window.liff.login();
      return { ok: false };
    }

    showGate("正在取得使用者資訊…");
    const ctx = window.liff.getContext();
    const profile = await window.liff.getProfile();

    const userId = String(profile.userId || (ctx && ctx.userId) || "").trim();
    const displayName = String(profile.displayName || "").trim();

    if (!userId) {
      showGate("缺少 userId（未登入/未取得 profile）", true);
      return { ok: false };
    }

    // ✅ 先落地（避免後續模組搶先讀）
    setClientIdentity_(userId, displayName);

    showGate("正在確認使用權限…");
    const result = await checkOrRegisterUser(userId, displayName);
    return await onAuthorized({ userId, displayName, result });
  } catch (err) {
    console.error("[LIFF] 初始化或驗證失敗：", err);
    hidePersonalTools();
    if (dom.myMasterStatusEl) dom.myMasterStatusEl.style.display = "none";
    showNotMasterHint(false);
    showGate("⚠ LIFF 初始化或權限驗證失敗，請稍後再試。", true);
    return { ok: false };
  }
}
