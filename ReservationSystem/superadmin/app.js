const CONFIG_PATH = "./config.json";

const state = {
  gasUrl: "",
  configGasUrl: "",
  liffId: "",
  profile: null,
  adminUser: null,
  adminUsers: [],
  superAdmins: [],
  lastSyncText: "",
  ui: {
    busyCount: 0,
  },
};

const elements = {
  topLoadingBar: document.querySelector("#topLoadingBar"),
  topLoadingLabel: document.querySelector("#topLoadingLabel"),
  loginButton: document.querySelector("#loginButton"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  avatar: document.querySelector("#avatar"),
  displayName: document.querySelector("#displayName"),
  statusBadge: document.querySelector("#statusBadge"),
  statusText: document.querySelector("#statusText"),
  approvalBanner: document.querySelector("#approvalBanner"),
  superAdminContent: document.querySelector("#superAdminContent"),
  adminPermissionTable: document.querySelector("#adminPermissionTable"),
  summaryLabel: document.querySelector("#summaryLabel"),
  lastSyncLabel: document.querySelector("#lastSyncLabel"),
};

function normalizeGasUrl(value) {
  return String(value || "").trim();
}

function normalizeLiffId(value) {
  return String(value || "").trim();
}

function getCurrentAdminUserId() {
  return String(state.profile?.userId || state.adminUser?.userId || "").trim();
}

function startBusyState() {
  state.ui.busyCount += 1;
  document.body.classList.add("is-busy");
}

function endBusyState() {
  state.ui.busyCount = Math.max(0, state.ui.busyCount - 1);
  if (!state.ui.busyCount) {
    document.body.classList.remove("is-busy");
  }
}

function showLoading(message, type = "info") {
  if (!elements.topLoadingBar || !elements.topLoadingLabel) {
    return;
  }

  elements.topLoadingBar.classList.remove("is-hidden");
  elements.topLoadingBar.dataset.type = type;
  elements.topLoadingBar.setAttribute("aria-busy", type === "loading" ? "true" : "false");
  elements.topLoadingLabel.textContent = message;
}

function setStatus(message, type = "info") {
  showLoading(message, type);

  window.clearTimeout(setStatus.timerId);
  setStatus.timerId = window.setTimeout(() => {
    elements.topLoadingBar?.classList.add("is-hidden");
  }, type === "error" ? 4800 : 2600);
}

function setContentAccess(canAccess) {
  elements.superAdminContent?.classList.toggle("is-hidden", !canAccess);
}

function setApprovalMessage(message, tone) {
  if (!elements.approvalBanner) {
    return;
  }

  elements.approvalBanner.textContent = message;
  elements.approvalBanner.dataset.tone = tone;
}

function renderAccessState() {
  if (!elements.displayName || !elements.statusBadge || !elements.statusText) {
    return;
  }

  const normalizedStatus = String(state.adminUser?.status || "").trim();
  const isApprovedSuperAdmin = Boolean(state.adminUser?.isSuperAdmin) && normalizedStatus === "已通過";

  if (!state.profile) {
    elements.displayName.textContent = "尚未登入 LINE";
    elements.statusBadge.textContent = "未登入";
    elements.statusBadge.dataset.tone = "muted";
    elements.statusText.textContent = "請先登入 LINE，系統會確認你是否屬於最高管理員。";
    setApprovalMessage("此頁僅提供最高管理員設定 admin 的管理員修改權限。", "info");
    elements.logoutButton.disabled = true;
    setContentAccess(false);
    return;
  }

  elements.displayName.textContent = state.profile.displayName || "LINE 最高管理員";
  elements.logoutButton.disabled = false;

  if (state.profile.pictureUrl && elements.avatar) {
    elements.avatar.src = state.profile.pictureUrl;
    elements.avatar.classList.remove("is-hidden");
  } else {
    elements.avatar?.classList.add("is-hidden");
  }

  if (!state.adminUser) {
    elements.statusBadge.textContent = "同步中";
    elements.statusBadge.dataset.tone = "pending";
    elements.statusText.textContent = "正在同步你的管理員身分。";
    setApprovalMessage("正在確認最高管理員權限...", "pending");
    setContentAccess(false);
    return;
  }

  if (isApprovedSuperAdmin) {
    elements.statusBadge.textContent = "最高管理員";
    elements.statusBadge.dataset.tone = "approved";
    elements.statusText.textContent = "你可管理 admin 專案中誰有權修改其他管理員。";
    setApprovalMessage("已通過最高管理員驗證，可管理 admin 管理員修改權限。", "approved");
    setContentAccess(true);
    return;
  }

  if (normalizedStatus === "待審核") {
    elements.statusBadge.textContent = "待審核";
    elements.statusBadge.dataset.tone = "pending";
    elements.statusText.textContent = "此 LINE 帳號已寫入 SuperAdmins，但尚未通過最高管理員審核。";
    setApprovalMessage("請在 SuperAdmins 工作表將此帳號的 status 改為 已通過，或改用既有最高管理員登入。", "pending");
    setContentAccess(false);
    return;
  }

  if (normalizedStatus === "已拒絕" || normalizedStatus === "已停用") {
    elements.statusBadge.textContent = normalizedStatus;
    elements.statusBadge.dataset.tone = "blocked";
    elements.statusText.textContent = "此 LINE 帳號目前不可使用最高管理員後台。";
    setApprovalMessage(state.adminUser.note || "請確認 SuperAdmins 工作表中的 status 設定，或改用既有最高管理員登入。", "blocked");
    setContentAccess(false);
    return;
  }

  elements.statusBadge.textContent = state.adminUser.status || "無權限";
  elements.statusBadge.dataset.tone = "blocked";
  elements.statusText.textContent = "此 LINE 帳號不是最高管理員。";
  setApprovalMessage("請先在 SuperAdmins 工作表新增此帳號，並將 status 改為 已通過，或改用既有最高管理員登入。", "blocked");
  setContentAccess(false);
}

async function loadConfigFromJson() {
  try {
    const response = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`config load failed: ${response.status}`);
    }

    const config = await response.json();
    state.configGasUrl = normalizeGasUrl(config.gasWebAppUrl || config.gasUrl);
    state.liffId = normalizeLiffId(config.liffId);
    state.gasUrl = state.configGasUrl;
  } catch (error) {
    state.configGasUrl = "";
    state.gasUrl = "";
    state.liffId = "";
  }
}

