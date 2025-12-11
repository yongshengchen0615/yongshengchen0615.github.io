// ★ 換成你的 GAS 部署網址
const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

let allUsers = [];
let filteredUsers = [];

document.addEventListener("DOMContentLoaded", () => {
  loadUsers();
  bindFilter();

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }
});

/* ===== Chip 點選事件 ===== */
function bindFilter() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) =>
        c.classList.remove("active")
      );
      chip.classList.add("active");
      applyFilters();
    });
  });
}

/* ===== 讀資料 ===== */
async function loadUsers() {
  try {
    const res = await fetch(API_BASE_URL + "?mode=listUsers");
    const json = await res.json();
    if (!json.ok) {
      alert("讀取失敗");
      return;
    }
    allUsers = json.users || [];
    applyFilters(); // 內部會順便更新 summary / footer
  } catch (err) {
    console.error("loadUsers error:", err);
    alert("讀取失敗，請稍後再試");
  }
}

/* ===== 篩選 + 搜尋 ===== */
function applyFilters() {
  const keyword = (document.getElementById("searchInput")?.value || "")
    .toLowerCase();
  const activeChip = document.querySelector(".chip.active");
  const filter = activeChip ? activeChip.dataset.filter : "ALL";

  filteredUsers = allUsers.filter((u) => {
    if (filter !== "ALL" && u.audit !== filter) return false;
    if (
      keyword &&
      !(`${u.userId} ${u.displayName}`.toLowerCase().includes(keyword))
    )
      return false;
    return true;
  });

  renderTable();
  updateSummary();
  updateFooter();
}

/* ===== 更新上方 summary ===== */
function updateSummary() {
  const el = document.getElementById("summaryText");
  if (!el) return;
  const total = allUsers.length;
  const approved = allUsers.filter((u) => u.audit === "通過").length;
  const pending = allUsers.filter((u) => u.audit === "待審核").length;
  const rejected = allUsers.filter((u) => u.audit === "拒絕").length;

  el.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected}）`;
}

/* ===== 更新下方 footer ===== */
function updateFooter() {
  const el = document.getElementById("footerStatus");
  if (!el) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  el.textContent = `最後更新時間：${hh}:${mm}:${ss}，目前顯示 ${filteredUsers.length} 筆`;
}

/* ===== 表格渲染 ===== */
function renderTable() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!filteredUsers.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="11">無資料</td>`;
    tbody.appendChild(tr);
    return;
  }

  filteredUsers.forEach((u, i) => {
    const expiry = getExpiryInfo(u);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${u.userId}</td>
      <td>${u.displayName}</td>
      <td>${u.createdAt}</td>

      <td>
        <input type="date" class="date-input" value="${toInputDate(
          u.startDate
        )}">
      </td>

      <td>
        <input type="number"
               class="days-input"
               min="1"
               value="${u.usageDays || ""}">
      </td>

      <td><span class="expiry-pill ${expiry.cls}">${expiry.text}</span></td>

      <td><span class="badge ${badgeCls(u.audit)}">${u.audit}</span></td>

      <td>
        <input type="text"
               class="master-code-input"
               placeholder="師傅編號"
               value="${u.masterCode || ""}">
      </td>

      <td>${u.masterCode ? "是" : "否"}</td>

      <td>
        <button class="btn btn-sm" data-act="save">儲存期限</button>
        <button class="btn btn-sm" data-act="saveMaster">儲存師傅</button>
        <button class="btn btn-sm primary" data-act="approve">通過</button>
        <button class="btn btn-sm" data-act="pending">待審核</button>
        <button class="btn btn-sm danger" data-act="reject">拒絕</button>
      </td>
    `;

    const dateInput = tr.querySelector(".date-input");
    const daysInput = tr.querySelector(".days-input");
    const masterInput = tr.querySelector(".master-code-input");

    tr.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "save") {
          updateUsage(u.userId, dateInput.value, daysInput.value);
        } else if (act === "saveMaster") {
          updateMaster(u.userId, masterInput.value);
        } else {
          // 用按鈕文字當作狀態值（通過 / 待審核 / 拒絕）
          updateStatus(u.userId, btn.textContent.trim());
        }
      });
    });

    tbody.appendChild(tr);
  });
}

/* ===== 判斷使用狀態 ===== */
function getExpiryInfo(u) {
  if (!u.startDate || !u.usageDays) return { cls: "unset", text: "未設定" };

  // GAS 回來的 startDate 是 "yyyy-MM-dd HH:mm:ss" 之類
  const start = new Date(String(u.startDate).replace(" ", "T"));
  if (isNaN(start.getTime()))
    return { cls: "unset", text: "未設定" };

  const end = new Date(start.getTime() + Number(u.usageDays) * 86400000);
  const diff = Math.ceil((end - new Date()) / 86400000);

  if (diff < 0) return { cls: "expired", text: `已過期（超 ${Math.abs(diff)} 天）` };
  return { cls: "active", text: `使用中（剩 ${diff} 天）` };
}

function badgeCls(audit) {
  if (audit === "通過") return "approved";
  if (audit === "拒絕") return "rejected";
  return "pending";
}

function toInputDate(str) {
  if (!str) return "";
  const d = new Date(String(str).replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/* ===== 更新審核狀態 ===== */
async function updateStatus(id, status) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "updateStatus");
    fd.append("userId", id);
    fd.append("audit", status);

    await fetch(API_BASE_URL, { method: "POST", body: fd });
    await loadUsers();
  } catch (err) {
    console.error("updateStatus error:", err);
    alert("更新審核狀態失敗");
  }
}

/* ===== 更新開始日期 + 使用期限 ===== */
async function updateUsage(id, date, days) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "updateUsage");
    fd.append("userId", id);
    fd.append("startDate", date);
    fd.append("usageDays", days);

    await fetch(API_BASE_URL, { method: "POST", body: fd });
    await loadUsers();
  } catch (err) {
    console.error("updateUsage error:", err);
    alert("更新使用期限失敗");
  }
}

/* ===== 更新師傅編號（順便決定是否師傅） ===== */
async function updateMaster(id, masterCode) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "updateMaster");
    fd.append("userId", id);
    fd.append("masterCode", masterCode);

    await fetch(API_BASE_URL, { method: "POST", body: fd });
    await loadUsers();
  } catch (err) {
    console.error("updateMaster error:", err);
    alert("更新師傅資訊失敗");
  }
}
