/* ============================================
 * 09_auth.js
 * - LIFF + Admin GAS Gate
 * ============================================ */

/**
 * 顯示/隱藏管理員門禁遮罩
 * @param {boolean} show - true: 顯示
 * @param {string} msg - 要顯示的訊息
 */
function showAuthGate_(show, msg) {
  const gate = document.getElementById("authGate");
  const m = document.getElementById("authGateMsg");
  if (m && msg) m.textContent = msg;
  if (gate) gate.style.display = show ? "flex" : "none";
}

/**
 * 管理員登入/驗證啟動
 * 做法：
 * - liff.init
 * - 未登入：liff.login
 * - 已登入：liff.getProfile -> adminCheckAccess_
 * - 取得 adminPerms 後，先套用欄位/批次/Tabs 規則
 * - audit 通過才放行
 * @returns {Promise<boolean>} - 是否通過
 */
async function adminAuthBoot_() {
  showAuthGate_(true, "請稍候，正在進行 LINE 登入與權限檢查…");

  try {
    if (!window.liff) throw new Error("LIFF SDK not loaded");

    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      showAuthGate_(true, "尚未登入 LINE，將導向登入…");
      liff.login({ redirectUri: window.location.href });
      return false;
    }

    const profile = await liff.getProfile();
    adminProfile = { userId: profile.userId, displayName: profile.displayName || "" };

    const check = await adminCheckAccess_(adminProfile.userId, adminProfile.displayName);

    // 保存 tech 權限（後端 adminUpsertAndCheck 回傳）
    adminPerms = {
      techAudit: check.techAudit,
      techCreatedAt: check.techCreatedAt,
      techStartDate: check.techStartDate,
      techExpiryDate: check.techExpiryDate,
      techMasterNo: check.techMasterNo,
      techIsMaster: check.techIsMaster,
      techPushEnabled: check.techPushEnabled,
      techPersonalStatusEnabled: check.techPersonalStatusEnabled,
      techScheduleEnabled: check.techScheduleEnabled,
    };

    // 依權限套用：欄位隱藏 / tabs / bulk 欄位顯示
    applyColumnPermissions_();
    enforceViewTabsPolicy_();
    applyBulkPermissions_();

    if (!check.ok) {
      showAuthGate_(true, "管理員驗證失敗（後端回傳異常）。請稍後重試。");
      setEditingEnabled_(false);
      throw new Error("adminCheckAccess not ok");
    }

    if (String(check.audit || "") !== "通過") {
      const hint =
        check.audit === "待審核"
          ? "你的管理員權限目前為「待審核」。"
          : check.audit === "拒絕"
          ? "你的管理員權限已被「拒絕」。"
          : check.audit === "停用"
          ? "你的管理員權限目前為「停用」。"
          : check.audit === "系統維護"
          ? "系統目前維護中，暫不開放管理員登入。"
          : "你的管理員權限尚未通過。";

      showAuthGate_(true, `${hint}\n\nLINE：${adminProfile.displayName}\nID：${adminProfile.userId}`);
      setEditingEnabled_(false);
      throw new Error("admin not approved");
    }

    showAuthGate_(false);
    setEditingEnabled_(true);

    // 通過後再保險套一次
    applyColumnPermissions_();
    enforceViewTabsPolicy_();
    applyBulkPermissions_();

    toast(`管理員：${adminProfile.displayName}（已通過）`, "ok");
    return true;
  } catch (err) {
    console.warn("adminAuthBoot blocked:", err);
    return false;
  }
}

/**
 * 登出管理員
 * 做法：liff.logout 後清空狀態，顯示 gate
 */
async function adminLogout_() {
  try {
    if (window.liff && liff.isLoggedIn()) await liff.logout();
  } finally {
    adminProfile = null;
    adminPerms = null;
    showAuthGate_(true, "已登出。請重新登入。");
  }
}