async function ensureLiffSession() {
  if (!state.liffId) {
    throw new Error("請先在 superadmin/config.json 設定 liffId。");
  }

  if (!window.liff) {
    throw new Error("LIFF SDK 載入失敗。");
  }

  await window.liff.init({ liffId: state.liffId });

  if (!window.liff.isLoggedIn()) {
    setStatus("正在導向 LINE 登入...", "info");
    window.liff.login({ redirectUri: window.location.href });
    return false;
  }

  state.profile = await window.liff.getProfile();
  renderAccessState();
  return true;
}

async function requestApi(method, params = {}, body = null) {
  if (!state.gasUrl) {
    throw new Error("請先在 superadmin/config.json 設定 GAS Web App URL");
  }

  const adminUserId = getCurrentAdminUserId();
  if (!adminUserId) {
    throw new Error("請先完成 LINE 登入");
  }

  startBusyState();

  try {
    if (method === "GET") {
      const url = new URL(state.gasUrl);
      Object.entries({ ...params, adminUserId }).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      const response = await fetch(url.toString());
      return response.json();
    }

    const response = await fetch(state.gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({ ...body, adminUserId }),
    });
    return response.json();
  } finally {
    endBusyState();
  }
}

async function syncAdminUser() {
  const result = await requestApi("POST", {}, {
    action: "syncSuperAdminUser",
    payload: {
      userId: state.profile.userId,
      displayName: state.profile.displayName,
      pictureUrl: state.profile.pictureUrl || "",
    },
  });

  if (!result.ok) {
    throw new Error(result.message || "同步管理員 LINE 身分失敗");
  }

  state.adminUser = result.data;
  renderAccessState();
}

function formatDateTimeText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "尚無資料";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getStatusPill(label, tone) {
  return `<span class="status-pill status-pill--${tone}">${label}</span>`;
}

function getAdminStatusPill(status) {
  if (status === "已通過") {
    return getStatusPill(status, "approved");
  }
  if (status === "已拒絕") {
    return getStatusPill(status, "rejected");
  }
  if (status === "已停用") {
    return getStatusPill(status, "disabled");
  }
  return getStatusPill(status || "待審核", "pending");
}

function getPermissionPill(adminUser) {
  if (adminUser.isSuperAdmin) {
    return getStatusPill("最高管理員", "super");
  }

  return adminUser.canManageAdmins
    ? getStatusPill("可管理管理員", "permission")
    : getStatusPill("僅一般 admin", "locked");
}

function updateSummary() {
  const allAdmins = state.adminUsers.length;
  const permissionManagers = state.adminUsers.filter((item) => item.canManageAdmins).length;
  const superAdmins = state.superAdmins.length;
  elements.summaryLabel.textContent = `最高管理員 ${superAdmins} 位 / 可管理管理員 ${permissionManagers} 位 / 全部 ${allAdmins} 位`;
  elements.lastSyncLabel.textContent = state.lastSyncText || "尚未同步";
}

