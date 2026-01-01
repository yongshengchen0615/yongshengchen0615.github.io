/* ================================
 * Admin Dashboard (FULL) + LIFF Allowlist Gate + Copy userId
 * ================================ */

let ADMIN_API_URL = ""; // 你的 Admin GAS /exec
let LIFF_ID = "";
let ADMIN_ALLOW_USERIDS = [];

const AUDIT_ENUM = ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"];

let allAdmins = [];
let filtered = [];

const selectedIds = new Set();
const originalMap = new Map(); // userId -> snapshot
const dirtyMap = new Map();    // userId -> true

let savingAll = false;
let toastTimer = null;

// ✅ 登入者資訊（LIFF）
let authedUser = null; // { userId, displayName, pictureUrl }

/* =========================
 * Boot
 * ========================= */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const cfg = await loadConfig_();
    initTheme_();

    // ✅ 先做 LIFF 登入 + allowlist 驗證（通過才繼續）
    await ensureLiffAuthOrBlock_(cfg);

    $("#themeToggle")?.addEventListener("click", toggleTheme_);
    $("#reloadBtn")?.addEventListener("click", () => loadAdmins_());
    $("#saveAllBtn")?.addEventListener("click", () => saveAllDirty_());

    $("#clearSearchBtn")?.addEventListener("click", () => {
      if (savingAll) return;
      const si = $("#searchInput");
      if (si) si.value = "";
      applyFilters_();
    });

    $("#searchInput")?.addEventListener("input", debounce(() => {
      if (savingAll) return;
      applyFilters_();
    }, 180));

    bindChips_();
    bindBulk_();
    bindTableDelegation_();

    await loadAdmins_();
  } catch (e) {
    console.error(e);
    toast("初始化失敗（請檢查 config.json / LIFF）", "err");
    showBlocker_("系統初始化失敗", String(e?.message || e || "unknown"));
  }
});

/* =========================
 * Config
 * ========================= */
async function loadConfig_() {
  const res = await fetch("config.json", { cache: "no-store" });
  const cfg = await res.json();

  ADMIN_API_URL = String(cfg.ADMIN_API_URL || "").trim();
  if (!ADMIN_API_URL) throw new Error("config.json missing ADMIN_API_URL");

  LIFF_ID = String(cfg.LIFF_ID || "").trim();
  if (!LIFF_ID) throw new Error("config.json missing LIFF_ID");

  ADMIN_ALLOW_USERIDS = Array.isArray(cfg.ADMIN_ALLOW_USERIDS)
    ? cfg.ADMIN_ALLOW_USERIDS.map(x => String(x || "").trim()).filter(Boolean)
    : [];

  if (!ADMIN_ALLOW_USERIDS.length) {
    throw new Error("config.json missing ADMIN_ALLOW_USERIDS (at least 1 userId)");
  }

  return cfg;
}

/* =========================
 * LIFF Gate (Allowlist)
 * ========================= */
async function ensureLiffAuthOrBlock_() {
  if (!window.liff) {
    showBlocker_("缺少 LIFF 環境", "請用 LIFF 方式開啟此頁（LINE 內 / LIFF URL）。");
    throw new Error("LIFF SDK not available");
  }

  await window.liff.init({ liffId: LIFF_ID });

  if (!window.liff.isLoggedIn()) {
    // 會跳轉
    window.liff.login({ redirectUri: window.location.href });
    return;
  }

  const profile = await window.liff.getProfile();
  const userId = String(profile?.userId || "").trim();
  const displayName = String(profile?.displayName || "").trim();

  authedUser = {
    userId,
    displayName,
    pictureUrl: String(profile?.pictureUrl || ""),
  };

  const allow = ADMIN_ALLOW_USERIDS.includes(userId);

  setAuthText_(
    allow
      ? `已登入：${displayName || "-"} / ${userId}`
      : `已登入：${displayName || "-"} / ${userId}（未授權）`
  );

  if (!allow) {
    showBlocker_(
      "無權限使用",
      "你的 LINE userId 不在 config.json 的 ADMIN_ALLOW_USERIDS 清單中。",
      { userId, displayName }
    );

    $("#btnCloseLiff")?.addEventListener("click", () => {
      try { window.liff.closeWindow(); } catch (_) {}
    });

    throw new Error("Not in ADMIN_ALLOW_USERIDS");
  }

  hideBlocker_();
}

function setAuthText_(text) {
  const el = $("#authText");
  if (el) el.textContent = String(text || "");
}

/* =========================
 * Blocker (show userId + copy)
 * ========================= */
