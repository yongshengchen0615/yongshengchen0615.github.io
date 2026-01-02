/* ============================================
 * 04_ui.js
 * - Theme
 * - UI Lock / SaveAll Button / Mobile SelectAll
 * ============================================ */

/**
 * 初始化主題
 * 做法：讀 localStorage theme（預設 dark），寫到 html[data-theme]
 */
function initTheme_() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeButtonText_();
}

/**
 * 切換亮/暗主題
 * 做法：切換 html[data-theme] 並寫回 localStorage
 */
function toggleTheme_() {
  if (savingAll) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateThemeButtonText_();
}

/**
 * 更新「切換主題」按鈕文字
 */
function updateThemeButtonText_() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  btn.textContent = current === "dark" ? "亮色" : "暗色";
}

/**
 * 鎖定/解鎖可編輯狀態
 * @param {boolean} enabled - true: 可操作；false: 全部鎖定
 * 做法：
 * - 針對主要操作元件設 disabled
 * - table 內 input/select/button 一併鎖定
 */
function setEditingEnabled_(enabled) {
  const lock = !enabled;

  document.querySelector(".panel")?.classList.toggle("is-locked", lock);

  setDisabledByIds_(["reloadBtn", "themeToggle", "searchInput", "clearSearchBtn"], lock);

  document.querySelectorAll(".chip").forEach((el) => (el.disabled = lock));

  setDisabledByIds_(
    [
      "checkAll",
      "mobileCheckAll",
      "bulkClear",
      "bulkAudit",
      "bulkPush",
      "bulkPersonalStatus",
      "bulkScheduleEnabled",
      "bulkUsageDays",
      "bulkApply",
      "bulkDelete",
    ],
    lock
  );

  document.querySelectorAll("th.sortable").forEach((th) => {
    th.style.pointerEvents = lock ? "none" : "";
    th.style.opacity = lock ? "0.6" : "";
  });

  document.getElementById("tbody")?.querySelectorAll("input, select, button").forEach((el) => (el.disabled = lock));

  applyView_();
  refreshSaveAllButton_();
  pushSetEnabled_(!lock);
}

/**
 * 確保「儲存全部變更」按鈕存在
 * 做法：插在 reloadBtn 前，並綁定 saveAllDirty_()
 */
function ensureSaveAllButton_() {
  const topRight = document.querySelector(".topbar-right");
  if (!topRight) return;
  if (document.getElementById("saveAllBtn")) return;

  const btn = document.createElement("button");
  btn.id = "saveAllBtn";
  btn.type = "button";
  btn.className = "btn primary";
  btn.textContent = "儲存全部變更";
  btn.disabled = true;

  btn.addEventListener("click", async () => {
    if (savingAll) return;
    await saveAllDirty_();
  });

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn && reloadBtn.parentElement === topRight) topRight.insertBefore(btn, reloadBtn);
  else topRight.appendChild(btn);

  refreshSaveAllButton_();
}

/**
 * 更新「儲存全部變更」按鈕狀態
 * 做法：依 dirtyMap.size / savingAll 決定 disabled 與文案
 */
function refreshSaveAllButton_() {
  const btn = document.getElementById("saveAllBtn");
  if (!btn) return;
  const dirtyCount = dirtyMap.size;
  btn.disabled = savingAll || dirtyCount === 0;
  btn.textContent = savingAll ? "儲存中..." : dirtyCount ? `儲存全部變更（${dirtyCount}）` : "儲存全部變更";
}

/**
 * 手機版「全選（目前列表）」
 * 做法：插到 .panel-head .filters，並以 filteredUsers 為範圍全選
 */
function ensureMobileSelectAll_() {
  const filters = document.querySelector(".panel-head .filters");
  if (!filters) return;
  if (document.getElementById("mobileCheckAll")) return;

  const wrap = document.createElement("div");
  wrap.className = "mobile-selectall";
  wrap.innerHTML = `
    <input id="mobileCheckAll" type="checkbox" aria-label="全選（目前列表）">
    <span class="label">全選</span>
    <span class="hint" id="mobileCheckAllHint">（0/${filteredUsers.length || 0}）</span>
  `;
  filters.appendChild(wrap);

  const mobile = wrap.querySelector("#mobileCheckAll");
  mobile.addEventListener("change", () => {
    if (savingAll) return;
    const checked = !!mobile.checked;

    filteredUsers.forEach((u) => {
      if (checked) selectedIds.add(u.userId);
      else selectedIds.delete(u.userId);
    });

    renderTable();
    updateBulkBar_();
    syncCheckAll_();
  });
}
