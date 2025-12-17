// ★ 換成你的 GAS 最新部署網址
const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

// ✅ 你的 LIFF ID
const LIFF_ID = "2008669658-JNGJgZpR";

let allUsers = [];
let filteredUsers = [];

// sort state
let sortKey = "createdAt";
let sortDir = "desc"; // asc | desc

// selection state
const selectedIds = new Set();

// dirty state (userId -> snapshot string)
const originalMap = new Map(); // userId -> JSON string snapshot
const dirtyMap = new Map(); // userId -> true

document.addEventListener("DOMContentLoaded", () => {
  initTheme_();

  // actions
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme_);

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn)
    reloadBtn.addEventListener("click", async () => {
      // ✅ 重新整理也要先確保已通過 Gate
      const ok = await ensureAuthed_();
      if (!ok) return;

      selectedIds.clear();
      hideBulkBar_();
      await loadUsers();
    });

  const clearSearchBtn = document.getElementById("clearSearchBtn");
  if (clearSearchBtn)
    clearSearchBtn.addEventListener("click", () => {
      const si = document.getElementById("searchInput");
      if (si) si.value = "";

      // ✅ 清除後同步移除「搜尋中」視覺狀態
      const box = si?.closest(".search-box");
      box?.classList.remove("is-searching");

      applyFilters();
    });

  bindFilter();
  bindSorting_();
  bindBulk_();

  // ✅ 更直覺：有輸入就顯示「搜尋中」狀態
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

    // 初始狀態同步一次（避免從快取返回時狀態不一致）
    const box = searchInput.closest(".search-box");
    box?.classList.toggle("is-searching", searchInput.value.trim().length > 0);
  }

  // ✅ 先 LIFF + 權限檢查，再載入列表
  startAuthThenLoad_();
});

/* =========================================================
 * ✅ LINE Auth Gate（含 Debug）
 * ========================================================= */

let __authPassed = false;
let __authedUserId = "";

function showGate_(msg) {
  const gate = document.getElementById("authGate");
  const status = document.getElementById("authStatus");
  if (status) status.textContent = msg || "需要登入與權限檢查";
  if (gate) gate.classList.remove("hidden");
}

function hideGate_() {
  const gate = document.getElementById("authGate");
  if (gate) gate.classList.add("hidden");
}

function bindGateButtons_() {
  const btnLogin = document.getElementById("btnLineLogin");
  const btnRetry = document.getElementById("btnRetryAuth");

  if (btnLogin) {
    btnLogin.onclick = () => {
      try {
        if (window.liff && !liff.isLoggedIn()) {
          liff.login(); // 會跳轉
        } else {
          startAuthThenLoad_();
        }
      } catch (e) {
        showGate_("LINE 登入呼叫失敗：" + (e?.message || String(e)));
      }
    };
  }

  if (btnRetry) {
    btnRetry.onclick = () => startAuthThenLoad_();
  }
}

async function ensureAuthed_() {
  if (__authPassed) return true;
  await startAuthThenLoad_();
  return __authPassed;
}

async function startAuthThenLoad_() {
  bindGateButtons_();

  if (!LIFF_ID || LIFF_ID === "YOUR_LIFF_ID") {
    showGate_("錯誤：尚未設定 LIFF_ID（請在 app.js 填入你的 LIFF ID）");
    toast("尚未設定 LIFF_ID", "err");
    return;
  }

  if (!window.liff) {
    showGate_("錯誤：LIFF SDK 未載入。請確認 index.html 已引入 LIFF SDK。");
    toast("LIFF SDK 未載入", "err");
    return;
  }

  showGate_("初始化 LIFF…");

  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (e) {
    showGate_("LIFF 初始化失敗：" + (e?.message || String(e)));
    toast("LIFF 初始化失敗", "err");
    return;
  }

  if (!liff.isLoggedIn()) {
    showGate_("尚未登入 LINE。請點「LINE 登入」。");
    return;
  }

  showGate_("取得 LINE 使用者資訊…");

  let profile;
  try {
    profile = await liff.getProfile();
  } catch (e) {
    showGate_("取得 profile 失敗：" + (e?.message || String(e)));
    toast("取得 profile 失敗", "err");
    return;
  }

  const userId = String(profile?.userId || "").trim();
  const displayName = String(profile?.displayName || "").trim();

  if (!userId) {
    showGate_("錯誤：未取得 userId，無法驗證。");
    toast("未取得 userId", "err");
    return;
  }

  showGate_(
    `已登入：${displayName || "（無名）"}\nuserId：${userId}\n\n檢查「個人狀態開通」權限…`
  );

  const r = await checkPersonalStatusEnabledDebug_(userId);

  if (!r.ok) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `權限檢查失敗（請看下方資訊）\n` +
        `userId：${userId}\n` +
        `error：${r.error}\n` +
        `raw：${(r.raw || "").slice(0, 300)}`
    );

    toast("權限檢查失敗", "err");
    return;
  }

  if (!r.enabled) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `功能未開啟（personalStatusEnabled != "是"）\n` +
        `userId：${userId}\n` +
        `GAS 回傳 personalStatusEnabled：${String(r.personalStatusEnabled)}\n` +
        `audit：${String(r.audit)}`
    );

    toast("功能未開啟", "err");
    return;
  }

  // ✅ 通過
  __authPassed = true;
  __authedUserId = userId;
  hideGate_();
  toast("驗證通過", "ok");

  await loadUsers();
}