function showBlocker_(title, msg, meta) {
  const b = $("#blocker");
  if (!b) return;
  b.hidden = false;

  const t = $("#blockerTitle");
  const m = $("#blockerMsg");
  const k = $("#blockerMeta");

  if (t) t.textContent = String(title || "無權限使用");
  if (m) m.textContent = String(msg || "你的帳號不在管理者清單中。");

  let userId = "";
  let displayName = "";
  if (meta && typeof meta === "object") {
    userId = String(meta.userId || "").trim();
    displayName = String(meta.displayName || "").trim();
  } else {
    const s = String(meta || "");
    userId = s.includes("userId:") ? s.split("userId:")[1].split("\n")[0].trim() : "";
    displayName = s.includes("name:") ? s.split("name:")[1].split("\n")[0].trim() : "";
  }

  if (k) {
    k.innerHTML = `
      <div class="blocker-kv">
        <div class="kv-row">
          <div class="kv-label">userId</div>
          <div class="kv-value" id="metaUserId">${escapeHtml(userId || "-")}</div>
        </div>
        <div class="kv-row">
          <div class="kv-label">displayName</div>
          <div class="kv-value">${escapeHtml(displayName || "-")}</div>
        </div>
      </div>
      <div style="color:var(--text-sub);font-family:var(--mono);font-size:12px;">
        請把 userId 加到 config.json → ADMIN_ALLOW_USERIDS
      </div>
    `;
  }

  // 避免重複綁定：先移除舊 handler（用 clone 方式）
  const copyBtn = $("#btnCopyUserId");
  if (copyBtn) {
    const newBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newBtn, copyBtn);

    newBtn.addEventListener("click", async () => {
      const uid = String(userId || "").trim();
      if (!uid) return toast("找不到 userId", "err");

      try {
        await navigator.clipboard.writeText(uid);
        toast("已複製 userId", "ok");
      } catch (e) {
        // fallback
        try {
          const ta = document.createElement("textarea");
          ta.value = uid;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          ta.remove();
          toast("已複製 userId", "ok");
        } catch (_) {
          toast("複製失敗（請手動選取）", "err");
        }
      }
    });
  }

  // 點 userId 也能複製（加強 UX）
  const metaUid = document.getElementById("metaUserId");
  if (metaUid) {
    metaUid.style.cursor = "pointer";
    metaUid.title = "點擊複製";
    metaUid.addEventListener("click", async () => {
      const uid = String(userId || "").trim();
      if (!uid) return;
      try {
        await navigator.clipboard.writeText(uid);
        toast("已複製 userId", "ok");
      } catch (_) {}
    });
  }
}

function hideBlocker_() {
  const b = $("#blocker");
  if (b) b.hidden = true;
}

/* =========================
 * Theme
 * ========================= */
