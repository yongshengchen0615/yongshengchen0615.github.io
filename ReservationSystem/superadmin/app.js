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
  liffLoginRequired: true,
  profile: null,
  adminUser: null,
  adminUsers: [],
  superAdmins: [],
  lastSyncText: "",
  ui: {
    busyCount: 0,
    configError: "",
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function sanitizeTone(value, fallback = "pending") {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z-]+$/.test(normalized) ? normalized : fallback;
}

function sanitizeImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch (error) {
    return "";
  }
}

function getDisplayText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function parseJsonResponse(response, fallbackMessage) {
  const rawText = await response.text();
  let data = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`${fallbackMessage}：伺服器回傳的資料格式無法解析。`);
    }
  }

  if (!response.ok) {
    const message = typeof data?.message === "string" && data.message.trim() ? data.message.trim() : `${fallbackMessage}（HTTP ${response.status}）`;
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error(`${fallbackMessage}：伺服器未回傳有效資料。`);
  }

  return data;
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
    const config = await parseJsonResponse(response, "讀取設定檔失敗");
    state.configGasUrl = normalizeGasUrl(config.gasWebAppUrl || config.gasUrl);
    state.liffId = normalizeLiffId(config.liffId);
    state.liffLoginRequired = config.liffLoginRequired !== false;
    state.gasUrl = state.configGasUrl;
    state.ui.configError = "";
  } catch (error) {
    state.configGasUrl = "";
    state.gasUrl = "";
    state.liffId = "";
    state.liffLoginRequired = true;
    state.ui.configError = getErrorMessage(error, "讀取設定檔失敗");
  }
}

async function ensureLiffSession() {
  if (!state.liffLoginRequired) {
    state.profile = {
      userId: "TEST_SUPERADMIN_USER",
      displayName: "測試最高管理員",
      pictureUrl: "",
    };
    renderAccessState();
    return true;
  }

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
      return parseJsonResponse(response, "讀取資料失敗");
    }

    const response = await fetch(state.gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({ ...body, adminUserId }),
    });
    return parseJsonResponse(response, "送出資料失敗");
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
  return `<span class="status-pill status-pill--${sanitizeTone(tone, "pending")}">${escapeHtml(label)}</span>`;
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
    <div class="admin-permission-editor vstack gap-3">
      ${getPermissionPill(adminUser)}
      <p class="helper-text">${helperText}</p>
      <button type="button" class="${buttonClass}" data-admin-permission="${escapeAttribute(adminUser.userId)}" data-can-manage-admins="${String(!canManageAdmins)}">${buttonLabel}</button>
    </div>
  `;
}

function renderPagePermissionEditor(adminUser) {
  const permissions = Array.isArray(adminUser.pagePermissions) ? adminUser.pagePermissions : [];
  const checkboxes = ADMIN_PAGE_OPTIONS.map((option) => {
    const checked = permissions.includes(option.key) ? "checked" : "";
    return `
      <div class="col">
        <label class="permission-checkbox h-100">
          <input type="checkbox" data-page-permission-checkbox value="${option.key}" ${checked} />
          <span>${option.label}</span>
        </label>
      </div>
    `;
  }).join("");

  return `
    <div class="permission-editor vstack gap-3">
      <div class="editor-summary">
        <strong>${getPagePermissionSummary(adminUser)}</strong>
        <span class="helper-text">可直接勾選要顯示在 admin 後台的功能頁。</span>
      </div>
      <div class="permission-checkbox-grid row row-cols-1 row-cols-md-2 g-2">${checkboxes}</div>
      <div class="permission-editor__footer d-flex flex-column flex-xl-row align-items-xl-center justify-content-between gap-3">
        <span class="helper-text">未勾選的頁面在 admin 後台不會顯示，也無法執行對應操作。</span>
        <button type="button" class="button button--primary" data-save-page-permissions="${escapeAttribute(adminUser.userId)}">儲存頁面權限</button>
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