async function checkPersonalStatusEnabledDebug_(userId) {
  const url = API_BASE_URL + `?mode=check&userId=${encodeURIComponent(userId)}`;

  try {
    const res = await fetch(url, { method: "GET" });
    const raw = await res.text();

    console.log("[check] url:", url);
    console.log("[check] http:", res.status, "raw:", raw.slice(0, 200));

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, raw };
    }

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: "Response is not JSON (maybe HTML/login page)", raw };
    }

    const personalStatusEnabled = json?.personalStatusEnabled;
    const enabled = String(personalStatusEnabled || "").trim() === "是";

    return {
      ok: true,
      enabled,
      personalStatusEnabled,
      audit: json?.audit,
      json,
      raw
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), raw: "" };
  }
}

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
    const raw = await res.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error("listUsers raw:", raw.slice(0, 300));
      throw new Error("listUsers response is not JSON");
    }

    if (!json.ok) throw new Error("listUsers not ok");
    allUsers = json.users || [];

    // reset state
    originalMap.clear();
    dirtyMap.clear();

    // snapshot original
    for (const u of allUsers) originalMap.set(u.userId, snapshot_(u));

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

  if (key === "usageDays" || key === "isMaster" || key === "pushEnabled") {
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

  if (!audit && !pushEnabled) {
    toast("請先選擇要套用的批次欄位", "err");
    return;
  }

  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  ids.forEach((id) => {
    const u = allUsers.find((x) => x.userId === id);
    if (!u) return;

    if (audit) u.audit = audit;

    if ((u.audit || "待審核") !== "通過") {
      u.pushEnabled = "否";
    } else if (pushEnabled) {
      u.pushEnabled = pushEnabled;
    }

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
    tr.innerHTML = `<td colspan="13">無資料</td>`;
    tbody.appendChild(tr);
    return;
  }

  filteredUsers.forEach((u, i) => {
    const expiry = getExpiryInfo(u);
    const pushEnabled = (u.pushEnabled || "否") === "是" ? "是" : "否";
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

      u.pushEnabled = pushSelect.value || "否";

      if (u.audit !== "通過") {
        u.pushEnabled = "否";
        pushSelect.value = "否";
        pushSelect.disabled = true;
      } else {
        pushSelect.disabled = false;
      }

      markDirty_(u.userId, u);

      const exp = getExpiryInfo(u);
      const pill = tr.querySelector(".expiry-pill");
      if (pill) {
        pill.className = `expiry-pill ${exp.cls}`;
        pill.textContent = exp.text;
      }

      saveBtn.disabled = false;
      tr.classList.add("dirty");
      applyFiltersFooterOnly_();
    };

    dateInput.addEventListener("change", onAnyChange);
    daysInput.addEventListener("input", onAnyChange);
    masterInput.addEventListener("input", onAnyChange);
    pushSelect.addEventListener("change", onAnyChange);
    auditSelect.addEventListener("change", onAnyChange);

    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;

      saveBtn.disabled = true;
      saveBtn.textContent = "儲存中...";

      const finalAudit = auditSelect.value || "待審核";
      const finalPush = finalAudit !== "通過" ? "否" : pushSelect.value || "否";
      if (finalAudit !== "通過") pushSelect.value = "否";

      const payload = {
        userId: u.userId,
        audit: finalAudit,
        startDate: dateInput.value,
        usageDays: daysInput.value,
        masterCode: masterInput.value,
        pushEnabled: finalPush
      };

      const ok = await updateUser(payload);

      saveBtn.textContent = "儲存";

      if (ok) {
        toast("儲存完成", "ok");
        u.audit = finalAudit;
        u.pushEnabled = finalPush;
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

function applyFiltersFooterOnly_() {
  updateFooter();
}

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
    pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否"
  });
}

function markDirty_(userId, u) {
  const orig = originalMap.get(userId) || "";
  const now = snapshot_(u);
  if (orig !== now) dirtyMap.set(userId, true);
  else dirtyMap.delete(userId);
}

/* ========= API ========= */

async function updateUser({ userId, audit, startDate, usageDays, masterCode, pushEnabled }) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "updateUser");
    fd.append("userId", userId);
    fd.append("audit", audit);
    fd.append("startDate", startDate || "");
    fd.append("usageDays", usageDays || "");
    fd.append("masterCode", masterCode || "");
    fd.append("pushEnabled", pushEnabled || "否");

    const res = await fetch(API_BASE_URL, { method: "POST", body: fd });
    const raw = await res.text();
    let json = {};
    try {
      json = JSON.parse(raw);
    } catch (_) {
      console.error("updateUser raw:", raw.slice(0, 200));
    }
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
    const raw = await res.text();
    let json = {};
    try {
      json = JSON.parse(raw);
    } catch (_) {
      console.error("deleteUser raw:", raw.slice(0, 200));
    }
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
