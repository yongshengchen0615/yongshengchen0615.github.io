// =========================================================
// Users 後台管理 — app.js（完整可用版）
// ✅ 兩段式 Gate：LIFF 取 userId → 走 ADMIN_API_BASE_URL 做權限檢查
// ✅ 通過後才會呼叫 TECH_API_BASE_URL 讀 listUsers / updateUser / deleteUser
// ✅ 欄位兼容：personalStatusEnabled 不存在時，fallback 用 pushEnabled
// =========================================================

// ===============================
// 0) 你要改的參數
// ===============================

// ★ 管理者 GAS（用來 check 權限欄位：personalStatusEnabled 或 pushEnabled）
const ADMIN_API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

// ★ Users 後台 GAS（用來 listUsers / updateUser / deleteUser）
const TECH_API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbyBg3w57x-Yw4C6v-SQ9rQazx6n9_VZRDjPKvXJy8WNkv29KPbrd8gHKIu1DFjwstUg/exec";

// ✅ 你的 LIFF ID（要跟你後台 LIFF 專案一致）
const LIFF_ID = "2008669658-JNGJgZpR";

// ===============================
// 1) State
// ===============================
let allUsers = [];
let filteredUsers = [];

let sortKey = "createdAt";
let sortDir = "desc"; // asc | desc

const selectedIds = new Set(); // userId

const originalMap = new Map(); // userId -> snapshot json string
const dirtyMap = new Map(); // userId -> true

let lastLoadedAt = "";

// Gate state
let __authPassed = false;
let __authedUserId = "";

// ===============================
// 2) DOM Ready
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  initTheme_();

  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme_);

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn)
    reloadBtn.addEventListener("click", async () => {
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
      const box = si?.closest(".search-box");
      box?.classList.remove("is-searching");
      applyFilters();
    });

  bindFilter_();
  bindSorting_();
  bindBulk_();
  bindCheckAll_();

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

  // ✅ Gate -> load
  startAuthThenLoad_();
});

// =========================================================
// 3) Gate UI
// =========================================================
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
        if (window.liff && !liff.isLoggedIn()) liff.login();
        else startAuthThenLoad_();
      } catch (e) {
        showGate_("LINE 登入呼叫失敗：" + (e?.message || String(e)));
      }
    };
  }
  if (btnRetry) btnRetry.onclick = () => startAuthThenLoad_();
}

async function ensureAuthed_() {
  if (__authPassed) return true;
  await startAuthThenLoad_();
  return __authPassed;
}

async function startAuthThenLoad_() {
  bindGateButtons_();

  if (!LIFF_ID || LIFF_ID === "YOUR_LIFF_ID") {
    showGate_("錯誤：尚未設定 LIFF_ID");
    toast_("尚未設定 LIFF_ID", "err");
    return;
  }
  if (!window.liff) {
    showGate_("錯誤：LIFF SDK 未載入");
    toast_("LIFF SDK 未載入", "err");
    return;
  }
  if (!ADMIN_API_BASE_URL || !TECH_API_BASE_URL) {
    showGate_("錯誤：尚未設定 ADMIN_API_BASE_URL / TECH_API_BASE_URL");
    toast_("API URL 未設定", "err");
    return;
  }

  showGate_("初始化 LIFF…");
  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (e) {
    showGate_("LIFF 初始化失敗：" + (e?.message || String(e)));
    toast_("LIFF 初始化失敗", "err");
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
    toast_("取得 profile 失敗", "err");
    return;
  }

  const userId = String(profile?.userId || "").trim();
  const displayName = String(profile?.displayName || "").trim();
  if (!userId) {
    showGate_("錯誤：未取得 userId");
    toast_("未取得 userId", "err");
    return;
  }

  showGate_(
    `已登入：${displayName || "（無名）"}\nuserId：${userId}\n\n檢查權限中…`
  );

  // ✅ 走 ADMIN check
  const r = await adminCheckPersonalStatus_(userId);

  if (!r.ok) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `管理者權限檢查失敗\n` +
        `userId：${userId}\n` +
        `error：${r.error}\n` +
        `raw：${(r.raw || "").slice(0, 300)}`
    );
    toast_("權限檢查失敗", "err");
    return;
  }

  if (!r.enabled) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `功能未開啟（欄位需為「是」）\n` +
        `userId：${userId}\n` +
        `enabledField：${String(r.personalStatusEnabled)}\n` +
        `audit：${String(r.audit)}`
    );
    toast_("功能未開啟", "err");
    return;
  }

  // ✅ 通過：進入資料讀取
  __authPassed = true;
  __authedUserId = userId;
  hideGate_();
  toast_("驗證通過", "ok");

  await loadUsers();
}