function getAdminViewModel(adminUser) {
  const isCurrentUser = adminUser.userId === getCurrentAdminUserId();
  const displayName = escapeHtml(getDisplayText(adminUser.displayName, "未命名管理員"));
  const userId = escapeHtml(getDisplayText(adminUser.userId, "無 userId"));
  const userIdAttribute = escapeAttribute(adminUser.userId);
  const note = getDisplayText(adminUser.note);
  const safePictureUrl = sanitizeImageUrl(adminUser.pictureUrl);
  const avatarAlt = escapeAttribute(getDisplayText(adminUser.displayName, "管理員頭像"));
  const avatarFallback = escapeHtml(getDisplayText(adminUser.displayName, "A").slice(0, 1).toUpperCase());
  const identityPills = [getAdminStatusPill(adminUser.status)];

  if (adminUser.isSuperAdmin) {
    identityPills.push(getStatusPill("最高管理員", "super"));
  }

  if (isCurrentUser) {
    identityPills.push(getStatusPill("目前登入", "permission"));
  }

  return {
    isCurrentUser,
    displayName,
    userId,
    userIdAttribute,
    note,
    safePictureUrl,
    avatarAlt,
    avatarFallback,
    identityPills,
  };
}

function getReviewButtonsMarkup(userIdAttribute) {
  return `
    <button type="button" class="button button--secondary button--compact" data-review-admin="${userIdAttribute}" data-review-status="待審核">待審核</button>
    <button type="button" class="button button--primary button--compact" data-review-admin="${userIdAttribute}" data-review-status="已通過">通過</button>
    <button type="button" class="button button--secondary button--compact" data-review-admin="${userIdAttribute}" data-review-status="已拒絕">拒絕</button>
    <button type="button" class="button button--danger button--compact" data-review-admin="${userIdAttribute}" data-review-status="已停用">停用</button>
  `;
}

function renderAdminManagementCard(adminUser, viewModel, statusButtons, deleteButton) {
  return `
    <article class="admin-management-card" data-admin-card="${viewModel.userIdAttribute}">
      <header class="admin-management-card__header">
        <div class="admin-management-card__identity">
          <div class="user-cell">
            ${viewModel.safePictureUrl ? `<img class="user-avatar" src="${escapeAttribute(viewModel.safePictureUrl)}" alt="${viewModel.avatarAlt}" />` : `<span class="user-avatar user-avatar--placeholder">${viewModel.avatarFallback}</span>`}
            <div class="user-cell__meta">
              <strong data-admin-name>${viewModel.displayName}</strong>
              <small>${viewModel.userId}</small>
              <div class="status-pill-group">${viewModel.identityPills.join("")}</div>
            </div>
          </div>
        </div>
        <div class="admin-management-card__summary">
          <div class="admin-summary-block">
            <span class="admin-summary-block__label">管理狀態</span>
            <div class="status-pill-group">${getPermissionPill(adminUser)}</div>
          </div>
          <div class="admin-summary-block">
            <span class="admin-summary-block__label">頁面權限</span>
            <strong>${getPagePermissionSummary(adminUser)}</strong>
          </div>
          <div class="admin-summary-block">
            <span class="admin-summary-block__label">最後登入</span>
            <strong>${formatDateTimeText(adminUser.lastLoginAt)}</strong>
          </div>
        </div>
      </header>

      <div class="admin-management-card__grid">
        <section class="admin-work-panel admin-work-panel--permission">
          <span class="admin-work-panel__label">管理員修改權限設定</span>
          ${renderAdminManagePermissionEditor(adminUser)}
        </section>

        <section class="admin-work-panel admin-work-panel--pages">
          <span class="admin-work-panel__label">頁面權限</span>
          <div class="status-pill-group">${getPagePermissionPills(adminUser)}</div>
          <p class="helper-text helper-text--compact">${getPagePermissionSummary(adminUser)}</p>
        </section>

        <section class="admin-work-panel admin-work-panel--meta">
          <span class="admin-work-panel__label">備註</span>
          <div class="table-note">${viewModel.note ? escapeHtml(viewModel.note) : '<span class="helper-text">尚無備註</span>'}</div>
        </section>

        <section class="admin-work-panel admin-work-panel--editor admin-work-panel--wide">
          <span class="admin-work-panel__label">頁面權限設定</span>
          ${renderPagePermissionEditor(adminUser)}
        </section>

        <section class="admin-work-panel admin-work-panel--actions admin-work-panel--wide">
          <span class="admin-work-panel__label">操作</span>
          <div class="admin-actions-grid">
            <div class="action-group action-group--panel">
              <span class="action-group__label">審核狀態</span>
              <div class="table-actions table-actions--grid">${statusButtons}</div>
            </div>
            <div class="action-group action-group--panel">
              <span class="action-group__label">帳號操作</span>
              <div class="table-actions">${deleteButton}</div>
            </div>
          </div>
        </section>
      </div>
    </article>
  `;
}

