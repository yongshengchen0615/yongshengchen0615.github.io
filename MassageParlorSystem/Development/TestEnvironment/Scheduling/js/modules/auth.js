/**
 * auth.js
 *
 * 權限驗證 / Gate 流程：
 * - LIFF 模式：liff.init/login/getProfile
 * - 非 LIFF 模式：從 query/localStorage 取 userId/name
 * - 呼叫 AUTH GAS：check / register
 * - 依 rules 決定是否允許進入
 */

import { config } from "./config.js";
import { state } from "./state.js";
import { dom } from "./dom.js";
import { getQueryParam } from "./core.js";
import { showGate, openApp, updateUsageBanner } from "./uiHelpers.js";
import { updateFeatureState } from "./featureBanner.js";
import { applyScheduleUiMode, showNotMasterHint } from "./scheduleUi.js";
import { hidePersonalTools, loadAndShowPersonalTools } from "./personalTools.js";
import { parseIsMaster, parseTechNo, normalizeTechNo, updateMyMasterStatusUI } from "./myMasterStatus.js";
import { logUsageEvent } from "./usageLog.js";

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
        msg += "\n請聯絡管理員協助開通或延長使用期限。";
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
  const url = config.AUTH_API_URL + "?mode=check&userId=" + encodeURIComponent(userId);
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
  updateFeatureState(result);

  // 記錄師傅身分
  state.myMaster.isMaster = !!result.isMaster;
  state.myMaster.techNo = normalizeTechNo(result.techNo || result.masterCode || "");

  // 排班表開通=否：只顯示我的狀態
  const scheduleOk = String(result.scheduleEnabled || "").trim() === "是";
  applyScheduleUiMode(scheduleOk);

  // 業績開通=否：不顯示業績按鈕/區塊（若此版本沒有相關 DOM，則不影響）
  const performanceOk = String(result.performanceEnabled || "").trim() === "是";
  const perfBtn = document.getElementById("btnPerformance");
  if (perfBtn) perfBtn.style.display = performanceOk ? "" : "none";
  const perfCard = document.getElementById("perfCard");
  if (perfCard) perfCard.style.display = performanceOk ? "" : "none";

  // 立即同步提示（避免首次畫面沒出現）
  if (!scheduleOk) {
    const isMasterNow = !!(state.myMaster.isMaster && state.myMaster.techNo);
    showNotMasterHint(!isMasterNow);
  } else {
    showNotMasterHint(false);
  }

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
      }),
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
 * - 會從 query 讀取 `userId` / `name`，或讀 localStorage (devUserId/devDisplayName)
 * - 會呼叫 AUTH API 確認是否允許進入
 *
 * @returns {Promise<{ok:boolean, userId?:string, displayName?:string, result?:any}>}
 */
export async function initNoLiffAndGuard() {
  showGate("✅ 未啟用 LINE 登入\n正在確認使用權限…");

  try {
    const userId =
      String(getQueryParam("userId") || "").trim() ||
      String(localStorage.getItem("devUserId") || "").trim() ||
      "dev_user";

    const displayName =
      String(getQueryParam("name") || "").trim() ||
      String(localStorage.getItem("devDisplayName") || "").trim() ||
      "使用者";

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
 *
 * @returns {Promise<{ok:boolean, userId?:string, displayName?:string, result?:any}>}
 *   ok=true 表示可進入主畫面；ok=false 代表仍停留在 gate（或已觸發 liff.login）。
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

    const userId = profile.userId || (ctx && ctx.userId) || "";
    const displayName = profile.displayName || "";

    if (!userId) {
      showGate("無法取得使用者 ID，請重新開啟 LIFF。", true);
      return { ok: false };
    }

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