// ✅ 欄位兼容：personalStatusEnabled 若不存在，fallback 用 pushEnabled
async function adminCheckPersonalStatus_(userId) {
  const url =
    ADMIN_API_BASE_URL +
    `?mode=check&userId=${encodeURIComponent(userId)}&_cors=1`;

  try {
    const res = await fetch(url, { method: "GET" });
    const raw = await res.text();

    console.log("[admin-check] url:", url);
    console.log("[admin-check] http:", res.status, "raw:", raw.slice(0, 300));

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw };

    let json;
    try {
      json = JSON.parse(raw);
    } catch (_) {
      return { ok: false, error: "Response is not JSON", raw };
    }

    const personalStatusEnabled =
      json?.personalStatusEnabled ?? json?.personalStatus ?? json?.pushEnabled;

    const enabled = String(personalStatusEnabled || "").trim() === "是";

    return {
      ok: true,
      enabled,
      personalStatusEnabled,
      audit: json?.audit,
      raw,
      json,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), raw: "" };
  }
}

// =========================================================
// 4) TECH API（list/update/delete）
// =========================================================
async function techGet_(paramsObj) {
  const u = new URL(TECH_API_BASE_URL);
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  u.searchParams.set("_cors", "1");

  const url = u.toString();
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();

  console.log("[tech-get] url:", url);
  console.log("[tech-get] http:", res.status, "raw:", text.slice(0, 200));

  if (!res.ok) throw new Error(`TECH_API HTTP ${res.status}`);

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("TECH_API response is not JSON");
  }
}

async function techPost_(paramsObj) {
  const fd = new URLSearchParams();
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  });

  const res = await fetch(TECH_API_BASE_URL, { method: "POST", body: fd });
  const text = await res.text();

  console.log("[tech-post] mode:", paramsObj?.mode, "http:", res.status, "raw:", text.slice(0, 200));

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw: text };

  try {
    return JSON.parse(text);
  } catch (_) {
    return { ok: false, error: "Response is not JSON", raw: text };
  }
}

// =========================================================
// 5) Data load
// =========================================================
async function loadUsers() {
  try {
    const json = await techGet_({ mode: "listUsers" });
    if (!json.ok) throw new Error(json.error || "listUsers not ok");

    allUsers = Array.isArray(json.users) ? json.users : [];

    originalMap.clear();
    dirtyMap.clear();
    selectedIds.clear();
    hideBulkBar_();

    for (const u of allUsers) originalMap.set(u.userId, snapshot_(u));

    lastLoadedAt = new Date().toLocaleString("zh-TW", { hour12: false });

    applyFilters();
    toast_("資料已更新", "ok");
  } catch (err) {
    console.error("loadUsers error:", err);
    toast_("讀取失敗：" + (err?.message || String(err)), "err");
  }
}

// =========================================================
// 6) Filtering + sorting
// =========================================================
function bindFilter_() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters();
    });
  });
}

function bindSorting_() {
  document.querySelectorAll("thead th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort") || "";
      if (!key) return;

      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = "desc";
      }

      updateSortIndicators_();
      applyFilters();
    });
  });

  updateSortIndicators_();
}

function updateSortIndicators_() {
  document.querySelectorAll("thead th.sortable").forEach((th) => {
    const key = th.getAttribute("data-sort");
    th.querySelectorAll(".sort-ind").forEach((n) => n.remove());

    if (key !== sortKey) return;

    const ind = document.createElement("span");
    ind.className = "sort-ind";
    ind.textContent = sortDir === "asc" ? "▲" : "▼";
    th.appendChild(ind);
  });
}