function initTheme_() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}
function toggleTheme_() {
  if (savingAll) return;
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

/* =========================
 * Data load
 * ========================= */
async function loadAdmins_() {
  try {
    setLock_(true);
    const ret = await apiPost_({ mode: "listAdmins" });
    if (!ret.ok) throw new Error(ret.error || "listAdmins failed");

    allAdmins = (ret.admins || []).map(a => ({
      userId: String(a.userId || ""),
      displayName: String(a.displayName || ""),
      audit: normalizeAudit_(a.audit),
      createdAt: String(a.createdAt || ""),
      lastLogin: String(a.lastLogin || ""),
    }));

    originalMap.clear();
    dirtyMap.clear();
    selectedIds.clear();

    for (const a of allAdmins) originalMap.set(a.userId, snapshot_(a));

    applyFilters_();
    toast("資料已更新", "ok");
  } catch (e) {
    console.error(e);
    toast("讀取失敗", "err");
  } finally {
    setLock_(false);
  }
}

function applyFilters_() {
  const keyword = String($("#searchInput")?.value || "").trim().toLowerCase();
  const active = document.querySelector(".chip.active");
  const filter = active ? String(active.dataset.filter || "ALL") : "ALL";

  filtered = allAdmins.filter(a => {
    if (filter !== "ALL" && normalizeAudit_(a.audit) !== filter) return false;
    if (keyword) {
      const hay = `${a.userId} ${a.displayName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  render_();
  updateStats_();
  syncCheckAll_();
  updateBulkBar_();
  refreshSaveAllButton_();
  updateFooter_();
}

/* =========================
 * Render
 * ========================= */
function render_() {
  const tbody = $("#tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8">無資料</td></tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  filtered.forEach((a, i) => {
    const isDirty = dirtyMap.has(a.userId);

    const tr = document.createElement("tr");
    tr.dataset.userid = a.userId;
    if (isDirty) tr.classList.add("dirty");

    tr.innerHTML = `
      <td class="sticky-col col-check">
        <input class="row-check" type="checkbox" ${selectedIds.has(a.userId) ? "checked" : ""} aria-label="選取此列">
      </td>
      <td>${i + 1}</td>
      <td><span style="font-family:var(--mono)">${escapeHtml(a.userId)}</span></td>
      <td>${escapeHtml(a.displayName)}</td>
      <td>
        <select data-field="audit" class="select" aria-label="審核狀態">
          ${AUDIT_ENUM.map(v => `<option value="${v}" ${normalizeAudit_(a.audit)===v ? "selected":""}>${v}</option>`).join("")}
        </select>
      </td>
      <td><span style="font-family:var(--mono)">${escapeHtml(a.createdAt)}</span></td>
      <td><span style="font-family:var(--mono)">${escapeHtml(a.lastLogin)}</span></td>
      <td>
        <div class="actions">
          ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : ``}
          <button class="btn danger btn-del" type="button">刪除</button>
        </div>
      </td>
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  if (savingAll) {
    tbody.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
  }
}

function updateStats_() {
  const total = allAdmins.length;
  const approved = allAdmins.filter(a => normalizeAudit_(a.audit) === "通過").length;
  const pending = allAdmins.filter(a => normalizeAudit_(a.audit) === "待審核").length;
  const rejected = allAdmins.filter(a => normalizeAudit_(a.audit) === "拒絕").length;

  setText_("kpiTotal", total);
  setText_("kpiApproved", approved);
  setText_("kpiPending", pending);
  setText_("kpiRejected", rejected);

  const s = $("#summaryText");
  if (s) s.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected}）`;
}

/* =========================
 * Selection + Bulk
 * ========================= */
function bindBulk_() {
  $("#checkAll")?.addEventListener("change", () => {
    if (savingAll) return;
    const checked = !!$("#checkAll").checked;
    filtered.forEach(a => checked ? selectedIds.add(a.userId) : selectedIds.delete(a.userId));
    render_();
    syncCheckAll_();
    updateBulkBar_();
  });

  $("#bulkClear")?.addEventListener("click", () => {
    if (savingAll) return;
    selectedIds.clear();
    render_();
    syncCheckAll_();
    updateBulkBar_();
  });

  $("#bulkApply")?.addEventListener("click", () => bulkApply_());
  $("#bulkDelete")?.addEventListener("click", () => bulkDelete_());
}

function bulkApply_() {
  if (savingAll) return;

  const audit = String($("#bulkAudit")?.value || "").trim();
  if (!audit) return toast("請先選擇批次審核狀態", "err");

  const ids = Array.from(selectedIds);
  if (!ids.length) return toast("請先勾選要套用的管理員", "err");

  ids.forEach(id => {
    const a = allAdmins.find(x => x.userId === id);
    if (!a) return;
    a.audit = normalizeAudit_(audit);
    markDirty_(id, a);
  });

  applyFilters_();
  toast("已套用到選取（尚未儲存）", "ok");
}

async function bulkDelete_() {
  if (savingAll) return;

  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  const ok = confirm(`確定要批次刪除？\n\n共 ${ids.length} 筆。\n此操作不可復原。`);
  if (!ok) return;

  setLock_(true);

  let okCount = 0, failCount = 0;
  for (const id of ids) {
    const ret = await apiPost_({ mode: "deleteAdmin", userId: id }).catch(() => ({}));
    if (ret && ret.ok) okCount++;
    else failCount++;
    await sleep_(80);
  }

  toast(failCount === 0 ? `批次刪除完成：${okCount} 筆` : `刪除：成功 ${okCount} / 失敗 ${failCount}`, failCount ? "err" : "ok");
  await loadAdmins_();
  setLock_(false);
}

/* =========================
 * Table delegation
 * ========================= */
function bindTableDelegation_() {
  const tbody = $("#tbody");
  if (!tbody) return;

  tbody.addEventListener("change", (e) => {
    if (savingAll) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.classList.contains("row-check")) {
      const row = t.closest("tr");
      const id = row?.dataset.userid;
      if (!id) return;
      t.checked ? selectedIds.add(id) : selectedIds.delete(id);
      syncCheckAll_();
      updateBulkBar_();
      return;
    }

    if (t.matches("select[data-field='audit']")) {
      const row = t.closest("tr");
      const id = row?.dataset.userid;
      if (!id) return;
      const a = allAdmins.find(x => x.userId === id);
      if (!a) return;
      a.audit = normalizeAudit_(t.value);
      markDirty_(id, a);
      row.classList.toggle("dirty", dirtyMap.has(id));
      refreshSaveAllButton_();
      updateFooter_();
    }
  });

  tbody.addEventListener("click", async (e) => {
    if (savingAll) return;
    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (!btn) return;

    const row = btn.closest("tr");
    const id = row?.dataset.userid;
    if (!id) return;

    if (btn.classList.contains("btn-del")) {
      const a = allAdmins.find(x => x.userId === id);
      const ok = confirm(`確定要刪除？\n\nuserId: ${id}\n名稱: ${a?.displayName || ""}`);
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "刪除中...";
      const ret = await apiPost_({ mode: "deleteAdmin", userId: id }).catch(() => ({}));
      if (ret && ret.ok) {
        toast("刪除完成", "ok");
        await loadAdmins_();
      } else {
        toast("刪除失敗", "err");
        btn.disabled = false;
        btn.textContent = "刪除";
      }
    }
  });
}

/* =========================
 * Save All
 * ========================= */
async function saveAllDirty_() {
  const ids = Array.from(dirtyMap.keys());
  if (!ids.length) return toast("目前沒有需要儲存的變更", "ok");

  savingAll = true;
  setLock_(true);
  refreshSaveAllButton_();

  try {
    const items = ids.map(id => allAdmins.find(x => x.userId === id)).filter(Boolean).map(a => ({
      userId: a.userId,
      displayName: a.displayName,
      audit: normalizeAudit_(a.audit),
    }));

    const ret = await apiPost_({ mode: "updateAdminsBatch", items });
    if (!ret || !ret.ok) throw new Error(ret?.error || "updateAdminsBatch failed");

    const failedSet = new Set((ret.fail || []).map(x => String(x.userId || "").trim()));
    items.forEach(it => {
      if (!it.userId || failedSet.has(it.userId)) return;
      const a = allAdmins.find(x => x.userId === it.userId);
      if (!a) return;
      originalMap.set(it.userId, snapshot_(a));
      dirtyMap.delete(it.userId);
    });

    applyFilters_();
    toast(ret.failCount ? `儲存完成：成功 ${ret.okCount} / 失敗 ${ret.failCount}` : `全部儲存完成：${ret.okCount} 筆`, ret.failCount ? "err" : "ok");
  } catch (e) {
    console.error(e);
    toast("儲存失敗", "err");
  } finally {
    savingAll = false;
    setLock_(false);
    refreshSaveAllButton_();
  }
}

/* =========================
 * UI helpers
 * ========================= */
function bindChips_() {
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      if (savingAll) return;
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters_();
    });
  });
}

function syncCheckAll_() {
  const checkAll = $("#checkAll");
  if (!checkAll) return;

  const total = filtered.length;
  const sel = filtered.filter(a => selectedIds.has(a.userId)).length;

  checkAll.checked = total > 0 && sel === total;
  checkAll.indeterminate = sel > 0 && sel < total;
}

function updateBulkBar_() {
  const bar = $("#bulkBar");
  const count = $("#bulkCount");
  if (!bar || !count) return;

  const n = selectedIds.size;
  bar.hidden = n === 0;
  count.textContent = `已選取 ${n} 筆`;
}

function refreshSaveAllButton_() {
  const btn = $("#saveAllBtn");
  if (!btn) return;

  const n = dirtyMap.size;
  btn.disabled = savingAll || n === 0;
  btn.textContent = savingAll ? "儲存中..." : n ? `儲存全部變更（${n}）` : "儲存全部變更";
}

function updateFooter_() {
  const el = $("#footerStatus");
  if (!el) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const dirty = dirtyMap.size ? `，未儲存 ${dirtyMap.size} 筆` : "";
  el.textContent = `最後更新：${hh}:${mm}:${ss}，目前顯示 ${filtered.length} 筆${dirty}`;
}

function setLock_(locked) {
  ["reloadBtn", "themeToggle", "searchInput", "clearSearchBtn", "checkAll", "bulkClear", "bulkAudit", "bulkApply", "bulkDelete", "saveAllBtn"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = locked;
    });

  document.querySelectorAll(".chip").forEach(el => el.disabled = locked);
}

/* =========================
 * API
 * ========================= */
async function apiPost_(bodyObj) {
  const res = await fetch(ADMIN_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj),
  });
  return await res.json().catch(() => ({}));
}

/* =========================
 * Snapshot / Dirty
 * ========================= */
function snapshot_(a) {
  return JSON.stringify({
    userId: a.userId,
    displayName: a.displayName,
    audit: normalizeAudit_(a.audit),
    createdAt: a.createdAt,
    lastLogin: a.lastLogin,
  });
}

function markDirty_(id, a) {
  const orig = originalMap.get(id) || "";
  const now = snapshot_(a);
  if (orig !== now) dirtyMap.set(id, true);
  else dirtyMap.delete(id);
}

function normalizeAudit_(v) {
  const s = String(v || "").trim();
  if (!s) return "待審核";
  return AUDIT_ENUM.includes(s) ? s : "其他";
}

/* =========================
 * Utils
 * ========================= */
function $(sel) { return document.querySelector(sel.startsWith("#") ? sel : sel); }

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

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function sleep_(ms) { return new Promise(r => setTimeout(r, ms)); }
