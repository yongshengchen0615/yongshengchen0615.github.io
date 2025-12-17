// ★ 換成你的 GAS 最新部署網址
const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

let allUsers = [];
let filteredUsers = [];

// sort state
let sortKey = "createdAt";
let sortDir = "desc"; // asc | desc

// selection state
const selectedIds = new Set();

// dirty state
const originalMap = new Map(); // userId -> JSON string snapshot
const dirtyMap = new Map();    // userId -> true

document.addEventListener("DOMContentLoaded", () => {
  initTheme_();

  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme_);

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn) reloadBtn.addEventListener("click", async () => {
    selectedIds.clear();
    hideBulkBar_();
    await loadUsers();
  });

  const clearSearchBtn = document.getElementById("clearSearchBtn");
  if (clearSearchBtn) clearSearchBtn.addEventListener("click", () => {
    const si = document.getElementById("searchInput");
    if (si) si.value = "";

    const box = si?.closest(".search-box");
    box?.classList.remove("is-searching");

    applyFilters();
  });

  bindFilter();
  bindSorting_();
  bindBulk_();

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(() => {
      const box = searchInput.closest(".search-box");
      const hasValue = searchInput.value.trim().length > 0;
      box?.classList.toggle("is-searching", hasValue);
      applyFilters();
    }, 180));

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
      // ✅確保新欄位存在
      personalStatusEnabled: (u.personalStatusEnabled || "否") === "是" ? "是" : "否",
      scheduleEnabled: (u.scheduleEnabled || "否") === "是" ? "是" : "否", // ✅新增
      pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否",
    }));

    originalMap.clear();
    dirtyMap.clear();

    for (const u of allUsers) {
      originalMap.set(u.userId, snapshot_(u));
    }

    applyFilters();
    toast("資料已更新", "ok");
  } catch (err) {
    console.error("loadUsers error:", err);
    toast("讀取失敗", "err");
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

  // ✅ 是/否 欄位排序（push / personalStatus / schedule）
  if (key === "pushEnabled" || key === "personalStatusEnabled" || key === "scheduleEnabled") {
    const na = String(av) === "是" ? 1 : 0;
    const nb = String(bv) === "是" ? 1 : 0;
    return (na - nb) * sgn;
  }

  // number
  if (key === "usageDays" || key === "isMaster") {
    const na = Number(av || 0);
    const nb = Number(bv || 0);
    return (na - nb) * sgn;
  }

  // date-ish
  if (key === "createdAt" || key === "startDate") {
    const da = toTime_(av);
    const db = toTime_(bv);
    return (da - db) * sgn;
  }

  // string
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
  if (bulkClear) bulkClear.addEventListener("click", () => {
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
  if (!checkAll) return;
  if (!filteredUsers.length) {
    checkAll.indeterminate = false;
    checkAll.checked = false;
    return;
  }
  const selCount = filteredUsers.filter((u) => selectedIds.has(u.userId)).length;
  checkAll.checked = selCount === filteredUsers.length;
  checkAll.indeterminate = selCount > 0 && selCount < filteredUsers.length;
}

async function bulkApply_() {
  const audit = document.getElementById("bulkAudit")?.value || "";
  const pushEnabled = document.getElementById("bulkPush")?.value || "";
  const personalStatusEnabled = document.getElementById("bulkPersonalStatus")?.value || "";
  const scheduleEnabled = document.getElementById("bulkScheduleEnabled")?.value || ""; // ✅新增

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

    // ✅ 個人狀態：純開關
    if (personalStatusEnabled) u.personalStatusEnabled = personalStatusEnabled;

    // ✅ 排班表：純開關
    if (scheduleEnabled) u.scheduleEnabled = scheduleEnabled;

    markDirty_(id, u);
  });

  applyFilters();
  toast("已套用到選取（尚未儲存）", "ok");
}