function applyFilters() {
  const keywordRaw = (document.getElementById("searchInput")?.value || "")
    .trim()
    .toLowerCase();

  const activeChip = document.querySelector(".chip.active");
  const filter = activeChip ? activeChip.dataset.filter : "ALL";

  filteredUsers = allUsers.filter((u) => {
    const audit = String(u.audit || "待審核").trim();

    if (filter !== "ALL" && audit !== filter) return false;

    if (keywordRaw) {
      const hay = `${u.userId} ${u.displayName || ""} ${u.masterCode || ""}`.toLowerCase();
      if (!hay.includes(keywordRaw)) return false;
    }
    return true;
  });

  filteredUsers.sort((a, b) => compareBy_(a, b, sortKey, sortDir));

  renderTable_();
  updateKpis_();
  updateSummary_();
  updateFooter_();
  syncCheckAll_();
  updateBulkBar_();
}

function compareBy_(a, b, key, dir) {
  const sign = dir === "asc" ? 1 : -1;

  const va = valueForSort_(a, key);
  const vb = valueForSort_(b, key);

  if (va < vb) return -1 * sign;
  if (va > vb) return 1 * sign;
  return 0;
}

function valueForSort_(u, key) {
  if (key === "index") return 0; // 由 render 時處理
  if (key === "expiry") return calcExpiryStatus_(u).rank;

  const v = u?.[key];

  if (key === "createdAt" || key === "startDate") {
    // "yyyy-MM-dd HH:mm:ss" or ""
    return String(v || "");
  }
  if (key === "usageDays") {
    const n = parseInt(String(v || ""), 10);
    return isNaN(n) ? -1 : n;
  }
  return String(v ?? "");
}

// =========================================================
// 7) Table render + row actions
// =========================================================
function renderTable_() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;

  if (!filteredUsers.length) {
    tbody.innerHTML = `<tr><td colspan="13">無資料</td></tr>`;
    return;
  }

  const rows = filteredUsers.map((u, idx) => {
    const userId = String(u.userId || "").trim();
    const displayName = String(u.displayName || "");
    const createdAt = String(u.createdAt || "");
    const startDate = toDateInputValue_(u.startDate);
    const usageDays = String(u.usageDays ?? "");
    const audit = String(u.audit || "待審核");
    const masterCode = String(u.masterCode || "");
    const isMaster = String(u.isMaster || (masterCode ? "是" : "否"));
    const pushEnabled = String(u.pushEnabled || "否") === "是" ? "是" : "否";

    const checked = selectedIds.has(userId) ? "checked" : "";

    const expiry = calcExpiryStatus_(u); // { label, cls, rank }

    const dirty = dirtyMap.has(userId);
    const trCls = dirty ? "dirty" : "";

    const auditBadgeCls = auditToBadgeCls_(audit);
    const auditBadge = `<span class="audit-badge ${auditBadgeCls}">${escapeHtml_(audit)}</span>`;

    const saveDisabled = dirty ? "" : "disabled";

    return `
<tr class="${trCls}" data-userid="${escapeAttr_(userId)}">
  <td class="sticky-col col-check" data-label="選取">
    <input class="row-check" type="checkbox" data-userid="${escapeAttr_(userId)}" ${checked} />
  </td>

  <td data-label="#" title="${idx + 1}">${idx + 1}</td>

  <td data-label="userId">
    <div class="row-hint" style="font-family:var(--mono)">${escapeHtml_(userId)}</div>
  </td>

  <td data-label="顯示名稱">
    <input class="row-input" type="text" data-field="displayName" value="${escapeAttr_(displayName)}" />
  </td>

  <td data-label="建立時間">
    <span class="row-hint">${escapeHtml_(createdAt || "-")}</span>
  </td>

  <td data-label="開始使用">
    <input class="row-input" type="date" data-field="startDate" value="${escapeAttr_(startDate)}" />
  </td>

  <td data-label="期限(天)">
    <input class="row-input" type="number" min="0" step="1" data-field="usageDays" value="${escapeAttr_(usageDays)}" />
  </td>

  <td data-label="使用狀態">
    <span class="expiry-pill ${expiry.cls}">${escapeHtml_(expiry.label)}</span>
  </td>

  <td data-label="審核狀態">
    <select class="row-input" data-field="audit">
      ${renderAuditOptions_(audit)}
    </select>
    ${auditBadge}
  </td>

  <td data-label="師傅編號">
    <input class="row-input" type="text" data-field="masterCode" value="${escapeAttr_(masterCode)}" />
  </td>

  <td data-label="是否師傅">
    <span class="row-hint">${escapeHtml_(isMaster)}</span>
  </td>

  <td data-label="是否推播">
    <select class="row-input" data-field="pushEnabled">
      <option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
      <option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
    </select>
  </td>

  <td data-label="操作">
    <div class="actions">
      ${dirty ? `<span class="dirty-dot" title="已修改未儲存"></span>` : ""}
      <button class="btn primary btn-save" type="button" data-userid="${escapeAttr_(userId)}" ${saveDisabled}>儲存</button>
      <button class="btn danger btn-del" type="button" data-userid="${escapeAttr_(userId)}">刪除</button>
    </div>
  </td>
</tr>
`;
  });

  tbody.innerHTML = rows.join("");

  // bind row events
  tbody.querySelectorAll(".row-input").forEach((el) => {
    el.addEventListener("change", onRowChange_);
    el.addEventListener("input", debounce(onRowChange_, 120));
  });

  tbody.querySelectorAll(".btn-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-userid") || "";
      await saveRow_(userId);
    });
  });

  tbody.querySelectorAll(".btn-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-userid") || "";
      await deleteRow_(userId);
    });
  });

  tbody.querySelectorAll(".row-check").forEach((chk) => {
    chk.addEventListener("change", () => {
      const userId = chk.getAttribute("data-userid") || "";
      if (!userId) return;

      if (chk.checked) selectedIds.add(userId);
      else selectedIds.delete(userId);

      updateBulkBar_();
      syncCheckAll_();
      updateFooter_();
    });
  });
}

