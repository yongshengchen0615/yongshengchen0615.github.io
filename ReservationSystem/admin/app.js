const ADMIN_STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
  serviceCategories: "beauty-booking-service-categories",
};
const CONFIG_PATH = "./config.json";
const ONSITE_ASSIGNMENT_VALUE = "__ONSITE_ASSIGNMENT__";

const state = {
  gasUrl: "",
  configGasUrl: "",
  liffId: "",
  profile: null,
  adminUser: null,
  adminUsers: [],
  services: [],
  technicians: [],
  schedules: [],
  users: [],
  reservations: [],
  serviceCategoryMap: {},
  filters: {
    serviceKeyword: "",
    serviceCategory: "",
    technicianId: "",
    technicianStatus: "all",
    technicianReviewStatus: "all",
    technicianServiceCategory: "",
    reservationKeyword: "",
    reservationStatus: "all",
    reservationTechnicianId: "",
    userKeyword: "",
    userStatus: "all",
  },
  ui: {
    busyCount: 0,
    activePage: "service",
    scheduleCalendarMonth: formatLocalDate(new Date()).slice(0, 7),
    selectedScheduleDate: formatLocalDate(new Date()),
    editingScheduleKey: "",
  },
};

const elements = {
  topLoadingBar: document.querySelector("#topLoadingBar"),
  topLoadingLabel: document.querySelector("#topLoadingLabel"),
  adminContent: document.querySelector("#adminContent"),
  adminLoginButton: document.querySelector("#adminLoginButton"),
  adminRefreshIdentityButton: document.querySelector("#adminRefreshIdentityButton"),
  adminLogoutButton: document.querySelector("#adminLogoutButton"),
  adminAvatar: document.querySelector("#adminAvatar"),
  adminDisplayName: document.querySelector("#adminDisplayName"),
  adminStatusBadge: document.querySelector("#adminStatusBadge"),
  adminStatusText: document.querySelector("#adminStatusText"),
  adminApprovalGate: document.querySelector("#adminApprovalGate"),
  serviceCategorySuggestions: document.querySelector("#serviceCategorySuggestions"),
  refreshDashboardButton: document.querySelector("#refreshDashboardButton"),
  workflowSummary: document.querySelector("#workflowSummary"),
  workflowHint: document.querySelector("#workflowHint"),
  pageTabs: Array.from(document.querySelectorAll("[data-page-trigger]")),
  pagePanels: Array.from(document.querySelectorAll("[data-admin-page]")),
  serviceForm: document.querySelector("#serviceForm"),
  serviceFormMode: document.querySelector("#serviceFormMode"),
  serviceResultLabel: document.querySelector("#serviceResultLabel"),
  serviceSubmitButton: document.querySelector("#serviceSubmitButton"),
  serviceResetButton: document.querySelector("#serviceResetButton"),
  serviceSearchInput: document.querySelector("#serviceSearchInput"),
  serviceCategoryFilter: document.querySelector("#serviceCategoryFilter"),
  serviceEditPanel: document.querySelector("#serviceEditPanel"),
  serviceEditForm: document.querySelector("#serviceEditForm"),
  serviceEditMode: document.querySelector("#serviceEditMode"),
  serviceEditResetButton: document.querySelector("#serviceEditResetButton"),
  technicianResultLabel: document.querySelector("#technicianResultLabel"),
  technicianSearchSelect: document.querySelector("#technicianSearchSelect"),
  technicianStatusFilter: document.querySelector("#technicianStatusFilter"),
  technicianReviewStatusFilter: document.querySelector("#technicianReviewStatusFilter"),
  technicianReviewSummary: document.querySelector("#technicianReviewSummary"),
  technicianReviewTable: document.querySelector("#technicianReviewTable"),
  technicianBulkSelectionMeta: document.querySelector("#technicianBulkSelectionMeta"),
  technicianBulkAddRowButton: document.querySelector("#technicianBulkAddRowButton"),
  technicianBulkSaveButton: document.querySelector("#technicianBulkSaveButton"),
  technicianBulkDeleteButton: document.querySelector("#technicianBulkDeleteButton"),
  technicianBulkTable: document.querySelector("#technicianBulkTable"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleResetButton: document.querySelector("#scheduleResetButton"),
  scheduleResultLabel: document.querySelector("#scheduleResultLabel"),
  scheduleCalendarLabel: document.querySelector("#scheduleCalendarLabel"),
  scheduleCalendarGrid: document.querySelector("#scheduleCalendarGrid"),
  schedulePrevMonthButton: document.querySelector("#schedulePrevMonthButton"),
  scheduleTodayButton: document.querySelector("#scheduleTodayButton"),
  scheduleNextMonthButton: document.querySelector("#scheduleNextMonthButton"),
  scheduleSelectedDateLabel: document.querySelector("#scheduleSelectedDateLabel"),
  scheduleSelectedDateMeta: document.querySelector("#scheduleSelectedDateMeta"),
  scheduleEditTimePanel: document.querySelector("#scheduleEditTimePanel"),
  scheduleEditModeLabel: document.querySelector("#scheduleEditModeLabel"),
  scheduleSelectAllTechniciansButton: document.querySelector("#scheduleSelectAllTechniciansButton"),
  scheduleClearTechniciansButton: document.querySelector("#scheduleClearTechniciansButton"),
  scheduleTechnicianSelectionMeta: document.querySelector("#scheduleTechnicianSelectionMeta"),
  reservationForm: document.querySelector("#reservationForm"),
  reservationFormMode: document.querySelector("#reservationFormMode"),
  reservationResultLabel: document.querySelector("#reservationResultLabel"),
  reservationSubmitButton: document.querySelector("#reservationSubmitButton"),
  reservationResetButton: document.querySelector("#reservationResetButton"),
  reservationEditorHint: document.querySelector("#reservationEditorHint"),
  reservationSearchInput: document.querySelector("#reservationSearchInput"),
  reservationStatusFilter: document.querySelector("#reservationStatusFilter"),
  reservationTechnicianFilter: document.querySelector("#reservationTechnicianFilter"),
  userSearchInput: document.querySelector("#userSearchInput"),
  userStatusFilter: document.querySelector("#userStatusFilter"),
  userResultLabel: document.querySelector("#userResultLabel"),
  userReviewSummary: document.querySelector("#userReviewSummary"),
  serviceTable: document.querySelector("#serviceTable"),
  scheduleTable: document.querySelector("#scheduleTable"),
  reservationTable: document.querySelector("#reservationTable"),
  userTable: document.querySelector("#userTable"),
  scheduleTechnicianCheckboxes: document.querySelector("#scheduleTechnicianCheckboxes"),
  reservationTechnicianSelect: document.querySelector("#reservationTechnicianSelect"),
  reservationServiceSelect: document.querySelector("#reservationServiceSelect"),
  technicianStat: document.querySelector("#technicianStat"),
  technicianMeta: document.querySelector("#technicianMeta"),
  serviceStat: document.querySelector("#serviceStat"),
  serviceMeta: document.querySelector("#serviceMeta"),
  scheduleStat: document.querySelector("#scheduleStat"),
  scheduleMeta: document.querySelector("#scheduleMeta"),
  reservationStat: document.querySelector("#reservationStat"),
  reservationMeta: document.querySelector("#reservationMeta"),
  lastSyncLabel: document.querySelector("#lastSyncLabel"),
};

function normalizeGasUrl(value) {
  return String(value || "").trim();
}

function normalizeLiffId(value) {
  return String(value || "").trim();
}

function normalizeCategory(value) {
  return String(value || "").trim() || "未分類";
}

function loadServiceCategoryMap() {
  try {
    const rawValue = localStorage.getItem(ADMIN_STORAGE_KEYS.serviceCategories);
    const parsed = rawValue ? JSON.parse(rawValue) : {};
    state.serviceCategoryMap = parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    state.serviceCategoryMap = {};
  }
}

function persistServiceCategoryMap() {
  localStorage.setItem(ADMIN_STORAGE_KEYS.serviceCategories, JSON.stringify(state.serviceCategoryMap));
}

function getServiceCategory(service) {
  if (!service) {
    return "未分類";
  }

  return normalizeCategory(state.serviceCategoryMap[service.serviceId] || service.category);
}

function assignServiceCategory(serviceId, category) {
  if (!serviceId) {
    return;
  }

  state.serviceCategoryMap[serviceId] = normalizeCategory(category);
  persistServiceCategoryMap();
}

function removeServiceCategory(serviceId) {
  if (!serviceId || !Object.prototype.hasOwnProperty.call(state.serviceCategoryMap, serviceId)) {
    return;
  }

  delete state.serviceCategoryMap[serviceId];
  persistServiceCategoryMap();
}

function getServiceCategoryOptions() {
  return Array.from(new Set(state.services.map((service) => getServiceCategory(service)))).sort((left, right) =>
    left.localeCompare(right, "zh-Hant")
  );
}

function refreshCategorySelectOptions(select, placeholder, selectedValue = "") {
  if (!select) {
    return;
  }

  setOptions(
    select,
    getServiceCategoryOptions().map((category) => ({ value: category, label: category })),
    placeholder
  );

  const normalizedValue = normalizeCategory(selectedValue);
  if (selectedValue && getServiceCategoryOptions().includes(normalizedValue)) {
    select.value = normalizedValue;
  }
}

function refreshServiceCategorySuggestions() {
  const categories = getServiceCategoryOptions();
  if (!elements.serviceCategorySuggestions) {
    return;
  }

  elements.serviceCategorySuggestions.innerHTML = categories
    .map((category) => `<option value="${category}"></option>`)
    .join("");
}

function syncSavedServiceCategory(payload) {
  if (!payload) {
    return;
  }

  if (payload.serviceId) {
    assignServiceCategory(payload.serviceId, payload.category);
    return;
  }

  const matchedService = state.services.find((service) => {
    return service.name === payload.name
      && Number(service.durationMinutes) === Number(payload.durationMinutes)
      && Number(service.price) === Number(payload.price);
  });

  if (matchedService) {
    assignServiceCategory(matchedService.serviceId, payload.category);
    matchedService.category = normalizeCategory(payload.category);
  }
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
  } catch (error) {
    state.configGasUrl = "";
    state.liffId = "";
  }
}

function applyGasUrlPreference() {
  const savedGasUrl = normalizeGasUrl(localStorage.getItem(ADMIN_STORAGE_KEYS.gasUrl));
  if (state.configGasUrl) {
    state.gasUrl = state.configGasUrl;
    localStorage.setItem(ADMIN_STORAGE_KEYS.gasUrl, state.gasUrl);
  } else {
    state.gasUrl = savedGasUrl;
  }
}

function isApprovedAdmin() {
  return state.adminUser?.status === "已通過";
}

function getCurrentAdminUserId() {
  return String(state.profile?.userId || state.adminUser?.userId || "").trim();
}

function setAdminContentAccess(canAccess) {
  if (elements.adminContent) {
    elements.adminContent.classList.toggle("is-hidden", !canAccess);
  }

  document.body.classList.toggle("is-locked", !canAccess);
}

function setAdminApprovalMessage(message, tone = "info") {
  if (!elements.adminApprovalGate) {
    return;
  }

  elements.adminApprovalGate.textContent = message;
  elements.adminApprovalGate.dataset.tone = tone;
}

