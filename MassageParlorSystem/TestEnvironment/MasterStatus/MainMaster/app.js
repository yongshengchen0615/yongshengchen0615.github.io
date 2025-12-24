// ★ Users API（不要動）
const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbxciJzh9cRdjdxqQ-iq_mx-bCsETzyasBBKkzGmibkVG_bc4pjASwrR0Kxmo037Xg7Z/exec";

let allUsers = [];
let filteredUsers = [];

// sort state
let sortKey = "createdAt";
let sortDir = "desc"; // asc | desc

// selection state
const selectedIds = new Set();

// dirty state
const originalMap = new Map(); // userId -> JSON string snapshot
const dirtyMap = new Map(); // userId -> true

// toast timer
let toastTimer = null;

// save-all runtime
let savingAll = false;

document.addEventListener("DOMContentLoaded", () => {
  initTheme_();

  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme_);

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn)
    reloadBtn.addEventListener("click", async () => {
      if (savingAll) return;
      selectedIds.clear();
      hideBulkBar_();
      await loadUsers();
    });

  const clearSearchBtn = document.getElementById("clearSearchBtn");
  if (clearSearchBtn)
    clearSearchBtn.addEventListener("click", () => {
      const si = document.getElementById("searchInput");
      if (si) si.value = "";

      const box = si?.closest(".search-box");
      box?.classList.remove("is-searching");

      applyFilters();
    });

  ensureSaveAllButton_(); // ✅新增：一鍵儲存（JS 插入，不改 HTML）
ensureMobileSelectAll_(); // ✅新增：手機版全選
  bindFilter();
  bindSorting_();
  bindBulk_();
  bindTableDelegation_(); // ✅事件委派：只綁一次

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener(
      "input",
      debounce(() => {
        const box = searchInput.closest(".search-box");
        const hasValue = searchInput.value.trim().length > 0;
        box?.classList.toggle("is-searching", hasValue);
        applyFilters();
      }, 180)
    );

    const box = searchInput.closest(".search-box");
    box?.classList.toggle("is-searching", searchInput.value.trim().length > 0);
  }


  loadUsers();
});

/* ========= Theme ========= */

function initTheme_() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeButtonText_();
}
function toggleTheme_() {
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

/* ========= Save All Button ========= */

function ensureSaveAllButton_() {
  const topRight = document.querySelector(".topbar-right");
  if (!topRight) return;

  // 若已存在就不重複插
  if (document.getElementById("saveAllBtn")) return;

  const btn = document.createElement("button");
  btn.id = "saveAllBtn";
  btn.type = "button";
  btn.className = "btn primary";
  btn.textContent = "儲存全部變更";
  btn.disabled = true; // 初始沒有 dirty

  btn.addEventListener("click", async () => {
    if (savingAll) return;
    await saveAllDirty_();
  });

  // 插到 reloadBtn 前面（或最後）
  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn && reloadBtn.parentElement === topRight) {
    topRight.insertBefore(btn, reloadBtn);
  } else {
    topRight.appendChild(btn);
  }

  refreshSaveAllButton_();
}
function ensureMobileSelectAll_() {
  // 插到 panel-head filters 區塊（搜尋/Chip 那一排）
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
    const checked = !!mobile.checked;

    // 全選只針對「目前 filteredUsers」（符合你的桌機版行為）
    filteredUsers.forEach((u) => {
      if (checked) selectedIds.add(u.userId);
      else selectedIds.delete(u.userId);
    });

    renderTable();
    updateBulkBar_();
    syncCheckAll_(); // 會同步 indeterminate / checked
  });
}


function refreshSaveAllButton_() {
  const btn = document.getElementById("saveAllBtn");
  if (!btn) return;

  const dirtyCount = dirtyMap.size;
  btn.disabled = savingAll || dirtyCount === 0;
  btn.textContent = savingAll
    ? `儲存中...`
    : dirtyCount
      ? `儲存全部變更（${dirtyCount}）`
      : "儲存全部變更";
}

/* ========= Filters ========= */

function bindFilter() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters();
    });
  });
}

