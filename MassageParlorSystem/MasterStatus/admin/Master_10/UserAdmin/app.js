// =========================================================
// Users 後台管理 — app.js（動態 TECH URL 版）
// ✅ Gate：LIFF init → 若未登入則自動 liff.login() → 取 profile.userId
// ✅ ADMIN check：personalStatusEnabled / personalStatus 任一為「是」才放行
// ✅ 通過後：讀取 PersonalStatus「使用者管理連結」→ 指派 TECH_API_BASE_URL
// ✅ 放行後才呼叫 TECH listUsers / updateUser / deleteUser
// ✅ Gate 無按鈕（純顯示）
// =========================================================

// ===============================
// 0) 你要改的參數
// ===============================
const ADMIN_API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

// ✅ 改成動態寫入（從 PersonalStatus「使用者管理連結」拿）
let TECH_API_BASE_URL = "";

const LIFF_ID = "2008669658-JNGJgZpR";

// ===============================
// 1) State
// ===============================
let allUsers = [];
let filteredUsers = [];

let sortKey = "createdAt";
let sortDir = "desc";

const selectedIds = new Set();
const originalMap = new Map();
const dirtyMap = new Map();

let lastLoadedAt = "";

let __authPassed = false;
let __authedUserId = "";

// ===============================
// 2) DOM Ready
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  initTheme_();

  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme_);

  document.getElementById("reloadBtn")?.addEventListener("click", async () => {
    const ok = await ensureAuthed_();
    if (!ok) return;
    await loadUsers();
  });

  document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
    const si = document.getElementById("searchInput");
    if (si) si.value = "";
    si?.closest(".search-box")?.classList.remove("is-searching");
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
        const hasValue = searchInput.value.trim().length > 0;
        searchInput.closest(".search-box")?.classList.toggle("is-searching", hasValue);
        applyFilters();
      }, 180)
    );
  }

  // ✅ Auto gate -> load
  startAuthThenLoad_();
});

// =========================================================
// 3) Gate UI（無按鈕）
// =========================================================
function showGate_(msg) {
  const gate = document.getElementById("authGate");
  const status = document.getElementById("authStatus");
  if (status) status.textContent = msg || "LINE 自動登入與權限檢查中…";
  if (gate) gate.classList.remove("hidden");
}
function hideGate_() {
  document.getElementById("authGate")?.classList.add("hidden");
}

async function ensureAuthed_() {
  if (__authPassed) return true;
  await startAuthThenLoad_();
  return __authPassed;
}

async function startAuthThenLoad_() {
  __authPassed = false;
  __authedUserId = "";
  TECH_API_BASE_URL = "";

  // 基本檢查
  if (!LIFF_ID || LIFF_ID === "YOUR_LIFF_ID") {
    showGate_("❌ 錯誤：尚未設定 LIFF_ID");
    toast_("尚未設定 LIFF_ID", "err");
    return;
  }
  if (!window.liff) {
    showGate_("❌ 錯誤：LIFF SDK 未載入\n請確認已引入 LIFF SDK script");
    toast_("LIFF SDK 未載入", "err");
    return;
  }
  if (!ADMIN_API_BASE_URL) {
    showGate_("❌ 錯誤：尚未設定 ADMIN API URL");
    toast_("ADMIN API URL 未設定", "err");
    return;
  }

  // LIFF init
  showGate_("⏳ 初始化 LIFF…");
  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (e) {
    showGate_("❌ LIFF 初始化失敗：\n" + (e?.message || String(e)));
    toast_("LIFF 初始化失敗", "err");
    return;
  }

  // 未登入：自動登入
  if (!liff.isLoggedIn()) {
    showGate_("⏳ 尚未登入 LINE，正在自動登入…");
    try {
      liff.login(); // redirect
    } catch (e) {
      showGate_("❌ 自動登入失敗：\n" + (e?.message || String(e)));
      toast_("自動登入失敗", "err");
    }
    return;
  }

  // 取 profile
  showGate_("⏳ 取得 LINE 使用者資訊…");
  let profile;
  try {
    profile = await liff.getProfile();
  } catch (e) {
    showGate_("❌ 取得 profile 失敗：\n" + (e?.message || String(e)));
    toast_("取得 profile 失敗", "err");
    return;
  }

  const userId = String(profile?.userId || "").trim();
  const displayName = String(profile?.displayName || "").trim();

  if (!userId) {
    showGate_("❌ 未取得 userId\n請確認此頁面為 LIFF 內開啟");
    toast_("未取得 userId", "err");
    return;
  }

  showGate_(
    `✅ 已登入：${displayName || "（無名）"}\nuserId：${userId}\n\n⏳ 檢查是否已開通…`
  );

  // ADMIN check
  const r = await adminCheckPersonalStatus_(userId);

  if (!r.ok) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `❌ 權限檢查失敗\nuserId：${userId}\nerror：${r.error}\nraw：${(r.raw || "").slice(0, 300)}`
    );
    toast_("權限檢查失敗", "err");
    return;
  }

  if (!r.enabled) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `⛔ 尚未開通\nuserId：${userId}\n欄位值：${String(r.personalStatusEnabled)}\n\n請通知管理員把「個人狀態開通」設為「是」。`
    );
    toast_("尚未開通，請通知管理員", "err");
    return;
  }

  // ✅ 讀取 PersonalStatus 的「使用者管理連結」當作 TECH_API_BASE_URL
  showGate_("✅ 已開通，讀取使用者管理連結中…");
  const linkRes = await adminGetUserManageLink_(userId);

  if (!linkRes.ok) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `❌ 讀取使用者管理連結失敗\nuserId：${userId}\nerror：${linkRes.error}\nraw：${(linkRes.raw || "").slice(0, 300)}`
    );
    toast_("讀取使用者管理連結失敗", "err");
    return;
  }

  const techUrl = String(linkRes.techUrl || "").trim();
  if (!techUrl) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `⛔ 尚未設定「使用者管理連結」\nuserId：${userId}\n\n請到 PersonalStatus 表的「使用者管理連結」欄填入對應的 GAS WebApp /exec 連結。`
    );
    toast_("尚未設定使用者管理連結", "err");
    return;
  }

  // 基本校驗（避免亂填）
  if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(techUrl) || !/\/exec(\?|$)/.test(techUrl)) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `❌ 使用者管理連結格式不正確\n目前值：${techUrl}\n\n需為 GAS WebApp 的 /exec 連結。`
    );
    toast_("使用者管理連結格式錯誤", "err");
    return;
  }

  TECH_API_BASE_URL = techUrl;

  // 通過
  __authPassed = true;
  __authedUserId = userId;

  showGate_("✅ 驗證通過，正在載入資料…");
  toast_("驗證通過", "ok");

  await loadUsers();

  // 載入成功才關 Gate
  hideGate_();
}

