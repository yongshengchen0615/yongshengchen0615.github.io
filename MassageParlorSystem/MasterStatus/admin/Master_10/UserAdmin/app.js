// ===============================
// ✅ 兩段式：先管理者 Gate，再讀技師資料
// ===============================

// ★ 管理者 GAS（用來 check personalStatusEnabled）
const ADMIN_API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

// ★ 技師個人後台 GAS（用來 listUsers / updateUser / deleteUser）
const TECH_API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbyBg3w57x-Yw4C6v-SQ9rQazx6n9_VZRDjPKvXJy8WNkv29KPbrd8gHKIu1DFjwstUg/exec";

// ✅ 你的 LIFF ID
const LIFF_ID = "2008669658-JNGJgZpR";

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
      await loadUsers(); // ✅ 這裡會讀 TECH
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

  bindFilter();
  bindSorting_();
  bindBulk_();

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

  // ✅ 先 Gate（管理者）→ 再載入 TECH
  startAuthThenLoad_();
});

/* =========================================================
 * ✅ LINE Auth Gate（管理者 check）
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
    toast("尚未設定 LIFF_ID", "err");
    return;
  }
  if (!window.liff) {
    showGate_("錯誤：LIFF SDK 未載入");
    toast("LIFF SDK 未載入", "err");
    return;
  }
  if (!ADMIN_API_BASE_URL || !TECH_API_BASE_URL) {
    showGate_("錯誤：尚未設定 ADMIN_API_BASE_URL / TECH_API_BASE_URL");
    toast("API URL 未設定", "err");
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
    showGate_("錯誤：未取得 userId");
    toast("未取得 userId", "err");
    return;
  }

  showGate_(
    `已登入：${displayName || "（無名）"}\nuserId：${userId}\n\n用「管理者 GAS」檢查個人狀態開通…`
  );

  // ✅ 先走管理者 check
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
    toast("權限檢查失敗", "err");
    return;
  }

  if (!r.enabled) {
    __authPassed = false;
    __authedUserId = userId;

    showGate_(
      `功能未開啟（管理者回傳 personalStatusEnabled != "是"）\n` +
        `userId：${userId}\n` +
        `personalStatusEnabled：${String(r.personalStatusEnabled)}\n` +
        `audit：${String(r.audit)}`
    );
    toast("功能未開啟", "err");
    return;
  }

  // ✅ 通過：進入技師資料讀取
  __authPassed = true;
  __authedUserId = userId;
  hideGate_();
  toast("驗證通過", "ok");

  await loadUsers(); // ✅ 讀 TECH
}

async function adminCheckPersonalStatus_(userId) {
  const url = ADMIN_API_BASE_URL + `?mode=check&userId=${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(url, { method: "GET" });
    const raw = await res.text();

    console.log("[admin-check] url:", url);
    console.log("[admin-check] http:", res.status, "raw:", raw.slice(0, 200));

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw };

    let json;
    try {
      json = JSON.parse(raw);
    } catch (_) {
      return { ok: false, error: "Response is not JSON", raw };
    }

    const personalStatusEnabled = json?.personalStatusEnabled;
    const enabled = String(personalStatusEnabled || "").trim() === "是";

    return {
      ok: true,
      enabled,
      personalStatusEnabled,
      audit: json?.audit,
      raw,
      json
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), raw: "" };
  }
}

/* =========================================================
 * ✅ 後續資料：全部走 TECH_API_BASE_URL
 * ========================================================= */

async function loadUsers() {
  try {
    const res = await fetch(TECH_API_BASE_URL + "?mode=listUsers");
    const raw = await res.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error("tech listUsers raw:", raw.slice(0, 300));
      throw new Error("listUsers response is not JSON");
    }

    if (!json.ok) throw new Error("listUsers not ok");
    allUsers = json.users || [];

    originalMap.clear();
    dirtyMap.clear();
    for (const u of allUsers) originalMap.set(u.userId, snapshot_(u));

    applyFilters();
    toast("資料已更新", "ok");
  } catch (err) {
    console.error("loadUsers error:", err);
    toast("讀取失敗", "err");
  }
}

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

    const res = await fetch(TECH_API_BASE_URL, { method: "POST", body: fd });
    const raw = await res.text();
    let json = {};
    try { json = JSON.parse(raw); } catch (_) {
      console.error("tech updateUser raw:", raw.slice(0, 200));
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

    const res = await fetch(TECH_API_BASE_URL, { method: "POST", body: fd });
    const raw = await res.text();
    let json = {};
    try { json = JSON.parse(raw); } catch (_) {
      console.error("tech deleteUser raw:", raw.slice(0, 200));
    }
    return !!json.ok;
  } catch (err) {
    console.error("deleteUser error:", err);
    return false;
  }
}

/* =========================================================
 * ✅ 以下：你原本的 UI / table / bulk / utils（不變）
 * （我只保留必要函式骨架，其他請保留你原本那份）
 * ========================================================= */

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

function bindFilter() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters();
    });
  });
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

// ✅ 下面這些你直接沿用你原本那份（我不重貼整坨了）
function bindSorting_() {}
function compareBy_(a, b, key, dir) { return 0; }
function bindBulk_() {}
function updateBulkBar_() {}
function hideBulkBar_() {}
function syncCheckAll_() {}
function renderTable() {}
function updateSummary() {}
function updateKpis_() {}
function updateFooter() {}

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