function renderAdminAccessState() {
  if (!elements.adminDisplayName || !elements.adminStatusBadge || !elements.adminStatusText) {
    return;
  }

  const normalizedStatus = String(state.adminUser?.status || "").trim();
  const isApprovedSuperAdmin = Boolean(state.adminUser?.isSuperAdmin) && normalizedStatus === "已通過";

  if (!state.profile) {
    elements.adminDisplayName.textContent = "尚未登入 LINE";
    elements.adminStatusBadge.textContent = "未登入";
    elements.adminStatusBadge.dataset.tone = "muted";
    elements.adminStatusText.textContent = "管理員後台需使用 LINE LIFF 登入，並由既有管理員審核通過後才可使用。";
    setAdminApprovalMessage("需先完成 LINE 登入並通過管理員審核，才可使用後台。", "info");
    elements.adminLoginButton.textContent = "LINE 登入";
    elements.adminLogoutButton.disabled = true;
    if (elements.adminAvatar) {
      elements.adminAvatar.classList.add("is-hidden");
    }
    setAdminContentAccess(false);
    return;
  }

  elements.adminDisplayName.textContent = state.profile.displayName || "LINE 管理員";
  elements.adminLoginButton.textContent = "切換 LINE 帳號";
  elements.adminLogoutButton.disabled = false;

  if (state.profile.pictureUrl && elements.adminAvatar) {
    elements.adminAvatar.src = state.profile.pictureUrl;
    elements.adminAvatar.classList.remove("is-hidden");
  } else if (elements.adminAvatar) {
    elements.adminAvatar.classList.add("is-hidden");
  }

  if (!state.adminUser) {
    elements.adminStatusBadge.textContent = "同步中";
    elements.adminStatusBadge.dataset.tone = "pending";
    elements.adminStatusText.textContent = "正在同步你的管理員資料與審核狀態。";
    setAdminApprovalMessage("正在確認管理員存取權限...", "pending");
    setAdminContentAccess(false);
    return;
  }

  if (isApprovedSuperAdmin) {
    elements.adminStatusBadge.textContent = "最高管理員";
    elements.adminStatusBadge.dataset.tone = "approved";
    elements.adminStatusText.textContent = "你已通過 admin 審核，並保有最高管理員身分，可使用 admin 後台。";
    setAdminApprovalMessage("已通過 AdminUsers 審核，可使用 admin 後台。", "approved");
    setAdminContentAccess(true);
    return;
  }

  elements.adminStatusBadge.textContent = state.adminUser.status;

  if (state.adminUser.status === "已通過") {
    elements.adminStatusBadge.dataset.tone = "approved";
    elements.adminStatusText.textContent = "你已通過管理員審核，可使用後台管理功能。";
    setAdminApprovalMessage("已通過管理員審核，後台資料載入後即可使用。", "approved");
    setAdminContentAccess(true);
    return;
  }

  if (state.adminUser.status === "待審核") {
    elements.adminStatusBadge.dataset.tone = "pending";
    elements.adminStatusText.textContent = state.adminUser.isSuperAdmin
      ? "你已完成 LINE 登入，也具有最高管理員身分，但仍需等待 AdminUsers 的 admin 審核通過。"
      : "你已完成 LINE 登入，但仍需等待既有管理員審核通過。";
    setAdminApprovalMessage(
      state.adminUser.isSuperAdmin
        ? "此帳號雖已在 SuperAdmins 中，但仍需通過 AdminUsers 審核後才能使用 admin 後台。"
        : "目前為待審核狀態，需由已通過的管理員審核後才能使用後台。",
      "pending"
    );
    setAdminContentAccess(false);
    return;
  }

  elements.adminStatusBadge.dataset.tone = "blocked";
  elements.adminStatusText.textContent = state.adminUser.note || "此 LINE 帳號目前不可使用管理後台。";
  setAdminApprovalMessage(state.adminUser.note || "此管理員帳號目前不可使用後台，請聯絡既有管理員。", "blocked");
  setAdminContentAccess(false);
}

async function ensureLiffSession() {
  if (!state.liffId) {
    throw new Error("請先在 admin/config.json 設定 liffId。");
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
  renderAdminAccessState();
  return true;
}

async function syncAdminUser() {
  if (!state.profile) {
    return null;
  }

  const result = await requestApi("POST", {}, {
    action: "syncAdminUser",
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
  renderAdminAccessState();
  return result.data;
}

async function refreshAdminIdentity(options = {}) {
  const { loadData = true } = options;

  setLoadingStatus("正在確認管理員 LINE 身分...");
  state.adminUser = null;
  renderAdminAccessState();

  const isLoggedIn = await ensureLiffSession();
  if (!isLoggedIn) {
    return false;
  }

  await syncAdminUser();

  if (isApprovedAdmin()) {
    if (loadData) {
      await loadAdminData();
    } else {
      setStatus("管理員身分已更新。", "success");
    }
    return true;
  }

  setStatus(
    state.adminUser?.status === "待審核"
      ? state.adminUser?.isSuperAdmin
        ? "此帳號仍待 AdminUsers 審核，通過前無法使用 admin 後台。"
        : "管理員帳號尚待審核，通過前無法使用後台。"
      : state.adminUser?.note || "此管理員帳號目前不可使用後台。",
    state.adminUser?.status === "待審核" ? "info" : "error"
  );
  return false;
}

function setStatus(message, type = "info") {
  const nextType = type || "info";
  const isLoading = nextType === "loading";

  window.clearTimeout(setStatus.timerId);

  if (elements.topLoadingBar && elements.topLoadingLabel) {
    elements.topLoadingLabel.textContent = message || "處理中...";
    elements.topLoadingBar.dataset.type = nextType;
    elements.topLoadingBar.classList.toggle("is-hidden", !message);
    elements.topLoadingBar.setAttribute("aria-busy", String(isLoading));
  }

  if (!message) {
    return;
  }

  const hideDelay = isLoading ? 4000 : nextType === "error" ? 4800 : 2600;
  setStatus.timerId = window.setTimeout(() => {
    if (!elements.topLoadingBar) {
      return;
    }

    elements.topLoadingBar.classList.add("is-hidden");
    elements.topLoadingBar.setAttribute("aria-busy", "false");
  }, hideDelay);
}

function setLoadingStatus(message) {
  setStatus(message, "loading");
}

function startBusyState() {
  state.ui.busyCount += 1;
  document.body.classList.add("is-busy");
  if (elements.refreshDashboardButton) {
    elements.refreshDashboardButton.disabled = true;
  }
}

function endBusyState() {
  state.ui.busyCount = Math.max(0, state.ui.busyCount - 1);
  if (state.ui.busyCount === 0) {
    document.body.classList.remove("is-busy");
    if (elements.refreshDashboardButton) {
      elements.refreshDashboardButton.disabled = false;
    }
  }
}

function scrollToPanel(panel) {
  if (!panel) {
    return;
  }

  const panelPage = panel.closest("[data-admin-page]");
  if (panelPage) {
    setActivePage(panelPage.dataset.adminPage);
  }

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.classList.remove("is-flash");
  window.requestAnimationFrame(() => {
    panel.classList.add("is-flash");
    window.setTimeout(() => panel.classList.remove("is-flash"), 900);
  });
}

function setActivePage(pageName) {
  if (!pageName) {
    return;
  }

  state.ui.activePage = pageName;

  elements.pageTabs.forEach((button) => {
    const isActive = button.dataset.pageTrigger === pageName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  elements.pagePanels.forEach((panel) => {
    const isActive = panel.dataset.adminPage === pageName;
    panel.classList.toggle("is-hidden", !isActive);
    panel.classList.toggle("is-active", isActive);
  });
}

function setOptions(select, options, placeholder) {
  select.innerHTML = "";
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    select.appendChild(item);
  });
}

function matchesKeyword(value, keyword) {
  return String(value || "").toLowerCase().includes(String(keyword || "").trim().toLowerCase());
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  if (!value) {
    return null;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey).split("-");
  return `${year} 年 ${month} 月`;
}

function getMonthBoundary(monthKey) {
  const [yearText, monthText] = String(monthKey).split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  return {
    firstDay: new Date(year, monthIndex, 1),
    lastDay: new Date(year, monthIndex + 1, 0),
  };
}

function shiftMonth(monthKey, offset) {
  const { firstDay } = getMonthBoundary(monthKey);
  const shifted = new Date(firstDay.getFullYear(), firstDay.getMonth() + offset, 1);
  return formatLocalDate(shifted).slice(0, 7);
}

function getSchedulesForDate(dateText) {
  return state.schedules
    .filter((item) => item.date === dateText)
    .slice()
    .sort((left, right) => {
      const leftTechnician = getTechnicianById(left.technicianId)?.name || left.technicianId;
      const rightTechnician = getTechnicianById(right.technicianId)?.name || right.technicianId;
      return `${leftTechnician}-${left.startTime}`.localeCompare(`${rightTechnician}-${right.startTime}`, "zh-Hant");
    });
}

function toMinutes(timeText) {
  const [hours, minutes] = String(timeText).split(":").map(Number);
  return hours * 60 + minutes;
}

function isOvernightShift(startTime, endTime) {
  const start = toMinutes(startTime);
  let end = endTime === "23:59" ? 24 * 60 : toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return end > 24 * 60;
}

function addDaysToDate(dateText, offsetDays) {
  const baseDate = new Date(`${dateText}T00:00:00`);
  baseDate.setDate(baseDate.getDate() + Number(offsetDays || 0));
  return formatLocalDate(baseDate);
}

function getSchedulesCoveringDate(dateText) {
  const prevDate = addDaysToDate(dateText, -1);
  return state.schedules
    .filter((item) => {
      if (item.date === dateText) return true;
      if (item.date === prevDate && item.isWorking && isOvernightShift(item.startTime, item.endTime)) return true;
      return false;
    })
    .slice()
    .sort((left, right) => {
      const leftTechnician = getTechnicianById(left.technicianId)?.name || left.technicianId;
      const rightTechnician = getTechnicianById(right.technicianId)?.name || right.technicianId;
      return `${leftTechnician}-${left.startTime}`.localeCompare(`${rightTechnician}-${right.startTime}`, "zh-Hant");
    });
}

function isOvernightShift(startTime, endTime) {
  const start = toMinutes(startTime);
  let end = endTime === "23:59" ? 24 * 60 : toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return end > 24 * 60;
}

function addDaysToDate(dateText, offsetDays) {
  const baseDate = new Date(`${dateText}T00:00:00`);
  baseDate.setDate(baseDate.getDate() + Number(offsetDays || 0));
  return formatLocalDate(baseDate);
}

function getSchedulesCoveringDate(dateText) {
  const prevDate = addDaysToDate(dateText, -1);
  return state.schedules
    .filter((item) => {
      if (item.date === dateText) return true;
      if (item.date === prevDate && item.isWorking && isOvernightShift(item.startTime, item.endTime)) return true;
      return false;
    })
    .slice()
    .sort((left, right) => {
      const leftTechnician = getTechnicianById(left.technicianId)?.name || left.technicianId;
      const rightTechnician = getTechnicianById(right.technicianId)?.name || right.technicianId;
      return `${leftTechnician}-${left.startTime}`.localeCompare(`${rightTechnician}-${right.startTime}`, "zh-Hant");
    });
}

function updateSelectedScheduleDate(dateText) {
  if (!dateText) {
    return;
  }

  state.ui.selectedScheduleDate = dateText;
  state.ui.scheduleCalendarMonth = dateText.slice(0, 7);
}

function resetScheduleForm() {
  const selectedDate = state.ui.selectedScheduleDate || formatLocalDate(new Date());

  elements.scheduleForm.reset();
  elements.scheduleForm.date.value = selectedDate;
  elements.scheduleForm.endDate.value = selectedDate;
  elements.scheduleForm.isWorking.checked = true;
  elements.scheduleForm.startTime.value = "09:00";
  elements.scheduleForm.endTime.value = "18:00";
  state.ui.editingScheduleKey = "";
  elements.scheduleEditTimePanel.classList.add("is-hidden");
  elements.scheduleEditModeLabel.textContent = "編輯這筆班表的臨時上下班時間";
  syncScheduleTechnicianSelection([]);
}

function fillScheduleForm(schedule) {
  if (!schedule) {
    resetScheduleForm();
    return;
  }

  elements.scheduleForm.date.value = schedule.date;
  elements.scheduleForm.endDate.value = schedule.date;
  elements.scheduleForm.startTime.value = schedule.startTime;
  elements.scheduleForm.endTime.value = schedule.endTime;
  elements.scheduleForm.isWorking.checked = Boolean(schedule.isWorking);
  state.ui.editingScheduleKey = `${schedule.date}::${schedule.technicianId}`;
  elements.scheduleEditTimePanel.classList.remove("is-hidden");
  elements.scheduleEditModeLabel.textContent = `正在編輯 ${getTechnicianById(schedule.technicianId)?.name || schedule.technicianId} 的班表時段`;
  syncScheduleTechnicianSelection([schedule.technicianId]);
  updateSelectedScheduleDate(schedule.date);
  scrollToPanel(elements.scheduleForm);
}

function getFilteredServices() {
  return state.services.filter((item) => {
    const matchesName = !state.filters.serviceKeyword || matchesKeyword(item.name, state.filters.serviceKeyword);
    const matchesCategory = !state.filters.serviceCategory || getServiceCategory(item) === state.filters.serviceCategory;
    return matchesName && matchesCategory;
  });
}

function getFilteredTechnicians() {
  return state.technicians.filter((item) => {
    const matchesTechnician = !state.filters.technicianId || item.technicianId === state.filters.technicianId;
    const matchesStatus = state.filters.technicianStatus === "all"
      || (state.filters.technicianStatus === "active" && item.active)
      || (state.filters.technicianStatus === "inactive" && !item.active);

    return matchesTechnician && matchesStatus;
  });
}

function getFilteredTechnicianAccounts() {
  return state.technicians.filter((item) => {
    const matchesTechnician = !state.filters.technicianId || item.technicianId === state.filters.technicianId;
    const matchesActive = state.filters.technicianStatus === "all"
      || (state.filters.technicianStatus === "active" && item.active)
      || (state.filters.technicianStatus === "inactive" && !item.active);
    const matchesReviewStatus = state.filters.technicianReviewStatus === "all"
      || item.status === state.filters.technicianReviewStatus;

    return matchesTechnician && matchesActive && matchesReviewStatus;
  });
}

function getFilteredReservations() {
  return state.reservations.filter((item) => {
    const text = `${item.customerName} ${item.phone} ${item.technicianName || ""} ${item.serviceName || ""}`;
    const matchesText = !state.filters.reservationKeyword || matchesKeyword(text, state.filters.reservationKeyword);
    const matchesStatus = state.filters.reservationStatus === "all" || item.status === state.filters.reservationStatus;
    const matchesTechnician = !state.filters.reservationTechnicianId || item.technicianId === state.filters.reservationTechnicianId;

    return matchesText && matchesStatus && matchesTechnician;
  });
}

function getFilteredUsers() {
  return state.users.filter((item) => {
    const text = `${item.displayName} ${item.customerName || ""} ${item.phone || ""} ${item.userId} ${item.note || ""}`;
    const matchesText = !state.filters.userKeyword || matchesKeyword(text, state.filters.userKeyword);
    const matchesStatus = state.filters.userStatus === "all" || item.status === state.filters.userStatus;
    return matchesText && matchesStatus;
  });
}

function enumerateDateRange(startDate, endDate) {
  const result = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error("日期區間不正確");
  }

  let cursor = new Date(start);
  while (cursor <= end) {
    result.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (result.length > 31) {
      throw new Error("單次最多可套用 31 天班表");
    }
  }

  return result;
}

function getServiceById(serviceId) {
  return state.services.find((item) => item.serviceId === serviceId);
}

function getTechnicianById(technicianId) {
  return state.technicians.find((item) => item.technicianId === technicianId);
}

function getReservationTechnicianLabel(reservation) {
  if (!reservation) {
    return "現場安排";
  }

  if (reservation.assignmentType === "現場安排") {
    return "現場安排";
  }

  return reservation.technicianName || getTechnicianById(reservation.technicianId)?.name || reservation.technicianId || "現場安排";
}

function isOnsiteAssignmentSelected(value) {
  return String(value || "") === ONSITE_ASSIGNMENT_VALUE;
}

function getReservationTechnicianOptions() {
  return [
    { value: ONSITE_ASSIGNMENT_VALUE, label: "現場安排" },
    ...state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
  ];
}

function getReservationAssignedTechnicianId() {
  return String(elements.reservationForm.dataset.assignedTechnicianId || "").trim();
}

function setReservationAssignedTechnicianId(technicianId) {
  elements.reservationForm.dataset.assignedTechnicianId = String(technicianId || "").trim();
}

function getReservationSubmissionTechnician() {
  const selectedValue = elements.reservationTechnicianSelect.value;
  if (isOnsiteAssignmentSelected(selectedValue)) {
    return {
      technicianId: getReservationAssignedTechnicianId(),
      assignmentType: "現場安排",
    };
  }

  return {
    technicianId: selectedValue,
    assignmentType: "",
  };
}

function getReservationServiceFilterTechnicianId() {
  const selectedValue = elements.reservationTechnicianSelect.value;
  if (isOnsiteAssignmentSelected(selectedValue)) {
    return getReservationAssignedTechnicianId();
  }

  return selectedValue;
}

function isEditingService() {
  return Boolean(elements.serviceForm.serviceId.value);
}

function isEditingReservation() {
  return Boolean(elements.reservationForm.reservationId.value);
}

function updateServiceFormMode() {
  elements.serviceFormMode.textContent = "新增模式";
  elements.serviceSubmitButton.textContent = "新增服務";
  elements.serviceResetButton.textContent = "清空表單";
}

function updateReservationFormMode() {
  const editing = isEditingReservation();
  elements.reservationFormMode.textContent = "編輯模式";
  elements.reservationSubmitButton.textContent = "更新預約";
  elements.reservationResetButton.textContent = "取消編輯";

  elements.reservationForm.classList.toggle("is-hidden", !editing);
  elements.reservationFormMode.classList.toggle("is-hidden", !editing);
  elements.reservationEditorHint.classList.toggle("is-hidden", editing);
}

function resetServiceForm() {
  elements.serviceForm.reset();
  elements.serviceForm.serviceId.value = "";
  elements.serviceForm.category.value = "";
  elements.serviceForm.active.checked = true;
  updateServiceFormMode();
}

function isEditingServiceInline() {
  return Boolean(elements.serviceEditForm.serviceId.value);
}

function resetServiceEditForm() {
  elements.serviceEditForm.reset();
  elements.serviceEditForm.serviceId.value = "";
  elements.serviceEditForm.category.value = "";
  elements.serviceEditForm.active.checked = true;
  elements.serviceEditPanel.classList.add("is-hidden");
  elements.serviceEditMode.classList.add("is-hidden");
}

function getSelectedServiceIdsFromContainer(container) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll('input[name="serviceIds"]:checked')).map((input) => input.value);
}