// ✅ 只看 personalStatusEnabled / personalStatus
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

    const personalStatusEnabled = json?.personalStatusEnabled ?? json?.personalStatus;
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

// ✅ 讀 PersonalStatus 的「使用者管理連結」
async function adminGetUserManageLink_(userId) {
  const url =
    ADMIN_API_BASE_URL +
    `?mode=getUserManageLink&userId=${encodeURIComponent(userId)}&_cors=1`;

  try {
    const res = await fetch(url, { method: "GET" });
    const raw = await res.text();

    console.log("[admin-get-link] url:", url);
    console.log("[admin-get-link] http:", res.status, "raw:", raw.slice(0, 300));

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw };

    let json;
    try {
      json = JSON.parse(raw);
    } catch (_) {
      return { ok: false, error: "Response is not JSON", raw };
    }

    if (!json.ok) return { ok: false, error: json.error || "not ok", raw, json };

    return { ok: true, techUrl: json.techUrl, raw, json };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), raw: "" };
  }
}

// =========================================================
// 4) TECH API（list/update/delete）
// =========================================================
function assertTechUrl_() {
  if (!TECH_API_BASE_URL) throw new Error("TECH_API_BASE_URL 尚未設定（PersonalStatus 使用者管理連結為空）");
}

async function techGet_(paramsObj) {
  assertTechUrl_();

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
  assertTechUrl_();

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
      const hay = `${u.userId} ${u.displayName || ""}`.toLowerCase();
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
  if (key === "index") return 0;
  if (key === "expiry") return calcExpiryStatus_(u).rank;

  const v = u?.[key];

  if (key === "createdAt" || key === "startDate") return String(v || "");
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
    tbody.innerHTML = `<tr><td colspan="10">無資料</td></tr>`;
    return;
  }

  const rows = filteredUsers.map((u, idx) => {
    const userId = String(u.userId || "").trim();
    const displayName = String(u.displayName || "");
    const createdAt = String(u.createdAt || "");
    const startDate = toDateInputValue_(u.startDate);
    const usageDays = String(u.usageDays ?? "");
    const audit = String(u.audit || "待審核");

    const checked = selectedIds.has(userId) ? "checked" : "";
    const expiry = calcExpiryStatus_(u);

    const dirty = dirtyMap.has(userId);
    const trCls = dirty ? "dirty" : "";

    const auditBadge = `<span class="audit-badge ${auditToBadgeCls_(audit)}">${escapeHtml_(audit)}</span>`;
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
  const u = findUserById_(userId);
  if (!u) return;

  const field = el.getAttribute("data-field");
  if (!field) return;

  const v = el.value;

  if (field === "displayName") u.displayName = v;
  if (field === "startDate") u.startDate = v;
  if (field === "usageDays") u.usageDays = v;
  if (field === "audit") u.audit = v;

  markDirty_(userId, u);

  const dirty = dirtyMap.has(userId);
  tr.classList.toggle("dirty", dirty);

  const saveBtn = tr.querySelector(".btn-save");
  if (saveBtn) saveBtn.disabled = !dirty;

  const badge = tr.querySelector(".audit-badge");
  if (badge) {
    badge.className = `audit-badge ${auditToBadgeCls_(String(u.audit || "待審核"))}`;
    badge.textContent = String(u.audit || "待審核");
  }

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

  const payload = {
    mode: "updateUser",
    userId,
    audit: String(u.audit || "").trim(),
    startDate: normalizeDateForPost_(u.startDate) || "",
    usageDays: String(u.usageDays ?? "").trim() || "",
  };

  const r = await techPost_(payload);
  if (!r.ok) {
    toast_("儲存失敗：" + (r.error || "unknown"), "err");
    return;
  }

  originalMap.set(userId, snapshot_(u));
  dirtyMap.delete(userId);

  toast_("已儲存", "ok");
  applyFilters();
}

async function deleteRow_(userId) {
  if (!userId) return;
  const yes = confirm(`確定刪除 userId：\n${userId} ？`);
  if (!yes) return;

  const r = await techPost_({ mode: "deleteUser", userId });
  if (!r.ok) {
    toast_("刪除失敗：" + (r.error || "unknown"), "err");
    return;
  }

  allUsers = allUsers.filter((x) => String(x.userId || "").trim() !== userId);

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
// 8) Bulk（只保留批次審核 + 批次刪除）
// =========================================================
function bindBulk_() {
  document.getElementById("bulkApply")?.addEventListener("click", async () => {
    if (!selectedIds.size) return;

    const bulkAudit = document.getElementById("bulkAudit")?.value || "";

    if (!bulkAudit) {
      toast_("未選擇要套用的欄位", "err");
      return;
    }

    for (const userId of selectedIds) {
      const u = findUserById_(userId);
      if (!u) continue;

      u.audit = bulkAudit;
      markDirty_(userId, u);
    }

    toast_("已套用到選取（尚未儲存）", "ok");
    applyFilters();
  });

  document.getElementById("bulkDelete")?.addEventListener("click", async () => {
    if (!selectedIds.size) return;

    const yes = confirm(`確定批次刪除 ${selectedIds.size} 筆？`);
    if (!yes) return;

    const ids = Array.from(selectedIds);
    let okCount = 0;

    for (const id of ids) {
      const r = await techPost_({ mode: "deleteUser", userId: id });
      if (r.ok) okCount++;
    }

    toast_(`批次刪除完成：${okCount}/${ids.length}`, okCount ? "ok" : "err");
    await loadUsers();
  });

  document.getElementById("bulkClear")?.addEventListener("click", () => {
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
  document.getElementById("bulkBar") && (document.getElementById("bulkBar").hidden = true);
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

    const rows = tbody.querySelectorAll(".row-check[data-userid]");
    if (chk.checked) rows.forEach((r) => selectedIds.add(r.getAttribute("data-userid")));
    else rows.forEach((r) => selectedIds.delete(r.getAttribute("data-userid")));

    rows.forEach((r) => (r.checked = chk.checked));

    updateBulkBar_();
    updateFooter_();
  });
}

function syncCheckAll_() {
  const chk = document.getElementById("checkAll");
  const tbody = document.getElementById("tbody");
  if (!chk || !tbody) return;

  const rows = Array.from(tbody.querySelectorAll(".row-check[data-userid]"));
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

  let approved = 0, pending = 0, rejected = 0, disabled = 0;

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

  el.textContent =
    `顯示 ${filteredUsers.length}/${allUsers.length}｜已選取 ${selectedIds.size}｜未儲存 ${dirtyMap.size}` +
    (lastLoadedAt ? `｜更新：${lastLoadedAt}` : "");
}

function updateFooter_() {
  const el = document.getElementById("footerStatus");
  if (!el) return;
  el.textContent = `選取 ${selectedIds.size}｜未儲存 ${dirtyMap.size}`;
}

// =========================================================
// 11) Helpers
// =========================================================
function snapshot_(u) {
  return JSON.stringify({
    userId: String(u.userId || "").trim(),
    displayName: String(u.displayName || ""),
    audit: String(u.audit || "待審核"),
    startDate: normalizeDateForPost_(u.startDate),
    usageDays: String(u.usageDays ?? ""),
  });
}

function markDirty_(userId, u) {
  const orig = originalMap.get(userId) || "";
  const now = snapshot_(u);
  if (orig !== now) dirtyMap.set(userId, true);
  else dirtyMap.delete(userId);
}

function calcExpiryStatus_(u) {
  const start = normalizeDateForPost_(u.startDate);
  const daysRaw = String(u.usageDays ?? "").trim();
  const n = parseInt(daysRaw, 10);

  if (!start || !daysRaw || isNaN(n) || n <= 0) {
    return { label: "未設定", cls: "unset", rank: 1 };
  }

  const startDate = new Date(start + "T00:00:00");
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expire = new Date(startDate.getTime() + n * 24 * 60 * 60 * 1000);

  if (today0.getTime() >= expire.getTime()) return { label: "已到期", cls: "expired", rank: 0 };
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

function toDateInputValue_(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) return s.slice(0, 10);

  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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
  return escapeHtml_(s).replaceAll("\n", " ");
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
