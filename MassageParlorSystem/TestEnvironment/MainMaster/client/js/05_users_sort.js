/* ============================================
 * 05_users_sort.js
 * - Filters（chip + search）
 * - 讀取 users
 * - 排序
 * - Summary / KPI / Footer
 * ============================================ */

/**
 * 綁定審核狀態 chip（全部/通過/待審核...）
 * 做法：點擊 chip -> 設為 active -> applyFilters()
 */
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

/**
 * 從 Users API 取得清單並更新 allUsers
 * 做法：
 * - GET ?mode=listUsers
 * - 正規化欄位（audit、pushEnabled、personalStatusEnabled、scheduleEnabled）
 * - 建立 originalMap 快照用於 dirty 判斷
 */
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

    // 權限相關：確保 render 後也套用一次
    applyColumnPermissions_();
    applyBulkPermissions_();
  }
}

/**
 * 套用搜尋 + chip filter + sorting
 * 做法：
 * - 先 filter 出 filteredUsers
 * - 再依 sortKey/sortDir 排序
 * - 最後 render + 更新 KPI/summary/footer/bulk 等 UI
 */
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

  // 權限欄位隱藏 + Bulk 欄位顯示
  applyColumnPermissions_();
  applyBulkPermissions_();

  if (savingAll) setEditingEnabled_(false);
}

/**
 * 更新 topbar summary
 * 做法：直接用 allUsers 統計（符合原行為）
 */
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

/**
 * 更新 KPI
 */
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

/**
 * 更新 footer 狀態
 * 做法：顯示最後更新時間、目前筆數、搜尋中提示、未儲存筆數
 */
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

/**
 * 綁定表頭排序
 * 做法：
 * - 重複點同一欄：asc/desc 互切
 * - 切換不同欄位：createdAt 預設 desc，其餘預設 asc
 */
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

/**
 * 比較排序
 * @param {Object} a - user A
 * @param {Object} b - user B
 * @param {string} key - sort key
 * @param {"asc"|"desc"} dir - 排序方向
 * @returns {number}
 */
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

  // 是/否 欄位：用數值比較
  if (key === "pushEnabled" || key === "personalStatusEnabled" || key === "scheduleEnabled") {
    const na = String(av) === "是" ? 1 : 0;
    const nb = String(bv) === "是" ? 1 : 0;
    return (na - nb) * sgn;
  }

  // 數字欄位
  if (key === "usageDays" || key === "isMaster") {
    const na = Number(av || 0);
    const nb = Number(bv || 0);
    return (na - nb) * sgn;
  }

  // createdAt：可含時間
  if (key === "createdAt") {
    const da = toTime_(av);
    const db = toTime_(bv);
    return (da - db) * sgn;
  }

  // startDate：只比較日期
  if (key === "startDate") {
    const da = toTime_(String(av || "") + "T00:00:00");
    const db = toTime_(String(bv || "") + "T00:00:00");
    return (da - db) * sgn;
  }

  // 文字比較
  const sa = String(av ?? "").toLowerCase();
  const sb = String(bv ?? "").toLowerCase();
  if (sa < sb) return -1 * sgn;
  if (sa > sb) return 1 * sgn;
  return 0;
}
