(() => {

const ADMIN_STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
  serviceCategories: "beauty-booking-service-categories",
};
const CONFIG_PATH = "./config.json";
const ONSITE_ASSIGNMENT_VALUE = "__ONSITE_ASSIGNMENT__";
const ADMIN_PAGE_KEYS = ["service", "technician", "schedule", "leave", "reservation", "user", "admin"];
const ADMIN_PAGE_OPTIONS = [
  { key: "service", label: "服務" },
  { key: "technician", label: "技師" },
  { key: "schedule", label: "班表" },
  { key: "leave", label: "休假" },
  { key: "reservation", label: "預約" },
  { key: "user", label: "用戶審核" },
];
const vueApi = window.Vue || null;
const frameworkEnabled = Boolean(vueApi);
const { createApp, reactive } = vueApi || {};
const TIME_WHEEL_ITEM_HEIGHT = 52;
const TIME_WHEEL_MINUTE_STEP = 5;
const TIME_WHEEL_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const TIME_WHEEL_MINUTES = Array.from({ length: 60 / TIME_WHEEL_MINUTE_STEP }, (_, index) =>
  String(index * TIME_WHEEL_MINUTE_STEP).padStart(2, "0")
);

const frameworkView = frameworkEnabled
  ? reactive({
      service: {
        rows: [],
        emptyMessage: "尚無服務項目。",
      },
      technicianReview: {
        summary: {
          unlinkedCount: 0,
          pendingCount: 0,
          approvedCount: 0,
          blockedCount: 0,
        },
        rows: [],
        emptyMessage: "尚無任何技師 LINE 登入紀錄。",
      },
      schedule: {
        days: [],
        entries: [],
        emptyMessage: "尚未選取日期。",
      },
      leaveRequest: {
        summary: {
          pendingCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          cancelledCount: 0,
        },
        rows: [],
        emptyMessage: "尚無休假申請。",
      },
      reservation: {
        rows: [],
        emptyMessage: "尚無預約紀錄。",
      },
      userReview: {
        summary: {
          draftCount: 0,
          pendingCount: 0,
          approvedCount: 0,
          blockedCount: 0,
        },
        rows: [],
        emptyMessage: "尚無任何 LINE 用戶登入紀錄。",
      },
      adminManagement: {
        summary: {
          totalCount: 0,
          approvedCount: 0,
          pendingCount: 0,
          canManageCount: 0,
        },
        rows: [],
        emptyMessage: "尚無任何管理員登入紀錄。",
      },
    })
  : null;

let frameworkMounted = false;

const state = {
  gasUrl: "",
  configGasUrl: "",
  liffId: "",
  liffLoginRequired: true,
  profile: null,
  adminUser: null,
  adminUsers: [],
  services: [],
  technicians: [],
  schedules: [],
  leaveRequests: [],
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
    adminKeyword: "",
    adminStatus: "all",
  },
  ui: {
    busyCount: 0,
    activePage: "service",
    scheduleCalendarMonth: formatLocalDate(new Date()).slice(0, 7),
    selectedScheduleDate: formatLocalDate(new Date()),
    selectedScheduleDeleteKeys: [],
    editingScheduleKey: "",
    editingScheduleIsWorking: true,
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
  noPagePermissionNotice: document.querySelector("#noPagePermissionNotice"),
  pageScopedElements: Array.from(document.querySelectorAll("[data-admin-page-scope]")),
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
  technicianBulkTable: document.querySelector("#technicianBulkTable"),
  technicianStickyBar: document.querySelector("#technicianStickyBar"),
  technicianStickyMeta: document.querySelector("#technicianStickyMeta"),
  technicianStickySaveButton: document.querySelector("#technicianStickySaveButton"),
  technicianStickyCancelButton: document.querySelector("#technicianStickyCancelButton"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleResetButton: document.querySelector("#scheduleResetButton"),
  scheduleResultLabel: document.querySelector("#scheduleResultLabel"),
  leaveRequestResultLabel: document.querySelector("#leaveRequestResultLabel"),
  leaveRequestSummary: document.querySelector("#leaveRequestSummary"),
  leaveRequestTable: document.querySelector("#leaveRequestTable"),
  scheduleCalendarLabel: document.querySelector("#scheduleCalendarLabel"),
  scheduleCalendarGrid: document.querySelector("#scheduleCalendarGrid"),
  schedulePrevMonthButton: document.querySelector("#schedulePrevMonthButton"),
  scheduleTodayButton: document.querySelector("#scheduleTodayButton"),
  scheduleNextMonthButton: document.querySelector("#scheduleNextMonthButton"),
  scheduleSelectedDateLabel: document.querySelector("#scheduleSelectedDateLabel"),
  scheduleSelectedDateMeta: document.querySelector("#scheduleSelectedDateMeta"),
  scheduleTechnicianField: document.querySelector("#scheduleTechnicianField"),
  scheduleEditTimePanel: document.querySelector("#scheduleEditTimePanel"),
  scheduleEditModeLabel: document.querySelector("#scheduleEditModeLabel"),
  scheduleSelectAllTechniciansButton: document.querySelector("#scheduleSelectAllTechniciansButton"),
  scheduleClearTechniciansButton: document.querySelector("#scheduleClearTechniciansButton"),
  scheduleTechnicianSelectionMeta: document.querySelector("#scheduleTechnicianSelectionMeta"),
  scheduleBatchSelectionMeta: document.querySelector("#scheduleBatchSelectionMeta"),
  scheduleSelectAllEntriesButton: document.querySelector("#scheduleSelectAllEntriesButton"),
  scheduleClearEntriesButton: document.querySelector("#scheduleClearEntriesButton"),
  scheduleBatchDeleteButton: document.querySelector("#scheduleBatchDeleteButton"),
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
  adminSearchInput: document.querySelector("#adminSearchInput"),
  adminStatusFilter: document.querySelector("#adminStatusFilter"),
  adminResultLabel: document.querySelector("#adminResultLabel"),
  adminManagementSummary: document.querySelector("#adminManagementSummary"),
  adminManagementTable: document.querySelector("#adminManagementTable"),
  adminStat: document.querySelector("#adminStat"),
  adminMeta: document.querySelector("#adminMeta"),
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
  timeWheelSheet: document.querySelector("#timeWheelSheet"),
  timeWheelBackdrop: document.querySelector("#timeWheelBackdrop"),
  timeWheelCloseButton: document.querySelector("#timeWheelCloseButton"),
  timeWheelConfirmButton: document.querySelector("#timeWheelConfirmButton"),
  timeWheelNowButton: document.querySelector("#timeWheelNowButton"),
  timeWheelHourList: document.querySelector("#timeWheelHourList"),
  timeWheelMinuteList: document.querySelector("#timeWheelMinuteList"),
  timeWheelValueLabel: document.querySelector("#timeWheelValueLabel"),
};

const timeWheelState = {
  activeInput: null,
  activeTrigger: null,
  hour: "09",
  minute: "00",
};

function normalizeTimeValue(value, fallback = "09:00") {
  const matched = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) {
    return fallback;
  }

  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }

  const normalizedMinutes = Math.round(minutes / TIME_WHEEL_MINUTE_STEP) * TIME_WHEEL_MINUTE_STEP;
  const clampedMinutes = normalizedMinutes >= 60 ? 55 : normalizedMinutes;
  return `${String(hours).padStart(2, "0")}:${String(clampedMinutes).padStart(2, "0")}`;
}

function getTimeWheelFieldParts(source) {
  const field = source?.closest(".time-wheel-field");
  if (!field) {
    return { field: null, input: null, trigger: null };
  }

  return {
    field,
    input: field.querySelector('input[type="hidden"]'),
    trigger: field.querySelector("[data-time-wheel-trigger]"),
  };
}

function syncTimeWheelField(source, value) {
  const { input, trigger } = getTimeWheelFieldParts(source);
  if (!input || !trigger) {
    return;
  }

  const normalizedValue = normalizeTimeValue(value);
  input.value = normalizedValue;
  trigger.textContent = normalizedValue;
  trigger.dataset.timeValue = normalizedValue;
}

function renderTimeWheelList(container, values, type) {
  if (!container) {
    return;
  }

  container.innerHTML = values
    .map(
      (value) => `
        <button type="button" class="time-wheel-list__item" data-time-wheel-item="${type}" data-time-wheel-value="${value}">${value}</button>
      `
    )
    .join("");
}

function ensureTimeWheelLists() {
  if (!elements.timeWheelHourList || !elements.timeWheelMinuteList) {
    return;
  }

  if (!elements.timeWheelHourList.childElementCount) {
    renderTimeWheelList(elements.timeWheelHourList, TIME_WHEEL_HOURS, "hour");
  }

  if (!elements.timeWheelMinuteList.childElementCount) {
    renderTimeWheelList(elements.timeWheelMinuteList, TIME_WHEEL_MINUTES, "minute");
  }
}

function updateTimeWheelLabel() {
  if (elements.timeWheelValueLabel) {
    elements.timeWheelValueLabel.textContent = `${timeWheelState.hour}:${timeWheelState.minute}`;
  }
}