function getSelectedScheduleTechnicianIds() {
  if (!elements.scheduleTechnicianCheckboxes) {
    return [];
  }

  return Array.from(elements.scheduleTechnicianCheckboxes.querySelectorAll('input[name="scheduleTechnicianIds"]:checked')).map(
    (input) => input.value
  );
}

function updateScheduleTechnicianSelectionMeta() {
  if (!elements.scheduleTechnicianSelectionMeta) {
    return;
  }

  const activeTechnicians = state.technicians.filter((item) => item.active);
  const selectedCount = getSelectedScheduleTechnicianIds().length;

  if (!activeTechnicians.length) {
    elements.scheduleTechnicianSelectionMeta.textContent = "目前沒有啟用中的技師可排班";
    return;
  }

  if (!selectedCount) {
    elements.scheduleTechnicianSelectionMeta.textContent = `尚未選擇技師，共 ${activeTechnicians.length} 位可排班`;
    return;
  }

  elements.scheduleTechnicianSelectionMeta.textContent = `已選擇 ${selectedCount} 位技師，共 ${activeTechnicians.length} 位可排班`;
}

function renderScheduleTechnicianCheckboxes(selectedIds = []) {
  if (!elements.scheduleTechnicianCheckboxes) {
    return;
  }

  const checked = new Set(selectedIds || []);
  const activeTechnicians = state.technicians.filter((item) => item.active);

  if (!activeTechnicians.length) {
    elements.scheduleTechnicianCheckboxes.innerHTML = '<div class="empty-state">目前沒有啟用中的技師，請先到技師管理啟用。</div>';
    updateScheduleTechnicianSelectionMeta();
    return;
  }

  elements.scheduleTechnicianCheckboxes.innerHTML = activeTechnicians
    .map(
      (technician) => `
        <label class="checkbox-pill">
          <input type="checkbox" name="scheduleTechnicianIds" value="${technician.technicianId}" ${
            checked.has(technician.technicianId) ? "checked" : ""
          } />
          <span>${technician.name}</span>
        </label>
      `
    )
    .join("");

  updateScheduleTechnicianSelectionMeta();
}

function syncScheduleTechnicianSelection(selectedIds = []) {
  renderScheduleTechnicianCheckboxes(selectedIds);
}

function setScheduleTechnicianSelection(checkedState) {
  if (!elements.scheduleTechnicianCheckboxes) {
    return 0;
  }

  const checkboxes = Array.from(elements.scheduleTechnicianCheckboxes.querySelectorAll('input[name="scheduleTechnicianIds"]'));
  checkboxes.forEach((input) => {
    input.checked = checkedState;
  });
  updateScheduleTechnicianSelectionMeta();
  return checkboxes.length;
}

function getServicesByCategoryFilter(categoryFilter = "") {
  return categoryFilter
    ? state.services.filter((service) => getServiceCategory(service) === categoryFilter)
    : state.services;
}

