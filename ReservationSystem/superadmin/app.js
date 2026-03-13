const CONFIG_PATH = "./config.json";
const ADMIN_PAGE_OPTIONS = [
  { key: "service", label: "服務" },
  { key: "technician", label: "技師" },
  { key: "schedule", label: "班表" },
  { key: "reservation", label: "預約" },
  { key: "user", label: "用戶審核" },
];

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
    setApprovalMessage("此頁僅提供最高管理員設定 admin 的頁面權限與管理員修改權限。", "info");
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
    elements.statusText.textContent = "你可管理 admin 專案中各管理員的頁面權限與管理員修改權限。";
    setApprovalMessage("已通過最高管理員驗證，可管理 admin 的頁面權限與管理員修改權限。", "approved");
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
      url.searchParams.set("_ts", String(Date.now()));
      const response = await fetch(url.toString(), { cache: "no-store" });
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
  return adminUser.canManageAdmins
    ? getStatusPill("可管理管理員", "permission")
    : getStatusPill("僅一般 admin", "locked");
}

function getPagePermissionPills(adminUser) {
  const permissions = Array.isArray(adminUser.pagePermissions) ? adminUser.pagePermissions : [];
  if (!permissions.length) {
    return '<span class="helper-text">未指派任何頁面</span>';
  }

  return ADMIN_PAGE_OPTIONS.filter((option) => permissions.includes(option.key))
    .map((option) => `<span class="status-pill status-pill--page">${option.label}</span>`)
    .join("");
}

function getPagePermissionSummary(adminUser) {
  const permissions = Array.isArray(adminUser.pagePermissions) ? adminUser.pagePermissions : [];
  return `已開啟 ${permissions.length} / ${ADMIN_PAGE_OPTIONS.length} 個頁面`;
}

function renderAdminManagePermissionEditor(adminUser) {
  const canManageAdmins = Boolean(adminUser.canManageAdmins);
  const buttonClass = canManageAdmins ? "button button--danger" : "button button--primary";
  const buttonLabel = canManageAdmins ? "收回修改權限" : "授予修改權限";
  const helperText = canManageAdmins
    ? "此管理員目前可在 admin 後台管理其他管理員帳號。"
    : "授權後，此管理員可在 admin 後台管理其他管理員帳號。";

  return `
    <div class="admin-permission-editor">
      ${getPermissionPill(adminUser)}
      <p class="helper-text">${helperText}</p>
      <button type="button" class="${buttonClass}" data-admin-permission="${adminUser.userId}" data-can-manage-admins="${String(!canManageAdmins)}">${buttonLabel}</button>
    </div>
  `;
}

function renderPagePermissionEditor(adminUser) {
  const permissions = Array.isArray(adminUser.pagePermissions) ? adminUser.pagePermissions : [];
  const checkboxes = ADMIN_PAGE_OPTIONS.map((option) => {
    const checked = permissions.includes(option.key) ? "checked" : "";
    return `
      <label class="permission-checkbox">
        <input type="checkbox" data-page-permission-checkbox value="${option.key}" ${checked} />
        <span>${option.label}</span>
      </label>
    `;
  }).join("");

  return `
    <div class="permission-editor">
      <div class="editor-summary">
        <strong>${getPagePermissionSummary(adminUser)}</strong>
        <span class="helper-text">可直接勾選要顯示在 admin 後台的功能頁。</span>
      </div>
      <div class="permission-checkbox-grid">${checkboxes}</div>
      <div class="permission-editor__footer">
        <span class="helper-text">未勾選的頁面在 admin 後台不會顯示，也無法執行對應操作。</span>
        <button type="button" class="button button--primary" data-save-page-permissions="${adminUser.userId}">儲存頁面權限</button>
      </div>
    </div>
  `;
}

