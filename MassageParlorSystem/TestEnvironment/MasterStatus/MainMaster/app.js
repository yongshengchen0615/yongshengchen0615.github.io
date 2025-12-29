/* ================================
 * app.js (FULL)
 * ================================ */

/* =========================================================
 * ✅ config.json Loader（支援 _comment）
 * ========================================================= */

let API_BASE_URL = "";

async function loadConfig_() {
  const res = await fetch("config.json", { cache: "no-store" });
  const cfg = await res.json();

  API_BASE_URL = String(cfg.API_BASE_URL || "").trim();
  if (!API_BASE_URL) throw new Error("config.json missing API_BASE_URL");

  const defView = String(cfg.DEFAULT_VIEW || "").trim();
  if (!localStorage.getItem("users_view") && defView) {
    localStorage.setItem("users_view", defView);
  }

  return cfg;
}

/* =========================================================
 * ✅ Audit 狀態枚舉
 * ========================================================= */
const AUDIT_ENUM = ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"];
function normalizeAudit_(v) {
  const s = String(v || "").trim();
  if (!s) return "待審核";
  return AUDIT_ENUM.includes(s) ? s : "其他";
}

let allUsers = [];
let filteredUsers = [];

let sortKey = "createdAt";
let sortDir = "desc";

const selectedIds = new Set();
const originalMap = new Map();
const dirtyMap = new Map();

let toastTimer = null;
let savingAll = false;

/* =========================================================
 * ✅ View Tabs
 * ========================================================= */
const VIEW_ENUM = ["all", "usage", "master", "features"];
let currentView = localStorage.getItem("users_view") || "usage";

function ensureViewTabs_() {
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

function applyView_() {
  document.querySelectorAll("#viewTabs .viewtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === currentView);
    b.disabled = savingAll;
  });

  const table = document.querySelector(".table-wrap table");
  if (table) table.setAttribute("data-view", currentView);
}

/* =========================================================
 * ✅ DOMContentLoaded
 * ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadConfig_();
    currentView = localStorage.getItem("users_view") || currentView;

    initTheme_();

    document.getElementById("themeToggle")?.addEventListener("click", toggleTheme_);

    document.getElementById("reloadBtn")?.addEventListener("click", async () => {
      if (savingAll) return;
      selectedIds.clear();
      hideBulkBar_();
      await loadUsers();
    });

    document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
      if (savingAll) return;
      const si = document.getElementById("searchInput");
      if (si) si.value = "";
      si?.closest(".search-box")?.classList.remove("is-searching");
      applyFilters();
    });

    ensureSaveAllButton_();
    ensureMobileSelectAll_();
    ensureViewTabs_();
    ensurePushPanel_();

    bindFilter();
    bindSorting_();
    bindBulk_();
    bindTableDelegation_();

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener(
        "input",
        debounce(() => {
          if (savingAll) return;
          const box = searchInput.closest(".search-box");
          const hasValue = searchInput.value.trim().length > 0;
          box?.classList.toggle("is-searching", hasValue);
          applyFilters();
        }, 180)
      );
      searchInput.closest(".search-box")?.classList.toggle("is-searching", searchInput.value.trim().length > 0);
    }

    loadUsers();
  } catch (e) {
    console.error("loadConfig error:", e);
    toast("設定檔讀取失敗（config.json）", "err");
  }
});

/* ========= Theme ========= */
function initTheme_() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeButtonText_();
}
function toggleTheme_() {
  if (savingAll) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateThemeButtonText_();
}
function updateThemeButtonText_() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  btn.textContent = current === "dark" ? "亮色" : "暗色";
}

/* ========= UI Lock ========= */
function setEditingEnabled_(enabled) {
  const lock = !enabled;

  document.querySelector(".panel")?.classList.toggle("is-locked", lock);
  ["reloadBtn","themeToggle","searchInput","clearSearchBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = lock;
  });

  document.querySelectorAll(".chip").forEach((el) => (el.disabled = lock));

  const ids = [
    "checkAll","mobileCheckAll","bulkClear","bulkAudit","bulkPush","bulkPersonalStatus",
    "bulkScheduleEnabled","bulkUsageDays","bulkApply","bulkDelete"
  ];
  ids.forEach((id) => document.getElementById(id) && (document.getElementById(id).disabled = lock));

  document.querySelectorAll("th.sortable").forEach((th) => {
    th.style.pointerEvents = lock ? "none" : "";
    th.style.opacity = lock ? "0.6" : "";
  });

  document.getElementById("tbody")?.querySelectorAll("input, select, button").forEach((el) => (el.disabled = lock));

  applyView_();
  refreshSaveAllButton_();
  pushSetEnabled_(!lock);
}