function onRowChange_(e) {
  const el = e.target;
  const tr = el.closest("tr[data-userid]");
  if (!tr) return;

  const userId = tr.getAttribute("data-userid") || "";
  if (!userId) return;

  const u = findUserById_(userId);
  if (!u) return;

  const field = el.getAttribute("data-field");
  if (!field) return;

  let v = "";
  if (el.tagName === "SELECT") v = el.value;
  else v = el.value;

  // update model
  if (field === "displayName") u.displayName = v;
  if (field === "startDate") u.startDate = v; // 用 date input 的 yyyy-MM-dd（後端 parseDateLoose_ 可吃）
  if (field === "usageDays") u.usageDays = v;
  if (field === "audit") u.audit = v;
  if (field === "masterCode") u.masterCode = v;
  if (field === "pushEnabled") u.pushEnabled = v;

  // derived
  u.isMaster = String(u.masterCode || "").trim() ? "是" : "否";

  // dirty calc
  markDirty_(userId, u);

  // update UI: row class + save button + audit badge + expiry
  const dirty = dirtyMap.has(userId);
  tr.classList.toggle("dirty", dirty);

  const saveBtn = tr.querySelector(".btn-save");
  if (saveBtn) saveBtn.disabled = !dirty;

  // update audit badge text/class
  const badge = tr.querySelector(".audit-badge");
  if (badge) {
    badge.className = `audit-badge ${auditToBadgeCls_(String(u.audit || "待審核"))}`;
    badge.textContent = String(u.audit || "待審核");
  }

  // update expiry pill
  const pill = tr.querySelector(".expiry-pill");
  if (pill) {
    const ex = calcExpiryStatus_(u);
    pill.className = `expiry-pill ${ex.cls}`;
    pill.textContent = ex.label;
  }

  updateFooter_();
  updateBulkBar_();
}

async function saveRow_(userId) {
  const u = findUserById_(userId);
  if (!u) return;

  const audit = String(u.audit || "").trim();
  const startDate = normalizeDateForPost_(u.startDate);
  const usageDays = String(u.usageDays ?? "").trim();
  const masterCode = String(u.masterCode || "").trim();
  const pushEnabled = String(u.pushEnabled || "否") === "是" ? "是" : "否";

  const payload = {
    mode: "updateUser",
    userId,
    audit,
    startDate: startDate || "",
    usageDays: usageDays || "",
    masterCode: masterCode || "",
    pushEnabled,
  };

  const ok = await techPost_(payload);
  if (!ok.ok) {
    toast_("儲存失敗：" + (ok.error || "unknown"), "err");
    return;
  }

  // ✅ 更新原始快照
  originalMap.set(userId, snapshot_(u));
  dirtyMap.delete(userId);

  toast_("已儲存", "ok");
  applyFilters(); // refresh (re-render badges/pills, sorting)
}

