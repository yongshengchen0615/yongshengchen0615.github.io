/* ============================================
 * 03_permissions_tabs.js
 * - 欄位權限（整欄隱藏）
 * - Tabs 顯示規則（全部 tech 權限皆為「是」才顯示）
 * - Bulk 欄位顯示規則（依 tech 權限決定）
 * ============================================ */

/**
 * 是否為「是」
 * @param {*} v - 任意輸入（後端通常回傳 "是"/"否"）
 * @returns {boolean}
 */
function isYes_(v) {
  return String(v || "").trim() === "是";
}

/**
 * 判斷：是否所有 tech 權限都為「是」
 * @returns {boolean}
 */
function allTechPermsYes_() {
  if (!adminPerms) return false;
  const keys = Object.keys(PERM_TO_COLS);
  return keys.every((k) => isYes_(adminPerms[k]));
}

/**
 * 依權限動態注入 CSS：把「否」的欄位整欄隱藏 (th + td)
 * 做法：產生 nth-child CSS 規則，寫入 <style id="permHideStyle">
 */
function applyColumnPermissions_() {
  if (!adminPerms) return;

  const styleId = "permHideStyle";
  let styleEl = document.getElementById(styleId);

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  // 全部是：不隱藏
  if (allTechPermsYes_()) {
    styleEl.textContent = "";
    return;
  }

  // 有任何否：收集要隱藏的欄位 index
  const hideCols = [];
  Object.keys(PERM_TO_COLS).forEach((k) => {
    if (!isYes_(adminPerms[k])) hideCols.push(...PERM_TO_COLS[k]);
  });

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
 * Tabs 顯示規則：
 * - 只有 ALL tech perms 都是「是」 -> 顯示 tabs
 * - 否則 -> 移除 tabs，並強制 currentView=all
 */
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

/**
 * 依「技師欄位可改權限」顯示/隱藏 bulk 欄位
 * 做法：找到控制項的最近 .bulk-group，直接改 display
 */
function applyBulkPermissions_() {
  // perms 未取到：先全隱藏（避免閃現）
  const hasPerms = !!adminPerms;

  Object.keys(BULK_PERM_MAP).forEach((bulkId) => {
    const permKey = BULK_PERM_MAP[bulkId];

    const controlEl = document.getElementById(bulkId);
    if (!controlEl) return;

    const group = controlEl.closest(".bulk-group");
    if (!group) return;

    const allowed = hasPerms && isYes_(adminPerms[permKey]);

    group.style.display = allowed ? "" : "none";

    // 權限否：清空值，避免 bulkApply_ 讀到殘值（或手動改 DOM）
    if (!allowed) {
      if (controlEl instanceof HTMLSelectElement) controlEl.value = "";
      if (controlEl instanceof HTMLInputElement) controlEl.value = "";
    }
  });
}

/**
 * 建立 View Tabs（只會建立一次）
 * 做法：插到 .panel-head 末端，使用 click delegation 切換 currentView
 */
function ensureViewTabs_() {
  // 只有全部 tech perms 都是「是」，才顯示 tabs
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

/**
 * 套用 currentView 到 table[data-view]
 * @returns {void}
 */
function applyView_() {
  document.querySelectorAll("#viewTabs .viewtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === currentView);
    b.disabled = savingAll;
  });

  const table = document.querySelector(".table-wrap table");
  if (table) table.setAttribute("data-view", currentView);
}