/* ========= Save All Button ========= */
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

function refreshSaveAllButton_() {
  const btn = document.getElementById("saveAllBtn");
  if (!btn) return;
  const dirtyCount = dirtyMap.size;
  btn.disabled = savingAll || dirtyCount === 0;
  btn.textContent = savingAll ? "儲存中..." : dirtyCount ? `儲存全部變更（${dirtyCount}）` : "儲存全部變更";
}

/* ========= Mobile Select All ========= */
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

/* ========= Filters ========= */
function bindFilter() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (savingAll) return;
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters();
    });
  });
}

async function loadUsers() {
  try {
    if (!API_BASE_URL) throw new Error("API_BASE_URL not initialized");

    const res = await fetch(API_BASE_URL + "?mode=listUsers");
    const json = await res.json();
    if (!json.ok) throw new Error("listUsers not ok");

    allUsers = (json.users || []).map((u) => ({
      ...u,
      personalStatusEnabled: (u.personalStatusEnabled || "否") === "是" ? "是" : "否",
      scheduleEnabled: (u.scheduleEnabled || "否") === "是" ? "是" : "否",
      pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否",
      audit: normalizeAudit_(u.audit),
    }));

    originalMap.clear();
    dirtyMap.clear();
    for (const u of allUsers) originalMap.set(u.userId, snapshot_(u));

    applyFilters();
    toast("資料已更新", "ok");
  } catch (err) {
    console.error("loadUsers error:", err);
    toast("讀取失敗", "err");
  } finally {
    refreshSaveAllButton_();
    applyView_();
  }
}

function applyFilters() {
  const keywordRaw = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const activeChip = document.querySelector(".chip.active");
  const filter = activeChip ? activeChip.dataset.filter : "ALL";

  filteredUsers = allUsers.filter((u) => {
    const audit = normalizeAudit_(u.audit);
    if (filter !== "ALL" && audit !== filter) return false;

    if (keywordRaw) {
      const hay = `${u.userId} ${u.displayName || ""} ${u.masterCode || ""}`.toLowerCase();
      if (!hay.includes(keywordRaw)) return false;
    }
    return true;
  });

  filteredUsers.sort((a, b) => compareBy_(a, b, sortKey, sortDir));

  renderTable();
  updateSummary();
  updateKpis_();
  updateFooter();
  syncCheckAll_();
  updateBulkBar_();
  refreshSaveAllButton_();
  applyView_();

  if (savingAll) setEditingEnabled_(false);
}