async function loadUsers() {
  try {
    const res = await fetch(API_BASE_URL + "?mode=listUsers");
    const json = await res.json();
    if (!json.ok) throw new Error("listUsers not ok");

    allUsers = (json.users || []).map((u) => ({
      ...u,
      personalStatusEnabled: (u.personalStatusEnabled || "否") === "是" ? "是" : "否",
      scheduleEnabled: (u.scheduleEnabled || "否") === "是" ? "是" : "否",
      pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否",
      audit: u.audit || "待審核",
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
  }
}

function applyFilters() {
  const keywordRaw = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const activeChip = document.querySelector(".chip.active");
  const filter = activeChip ? activeChip.dataset.filter : "ALL";

  filteredUsers = allUsers.filter((u) => {
    if (filter !== "ALL" && String(u.audit || "待審核") !== filter) return false;

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
}

function updateSummary() {
  const el = document.getElementById("summaryText");
  if (!el) return;

  const total = allUsers.length;
  const approved = allUsers.filter((u) => (u.audit || "待審核") === "通過").length;
  const pending = allUsers.filter((u) => (u.audit || "待審核") === "待審核").length;
  const rejected = allUsers.filter((u) => (u.audit || "待審核") === "拒絕").length;

  el.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected}）`;
}

function updateKpis_() {
  const total = allUsers.length;
  const approved = allUsers.filter((u) => (u.audit || "待審核") === "通過").length;
  const pending = allUsers.filter((u) => (u.audit || "待審核") === "待審核").length;
  const rejected = allUsers.filter((u) => (u.audit || "待審核") === "拒絕").length;
  const disabled = allUsers.filter((u) => (u.audit || "") === "停用").length;

  setText_("kpiTotal", total);
  setText_("kpiApproved", approved);
  setText_("kpiPending", pending);
  setText_("kpiRejected", rejected);
  setText_("kpiDisabled", disabled);
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
      const key = th.dataset.sort;
      if (!key) return;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
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

  if (key === "createdAt" || key === "startDate") {
    const da = toTime_(av);
    const db = toTime_(bv);
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
  const d = new Date(String(v).replace(" ", "T"));
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

function getExpiryDiff_(u) {
  if (!u.startDate || !u.usageDays) return 999999;
  const start = new Date(String(u.startDate).replace(" ", "T"));
  if (isNaN(start.getTime())) return 999999;
  const end = new Date(start.getTime() + Number(u.usageDays) * 86400000);
  return Math.ceil((end - new Date()) / 86400000);
}

/* ========= Selection + Bulk ========= */

function bindBulk_() {
  const checkAll = document.getElementById("checkAll");
  if (checkAll) {
    checkAll.addEventListener("change", () => {
      const checked = !!checkAll.checked;
      filteredUsers.forEach((u) => {
        if (checked) selectedIds.add(u.userId);
        else selectedIds.delete(u.userId);
      });
      renderTable();
      updateBulkBar_();
      syncCheckAll_();
    });
  }

  const bulkClear = document.getElementById("bulkClear");
  if (bulkClear)
    bulkClear.addEventListener("click", () => {
      selectedIds.clear();
      renderTable();
      updateBulkBar_();
      syncCheckAll_();
    });

  const bulkApply = document.getElementById("bulkApply");
  if (bulkApply) bulkApply.addEventListener("click", () => bulkApply_());

  const bulkDelete = document.getElementById("bulkDelete");
  if (bulkDelete) bulkDelete.addEventListener("click", () => bulkDelete_());
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

  if (hint) {
    const selCount = filteredUsers.filter((u) => selectedIds.has(u.userId)).length;
    hint.textContent = `（${selCount}/${total}）`;
  }

  if (!total) {
    setState(checkAll, false, false);
    setState(mobile, false, false);
    return;
  }

  const selCount = filteredUsers.filter((u) => selectedIds.has(u.userId)).length;
  const checked = selCount === total;
  const indeterminate = selCount > 0 && selCount < total;

  setState(checkAll, checked, indeterminate);
  setState(mobile, checked, indeterminate);
}


async function bulkApply_() {
  const audit = document.getElementById("bulkAudit")?.value || "";
  const pushEnabled = document.getElementById("bulkPush")?.value || "";
  const personalStatusEnabled = document.getElementById("bulkPersonalStatus")?.value || "";
  const scheduleEnabled = document.getElementById("bulkScheduleEnabled")?.value || "";

  if (!audit && !pushEnabled && !personalStatusEnabled && !scheduleEnabled) {
    toast("請先選擇要套用的批次欄位", "err");
    return;
  }

  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  ids.forEach((id) => {
    const u = allUsers.find((x) => x.userId === id);
    if (!u) return;

    if (audit) u.audit = audit;

    // 🔒 規則：審核狀態 ≠ 通過 → 推播必為否
    if ((u.audit || "待審核") !== "通過") {
      u.pushEnabled = "否";
    } else if (pushEnabled) {
      u.pushEnabled = pushEnabled;
    }

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
    if (ok) okCount++;
    else failCount++;
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

/* ========= Table (render only) ========= */

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
    const audit = u.audit || "待審核";
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
        <input type="date" data-field="startDate" value="${toInputDate(u.startDate)}">
      </td>
      <td data-label="期限(天)">
        <input type="number" min="1" data-field="usageDays" value="${escapeHtml(u.usageDays || "")}">
      </td>

      <td data-label="使用狀態">
        <span class="expiry-pill ${expiry.cls}">${escapeHtml(expiry.text)}</span>
      </td>

      <td data-label="審核狀態">
        <select data-field="audit" aria-label="審核狀態">
          ${auditOption("待審核", audit)}
          ${auditOption("通過", audit)}
          ${auditOption("拒絕", audit)}
          ${auditOption("停用", audit)}
          ${auditOption("其他", audit)}
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

/* ========= Table Delegation (ONE TIME) ========= */

function bindTableDelegation_() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;

  // checkbox / select / date / number changes
  tbody.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // row checkbox
    if (t.classList.contains("row-check")) {
      const row = t.closest("tr");
      const userId = row?.dataset.userid;
      if (!userId) return;
      if (t.checked) selectedIds.add(userId);
      else selectedIds.delete(userId);
      updateBulkBar_();
      syncCheckAll_();
      return;
    }

    // field changes (select/date)
    if (t.matches("[data-field]")) {
      handleRowFieldChange_(t);
      return;
    }
  });

  // text/number input (live)
  tbody.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches("input[data-field]")) {
      handleRowFieldChange_(t);
    }
  });

  // delete buttons
  tbody.addEventListener("click", async (e) => {
    if (savingAll) return;

    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (!btn) return;

    const row = btn.closest("tr");
    const userId = row?.dataset.userid;
    if (!userId) return;

    if (btn.classList.contains("btn-del")) {
      await handleRowDelete_(row, userId, btn);
      return;
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
  else if (field === "audit") u.audit = String(value || "待審核");
  else if (field === "pushEnabled") u.pushEnabled = String(value || "否");
  else if (field === "personalStatusEnabled") u.personalStatusEnabled = String(value || "否");
  else if (field === "scheduleEnabled") u.scheduleEnabled = String(value || "否");

  // 🔒 核心規則：審核狀態 ≠ 通過 → 推播強制否 + 禁用
  const audit = u.audit || "待審核";
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

  // badge
  if (field === "audit") {
    const badge = row.querySelector(".audit-badge");
    if (badge) {
      badge.textContent = audit;
      badge.className = `audit-badge ${auditClass_(audit)}`;
    }
  }

  // expiry pill
  const exp = getExpiryInfo(u);
  const pill = row.querySelector(".expiry-pill");
  if (pill) {
    pill.className = `expiry-pill ${exp.cls}`;
    pill.textContent = exp.text;
  }

  // dirty
  markDirty_(userId, u);
  const isDirty = dirtyMap.has(userId);
  row.classList.toggle("dirty", isDirty);

  // actions UI（點點/提示）
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
      if (!actions.querySelector(".row-hint")) {
        actions.insertAdjacentHTML("afterbegin", `<span class="row-hint">-</span>`);
      }
    }
  }

  updateFooter();
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

    // 移除 local model
    allUsers = allUsers.filter((x) => x.userId !== userId);
    filteredUsers = filteredUsers.filter((x) => x.userId !== userId);
    originalMap.delete(userId);
    dirtyMap.delete(userId);

    // 重新渲染以更新編號與統計
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
  refreshSaveAllButton_();

  // 避免使用者手滑 reload
  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn) reloadBtn.disabled = true;

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < dirtyIds.length; i++) {
    const userId = dirtyIds[i];
    const u = allUsers.find((x) => x.userId === userId);
    if (!u) {
      dirtyMap.delete(userId);
      continue;
    }

    // 🔒 再次 enforce 規則（保險）
    const finalAudit = u.audit || "待審核";
    const finalPush = finalAudit !== "通過" ? "否" : (u.pushEnabled || "否");

    const payload = {
      userId: u.userId,
      audit: finalAudit,
      startDate: u.startDate || "",
      usageDays: u.usageDays || "",
      masterCode: u.masterCode || "",
      pushEnabled: finalPush,
      personalStatusEnabled: u.personalStatusEnabled || "否",
      scheduleEnabled: u.scheduleEnabled || "否",
    };

    // UI：footer 顯示進度（不吵 toast）
    const el = document.getElementById("footerStatus");
    if (el) {
      el.textContent = `儲存中：${i + 1}/${dirtyIds.length}（userId: ${u.userId}）`;
    }

    const ok = await updateUser(payload);
    if (ok) {
      okCount++;

      // 同步回 model
      u.audit = finalAudit;
      u.pushEnabled = finalPush;

      // reset baseline
      originalMap.set(userId, snapshot_(u));
      dirtyMap.delete(userId);

      // 更新當下畫面 row（若 row 在目前 filteredUsers 視窗內）
      const row = document.querySelector(`#tbody tr[data-userid="${cssEscape_(userId)}"]`);
      if (row) {
        row.classList.remove("dirty");
        const actions = row.querySelector(".actions");
        if (actions) {
          const dot = actions.querySelector(".dirty-dot");
          if (dot) dot.remove();
          if (!actions.querySelector(".row-hint")) {
            actions.insertAdjacentHTML("afterbegin", `<span class="row-hint">-</span>`);
          }
        }
        const badge = row.querySelector(".audit-badge");
        if (badge) {
          badge.textContent = finalAudit;
          badge.className = `audit-badge ${auditClass_(finalAudit)}`;
        }
        const pushSel = row.querySelector('select[data-field="pushEnabled"]');
        if (pushSel) {
          pushSel.value = finalPush;
          pushSel.disabled = finalAudit !== "通過";
        }
        const exp = getExpiryInfo(u);
        const pill = row.querySelector(".expiry-pill");
        if (pill) {
          pill.className = `expiry-pill ${exp.cls}`;
          pill.textContent = exp.text;
        }
      }
    } else {
      failCount++;
      // 保留 dirty，不動 baseline
    }

    // 小節流，避免 GAS 扛不住（可調整/移除）
    await sleep_(60);
    refreshSaveAllButton_();
  }

  savingAll = false;
  if (reloadBtn) reloadBtn.disabled = false;

  // 最後統一更新 KPI/summary/footer
  updateSummary();
  updateKpis_();
  updateFooter();
  refreshSaveAllButton_();

  if (failCount === 0) toast(`全部儲存完成：${okCount} 筆`, "ok");
  else toast(`儲存完成：成功 ${okCount} / 失敗 ${failCount}`, "err");
}

/* ========= Helpers for options/badges/expiry ========= */

function auditOption(value, current) {
  const sel = value === current ? "selected" : "";
  return `<option value="${value}" ${sel}>${value}</option>`;
}

function auditClass_(audit) {
  switch (String(audit || "").trim()) {
    case "通過":
      return "approved";
    case "待審核":
      return "pending";
    case "拒絕":
      return "rejected";
    case "停用":
      return "disabled";
    default:
      return "other";
  }
}

function getExpiryInfo(u) {
  if (!u.startDate || !u.usageDays) return { cls: "unset", text: "未設定" };

  const start = new Date(String(u.startDate).replace(" ", "T"));
  if (isNaN(start.getTime())) return { cls: "unset", text: "未設定" };

  const end = new Date(start.getTime() + Number(u.usageDays) * 86400000);
  const diff = Math.ceil((end - new Date()) / 86400000);

  if (diff < 0) return { cls: "expired", text: `已過期（超 ${Math.abs(diff)} 天）` };
  return { cls: "active", text: `使用中（剩 ${diff} 天）` };
}

function toInputDate(str) {
  if (!str) return "";
  const d = new Date(String(str).replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/* ========= Dirty tracking ========= */

function snapshot_(u) {
  return JSON.stringify({
    userId: u.userId,
    audit: u.audit || "待審核",
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

async function updateUser({
  userId,
  audit,
  startDate,
  usageDays,
  masterCode,
  pushEnabled,
  personalStatusEnabled,
  scheduleEnabled,
}) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "updateUser");
    fd.append("userId", userId);
    fd.append("audit", audit);
    fd.append("startDate", startDate || "");
    fd.append("usageDays", usageDays || "");
    fd.append("masterCode", masterCode || "");
    fd.append("pushEnabled", pushEnabled || "否");
    fd.append("personalStatusEnabled", personalStatusEnabled || "否");
    fd.append("scheduleEnabled", scheduleEnabled || "否");

    const res = await fetch(API_BASE_URL, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    return !!json.ok;
  } catch (err) {
    console.error("updateUser error:", err);
    return false;
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

// CSS selector escape（避免 userId 含特殊字元）
function cssEscape_(s) {
  // 最小實作：足夠應付大多數情境；若 userId 都是字母數字其實用不到
  return String(s).replaceAll('"', '\\"').replaceAll("\\", "\\\\");
}
