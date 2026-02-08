/* ================================
 * 03_permissions_tabs.js
 * Column permissions + view tabs + push feature gate
 * ================================ */

function isYes_(v) {
  return String(v || "").trim() === "是";
}

function isPushFeatureEnabled_() {
  if (!adminPerms) return false;
  return isYes_(adminPerms.pushFeatureEnabled);
}

function canTech_(permKey) {
  if (!adminPerms) return false;
  return isYes_(adminPerms[permKey]);
}

/**
 * 欄位 index（table nth-child）
 * 1:勾選 2:# 3:userId 4:顯示名稱 5:建立時間 6:開始使用 7:期限(天) 8:使用狀態 9:審核狀態
 * 10:師傅編號 11:是否師傅 12:是否推播 13:個人狀態開通 14:排班表開通 15:業績開通 16:操作
 */
const PERM_TO_COLS = {
  techAudit: [9],
  techCreatedAt: [5],
  techStartDate: [6],
  techExpiryDate: [7, 8],
  techMasterNo: [10],
  techIsMaster: [11],
  techPushEnabled: [12],
  techPersonalStatusEnabled: [13],
  techScheduleEnabled: [14],
  techPerformanceEnabled: [15],
  techAppointmentQueryEnabled: [],
};

function allTechPermsYes_() {
  if (!adminPerms) return false;
  const keys = Object.keys(PERM_TO_COLS);
  return keys.every((k) => isYes_(adminPerms[k]));
}

function applyColumnPermissions_() {
  if (!adminPerms) return;

  const styleId = "permHideStyle";
  let styleEl = document.getElementById(styleId);

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  const hideCols = [];
  Object.keys(PERM_TO_COLS).forEach((k) => {
    if (!isYes_(adminPerms[k])) hideCols.push(...PERM_TO_COLS[k]);
  });

  if (hideCols.length == 0) {
    styleEl.textContent = "";
    return;
  }

  const cols = Array.from(new Set(hideCols)).sort((a, b) => a - b);
  const rules = cols
    .map(
      (n) => `
.table-wrap table thead th:nth-child(${n}),
.table-wrap table tbody td:nth-child(${n}){ display:none !important; }
`
    )
    .join("\n");

  styleEl.textContent = rules;
}

/**
 * Bulk 欄位權限
 * 規則：對應資料為「否」則不顯示
 * - 批次審核 -> 技師審核狀態 (techAudit)
 * - 批次推播 -> 技師是否推播 (techPushEnabled)
 * - 批次個人狀態 -> 技師個人狀態開通 (techPersonalStatusEnabled)
 * - 批次排班表 -> 技師排班表開通 (techScheduleEnabled)
 * - 批次期限(天) -> 技師使用期限 (techExpiryDate)
 */
const PERM_TO_BULK_INPUT_IDS = {
  techAudit: ["bulkAudit"],
  techPushEnabled: ["bulkPush"],
  techPersonalStatusEnabled: ["bulkPersonalStatus"],
  techScheduleEnabled: ["bulkScheduleEnabled"],
  techPerformanceEnabled: ["bulkPerformanceEnabled"],
  techAppointmentQueryEnabled: [],
  techExpiryDate: ["bulkUsageDays"],
};

function applyBulkPermissions_() {
  Object.keys(PERM_TO_BULK_INPUT_IDS).forEach((permKey) => {
    // ✅ 保守策略：權限未載入/已登出 -> 先全部隱藏，避免閃爍或誤顯示
    const show = adminPerms ? canTech_(permKey) : false;
    PERM_TO_BULK_INPUT_IDS[permKey].forEach((inputId) => {
      const input = document.getElementById(inputId);
      const group = input ? input.closest(".bulk-group") : null;
      if (group) group.style.display = show ? "" : "none";

      // 乾淨起見：隱藏時清空選擇，避免殘留值
      if (!show && input) {
        if (input instanceof HTMLSelectElement) input.value = "";
        if (input instanceof HTMLInputElement) input.value = "";
      }
    });
  });
}

function applyView_() {
  document.querySelectorAll("#viewTabs .viewtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === currentView);
    b.disabled = savingAll;
  });

  const table = document.querySelector(".table-wrap table");
  if (table) table.setAttribute("data-view", currentView);
}

function ensureViewTabs_() {
  if (!allTechPermsYes_()) return;

  const head = document.querySelector(".panel-head");
  if (!head) return;
  if (document.getElementById("viewTabs")) return;

  const wrap = document.createElement("div");
  wrap.className = "viewtabs";
  wrap.id = "viewTabs";
  wrap.innerHTML = `
    <button class="viewtab" data-view="all" type="button">全部欄位</button>
    <button class="viewtab" data-view="usage" type="button">使用/審核</button>
    <button class="viewtab" data-view="master" type="button">師傅資訊</button>
    <button class="viewtab" data-view="features" type="button">功能開通</button>
  `;
  head.appendChild(wrap);

  wrap.addEventListener("click", (e) => {
    if (savingAll) return;
    const btn = e.target instanceof Element ? e.target.closest("button.viewtab") : null;
    if (!btn) return;

    const v = btn.dataset.view;
    if (!VIEW_ENUM.includes(v)) return;

    currentView = v;
    localStorage.setItem("users_view", currentView);
    applyView_();
  });

  if (!VIEW_ENUM.includes(currentView)) currentView = "usage";
  applyView_();
}

function enforceViewTabsPolicy_() {
  const showTabs = allTechPermsYes_();
  const tabs = document.getElementById("viewTabs");

  if (!showTabs) {
    if (tabs) tabs.remove();
    currentView = "all";
    localStorage.setItem("users_view", "all");
    applyView_();
    return;
  }

  ensureViewTabs_();
}

function applyPushFeatureGate_() {
  // 只控制「推播面板」是否顯示
  if (typeof ensurePushPanel_ === "function") ensurePushPanel_();
}

function canEditUserField_(field) {
  // 欄位層級對應（前端 table 欄位）
  // 若 adminPerms 尚未載入，保守視為不可編輯（避免閃爍/誤操作）
  if (!adminPerms) return false;

  switch (field) {
    case "audit":
      return canTech_("techAudit");
    case "startDate":
      return canTech_("techStartDate");
    case "usageDays":
      return canTech_("techExpiryDate");
    case "masterCode":
      return canTech_("techMasterNo");
    case "pushEnabled":
      return canTech_("techPushEnabled");
    case "personalStatusEnabled":
      return canTech_("techPersonalStatusEnabled");
    case "scheduleEnabled":
      return canTech_("techScheduleEnabled");
    case "performanceEnabled":
      return canTech_("techPerformanceEnabled");
    default:
      return true;
  }
}