function updateSummary() {
  const allAdmins = state.adminUsers.length;
  const permissionManagers = state.adminUsers.filter((item) => item.canManageAdmins).length;
  const superAdmins = state.superAdmins.length;
  const restrictedAdmins = state.adminUsers.filter((item) => Array.isArray(item.pagePermissions) && item.pagePermissions.length < ADMIN_PAGE_OPTIONS.length).length;
  elements.summaryLabel.textContent = `最高管理員 ${superAdmins} 位 / 可管理管理員 ${permissionManagers} 位 / 受限頁面 ${restrictedAdmins} 位 / 全部 ${allAdmins} 位`;
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
      const isCurrentUser = adminUser.userId === getCurrentAdminUserId();
      const statusButtons = `
        <button type="button" class="button button--secondary" data-review-admin="${adminUser.userId}" data-review-status="待審核">待審核</button>
        <button type="button" class="button button--primary" data-review-admin="${adminUser.userId}" data-review-status="已通過">通過</button>
        <button type="button" class="button button--secondary" data-review-admin="${adminUser.userId}" data-review-status="已拒絕">拒絕</button>
        <button type="button" class="button button--danger" data-review-admin="${adminUser.userId}" data-review-status="已停用">停用</button>
      `;
      const deleteButton = isCurrentUser
        ? `<span class="helper-text">目前登入帳號不可刪除</span>`
        : `<button type="button" class="button button--danger" data-delete-admin="${adminUser.userId}">刪除管理員</button>`;
      const identityPills = [getAdminStatusPill(adminUser.status)];

      if (adminUser.isSuperAdmin) {
        identityPills.push(getStatusPill("最高管理員", "super"));
      }

      if (isCurrentUser) {
        identityPills.push(getStatusPill("目前登入", "permission"));
      }

      return `
        <tr class="admin-row">
          <td class="cell-admin" data-label="管理員">
            <div class="user-cell">
              ${adminUser.pictureUrl ? `<img class="user-avatar" src="${adminUser.pictureUrl}" alt="${adminUser.displayName}" />` : `<div class="user-avatar user-avatar--placeholder">${adminUser.displayName.slice(0, 1) || "A"}</div>`}
              <div class="user-cell__meta">
                <strong>${adminUser.displayName}</strong>
                <small>${adminUser.userId}</small>
                <div class="status-pill-group">${identityPills.join("")}</div>
              </div>
            </div>
          </td>
          <td class="cell-status" data-label="管理狀態">${getPermissionPill(adminUser)}</td>
          <td class="cell-editor" data-label="管理員修改權限設定">${renderAdminManagePermissionEditor(adminUser)}</td>
          <td class="cell-pages" data-label="頁面權限">
            <div class="status-pill-group">${getPagePermissionPills(adminUser)}</div>
            <p class="helper-text helper-text--compact">${getPagePermissionSummary(adminUser)}</p>
          </td>
          <td class="cell-editor" data-label="頁面權限設定">${renderPagePermissionEditor(adminUser)}</td>
          <td class="cell-last-login" data-label="最後登入">${formatDateTimeText(adminUser.lastLoginAt)}</td>
          <td class="cell-note" data-label="備註">${adminUser.note || '<span class="helper-text">尚無備註</span>'}</td>
          <td class="cell-actions" data-label="操作">
            <div class="table-actions table-actions--stack">
              <div class="action-group">
                <span class="action-group__label">審核狀態</span>
                <div class="table-actions table-actions--grid">${statusButtons}</div>
              </div>
              <div class="action-group">
                <span class="action-group__label">帳號操作</span>
                <div class="table-actions">${deleteButton}</div>
              </div>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.adminPermissionTable.innerHTML = `
    <div class="table-scroll">
      <table class="list-table list-table--permissions">
        <colgroup>
          <col style="width: 280px;" />
          <col style="width: 156px;" />
          <col style="width: 260px;" />
          <col style="width: 220px;" />
          <col style="width: 310px;" />
          <col style="width: 156px;" />
          <col style="width: 220px;" />
          <col style="width: 240px;" />
        </colgroup>
        <thead>
          <tr>
            <th>管理員</th>
            <th>管理狀態</th>
            <th>管理員修改權限設定</th>
            <th>頁面權限</th>
            <th>頁面權限設定</th>
            <th>最後登入</th>
            <th>備註</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
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

async function updateAdminPermission(userId, updates, options = {}) {
  const adminUser = state.adminUsers.find((item) => item.userId === userId);
  if (!adminUser) {
    throw new Error("找不到管理員資料");
  }

  const payload = {
    userId,
    canManageAdmins: Object.prototype.hasOwnProperty.call(updates, "canManageAdmins")
      ? updates.canManageAdmins
      : adminUser.canManageAdmins,
    pagePermissions: Object.prototype.hasOwnProperty.call(updates, "pagePermissions")
      ? updates.pagePermissions
      : (adminUser.pagePermissions || []),
  };

  const confirmMessage = options.confirmMessage || `確定要更新「${adminUser.displayName}」的 admin 權限嗎？`;
  const confirmed = window.confirm(confirmMessage);
  if (!confirmed) {
    setStatus(options.cancelMessage || "已取消權限變更。", "info");
    return;
  }

  showLoading(options.loadingMessage || "正在更新 admin 權限...", "loading");
  const result = await requestApi("POST", {}, {
    action: "updateAdminPermission",
    payload,
  });

  if (!result.ok) {
    throw new Error(result.message || "更新權限失敗");
  }

  await loadSuperAdminData();
  setStatus(options.successMessage || `已更新 ${adminUser.displayName} 的 admin 權限。`, "success");
}

function getRowPagePermissions(row) {
  return Array.from(row.querySelectorAll('[data-page-permission-checkbox]:checked')).map((input) => input.value);
}

async function reviewAdminUser(userId, status) {
  const adminUser = state.adminUsers.find((item) => item.userId === userId);
  if (!adminUser) {
    throw new Error("找不到管理員資料");
  }

  const confirmed = window.confirm(`確定要將「${adminUser.displayName}」的 admin 狀態設為「${status}」嗎？`);
  if (!confirmed) {
    setStatus("已取消審核狀態變更。", "info");
    return;
  }

  showLoading("正在更新 admin 審核狀態...", "loading");
  const result = await requestApi("POST", {}, {
    action: "reviewAdminUser",
    payload: {
      userId,
      status,
    },
  });

  if (!result.ok) {
    throw new Error(result.message || "更新 admin 審核狀態失敗");
  }

  await loadSuperAdminData();
  setStatus(`已將${adminUser.displayName}設為${status}。`, "success");
}

async function deleteAdminUser(userId) {
  const adminUser = state.adminUsers.find((item) => item.userId === userId);
  if (!adminUser) {
    throw new Error("找不到管理員資料");
  }

  const confirmed = window.confirm(
    `確定要刪除管理員「${adminUser.displayName}」嗎？\n\n此操作會移除 AdminUsers 內的管理員登入紀錄，刪除後需重新登入並重新審核才能再次使用 admin 後台。`
  );
  if (!confirmed) {
    setStatus("已取消刪除管理員。", "info");
    return;
  }

  showLoading("正在刪除管理員...", "loading");
  const result = await requestApi("POST", {}, {
    action: "deleteAdminUser",
    payload: { userId },
  });

  if (!result.ok) {
    throw new Error(result.message || "刪除管理員失敗");
  }

  await loadSuperAdminData();
  setStatus(`已刪除管理員 ${adminUser.displayName}。`, "success");
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
    const reviewButton = event.target.closest("[data-review-admin]");
    if (reviewButton) {
      reviewAdminUser(reviewButton.dataset.reviewAdmin, reviewButton.dataset.reviewStatus).catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

    const button = event.target.closest("[data-admin-permission]");
    if (button) {
      const canManageAdmins = button.dataset.canManageAdmins === "true";
      const actionLabel = canManageAdmins ? "授予" : "收回";
      updateAdminPermission(
        button.dataset.adminPermission,
        { canManageAdmins },
        {
          confirmMessage: `確定要${actionLabel}「${button.closest("tr")?.querySelector("strong")?.textContent || "此管理員"}」的管理員修改權限嗎？`,
          loadingMessage: "正在更新管理員修改權限...",
          successMessage: `已${actionLabel}${button.closest("tr")?.querySelector("strong")?.textContent || "該管理員"}的管理員修改權限。`,
        }
      ).catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

    const deleteButton = event.target.closest("[data-delete-admin]");
    if (deleteButton) {
      deleteAdminUser(deleteButton.dataset.deleteAdmin).catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

    const savePageButton = event.target.closest("[data-save-page-permissions]");
    if (!savePageButton) {
      return;
    }

    const row = savePageButton.closest("tr");
    if (!row) {
      setStatus("找不到管理員列資料。", "error");
      return;
    }

    updateAdminPermission(
      savePageButton.dataset.savePagePermissions,
      { pagePermissions: getRowPagePermissions(row) },
      {
        confirmMessage: `確定要更新「${row.querySelector("strong")?.textContent || "此管理員"}」的頁面權限嗎？`,
        loadingMessage: "正在更新頁面權限...",
        successMessage: `已更新${row.querySelector("strong")?.textContent || "該管理員"}的頁面權限。`,
      }
    ).catch((error) => {
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