async function deleteRow_(userId) {
  if (!userId) return;
  const yes = confirm(`確定刪除 userId：\n${userId} ？`);
  if (!yes) return;

  const ok = await techPost_({ mode: "deleteUser", userId });
  if (!ok.ok) {
    toast_("刪除失敗：" + (ok.error || "unknown"), "err");
    return;
  }

  allUsers = allUsers.filter((x) => String(x.userId || "").trim() !== userId);
  filteredUsers = filteredUsers.filter((x) => String(x.userId || "").trim() !== userId);

  originalMap.delete(userId);
  dirtyMap.delete(userId);
  selectedIds.delete(userId);

  toast_("已刪除", "ok");
  applyFilters();
}

function findUserById_(userId) {
  const id = String(userId || "").trim();
  return allUsers.find((x) => String(x.userId || "").trim() === id) || null;
}

// =========================================================
// 8) Bulk actions
// =========================================================
function bindBulk_() {
  const bulkApply = document.getElementById("bulkApply");
  const bulkDelete = document.getElementById("bulkDelete");
  const bulkClear = document.getElementById("bulkClear");

  if (bulkApply)
    bulkApply.addEventListener("click", async () => {
      if (!selectedIds.size) return;

      const bulkAudit = document.getElementById("bulkAudit")?.value || "";
      const bulkPush = document.getElementById("bulkPush")?.value || "";

      if (!bulkAudit && !bulkPush) {
        toast_("未選擇要套用的欄位", "err");
        return;
      }

      // 套用到 model + dirty
      for (const userId of selectedIds) {
        const u = findUserById_(userId);
        if (!u) continue;

        if (bulkAudit) u.audit = bulkAudit;
        if (bulkPush) u.pushEnabled = bulkPush;

        u.isMaster = String(u.masterCode || "").trim() ? "是" : "否";
        markDirty_(userId, u);
      }

      toast_("已套用到選取（尚未儲存）", "ok");
      applyFilters();
    });

  if (bulkDelete)
    bulkDelete.addEventListener("click", async () => {
      if (!selectedIds.size) return;

      const yes = confirm(`確定批次刪除 ${selectedIds.size} 筆？`);
      if (!yes) return;

      // 逐筆刪（保持簡單可靠）
      const ids = Array.from(selectedIds);
      let okCount = 0;

      for (const id of ids) {
        const r = await techPost_({ mode: "deleteUser", userId: id });
        if (r.ok) okCount++;
      }

      toast_(`批次刪除完成：${okCount}/${ids.length}`, okCount ? "ok" : "err");

      // reload
      await loadUsers();
    });

  if (bulkClear)
    bulkClear.addEventListener("click", () => {
      selectedIds.clear();
      hideBulkBar_();
      syncCheckAll_();
      applyFilters();
    });
}

function updateBulkBar_() {
  const bar = document.getElementById("bulkBar");
  const count = document.getElementById("bulkCount");
  if (!bar || !count) return;

  const n = selectedIds.size;
  if (!n) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  count.textContent = `已選取 ${n} 筆`;
}

function hideBulkBar_() {
  const bar = document.getElementById("bulkBar");
  if (bar) bar.hidden = true;
}

// =========================================================
// 9) Check-all
// =========================================================
function bindCheckAll_() {
  const chk = document.getElementById("checkAll");
  if (!chk) return;

  chk.addEventListener("change", () => {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;

    const rows = tbody.querySelectorAll('.row-check[data-userid]');
    if (chk.checked) {
      rows.forEach((r) => selectedIds.add(r.getAttribute("data-userid")));
    } else {
      rows.forEach((r) => selectedIds.delete(r.getAttribute("data-userid")));
    }

    rows.forEach((r) => (r.checked = chk.checked));

    updateBulkBar_();
    updateFooter_();
  });
}

function syncCheckAll_() {
  const chk = document.getElementById("checkAll");
  const tbody = document.getElementById("tbody");
  if (!chk || !tbody) return;

  const rows = Array.from(tbody.querySelectorAll('.row-check[data-userid]'));
  if (!rows.length) {
    chk.checked = false;
    chk.indeterminate = false;
    return;
  }

  const checkedCount = rows.filter((r) => r.checked).length;
  chk.checked = checkedCount === rows.length;
  chk.indeterminate = checkedCount > 0 && checkedCount < rows.length;
}