function renderAdminTable() {
  if (!elements.adminPermissionTable) {
    return;
  }

  if (!state.adminUsers.length) {
    elements.adminPermissionTable.innerHTML = '<div class="empty-state">尚無任何管理員登入紀錄。</div>';
    updateSummary();
    return;
  }

  const rows = state.adminUsers
    .slice()
    .sort((left, right) => {
      if (left.isSuperAdmin !== right.isSuperAdmin) {
        return left.isSuperAdmin ? -1 : 1;
      }

      if (left.canManageAdmins !== right.canManageAdmins) {
        return left.canManageAdmins ? -1 : 1;
      }

      return String(right.updatedAt || right.lastLoginAt || "").localeCompare(String(left.updatedAt || left.lastLoginAt || ""));
    })
    .map((adminUser) => {
      const actionButton = adminUser.canManageAdmins
        ? `<button type="button" class="button button--danger" data-admin-permission="${adminUser.userId}" data-can-manage-admins="false">收回權限</button>`
        : `<button type="button" class="button button--primary" data-admin-permission="${adminUser.userId}" data-can-manage-admins="true">授予權限</button>`;

      return `
        <tr>
          <td>
            <div class="user-cell">
              ${adminUser.pictureUrl ? `<img class="user-avatar" src="${adminUser.pictureUrl}" alt="${adminUser.displayName}" />` : `<div class="user-avatar user-avatar--placeholder">${adminUser.displayName.slice(0, 1) || "A"}</div>`}
              <div class="user-cell__meta">
                <strong>${adminUser.displayName}</strong>
                <small>${adminUser.userId}</small>
              </div>
            </div>
          </td>
          <td>${getAdminStatusPill(adminUser.status)}</td>
          <td>${getPermissionPill(adminUser)}</td>
          <td>${formatDateTimeText(adminUser.lastLoginAt)}</td>
          <td>${adminUser.note || '<span class="helper-text">尚無備註</span>'}</td>
          <td><div class="table-actions">${actionButton}</div></td>
        </tr>
      `;
    })
    .join("");

  elements.adminPermissionTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>管理員</th>
          <th>狀態</th>
          <th>管理員修改權限</th>
          <th>最後登入</th>
          <th>備註</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  updateSummary();
}

async function loadSuperAdminData() {
  showLoading("正在載入最高管理員資料...", "loading");
  const result = await requestApi("GET", { action: "superAdminData" });
  if (!result.ok) {
    throw new Error(result.message || "載入最高管理員資料失敗");
  }

  state.adminUsers = result.data.adminUsers || [];
  state.superAdmins = result.data.superAdmins || [];
  state.adminUser = state.superAdmins.find((item) => item.userId === getCurrentAdminUserId()) || state.adminUser;
  state.lastSyncText = formatDateTimeText(new Date().toISOString());
  renderAccessState();
  renderAdminTable();
  setStatus("最高管理員資料已同步。", "success");
}

async function refreshIdentity() {
  showLoading("正在確認最高管理員身分...", "loading");
  state.adminUser = null;
  renderAccessState();

  const isLoggedIn = await ensureLiffSession();
  if (!isLoggedIn) {
    return;
  }

  await syncAdminUser();
  await loadSuperAdminData();
}

async function updateAdminPermission(userId, canManageAdmins) {
  const adminUser = state.adminUsers.find((item) => item.userId === userId);
  if (!adminUser) {
    throw new Error("找不到管理員資料");
  }

  const actionLabel = canManageAdmins ? "授予" : "收回";
  const confirmed = window.confirm(`確定要${actionLabel}「${adminUser.displayName}」的管理員修改權限嗎？`);
  if (!confirmed) {
    setStatus("已取消權限變更。", "info");
    return;
  }

  showLoading("正在更新管理員修改權限...", "loading");
  const result = await requestApi("POST", {}, {
    action: "updateAdminPermission",
    payload: {
      userId,
      canManageAdmins,
    },
  });

  if (!result.ok) {
    throw new Error(result.message || "更新權限失敗");
  }

  await loadSuperAdminData();
  setStatus(`已${actionLabel}${adminUser.displayName}的管理員修改權限。`, "success");
}

function bindEvents() {
  elements.loginButton?.addEventListener("click", () => {
    refreshIdentity().catch((error) => setStatus(error.message, "error"));
  });

  elements.refreshButton?.addEventListener("click", () => {
    refreshIdentity().catch((error) => setStatus(error.message, "error"));
  });

  elements.logoutButton?.addEventListener("click", async () => {
    try {
      await window.liff.init({ liffId: state.liffId });
      if (window.liff.isLoggedIn()) {
        window.liff.logout();
      }

      state.profile = null;
      state.adminUser = null;
      state.adminUsers = [];
      state.superAdmins = [];
      state.lastSyncText = "";
      renderAccessState();
      renderAdminTable();
      setStatus("已登出 LINE 帳號。", "info");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.adminPermissionTable?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-permission]");
    if (!button) {
      return;
    }

    updateAdminPermission(button.dataset.adminPermission, button.dataset.canManageAdmins === "true").catch((error) => {
      setStatus(error.message, "error");
    });
  });
}

async function initializeApp() {
  await loadConfigFromJson();
  bindEvents();
  renderAccessState();
  renderAdminTable();

  if (state.gasUrl && state.liffId) {
    refreshIdentity().catch((error) => setStatus(error.message, "error"));
    return;
  }

  setStatus("請檢查 superadmin/config.json 內的 gasWebAppUrl 與 liffId。", "info");
}

initializeApp();