function updateSummary() {
  const el = document.getElementById("summaryText");
  if (!el) return;

  const total = allUsers.length;
  const approved = allUsers.filter((u) => normalizeAudit_(u.audit) === "通過").length;
  const pending = allUsers.filter((u) => normalizeAudit_(u.audit) === "待審核").length;
  const rejected = allUsers.filter((u) => normalizeAudit_(u.audit) === "拒絕").length;
  const maintenance = allUsers.filter((u) => normalizeAudit_(u.audit) === "系統維護").length;

  el.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected} / 維護 ${maintenance}）`;
}

function updateKpis_() {
  const total = allUsers.length;
  const approved = allUsers.filter((u) => normalizeAudit_(u.audit) === "通過").length;
  const pending = allUsers.filter((u) => normalizeAudit_(u.audit) === "待審核").length;
  const rejected = allUsers.filter((u) => normalizeAudit_(u.audit) === "拒絕").length;
  const disabled = allUsers.filter((u) => normalizeAudit_(u.audit) === "停用").length;
  const maintenance = allUsers.filter((u) => normalizeAudit_(u.audit) === "系統維護").length;

  setText_("kpiTotal", total);
  setText_("kpiApproved", approved);
  setText_("kpiPending", pending);
  setText_("kpiRejected", rejected);
  setText_("kpiDisabled", disabled);
  setText_("kpiMaintenance", maintenance);
}

function updateFooter() {
  const el = document.getElementById("footerStatus");
  if (!el) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const dirtyCount = dirtyMap.size;
  const dirtyText = dirtyCount ? `，未儲存 ${dirtyCount} 筆` : "";

  const keyword = document.getElementById("searchInput")?.value.trim();
  const searchHint = keyword ? "（搜尋中）" : "";

  el.textContent = `最後更新：${hh}:${mm}:${ss}，目前顯示 ${filteredUsers.length} 筆${searchHint}${dirtyText}`;
}

/* ========= Sorting ========= */
function bindSorting_() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      if (savingAll) return;
      const key = th.dataset.sort;
      if (!key) return;

      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = key === "createdAt" ? "desc" : "asc";
      }
      applyFilters();
    });
  });
}

function compareBy_(a, b, key, dir) {
  const sgn = dir === "asc" ? 1 : -1;

  const get = (u) => {
    if (key === "index") return 0;
    if (key === "expiry") return getExpiryDiff_(u);
    if (key === "isMaster") return u.masterCode ? 1 : 0;
    return u[key];
  };

  const av = get(a);
  const bv = get(b);

  if (key === "pushEnabled" || key === "personalStatusEnabled" || key === "scheduleEnabled") {
    const na = String(av) === "是" ? 1 : 0;
    const nb = String(bv) === "是" ? 1 : 0;
    return (na - nb) * sgn;
  }

  if (key === "usageDays" || key === "isMaster") {
    const na = Number(av || 0);
    const nb = Number(bv || 0);
    return (na - nb) * sgn;
  }

  if (key === "createdAt") {
    const da = toTime_(av);
    const db = toTime_(bv);
    return (da - db) * sgn;
  }

  if (key === "startDate") {
    const da = toTime_(String(av || "") + "T00:00:00");
    const db = toTime_(String(bv || "") + "T00:00:00");
    return (da - db) * sgn;
  }

  const sa = String(av ?? "").toLowerCase();
  const sb = String(bv ?? "").toLowerCase();
  if (sa < sb) return -1 * sgn;
  if (sa > sb) return 1 * sgn;
  return 0;
}

function toTime_(v) {
  if (!v) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const d = new Date(s.includes(" ") ? s.replace(" ", "T") : s);
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

function getExpiryDiff_(u) {
  if (!u.startDate || !u.usageDays) return 999999;

  const start = new Date(String(u.startDate) + "T00:00:00");
  if (isNaN(start.getTime())) return 999999;

  const usage = Number(u.usageDays);
  if (!Number.isFinite(usage) || usage <= 0) return 999999;

  const last = new Date(start.getTime() + (usage - 1) * 86400000);
  last.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.floor((last - today) / 86400000);
}

/* ========= Selection + Bulk ========= */
function bindBulk_() {
  document.getElementById("checkAll")?.addEventListener("change", () => {
    if (savingAll) return;
    const checked = !!document.getElementById("checkAll").checked;
    filteredUsers.forEach((u) => (checked ? selectedIds.add(u.userId) : selectedIds.delete(u.userId)));
    renderTable();
    updateBulkBar_();
    syncCheckAll_();
  });

  document.getElementById("bulkClear")?.addEventListener("click", () => {
    if (savingAll) return;
    selectedIds.clear();
    renderTable();
    updateBulkBar_();
    syncCheckAll_();
  });

  document.getElementById("bulkApply")?.addEventListener("click", () => bulkApply_());
  document.getElementById("bulkDelete")?.addEventListener("click", () => bulkDelete_());
}

function updateBulkBar_() {
  const bar = document.getElementById("bulkBar");
  const countEl = document.getElementById("bulkCount");
  if (!bar || !countEl) return;

  const n = selectedIds.size;
  if (!n) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  countEl.textContent = `已選取 ${n} 筆`;
}

function hideBulkBar_() {
  const bar = document.getElementById("bulkBar");
  if (bar) bar.hidden = true;
}

function syncCheckAll_() {
  const checkAll = document.getElementById("checkAll");
  const mobile = document.getElementById("mobileCheckAll");
  const hint = document.getElementById("mobileCheckAllHint");
  const total = filteredUsers.length;

  const setState = (el, checked, indeterminate) => {
    if (!el) return;
    el.checked = checked;
    el.indeterminate = indeterminate;
  };

  const selCount = filteredUsers.filter((u) => selectedIds.has(u.userId)).length;
  if (hint) hint.textContent = `（${selCount}/${total}）`;

  if (!total) {
    setState(checkAll, false, false);
    setState(mobile, false, false);
    return;
  }

  setState(checkAll, selCount === total, selCount > 0 && selCount < total);
  setState(mobile, selCount === total, selCount > 0 && selCount < total);
}

async function bulkApply_() {
  if (savingAll) return;

  const audit = document.getElementById("bulkAudit")?.value || "";
  const pushEnabled = document.getElementById("bulkPush")?.value || "";
  const personalStatusEnabled = document.getElementById("bulkPersonalStatus")?.value || "";
  const scheduleEnabled = document.getElementById("bulkScheduleEnabled")?.value || "";

  const usageDaysRaw = String(document.getElementById("bulkUsageDays")?.value || "").trim();
  const usageDays = usageDaysRaw ? Number(usageDaysRaw) : null;
  if (usageDaysRaw && (!Number.isFinite(usageDays) || usageDays <= 0)) {
    toast("批次期限(天) 請輸入大於 0 的數字", "err");
    return;
  }

  if (!audit && !pushEnabled && !personalStatusEnabled && !scheduleEnabled && !usageDaysRaw) {
    toast("請先選擇要套用的批次欄位", "err");
    return;
  }

  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  ids.forEach((id) => {
    const u = allUsers.find((x) => x.userId === id);
    if (!u) return;

    if (audit) u.audit = normalizeAudit_(audit);
    if (usageDaysRaw) u.usageDays = String(usageDays);

    if (normalizeAudit_(u.audit) !== "通過") u.pushEnabled = "否";
    else if (pushEnabled) u.pushEnabled = pushEnabled;

    if (personalStatusEnabled) u.personalStatusEnabled = personalStatusEnabled;
    if (scheduleEnabled) u.scheduleEnabled = scheduleEnabled;

    markDirty_(id, u);
  });

  applyFilters();
  toast("已套用到選取（尚未儲存）", "ok");
}

async function bulkDelete_() {
  if (savingAll) return;

  const btn = document.getElementById("bulkDelete");
  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  const okConfirm = confirm(`確定要批次刪除？\n\n共 ${ids.length} 筆。\n此操作不可復原。`);
  if (!okConfirm) return;

  const dirtySelected = ids.filter((id) => dirtyMap.has(id)).length;
  if (dirtySelected) {
    const ok2 = confirm(`注意：選取中有 ${dirtySelected} 筆「未儲存」的更動。\n仍要繼續刪除嗎？`);
    if (!ok2) return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "刪除中...";
  }

  let okCount = 0;
  let failCount = 0;

  for (const id of ids) {
    const ok = await deleteUser(id);
    ok ? okCount++ : failCount++;
    await sleep_(80);
  }

  selectedIds.clear();
  hideBulkBar_();

  if (btn) {
    btn.disabled = false;
    btn.textContent = "批次刪除";
  }

  if (failCount === 0) toast(`批次刪除完成：${okCount} 筆`, "ok");
  else toast(`批次刪除：成功 ${okCount} / 失敗 ${failCount}`, "err");

  await loadUsers();
}

/* ========= Table ========= */
function renderTable() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  refreshSortIndicators_();

  if (!filteredUsers.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="15">無資料</td>`;
    tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();

  filteredUsers.forEach((u, i) => {
    const expiry = getExpiryInfo(u);
    const pushEnabled = (u.pushEnabled || "否") === "是" ? "是" : "否";
    const personalStatusEnabled = (u.personalStatusEnabled || "否") === "是" ? "是" : "否";
    const scheduleEnabled = (u.scheduleEnabled || "否") === "是" ? "是" : "否";

    const audit = normalizeAudit_(u.audit);
    const isMaster = u.masterCode ? "是" : "否";
    const isDirty = dirtyMap.has(u.userId);

    const pushDisabled = audit !== "通過" ? "disabled" : "";

    const tr = document.createElement("tr");
    tr.dataset.userid = u.userId;
    if (isDirty) tr.classList.add("dirty");

    tr.innerHTML = `
      <td class="sticky-col col-check" data-label="選取">
        <input class="row-check" type="checkbox" ${selectedIds.has(u.userId) ? "checked" : ""} aria-label="選取此列">
      </td>

      <td data-label="#">${i + 1}</td>
      <td data-label="userId"><span class="mono">${escapeHtml(u.userId)}</span></td>
      <td data-label="顯示名稱">${escapeHtml(u.displayName || "")}</td>
      <td data-label="建立時間"><span class="mono">${escapeHtml(u.createdAt || "")}</span></td>

      <td data-label="開始使用">
        <input type="date" data-field="startDate" value="${escapeHtml(u.startDate || "")}">
      </td>
      <td data-label="期限(天)">
        <input type="number" min="1" data-field="usageDays" value="${escapeHtml(u.usageDays || "")}">
      </td>

      <td data-label="使用狀態">
        <span class="expiry-pill ${expiry.cls}">${escapeHtml(expiry.text)}</span>
      </td>

      <td data-label="審核狀態">
        <select data-field="audit" aria-label="審核狀態">
          ${AUDIT_ENUM.map((v) => auditOption(v, audit)).join("")}
        </select>
        <span class="audit-badge ${auditClass_(audit)}">${escapeHtml(audit)}</span>
      </td>

      <td data-label="師傅編號">
        <input type="text" data-field="masterCode" placeholder="師傅編號" value="${escapeHtml(u.masterCode || "")}">
      </td>
      <td data-label="是否師傅">${isMaster}</td>

      <td data-label="是否推播">
        <select data-field="pushEnabled" aria-label="是否推播" ${pushDisabled}>
          <option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="個人狀態開通">
        <select data-field="personalStatusEnabled" aria-label="個人狀態開通">
          <option value="否" ${personalStatusEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${personalStatusEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="排班表開通">
        <select data-field="scheduleEnabled" aria-label="排班表開通">
          <option value="否" ${scheduleEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${scheduleEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="操作">
        <div class="actions">
          ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : `<span class="row-hint">-</span>`}
          <button class="btn danger btn-del" type="button">刪除</button>
        </div>
      </td>
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  if (savingAll) {
    tbody.querySelectorAll("input, select, button").forEach((el) => (el.disabled = true));
  }
}

function refreshSortIndicators_() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    const key = th.dataset.sort;
    const base = th.textContent.replace(/[↑↓]\s*$/, "").trim();
    th.textContent = base;

    if (key === sortKey) {
      const ind = document.createElement("span");
      ind.className = "sort-ind";
      ind.textContent = sortDir === "asc" ? "↑" : "↓";
      th.appendChild(ind);
    }
  });
}

/* ========= Delegation ========= */
function bindTableDelegation_() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;

  tbody.addEventListener("change", (e) => {
    if (savingAll) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.classList.contains("row-check")) {
      const row = t.closest("tr");
      const userId = row?.dataset.userid;
      if (!userId) return;
      t.checked ? selectedIds.add(userId) : selectedIds.delete(userId);
      updateBulkBar_();
      syncCheckAll_();
      return;
    }

    if (t.matches("[data-field]")) handleRowFieldChange_(t);
  });

  tbody.addEventListener("input", (e) => {
    if (savingAll) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches("input[data-field]")) handleRowFieldChange_(t);
  });

  tbody.addEventListener("click", async (e) => {
    if (savingAll) return;

    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (!btn) return;

    const row = btn.closest("tr");
    const userId = row?.dataset.userid;
    if (!userId) return;

    if (btn.classList.contains("btn-del")) {
      await handleRowDelete_(row, userId, btn);
    }
  });
}

function handleRowFieldChange_(fieldEl) {
  const row = fieldEl.closest("tr");
  const userId = row?.dataset.userid;
  if (!row || !userId) return;

  const u = allUsers.find((x) => x.userId === userId);
  if (!u) return;

  const field = fieldEl.getAttribute("data-field");
  if (!field) return;

  const value = readFieldValue_(fieldEl);

  if (field === "usageDays") u.usageDays = String(value || "");
  else if (field === "startDate") u.startDate = String(value || "");
  else if (field === "masterCode") u.masterCode = String(value || "");
  else if (field === "audit") u.audit = normalizeAudit_(value || "待審核");
  else if (field === "pushEnabled") u.pushEnabled = String(value || "否");
  else if (field === "personalStatusEnabled") u.personalStatusEnabled = String(value || "否");
  else if (field === "scheduleEnabled") u.scheduleEnabled = String(value || "否");

  const audit = normalizeAudit_(u.audit);
  const pushSel = row.querySelector('select[data-field="pushEnabled"]');

  if (audit !== "通過") {
    u.pushEnabled = "否";
    if (pushSel) {
      pushSel.value = "否";
      pushSel.disabled = true;
    }
  } else {
    if (pushSel) pushSel.disabled = false;
  }

  if (field === "audit") {
    const badge = row.querySelector(".audit-badge");
    if (badge) {
      badge.textContent = audit;
      badge.className = `audit-badge ${auditClass_(audit)}`;
    }
  }

  const exp = getExpiryInfo(u);
  const pill = row.querySelector(".expiry-pill");
  if (pill) {
    pill.className = `expiry-pill ${exp.cls}`;
    pill.textContent = exp.text;
  }

  markDirty_(userId, u);
  const isDirty = dirtyMap.has(userId);
  row.classList.toggle("dirty", isDirty);

  const actions = row.querySelector(".actions");
  if (actions) {
    const dot = actions.querySelector(".dirty-dot");
    const hint = actions.querySelector(".row-hint");
    if (isDirty) {
      if (!dot) {
        if (hint) hint.remove();
        actions.insertAdjacentHTML("afterbegin", `<span class="dirty-dot" title="未儲存"></span>`);
      }
    } else {
      if (dot) dot.remove();
      if (!actions.querySelector(".row-hint"))
        actions.insertAdjacentHTML("afterbegin", `<span class="row-hint">-</span>`);
    }
  }

  updateFooter();
  updateSummary();
  updateKpis_();
  refreshSaveAllButton_();
}

function readFieldValue_(el) {
  if (el instanceof HTMLInputElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  return "";
}

async function handleRowDelete_(row, userId, delBtn) {
  const u = allUsers.find((x) => x.userId === userId);
  const okConfirm = confirm(
    `確定要刪除使用者？\n\nuserId: ${userId}\n顯示名稱: ${u?.displayName || ""}\n\n此操作不可復原。`
  );
  if (!okConfirm) return;

  delBtn.disabled = true;
  const oldText = delBtn.textContent;
  delBtn.textContent = "刪除中...";

  const ok = await deleteUser(userId);

  delBtn.disabled = false;
  delBtn.textContent = oldText || "刪除";

  if (ok) {
    toast("刪除完成", "ok");
    selectedIds.delete(userId);

    allUsers = allUsers.filter((x) => x.userId !== userId);
    filteredUsers = filteredUsers.filter((x) => x.userId !== userId);
    originalMap.delete(userId);
    dirtyMap.delete(userId);

    applyFilters();
  } else {
    toast("刪除失敗", "err");
  }
}

/* ========= Save All Dirty ========= */
async function saveAllDirty_() {
  const dirtyIds = Array.from(dirtyMap.keys());
  if (!dirtyIds.length) {
    toast("目前沒有需要儲存的變更", "ok");
    return;
  }

  savingAll = true;
  setEditingEnabled_(false);
  refreshSaveAllButton_();

  try {
    const items = dirtyIds
      .map((userId) => allUsers.find((x) => x.userId === userId))
      .filter(Boolean)
      .map((u) => {
        const finalAudit = normalizeAudit_(u.audit);
        const finalPush = finalAudit !== "通過" ? "否" : u.pushEnabled || "否";
        return {
          userId: u.userId,
          audit: finalAudit,
          startDate: u.startDate || "",
          usageDays: u.usageDays || "",
          masterCode: u.masterCode || "",
          pushEnabled: finalPush,
          personalStatusEnabled: u.personalStatusEnabled || "否",
          scheduleEnabled: u.scheduleEnabled || "否",
        };
      });

    document.getElementById("footerStatus") &&
      (document.getElementById("footerStatus").textContent = `儲存中：1/1（共 ${items.length} 筆）`);

    const ret = await updateUsersBatch(items);

    if (ret && ret.okCount) {
      const failedSet = new Set((ret.fail || []).map((x) => String(x.userId || "").trim()));
      items.forEach((it) => {
        const id = it.userId;
        if (!id || failedSet.has(id)) return;

        const u = allUsers.find((x) => x.userId === id);
        if (!u) return;

        u.audit = it.audit;
        u.startDate = it.startDate;
        u.usageDays = it.usageDays;
        u.masterCode = it.masterCode;
        u.pushEnabled = it.audit !== "通過" ? "否" : it.pushEnabled;
        u.personalStatusEnabled = it.personalStatusEnabled;
        u.scheduleEnabled = it.scheduleEnabled;

        originalMap.set(id, snapshot_(u));
        dirtyMap.delete(id);
      });

      applyFilters();
    } else {
      applyFilters();
    }

    refreshSaveAllButton_();
    updateSummary();
    updateKpis_();
    updateFooter();

    if (ret && ret.failCount === 0) toast(`全部儲存完成：${ret.okCount} 筆`, "ok");
    else toast(`儲存完成：成功 ${ret?.okCount || 0} / 失敗 ${ret?.failCount || 0}`, "err");
  } finally {
    savingAll = false;
    setEditingEnabled_(true);
    refreshSaveAllButton_();
  }
}

/* ========= Helpers ========= */
function auditOption(value, current) {
  const sel = value === current ? "selected" : "";
  return `<option value="${value}" ${sel}>${value}</option>`;
}

function auditClass_(audit) {
  switch (normalizeAudit_(audit)) {
    case "通過": return "approved";
    case "待審核": return "pending";
    case "拒絕": return "rejected";
    case "停用": return "disabled";
    case "系統維護": return "maintenance";
    default: return "other";
  }
}

function getExpiryInfo(u) {
  if (!u.startDate || !u.usageDays) return { cls: "unset", text: "未設定" };

  const start = new Date(String(u.startDate) + "T00:00:00");
  if (isNaN(start.getTime())) return { cls: "unset", text: "未設定" };

  const usage = Number(u.usageDays);
  if (!Number.isFinite(usage) || usage <= 0) return { cls: "unset", text: "未設定" };

  const last = new Date(start.getTime() + (usage - 1) * 86400000);
  last.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = Math.floor((last - today) / 86400000);

  if (diff < 0) return { cls: "expired", text: `已過期（超 ${Math.abs(diff)} 天）` };
  return { cls: "active", text: `使用中（剩 ${diff} 天）` };
}

function snapshot_(u) {
  return JSON.stringify({
    userId: u.userId,
    audit: normalizeAudit_(u.audit),
    startDate: u.startDate || "",
    usageDays: String(u.usageDays || ""),
    masterCode: u.masterCode || "",
    pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否",
    personalStatusEnabled: (u.personalStatusEnabled || "否") === "是" ? "是" : "否",
    scheduleEnabled: (u.scheduleEnabled || "否") === "是" ? "是" : "否",
  });
}

function markDirty_(userId, u) {
  const orig = originalMap.get(userId) || "";
  const now = snapshot_(u);
  if (orig !== now) dirtyMap.set(userId, true);
  else dirtyMap.delete(userId);
}

/* ========= API ========= */
async function updateUsersBatch(items) {
  try {
    const res = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "updateUsersBatch", items }),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error("updateUsersBatch error:", err);
    return { ok: false, error: String(err) };
  }
}

async function deleteUser(userId) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "deleteUser");
    fd.append("userId", userId);

    const res = await fetch(API_BASE_URL, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    return !!json.ok;
  } catch (err) {
    console.error("deleteUser error:", err);
    return false;
  }
}

/* ========= Toast ========= */
function toast(msg, type) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.classList.remove("show", "ok", "err");
  el.textContent = msg;
  el.classList.add(type === "err" ? "err" : "ok");

  requestAnimationFrame(() => el.classList.add("show"));

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

/* ========= Utils ========= */
function setText_(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v ?? "-");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function sleep_(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* =========================================================
 * ✅ Push Panel（device agnostic layout）
 * ========================================================= */
let pushingNow = false;

function ensurePushPanel_() {
  const panelHead = document.querySelector(".panel-head");
  if (!panelHead) return;
  if (document.getElementById("pushPanel")) return;

  const wrap = document.createElement("div");
  wrap.id = "pushPanel";
  wrap.style.flex = "0 0 100%";
  wrap.style.width = "100%";
  wrap.style.marginTop = "10px";

  wrap.innerHTML = `
    <div class="pushbar">
      <div class="pushbar-left">
        <span class="bulk-pill" style="border-color:rgba(147,51,234,.35); background:rgba(147,51,234,.12); color:rgb(167,139,250);">
          推播
        </span>

        <div class="bulk-group">
          <label class="bulk-label" for="pushTarget">對象</label>
          <select id="pushTarget" class="select">
            <option value="selected">選取的（勾選）</option>
            <option value="filtered">目前篩選結果</option>
            <option value="all">全部</option>
            <option value="single">單一 userId</option>
          </select>
        </div>

        <div class="bulk-group" id="pushSingleWrap" style="display:none;">
          <label class="bulk-label" for="pushSingleUserId">userId</label>
          <input id="pushSingleUserId" class="select push-single" type="text"
            placeholder="貼上 userId（LINE userId）" />
        </div>

        <div class="bulk-group">
          <label class="bulk-label" style="user-select:none;">displayName 前綴</label>
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text); user-select:none;">
            <input id="pushIncludeName" type="checkbox" />
            加上 displayName
          </label>
        </div>
      </div>

      <div class="pushbar-right">
        <div class="bulk-group" style="flex:1; width:100%;">
          <input id="pushMessage" class="select push-message" type="text"
            placeholder="輸入要推播的訊息…" />
        </div>

        <button id="pushSendBtn" class="btn primary" type="button">送出推播</button>
      </div>
    </div>
  `;

  panelHead.appendChild(wrap);

  const targetSel = document.getElementById("pushTarget");
  const singleWrap = document.getElementById("pushSingleWrap");

  targetSel?.addEventListener("change", () => {
    const v = targetSel.value;
    if (singleWrap) singleWrap.style.display = v === "single" ? "" : "none";
  });

  document.getElementById("pushSendBtn")?.addEventListener("click", async () => {
    if (savingAll || pushingNow) return;
    await pushSend_();
  });

  pushSetEnabled_(!savingAll);
}

function pushSetEnabled_(enabled) {
  const lock = !enabled || pushingNow;
  ["pushTarget","pushSingleUserId","pushIncludeName","pushMessage","pushSendBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = lock;
  });

  const btn = document.getElementById("pushSendBtn");
  if (btn) btn.textContent = pushingNow ? "推播中…" : "送出推播";
}

function buildPushTargetIds_(target) {
  if (target === "single") {
    const uid = String(document.getElementById("pushSingleUserId")?.value || "").trim();
    return uid ? [uid] : [];
  }
  if (target === "selected") return Array.from(selectedIds);
  if (target === "filtered") return filteredUsers.map((u) => u.userId).filter(Boolean);
  if (target === "all") return allUsers.map((u) => u.userId).filter(Boolean);
  return [];
}

async function pushSend_() {
  const target = String(document.getElementById("pushTarget")?.value || "selected");
  const includeDisplayName = !!document.getElementById("pushIncludeName")?.checked;
  const message = String(document.getElementById("pushMessage")?.value || "").trim();

  if (!message) {
    toast("請輸入推播內容", "err");
    return;
  }

  const userIds = buildPushTargetIds_(target);
  if (!userIds.length) {
    toast(target === "selected" ? "請先勾選要推播的使用者" : "找不到推播對象", "err");
    return;
  }

  const n = userIds.length;
  const warn = includeDisplayName ? "⚠️ 勾選 displayName 前綴：後端可能需要逐人處理（較慢）。\n\n" : "";
  if (target === "all" || target === "filtered" || n > 30) {
    const ok = confirm(`即將推播給 ${n} 位使用者。\n\n${warn}確定要送出嗎？`);
    if (!ok) return;
  }

  pushingNow = true;
  pushSetEnabled_(false);

  try {
    const ret = await pushMessageBatch_(userIds, message, includeDisplayName);
    const okCount = Number(ret?.okCount || 0);
    const failCount = Number(ret?.failCount || 0);

    if (failCount === 0) toast(`推播完成：成功 ${okCount} 筆`, "ok");
    else toast(`推播完成：成功 ${okCount} / 失敗 ${failCount}`, "err");

    if (ret?.fail?.length) console.warn("push fail:", ret.fail);
  } catch (e) {
    console.error("pushSend error:", e);
    toast("推播失敗（請看 console）", "err");
  } finally {
    pushingNow = false;
    pushSetEnabled_(!savingAll);
  }
}

async function pushMessageBatch_(userIds, message, includeDisplayName) {
  if (!API_BASE_URL) throw new Error("API_BASE_URL not initialized");

  const res = await fetch(API_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      mode: "pushMessage",
      userIds,
      message,
      includeDisplayName: includeDisplayName ? "是" : "否",
    }),
  });

  return await res.json().catch(() => ({}));
}
