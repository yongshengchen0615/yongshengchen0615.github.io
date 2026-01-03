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

/**
 * 欄位 index（table nth-child）
 * 1:勾選 2:# 3:userId 4:顯示名稱 5:建立時間 6:開始使用 7:期限(天) 8:使用狀態 9:審核狀態
 * 10:師傅編號 11:是否師傅 12:是否推播 13:個人狀態開通 14:排班表開通 15:操作
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