function getAdminCardName(sourceElement) {
  return sourceElement.closest("[data-admin-card]")?.querySelector("[data-admin-name]")?.textContent || "此管理員";
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

  const entries = state.adminUsers
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
      const viewModel = getAdminViewModel(adminUser);
      const statusButtons = getReviewButtonsMarkup(viewModel.userIdAttribute);
      const deleteButton = viewModel.isCurrentUser
        ? `<span class="helper-text">目前登入帳號不可刪除</span>`
        : `<button type="button" class="button button--danger button--compact" data-delete-admin="${viewModel.userIdAttribute}">刪除管理員</button>`;

      return renderAdminManagementCard(adminUser, viewModel, statusButtons, deleteButton);
    })
    ;
  const accordionItems = entries.join("");

  elements.adminPermissionTable.innerHTML = `
    <div class="responsive-data-shell">
      <div class="responsive-hint">
        <span class="responsive-hint__pill">Management Board</span>
        <span class="helper-text">改成管理工作卡版型，把狀態、權限、備註與操作拆成清楚區塊。</span>
      </div>
      <div class="admin-management-board" id="adminAccordionList">
        ${accordionItems}
      </div>
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

  if (!state.adminUser?.isSuperAdmin) {
    setStatus(state.adminUser?.note || "此 LINE 帳號不是最高管理員。", "error");
    return;
  }

  if (state.adminUser.status !== "已通過") {
    setStatus(
      state.adminUser.status === "待審核"
        ? "此 LINE 帳號尚未通過最高管理員審核。"
        : state.adminUser.note || "此 LINE 帳號目前不可使用最高管理員後台。",
      state.adminUser.status === "待審核" ? "info" : "error"
    );
    return;
  }

  await loadSuperAdminData();
}

function getRowPagePermissions(row) {
  return Array.from(row.querySelectorAll('[data-page-permission-checkbox]:checked'))
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

async function updateAdminPermission(userId, updates, options = {}) {
  const adminUser = state.adminUsers.find((item) => item.userId === userId);
  if (!adminUser) {
    throw new Error("找不到管理員資料");
  }

  const { confirmMessage, loadingMessage, successMessage } = options;
  if (confirmMessage && !window.confirm(confirmMessage)) {
    setStatus("已取消更新。", "info");
    return;
  }

  showLoading(loadingMessage || "正在更新管理員權限...", "loading");
  const payload = {
    userId,
    ...updates,
  };
  const result = await requestApi("POST", {}, {
    action: "updateAdminPermission",
    payload,
  });

  if (!result.ok) {
    throw new Error(result.message || "更新 admin 權限失敗");
  }

  await loadSuperAdminData();
  setStatus(successMessage || `已更新 ${adminUser.displayName} 的權限。`, "success");
}

async function reviewAdminUser(userId, status) {
  const adminUser = state.adminUsers.find((item) => item.userId === userId);
  if (!adminUser) {
    throw new Error("找不到管理員資料");
  }

  showLoading("正在更新管理員審核狀態...", "loading");
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
      if (state.liffLoginRequired) {
        await window.liff.init({ liffId: state.liffId });
        if (window.liff.isLoggedIn()) {
          window.liff.logout();
        }
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
          confirmMessage: `確定要${actionLabel}「${getAdminCardName(button)}」的管理員修改權限嗎？`,
          loadingMessage: "正在更新管理員修改權限...",
          successMessage: `已${actionLabel}${getAdminCardName(button) || "該管理員"}的管理員修改權限。`,
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

    const card = savePageButton.closest("[data-admin-card]");
    if (!card) {
      setStatus("找不到管理員卡片資料。", "error");
      return;
    }

    updateAdminPermission(
      savePageButton.dataset.savePagePermissions,
      { pagePermissions: getRowPagePermissions(card) },
      {
        confirmMessage: `確定要更新「${getAdminCardName(savePageButton)}」的頁面權限嗎？`,
        loadingMessage: "正在更新頁面權限...",
        successMessage: `已更新${getAdminCardName(savePageButton) || "該管理員"}的頁面權限。`,
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

  setStatus(state.ui.configError || "請檢查 superadmin/config.json 內的 gasWebAppUrl 與 liffId。", "info");
}

initializeApp();