function renderServiceSelectionCheckboxes(container, selectedIds = [], categoryFilter = "") {
  if (!container) {
    return;
  }

  const checked = new Set(selectedIds || []);
  if (!state.services.length) {
    container.innerHTML = '<div class="empty-state">請先建立服務項目。</div>';
    return;
  }

  const visibleServices = getServicesByCategoryFilter(categoryFilter);
  if (!visibleServices.length) {
    container.innerHTML = '<div class="empty-state">目前分類沒有可選服務。</div>';
    return;
  }

  const groupedServices = visibleServices.reduce((result, service) => {
    const category = getServiceCategory(service);
    if (!result[category]) {
      result[category] = [];
    }
    result[category].push(service);
    return result;
  }, {});

  container.innerHTML = Object.entries(groupedServices)
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hant"))
    .map(
      ([category, services]) => `
        <section class="service-category-group">
          <div class="section-header section-header--tight">
            <h4 class="service-category-title">${category}</h4>
            <span class="service-category-meta">${services.length} 項</span>
          </div>
          <div class="service-category-grid">
            ${services
              .map(
                (service) => `
                  <label class="checkbox-pill">
                    <input type="checkbox" name="serviceIds" value="${service.serviceId}" ${
                      checked.has(service.serviceId) ? "checked" : ""
                    } />
                    <span>${service.name}</span>
                  </label>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function syncTechnicianServiceSelection(selectElement, container, selectedIds = []) {
  const categoryFilter = selectElement?.value || "";
  refreshCategorySelectOptions(selectElement, "全部分類", categoryFilter);
  renderServiceSelectionCheckboxes(container, selectedIds, categoryFilter);
}

function setVisibleServiceSelection(container, checkedState) {
  if (!container) {
    return 0;
  }

  const visibleCheckboxes = Array.from(container.querySelectorAll('input[name="serviceIds"]'));
  visibleCheckboxes.forEach((input) => {
    input.checked = checkedState;
  });
  return visibleCheckboxes.length;
}

function getAllowedReservationServices(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) {
    return state.services;
  }

  if (!(technician.serviceIds || []).length) {
    return [];
  }

  const allowedIds = new Set(technician.serviceIds || []);
  return state.services.filter((service) => allowedIds.has(service.serviceId));
}

function getSelectedReservationServiceIds() {
  return Array.from(elements.reservationServiceSelect.querySelectorAll('input[name="serviceIds"]:checked')).map(
    (input) => input.value
  );
}

function renderReservationServiceOptions(selectedServiceIds = []) {
  const technicianId = getReservationServiceFilterTechnicianId();
  const services = technicianId ? getAllowedReservationServices(technicianId) : state.services;
  const checked = new Set(selectedServiceIds || []);

  if (!services.length) {
    elements.reservationServiceSelect.innerHTML = '<div class="empty-state">此技師目前沒有可選服務。</div>';
    return;
  }

  elements.reservationServiceSelect.innerHTML = services
    .map(
      (service) => `
        <label class="checkbox-pill">
          <input type="checkbox" name="serviceIds" value="${service.serviceId}" ${
            checked.has(service.serviceId) ? "checked" : ""
          } />
          <span>${service.name}</span>
        </label>
      `
    )
    .join("");
}

function resetReservationForm() {
  elements.reservationForm.reset();
  elements.reservationForm.reservationId.value = "";
  elements.reservationForm.status.value = "已預約";
  setReservationAssignedTechnicianId("");
  setOptions(
    elements.reservationTechnicianSelect,
    getReservationTechnicianOptions(),
    "請選擇技師"
  );
  renderReservationServiceOptions();
  updateReservationFormMode();
}

async function requestApi(method, params = {}, body = null) {
  if (!state.gasUrl) {
    throw new Error("請先在 admin/config.json 設定 GAS Web App URL");
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

function updateStats() {
  const activeTechnicians = state.technicians.filter((item) => item.active).length;
  const activeServices = state.services.filter((item) => item.active).length;
  const workingSchedules = state.schedules.filter((item) => item.isWorking).length;
  const bookedReservations = state.reservations.filter((item) => item.status === "已預約").length;
  const completedReservations = state.reservations.filter((item) => item.status === "已完成").length;
  const cancelledReservations = state.reservations.filter((item) => item.status === "已取消").length;

  elements.technicianStat.textContent = String(state.technicians.length);
  elements.technicianMeta.textContent = `${activeTechnicians} 位啟用中`;
  elements.serviceStat.textContent = String(state.services.length);
  elements.serviceMeta.textContent = `${activeServices} 項啟用中`;
  elements.scheduleStat.textContent = String(state.schedules.length);
  elements.scheduleMeta.textContent = `${workingSchedules} 筆可預約`;
  elements.reservationStat.textContent = String(state.reservations.length);
  elements.reservationMeta.textContent = `已預約 ${bookedReservations} / 已完成 ${completedReservations} / 已取消 ${cancelledReservations}`;
}

function getStatusPill(label, tone) {
  return `<span class="status-pill status-pill--${tone}">${label}</span>`;
}

function getActiveStatusPill(isActive) {
  return isActive ? getStatusPill("啟用", "active") : getStatusPill("停用", "inactive");
}

function getScheduleStatusPill(isWorking) {
  return isWorking ? getStatusPill("可預約", "working") : getStatusPill("休假", "off");
}

function getReservationStatusPill(status) {
  if (status === "已完成") {
    return getStatusPill(status, "completed");
  }
  if (status === "已取消") {
    return getStatusPill(status, "cancelled");
  }
  return getStatusPill(status || "已預約", "booked");
}

function getUserStatusPill(status) {
  if (status === "未送審核") {
    return getStatusPill(status, "draft");
  }
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

function getTechnicianReviewStatusPill(status) {
  if (status === "未綁定") {
    return getStatusPill(status, "draft");
  }
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

function getAdminPermissionPill(adminUser) {
  if (adminUser?.isSuperAdmin) {
    return getStatusPill("最高管理員", "approved");
  }

  return adminUser?.canManageAdmins
    ? getStatusPill("可管理管理員", "active")
    : getStatusPill("僅一般 admin", "inactive");
}

function formatDateTimeText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "未紀錄";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleString("zh-TW", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getReservationConfirmationSummary(payload) {
  const technicianName = payload.assignmentType === "現場安排"
    ? "現場安排"
    : getTechnicianById(payload.technicianId)?.name || payload.technicianId;
  const serviceNames = (payload.serviceIds || [])
    .map((serviceId) => getServiceById(serviceId)?.name || serviceId)
    .join("、");

  return [
    `客人：${payload.customerName}`,
    `技師：${technicianName}`,
    `服務：${serviceNames || "未選擇"}`,
    `日期：${payload.date}`,
    `開始時間：${payload.startTime}`,
    `狀態：${payload.status}`,
  ].join("\n");
}

function updateLastSyncTime() {
  elements.lastSyncLabel.textContent = new Date().toLocaleString("zh-TW", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateWorkspaceOverview() {
  const activeTechnicians = state.technicians.filter((item) => item.active).length;
  const activeServices = state.services.filter((item) => item.active).length;
  const workingSchedules = state.schedules.filter((item) => item.isWorking).length;
  const pendingReservations = state.reservations.filter((item) => item.status === "已預約").length;
  const pendingUsers = state.users.filter((item) => item.status === "待審核").length;
  const pendingTechnicians = state.technicians.filter((item) => item.status === "待審核").length;

  if (elements.workflowSummary) {
    elements.workflowSummary.textContent = `${activeTechnicians} 位啟用技師、${activeServices} 項啟用服務、${pendingReservations} 筆待處理預約、${pendingUsers} 位待審核用戶、${pendingTechnicians} 位待審核技師`;
  }

  if (!elements.workflowHint) {
    return;
  }

  if (!state.services.length) {
    elements.workflowHint.textContent = "先建立至少 1 個服務項目，再綁定到技師。";
    return;
  }

  if (!state.technicians.length) {
    elements.workflowHint.textContent = "新增技師後，記得勾選這位技師可承接的服務。";
    return;
  }

  if (!state.technicians.some((item) => (item.serviceIds || []).length)) {
    elements.workflowHint.textContent = "目前仍有技師尚未綁定服務，前台將無法選擇。";
    return;
  }

  if (!workingSchedules) {
    elements.workflowHint.textContent = "請建立可預約班表，否則前台不會出現可選時段。";
    return;
  }

  if (pendingUsers) {
    elements.workflowHint.textContent = `目前有 ${pendingUsers} 位 LINE 用戶待審核，通過後才能在前台送出預約。`;
    return;
  }

  if (pendingTechnicians) {
    elements.workflowHint.textContent = `目前有 ${pendingTechnicians} 位技師待審核，通過後才能登入 technician 頁面。`;
    return;
  }

  if (pendingReservations) {
    elements.workflowHint.textContent = `建議優先檢查 ${pendingReservations} 筆已預約紀錄的時段與狀態。`;
    return;
  }

  elements.workflowHint.textContent = "資料狀態完整，可持續維護服務、班表與預約。";
}

function getTechnicianScheduleTimeLabel(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) {
    return "未設定預設時段";
  }

  return `${technician.startTime} - ${technician.endTime}`;
}

function getBulkTechnicianRows() {
  if (!elements.technicianBulkTable) {
    return [];
  }

  return Array.from(elements.technicianBulkTable.querySelectorAll("[data-bulk-technician-row]"));
}

function getBulkTechnicianServiceIds(row) {
  const checkboxContainer = row?.querySelector("[data-bulk-service-checkboxes]");
  if (checkboxContainer && checkboxContainer.childElementCount) {
    return getSelectedServiceIdsFromContainer(checkboxContainer);
  }

  return String(row?.dataset.serviceIds || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getBulkTechnicianServicesLabel(serviceIds = []) {
  if (!serviceIds.length) {
    return "未綁定服務";
  }

  return serviceIds
    .map((serviceId) => getServiceById(serviceId)?.name || serviceId)
    .join("、");
}

function getBulkTechnicianServiceCategoryOptions(selectedValue = "") {
  const normalizedValue = String(selectedValue || "");
  return [
    '<option value="">全部分類</option>',
    ...getServiceCategoryOptions().map(
      (category) =>
        `<option value="${escapeHtml(category)}" ${normalizedValue === category ? "selected" : ""}>${escapeHtml(category)}</option>`
    ),
  ].join("");
}

function syncBulkTechnicianServiceSummary(row) {
  if (!row) {
    return;
  }

  const serviceIds = getBulkTechnicianServiceIds(row);
  const summaryLabel = row.querySelector("[data-bulk-service-summary]");
  const detailLabel = row.querySelector("[data-bulk-service-label]");
  row.dataset.serviceIds = serviceIds.join(",");

  if (summaryLabel) {
    summaryLabel.textContent = serviceIds.length ? `${serviceIds.length} 項服務` : "未綁定服務";
  }

  if (detailLabel) {
    const text = getBulkTechnicianServicesLabel(serviceIds);
    detailLabel.textContent = text;
    detailLabel.title = text;
  }
}

function renderBulkTechnicianServiceEditor(row) {
  if (!row) {
    return;
  }

  const container = row.querySelector("[data-bulk-service-checkboxes]");
  const categorySelect = row.querySelector("[data-bulk-service-category]");
  if (!container || !categorySelect) {
    return;
  }

  const selectedIds = getBulkTechnicianServiceIds(row);
  renderServiceSelectionCheckboxes(container, selectedIds, categorySelect.value || "");
  syncBulkTechnicianServiceSummary(row);
}

function toggleBulkTechnicianServiceEditor(row) {
  if (!row) {
    return;
  }

  const editor = row.querySelector("[data-bulk-service-editor]");
  if (!editor) {
    return;
  }

  const willOpen = editor.classList.contains("is-hidden");
  editor.classList.toggle("is-hidden", !willOpen);
  if (willOpen) {
    renderBulkTechnicianServiceEditor(row);
  }
}

function createBulkTechnicianRowMarkup(technician = null) {
  const technicianId = technician?.technicianId || "";
  const serviceIds = technician?.serviceIds || [];
  const serviceSummary = serviceIds.length ? `${serviceIds.length} 項服務` : "未綁定服務";
  const lineName = technician?.profileDisplayName || "";
  const technicianName = technician?.name || "";
  const startTime = technician?.startTime || "09:00";
  const endTime = technician?.endTime || "18:00";

  return `
    <tr data-bulk-technician-row data-technician-id="${escapeHtml(technicianId)}" data-service-ids="${escapeHtml(serviceIds.join(","))}">
      <td data-label="勾選">
        <input type="checkbox" name="bulkTechnicianSelected" value="${escapeHtml(technicianId)}" />
      </td>
      <td data-label="LINE 名稱">
        <input type="text" value="${escapeHtml(lineName)}" placeholder="尚未綁定 LINE" readonly />
      </td>
      <td data-label="技師名稱">
        <input type="text" name="name" value="${escapeHtml(technicianName)}" placeholder="輸入技師名稱" />
      </td>
      <td data-label="上班時間">
        <input type="time" name="startTime" value="${escapeHtml(startTime)}" />
      </td>
      <td data-label="下班時間">
        <input type="time" name="endTime" value="${escapeHtml(endTime)}" />
      </td>
      <td data-label="啟用">
        <label class="checkbox-field checkbox-field--compact">
          <input type="checkbox" name="active" ${technician?.active !== false ? "checked" : ""} />
          <span>${technician?.active !== false ? "啟用" : "停用"}</span>
        </label>
      </td>
      <td data-label="服務項目">
        <div class="bulk-technician-services">
          <strong data-bulk-service-summary>${serviceSummary}</strong>
          <small data-bulk-service-label title="${escapeHtml(getBulkTechnicianServicesLabel(serviceIds))}">${escapeHtml(getBulkTechnicianServicesLabel(serviceIds))}</small>
          <div class="form-actions form-actions--compact bulk-technician-services__actions">
            <button type="button" class="button button--ghost" data-bulk-toggle-services>編輯服務</button>
            <button type="button" class="button button--secondary" data-bulk-select-visible-services>全選目前分類</button>
            <button type="button" class="button button--secondary" data-bulk-clear-visible-services>清除此分類</button>
          </div>
          <div class="bulk-technician-services__editor is-hidden" data-bulk-service-editor>
            <label class="field field--compact">
              <span>服務分類</span>
              <select data-bulk-service-category>
                ${getBulkTechnicianServiceCategoryOptions()}
              </select>
            </label>
            <div class="checkbox-grid bulk-technician-services__grid" data-bulk-service-checkboxes></div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function updateBulkTechnicianSelectionMeta() {
  if (!elements.technicianBulkSelectionMeta) {
    return;
  }

  const rows = getBulkTechnicianRows();
  const checkedCount = rows.filter((row) => row.querySelector('input[name="bulkTechnicianSelected"]')?.checked).length;
  elements.technicianBulkSelectionMeta.textContent = checkedCount
    ? `已勾選 ${checkedCount} 位技師`
    : `共 ${rows.length} 列，尚未勾選任何技師`;
}

function renderTechnicianBulkTable() {
  if (!elements.technicianBulkTable) {
    return;
  }

  const technicians = getFilteredTechnicians();
  if (elements.technicianResultLabel) {
    elements.technicianResultLabel.textContent = `顯示 ${technicians.length} / ${state.technicians.length} 位`;
  }
  elements.technicianBulkTable.innerHTML = `
    <table class="list-table bulk-technician-table">
      <thead>
        <tr>
          <th>勾選</th>
          <th>LINE 名稱</th>
          <th>技師名稱</th>
          <th>上班時間</th>
          <th>下班時間</th>
          <th>啟用</th>
          <th>服務項目</th>
        </tr>
      </thead>
      <tbody>
        ${technicians.map((technician) => createBulkTechnicianRowMarkup(technician)).join("")}
      </tbody>
    </table>
  `;

  getBulkTechnicianRows().forEach((row) => {
    renderBulkTechnicianServiceEditor(row);
    const editor = row.querySelector("[data-bulk-service-editor]");
    if (editor) {
      editor.classList.add("is-hidden");
    }
  });
  updateBulkTechnicianSelectionMeta();
}

function renderTechnicianReviewSummary() {
  if (!elements.technicianReviewSummary) {
    return;
  }

  const unlinkedCount = state.technicians.filter((item) => item.status === "未綁定").length;
  const pendingCount = state.technicians.filter((item) => item.status === "待審核").length;
  const approvedCount = state.technicians.filter((item) => item.status === "已通過").length;
  const rejectedCount = state.technicians.filter((item) => item.status === "已拒絕").length;
  const disabledCount = state.technicians.filter((item) => item.status === "已停用").length;

  elements.technicianReviewSummary.innerHTML = `
    <article class="review-card">
      <span>未綁定</span>
      <strong>${unlinkedCount}</strong>
      <small>尚未有技師完成 technician 頁面的 LINE 登入</small>
    </article>
    <article class="review-card">
      <span>待審核</span>
      <strong>${pendingCount}</strong>
      <small>已登入 LINE，等待 admin 審核通過</small>
    </article>
    <article class="review-card">
      <span>已通過</span>
      <strong>${approvedCount}</strong>
      <small>可進入 technician 頁面查看自己的資料</small>
    </article>
    <article class="review-card">
      <span>已拒絕 / 已停用</span>
      <strong>${rejectedCount + disabledCount}</strong>
      <small>登入後會被阻擋，需重新調整狀態</small>
    </article>
  `;
}

function renderTechnicianReviewTable() {
  if (!elements.technicianReviewTable) {
    return;
  }

  const technicians = getFilteredTechnicianAccounts();
  const statusOrder = {
    "待審核": 0,
    "未綁定": 1,
    "已通過": 2,
    "已拒絕": 3,
    "已停用": 4,
  };

  renderTechnicianReviewSummary();

  if (!technicians.length) {
    elements.technicianReviewTable.innerHTML = `<div class="empty-state">${state.filters.technicianId || state.filters.technicianStatus !== "all" || state.filters.technicianReviewStatus !== "all" ? "找不到符合條件的技師帳號。" : "尚無任何技師 LINE 登入紀錄。"}</div>`;
    return;
  }

  elements.technicianReviewTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>技師</th>
          <th>LINE 帳號</th>
          <th>服務 / 班別</th>
          <th>技師狀態</th>
          <th>最後登入</th>
          <th>備註</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${technicians
          .slice()
          .sort((left, right) => {
            const leftRank = statusOrder[left.status] ?? 9;
            const rightRank = statusOrder[right.status] ?? 9;
            if (leftRank !== rightRank) {
              return leftRank - rightRank;
            }
            return String(right.lastLoginAt || right.updatedAt || "").localeCompare(String(left.lastLoginAt || left.updatedAt || ""));
          })
          .map((technician) => {
            const canReview = Boolean(technician.lineUserId);
            const lineDisplay = technician.lineUserId
              ? `
                <div class="user-cell">
                  ${technician.pictureUrl ? `<img class="user-avatar" src="${technician.pictureUrl}" alt="${technician.profileDisplayName || technician.name}" />` : `<div class="user-avatar user-avatar--placeholder">${(technician.profileDisplayName || technician.name || "T").slice(0, 1)}</div>`}
                  <div class="user-cell__meta">
                    <strong>${technician.profileDisplayName || technician.name}</strong>
                    <small>${technician.lineUserId}</small>
                  </div>
                </div>
              `
              : '<span class="helper-text">尚未登入 technician 頁面</span>';

            return `
              <tr>
                <td data-label="技師">
                  <div class="user-cell__meta">
                    <strong>${technician.name}</strong>
                    <small>${technician.technicianId}</small>
                  </div>
                </td>
                <td data-label="LINE 帳號">${lineDisplay}</td>
                <td data-label="服務 / 班別">${getBulkTechnicianServicesLabel(technician.serviceIds)}<br /><span class="helper-text">${technician.startTime} - ${technician.endTime} / ${technician.active ? "啟用" : "停用"}</span></td>
                <td data-label="技師狀態">${getTechnicianReviewStatusPill(technician.status)}</td>
                <td data-label="最後登入">${formatDateTimeText(technician.lastLoginAt)}</td>
                <td data-label="備註">${technician.note || '<span class="helper-text">尚無備註</span>'}</td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions stacked-actions">
                    <button type="button" class="button button--ghost" data-focus-technician="${technician.technicianId}">前往設定</button>
                    <button type="button" class="button button--ghost" data-review-technician="${technician.technicianId}" data-review-technician-status="已通過" ${canReview ? "" : "disabled"}>通過</button>
                    <button type="button" class="button button--secondary" data-review-technician="${technician.technicianId}" data-review-technician-status="待審核" ${canReview ? "" : "disabled"}>設待審核</button>
                    <button type="button" class="button button--secondary" data-review-technician="${technician.technicianId}" data-review-technician-status="已拒絕" ${canReview ? "" : "disabled"}>拒絕</button>
                    <button type="button" class="button button--danger" data-review-technician="${technician.technicianId}" data-review-technician-status="已停用" ${canReview ? "" : "disabled"}>停用</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function appendTechnicianBulkRow(technician = null) {
  if (!elements.technicianBulkTable) {
    return;
  }

  const tbody = elements.technicianBulkTable.querySelector("tbody");
  if (!tbody) {
    renderTechnicianBulkTable();
    return;
  }

  tbody.insertAdjacentHTML("beforeend", createBulkTechnicianRowMarkup(technician));
  const row = tbody.lastElementChild;
  if (row) {
    renderBulkTechnicianServiceEditor(row);
    const editor = row.querySelector("[data-bulk-service-editor]");
    if (editor) {
      editor.classList.add("is-hidden");
    }
  }
  updateBulkTechnicianSelectionMeta();
}

function readBulkTechnicianRow(row) {
  const technicianId = String(row.dataset.technicianId || "").trim();
  const name = row.querySelector('input[name="name"]')?.value.trim() || "";
  const startTime = row.querySelector('input[name="startTime"]')?.value || "";
  const endTime = row.querySelector('input[name="endTime"]')?.value || "";
  const active = Boolean(row.querySelector('input[name="active"]')?.checked);
  const serviceIds = getBulkTechnicianServiceIds(row);

  if (!technicianId && !name && !startTime && !endTime) {
    return null;
  }

  if (!name) {
    throw new Error("批量技師資料中有未填寫的技師名稱");
  }

  if (!startTime || !endTime) {
    throw new Error(`技師 ${name} 的上下班時間未填寫完整`);
  }

  return {
    technicianId,
    name,
    startTime,
    endTime,
    active,
    serviceIds,
  };
}

function renderServiceTable() {
  const services = getFilteredServices();
  elements.serviceResultLabel.textContent = `顯示 ${services.length} / ${state.services.length} 項`;
  if (!services.length) {
    elements.serviceTable.innerHTML = `<div class="empty-state">${state.filters.serviceKeyword || state.filters.serviceCategory ? "找不到符合篩選條件的服務項目。" : "尚無服務項目。"}</div>`;
    return;
  }

  elements.serviceTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>名稱</th>
          <th>類別</th>
          <th>時長</th>
          <th>價格</th>
          <th>狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${services
          .map(
            (service) => `
              <tr>
                <td data-label="名稱">${service.name}</td>
                <td data-label="類別">${getServiceCategory(service)}</td>
                <td data-label="時長">${service.durationMinutes} 分鐘</td>
                <td data-label="價格">NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}</td>
                <td data-label="狀態">${getActiveStatusPill(service.active)}</td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions">
                    <button type="button" class="button button--ghost" data-edit-service="${service.serviceId}">編輯</button>
                    <button type="button" class="button button--danger" data-delete-service="${service.serviceId}" data-service-name="${service.name}">刪除</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function getGroupedServiceMarkup(serviceIds = []) {
  const groupedServices = serviceIds
    .map((serviceId) => getServiceById(serviceId))
    .filter(Boolean)
    .reduce((result, service) => {
      const category = getServiceCategory(service);
      if (!result[category]) {
        result[category] = [];
      }
      result[category].push(service);
      return result;
    }, {});

  const categoryNames = Object.keys(groupedServices).sort((left, right) => left.localeCompare(right, "zh-Hant"));
  if (!categoryNames.length) {
    return '<span class="helper-text">尚未綁定</span>';
  }

  return categoryNames
    .map((category) => {
      const items = groupedServices[category]
        .sort((left, right) => left.name.localeCompare(right.name, "zh-Hant"))
        .map((service) => `<li>${service.name}</li>`)
        .join("");

      return `
        <div class="service-list-group">
          <p class="service-list-group-title">${category}</p>
          <ul class="service-list">${items}</ul>
        </div>
      `;
    })
    .join("");
}

function renderScheduleTable() {
  const workingSchedules = state.schedules.filter((item) => item.isWorking).length;
  elements.scheduleResultLabel.textContent = `${workingSchedules} 筆可預約 / 共 ${state.schedules.length} 筆`;
  renderScheduleCalendar();
  renderSelectedScheduleDetail();
}

function renderScheduleCalendar() {
  const monthKey = state.ui.scheduleCalendarMonth;
  const { firstDay, lastDay } = getMonthBoundary(monthKey);
  const selectedDate = state.ui.selectedScheduleDate;
  const todayText = formatLocalDate(new Date());
  const cells = [];

  elements.scheduleCalendarLabel.textContent = formatMonthLabel(monthKey);

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push('<div class="schedule-day--empty" aria-hidden="true"></div>');
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const dateText = `${monthKey}-${String(day).padStart(2, "0")}`;
    const schedules = getSchedulesCoveringDate(dateText);
    const workingCount = schedules.filter((item) => item.isWorking).length;
    const offCount = schedules.length - workingCount;
    const classes = ["schedule-day"];

    if (dateText === todayText) {
      classes.push("is-today");
    }
    if (dateText === selectedDate) {
      classes.push("is-selected");
    }
    if (workingCount) {
      classes.push("has-schedule");
    } else if (schedules.length) {
      classes.push("has-off-only");
    }

    cells.push(`
      <div class="${classes.join(" ")}">
        <button type="button" class="schedule-day__button" data-schedule-date="${dateText}">
          <span class="schedule-day__number">${day}</span>
          <span class="schedule-day__meta">
            <span class="schedule-day__count">${schedules.length ? `${schedules.length} 位技師` : "尚無排班"}</span>
            <span class="schedule-day__status">${workingCount ? `${workingCount} 位可預約` : offCount ? `${offCount} 位休假` : ""}</span>
          </span>
        </button>
      </div>
    `);
  }

  elements.scheduleCalendarGrid.innerHTML = cells.join("");
}

function renderSelectedScheduleDetail() {
  const selectedDate = state.ui.selectedScheduleDate;
  const schedules = getSchedulesCoveringDate(selectedDate);

  if (!selectedDate) {
    elements.scheduleSelectedDateLabel.textContent = "請先選擇日期";
    elements.scheduleSelectedDateMeta.textContent = "選取日曆日期後，會顯示當天所有技師的排班狀態。";
    elements.scheduleTable.innerHTML = '<div class="empty-state">尚未選取日期。</div>';
    return;
  }

  elements.scheduleSelectedDateLabel.textContent = selectedDate;
  elements.scheduleSelectedDateMeta.textContent = schedules.length
    ? `當天共有 ${schedules.length} 筆班表覆蓋，點擊編輯即可直接帶入下方表單。`
    : "當天尚未建立班表，可直接用下方表單新增。";

  if (!schedules.length) {
    elements.scheduleTable.innerHTML = '<div class="empty-state">這一天尚未建立任何技師班表。</div>';
    return;
  }

  elements.scheduleTable.innerHTML = schedules
    .map((schedule) => {
      const technicianName = getTechnicianById(schedule.technicianId)?.name || schedule.technicianId;
      const overnight = isOvernightShift(schedule.startTime, schedule.endTime);
      const isFromPrevDay = schedule.date !== selectedDate;
      const timeLabel = isFromPrevDay
        ? `${schedule.startTime} - ${schedule.endTime} (前日跨日)`
        : overnight
          ? `${schedule.startTime} - ${schedule.endTime} (跨日)`
          : `${schedule.startTime} - ${schedule.endTime}`;
      return `
        <article class="schedule-entry">
          <div class="schedule-entry__top">
            <div class="schedule-entry__title">
              <strong>${technicianName}</strong>
              <span class="schedule-entry__time">${timeLabel}</span>
            </div>
            ${getScheduleStatusPill(schedule.isWorking)}
          </div>
          <div class="table-actions">
            <button type="button" class="button button--ghost" data-edit-schedule="${schedule.date}::${schedule.technicianId}">編輯這筆班表</button>
            <button type="button" class="button button--danger" data-delete-schedule="${schedule.date}::${schedule.technicianId}" data-technician-name="${technicianName}">刪除這筆班表</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderReservationTable() {
  const reservations = getFilteredReservations();
  elements.reservationResultLabel.textContent = `顯示 ${reservations.length} / ${state.reservations.length} 筆`;
  if (!reservations.length) {
    elements.reservationTable.innerHTML = `<div class="empty-state">${state.filters.reservationKeyword || state.filters.reservationStatus !== "all" || state.filters.reservationTechnicianId ? "找不到符合條件的預約紀錄。" : "尚無預約紀錄。"}</div>`;
    return;
  }

  elements.reservationTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>日期</th>
          <th>時段</th>
          <th>客人</th>
          <th>電話</th>
          <th>技師</th>
          <th>服務</th>
          <th>狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${reservations
          .slice()
          .sort((left, right) => `${right.date}-${right.startTime}`.localeCompare(`${left.date}-${left.startTime}`))
          .map((reservation) => `
            <tr>
              <td data-label="日期">${reservation.date}</td>
              <td data-label="時段">${reservation.startTime} - ${reservation.endTime}</td>
              <td data-label="客人">${reservation.customerName}</td>
              <td data-label="電話">${reservation.phone}</td>
              <td data-label="技師">${getReservationTechnicianLabel(reservation)}</td>
              <td data-label="服務">${reservation.serviceName || reservation.serviceId}</td>
              <td data-label="狀態">${getReservationStatusPill(reservation.status)}</td>
              <td data-label="操作" class="table-cell-actions">
                <div class="table-actions">
                  <button type="button" class="button button--ghost" data-edit-reservation="${reservation.reservationId}">編輯</button>
                  <button type="button" class="button button--danger" data-delete-reservation="${reservation.reservationId}" data-customer-name="${reservation.customerName}">刪除</button>
                </div>
              </td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;
}

function renderUserReviewSummary() {
  if (!elements.userReviewSummary) {
    return;
  }

  const draftCount = state.users.filter((item) => item.status === "未送審核").length;
  const pendingCount = state.users.filter((item) => item.status === "待審核").length;
  const approvedCount = state.users.filter((item) => item.status === "已通過").length;
  const rejectedCount = state.users.filter((item) => item.status === "已拒絕").length;
  const disabledCount = state.users.filter((item) => item.status === "已停用").length;

  elements.userReviewSummary.innerHTML = `
    <article class="review-card">
      <span>未送審核</span>
      <strong>${draftCount}</strong>
      <small>已登入 LINE，但尚未填寫稱呼與電話</small>
    </article>
    <article class="review-card">
      <span>待審核</span>
      <strong>${pendingCount}</strong>
      <small>已送出完整申請，等待管理員審核</small>
    </article>
    <article class="review-card">
      <span>已通過</span>
      <strong>${approvedCount}</strong>
      <small>可直接在前台送出預約</small>
    </article>
    <article class="review-card">
      <span>已拒絕 / 已停用</span>
      <strong>${rejectedCount + disabledCount}</strong>
      <small>拒絕或停用後，前台送單會被阻擋</small>
    </article>
  `;
}

function renderUserTable() {
  const users = getFilteredUsers();
  const statusOrder = {
    "未送審核": 0,
    "待審核": 0,
    "已通過": 1,
    "已拒絕": 2,
    "已停用": 3,
  };

  if (elements.userResultLabel) {
    elements.userResultLabel.textContent = `顯示 ${users.length} / ${state.users.length} 位`;
  }

  renderUserReviewSummary();

  if (!elements.userTable) {
    return;
  }

  if (!users.length) {
    elements.userTable.innerHTML = `<div class="empty-state">${state.filters.userKeyword || state.filters.userStatus !== "all" ? "找不到符合條件的用戶。" : "尚無任何 LINE 用戶登入紀錄。"}</div>`;
    return;
  }

  elements.userTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>用戶</th>
          <th>稱呼</th>
          <th>電話</th>
          <th>狀態</th>
          <th>最後登入</th>
          <th>備註</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${users
          .slice()
          .sort((left, right) => {
            const leftRank = statusOrder[left.status] ?? 9;
            const rightRank = statusOrder[right.status] ?? 9;
            if (leftRank !== rightRank) {
              return leftRank - rightRank;
            }
            return String(right.updatedAt || right.lastLoginAt || "").localeCompare(String(left.updatedAt || left.lastLoginAt || ""));
          })
          .map((user) => `
            <tr>
              <td data-label="用戶">
                <div class="user-cell">
                  ${user.pictureUrl ? `<img class="user-avatar" src="${user.pictureUrl}" alt="${user.displayName}" />` : `<div class="user-avatar user-avatar--placeholder">${user.displayName.slice(0, 1) || "L"}</div>`}
                  <div class="user-cell__meta">
                    <strong>${user.displayName}</strong>
                    <small>${user.userId}</small>
                  </div>
                </div>
              </td>
              <td data-label="稱呼">${user.customerName || '<span class="helper-text">尚未填寫</span>'}</td>
              <td data-label="電話">${user.phone || '<span class="helper-text">尚未填寫</span>'}</td>
              <td data-label="狀態">${getUserStatusPill(user.status)}</td>
              <td data-label="最後登入">${formatDateTimeText(user.lastLoginAt)}</td>
              <td data-label="備註">${user.note || '<span class="helper-text">尚無備註</span>'}</td>
              <td data-label="操作" class="table-cell-actions">
                <div class="table-actions stacked-actions">
                  <button type="button" class="button button--ghost" data-review-user="${user.userId}" data-review-status="已通過">通過</button>
                  <button type="button" class="button button--secondary" data-review-user="${user.userId}" data-review-status="待審核">設待審核</button>
                  <button type="button" class="button button--secondary" data-review-user="${user.userId}" data-review-status="已拒絕">拒絕</button>
                  <button type="button" class="button button--danger" data-review-user="${user.userId}" data-review-status="已停用">停用</button>
                  <button type="button" class="button button--danger" data-delete-user="${user.userId}" data-user-name="${user.displayName}">刪除</button>
                </div>
              </td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;
}

function refreshTechnicianOptions() {
  const selectedScheduleTechnicianIds = getSelectedScheduleTechnicianIds();
  const selectedReservationTechnicianId = elements.reservationTechnicianSelect.value;
  const selectedTechnicianSearchId = elements.technicianSearchSelect.value;
  const selectedServiceCategory = elements.serviceCategoryFilter.value;
  const categoryOptions = getServiceCategoryOptions();

  syncScheduleTechnicianSelection(
    selectedScheduleTechnicianIds.filter((technicianId) =>
      state.technicians.some((item) => item.technicianId === technicianId && item.active)
    )
  );

  setOptions(
    elements.reservationTechnicianSelect,
    getReservationTechnicianOptions(),
    "請選擇技師"
  );

  setOptions(
    elements.technicianSearchSelect,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "全部技師"
  );

  setOptions(
    elements.reservationTechnicianFilter,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "全部技師"
  );

  refreshCategorySelectOptions(elements.serviceCategoryFilter, "全部類別", selectedServiceCategory || state.filters.serviceCategory);
  if (
    isOnsiteAssignmentSelected(selectedReservationTechnicianId)
    || state.technicians.some((item) => item.technicianId === selectedReservationTechnicianId)
  ) {
    elements.reservationTechnicianSelect.value = selectedReservationTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === selectedTechnicianSearchId)) {
    elements.technicianSearchSelect.value = selectedTechnicianSearchId;
  } else if (state.technicians.some((item) => item.technicianId === state.filters.technicianId)) {
    elements.technicianSearchSelect.value = state.filters.technicianId;
  }

  if (categoryOptions.includes(state.filters.serviceCategory)) {
    elements.serviceCategoryFilter.value = state.filters.serviceCategory;
  } else {
    state.filters.serviceCategory = "";
    elements.serviceCategoryFilter.value = "";
  }

  if (state.technicians.some((item) => item.technicianId === state.filters.reservationTechnicianId)) {
    elements.reservationTechnicianFilter.value = state.filters.reservationTechnicianId;
  }

  if (elements.technicianReviewStatusFilter) {
    elements.technicianReviewStatusFilter.value = state.filters.technicianReviewStatus || "all";
  }
}

function renderAll() {
  if (!state.ui.selectedScheduleDate) {
    state.ui.selectedScheduleDate = formatLocalDate(new Date());
  }
  updateStats();
  updateWorkspaceOverview();
  refreshServiceCategorySuggestions();
  renderServiceTable();
  renderTechnicianReviewTable();
  renderTechnicianBulkTable();
  renderScheduleTable();
  renderReservationTable();
  renderUserTable();
  refreshTechnicianOptions();
  updateServiceFormMode();
  if (isEditingServiceInline()) {
    const service = getServiceById(elements.serviceEditForm.serviceId.value);
    if (service) {
      fillServiceForm(service.serviceId);
    } else {
      resetServiceEditForm();
    }
  }
  if (isEditingReservation()) {
    const reservation = state.reservations.find(
      (item) => item.reservationId === elements.reservationForm.reservationId.value
    );
    if (reservation) {
      fillReservationForm(reservation.reservationId);
    } else {
      resetReservationForm();
    }
  } else {
    resetReservationForm();
  }
}

async function saveTechnicianPayload(payload) {
  const result = await requestApi("POST", {}, { action: "saveTechnician", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存技師失敗");
  }

  return result.data;
}

async function loadAdminData() {
  setLoadingStatus("正在載入管理資料...");
  const result = await requestApi("GET", { action: "adminData" });
  if (!result.ok) {
    throw new Error(result.message || "載入失敗");
  }

  state.services = (result.data.services || []).map((service) => ({
    ...service,
    category: normalizeCategory(service.category || state.serviceCategoryMap[service.serviceId]),
  }));
  state.adminUsers = result.data.adminUsers || [];
  state.adminUser = state.adminUsers.find((item) => item.userId === getCurrentAdminUserId()) || state.adminUser;
  state.technicians = result.data.technicians || [];
  state.schedules = result.data.schedules || [];
  state.users = result.data.users || [];
  state.reservations = result.data.reservations || [];
  renderAll();
  updateLastSyncTime();
  setStatus("管理資料已同步。", "success");
}

async function saveServiceForm(form) {
  setLoadingStatus("正在儲存服務資料...");
  const formData = new FormData(form);
  const payload = {
    serviceId: formData.get("serviceId") || "",
    name: formData.get("name").trim(),
    category: normalizeCategory(formData.get("category")),
    durationMinutes: Number(formData.get("durationMinutes")),
    price: Number(formData.get("price")),
    active: formData.get("active") === "on",
  };

  const result = await requestApi("POST", {}, { action: "saveService", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存服務失敗");
  }

  return {
    ...result.data,
    category: payload.category,
  };
}

async function submitService(event) {
  event.preventDefault();
  const payload = await saveServiceForm(elements.serviceForm);

  resetServiceForm();
  await loadAdminData();
  syncSavedServiceCategory(payload);
  renderAll();
  setStatus(payload.serviceId ? "服務已更新。" : "服務已新增。", "success");
}

async function submitServiceEdit(event) {
  event.preventDefault();
  const payload = await saveServiceForm(elements.serviceEditForm);

  resetServiceEditForm();
  await loadAdminData();
  syncSavedServiceCategory(payload);
  renderAll();
  setStatus("服務已更新。", "success");
}

async function saveTechnicianServicesPayload(payload) {
  const result = await requestApi("POST", {}, { action: "saveTechnicianServices", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存技師服務項目失敗");
  }

  return result.data;
}

async function submitSchedule(event) {
  event.preventDefault();
  setLoadingStatus("正在儲存班表...");
  const formData = new FormData(elements.scheduleForm);
  const technicianIds = getSelectedScheduleTechnicianIds();
  const startDate = formData.get("date");
  const endDate = formData.get("endDate") || startDate;
  const scheduleDates = enumerateDateRange(startDate, endDate);
  const isEditingSchedule = Boolean(state.ui.editingScheduleKey);

  if (!technicianIds.length) {
    throw new Error("請至少選擇一位技師");
  }

  if (isEditingSchedule && technicianIds.length !== 1) {
    throw new Error("編輯班表時一次只能修改一位技師");
  }

  if (isEditingSchedule && scheduleDates.length !== 1) {
    throw new Error("編輯班表時一次只能修改單一天");
  }

  const items = [];
  for (const scheduleDate of scheduleDates) {
    for (const technicianId of technicianIds) {
      const technician = getTechnicianById(technicianId);
      if (!technician) {
        throw new Error("找不到技師預設班別");
      }

      items.push({
        technicianId,
        date: scheduleDate,
        startTime: isEditingSchedule ? formData.get("startTime") : technician.startTime,
        endTime: isEditingSchedule ? formData.get("endTime") : technician.endTime,
        isWorking: formData.get("isWorking") === "on",
      });
    }
  }

  const result = await requestApi("POST", {}, { action: "batchSaveSchedules", payload: { items } });
  if (!result.ok) {
    throw new Error(result.message || "儲存班表失敗");
  }

  updateSelectedScheduleDate(startDate);
  await loadAdminData();
  resetScheduleForm();
  const scheduleCount = scheduleDates.length * technicianIds.length;
  setStatus(
    isEditingSchedule
      ? "班表時段已更新。"
      : scheduleCount > 1
      ? `已為 ${technicianIds.length} 位技師套用 ${scheduleDates.length} 天班表，共 ${scheduleCount} 筆。`
      : "班表已儲存。",
    "success"
  );
}

async function submitReservation(event) {
  event.preventDefault();
  const formData = new FormData(elements.reservationForm);
  const reservationTechnician = getReservationSubmissionTechnician();
  if (!reservationTechnician.technicianId) {
    throw new Error("現場安排需先保留一位實際技師，請先改選技師後再切回現場安排。");
  }
  const payload = {
    reservationId: formData.get("reservationId") || "",
    customerName: formData.get("customerName").trim(),
    phone: formData.get("phone").trim(),
    technicianId: reservationTechnician.technicianId,
    assignmentType: reservationTechnician.assignmentType,
    serviceIds: getSelectedReservationServiceIds(),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    status: formData.get("status"),
    note: formData.get("note").trim(),
  };

  const confirmed = window.confirm(`確定要更新這筆預約嗎？\n\n${getReservationConfirmationSummary(payload)}`);
  if (!confirmed) {
    setStatus("已取消更新預約。", "info");
    return;
  }

  setLoadingStatus("正在更新預約資料...");
  const result = await requestApi("POST", {}, { action: "saveReservation", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存預約失敗");
  }

  resetReservationForm();
  await loadAdminData();
  setStatus("預約已更新。", "success");
}

function fillServiceForm(serviceId) {
  const service = getServiceById(serviceId);
  if (!service) return;
  elements.serviceEditForm.serviceId.value = service.serviceId;
  elements.serviceEditForm.name.value = service.name;
  elements.serviceEditForm.category.value = getServiceCategory(service);
  elements.serviceEditForm.durationMinutes.value = service.durationMinutes;
  elements.serviceEditForm.price.value = service.price;
  elements.serviceEditForm.active.checked = Boolean(service.active);
  elements.serviceEditPanel.classList.remove("is-hidden");
  elements.serviceEditMode.classList.remove("is-hidden");
  scrollToPanel(elements.serviceEditPanel);
}

function fillReservationForm(reservationId) {
  const reservation = state.reservations.find((item) => item.reservationId === reservationId);
  if (!reservation) return;

  elements.reservationForm.reservationId.value = reservation.reservationId;
  elements.reservationForm.customerName.value = reservation.customerName;
  elements.reservationForm.phone.value = reservation.phone;
  elements.reservationForm.date.value = reservation.date;
  elements.reservationForm.startTime.value = reservation.startTime;
  elements.reservationForm.status.value = reservation.status || "已預約";
  elements.reservationForm.note.value = reservation.note || "";
  setReservationAssignedTechnicianId(reservation.technicianId);
  elements.reservationTechnicianSelect.value = reservation.assignmentType === "現場安排"
    ? ONSITE_ASSIGNMENT_VALUE
    : reservation.technicianId;
  renderReservationServiceOptions(reservation.serviceIds || String(reservation.serviceId || "").split(","));
  updateReservationFormMode();
  scrollToPanel(elements.reservationForm);
}

async function deleteService(serviceId, serviceName) {
  const confirmed = window.confirm(`確定要刪除服務「${serviceName}」嗎？`);
  if (!confirmed) return;

  setLoadingStatus("正在刪除服務資料...");
  const result = await requestApi("POST", {}, {
    action: "deleteService",
    payload: { serviceId },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除服務失敗");
  }

  if (elements.serviceForm.serviceId.value === serviceId) {
    resetServiceForm();
  }
  if (elements.serviceEditForm.serviceId.value === serviceId) {
    resetServiceEditForm();
  }
  removeServiceCategory(serviceId);
  await loadAdminData();
  setStatus("服務已刪除。", "success");
}

async function deleteTechnician(technicianId, technicianName) {
  const confirmed = window.confirm(`確定要刪除技師「${technicianName}」嗎？`);
  if (!confirmed) return;

  setLoadingStatus("正在刪除技師資料...");
  const result = await requestApi("POST", {}, {
    action: "deleteTechnician",
    payload: { technicianId },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除技師失敗");
  }

  await loadAdminData();
  setStatus("技師已刪除。", "success");
}

async function submitBulkTechnicians() {
  setLoadingStatus("正在批量儲存技師資料...");
  const rows = getBulkTechnicianRows();
  const payloads = rows
    .map((row) => readBulkTechnicianRow(row))
    .filter(Boolean);

  if (!payloads.length) {
    throw new Error("目前沒有可儲存的技師資料");
  }

  const result = await requestApi("POST", {}, {
    action: "batchSaveTechnicians",
    payload: {
      items: payloads,
    },
  });
  if (!result.ok) {
    throw new Error(result.message || "批量儲存技師失敗");
  }

  await loadAdminData();
  setStatus(`已批量儲存 ${payloads.length} 位技師。`, "success");
}

async function deleteBulkTechnicians() {
  const rows = getBulkTechnicianRows().filter((row) => row.querySelector('input[name="bulkTechnicianSelected"]')?.checked);

  if (!rows.length) {
    setStatus("請先勾選要刪除的技師。", "info");
    return;
  }

  const savedRows = rows.filter((row) => String(row.dataset.technicianId || "").trim());
  const draftRows = rows.filter((row) => !String(row.dataset.technicianId || "").trim());
  const confirmed = window.confirm(`確定要刪除勾選的 ${rows.length} 列技師資料嗎？`);
  if (!confirmed) {
    setStatus("已取消批量刪除。", "info");
    return;
  }

  draftRows.forEach((row) => row.remove());

  if (savedRows.length) {
    setLoadingStatus("正在批量刪除技師資料...");
    const result = await requestApi("POST", {}, {
      action: "batchDeleteTechnicians",
      payload: {
        technicianIds: savedRows.map((row) => row.dataset.technicianId),
      },
    });
    if (!result.ok) {
      throw new Error(result.message || "批量刪除技師失敗");
    }

    await loadAdminData();
  } else {
    updateBulkTechnicianSelectionMeta();
  }

  setStatus(`已刪除 ${rows.length} 列技師資料。`, "success");
}

async function deleteReservation(reservationId, customerName) {
  const reservation = state.reservations.find((item) => item.reservationId === reservationId);
  const detailText = reservation
    ? `\n\n日期：${reservation.date}\n時間：${reservation.startTime} - ${reservation.endTime}\n技師：${getReservationTechnicianLabel(reservation)}\n服務：${reservation.serviceName || reservation.serviceId}`
    : "";
  const confirmed = window.confirm(`確定要刪除 ${customerName} 的預約嗎？${detailText}`);
  if (!confirmed) return;

  setLoadingStatus("正在刪除預約資料...");
  const result = await requestApi("POST", {}, {
    action: "deleteReservation",
    payload: { reservationId },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除預約失敗");
  }

  if (elements.reservationForm.reservationId.value === reservationId) {
    resetReservationForm();
  }
  await loadAdminData();
  setStatus("預約已刪除。", "success");
}

async function deleteSchedule(scheduleDate, technicianId, technicianName) {
  const schedule = state.schedules.find((item) => item.date === scheduleDate && item.technicianId === technicianId);
  const displayName = technicianName || getTechnicianById(technicianId)?.name || technicianId;
  const detailText = schedule
    ? `\n\n日期：${schedule.date}\n時間：${schedule.startTime} - ${schedule.endTime}\n技師：${displayName}`
    : `\n\n日期：${scheduleDate}\n技師：${displayName}`;
  const confirmed = window.confirm(`確定要刪除這筆班表嗎？${detailText}`);
  if (!confirmed) {
    return;
  }

  setLoadingStatus("正在刪除班表資料...");
  const result = await requestApi("POST", {}, {
    action: "deleteSchedule",
    payload: {
      technicianId,
      date: scheduleDate,
    },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除班表失敗");
  }

  if (state.ui.editingScheduleKey === `${scheduleDate}::${technicianId}`) {
    resetScheduleForm();
  }

  updateSelectedScheduleDate(scheduleDate);
  await loadAdminData();
  setStatus("班表已刪除。", "success");
}

async function reviewTechnician(technicianId, status) {
  const technician = state.technicians.find((item) => item.technicianId === technicianId);
  if (!technician) {
    throw new Error("找不到技師資料");
  }

  if (!technician.lineUserId) {
    setStatus("此技師尚未完成 LINE 登入，暫時無法審核。", "info");
    return;
  }

  const note = window.prompt(`請輸入「${technician.name}」的技師審核備註：`, technician.note || "");
  if (note === null) {
    setStatus("已取消技師審核操作。", "info");
    return;
  }

  setLoadingStatus("正在更新技師審核狀態...");
  const result = await requestApi("POST", {}, {
    action: "reviewTechnician",
    payload: {
      technicianId,
      status,
      note,
    },
  });
  if (!result.ok) {
    throw new Error(result.message || "更新技師審核失敗");
  }

  await loadAdminData();
  setStatus(`已將 ${technician.name} 設為${status}。`, "success");
}

function focusTechnicianSettings(technicianId) {
  state.filters.technicianId = technicianId;
  if (elements.technicianSearchSelect) {
    elements.technicianSearchSelect.value = technicianId;
  }
  renderTechnicianReviewTable();
  renderTechnicianBulkTable();
  scrollToPanel(elements.technicianBulkTable);
  setStatus("已定位到這位技師的設定列。", "info");
}

async function reviewUser(userId, status) {
  const user = state.users.find((item) => item.userId === userId);
  if (!user) {
    throw new Error("找不到用戶資料");
  }

  const note = window.prompt(`請輸入「${user.displayName}」的審核備註：`, user.note || "");
  if (note === null) {
    setStatus("已取消用戶審核操作。", "info");
    return;
  }

  setLoadingStatus("正在更新用戶審核狀態...");
  const result = await requestApi("POST", {}, {
    action: "reviewUser",
    payload: {
      userId,
      status,
      note,
    },
  });
  if (!result.ok) {
    throw new Error(result.message || "更新用戶審核失敗");
  }

  await loadAdminData();
  setStatus(`已將 ${user.displayName} 設為${status}。`, "success");
}

async function deleteUser(userId, userName) {
  const user = state.users.find((item) => item.userId === userId);
  const displayName = userName || user?.displayName || userId;
  const detailText = user
    ? `\n\n稱呼：${user.customerName || "未填寫"}\n電話：${user.phone || "未填寫"}\n狀態：${user.status}`
    : "";
  const confirmed = window.confirm(`確定要刪除用戶「${displayName}」嗎？${detailText}`);
  if (!confirmed) {
    return;
  }

  setLoadingStatus("正在刪除用戶資料...");
  const result = await requestApi("POST", {}, {
    action: "deleteUser",
    payload: { userId },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除用戶失敗");
  }

  await loadAdminData();
  setStatus(`用戶 ${displayName} 已刪除。`, "success");
}

function bindEvents() {
  elements.adminLoginButton.addEventListener("click", async () => {
    try {
      await refreshAdminIdentity();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.adminRefreshIdentityButton.addEventListener("click", async () => {
    try {
      await refreshAdminIdentity();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.adminLogoutButton.addEventListener("click", async () => {
    try {
      if (!state.liffId) {
        throw new Error("請先在 admin/config.json 設定 liffId。");
      }

      if (!window.liff) {
        throw new Error("LIFF SDK 載入失敗。");
      }

      await window.liff.init({ liffId: state.liffId });
      if (window.liff.isLoggedIn()) {
        window.liff.logout();
      }

      state.profile = null;
      state.adminUser = null;
      state.adminUsers = [];
      renderAdminAccessState();
      setStatus("已登出 LINE 帳號。", "info");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.pageTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const nextPage = button.dataset.pageTrigger;
      setActivePage(nextPage);
      setStatus(`已切換到${button.textContent.trim()}頁面。`, "info");
    });
  });

  elements.serviceSubmitButton.addEventListener("click", async (event) => {
    try {
      await submitService(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.serviceForm.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });

  elements.serviceEditForm.addEventListener("submit", async (event) => {
    try {
      await submitServiceEdit(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.scheduleForm.addEventListener("submit", async (event) => {
    try {
      await submitSchedule(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.reservationForm.addEventListener("submit", async (event) => {
    try {
      await submitReservation(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.serviceResetButton.addEventListener("click", () => {
    resetServiceForm();
    setStatus("服務表單已重設。", "info");
  });

  elements.serviceEditResetButton.addEventListener("click", () => {
    resetServiceEditForm();
    setStatus("已取消服務編輯。", "info");
  });

  elements.serviceSearchInput.addEventListener("input", (event) => {
    state.filters.serviceKeyword = event.target.value;
    renderServiceTable();
  });

  elements.serviceCategoryFilter.addEventListener("change", (event) => {
    state.filters.serviceCategory = event.target.value;
    renderServiceTable();
  });

  elements.technicianSearchSelect.addEventListener("change", (event) => {
    state.filters.technicianId = event.target.value;
    renderTechnicianReviewTable();
    renderTechnicianBulkTable();
  });

  elements.technicianStatusFilter.addEventListener("change", (event) => {
    state.filters.technicianStatus = event.target.value;
    renderTechnicianReviewTable();
    renderTechnicianBulkTable();
  });

  elements.technicianReviewStatusFilter.addEventListener("change", (event) => {
    state.filters.technicianReviewStatus = event.target.value;
    renderTechnicianReviewTable();
  });

  elements.technicianBulkAddRowButton.addEventListener("click", () => {
    appendTechnicianBulkRow();
    setStatus("已新增一列批量技師資料。", "info");
  });

  elements.technicianBulkSaveButton.addEventListener("click", async () => {
    try {
      await submitBulkTechnicians();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.technicianBulkDeleteButton.addEventListener("click", async () => {
    try {
      await deleteBulkTechnicians();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.technicianBulkTable.addEventListener("change", (event) => {
    if (event.target.matches('input[name="bulkTechnicianSelected"]')) {
      updateBulkTechnicianSelectionMeta();
      return;
    }

    if (event.target.matches('input[name="active"]')) {
      const row = event.target.closest("[data-bulk-technician-row]");
      const label = row?.querySelector('.checkbox-field--compact span');
      if (label) {
        label.textContent = event.target.checked ? "啟用" : "停用";
      }
      return;
    }

    if (event.target.matches("[data-bulk-service-category]")) {
      const row = event.target.closest("[data-bulk-technician-row]");
      renderBulkTechnicianServiceEditor(row);
      return;
    }

    if (event.target.matches('[data-bulk-service-checkboxes] input[name="serviceIds"]')) {
      const row = event.target.closest("[data-bulk-technician-row]");
      syncBulkTechnicianServiceSummary(row);
    }
  });

  elements.technicianBulkTable.addEventListener("click", (event) => {
    const row = event.target.closest("[data-bulk-technician-row]");
    if (!row) {
      return;
    }

    if (event.target.closest("[data-bulk-toggle-services]")) {
      toggleBulkTechnicianServiceEditor(row);
      return;
    }

    if (event.target.closest("[data-bulk-select-visible-services]")) {
      const count = setVisibleServiceSelection(row.querySelector("[data-bulk-service-checkboxes]"), true);
      syncBulkTechnicianServiceSummary(row);
      setStatus(count ? "已全選此列目前分類服務。" : "目前分類沒有可勾選的服務項目。", "info");
      return;
    }

    if (event.target.closest("[data-bulk-clear-visible-services]")) {
      const count = setVisibleServiceSelection(row.querySelector("[data-bulk-service-checkboxes]"), false);
      syncBulkTechnicianServiceSummary(row);
      setStatus(count ? "已清除此列目前分類服務。" : "目前分類沒有可清除的服務項目。", "info");
    }
  });

  elements.technicianReviewTable.addEventListener("click", async (event) => {
    const focusButton = event.target.closest("[data-focus-technician]");
    if (focusButton) {
      focusTechnicianSettings(focusButton.dataset.focusTechnician);
      return;
    }

    const reviewButton = event.target.closest("[data-review-technician]");
    if (!reviewButton) {
      return;
    }

    try {
      await reviewTechnician(reviewButton.dataset.reviewTechnician, reviewButton.dataset.reviewTechnicianStatus);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.reservationSearchInput.addEventListener("input", (event) => {
    state.filters.reservationKeyword = event.target.value;
    renderReservationTable();
  });

  elements.reservationStatusFilter.addEventListener("change", (event) => {
    state.filters.reservationStatus = event.target.value;
    renderReservationTable();
  });

  elements.reservationTechnicianFilter.addEventListener("change", (event) => {
    state.filters.reservationTechnicianId = event.target.value;
    renderReservationTable();
  });

  elements.userSearchInput.addEventListener("input", (event) => {
    state.filters.userKeyword = event.target.value;
    renderUserTable();
  });

  elements.userStatusFilter.addEventListener("change", (event) => {
    state.filters.userStatus = event.target.value;
    renderUserTable();
  });

  elements.scheduleResetButton.addEventListener("click", () => {
    resetScheduleForm();
    setStatus("班表表單已重設。", "info");
  });

  elements.scheduleSelectAllTechniciansButton.addEventListener("click", () => {
    const count = setScheduleTechnicianSelection(true);
    setStatus(count ? `已全選 ${count} 位啟用技師。` : "目前沒有可選擇的技師。", "info");
  });

  elements.scheduleClearTechniciansButton.addEventListener("click", () => {
    const count = setScheduleTechnicianSelection(false);
    setStatus(count ? "已清空技師勾選。" : "目前沒有可清空的技師。", "info");
  });

  elements.scheduleTechnicianCheckboxes.addEventListener("change", () => {
    updateScheduleTechnicianSelectionMeta();
  });

  elements.schedulePrevMonthButton.addEventListener("click", () => {
    state.ui.scheduleCalendarMonth = shiftMonth(state.ui.scheduleCalendarMonth, -1);
    state.ui.selectedScheduleDate = `${state.ui.scheduleCalendarMonth}-01`;
    renderScheduleTable();
  });

  elements.scheduleTodayButton.addEventListener("click", () => {
    const todayText = formatLocalDate(new Date());
    updateSelectedScheduleDate(todayText);
    renderScheduleTable();
    resetScheduleForm();
    setStatus(`已切換到 ${todayText}。`, "info");
  });

  elements.scheduleNextMonthButton.addEventListener("click", () => {
    state.ui.scheduleCalendarMonth = shiftMonth(state.ui.scheduleCalendarMonth, 1);
    state.ui.selectedScheduleDate = `${state.ui.scheduleCalendarMonth}-01`;
    renderScheduleTable();
  });

  elements.scheduleCalendarGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-schedule-date]");
    if (!button) {
      return;
    }

    updateSelectedScheduleDate(button.dataset.scheduleDate);
    renderScheduleTable();
    resetScheduleForm();
    setStatus(`已選擇 ${button.dataset.scheduleDate}，可查看或新增當日班表。`, "info");
  });

  elements.scheduleTable.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-schedule]");
    if (editButton) {
      const [dateText, technicianId] = editButton.dataset.editSchedule.split("::");
      const schedule = state.schedules.find((item) => item.date === dateText && item.technicianId === technicianId);
      if (!schedule) {
        setStatus("找不到這筆班表資料。", "error");
        return;
      }

      fillScheduleForm(schedule);
      setStatus("已載入班表資料，可直接修改。", "info");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-schedule]");
    if (!deleteButton) {
      return;
    }

    try {
      const [dateText, technicianId] = deleteButton.dataset.deleteSchedule.split("::");
      await deleteSchedule(dateText, technicianId, deleteButton.dataset.technicianName);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.refreshDashboardButton.addEventListener("click", async () => {
    try {
      setLoadingStatus("正在重新同步資料...");
      await loadAdminData();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.reservationResetButton.addEventListener("click", () => {
    resetReservationForm();
    setStatus("預約表單已重設。", "info");
  });

  elements.reservationTechnicianSelect.addEventListener("change", () => {
    if (!isOnsiteAssignmentSelected(elements.reservationTechnicianSelect.value)) {
      setReservationAssignedTechnicianId(elements.reservationTechnicianSelect.value);
    }
    renderReservationServiceOptions(getSelectedReservationServiceIds());
  });

  elements.serviceTable.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-service]");
    if (editButton) {
      fillServiceForm(editButton.dataset.editService);
      setStatus("已載入服務資料，可直接修改。", "info");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-service]");
    if (!deleteButton) return;

    try {
      await deleteService(deleteButton.dataset.deleteService, deleteButton.dataset.serviceName);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.reservationTable.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-reservation]");
    if (editButton) {
      fillReservationForm(editButton.dataset.editReservation);
      setStatus("已載入預約資料，可直接修改。", "info");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-reservation]");
    if (!deleteButton) return;

    try {
      await deleteReservation(
        deleteButton.dataset.deleteReservation,
        deleteButton.dataset.customerName
      );
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.userTable.addEventListener("click", async (event) => {
    const reviewButton = event.target.closest("[data-review-user]");
    if (reviewButton) {
      try {
        await reviewUser(reviewButton.dataset.reviewUser, reviewButton.dataset.reviewStatus);
      } catch (error) {
        setStatus(error.message, "error");
      }
      return;
    }

    const deleteButton = event.target.closest("[data-delete-user]");
    if (!deleteButton) {
      return;
    }

    try {
      await deleteUser(deleteButton.dataset.deleteUser, deleteButton.dataset.userName);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

}

async function initializeApp() {
  await loadConfigFromJson();
  applyGasUrlPreference();
  loadServiceCategoryMap();
  bindEvents();
  renderAdminAccessState();
  setActivePage(state.ui.activePage);
  resetServiceForm();
  resetServiceEditForm();
  resetScheduleForm();
  resetReservationForm();

  if (state.gasUrl && state.liffId) {
    refreshAdminIdentity().catch((error) => setStatus(error.message, "error"));
    return;
  }

  setStatus("請檢查 admin/config.json 內的 gasWebAppUrl 與 liffId。", "info");
}

initializeApp();