// =========================================================
// 10) KPI + summary + footer
// =========================================================
function updateKpis_() {
  const total = allUsers.length;

  let approved = 0,
    pending = 0,
    rejected = 0,
    disabled = 0;

  for (const u of allUsers) {
    const a = String(u.audit || "待審核").trim();
    if (a === "通過") approved++;
    else if (a === "待審核") pending++;
    else if (a === "拒絕") rejected++;
    else if (a === "停用") disabled++;
  }

  setText_("kpiTotal", total);
  setText_("kpiApproved", approved);
  setText_("kpiPending", pending);
  setText_("kpiRejected", rejected);
  setText_("kpiDisabled", disabled);
}

function updateSummary_() {
  const el = document.getElementById("summaryText");
  if (!el) return;

  const f = filteredUsers.length;
  const t = allUsers.length;

  const dirtyCount = dirtyMap.size;
  const selectedCount = selectedIds.size;

  el.textContent =
    `顯示 ${f}/${t}｜已選取 ${selectedCount}｜未儲存 ${dirtyCount}` +
    (lastLoadedAt ? `｜更新：${lastLoadedAt}` : "");
}

function updateFooter_() {
  const el = document.getElementById("footerStatus");
  if (!el) return;

  const dirtyCount = dirtyMap.size;
  const selectedCount = selectedIds.size;

  el.textContent = `選取 ${selectedCount}｜未儲存 ${dirtyCount}`;
}

// =========================================================
// 11) Helpers (dirty, snapshot, expiry, audit options)
// =========================================================
function snapshot_(u) {
  return JSON.stringify({
    userId: String(u.userId || "").trim(),
    displayName: String(u.displayName || ""),
    audit: String(u.audit || "待審核"),
    startDate: normalizeDateForPost_(u.startDate),
    usageDays: String(u.usageDays ?? ""),
    masterCode: String(u.masterCode || ""),
    pushEnabled: String(u.pushEnabled || "否") === "是" ? "是" : "否",
  });
}

function markDirty_(userId, u) {
  const orig = originalMap.get(userId) || "";
  const now = snapshot_(u);
  if (orig !== now) dirtyMap.set(userId, true);
  else dirtyMap.delete(userId);
}

function calcExpiryStatus_(u) {
  // ranking: active(2) > unset(1) > expired(0)
  const start = normalizeDateForPost_(u.startDate);
  const daysRaw = String(u.usageDays ?? "").trim();
  const n = parseInt(daysRaw, 10);

  if (!start || !daysRaw || isNaN(n) || n <= 0) {
    return { label: "未設定", cls: "unset", rank: 1 };
  }

  // start is yyyy-MM-dd
  const startDate = new Date(start + "T00:00:00");
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const expire = new Date(startDate.getTime() + n * 24 * 60 * 60 * 1000);

  if (today0.getTime() >= expire.getTime()) {
    return { label: "已到期", cls: "expired", rank: 0 };
  }
  return { label: "使用中", cls: "active", rank: 2 };
}

function renderAuditOptions_(current) {
  const v = String(current || "待審核");
  const opts = ["待審核", "通過", "拒絕", "停用", "其他"];
  return opts
    .map((o) => `<option value="${escapeAttr_(o)}" ${v === o ? "selected" : ""}>${escapeHtml_(o)}</option>`)
    .join("");
}

function auditToBadgeCls_(audit) {
  const a = String(audit || "待審核").trim();
  if (a === "待審核") return "pending";
  if (a === "通過") return "approved";
  if (a === "拒絕") return "rejected";
  if (a === "停用") return "disabled";
  return "other";
}

// "yyyy-MM-dd HH:mm:ss" 或 "yyyy-MM-dd" 或 Date-like -> input yyyy-MM-dd
function toDateInputValue_(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) return s.slice(0, 10);

  // fallback: try Date
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// 給後端 parseDateLoose_：最穩就是 yyyy-MM-dd
function normalizeDateForPost_(v) {
  return toDateInputValue_(v);
}

// =========================================================
// 12) Theme
// =========================================================
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

// =========================================================
// 13) Toast + utils
// =========================================================
let toastTimer = null;
function toast_(msg, type) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.classList.remove("show", "ok", "err");
  el.textContent = msg;
  el.classList.add(type === "err" ? "err" : "ok");

  requestAnimationFrame(() => el.classList.add("show"));

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

function setText_(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v ?? "-");
}

function escapeHtml_(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr_(s) {
  // attribute-safe (minimal)
  return escapeHtml_(s).replaceAll("\n", " ");
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