function updateTimeWheelSelection(scrollToValue = false) {
  const hourValue = timeWheelState.hour;
  const minuteValue = timeWheelState.minute;

  [elements.timeWheelHourList, elements.timeWheelMinuteList].forEach((container) => {
    if (!container) {
      return;
    }

    container.querySelectorAll("[data-time-wheel-value]").forEach((button) => {
      const isHour = button.dataset.timeWheelItem === "hour";
      const isSelected = button.dataset.timeWheelValue === (isHour ? hourValue : minuteValue);
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
  });

  if (scrollToValue) {
    const hourIndex = TIME_WHEEL_HOURS.indexOf(hourValue);
    const minuteIndex = TIME_WHEEL_MINUTES.indexOf(minuteValue);
    if (elements.timeWheelHourList && hourIndex >= 0) {
      elements.timeWheelHourList.scrollTo({ top: hourIndex * TIME_WHEEL_ITEM_HEIGHT, behavior: "auto" });
    }
    if (elements.timeWheelMinuteList && minuteIndex >= 0) {
      elements.timeWheelMinuteList.scrollTo({ top: minuteIndex * TIME_WHEEL_ITEM_HEIGHT, behavior: "auto" });
    }
  }

  updateTimeWheelLabel();
}

function closeTimeWheelPicker() {
  if (!elements.timeWheelSheet) {
    return;
  }

  elements.timeWheelSheet.classList.add("is-hidden");
  elements.timeWheelSheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-sheet-open");
  timeWheelState.activeInput = null;
  timeWheelState.activeTrigger = null;
}

function openTimeWheelPicker(trigger) {
  const { input, trigger: targetTrigger } = getTimeWheelFieldParts(trigger);
  if (!input || !targetTrigger || !elements.timeWheelSheet) {
    return;
  }

  ensureTimeWheelLists();
  const [hour, minute] = normalizeTimeValue(input.value || targetTrigger.dataset.timeValue || "09:00").split(":");
  timeWheelState.activeInput = input;
  timeWheelState.activeTrigger = targetTrigger;
  timeWheelState.hour = hour;
  timeWheelState.minute = minute;
  updateTimeWheelSelection(true);

  elements.timeWheelSheet.classList.remove("is-hidden");
  elements.timeWheelSheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-sheet-open");
}

function applyTimeWheelValue() {
  if (!timeWheelState.activeInput || !timeWheelState.activeTrigger) {
    closeTimeWheelPicker();
    return;
  }

  const value = `${timeWheelState.hour}:${timeWheelState.minute}`;
  syncTimeWheelField(timeWheelState.activeTrigger, value);
  timeWheelState.activeInput.dispatchEvent(new Event("change", { bubbles: true }));
  closeTimeWheelPicker();
}

function getTimeWheelScrollValue(container, values) {
  const index = Math.max(0, Math.min(values.length - 1, Math.round(container.scrollTop / TIME_WHEEL_ITEM_HEIGHT)));
  return values[index];
}

function handleTimeWheelScroll(container) {
  if (!container) {
    return;
  }

  window.clearTimeout(container._timeWheelTimerId);
  container._timeWheelTimerId = window.setTimeout(() => {
    const type = container.dataset.timeWheelList;
    const values = type === "hour" ? TIME_WHEEL_HOURS : TIME_WHEEL_MINUTES;
    const nextValue = getTimeWheelScrollValue(container, values);
    if (type === "hour") {
      timeWheelState.hour = nextValue;
    } else {
      timeWheelState.minute = nextValue;
    }

    updateTimeWheelSelection();
    const nextIndex = values.indexOf(nextValue);
    container.scrollTo({ top: nextIndex * TIME_WHEEL_ITEM_HEIGHT, behavior: "smooth" });
  }, 90);
}

function initializeTimeWheelFields(container = document) {
  if (!container) {
    return;
  }

  container.querySelectorAll(".time-wheel-field").forEach((field) => {
    const input = field.querySelector('input[type="hidden"]');
    const trigger = field.querySelector("[data-time-wheel-trigger]");
    if (!input || !trigger) {
      return;
    }

    syncTimeWheelField(trigger, input.value || trigger.dataset.timeValue || "09:00");
  });
}

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
    state.liffLoginRequired = config.liffLoginRequired !== false;
  } catch (error) {
    state.configGasUrl = "";
    state.liffId = "";
    state.liffLoginRequired = true;
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

  elements.adminStatusBadge.textContent = state.adminUser.status;

  if (state.adminUser.status === "已通過") {
    elements.adminStatusBadge.dataset.tone = "approved";
    elements.adminStatusText.textContent = "你已通過管理員審核，後台資料載入後即可使用。";
    setAdminApprovalMessage("已通過管理員審核，後台資料載入後即可使用。", "approved");
    setAdminContentAccess(true);
    return;
  }

  if (state.adminUser.status === "待審核") {
    elements.adminStatusBadge.dataset.tone = "pending";
    elements.adminStatusText.textContent = "你已完成 LINE 登入，但仍需等待既有管理員審核通過。";
    setAdminApprovalMessage("目前為待審核狀態，需由已通過的管理員審核後才能使用後台。", "pending");
    setAdminContentAccess(false);
    return;
  }

  elements.adminStatusBadge.dataset.tone = "blocked";
  elements.adminStatusText.textContent = state.adminUser.note || "此 LINE 帳號目前不可使用管理後台。";
  setAdminApprovalMessage(state.adminUser.note || "此管理員帳號目前不可使用後台，請聯絡既有管理員。", "blocked");
  setAdminContentAccess(false);
}

async function ensureLiffSession() {
  if (!state.liffLoginRequired) {
    state.profile = {
      userId: "TEST_ADMIN_USER",
      displayName: "測試管理員",
      pictureUrl: "",
    };
    renderAdminAccessState();
    return true;
  }

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
      ? "管理員帳號尚待審核，通過前無法使用後台。"
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

function getAllowedAdminPages() {
  const pagePermissions = Array.isArray(state.adminUser?.pagePermissions)
    ? state.adminUser.pagePermissions
    : [];

  const allowed = ADMIN_PAGE_KEYS.filter((pageKey) => pagePermissions.includes(pageKey));
  if (allowed.includes("schedule") && !allowed.includes("leave")) {
    allowed.push("leave");
  }
  if (state.adminUser?.canManageAdmins && !allowed.includes("admin")) {
    allowed.push("admin");
  }
  return allowed;
}

function updateNoPagePermissionNotice(allowedPages) {
  if (!elements.noPagePermissionNotice) {
    return;
  }

  const shouldShow = isApprovedAdmin() && allowedPages.length === 0;
  elements.noPagePermissionNotice.classList.toggle("is-hidden", !shouldShow);
}

function elementMatchesAdminPageScope(element, allowedPages) {
  const rawScope = String(element?.dataset.adminPageScope || "").trim();
  if (!rawScope) {
    return true;
  }

  const scopes = rawScope
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (!scopes.length) {
    return true;
  }

  return scopes.some((scope) => allowedPages.includes(scope));
}

function updateScopedAdminElements(allowedPages) {
  elements.pageScopedElements.forEach((element) => {
    const isAllowed = elementMatchesAdminPageScope(element, allowedPages);
    element.classList.toggle("is-hidden", !isAllowed);
  });
}

function setActivePage(pageName, options = {}) {
  const allowedPages = getAllowedAdminPages();
  const nextPage = allowedPages.includes(pageName) ? pageName : allowedPages[0] || "";

  state.ui.activePage = nextPage;
  updateScopedAdminElements(allowedPages);

  elements.pageTabs.forEach((button) => {
    const buttonPage = button.dataset.pageTrigger;
    const isAllowed = allowedPages.includes(buttonPage);
    const isActive = isAllowed && buttonPage === nextPage;
    button.classList.toggle("is-hidden", !isAllowed);
    button.classList.toggle("active", isActive);
    button.disabled = !isAllowed;
    button.setAttribute("aria-pressed", String(isActive));
  });

  elements.pagePanels.forEach((panel) => {
    const panelPage = panel.dataset.adminPage;
    const isAllowed = allowedPages.includes(panelPage);
    const isActive = isAllowed && panelPage === nextPage;
    panel.classList.toggle("is-hidden", !isActive);
    panel.classList.toggle("is-active", isActive);
  });

  updateNoPagePermissionNotice(allowedPages);
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

function updateSelectedScheduleDate(dateText) {
  if (!dateText) {
    return;
  }

  state.ui.selectedScheduleDate = dateText;
  state.ui.scheduleCalendarMonth = dateText.slice(0, 7);
  state.ui.selectedScheduleDeleteKeys = [];
}

function resetScheduleForm() {
  const selectedDate = state.ui.selectedScheduleDate || formatLocalDate(new Date());

  elements.scheduleForm.reset();
  elements.scheduleForm.date.value = selectedDate;
  elements.scheduleForm.endDate.value = selectedDate;
  syncTimeWheelField(elements.scheduleForm.startTime, "09:00");
  syncTimeWheelField(elements.scheduleForm.endTime, "18:00");
  state.ui.editingScheduleKey = "";
  state.ui.editingScheduleIsWorking = true;
  elements.scheduleEditTimePanel.classList.add("is-hidden");
  elements.scheduleEditModeLabel.textContent = "編輯這筆班表的臨時上下班時間";
  elements.scheduleTechnicianField?.classList.remove("is-hidden");
  syncScheduleTechnicianSelection([]);
}

function fillScheduleForm(schedule) {
  if (!schedule) {
    resetScheduleForm();
    return;
  }

  elements.scheduleForm.date.value = schedule.date;
  elements.scheduleForm.endDate.value = schedule.date;
  syncTimeWheelField(elements.scheduleForm.startTime, schedule.startTime);
  syncTimeWheelField(elements.scheduleForm.endTime, schedule.endTime);
  state.ui.editingScheduleKey = `${schedule.date}::${schedule.technicianId}`;
  state.ui.editingScheduleIsWorking = Boolean(schedule.isWorking);
  elements.scheduleEditTimePanel.classList.remove("is-hidden");
  elements.scheduleEditModeLabel.textContent = `正在編輯 ${getTechnicianById(schedule.technicianId)?.name || schedule.technicianId} 的班表時段`;
  elements.scheduleTechnicianField?.classList.add("is-hidden");
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
    const matchesReviewStatus = state.filters.technicianReviewStatus === "all"
      || item.status === state.filters.technicianReviewStatus;

    return matchesTechnician && matchesStatus && matchesReviewStatus;
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
    // 當選擇「現場安排」時，送出空的 technicianId 以移除指定技師關聯
    return {
      technicianId: "",
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
  elements.serviceEditMode.textContent = "編輯模式";
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

function getScheduleEntryKey(schedule) {
  return `${schedule.date}::${schedule.technicianId}`;
}

function parseScheduleEntryKey(key) {
  const [date, technicianId] = String(key || "").split("::");
  return {
    date: String(date || "").trim(),
    technicianId: String(technicianId || "").trim(),
  };
}

function getSelectedScheduleDeleteKeys() {
  return Array.isArray(state.ui.selectedScheduleDeleteKeys) ? state.ui.selectedScheduleDeleteKeys.slice() : [];
}

function setSelectedScheduleDeleteKeys(keys = []) {
  state.ui.selectedScheduleDeleteKeys = Array.from(
    new Set(
      (keys || [])
        .map((key) => String(key || "").trim())
        .filter(Boolean)
    )
  );
}

function getSelectableScheduleEntries(dateText = state.ui.selectedScheduleDate) {
  return getSchedulesCoveringDate(dateText);
}

function syncScheduleEntrySelection(availableSchedules = getSelectableScheduleEntries()) {
  const availableKeys = new Set(availableSchedules.map((schedule) => getScheduleEntryKey(schedule)));
  const nextKeys = getSelectedScheduleDeleteKeys().filter((key) => availableKeys.has(key));
  setSelectedScheduleDeleteKeys(nextKeys);
  updateScheduleBatchSelectionMeta(availableSchedules);
}

function updateScheduleBatchSelectionMeta(availableSchedules = getSelectableScheduleEntries()) {
  if (!elements.scheduleBatchSelectionMeta) {
    return;
  }

  const totalCount = availableSchedules.length;
  const selectedCount = getSelectedScheduleDeleteKeys().length;

  if (!totalCount) {
    elements.scheduleBatchSelectionMeta.textContent = "當天沒有可批量移除的班表";
  } else if (!selectedCount) {
    elements.scheduleBatchSelectionMeta.textContent = `尚未選取班表，共 ${totalCount} 筆`;
  } else {
    elements.scheduleBatchSelectionMeta.textContent = `已選取 ${selectedCount} / ${totalCount} 筆班表`;
  }

  if (elements.scheduleBatchDeleteButton) {
    elements.scheduleBatchDeleteButton.disabled = selectedCount === 0;
  }
  if (elements.scheduleSelectAllEntriesButton) {
    elements.scheduleSelectAllEntriesButton.disabled = totalCount === 0;
  }
  if (elements.scheduleClearEntriesButton) {
    elements.scheduleClearEntriesButton.disabled = totalCount === 0 || selectedCount === 0;
  }
}

function setScheduleEntrySelection(checkedState) {
  const schedules = getSelectableScheduleEntries();
  const nextKeys = checkedState ? schedules.map((schedule) => getScheduleEntryKey(schedule)) : [];
  setSelectedScheduleDeleteKeys(nextKeys);
  renderSelectedScheduleDetail();
  return schedules.length;
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
        <section class="bulk-service-category card border shadow-sm">
          <div class="card-body p-3">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
              <h4 class="service-category-title mb-0">${escapeHtml(category)}</h4>
              <span class="badge rounded-pill text-bg-secondary">${services.length} 項</span>
            </div>
            <div class="bulk-service-category__grid row g-2">
              ${services
                .map((service) => {
                  const durationMinutes = Number(service.durationMinutes || 0);
                  const price = Number(service.price || 0).toLocaleString("zh-TW");

                  return `
                    <div class="col-12 col-xxl-6">
                      <label class="bulk-service-option card h-100 border-0 shadow-sm">
                        <div class="card-body p-3">
                          <div class="form-check m-0 d-flex align-items-start gap-2">
                            <input class="form-check-input mt-1" type="checkbox" name="serviceIds" value="${escapeHtml(service.serviceId)}" ${
                              checked.has(service.serviceId) ? "checked" : ""
                            } />
                            <span class="bulk-service-option__content">
                              <strong>${escapeHtml(service.name)}</strong>
                              <span class="bulk-service-option__meta">
                                <span class="bulk-service-option__badge">${durationMinutes} 分鐘</span>
                                <span class="bulk-service-option__badge">NT$ ${price}</span>
                              </span>
                            </span>
                          </div>
                        </div>
                      </label>
                    </div>
                  `;
                })
                .join("")}
            </div>
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
  syncTimeWheelField(elements.reservationForm.startTime, elements.reservationForm.startTime.value || "09:00");
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
  const confirmedReservations = state.reservations.filter((item) => item.technicianConfirmedAt).length;
  const completedReservations = state.reservations.filter((item) => item.status === "已完成").length;
  const cancelledReservations = state.reservations.filter((item) => item.status === "已取消").length;

  elements.technicianStat.textContent = String(state.technicians.length);
  elements.technicianMeta.textContent = `${activeTechnicians} 位啟用中`;
  elements.serviceStat.textContent = String(state.services.length);
  elements.serviceMeta.textContent = `${activeServices} 項啟用中`;
  elements.scheduleStat.textContent = String(state.schedules.length);
  elements.scheduleMeta.textContent = `${workingSchedules} 筆可預約`;
  elements.reservationStat.textContent = String(state.reservations.length);
  elements.reservationMeta.textContent = `已預約 ${bookedReservations} / 技師已確認 ${confirmedReservations} / 已完成 ${completedReservations} / 已取消 ${cancelledReservations}`;

  if (elements.adminStat) {
    const approvedAdmins = state.adminUsers.filter((item) => item.status === "已通過").length;
    elements.adminStat.textContent = String(state.adminUsers.length);
    elements.adminMeta.textContent = `${approvedAdmins} 位已通過`;
  }
}

function getStatusPill(label, tone) {
  return `<span class="status-pill status-pill--${tone}">${label}</span>`;
}

function getStatusDescriptor(label, tone) {
  return { label, tone };
}

function getActiveStatusDescriptor(isActive) {
  return isActive ? getStatusDescriptor("啟用", "active") : getStatusDescriptor("停用", "inactive");
}

function getScheduleStatusDescriptor(isWorking) {
  return isWorking ? getStatusDescriptor("可預約", "working") : getStatusDescriptor("休假", "off");
}

function getLeaveRequestStatusDescriptor(status) {
  if (status === "已通過") {
    return getStatusDescriptor(status, "approved");
  }
  if (status === "已拒絕") {
    return getStatusDescriptor(status, "rejected");
  }
  if (status === "已取消") {
    return getStatusDescriptor(status, "cancelled");
  }

  return getStatusDescriptor(status || "待審核", "pending");
}

function getReservationStatusDescriptor(status) {
  if (status === "已完成") {
    return getStatusDescriptor(status, "completed");
  }
  if (status === "已取消") {
    return getStatusDescriptor(status, "cancelled");
  }

  return getStatusDescriptor(status || "已預約", "booked");
}

function getUserStatusDescriptor(status) {
  if (status === "未送審核") {
    return getStatusDescriptor(status, "draft");
  }
  if (status === "已通過") {
    return getStatusDescriptor(status, "approved");
  }
  if (status === "已拒絕") {
    return getStatusDescriptor(status, "rejected");
  }
  if (status === "已停用") {
    return getStatusDescriptor(status, "disabled");
  }

  return getStatusDescriptor(status || "待審核", "pending");
}

function getTechnicianReviewStatusDescriptor(status) {
  if (status === "未綁定") {
    return getStatusDescriptor(status, "draft");
  }
  if (status === "已通過") {
    return getStatusDescriptor(status, "approved");
  }
  if (status === "已拒絕") {
    return getStatusDescriptor(status, "rejected");
  }
  if (status === "已停用") {
    return getStatusDescriptor(status, "disabled");
  }

  return getStatusDescriptor(status || "待審核", "pending");
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

function getReservationTechnicianConfirmationDescriptor(reservation) {
  if (reservation?.technicianConfirmedAt) {
    return {
      label: "已確認",
      tone: "approved",
      detail: formatDateTimeText(reservation.technicianConfirmedAt),
    };
  }

  return {
    label: "待確認",
    tone: "pending",
    detail: "技師尚未確認",
  };
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
  const pendingLeaveRequests = state.leaveRequests.filter((item) => item.status === "待審核").length;

  if (elements.workflowSummary) {
    elements.workflowSummary.textContent = `${activeTechnicians} 位啟用技師、${activeServices} 項啟用服務、${pendingReservations} 筆待處理預約、${pendingUsers} 位待審核用戶、${pendingTechnicians} 位待審核技師、${pendingLeaveRequests} 筆待審核休假`;
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

  if (pendingLeaveRequests) {
    elements.workflowHint.textContent = `目前有 ${pendingLeaveRequests} 筆休假申請待審核，通過後會直接同步到班表。`;
    return;
  }

  if (pendingReservations) {
    elements.workflowHint.textContent = `建議優先檢查 ${pendingReservations} 筆已預約紀錄的時段與狀態。`;
    return;
  }

  elements.workflowHint.textContent = "資料狀態完整，可持續維護服務、班表與預約。";
}

function mountFrameworkApps() {
  if (!frameworkEnabled || frameworkMounted) {
    return;
  }

  if (elements.serviceTable) {
    createApp({
      setup() {
        return frameworkView.service;
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <table v-else class="list-table">
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
              <tr v-for="row in rows" :key="row.serviceId">
                <td data-label="名稱">{{ row.name }}</td>
                <td data-label="類別">{{ row.category }}</td>
                <td data-label="時長">{{ row.durationLabel }}</td>
                <td data-label="價格">{{ row.priceLabel }}</td>
                <td data-label="狀態">
                  <span class="status-pill" :class="'status-pill--' + row.status.tone">{{ row.status.label }}</span>
                </td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions">
                    <button type="button" class="button button--ghost" :data-edit-service="row.serviceId">編輯</button>
                    <button type="button" class="button button--danger" :data-delete-service="row.serviceId" :data-service-name="row.name">刪除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
    }).mount(elements.serviceTable);
  }

  if (elements.technicianReviewSummary) {
    createApp({
      setup() {
        return frameworkView.technicianReview;
      },
      template: `
        <div v-cloak>
          <article class="review-card" data-filter-review-status="未綁定" role="button" tabindex="0" title="點擊篩選未綁定技師">
            <span>未綁定</span>
            <strong>{{ summary.unlinkedCount }}</strong>
            <small>尚未有技師完成 technician 頁面的 LINE 登入</small>
          </article>
          <article class="review-card" data-filter-review-status="待審核" role="button" tabindex="0" title="點擊篩選待審核技師">
            <span>待審核</span>
            <strong>{{ summary.pendingCount }}</strong>
            <small>已登入 LINE，等待 admin 審核通過</small>
          </article>
          <article class="review-card" data-filter-review-status="已通過" role="button" tabindex="0" title="點擊篩選已通過技師">
            <span>已通過</span>
            <strong>{{ summary.approvedCount }}</strong>
            <small>可進入 technician 頁面查看自己的資料</small>
          </article>
          <article class="review-card" data-filter-review-status="已拒絕" role="button" tabindex="0" title="點擊篩選已拒絕/已停用技師">
            <span>已拒絕 / 已停用</span>
            <strong>{{ summary.blockedCount }}</strong>
            <small>登入後會被阻擋，需重新調整狀態</small>
          </article>
        </div>
      `,
    }).mount(elements.technicianReviewSummary);
  }

  if (elements.technicianReviewTable) {
    createApp({
      setup() {
        return frameworkView.technicianReview;
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <table v-else class="list-table">
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
              <tr v-for="row in rows" :key="row.technicianId">
                <td data-label="技師">
                  <div class="user-cell__meta">
                    <strong>{{ row.name }}</strong>
                    <small>{{ row.technicianId }}</small>
                  </div>
                </td>
                <td data-label="LINE 帳號">
                  <div v-if="row.lineUserId" class="user-cell">
                    <img v-if="row.pictureUrl" class="user-avatar" :src="row.pictureUrl" :alt="row.lineDisplayName" />
                    <div v-else class="user-avatar user-avatar--placeholder">{{ row.lineInitial }}</div>
                    <div class="user-cell__meta">
                      <strong>{{ row.lineDisplayName }}</strong>
                      <small>{{ row.lineUserId }}</small>
                    </div>
                  </div>
                  <span v-else class="helper-text">尚未登入 technician 頁面</span>
                </td>
                <td data-label="服務 / 班別">
                  <div class="review-service-cell">
                    <span class="review-service-cell__names" :title="row.serviceLabel">{{ row.serviceLabel || '尚未綁定服務' }}</span>
                    <span class="review-service-cell__meta">{{ row.scheduleMeta }}</span>
                  </div>
                </td>
                <td data-label="技師狀態">
                  <span class="status-pill" :class="'status-pill--' + row.status.tone">{{ row.status.label }}</span>
                </td>
                <td data-label="最後登入">{{ row.lastLoginAtText }}</td>
                <td data-label="備註">
                  <span v-if="row.note">{{ row.note }}</span>
                  <span v-else class="helper-text">尚無備註</span>
                </td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions stacked-actions">
                    <button type="button" class="button button--ghost" :data-focus-technician="row.technicianId">前往設定</button>
                    <select class="table-actions__select" v-bind:data-review-technician-select="row.technicianId" v-bind:value="row.status.label" :disabled="!row.canReview">
                      <option value="已通過">已通過</option>
                      <option value="待審核">待審核</option>
                      <option value="已拒絕">已拒絕</option>
                      <option value="已停用">已停用</option>
                    </select>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
    }).mount(elements.technicianReviewTable);
  }

  if (elements.scheduleCalendarGrid) {
    createApp({
      setup() {
        return frameworkView.schedule;
      },
      template: `
        <template v-for="cell in days" :key="cell.key">
          <div v-if="cell.isEmpty" class="schedule-day--empty" aria-hidden="true"></div>
          <div v-else :class="cell.classes">
            <button type="button" class="schedule-day__button" :data-schedule-date="cell.dateText">
              <span class="schedule-day__number">{{ cell.day }}</span>
              <span class="schedule-day__summary">{{ cell.compactStatus }}</span>
              <span class="schedule-day__meta">
                <span class="schedule-day__count">{{ cell.countLabel }}</span>
                <span class="schedule-day__status">{{ cell.statusLabel }}</span>
              </span>
            </button>
          </div>
        </template>
      `,
    }).mount(elements.scheduleCalendarGrid);
  }

  if (elements.scheduleTable) {
    createApp({
      setup() {
        return frameworkView.schedule;
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <template v-else>
            <article v-for="entry in entries" :key="entry.key" class="schedule-entry">
              <div class="schedule-entry__top">
                <div class="schedule-entry__select">
                  <input
                    type="checkbox"
                    class="schedule-entry__checkbox"
                    :data-schedule-select="entry.key"
                    :checked="entry.selected"
                    :aria-label="'選取 ' + entry.technicianName + ' 的班表'"
                  />
                  <div class="schedule-entry__title">
                    <strong>{{ entry.technicianName }}</strong>
                    <span class="schedule-entry__time">{{ entry.timeLabel }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="'status-pill--' + entry.status.tone">{{ entry.status.label }}</span>
              </div>
              <div class="table-actions">
                <button type="button" class="button button--ghost" :data-edit-schedule="entry.key">編輯這筆班表</button>
                <button type="button" class="button button--danger" :data-delete-schedule="entry.key" :data-technician-name="entry.technicianName">刪除這筆班表</button>
              </div>
            </article>
          </template>
        </div>
      `,
    }).mount(elements.scheduleTable);
  }

  if (elements.leaveRequestSummary) {
    createApp({
      setup() {
        return frameworkView.leaveRequest;
      },
      template: `
        <div v-cloak>
          <article class="review-card">
            <span>待審核</span>
            <strong>{{ summary.pendingCount }}</strong>
            <small>等待 admin 審核後才會寫入班表</small>
          </article>
          <article class="review-card">
            <span>已通過</span>
            <strong>{{ summary.approvedCount }}</strong>
            <small>已同步進入班表日曆</small>
          </article>
          <article class="review-card">
            <span>已拒絕</span>
            <strong>{{ summary.rejectedCount }}</strong>
            <small>技師可重新送出新的休假申請</small>
          </article>
          <article class="review-card">
            <span>已取消</span>
            <strong>{{ summary.cancelledCount }}</strong>
            <small>技師在審核前自行取消</small>
          </article>
        </div>
      `,
    }).mount(elements.leaveRequestSummary);
  }

  if (elements.leaveRequestTable) {
    createApp({
      setup() {
        return frameworkView.leaveRequest;
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <table v-else class="list-table">
            <thead>
              <tr>
                <th>技師</th>
                <th>日期</th>
                <th>原因</th>
                <th>狀態</th>
                <th>送出時間</th>
                <th>審核備註</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.leaveRequestId">
                <td data-label="技師">
                  <div class="user-cell__meta">
                    <strong>{{ row.technicianName }}</strong>
                    <small>{{ row.technicianId }}</small>
                  </div>
                </td>
                <td data-label="日期">{{ row.dateLabel }}</td>
                <td data-label="原因">{{ row.reason || '未填寫' }}</td>
                <td data-label="狀態">
                  <span class="status-pill" :class="'status-pill--' + row.status.tone">{{ row.status.label }}</span>
                </td>
                <td data-label="送出時間">{{ row.createdAtText }}</td>
                <td data-label="審核備註">{{ row.reviewNote || '尚無備註' }}</td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions stacked-actions">
                    <select class="table-actions__select" :data-leave-request-status-select="row.leaveRequestId" :value="row.statusValue">
                      <option value="待審核">待審核</option>
                      <option value="已通過">已通過</option>
                      <option value="已拒絕">已拒絕</option>
                      <option value="已取消">已取消</option>
                    </select>
                    <button type="button" class="button button--ghost" :data-save-leave-request-status="row.leaveRequestId">更新狀態</button>
                    <button type="button" class="button button--danger" :data-delete-leave-request="row.leaveRequestId">刪除休假</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
    }).mount(elements.leaveRequestTable);
  }

  if (elements.reservationTable) {
    createApp({
      setup() {
        return frameworkView.reservation;
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <table v-else class="list-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>時段</th>
                <th>客人</th>
                <th>電話</th>
                <th>技師</th>
                <th>服務</th>
                <th>狀態</th>
                <th>技師確認</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.reservationId">
                <td data-label="日期">{{ row.date }}</td>
                <td data-label="時段">{{ row.timeLabel }}</td>
                <td data-label="客人">{{ row.customerName }}</td>
                <td data-label="電話">{{ row.phone }}</td>
                <td data-label="技師">{{ row.technicianLabel }}</td>
                <td data-label="服務">{{ row.serviceLabel }}</td>
                <td data-label="狀態">
                  <span class="status-pill" :class="'status-pill--' + row.status.tone">{{ row.status.label }}</span>
                </td>
                <td data-label="技師確認">
                  <div class="table-status-stack">
                    <span class="status-pill" :class="'status-pill--' + row.confirmation.tone">{{ row.confirmation.label }}</span>
                    <small>{{ row.confirmation.detail }}</small>
                  </div>
                </td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions">
                    <button type="button" class="button button--ghost" :data-edit-reservation="row.reservationId">編輯</button>
                    <button type="button" class="button button--danger" :data-delete-reservation="row.reservationId" :data-customer-name="row.customerName">刪除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
    }).mount(elements.reservationTable);
  }

  if (elements.userReviewSummary) {
    createApp({
      setup() {
        return frameworkView.userReview;
      },
      template: `
        <div v-cloak>
          <article class="review-card">
            <span>未送審核</span>
            <strong>{{ summary.draftCount }}</strong>
            <small>已登入 LINE，但尚未填寫稱呼與電話</small>
          </article>
          <article class="review-card">
            <span>待審核</span>
            <strong>{{ summary.pendingCount }}</strong>
            <small>已送出完整申請，等待管理員審核</small>
          </article>
          <article class="review-card">
            <span>已通過</span>
            <strong>{{ summary.approvedCount }}</strong>
            <small>可直接在前台送出預約</small>
          </article>
          <article class="review-card">
            <span>已拒絕 / 已停用</span>
            <strong>{{ summary.blockedCount }}</strong>
            <small>拒絕或停用後，前台送單會被阻擋</small>
          </article>
        </div>
      `,
    }).mount(elements.userReviewSummary);
  }

  if (elements.userTable) {
    createApp({
      setup() {
        return frameworkView.userReview;
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <table v-else class="list-table">
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
              <tr v-for="row in rows" :key="row.userId">
                <td data-label="用戶">
                  <div class="user-cell">
                    <img v-if="row.pictureUrl" class="user-avatar" :src="row.pictureUrl" :alt="row.displayName" />
                    <div v-else class="user-avatar user-avatar--placeholder">{{ row.initial }}</div>
                    <div class="user-cell__meta">
                      <strong>{{ row.displayName }}</strong>
                      <small>{{ row.userId }}</small>
                    </div>
                  </div>
                </td>
                <td data-label="稱呼">
                  <span v-if="row.customerName">{{ row.customerName }}</span>
                  <span v-else class="helper-text">尚未填寫</span>
                </td>
                <td data-label="電話">
                  <span v-if="row.phone">{{ row.phone }}</span>
                  <span v-else class="helper-text">尚未填寫</span>
                </td>
                <td data-label="狀態">
                  <span class="status-pill" :class="'status-pill--' + row.status.tone">{{ row.status.label }}</span>
                </td>
                <td data-label="最後登入">{{ row.lastLoginAtText }}</td>
                <td data-label="備註">
                  <span v-if="row.note">{{ row.note }}</span>
                  <span v-else class="helper-text">尚無備註</span>
                </td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions stacked-actions">
                    <button type="button" class="button button--ghost" :data-review-user="row.userId" data-review-status="已通過">通過</button>
                    <button type="button" class="button button--secondary" :data-review-user="row.userId" data-review-status="待審核">設待審核</button>
                    <button type="button" class="button button--secondary" :data-review-user="row.userId" data-review-status="已拒絕">拒絕</button>
                    <button type="button" class="button button--danger" :data-review-user="row.userId" data-review-status="已停用">停用</button>
                    <button type="button" class="button button--danger" :data-delete-user="row.userId" :data-user-name="row.displayName">刪除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `,
    }).mount(elements.userTable);
  }

  if (elements.adminManagementSummary) {
    createApp({
      setup() {
        return frameworkView.adminManagement;
      },
      template: `
        <div v-cloak>
          <article class="review-card">
            <span>全部管理員</span>
            <strong>{{ summary.totalCount }}</strong>
            <small>所有已登入的管理員帳號</small>
          </article>
          <article class="review-card">
            <span>已通過</span>
            <strong>{{ summary.approvedCount }}</strong>
            <small>可使用 admin 後台</small>
          </article>
          <article class="review-card">
            <span>待審核</span>
            <strong>{{ summary.pendingCount }}</strong>
            <small>等待審核中</small>
          </article>
          <article class="review-card">
            <span>可管理管理員</span>
            <strong>{{ summary.canManageCount }}</strong>
            <small>擁有管理員修改權限</small>
          </article>
        </div>
      `,
    }).mount(elements.adminManagementSummary);
  }

  if (elements.adminManagementTable) {
    createApp({
      setup() {
        return frameworkView.adminManagement;
      },
      methods: {
        pageOptions() {
          return ADMIN_PAGE_OPTIONS;
        },
      },
      template: `
        <div v-cloak>
          <div v-if="emptyMessage" class="empty-state">{{ emptyMessage }}</div>
          <div v-else class="admin-mgmt-list">
            <article v-for="row in rows" :key="row.userId" class="admin-mgmt-card" :data-admin-mgmt-card="row.userId">
              <header class="admin-mgmt-card__header">
                <div class="user-cell">
                  <img v-if="row.pictureUrl" class="user-avatar" :src="row.pictureUrl" :alt="row.displayName" />
                  <div v-else class="user-avatar user-avatar--placeholder">{{ row.initial }}</div>
                  <div class="user-cell__meta">
                    <strong>{{ row.displayName }}</strong>
                    <small>{{ row.userId }}</small>
                  </div>
                </div>
                <div class="admin-mgmt-card__pills">
                  <span class="status-pill" :class="'status-pill--' + row.status.tone">{{ row.status.label }}</span>
                  <span v-if="row.canManageAdmins" class="status-pill status-pill--active">可管理管理員</span>
                  <span v-else class="status-pill status-pill--inactive">僅一般 admin</span>
                  <span v-if="row.isCurrentUser" class="status-pill status-pill--active">目前登入</span>
                </div>
              </header>
              <div class="admin-mgmt-card__body">
                <div class="admin-mgmt-card__info">
                  <div><span class="text-body-secondary">頁面權限：</span>{{ row.pagePermissionLabels }}</div>
                  <div><span class="text-body-secondary">最後登入：</span>{{ row.lastLoginAtText }}</div>
                  <div v-if="row.note"><span class="text-body-secondary">備註：</span>{{ row.note }}</div>
                </div>
                <details class="admin-mgmt-card__details">
                  <summary class="button button--secondary button--compact">頁面權限設定</summary>
                  <div class="admin-mgmt-card__page-editor">
                    <label v-for="opt in pageOptions()" :key="opt.key" class="permission-checkbox-inline">
                      <input type="checkbox" data-admin-page-checkbox :value="opt.key" :checked="row.pagePermissionLabels.includes(opt.label)" />
                      <span>{{ opt.label }}</span>
                    </label>
                    <button type="button" class="button button--primary button--compact" :data-save-admin-pages="row.userId">儲存頁面權限</button>
                  </div>
                </details>
              </div>
              <footer class="admin-mgmt-card__actions">
                <div class="table-actions stacked-actions">
                  <button type="button" class="button button--ghost" :data-review-admin="row.userId" data-review-status="已通過">通過</button>
                  <button type="button" class="button button--secondary button--compact" :data-review-admin="row.userId" data-review-status="待審核">設待審核</button>
                  <button type="button" class="button button--secondary button--compact" :data-review-admin="row.userId" data-review-status="已拒絕">拒絕</button>
                  <button type="button" class="button button--danger button--compact" :data-review-admin="row.userId" data-review-status="已停用">停用</button>
                </div>
                <div class="table-actions">
                  <button v-if="!row.canManageAdmins" type="button" class="button button--primary button--compact" :data-toggle-admin-permission="row.userId" data-can-manage-admins="true">授予修改權限</button>
                  <button v-else type="button" class="button button--danger button--compact" :data-toggle-admin-permission="row.userId" data-can-manage-admins="false">收回修改權限</button>
                  <button v-if="!row.isCurrentUser" type="button" class="button button--danger button--compact" :data-delete-admin="row.userId">刪除管理員</button>
                  <span v-else class="helper-text">目前登入帳號不可刪除</span>
                </div>
              </footer>
            </article>
          </div>
        </div>
      `,
    }).mount(elements.adminManagementTable);
  }

  frameworkMounted = true;
}

function getTechnicianScheduleTimeLabel(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) {
    return "未設定預設時段";
  }

  return `${technician.startTime} - ${technician.endTime}`;
}

function getBulkTechnicianServicesLabel(serviceIds = []) {
  if (!serviceIds.length) {
    return "未綁定服務";
  }

  return serviceIds
    .map((serviceId) => getServiceById(serviceId)?.name || serviceId)
    .join("、");
}

function getBulkTechnicianLineAccountMarkup(technician, technicianName) {
  const lineUserId = technician?.lineUserId || "";
  const lineDisplayName = technician?.profileDisplayName || "";
  const pictureUrl = technician?.pictureUrl || "";
  const lineInitial = escapeHtml((lineDisplayName || technicianName || "T").slice(0, 1));

  if (!lineUserId) {
    return '<div class="bulk-technician-empty">尚未登入 technician 頁面</div>';
  }

  return `
    <div class="user-cell bulk-technician-line-account">
      ${pictureUrl
        ? `<img class="user-avatar" src="${escapeHtml(pictureUrl)}" alt="${escapeHtml(lineDisplayName || technicianName)}" />`
        : `<div class="user-avatar user-avatar--placeholder">${lineInitial}</div>`}
      <div class="user-cell__meta">
        <strong>${escapeHtml(lineDisplayName || technicianName || "未命名 LINE 使用者")}</strong>
        <small>${escapeHtml(lineUserId)}</small>
      </div>
    </div>
  `;
}

function getBulkTechnicianReviewActionsMarkup(technicianId, canReview) {
  if (!technicianId) {
    return `
      <div class="bulk-technician-row-actions d-grid gap-2">
        <div class="bulk-technician-empty">新列需先儲存後才可審核</div>
        <button type="button" class="button button--danger button--compact" data-delete-technician-row>移除此列</button>
      </div>
    `;
  }

  const disabled = canReview ? "" : "disabled";
  return `
    <div class="bulk-technician-row-actions d-grid gap-2">
      <select class="bulk-technician-row-actions__select" data-review-technician-select="${escapeHtml(technicianId)}" ${disabled}>
        <option value="已通過">已通過</option>
        <option value="待審核">待審核</option>
        <option value="已拒絕">已拒絕</option>
        <option value="已停用">已停用</option>
      </select>
      <button type="button" class="button button--danger button--compact" data-delete-technician-row="${escapeHtml(technicianId)}">刪除技師</button>
      <small class="bulk-technician-row-actions__meta" data-bulk-review-meta>尚未調整審核狀態</small>
    </div>
  `;
}

function areArraysEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

const bulkTechnicianModule = {
  getRows() {
    if (!elements.technicianBulkTable) {
      return [];
    }

    return Array.from(elements.technicianBulkTable.querySelectorAll("[data-bulk-technician-row]"));
  },

  getServiceIds(row) {
    const checkboxContainer = row?.querySelector("[data-bulk-service-checkboxes]");
    if (checkboxContainer && checkboxContainer.childElementCount) {
      return getSelectedServiceIdsFromContainer(checkboxContainer);
    }

    return String(row?.dataset.serviceIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  },

  getRowDraft(row) {
    return {
      technicianId: String(row?.dataset.technicianId || "").trim(),
      name: row?.querySelector('input[name="name"]')?.value.trim() || "",
      startTime: row?.querySelector('input[name="startTime"]')?.value || "09:00",
      endTime: row?.querySelector('input[name="endTime"]')?.value || "18:00",
      active: Boolean(row?.querySelector('input[name="active"]')?.checked),
      serviceIds: this.getServiceIds(row),
      status: String(row?.dataset.reviewStatus || "未綁定"),
      note: String(row?.dataset.reviewNote || "").trim(),
    };
  },

  getOriginalRowDraft(row) {
    return {
      technicianId: String(row?.dataset.originalTechnicianId || "").trim(),
      name: String(row?.dataset.originalName || ""),
      startTime: String(row?.dataset.originalStartTime || "09:00"),
      endTime: String(row?.dataset.originalEndTime || "18:00"),
      active: String(row?.dataset.originalActive || "true") === "true",
      serviceIds: String(row?.dataset.originalServiceIds || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      status: String(row?.dataset.originalReviewStatus || "未綁定"),
      note: String(row?.dataset.originalReviewNote || "").trim(),
    };
  },

  isRowDirty(row) {
    const current = this.getRowDraft(row);
    const original = this.getOriginalRowDraft(row);

    return current.name !== original.name
      || current.startTime !== original.startTime
      || current.endTime !== original.endTime
      || current.active !== original.active
      || current.status !== original.status
      || current.note !== original.note
      || !areArraysEqual(current.serviceIds, original.serviceIds);
  },

  syncRowDirtyState(row) {
    if (!row) {
      return false;
    }

    const dirty = this.isRowDirty(row);
    row.dataset.rowState = dirty ? "dirty" : "clean";
    return dirty;
  },

  syncRowStatusPanel(row) {
    if (!row) {
      return;
    }

    const pills = row.querySelector('.bulk-technician-status-panel__pills');
    const active = Boolean(row.querySelector('input[name="active"]')?.checked);
    const reviewStatus = String(row.dataset.reviewStatus || "未綁定");
    if (pills) {
      pills.innerHTML = `${getTechnicianReviewStatusPill(reviewStatus)}${getActiveStatusPill(active)}`;
    }
  },

  syncRowNote(row) {
    if (!row) {
      return;
    }

    const noteContainer = row.querySelector('[data-bulk-note]');
    const note = String(row.dataset.reviewNote || "").trim();
    if (noteContainer) {
      noteContainer.innerHTML = note ? escapeHtml(note) : '<span class="helper-text">尚無備註</span>';
    }
  },

  syncRowReviewMeta(row) {
    if (!row) {
      return;
    }

    const meta = row.querySelector('[data-bulk-review-meta]');
    if (!meta) {
      return;
    }

    const dirty = this.isRowDirty(row);
    const currentStatus = String(row.dataset.reviewStatus || "未綁定");
    const currentNote = String(row.dataset.reviewNote || "").trim();
    const originalStatus = String(row.dataset.originalReviewStatus || "未綁定");
    const originalNote = String(row.dataset.originalReviewNote || "").trim();
    const reviewChanged = currentStatus !== originalStatus || currentNote !== originalNote;

    if (!dirty) {
      meta.textContent = "尚未調整審核狀態";
      return;
    }

    if (reviewChanged) {
      meta.textContent = currentNote ? `待儲存：${currentStatus} / 已更新備註` : `待儲存：${currentStatus}`;
      return;
    }

    meta.textContent = "此列尚有未儲存變更";
  },

  syncRowReviewSelect(row) {
    if (!row) {
      return;
    }

    const select = row.querySelector('[data-review-technician-select]');
    if (select) {
      select.value = String(row.dataset.reviewStatus || "待審核");
    }
  },

  syncRowUi(row) {
    this.syncServiceSummary(row);
    this.syncRowStatusPanel(row);
    this.syncRowNote(row);
    this.syncRowReviewSelect(row);
    this.syncRowReviewMeta(row);
    this.syncRowDirtyState(row);
  },

  getDirtyRows() {
    return this.getRows().filter((row) => this.isRowDirty(row));
  },

  refreshDraftState() {
    this.getRows().forEach((row) => this.syncRowUi(row));
    this.updateSelectionMeta();
  },

  updateActionButtons() {
    const dirtyCount = this.getDirtyRows().length;

    if (elements.technicianBulkSaveButton) {
      elements.technicianBulkSaveButton.disabled = dirtyCount === 0;
    }
    if (elements.technicianStickySaveButton) {
      elements.technicianStickySaveButton.disabled = dirtyCount === 0;
    }
  },

  getServiceCategoryOptions(selectedValue = "") {
    const normalizedValue = String(selectedValue || "");
    return [
      '<option value="">全部分類</option>',
      ...getServiceCategoryOptions().map(
        (category) =>
          `<option value="${escapeHtml(category)}" ${normalizedValue === category ? "selected" : ""}>${escapeHtml(category)}</option>`
      ),
    ].join("");
  },

  syncServiceSummary(row) {
    if (!row) {
      return;
    }

    const serviceIds = this.getServiceIds(row);
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
  },

  renderServiceEditor(row) {
    if (!row) {
      return;
    }

    const container = row.querySelector("[data-bulk-service-checkboxes]");
    const categorySelect = row.querySelector("[data-bulk-service-category]");
    if (!container || !categorySelect) {
      return;
    }

    const selectedIds = this.getServiceIds(row);
    renderServiceSelectionCheckboxes(container, selectedIds, categorySelect.value || "");
    this.syncServiceSummary(row);
  },

  createRowMarkup(technician = null) {
    const technicianId = technician?.technicianId || "";
    const serviceIds = technician?.serviceIds || [];
    const serviceLabel = getBulkTechnicianServicesLabel(serviceIds);
    const serviceSummary = serviceIds.length ? `${serviceIds.length} 項服務` : "未綁定服務";
    const lineName = technician?.profileDisplayName || "";
    const technicianName = technician?.name || "";
    const startTime = technician?.startTime || "09:00";
    const endTime = technician?.endTime || "18:00";
    const reviewStatus = technician?.status || "未綁定";
    const active = technician?.active !== false;
    const lastLoginAtText = formatDateTimeText(technician?.lastLoginAt);
    const note = technician?.note || "";
    const canReview = Boolean(technician?.lineUserId && technicianId);

    return `
      <tr
        data-bulk-technician-row
        data-technician-id="${escapeHtml(technicianId)}"
        data-service-ids="${escapeHtml(serviceIds.join(","))}"
        data-review-status="${escapeHtml(reviewStatus)}"
        data-review-note="${escapeHtml(note)}"
        data-original-technician-id="${escapeHtml(technicianId)}"
        data-original-name="${escapeHtml(technicianName)}"
        data-original-start-time="${escapeHtml(startTime)}"
        data-original-end-time="${escapeHtml(endTime)}"
        data-original-active="${active ? "true" : "false"}"
        data-original-service-ids="${escapeHtml(serviceIds.join(","))}"
        data-original-review-status="${escapeHtml(reviewStatus)}"
        data-original-review-note="${escapeHtml(note)}"
        data-row-state="clean"
      >
        <td data-label="技師" class="bulk-technician-table__cell bulk-technician-table__cell--identity">
          <div class="bulk-technician-profile">
            <div class="bulk-technician-profile__body">
              <div class="bulk-technician-profile__meta">
                <span class="bulk-technician-profile__label">技師名稱</span>
                <small>${escapeHtml(technicianId || "新列")}</small>
              </div>
              <input type="text" name="name" value="${escapeHtml(technicianName)}" placeholder="輸入技師名稱" />
            </div>
          </div>
        </td>
        <td data-label="LINE 帳號" class="bulk-technician-table__cell bulk-technician-table__cell--line">
          ${getBulkTechnicianLineAccountMarkup(technician, technicianName || lineName)}
        </td>
        <td data-label="服務 / 班別" class="bulk-technician-table__cell bulk-technician-table__cell--services">
          <div class="shift-service-cell">
            <div class="shift-service-cell__time">
              <span class="shift-service-cell__time-label">預設班別</span>
              <div class="shift-service-cell__time-row">
                <div class="time-wheel-field time-wheel-field--compact shift-service-cell__time-picker">
                  <input type="hidden" name="startTime" value="${escapeHtml(startTime)}" />
                  <button type="button" class="time-wheel-trigger time-wheel-trigger--inline" data-time-wheel-trigger>${escapeHtml(startTime)}</button>
                </div>
                <span class="shift-service-cell__time-sep">–</span>
                <div class="time-wheel-field time-wheel-field--compact shift-service-cell__time-picker">
                  <input type="hidden" name="endTime" value="${escapeHtml(endTime)}" />
                  <button type="button" class="time-wheel-trigger time-wheel-trigger--inline" data-time-wheel-trigger>${escapeHtml(endTime)}</button>
                </div>
              </div>
            </div>
            <div class="shift-service-cell__services">
              <div class="shift-service-cell__summary">
                <span class="shift-service-cell__count" data-bulk-service-summary>${serviceSummary}</span>
                <span class="shift-service-cell__names" data-bulk-service-label title="${escapeHtml(serviceLabel)}">${escapeHtml(serviceLabel || '點擊下方編輯綁定服務')}</span>
              </div>
              <button type="button" class="shift-service-cell__edit-btn" data-toggle-service-editor>
                <i class="bi bi-pencil-square"></i> 編輯服務
              </button>
            </div>
            <div class="shift-service-cell__editor" data-bulk-service-editor>
              <div class="shift-service-cell__editor-head">
                <div class="shift-service-cell__editor-filter">
                  <label class="shift-service-cell__editor-label">服務分類</label>
                  <select data-bulk-service-category>
                    ${this.getServiceCategoryOptions()}
                  </select>
                </div>
                <div class="shift-service-cell__editor-actions">
                  <button type="button" class="shift-service-cell__editor-btn" data-bulk-select-visible-services>全選</button>
                  <button type="button" class="shift-service-cell__editor-btn" data-bulk-clear-visible-services>清除</button>
                </div>
              </div>
              <div class="shift-service-cell__editor-grid" data-bulk-service-checkboxes></div>
            </div>
          </div>
        </td>
        <td data-label="技師狀態" class="bulk-technician-table__cell bulk-technician-table__cell--status">
          <div class="bulk-technician-status-panel">
            <div class="bulk-technician-status-panel__pills">
              ${getTechnicianReviewStatusPill(reviewStatus)}
              ${getActiveStatusPill(active)}
            </div>
            <label class="checkbox-field checkbox-field--compact bulk-technician-status-panel__toggle">
              <input type="checkbox" name="active" ${active ? "checked" : ""} />
              <span>${active ? "目前啟用" : "目前停用"}</span>
            </label>
          </div>
        </td>
        <td data-label="最後登入" class="bulk-technician-table__cell bulk-technician-table__cell--login">
          <div class="bulk-technician-meta-card">
            <strong>${escapeHtml(lastLoginAtText)}</strong>
            <small>${escapeHtml(lineName || "尚未綁定 LINE 顯示名稱")}</small>
          </div>
        </td>
        <td data-label="備註" class="bulk-technician-table__cell bulk-technician-table__cell--note">
          <div class="bulk-technician-note" data-bulk-note>
            ${note ? escapeHtml(note) : '<span class="helper-text">尚無備註</span>'}
          </div>
        </td>
        <td data-label="操作" class="bulk-technician-table__cell bulk-technician-table__cell--actions table-cell-actions">
          ${getBulkTechnicianReviewActionsMarkup(technicianId, canReview)}
        </td>
      </tr>
    `;
  },

  initializeRow(row) {
    if (!row) {
      return;
    }

    initializeTimeWheelFields(row);
    this.syncRowUi(row);
  },

  updateSelectionMeta() {
    if (!elements.technicianBulkSelectionMeta) {
      return;
    }

    const rows = this.getRows();
    const dirtyCount = rows.filter((row) => this.isRowDirty(row)).length;
    const metaText = dirtyCount
      ? `共 ${rows.length} 列，${dirtyCount} 列待儲存`
      : `共 ${rows.length} 列，目前沒有待儲存的變更`;
    elements.technicianBulkSelectionMeta.textContent = metaText;

    if (elements.technicianStickyBar) {
      elements.technicianStickyBar.classList.toggle("is-visible", dirtyCount > 0);
    }
    if (elements.technicianStickyMeta) {
      if (dirtyCount) {
        elements.technicianStickyMeta.textContent = `${dirtyCount} 列待儲存`;
      } else {
        elements.technicianStickyMeta.textContent = "目前沒有待儲存的變更";
      }
    }

    this.updateActionButtons();
  },

  renderTable() {
    if (!elements.technicianBulkTable) {
      return;
    }

    const technicians = getFilteredTechnicians();
    if (elements.technicianResultLabel) {
      elements.technicianResultLabel.textContent = `顯示 ${technicians.length} / ${state.technicians.length} 位`;
    }

    if (!technicians.length) {
      const hasFilters = state.filters.technicianId || state.filters.technicianStatus !== "all" || state.filters.technicianReviewStatus !== "all";
      elements.technicianBulkTable.innerHTML = hasFilters
        ? '<div class="empty-state" style="padding:20px;text-align:center;">找不到符合條件的技師，請嘗試調整篩選條件。</div>'
        : `<div class="technician-empty-guide">
            <div class="technician-empty-guide__icon"><i class="bi bi-person-plus"></i></div>
            <p class="technician-empty-guide__title">尚無技師資料</p>
            <p class="technician-empty-guide__text">等待技師透過 LINE 登入 technician 頁面後自動出現，<br />或由既有技師資料同步到此列表。</p>
          </div>`;
      this.updateSelectionMeta();
      return;
    }

    elements.technicianBulkTable.innerHTML = `
      <table class="list-table bulk-technician-table">
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
          ${technicians.map((technician) => this.createRowMarkup(technician)).join("")}
        </tbody>
      </table>
    `;

    this.getRows().forEach((row) => this.initializeRow(row));
    this.updateSelectionMeta();
  },

  appendRow(technician = null) {
    if (!elements.technicianBulkTable) {
      return;
    }

    let tbody = elements.technicianBulkTable.querySelector("tbody");
    if (!tbody) {
      elements.technicianBulkTable.innerHTML = `
        <table class="list-table bulk-technician-table">
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
          <tbody></tbody>
        </table>
      `;
      tbody = elements.technicianBulkTable.querySelector("tbody");
      if (!tbody) {
        return;
      }
    }

    tbody.insertAdjacentHTML("beforeend", this.createRowMarkup(technician));
    const row = tbody.lastElementChild;
    this.initializeRow(row);
    this.updateSelectionMeta();
  },

  readRow(row) {
    const { technicianId, name, startTime, endTime, active, serviceIds, status, note } = this.getRowDraft(row);

    if (!this.isRowDirty(row)) {
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
      status,
      note,
    };
  },

  async submit() {
    this.refreshDraftState();
    setLoadingStatus("正在批量儲存技師資料...");
    const payloads = this.getDirtyRows()
      .map((row) => this.readRow(row))
      .filter(Boolean);

    if (!payloads.length) {
      setStatus("目前沒有待儲存的技師變更。", "info");
      return;
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
    setStatus(`已儲存 ${payloads.length} 列技師變更。`, "success");
  },

  cancelChanges() {
    const rows = this.getDirtyRows();
    if (!rows.length) {
      setStatus("目前沒有可取消的變更。", "info");
      return;
    }

    const confirmed = window.confirm(`確定要取消 ${rows.length} 列變更並還原為上次同步的內容？`);
    if (!confirmed) {
      setStatus("已取消還原操作。", "info");
      return;
    }

    rows.forEach((row) => {
      const originalId = String(row.dataset.originalTechnicianId || "").trim();
      if (!originalId) {
        row.remove();
        return;
      }

      const originalName = String(row.dataset.originalName || "");
      const originalStart = String(row.dataset.originalStartTime || "09:00");
      const originalEnd = String(row.dataset.originalEndTime || "18:00");
      const originalActive = String(row.dataset.originalActive || "true") === "true";
      const originalServiceIds = String(row.dataset.originalServiceIds || "");
      const originalStatus = String(row.dataset.originalReviewStatus || "未綁定");
      const originalNote = String(row.dataset.originalReviewNote || "");

      const nameInput = row.querySelector('input[name="name"]');
      if (nameInput) nameInput.value = originalName;

      const hiddenStart = row.querySelector('input[name="startTime"]');
      const hiddenEnd = row.querySelector('input[name="endTime"]');
      const triggers = row.querySelectorAll('[data-time-wheel-trigger]');
      if (hiddenStart) hiddenStart.value = originalStart;
      if (hiddenEnd) hiddenEnd.value = originalEnd;
      if (triggers && triggers.length >= 2) {
        triggers[0].textContent = originalStart;
        triggers[0].dataset.timeValue = originalStart;
        triggers[1].textContent = originalEnd;
        triggers[1].dataset.timeValue = originalEnd;
      }

      const activeInput = row.querySelector('input[name="active"]');
      if (activeInput) activeInput.checked = !!originalActive;

      row.dataset.serviceIds = originalServiceIds;
      const checkboxContainer = row.querySelector('[data-bulk-service-checkboxes]');
      if (checkboxContainer && checkboxContainer.childElementCount) {
        const ids = originalServiceIds.split(',').map(v => v.trim()).filter(Boolean);
        checkboxContainer.querySelectorAll('input[name="serviceIds"]').forEach((input) => {
          input.checked = ids.includes(input.value);
        });
      }

      row.dataset.reviewStatus = originalStatus;
      row.dataset.reviewNote = originalNote;

      this.syncRowUi(row);
    });

    this.updateSelectionMeta();
    setStatus(`已還原 ${rows.length} 列變更。`, "success");
  },

  handleChange(event) {
    if (event.target.matches('input[name="name"], input[name="startTime"], input[name="endTime"]')) {
      const row = event.target.closest("[data-bulk-technician-row]");
      this.syncRowUi(row);
      this.updateSelectionMeta();
      return;
    }

    if (event.target.matches('input[name="active"]')) {
      const row = event.target.closest("[data-bulk-technician-row]");
      const label = row?.querySelector('.bulk-technician-status-panel__toggle span');
      if (label) {
        label.textContent = event.target.checked ? "目前啟用" : "目前停用";
      }
      this.syncRowUi(row);
      this.updateSelectionMeta();
      return;
    }

    if (event.target.matches("[data-bulk-service-category]")) {
      const row = event.target.closest("[data-bulk-technician-row]");
      this.renderServiceEditor(row);
      return;
    }

    if (event.target.matches('[data-bulk-service-checkboxes] input[name="serviceIds"]')) {
      const row = event.target.closest("[data-bulk-technician-row]");
      this.syncRowUi(row);
      this.updateSelectionMeta();
      return;
    }

    if (event.target.matches('[data-review-technician-select]')) {
      const row = event.target.closest("[data-bulk-technician-row]");
      const technicianId = event.target.dataset.reviewTechnicianSelect;
      const current = state.technicians.find((item) => item.technicianId === technicianId);
      if (!current?.lineUserId) {
        event.target.value = String(row?.dataset.reviewStatus || current?.status || "未綁定");
        setStatus("此技師尚未完成 LINE 登入，暫時無法審核。", "info");
        return;
      }

      const nextStatus = event.target.value;
      const currentNote = String(row?.dataset.reviewNote || current.note || "");
      const displayName = row?.querySelector('input[name="name"]')?.value.trim() || current.name;
      const note = window.prompt(`請輸入「${displayName}」的技師審核備註：`, currentNote);
      if (note === null) {
        event.target.value = String(row?.dataset.reviewStatus || current.status || "待審核");
        setStatus("已取消技師審核操作。", "info");
        return;
      }

      row.dataset.reviewStatus = nextStatus;
      row.dataset.reviewNote = note.trim();
      this.syncRowUi(row);
      this.updateSelectionMeta();
      setStatus(`已暫存 ${displayName} 的審核變更，按下「儲存批量變更」後才會同步到 GAS。`, "info");
    }
  },

  handleClick(event) {
    const row = event.target.closest("[data-bulk-technician-row]");
    if (!row) {
      return;
    }

    const deleteButton = event.target.closest("[data-delete-technician-row]");
    if (deleteButton) {
      const technicianId = String(row.dataset.technicianId || "").trim();
      const technicianName = row.querySelector('input[name="name"]')?.value.trim() || technicianId || "未命名技師";

      if (!technicianId) {
        row.remove();
        this.updateSelectionMeta();
        setStatus("已移除尚未儲存的新列。", "info");
        return;
      }

      deleteTechnician(technicianId, technicianName)
        .catch((error) => setStatus(error.message, "error"));
      return;
    }

    const toggleButton = event.target.closest("[data-toggle-service-editor]");
    if (toggleButton) {
      const editor = row.querySelector("[data-bulk-service-editor]");
      if (editor) {
        const isOpen = editor.classList.toggle("is-expanded");
        toggleButton.classList.toggle("is-open", isOpen);
        toggleButton.innerHTML = isOpen
          ? '<i class="bi bi-chevron-up"></i> 收合'
          : '<i class="bi bi-pencil-square"></i> 編輯服務';
        if (isOpen && !editor.querySelector("[data-bulk-service-checkboxes]")?.childElementCount) {
          this.renderServiceEditor(row);
        }
      }
      return;
    }

    if (event.target.closest("[data-bulk-select-visible-services]")) {
      const count = setVisibleServiceSelection(row.querySelector("[data-bulk-service-checkboxes]"), true);
      this.syncRowUi(row);
      this.updateSelectionMeta();
      setStatus(count ? "已全選此列目前分類服務。" : "目前分類沒有可勾選的服務項目。", "info");
      return;
    }

    if (event.target.closest("[data-bulk-clear-visible-services]")) {
      const count = setVisibleServiceSelection(row.querySelector("[data-bulk-service-checkboxes]"), false);
      this.syncRowUi(row);
      this.updateSelectionMeta();
      setStatus(count ? "已清除此列目前分類服務。" : "目前分類沒有可清除的服務項目。", "info");
    }
  },

  bindEvents() {
    if (!elements.technicianBulkTable) {
      return;
    }

    if (elements.technicianBulkSaveButton) {
      elements.technicianBulkSaveButton.addEventListener("click", async () => {
        try {
          await this.submit();
        } catch (error) {
          setStatus(error.message, "error");
        }
      });
    }

    if (elements.technicianBulkCancelButton) {
      elements.technicianBulkCancelButton.addEventListener("click", async () => {
        try {
          this.cancelChanges();
        } catch (error) {
          setStatus(error.message, "error");
        }
      });
    }

    elements.technicianBulkTable.addEventListener("change", (event) => {
      this.handleChange(event);
    });

    elements.technicianBulkTable.addEventListener("input", (event) => {
      if (!event.target.matches('input[name="name"]')) {
        return;
      }

      const row = event.target.closest("[data-bulk-technician-row]");
      this.syncRowUi(row);
      this.updateSelectionMeta();
    });

    elements.technicianBulkTable.addEventListener("click", (event) => {
      this.handleClick(event);
    });
  },
};

function renderTechnicianReviewSummary() {
  if (!elements.technicianReviewSummary || !frameworkView) {
    return;
  }

  frameworkView.technicianReview.summary = {
    unlinkedCount: state.technicians.filter((item) => item.status === "未綁定").length,
    pendingCount: state.technicians.filter((item) => item.status === "待審核").length,
    approvedCount: state.technicians.filter((item) => item.status === "已通過").length,
    blockedCount:
      state.technicians.filter((item) => item.status === "已拒絕").length
      + state.technicians.filter((item) => item.status === "已停用").length,
  };

  window.requestAnimationFrame(() => {
    if (!elements.technicianReviewSummary) {
      return;
    }
    const activeStatus = state.filters.technicianReviewStatus;
    elements.technicianReviewSummary.querySelectorAll("[data-filter-review-status]").forEach((el) => {
      el.classList.toggle("is-active-filter", el.dataset.filterReviewStatus === activeStatus);
    });
  });
}

function renderTechnicianReviewTable() {
  if (!frameworkView) {
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

  if (!elements.technicianReviewTable) {
    return;
  }

  if (!technicians.length) {
    frameworkView.technicianReview.rows = [];
    frameworkView.technicianReview.emptyMessage = state.filters.technicianId || state.filters.technicianStatus !== "all" || state.filters.technicianReviewStatus !== "all"
      ? "找不到符合條件的技師帳號。"
      : "尚無任何技師 LINE 登入紀錄。";
    return;
  }

  frameworkView.technicianReview.rows = technicians
    .slice()
    .sort((left, right) => {
      const leftRank = statusOrder[left.status] ?? 9;
      const rightRank = statusOrder[right.status] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(right.lastLoginAt || right.updatedAt || "").localeCompare(String(left.lastLoginAt || left.updatedAt || ""));
    })
    .map((technician) => ({
      technicianId: technician.technicianId,
      name: technician.name,
      lineUserId: technician.lineUserId || "",
      lineDisplayName: technician.profileDisplayName || technician.name,
      lineInitial: (technician.profileDisplayName || technician.name || "T").slice(0, 1),
      pictureUrl: technician.pictureUrl || "",
      serviceLabel: getBulkTechnicianServicesLabel(technician.serviceIds),
      scheduleMeta: `${technician.startTime} - ${technician.endTime} / ${technician.active ? "啟用" : "停用"}`,
      status: getTechnicianReviewStatusDescriptor(technician.status),
      lastLoginAtText: formatDateTimeText(technician.lastLoginAt),
      note: technician.note || "",
      canReview: Boolean(technician.lineUserId),
    }));
  frameworkView.technicianReview.emptyMessage = "";
}

function renderServiceTable() {
  const services = getFilteredServices();
  elements.serviceResultLabel.textContent = `顯示 ${services.length} / ${state.services.length} 項`;
  if (!frameworkView) {
    return;
  }

  if (!services.length) {
    frameworkView.service.rows = [];
    frameworkView.service.emptyMessage = state.filters.serviceKeyword || state.filters.serviceCategory
      ? "找不到符合篩選條件的服務項目。"
      : "尚無服務項目。";
    return;
  }

  frameworkView.service.rows = services.map((service) => ({
    serviceId: service.serviceId,
    name: service.name,
    category: getServiceCategory(service),
    durationLabel: `${service.durationMinutes} 分鐘`,
    priceLabel: `NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}`,
    status: getActiveStatusDescriptor(service.active),
  }));
  frameworkView.service.emptyMessage = "";
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

function getLeaveRequestDateLabel(leaveRequest) {
  if (!leaveRequest) {
    return "";
  }

  if (leaveRequest.startDate === leaveRequest.endDate) {
    return leaveRequest.startDate;
  }

  return `${leaveRequest.startDate} 至 ${leaveRequest.endDate}`;
}

function renderLeaveRequestSummary() {
  if (!elements.leaveRequestSummary || !frameworkView) {
    return;
  }

  frameworkView.leaveRequest.summary = {
    pendingCount: state.leaveRequests.filter((item) => item.status === "待審核").length,
    approvedCount: state.leaveRequests.filter((item) => item.status === "已通過").length,
    rejectedCount: state.leaveRequests.filter((item) => item.status === "已拒絕").length,
    cancelledCount: state.leaveRequests.filter((item) => item.status === "已取消").length,
  };
}

function renderLeaveRequestTable() {
  if (elements.leaveRequestResultLabel) {
    elements.leaveRequestResultLabel.textContent = `顯示 ${state.leaveRequests.length} / ${state.leaveRequests.length} 筆`;
  }

  renderLeaveRequestSummary();

  if (!elements.leaveRequestTable || !frameworkView) {
    return;
  }

  if (!state.leaveRequests.length) {
    frameworkView.leaveRequest.rows = [];
    frameworkView.leaveRequest.emptyMessage = "尚無休假申請。";
    return;
  }

  frameworkView.leaveRequest.rows = state.leaveRequests
    .slice()
    .sort((left, right) => {
      const statusRank = {
        "待審核": 0,
        "已通過": 1,
        "已拒絕": 2,
        "已取消": 3,
      };
      const leftRank = statusRank[left.status] ?? 9;
      const rightRank = statusRank[right.status] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return String(right.createdAt || right.startDate).localeCompare(String(left.createdAt || left.startDate));
    })
    .map((leaveRequest) => ({
      leaveRequestId: leaveRequest.leaveRequestId,
      technicianId: leaveRequest.technicianId,
      technicianName: leaveRequest.technicianName || getTechnicianById(leaveRequest.technicianId)?.name || leaveRequest.technicianId,
      dateLabel: getLeaveRequestDateLabel(leaveRequest),
      reason: leaveRequest.reason || "",
      statusValue: leaveRequest.status || "待審核",
      status: getLeaveRequestStatusDescriptor(leaveRequest.status),
      createdAtText: formatDateTimeText(leaveRequest.createdAt),
      reviewNote: leaveRequest.reviewNote || "",
    }));
  frameworkView.leaveRequest.emptyMessage = "";
}

function renderScheduleCalendar() {
  const monthKey = state.ui.scheduleCalendarMonth;
  const { firstDay, lastDay } = getMonthBoundary(monthKey);
  const selectedDate = state.ui.selectedScheduleDate;
  const todayText = formatLocalDate(new Date());
  const cells = [];

  elements.scheduleCalendarLabel.textContent = formatMonthLabel(monthKey);

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push({
      key: `empty-${index}`,
      isEmpty: true,
    });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const dateText = `${monthKey}-${String(day).padStart(2, "0")}`;
    const schedules = getSchedulesCoveringDate(dateText);
    const workingCount = schedules.filter((item) => item.isWorking).length;
    const offCount = schedules.length - workingCount;
    const compactStatus = workingCount
      ? `${workingCount}可約`
      : schedules.length
        ? `${offCount}休`
        : "無班";
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

    cells.push({
      key: dateText,
      isEmpty: false,
      dateText,
      day,
      compactStatus,
      countLabel: schedules.length ? `${schedules.length} 位技師` : "尚無排班",
      statusLabel: workingCount ? `${workingCount} 位可預約` : offCount ? `${offCount} 位休假` : "",
      classes,
    });
  }

  if (frameworkView) {
    frameworkView.schedule.days = cells;
  }
}

function syncScheduleResultLabel() {
  if (!elements.scheduleResultLabel) {
    return;
  }

  const workingSchedules = state.schedules.filter((item) => item.isWorking).length;
  elements.scheduleResultLabel.textContent = `${workingSchedules} 筆可預約 / 共 ${state.schedules.length} 筆`;
}

function renderScheduleTable() {
  syncScheduleResultLabel();
  renderScheduleCalendar();
  renderSelectedScheduleDetail();
}

function renderSelectedScheduleDetail() {
  const selectedDate = state.ui.selectedScheduleDate;
  const schedules = getSchedulesCoveringDate(selectedDate);
  if (!frameworkView) {
    return;
  }

  if (!selectedDate) {
    elements.scheduleSelectedDateLabel.textContent = "請先選擇日期";
    elements.scheduleSelectedDateMeta.textContent = "選取日曆日期後，會顯示當天所有技師的排班狀態。";
    frameworkView.schedule.entries = [];
    frameworkView.schedule.emptyMessage = "尚未選取日期。";
    setSelectedScheduleDeleteKeys([]);
    updateScheduleBatchSelectionMeta([]);
    return;
  }

  elements.scheduleSelectedDateLabel.textContent = selectedDate;
  elements.scheduleSelectedDateMeta.textContent = schedules.length
    ? `當天共有 ${schedules.length} 筆班表覆蓋，可多選後批量移除，或點擊編輯直接帶入下方表單。`
    : "當天尚未建立班表，可直接用下方表單新增。";

  if (!schedules.length) {
    frameworkView.schedule.entries = [];
    frameworkView.schedule.emptyMessage = "這一天尚未建立任何技師班表。";
    setSelectedScheduleDeleteKeys([]);
    updateScheduleBatchSelectionMeta([]);
    return;
  }

  syncScheduleEntrySelection(schedules);
  const selectedKeys = new Set(getSelectedScheduleDeleteKeys());

  frameworkView.schedule.entries = schedules.map((schedule) => {
    const technicianName = getTechnicianById(schedule.technicianId)?.name || schedule.technicianId;
    const overnight = isOvernightShift(schedule.startTime, schedule.endTime);
    const isFromPrevDay = schedule.date !== selectedDate;
    const key = getScheduleEntryKey(schedule);
    const timeLabel = isFromPrevDay
      ? `${schedule.startTime} - ${schedule.endTime} (前日跨日)`
      : overnight
        ? `${schedule.startTime} - ${schedule.endTime} (跨日)`
        : `${schedule.startTime} - ${schedule.endTime}`;

    return {
      key,
      technicianName,
      timeLabel,
      status: getScheduleStatusDescriptor(schedule.isWorking),
      selected: selectedKeys.has(key),
    };
  });
  frameworkView.schedule.emptyMessage = "";
  updateScheduleBatchSelectionMeta(schedules);
}

function renderReservationTable() {
  const reservations = getFilteredReservations();
  elements.reservationResultLabel.textContent = `顯示 ${reservations.length} / ${state.reservations.length} 筆`;
  if (!frameworkView) {
    return;
  }

  if (!reservations.length) {
    frameworkView.reservation.rows = [];
    frameworkView.reservation.emptyMessage = state.filters.reservationKeyword || state.filters.reservationStatus !== "all" || state.filters.reservationTechnicianId
      ? "找不到符合條件的預約紀錄。"
      : "尚無預約紀錄。";
    return;
  }

  frameworkView.reservation.rows = reservations
    .slice()
    .sort((left, right) => `${right.date}-${right.startTime}`.localeCompare(`${left.date}-${left.startTime}`))
    .map((reservation) => ({
      reservationId: reservation.reservationId,
      date: reservation.date,
      timeLabel: `${reservation.startTime} - ${reservation.endTime}`,
      customerName: reservation.customerName,
      phone: reservation.phone,
      technicianLabel: getReservationTechnicianLabel(reservation),
      serviceLabel: reservation.serviceName || reservation.serviceId,
      status: getReservationStatusDescriptor(reservation.status),
      confirmation: getReservationTechnicianConfirmationDescriptor(reservation),
    }));
  frameworkView.reservation.emptyMessage = "";
}

function renderUserReviewSummary() {
  if (!elements.userReviewSummary || !frameworkView) {
    return;
  }

  frameworkView.userReview.summary = {
    draftCount: state.users.filter((item) => item.status === "未送審核").length,
    pendingCount: state.users.filter((item) => item.status === "待審核").length,
    approvedCount: state.users.filter((item) => item.status === "已通過").length,
    blockedCount:
      state.users.filter((item) => item.status === "已拒絕").length
      + state.users.filter((item) => item.status === "已停用").length,
  };
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

  if (!elements.userTable || !frameworkView) {
    return;
  }

  if (!users.length) {
    frameworkView.userReview.rows = [];
    frameworkView.userReview.emptyMessage = state.filters.userKeyword || state.filters.userStatus !== "all"
      ? "找不到符合條件的用戶。"
      : "尚無任何 LINE 用戶登入紀錄。";
    return;
  }

  frameworkView.userReview.rows = users
    .slice()
    .sort((left, right) => {
      const leftRank = statusOrder[left.status] ?? 9;
      const rightRank = statusOrder[right.status] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(right.updatedAt || right.lastLoginAt || "").localeCompare(String(left.updatedAt || left.lastLoginAt || ""));
    })
    .map((user) => ({
      userId: user.userId,
      displayName: user.displayName,
      pictureUrl: user.pictureUrl || "",
      initial: user.displayName.slice(0, 1) || "L",
      customerName: user.customerName || "",
      phone: user.phone || "",
      status: getUserStatusDescriptor(user.status),
      lastLoginAtText: formatDateTimeText(user.lastLoginAt),
      note: user.note || "",
    }));
  frameworkView.userReview.emptyMessage = "";
}

function getFilteredAdminUsers() {
  const adminUsers = getOtherAdminUsers();
  return adminUsers.filter((admin) => {
    if (state.filters.adminKeyword) {
      const keyword = state.filters.adminKeyword.toLowerCase();
      if (
        !matchesKeyword(admin.displayName, keyword) &&
        !matchesKeyword(admin.userId, keyword) &&
        !matchesKeyword(admin.note, keyword)
      ) {
        return false;
      }
    }

    if (state.filters.adminStatus !== "all" && admin.status !== state.filters.adminStatus) {
      return false;
    }

    return true;
  });
}

function getOtherAdminUsers() {
  const currentUserId = getCurrentAdminUserId();
  return state.adminUsers.filter((admin) => {
    if (currentUserId && admin.userId === currentUserId) {
      return false;
    }

    return true;
  });
}

function getAdminManagementStatusDescriptor(status) {
  if (status === "已通過") {
    return getStatusDescriptor("已通過", "approved");
  }
  if (status === "已拒絕") {
    return getStatusDescriptor("已拒絕", "rejected");
  }
  if (status === "已停用") {
    return getStatusDescriptor("已停用", "disabled");
  }
  return getStatusDescriptor(status || "待審核", "pending");
}

function renderAdminManagementSummary() {
  if (!elements.adminManagementSummary || !frameworkView) {
    return;
  }

  const adminUsers = getOtherAdminUsers();

  frameworkView.adminManagement.summary = {
    totalCount: adminUsers.length,
    approvedCount: adminUsers.filter((item) => item.status === "已通過").length,
    pendingCount: adminUsers.filter((item) => item.status === "待審核").length,
    canManageCount: adminUsers.filter((item) => item.canManageAdmins).length,
  };
}

function renderAdminManagementTable() {
  const admins = getFilteredAdminUsers();
  const adminUsers = getOtherAdminUsers();
  const currentUserId = getCurrentAdminUserId();
  const statusOrder = {
    "待審核": 0,
    "已通過": 1,
    "已拒絕": 2,
    "已停用": 3,
  };

  if (elements.adminResultLabel) {
    elements.adminResultLabel.textContent = `顯示 ${admins.length} / ${adminUsers.length} 位`;
  }

  renderAdminManagementSummary();

  if (!elements.adminManagementTable || !frameworkView) {
    return;
  }

  if (!admins.length) {
    frameworkView.adminManagement.rows = [];
    frameworkView.adminManagement.emptyMessage = state.filters.adminKeyword || state.filters.adminStatus !== "all"
      ? "找不到符合條件的管理員。"
      : "尚無任何管理員登入紀錄。";
    return;
  }

  frameworkView.adminManagement.rows = admins
    .slice()
    .sort((left, right) => {
      if (left.canManageAdmins !== right.canManageAdmins) {
        return left.canManageAdmins ? -1 : 1;
      }
      const leftRank = statusOrder[left.status] ?? 9;
      const rightRank = statusOrder[right.status] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(right.updatedAt || right.lastLoginAt || "").localeCompare(String(left.updatedAt || left.lastLoginAt || ""));
    })
    .map((admin) => ({
      userId: admin.userId,
      displayName: admin.displayName,
      pictureUrl: admin.pictureUrl || "",
      initial: (admin.displayName || "A").slice(0, 1).toUpperCase(),
      status: getAdminManagementStatusDescriptor(admin.status),
      canManageAdmins: Boolean(admin.canManageAdmins),
      pagePermissionLabels: getAdminPagePermissionLabels(admin),
      lastLoginAtText: formatDateTimeText(admin.lastLoginAt),
      note: admin.note || "",
      isCurrentUser: admin.userId === currentUserId,
    }));
  frameworkView.adminManagement.emptyMessage = "";
}

function getAdminPagePermissionLabels(admin) {
  const permissions = Array.isArray(admin.pagePermissions) ? admin.pagePermissions : [];
  if (!permissions.length) {
    return "未指派頁面";
  }

  return ADMIN_PAGE_OPTIONS
    .filter((option) => permissions.includes(option.key))
    .map((option) => option.label)
    .join("、");
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

  setActivePage(state.ui.activePage);

  updateStats();
  updateWorkspaceOverview();
  refreshServiceCategorySuggestions();
  renderServiceTable();
  renderTechnicianReviewTable();
  bulkTechnicianModule.renderTable();
  renderScheduleTable();
  renderLeaveRequestTable();
  renderReservationTable();
  renderUserTable();
  renderAdminManagementTable();
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
  state.adminUser = result.data.currentAdminUser || state.adminUsers.find((item) => item.userId === getCurrentAdminUserId()) || state.adminUser;
  state.technicians = result.data.technicians || [];
  state.schedules = result.data.schedules || [];
  state.leaveRequests = result.data.leaveRequests || [];
  state.users = result.data.users || [];
  state.reservations = result.data.reservations || [];
  renderAdminAccessState();
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
  const activeTechnicians = state.technicians.filter((item) => item.active);
  const startDate = formData.get("date");
  const endDate = formData.get("endDate") || startDate;
  const scheduleDates = enumerateDateRange(startDate, endDate);
  const isEditingSchedule = Boolean(state.ui.editingScheduleKey);
  const selectedTechnicianIds = isEditingSchedule
    ? technicianIds
    : activeTechnicians.map((item) => item.technicianId);
  const checkedTechnicianIds = new Set(technicianIds);
  const editingScheduleIsWorking = state.ui.editingScheduleIsWorking;

  if (!selectedTechnicianIds.length) {
    throw new Error(isEditingSchedule ? "請至少選擇一位技師" : "目前沒有啟用中的技師可建立班表");
  }

  if (isEditingSchedule && technicianIds.length !== 1) {
    throw new Error("編輯班表時一次只能修改一位技師");
  }

  if (isEditingSchedule && scheduleDates.length !== 1) {
    throw new Error("編輯班表時一次只能修改單一天");
  }

  const items = [];
  for (const scheduleDate of scheduleDates) {
    for (const technicianId of selectedTechnicianIds) {
      const technician = getTechnicianById(technicianId);
      if (!technician) {
        throw new Error("找不到技師預設班別");
      }

      items.push({
        technicianId,
        date: scheduleDate,
        startTime: isEditingSchedule ? formData.get("startTime") : technician.startTime,
        endTime: isEditingSchedule ? formData.get("endTime") : technician.endTime,
        isWorking: isEditingSchedule ? editingScheduleIsWorking : checkedTechnicianIds.has(technicianId),
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
  const selectedCount = technicianIds.length;
  setStatus(
    isEditingSchedule
      ? "班表時段已更新。"
      : selectedCount
        ? "已新增班表，未勾選的啟用技師已標記為休假。"
        : "已將所有啟用技師標記為休假。",
    "success"
  );
}

async function submitReservation(event) {
  event.preventDefault();
  const formData = new FormData(elements.reservationForm);
  const reservationTechnician = getReservationSubmissionTechnician();
  // allow empty technicianId when assignmentType is 現場安排 so backend will clear technician association
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
  elements.serviceEditMode.textContent = `編輯：${service.name}`;
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
  syncTimeWheelField(elements.reservationForm.startTime, reservation.startTime || "09:00");
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

async function batchDeleteSchedules(scheduleItems) {
  const items = Array.isArray(scheduleItems)
    ? scheduleItems
      .map((item) => ({
        technicianId: String(item?.technicianId || "").trim(),
        date: String(item?.date || "").trim(),
      }))
      .filter((item) => item.technicianId && item.date)
    : [];

  if (!items.length) {
    throw new Error("請先選擇要移除的班表");
  }

  const previewText = items
    .slice(0, 5)
    .map((item) => {
      const schedule = state.schedules.find(
        (entry) => entry.technicianId === item.technicianId && entry.date === item.date
      );
      const technicianName = getTechnicianById(item.technicianId)?.name || item.technicianId;
      const timeText = schedule ? ` ${schedule.startTime} - ${schedule.endTime}` : "";
      return `${item.date}｜${technicianName}${timeText}`;
    })
    .join("\n");
  const remainCount = items.length > 5 ? `\n... 另 ${items.length - 5} 筆` : "";
  const confirmed = window.confirm(`確定要批量移除 ${items.length} 筆班表嗎？\n\n${previewText}${remainCount}`);
  if (!confirmed) {
    setStatus("已取消批量移除班表。", "info");
    return;
  }

  setLoadingStatus(`正在批量移除 ${items.length} 筆班表...`);
  const result = await requestApi("POST", {}, {
    action: "batchDeleteSchedules",
    payload: { items },
  });
  if (!result.ok) {
    throw new Error(result.message || "批量移除班表失敗");
  }

  const deletedKeys = new Set(items.map((item) => `${item.date}::${item.technicianId}`));
  if (state.ui.editingScheduleKey && deletedKeys.has(state.ui.editingScheduleKey)) {
    resetScheduleForm();
  }

  setSelectedScheduleDeleteKeys([]);
  await loadAdminData();
  updateScheduleBatchSelectionMeta([]);
  setStatus(`已批量移除 ${items.length} 筆班表。`, "success");
}

async function reviewTechnician(technicianId, status, presetNote = null) {
  const technician = state.technicians.find((item) => item.technicianId === technicianId);
  if (!technician) {
    throw new Error("找不到技師資料");
  }

  if (!technician.lineUserId) {
    setStatus("此技師尚未完成 LINE 登入，暫時無法審核。", "info");
    return;
  }

  const note = presetNote === null
    ? window.prompt(`請輸入「${technician.name}」的技師審核備註：`, technician.note || "")
    : String(presetNote);
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
  bulkTechnicianModule.renderTable();
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

async function reviewLeaveRequest(leaveRequestId, status) {
  const leaveRequest = state.leaveRequests.find((item) => item.leaveRequestId === leaveRequestId);
  if (!leaveRequest) {
    throw new Error("找不到休假申請資料");
  }

  const nextStatus = String(status || "").trim() || "待審核";
  const statusLabel = `${leaveRequest.status || "待審核"} -> ${nextStatus}`;

  const note = window.prompt(
    `請輸入「${leaveRequest.technicianName || getTechnicianById(leaveRequest.technicianId)?.name || leaveRequest.technicianId}」的休假備註（${statusLabel}）：`,
    leaveRequest.reviewNote || ""
  );
  if (note === null) {
    setStatus("已取消休假狀態更新。", "info");
    return;
  }

  setLoadingStatus("正在更新休假狀態...");
  const result = await requestApi("POST", {}, {
    action: "reviewLeaveRequest",
    payload: {
      leaveRequestId,
      status: nextStatus,
      note,
    },
  });
  if (!result.ok) {
    throw new Error(result.message || "更新休假狀態失敗");
  }

  await loadAdminData();
  if (nextStatus === "已通過") {
    setStatus("休假狀態已更新為已通過，並同步寫入班表。", "success");
    return;
  }

  if (leaveRequest.status === "已通過") {
    setStatus(`休假狀態已更新為${nextStatus}，並同步回復班表。`, "success");
    return;
  }

  setStatus(`休假狀態已更新為${nextStatus}。`, "success");
}

async function deleteLeaveRequest(leaveRequestId) {
  const leaveRequest = state.leaveRequests.find((item) => item.leaveRequestId === leaveRequestId);
  if (!leaveRequest) {
    throw new Error("找不到休假申請資料");
  }

  const technicianName = leaveRequest.technicianName || getTechnicianById(leaveRequest.technicianId)?.name || leaveRequest.technicianId;
  const detailText = `\n\n技師：${technicianName}\n日期：${getLeaveRequestDateLabel(leaveRequest)}\n目前狀態：${leaveRequest.status}`;
  const syncHint = leaveRequest.status === "已通過" ? "\n刪除後會同步回復班表。" : "";
  const confirmed = window.confirm(`確定要刪除這筆休假申請嗎？${detailText}${syncHint}`);
  if (!confirmed) {
    setStatus("已取消刪除休假申請。", "info");
    return;
  }

  setLoadingStatus("正在刪除休假申請...");
  const result = await requestApi("POST", {}, {
    action: "deleteLeaveRequest",
    payload: { leaveRequestId },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除休假申請失敗");
  }

  await loadAdminData();
  setStatus(
    leaveRequest.status === "已通過"
      ? "休假申請已刪除，並同步回復班表。"
      : "休假申請已刪除。",
    "success"
  );
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

async function adminReviewAdmin(userId, status) {
  const admin = state.adminUsers.find((item) => item.userId === userId);
  if (!admin) {
    throw new Error("找不到管理員資料");
  }

  const note = window.prompt(`請輸入「${admin.displayName}」的審核備註：`, admin.note || "");
  if (note === null) {
    setStatus("已取消管理員審核操作。", "info");
    return;
  }

  setLoadingStatus("正在更新管理員審核狀態...");
  const result = await requestApi("POST", {}, {
    action: "adminReviewAdmin",
    payload: { userId, status, note },
  });
  if (!result.ok) {
    throw new Error(result.message || "更新管理員審核失敗");
  }

  await loadAdminData();
  setStatus(`已將 ${admin.displayName} 設為${status}。`, "success");
}

async function adminUpdateAdminPermission(userId, updates) {
  const admin = state.adminUsers.find((item) => item.userId === userId);
  if (!admin) {
    throw new Error("找不到管理員資料");
  }

  const actionLabel = updates.canManageAdmins !== undefined
    ? (updates.canManageAdmins ? "授予管理員修改權限" : "收回管理員修改權限")
    : "更新頁面權限";

  if (!window.confirm(`確定要對「${admin.displayName}」${actionLabel}嗎？`)) {
    setStatus("已取消操作。", "info");
    return;
  }

  setLoadingStatus("正在更新管理員權限...");
  const result = await requestApi("POST", {}, {
    action: "adminUpdateAdminPermission",
    payload: { userId, ...updates },
  });
  if (!result.ok) {
    throw new Error(result.message || "更新管理員權限失敗");
  }

  await loadAdminData();
  setStatus(`已更新 ${admin.displayName} 的權限。`, "success");
}

async function adminDeleteAdmin(userId) {
  const admin = state.adminUsers.find((item) => item.userId === userId);
  if (!admin) {
    throw new Error("找不到管理員資料");
  }

  const confirmed = window.confirm(
    `確定要刪除管理員「${admin.displayName}」嗎？\n\n此操作會移除管理員登入紀錄，刪除後需重新登入並重新審核才能再次使用 admin 後台。`
  );
  if (!confirmed) {
    setStatus("已取消刪除管理員。", "info");
    return;
  }

  setLoadingStatus("正在刪除管理員...");
  const result = await requestApi("POST", {}, {
    action: "adminDeleteAdmin",
    payload: { userId },
  });
  if (!result.ok) {
    throw new Error(result.message || "刪除管理員失敗");
  }

  await loadAdminData();
  setStatus(`已刪除管理員 ${admin.displayName}。`, "success");
}

function handleUiError(error) {
  const message = error instanceof Error ? error.message : String(error || "發生未知錯誤");
  setStatus(message, "error");
}

function bindEvent(target, eventName, handler, options) {
  if (!target || typeof target.addEventListener !== "function") {
    return;
  }

  target.addEventListener(eventName, handler, options);
}

function createAsyncHandler(task) {
  return async (...args) => {
    try {
      await task(...args);
    } catch (error) {
      handleUiError(error);
    }
  };
}

const renderCoordinator = {
  service() {
    renderServiceTable();
  },

  technician() {
    renderTechnicianReviewTable();
    bulkTechnicianModule.renderTable();
  },

  schedule() {
    renderScheduleTable();
  },

  leaveRequest() {
    renderLeaveRequestTable();
  },

  reservation() {
    renderReservationTable();
  },

  user() {
    renderUserTable();
  },

  admin() {
    renderAdminManagementTable();
  },
};

let eventsBound = false;

const eventBinder = {
  bind() {
    if (eventsBound) {
      return;
    }

    this.bindTimeWheelEvents();
    this.bindAccessEvents();
    this.bindNavigationEvents();
    this.bindServiceEvents();
    this.bindTechnicianEvents();
    this.bindReservationEvents();
    this.bindUserEvents();
    this.bindAdminManagementEvents();
    this.bindScheduleEvents();
    this.bindLeaveRequestEvents();
    this.bindRefreshEvents();

    eventsBound = true;
  },

  bindTimeWheelEvents() {
    bindEvent(document, "click", (event) => {
      const trigger = event.target.closest("[data-time-wheel-trigger]");
      if (trigger) {
        openTimeWheelPicker(trigger);
        return;
      }

      const optionButton = event.target.closest("[data-time-wheel-item]");
      if (!optionButton) {
        return;
      }

      const type = optionButton.dataset.timeWheelItem;
      const value = optionButton.dataset.timeWheelValue;
      if (type === "hour") {
        timeWheelState.hour = value;
      } else {
        timeWheelState.minute = value;
      }

      updateTimeWheelSelection();
      const container = type === "hour" ? elements.timeWheelHourList : elements.timeWheelMinuteList;
      const values = type === "hour" ? TIME_WHEEL_HOURS : TIME_WHEEL_MINUTES;
      const nextIndex = values.indexOf(value);
      if (container && nextIndex >= 0) {
        container.scrollTo({ top: nextIndex * TIME_WHEEL_ITEM_HEIGHT, behavior: "smooth" });
      }
    });

    bindEvent(elements.timeWheelBackdrop, "click", closeTimeWheelPicker);
    bindEvent(elements.timeWheelCloseButton, "click", closeTimeWheelPicker);
    bindEvent(elements.timeWheelConfirmButton, "click", applyTimeWheelValue);
    bindEvent(elements.timeWheelNowButton, "click", () => {
      const now = new Date();
      timeWheelState.hour = String(now.getHours()).padStart(2, "0");
      const roundedMinutes = Math.floor(now.getMinutes() / TIME_WHEEL_MINUTE_STEP) * TIME_WHEEL_MINUTE_STEP;
      timeWheelState.minute = String(roundedMinutes).padStart(2, "0");
      updateTimeWheelSelection(true);
    });
    bindEvent(elements.timeWheelHourList, "scroll", () => handleTimeWheelScroll(elements.timeWheelHourList));
    bindEvent(elements.timeWheelMinuteList, "scroll", () => handleTimeWheelScroll(elements.timeWheelMinuteList));
    bindEvent(document, "keydown", (event) => {
      if (event.key === "Escape" && elements.timeWheelSheet && !elements.timeWheelSheet.classList.contains("is-hidden")) {
        closeTimeWheelPicker();
      }
    });
  },

  bindAccessEvents() {
    bindEvent(elements.adminLoginButton, "click", createAsyncHandler(async () => {
      await refreshAdminIdentity();
    }));

    bindEvent(elements.adminRefreshIdentityButton, "click", createAsyncHandler(async () => {
      await refreshAdminIdentity();
    }));

    bindEvent(elements.adminLogoutButton, "click", createAsyncHandler(async () => {
      if (state.liffLoginRequired) {
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
      }

      state.profile = null;
      state.adminUser = null;
      state.adminUsers = [];
      renderAdminAccessState();
      setStatus("已登出 LINE 帳號。", "info");
    }));
  },

  bindNavigationEvents() {
    elements.pageTabs.forEach((button) => {
      bindEvent(button, "click", () => {
        const nextPage = button.dataset.pageTrigger;
        setActivePage(nextPage);
        setStatus(`已切換到${button.textContent.trim()}頁面。`, "info");
      });
    });
  },

  bindServiceEvents() {
    bindEvent(elements.serviceSubmitButton, "click", createAsyncHandler(async (event) => {
      await submitService(event);
    }));

    bindEvent(elements.serviceForm, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
      }
    });

    bindEvent(elements.serviceEditForm, "submit", createAsyncHandler(async (event) => {
      await submitServiceEdit(event);
    }));

    bindEvent(elements.serviceResetButton, "click", () => {
      resetServiceForm();
      setStatus("服務表單已重設。", "info");
    });

    bindEvent(elements.serviceEditResetButton, "click", () => {
      resetServiceEditForm();
      setStatus("已取消服務編輯。", "info");
    });

    bindEvent(elements.serviceSearchInput, "input", (event) => {
      state.filters.serviceKeyword = event.target.value;
      renderCoordinator.service();
    });

    bindEvent(elements.serviceCategoryFilter, "change", (event) => {
      state.filters.serviceCategory = event.target.value;
      renderCoordinator.service();
    });

    bindEvent(elements.serviceTable, "click", createAsyncHandler(async (event) => {
      const editButton = event.target.closest("[data-edit-service]");
      if (editButton) {
        fillServiceForm(editButton.dataset.editService);
        setStatus("已載入服務資料，可直接修改。", "info");
        return;
      }

      const deleteButton = event.target.closest("[data-delete-service]");
      if (!deleteButton) {
        return;
      }

      await deleteService(deleteButton.dataset.deleteService, deleteButton.dataset.serviceName);
    }));
  },

  bindTechnicianEvents() {
    const rerenderTechnicianViews = () => {
      renderCoordinator.technician();
    };

    bindEvent(elements.technicianSearchSelect, "change", (event) => {
      state.filters.technicianId = event.target.value;
      rerenderTechnicianViews();
    });

    bindEvent(elements.technicianStatusFilter, "change", (event) => {
      state.filters.technicianStatus = event.target.value;
      rerenderTechnicianViews();
    });

    bindEvent(elements.technicianReviewStatusFilter, "change", (event) => {
      state.filters.technicianReviewStatus = event.target.value;
      rerenderTechnicianViews();
    });

    bulkTechnicianModule.bindEvents();

    bindEvent(elements.technicianStickySaveButton, "click", createAsyncHandler(async () => {
      await bulkTechnicianModule.submit();
    }));

    bindEvent(elements.technicianStickyCancelButton, "click", createAsyncHandler(async () => {
      bulkTechnicianModule.cancelChanges();
    }));

    bindEvent(elements.technicianReviewSummary, "click", (event) => {
      const card = event.target.closest("[data-filter-review-status]");
      if (!card) {
        return;
      }

      const clickedStatus = card.dataset.filterReviewStatus;
      const isSameFilter = state.filters.technicianReviewStatus === clickedStatus;
      const nextStatus = isSameFilter ? "all" : clickedStatus;

      state.filters.technicianReviewStatus = nextStatus;
      if (elements.technicianReviewStatusFilter) {
        elements.technicianReviewStatusFilter.value = nextStatus === "已拒絕" ? "已拒絕" : nextStatus;
      }

      elements.technicianReviewSummary.querySelectorAll("[data-filter-review-status]").forEach((el) => {
        el.classList.toggle("is-active-filter", el.dataset.filterReviewStatus === nextStatus);
      });

      rerenderTechnicianViews();
      setStatus(isSameFilter ? "已清除篩選。" : `已篩選：${clickedStatus}`, "info");
    });

    bindEvent(elements.technicianReviewTable, "click", (event) => {
      const focusButton = event.target.closest("[data-focus-technician]");
      if (focusButton) {
        focusTechnicianSettings(focusButton.dataset.focusTechnician);
      }
    });

    bindEvent(elements.technicianReviewTable, "change", createAsyncHandler(async (event) => {
      const reviewSelect = event.target.closest("[data-review-technician-select]");
      if (!reviewSelect) {
        return;
      }

      const technicianId = reviewSelect.dataset.reviewTechnicianSelect;
      const technician = state.technicians.find((item) => item.technicianId === technicianId);
      if (!technician?.lineUserId) {
        reviewSelect.value = technician?.status || "未綁定";
        setStatus("此技師尚未完成 LINE 登入，暫時無法審核。", "info");
        return;
      }

      const previousStatus = technician.status || "待審核";
      const nextStatus = reviewSelect.value;
      const note = window.prompt(`請輸入「${technician.name}」的技師審核備註：`, technician.note || "");
      if (note === null) {
        reviewSelect.value = previousStatus;
        setStatus("已取消技師審核操作。", "info");
        return;
      }

      try {
        await reviewTechnician(technicianId, nextStatus, note);
      } catch (error) {
        reviewSelect.value = previousStatus;
        throw error;
      }
    }));
  },

  bindReservationEvents() {
    bindEvent(elements.reservationForm, "submit", createAsyncHandler(async (event) => {
      await submitReservation(event);
    }));

    bindEvent(elements.reservationResetButton, "click", () => {
      resetReservationForm();
      setStatus("預約表單已重設。", "info");
    });

    bindEvent(elements.reservationTechnicianSelect, "change", () => {
      if (!isOnsiteAssignmentSelected(elements.reservationTechnicianSelect.value)) {
        setReservationAssignedTechnicianId(elements.reservationTechnicianSelect.value);
      }
      renderReservationServiceOptions(getSelectedReservationServiceIds());
    });

    bindEvent(elements.reservationSearchInput, "input", (event) => {
      state.filters.reservationKeyword = event.target.value;
      renderCoordinator.reservation();
    });

    bindEvent(elements.reservationStatusFilter, "change", (event) => {
      state.filters.reservationStatus = event.target.value;
      renderCoordinator.reservation();
    });

    bindEvent(elements.reservationTechnicianFilter, "change", (event) => {
      state.filters.reservationTechnicianId = event.target.value;
      renderCoordinator.reservation();
    });

    bindEvent(elements.reservationTable, "click", createAsyncHandler(async (event) => {
      const editButton = event.target.closest("[data-edit-reservation]");
      if (editButton) {
        fillReservationForm(editButton.dataset.editReservation);
        setStatus("已載入預約資料，可直接修改。", "info");
        return;
      }

      const deleteButton = event.target.closest("[data-delete-reservation]");
      if (!deleteButton) {
        return;
      }

      await deleteReservation(deleteButton.dataset.deleteReservation, deleteButton.dataset.customerName);
    }));
  },

  bindUserEvents() {
    bindEvent(elements.userSearchInput, "input", (event) => {
      state.filters.userKeyword = event.target.value;
      renderCoordinator.user();
    });

    bindEvent(elements.userStatusFilter, "change", (event) => {
      state.filters.userStatus = event.target.value;
      renderCoordinator.user();
    });

    bindEvent(elements.userTable, "click", createAsyncHandler(async (event) => {
      const reviewButton = event.target.closest("[data-review-user]");
      if (reviewButton) {
        await reviewUser(reviewButton.dataset.reviewUser, reviewButton.dataset.reviewStatus);
        return;
      }

      const deleteButton = event.target.closest("[data-delete-user]");
      if (!deleteButton) {
        return;
      }

      await deleteUser(deleteButton.dataset.deleteUser, deleteButton.dataset.userName);
    }));
  },

  bindAdminManagementEvents() {
    bindEvent(elements.adminSearchInput, "input", (event) => {
      state.filters.adminKeyword = event.target.value;
      renderCoordinator.admin();
    });

    bindEvent(elements.adminStatusFilter, "change", (event) => {
      state.filters.adminStatus = event.target.value;
      renderCoordinator.admin();
    });

    bindEvent(elements.adminManagementTable, "click", createAsyncHandler(async (event) => {
      const reviewButton = event.target.closest("[data-review-admin]");
      if (reviewButton) {
        await adminReviewAdmin(reviewButton.dataset.reviewAdmin, reviewButton.dataset.reviewStatus);
        return;
      }

      const permButton = event.target.closest("[data-toggle-admin-permission]");
      if (permButton) {
        const canManageAdmins = permButton.dataset.canManageAdmins === "true";
        await adminUpdateAdminPermission(permButton.dataset.toggleAdminPermission, { canManageAdmins });
        return;
      }

      const savePageButton = event.target.closest("[data-save-admin-pages]");
      if (savePageButton) {
        const card = savePageButton.closest("[data-admin-mgmt-card]");
        if (!card) {
          setStatus("找不到管理員卡片。", "error");
          return;
        }

        const pagePermissions = Array.from(card.querySelectorAll("[data-admin-page-checkbox]:checked"))
          .map((input) => String(input.value || "").trim())
          .filter(Boolean);
        await adminUpdateAdminPermission(savePageButton.dataset.saveAdminPages, { pagePermissions });
        return;
      }

      const deleteButton = event.target.closest("[data-delete-admin]");
      if (deleteButton) {
        await adminDeleteAdmin(deleteButton.dataset.deleteAdmin);
      }
    }));
  },

  bindScheduleEvents() {
    bindEvent(elements.scheduleForm, "submit", createAsyncHandler(async (event) => {
      await submitSchedule(event);
    }));

    bindEvent(elements.scheduleResetButton, "click", () => {
      resetScheduleForm();
      setStatus("班表表單已重設。", "info");
    });

    bindEvent(elements.scheduleSelectAllTechniciansButton, "click", () => {
      const count = setScheduleTechnicianSelection(true);
      setStatus(count ? `已全選 ${count} 位啟用技師。` : "目前沒有可選擇的技師。", "info");
    });

    bindEvent(elements.scheduleClearTechniciansButton, "click", () => {
      const count = setScheduleTechnicianSelection(false);
      setStatus(count ? "已清空技師勾選。" : "目前沒有可清空的技師。", "info");
    });

    bindEvent(elements.scheduleSelectAllEntriesButton, "click", () => {
      const count = setScheduleEntrySelection(true);
      setStatus(count ? `已全選當日 ${count} 筆班表。` : "當天沒有可選擇的班表。", "info");
    });

    bindEvent(elements.scheduleClearEntriesButton, "click", () => {
      const count = setScheduleEntrySelection(false);
      setStatus(count ? "已清空班表勾選。" : "目前沒有可清空的班表。", "info");
    });

    bindEvent(elements.scheduleBatchDeleteButton, "click", createAsyncHandler(async () => {
      const items = getSelectedScheduleDeleteKeys().map((key) => parseScheduleEntryKey(key));
      await batchDeleteSchedules(items);
    }));

    bindEvent(elements.scheduleTechnicianCheckboxes, "change", () => {
      updateScheduleTechnicianSelectionMeta();
    });

    bindEvent(elements.schedulePrevMonthButton, "click", () => {
      state.ui.scheduleCalendarMonth = shiftMonth(state.ui.scheduleCalendarMonth, -1);
      state.ui.selectedScheduleDate = `${state.ui.scheduleCalendarMonth}-01`;
      renderCoordinator.schedule();
    });

    bindEvent(elements.scheduleTodayButton, "click", () => {
      const todayText = formatLocalDate(new Date());
      updateSelectedScheduleDate(todayText);
      renderCoordinator.schedule();
      resetScheduleForm();
      setStatus(`已切換到 ${todayText}。`, "info");
    });

    bindEvent(elements.scheduleNextMonthButton, "click", () => {
      state.ui.scheduleCalendarMonth = shiftMonth(state.ui.scheduleCalendarMonth, 1);
      state.ui.selectedScheduleDate = `${state.ui.scheduleCalendarMonth}-01`;
      renderCoordinator.schedule();
    });

    bindEvent(elements.scheduleCalendarGrid, "click", (event) => {
      const button = event.target.closest("[data-schedule-date]");
      if (!button) {
        return;
      }

      updateSelectedScheduleDate(button.dataset.scheduleDate);
      renderCoordinator.schedule();
      resetScheduleForm();
      setStatus(`已選擇 ${button.dataset.scheduleDate}，可查看或新增當日班表。`, "info");
    });

    bindEvent(elements.scheduleTable, "click", createAsyncHandler(async (event) => {
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

      const [dateText, technicianId] = deleteButton.dataset.deleteSchedule.split("::");
      await deleteSchedule(dateText, technicianId, deleteButton.dataset.technicianName);
    }));

    bindEvent(elements.scheduleTable, "change", (event) => {
      const selectionInput = event.target.closest("[data-schedule-select]");
      if (!selectionInput) {
        return;
      }

      const currentKeys = new Set(getSelectedScheduleDeleteKeys());
      if (selectionInput.checked) {
        currentKeys.add(selectionInput.dataset.scheduleSelect);
      } else {
        currentKeys.delete(selectionInput.dataset.scheduleSelect);
      }

      setSelectedScheduleDeleteKeys(Array.from(currentKeys));
      updateScheduleBatchSelectionMeta();
    });
  },

  bindLeaveRequestEvents() {
    bindEvent(elements.leaveRequestTable, "click", createAsyncHandler(async (event) => {
      const saveButton = event.target.closest("[data-save-leave-request-status]");
      if (saveButton) {
        const leaveRequestId = saveButton.dataset.saveLeaveRequestStatus;
        const select = elements.leaveRequestTable.querySelector(`[data-leave-request-status-select="${leaveRequestId}"]`);
        if (!select) {
          setStatus("找不到休假狀態欄位。", "error");
          return;
        }

        await reviewLeaveRequest(leaveRequestId, select.value);
        return;
      }

      const deleteButton = event.target.closest("[data-delete-leave-request]");
      if (deleteButton) {
        await deleteLeaveRequest(deleteButton.dataset.deleteLeaveRequest);
      }
    }));
  },

  bindRefreshEvents() {
    bindEvent(elements.refreshDashboardButton, "click", createAsyncHandler(async () => {
      setLoadingStatus("正在重新同步資料...");
      await loadAdminData();
    }));
  },
};

function bindEvents() {
  eventBinder.bind();
}

async function initializeApp() {
  await loadConfigFromJson();
  applyGasUrlPreference();
  loadServiceCategoryMap();
  initializeTimeWheelFields(document);
  ensureTimeWheelLists();
  mountFrameworkApps();
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

})();