async function bulkDelete_() {
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

  filteredUsers.forEach((u, i) => {
    const expiry = getExpiryInfo(u);
    const pushEnabled = (u.pushEnabled || "否") === "是" ? "是" : "否";
    const personalStatusEnabled = (u.personalStatusEnabled || "否") === "是" ? "是" : "否";
    const scheduleEnabled = (u.scheduleEnabled || "否") === "是" ? "是" : "否";
    const audit = u.audit || "待審核";
    const isMaster = u.masterCode ? "是" : "否";
    const isDirty = dirtyMap.has(u.userId);

    const tr = document.createElement("tr");
    if (isDirty) tr.classList.add("dirty");

    tr.innerHTML = `
      <td class="sticky-col col-check" data-label="選取">
        <input class="row-check" type="checkbox" ${selectedIds.has(u.userId) ? "checked" : ""} aria-label="選取此列">
      </td>

      <td data-label="#">${i + 1}</td>
      <td data-label="userId"><span class="mono">${escapeHtml(u.userId)}</span></td>
      <td data-label="顯示名稱">${escapeHtml(u.displayName || "")}</td>
      <td data-label="建立時間"><span class="mono">${escapeHtml(u.createdAt || "")}</span></td>

      <td data-label="開始使用"><input type="date" class="date-input" value="${toInputDate(u.startDate)}"></td>
      <td data-label="期限(天)"><input type="number" class="days-input" min="1" value="${escapeHtml(u.usageDays || "")}"></td>

      <td data-label="使用狀態"><span class="expiry-pill ${expiry.cls}">${escapeHtml(expiry.text)}</span></td>

      <td data-label="審核狀態">
        <select class="audit-select" aria-label="審核狀態">
          ${auditOption("待審核", audit)}
          ${auditOption("通過", audit)}
          ${auditOption("拒絕", audit)}
          ${auditOption("停用", audit)}
          ${auditOption("其他", audit)}
        </select>
        <span class="audit-badge ${auditClass_(audit)}">${escapeHtml(audit)}</span>
      </td>

      <td data-label="師傅編號"><input type="text" class="master-code-input" placeholder="師傅編號" value="${escapeHtml(u.masterCode || "")}"></td>
      <td data-label="是否師傅">${isMaster}</td>

      <td data-label="是否推播">
        <select class="push-select" aria-label="是否推播">
          <option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="個人狀態開通">
        <select class="personal-status-select" aria-label="個人狀態開通">
          <option value="否" ${personalStatusEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${personalStatusEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="排班表開通">
        <select class="schedule-select" aria-label="排班表開通">
          <option value="否" ${scheduleEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${scheduleEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="操作">
        <div class="actions">
          ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : `<span class="row-hint">-</span>`}
          <button class="btn primary btn-save" ${isDirty ? "" : "disabled"}>儲存</button>
          <button class="btn danger btn-del">刪除</button>
        </div>
      </td>
    `;

    const rowCheck = tr.querySelector(".row-check");
    const dateInput = tr.querySelector(".date-input");
    const daysInput = tr.querySelector(".days-input");
    const masterInput = tr.querySelector(".master-code-input");
    const pushSelect = tr.querySelector(".push-select");
    const personalSelect = tr.querySelector(".personal-status-select");
    const scheduleSelect = tr.querySelector(".schedule-select");
    const auditSelect = tr.querySelector(".audit-select");
    const badge = tr.querySelector(".audit-badge");
    const saveBtn = tr.querySelector(".btn-save");
    const delBtn = tr.querySelector(".btn-del");

    // ✅ 初始渲染就套用規則：非通過 → 推播強制否 + 禁用
    if ((audit || "待審核") !== "通過") {
      pushSelect.value = "否";
      pushSelect.disabled = true;
    } else {
      pushSelect.disabled = false;
    }

    rowCheck.addEventListener("change", () => {
      if (rowCheck.checked) selectedIds.add(u.userId);
      else selectedIds.delete(u.userId);
      updateBulkBar_();
      syncCheckAll_();
    });

    const onAnyChange = () => {
      const v = auditSelect.value;
      badge.textContent = v;
      badge.className = `audit-badge ${auditClass_(v)}`;

      u.startDate = dateInput.value || "";
      u.usageDays = daysInput.value || "";
      u.masterCode = masterInput.value || "";
      u.audit = auditSelect.value || "待審核";

      // 先吃使用者選擇
      u.pushEnabled = pushSelect.value || "否";

      // 🔒 核心規則：審核狀態 ≠ 通過 → 推播強制否 + 禁用
      if (u.audit !== "通過") {
        u.pushEnabled = "否";
        pushSelect.value = "否";
        pushSelect.disabled = true;
      } else {
        pushSelect.disabled = false;
      }

      // ✅ 個人狀態：純開關
      u.personalStatusEnabled = personalSelect.value || "否";

      // ✅ 排班表：純開關
      u.scheduleEnabled = scheduleSelect.value || "否";

      markDirty_(u.userId, u);

      const exp = getExpiryInfo(u);
      const pill = tr.querySelector(".expiry-pill");
      if (pill) {
        pill.className = `expiry-pill ${exp.cls}`;
        pill.textContent = exp.text;
      }

      saveBtn.disabled = false;
      tr.classList.add("dirty");
      updateFooter();
    };

    dateInput.addEventListener("change", onAnyChange);
    daysInput.addEventListener("input", onAnyChange);
    masterInput.addEventListener("input", onAnyChange);
    pushSelect.addEventListener("change", onAnyChange);
    personalSelect.addEventListener("change", onAnyChange);
    scheduleSelect.addEventListener("change", onAnyChange);
    auditSelect.addEventListener("change", onAnyChange);

    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;

      saveBtn.disabled = true;
      saveBtn.textContent = "儲存中...";

      // 保險：送出前再強制一次（避免 UI 被外力改動）
      const finalAudit = auditSelect.value || "待審核";
      const finalPush = (finalAudit !== "通過") ? "否" : (pushSelect.value || "否");
      if (finalAudit !== "通過") {
        pushSelect.value = "否";
      }

      const payload = {
        userId: u.userId,
        audit: finalAudit,
        startDate: dateInput.value,
        usageDays: daysInput.value,
        masterCode: masterInput.value,
        pushEnabled: finalPush,
        personalStatusEnabled: personalSelect.value || "否",
        scheduleEnabled: scheduleSelect.value || "否",
      };

      const ok = await updateUser(payload);

      saveBtn.textContent = "儲存";

      if (ok) {
        toast("儲存完成", "ok");
        u.audit = finalAudit;
        u.pushEnabled = finalPush;
        u.personalStatusEnabled = personalSelect.value || "否";
        u.scheduleEnabled = scheduleSelect.value || "否";
        originalMap.set(u.userId, snapshot_(u));
        dirtyMap.delete(u.userId);
        await loadUsers();
      } else {
        toast("儲存失敗", "err");
        saveBtn.disabled = false;
      }
    });

    delBtn.addEventListener("click", async () => {
      const okConfirm = confirm(
        `確定要刪除使用者？\n\nuserId: ${u.userId}\n顯示名稱: ${u.displayName || ""}\n\n此操作不可復原。`
      );
      if (!okConfirm) return;

      delBtn.disabled = true;
      delBtn.textContent = "刪除中...";

      const ok = await deleteUser(u.userId);

      delBtn.disabled = false;
      delBtn.textContent = "刪除";

      if (ok) {
        toast("刪除完成", "ok");
        selectedIds.delete(u.userId);
        await loadUsers();
      } else {
        toast("刪除失敗", "err");
      }
    });

    tbody.appendChild(tr);
  });
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

function auditOption(value, current) {
  const sel = value === current ? "selected" : "";
  return `<option value="${value}" ${sel}>${value}</option>`;
}

function auditClass_(audit) {
  switch (String(audit || "").trim()) {
    case "通過": return "approved";
    case "待審核": return "pending";
    case "拒絕": return "rejected";
    case "停用": return "disabled";
    default: return "other";
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
  userId, audit, startDate, usageDays, masterCode,
  pushEnabled, personalStatusEnabled, scheduleEnabled
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

let toastTimer = null;
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
