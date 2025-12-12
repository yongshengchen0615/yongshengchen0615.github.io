// ★ 換成你的 GAS 最新部署網址
const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

let allUsers = [];
let filteredUsers = [];

document.addEventListener("DOMContentLoaded", () => {
  initTheme_();

  loadUsers();
  bindFilter();

  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.addEventListener("input", applyFilters);

  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme_);
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
    allUsers = json.users || [];
    applyFilters();
  } catch (err) {
    console.error("loadUsers error:", err);
    toast("讀取失敗", "err");
  }
}

function applyFilters() {
  const keyword = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const activeChip = document.querySelector(".chip.active");
  const filter = activeChip ? activeChip.dataset.filter : "ALL";

  filteredUsers = allUsers.filter((u) => {
    if (filter !== "ALL" && u.audit !== filter) return false;
    if (keyword) {
      const hay = `${u.userId} ${u.displayName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  renderTable();
  updateSummary();
  updateFooter();
}

function updateSummary() {
  const el = document.getElementById("summaryText");
  if (!el) return;

  const total = allUsers.length;
  const approved = allUsers.filter((u) => u.audit === "通過").length;
  const pending = allUsers.filter((u) => u.audit === "待審核").length;
  const rejected = allUsers.filter((u) => u.audit === "拒絕").length;

  el.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected}）`;
}

function updateFooter() {
  const el = document.getElementById("footerStatus");
  if (!el) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  el.textContent = `最後更新時間：${hh}:${mm}:${ss}，目前顯示 ${filteredUsers.length} 筆`;
}

/* ========= Table ========= */

function renderTable() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!filteredUsers.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="12">無資料</td>`;
    tbody.appendChild(tr);
    return;
  }

  filteredUsers.forEach((u, i) => {
    const expiry = getExpiryInfo(u);
    const pushEnabled = (u.pushEnabled || "否") === "是" ? "是" : "否";
    const audit = u.audit || "待審核";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(u.userId)}</td>
      <td>${escapeHtml(u.displayName || "")}</td>
      <td>${escapeHtml(u.createdAt || "")}</td>

      <td><input type="date" class="date-input" value="${toInputDate(u.startDate)}"></td>
      <td><input type="number" class="days-input" min="1" value="${escapeHtml(u.usageDays || "")}"></td>

      <td><span class="expiry-pill ${expiry.cls}">${escapeHtml(expiry.text)}</span></td>

      <td>
        <select class="audit-select" aria-label="審核狀態">
          ${auditOption("待審核", audit)}
          ${auditOption("通過", audit)}
          ${auditOption("拒絕", audit)}
          ${auditOption("停用", audit)}
          ${auditOption("其他", audit)}
        </select>
        <span class="audit-badge ${auditClass_(audit)}">${escapeHtml(audit)}</span>
      </td>

      <td><input type="text" class="master-code-input" placeholder="師傅編號" value="${escapeHtml(u.masterCode || "")}"></td>
      <td>${u.masterCode ? "是" : "否"}</td>

      <td>
        <select class="push-select" aria-label="是否推播">
          <option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td>
        <button class="btn primary btn-save">儲存</button>
        <button class="btn danger btn-del">刪除</button>
      </td>
    `;

    const dateInput = tr.querySelector(".date-input");
    const daysInput = tr.querySelector(".days-input");
    const masterInput = tr.querySelector(".master-code-input");
    const pushSelect = tr.querySelector(".push-select");
    const auditSelect = tr.querySelector(".audit-select");
    const badge = tr.querySelector(".audit-badge");
    const saveBtn = tr.querySelector(".btn-save");
    const delBtn = tr.querySelector(".btn-del");

    // audit 改變時同步 badge 顏色/文字
    auditSelect.addEventListener("change", () => {
      const v = auditSelect.value;
      badge.textContent = v;
      badge.className = `audit-badge ${auditClass_(v)}`;
    });

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "儲存中...";

      const payload = {
        userId: u.userId,
        audit: auditSelect.value,
        startDate: dateInput.value,
        usageDays: daysInput.value,
        masterCode: masterInput.value,
        pushEnabled: pushSelect.value
      };

      const ok = await updateUser(payload);

      saveBtn.disabled = false;
      saveBtn.textContent = "儲存";

      if (ok) {
        toast("儲存完成", "ok");
        await loadUsers();
      } else {
        toast("儲存失敗", "err");
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
        await loadUsers();
      } else {
        toast("刪除失敗", "err");
      }
    });

    tbody.appendChild(tr);
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
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 1600);
}

/* XSS safe */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
