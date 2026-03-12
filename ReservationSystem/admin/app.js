const ADMIN_STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
  password: "beauty-booking-admin-password",
  serviceCategories: "beauty-booking-service-categories",
};
const CONFIG_PATH = "./config.json";

const state = {
  gasUrl: "",
  configGasUrl: "",
  password: "",
  configPassword: "",
  services: [],
  technicians: [],
  schedules: [],
  reservations: [],
  serviceCategoryMap: {},
  filters: {
    serviceKeyword: "",
    serviceCategory: "",
    technicianId: "",
    technicianStatus: "all",
    technicianServiceCategory: "",
    reservationKeyword: "",
    reservationStatus: "all",
    reservationTechnicianId: "",
  },
  ui: {
    busyCount: 0,
    activePage: "service",
    scheduleCalendarMonth: formatLocalDate(new Date()).slice(0, 7),
    selectedScheduleDate: formatLocalDate(new Date()),
  },
};

const elements = {
  topLoadingBar: document.querySelector("#topLoadingBar"),
  topLoadingLabel: document.querySelector("#topLoadingLabel"),
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
  technicianForm: document.querySelector("#technicianForm"),
  technicianFormMode: document.querySelector("#technicianFormMode"),
  technicianResultLabel: document.querySelector("#technicianResultLabel"),
  technicianSubmitButton: document.querySelector("#technicianSubmitButton"),
  technicianResetButton: document.querySelector("#technicianResetButton"),
  technicianFormServiceCategorySelect: document.querySelector("#technicianFormServiceCategorySelect"),
  technicianFormSelectVisibleButton: document.querySelector("#technicianFormSelectVisibleButton"),
  technicianFormClearVisibleButton: document.querySelector("#technicianFormClearVisibleButton"),
  technicianFormServiceCheckboxes: document.querySelector("#technicianFormServiceCheckboxes"),
  technicianSearchSelect: document.querySelector("#technicianSearchSelect"),
  technicianStatusFilter: document.querySelector("#technicianStatusFilter"),
  technicianEditPanel: document.querySelector("#technicianEditPanel"),
  technicianEditForm: document.querySelector("#technicianEditForm"),
  technicianEditMode: document.querySelector("#technicianEditMode"),
  technicianEditResetButton: document.querySelector("#technicianEditResetButton"),
  technicianEditServiceCategorySelect: document.querySelector("#technicianEditServiceCategorySelect"),
  technicianEditSelectVisibleButton: document.querySelector("#technicianEditSelectVisibleButton"),
  technicianEditClearVisibleButton: document.querySelector("#technicianEditClearVisibleButton"),
  technicianEditServiceCheckboxes: document.querySelector("#technicianEditServiceCheckboxes"),
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
  scheduleAllDayButton: document.querySelector("#scheduleAllDayButton"),
  scheduleDayShiftButton: document.querySelector("#scheduleDayShiftButton"),
  reservationForm: document.querySelector("#reservationForm"),
  reservationFormMode: document.querySelector("#reservationFormMode"),
  reservationResultLabel: document.querySelector("#reservationResultLabel"),
  reservationSubmitButton: document.querySelector("#reservationSubmitButton"),
  reservationResetButton: document.querySelector("#reservationResetButton"),
  reservationEditorHint: document.querySelector("#reservationEditorHint"),
  reservationSearchInput: document.querySelector("#reservationSearchInput"),
  reservationStatusFilter: document.querySelector("#reservationStatusFilter"),
  reservationTechnicianFilter: document.querySelector("#reservationTechnicianFilter"),
  serviceTable: document.querySelector("#serviceTable"),
  technicianTable: document.querySelector("#technicianTable"),
  scheduleTable: document.querySelector("#scheduleTable"),
  reservationTable: document.querySelector("#reservationTable"),
  scheduleTechnicianSelect: document.querySelector("#scheduleTechnicianSelect"),
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

function normalizePassword(value) {
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
    state.configPassword = normalizePassword(config.adminPassword);
  } catch (error) {
    state.configGasUrl = "";
    state.configPassword = "";
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

function applyPasswordPreference() {
  const savedPassword = normalizePassword(localStorage.getItem(ADMIN_STORAGE_KEYS.password));
  if (state.configPassword) {
    state.password = state.configPassword;
    localStorage.setItem(ADMIN_STORAGE_KEYS.password, state.password);
  } else {
    state.password = savedPassword;
  }
}

function setStatus(message, type = "info") {
  const nextType = type || "info";
  const isLoading = nextType === "loading";

  if (elements.topLoadingBar && elements.topLoadingLabel) {
    elements.topLoadingLabel.textContent = message || "處理中...";
    elements.topLoadingBar.dataset.type = nextType;
    elements.topLoadingBar.classList.toggle("is-hidden", !message);
    elements.topLoadingBar.setAttribute("aria-busy", String(isLoading));
  }
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
  elements.scheduleForm.startTime.value = "00:00";
  elements.scheduleForm.endTime.value = "23:59";
  elements.scheduleForm.isWorking.checked = true;
}

function fillScheduleForm(schedule) {
  if (!schedule) {
    resetScheduleForm();
    return;
  }

  elements.scheduleForm.technicianId.value = schedule.technicianId;
  elements.scheduleForm.date.value = schedule.date;
  elements.scheduleForm.endDate.value = schedule.date;
  elements.scheduleForm.startTime.value = schedule.startTime;
  elements.scheduleForm.endTime.value = schedule.endTime;
  elements.scheduleForm.isWorking.checked = Boolean(schedule.isWorking);
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

function getFilteredReservations() {
  return state.reservations.filter((item) => {
    const text = `${item.customerName} ${item.phone} ${item.technicianName || ""} ${item.serviceName || ""}`;
    const matchesText = !state.filters.reservationKeyword || matchesKeyword(text, state.filters.reservationKeyword);
    const matchesStatus = state.filters.reservationStatus === "all" || item.status === state.filters.reservationStatus;
    const matchesTechnician = !state.filters.reservationTechnicianId || item.technicianId === state.filters.reservationTechnicianId;

    return matchesText && matchesStatus && matchesTechnician;
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

function isEditingService() {
  return Boolean(elements.serviceForm.serviceId.value);
}

function isEditingTechnician() {
  return Boolean(elements.technicianForm.technicianId.value);
}

function isEditingReservation() {
  return Boolean(elements.reservationForm.reservationId.value);
}

function updateServiceFormMode() {
  elements.serviceFormMode.textContent = "新增模式";
  elements.serviceSubmitButton.textContent = "新增服務";
  elements.serviceResetButton.textContent = "清空表單";
}

function updateTechnicianFormMode() {
  elements.technicianFormMode.textContent = "新增模式";
  elements.technicianSubmitButton.textContent = "新增技師";
  elements.technicianResetButton.textContent = "清空表單";
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

function resetTechnicianForm() {
  elements.technicianForm.reset();
  elements.technicianForm.technicianId.value = "";
  elements.technicianForm.active.checked = true;
  refreshCategorySelectOptions(elements.technicianFormServiceCategorySelect, "全部分類");
  elements.technicianFormServiceCategorySelect.value = "";
  renderServiceSelectionCheckboxes(elements.technicianFormServiceCheckboxes, [], "");
  updateTechnicianFormMode();
}

function isEditingTechnicianInline() {
  return Boolean(elements.technicianEditForm.technicianId.value);
}

function resetTechnicianEditForm() {
  elements.technicianEditForm.reset();
  elements.technicianEditForm.technicianId.value = "";
  elements.technicianEditForm.active.checked = true;
  refreshCategorySelectOptions(elements.technicianEditServiceCategorySelect, "全部分類");
  elements.technicianEditServiceCategorySelect.value = "";
  renderServiceSelectionCheckboxes(elements.technicianEditServiceCheckboxes, [], "");
  elements.technicianEditPanel.classList.add("is-hidden");
  elements.technicianEditMode.classList.add("is-hidden");
}

function getSelectedServiceIdsFromContainer(container) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll('input[name="serviceIds"]:checked')).map((input) => input.value);
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

function setSchedulePreset(startTime, endTime) {
  elements.scheduleForm.startTime.value = startTime;
  elements.scheduleForm.endTime.value = endTime;
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
  const technicianId = elements.reservationTechnicianSelect.value;
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
  setOptions(
    elements.reservationTechnicianSelect,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "請選擇技師"
  );
  renderReservationServiceOptions();
  updateReservationFormMode();
}

async function requestApi(method, params = {}, body = null) {
  if (!state.gasUrl) {
    throw new Error("請先在 admin/config.json 設定 GAS Web App URL");
  }
  if (!state.password) {
    throw new Error("請先在 admin/config.json 設定管理密碼");
  }

  startBusyState();

  try {
    if (method === "GET") {
      const url = new URL(state.gasUrl);
      Object.entries({ ...params, password: state.password }).forEach(([key, value]) => {
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
      body: JSON.stringify({ ...body, password: state.password }),
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

function getReservationConfirmationSummary(payload) {
  const technicianName = getTechnicianById(payload.technicianId)?.name || payload.technicianId;
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

  if (elements.workflowSummary) {
    elements.workflowSummary.textContent = `${activeTechnicians} 位啟用技師、${activeServices} 項啟用服務、${pendingReservations} 筆待處理預約`;
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

  if (pendingReservations) {
    elements.workflowHint.textContent = `建議優先檢查 ${pendingReservations} 筆已預約紀錄的時段與狀態。`;
    return;
  }

  elements.workflowHint.textContent = "資料狀態完整，可持續維護服務、班表與預約。";
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

function renderTechnicianTable() {
  const technicians = getFilteredTechnicians();
  elements.technicianResultLabel.textContent = `顯示 ${technicians.length} / ${state.technicians.length} 位`;
  if (!technicians.length) {
    elements.technicianTable.innerHTML = `<div class="empty-state">${state.filters.technicianId || state.filters.technicianStatus !== "all" ? "找不到符合條件的技師資料。" : "尚無技師資料。"}</div>`;
    return;
  }

  elements.technicianTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>技師</th>
          <th>可服務項目</th>
          <th>狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${technicians
          .map((technician) => {
            return `
              <tr>
                <td data-label="技師">${technician.name}</td>
                <td data-label="可服務項目">${getGroupedServiceMarkup(technician.serviceIds || [])}</td>
                <td data-label="狀態">${getActiveStatusPill(technician.active)}</td>
                <td data-label="操作" class="table-cell-actions">
                  <div class="table-actions">
                    <button type="button" class="button button--ghost" data-edit-technician="${technician.technicianId}">編輯</button>
                    <button type="button" class="button button--danger" data-delete-technician="${technician.technicianId}" data-technician-name="${technician.name}">刪除</button>
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
    const schedules = getSchedulesForDate(dateText);
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
  const schedules = getSchedulesForDate(selectedDate);

  if (!selectedDate) {
    elements.scheduleSelectedDateLabel.textContent = "請先選擇日期";
    elements.scheduleSelectedDateMeta.textContent = "選取日曆日期後，會顯示當天所有技師的排班狀態。";
    elements.scheduleTable.innerHTML = '<div class="empty-state">尚未選取日期。</div>';
    return;
  }

  elements.scheduleSelectedDateLabel.textContent = selectedDate;
  elements.scheduleSelectedDateMeta.textContent = schedules.length
    ? `當天共有 ${schedules.length} 筆班表，點擊編輯即可直接帶入下方表單。`
    : "當天尚未建立班表，可直接用下方表單新增。";

  if (!schedules.length) {
    elements.scheduleTable.innerHTML = '<div class="empty-state">這一天尚未建立任何技師班表。</div>';
    return;
  }

  elements.scheduleTable.innerHTML = schedules
    .map((schedule) => {
      const technicianName = getTechnicianById(schedule.technicianId)?.name || schedule.technicianId;
      return `
        <article class="schedule-entry">
          <div class="schedule-entry__top">
            <div class="schedule-entry__title">
              <strong>${technicianName}</strong>
              <span class="schedule-entry__time">${schedule.startTime} - ${schedule.endTime}</span>
            </div>
            ${getScheduleStatusPill(schedule.isWorking)}
          </div>
          <div class="table-actions">
            <button type="button" class="button button--ghost" data-edit-schedule="${schedule.date}::${schedule.technicianId}">編輯這筆班表</button>
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
              <td data-label="技師">${reservation.technicianName || reservation.technicianId}</td>
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

function refreshTechnicianOptions() {
  const selectedScheduleTechnicianId = elements.scheduleTechnicianSelect.value;
  const selectedReservationTechnicianId = elements.reservationTechnicianSelect.value;
  const selectedTechnicianSearchId = elements.technicianSearchSelect.value;
  const selectedServiceCategory = elements.serviceCategoryFilter.value;
  const categoryOptions = getServiceCategoryOptions();

  setOptions(
    elements.scheduleTechnicianSelect,
    state.technicians
      .filter((item) => item.active)
      .map((item) => ({ value: item.technicianId, label: item.name })),
    "請選擇技師"
  );

  setOptions(
    elements.reservationTechnicianSelect,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
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
  refreshCategorySelectOptions(elements.technicianFormServiceCategorySelect, "全部分類", elements.technicianFormServiceCategorySelect?.value || "");
  refreshCategorySelectOptions(elements.technicianEditServiceCategorySelect, "全部分類", elements.technicianEditServiceCategorySelect?.value || "");

  if (state.technicians.some((item) => item.technicianId === selectedScheduleTechnicianId && item.active)) {
    elements.scheduleTechnicianSelect.value = selectedScheduleTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === selectedReservationTechnicianId)) {
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
}

function renderAll() {
  if (!state.ui.selectedScheduleDate) {
    state.ui.selectedScheduleDate = formatLocalDate(new Date());
  }
  updateStats();
  updateWorkspaceOverview();
  refreshServiceCategorySuggestions();
  renderServiceTable();
  renderTechnicianTable();
  renderScheduleTable();
  renderReservationTable();
  refreshTechnicianOptions();
  updateServiceFormMode();
  updateTechnicianFormMode();
  syncTechnicianServiceSelection(
    elements.technicianFormServiceCategorySelect,
    elements.technicianFormServiceCheckboxes,
    getSelectedServiceIdsFromContainer(elements.technicianFormServiceCheckboxes)
  );
  if (isEditingServiceInline()) {
    const service = getServiceById(elements.serviceEditForm.serviceId.value);
    if (service) {
      fillServiceForm(service.serviceId);
    } else {
      resetServiceEditForm();
    }
  }
  if (isEditingTechnicianInline()) {
    const technician = getTechnicianById(elements.technicianEditForm.technicianId.value);
    if (technician) {
      fillTechnicianForm(technician.technicianId);
    } else {
      resetTechnicianEditForm();
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
  state.technicians = result.data.technicians || [];
  state.schedules = result.data.schedules || [];
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

async function saveTechnicianForm(form) {
  setLoadingStatus("正在儲存技師資料...");
  const formData = new FormData(form);
  const payload = {
    technicianId: formData.get("technicianId") || "",
    name: formData.get("name").trim(),
    active: formData.get("active") === "on",
  };

  const result = await requestApi("POST", {}, { action: "saveTechnician", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存技師失敗");
  }

  return result.data;
}

async function saveTechnicianServicesPayload(payload) {
  const result = await requestApi("POST", {}, { action: "saveTechnicianServices", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存技師服務項目失敗");
  }

  return result.data;
}

async function submitTechnician(event) {
  event.preventDefault();
  const serviceIds = getSelectedServiceIdsFromContainer(elements.technicianFormServiceCheckboxes);
  const technician = await saveTechnicianForm(elements.technicianForm);
  await saveTechnicianServicesPayload({
    technicianId: technician.technicianId,
    serviceIds,
  });

  resetTechnicianForm();
  await loadAdminData();
  setStatus("技師已新增，並同步更新可服務項目。", "success");
}

async function submitTechnicianEdit(event) {
  event.preventDefault();
  const technician = await saveTechnicianForm(elements.technicianEditForm);
  const serviceIds = getSelectedServiceIdsFromContainer(elements.technicianEditServiceCheckboxes);
  await saveTechnicianServicesPayload({
    technicianId: technician.technicianId,
    serviceIds,
  });

  resetTechnicianEditForm();
  await loadAdminData();
  setStatus("技師與可服務項目已更新。", "success");
}

async function submitSchedule(event) {
  event.preventDefault();
  setLoadingStatus("正在儲存班表...");
  const formData = new FormData(elements.scheduleForm);
  const startDate = formData.get("date");
  const endDate = formData.get("endDate") || startDate;
  const scheduleDates = enumerateDateRange(startDate, endDate);

  for (const scheduleDate of scheduleDates) {
    const payload = {
      technicianId: formData.get("technicianId"),
      date: scheduleDate,
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      isWorking: formData.get("isWorking") === "on",
    };

    const result = await requestApi("POST", {}, { action: "saveSchedule", payload });
    if (!result.ok) {
      throw new Error(result.message || "儲存班表失敗");
    }
  }

  updateSelectedScheduleDate(startDate);
  await loadAdminData();
  resetScheduleForm();
  setStatus(scheduleDates.length > 1 ? `已套用 ${scheduleDates.length} 天班表。` : "班表已儲存。", "success");
}

async function submitReservation(event) {
  event.preventDefault();
  const formData = new FormData(elements.reservationForm);
  const payload = {
    reservationId: formData.get("reservationId") || "",
    customerName: formData.get("customerName").trim(),
    phone: formData.get("phone").trim(),
    technicianId: formData.get("technicianId"),
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

function fillTechnicianForm(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) return;
  elements.technicianEditForm.technicianId.value = technician.technicianId;
  elements.technicianEditForm.name.value = technician.name;
  elements.technicianEditForm.active.checked = Boolean(technician.active);
  syncTechnicianServiceSelection(
    elements.technicianEditServiceCategorySelect,
    elements.technicianEditServiceCheckboxes,
    technician.serviceIds || []
  );
  elements.technicianEditPanel.classList.remove("is-hidden");
  elements.technicianEditMode.classList.remove("is-hidden");
  scrollToPanel(elements.technicianEditPanel);
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
  elements.reservationTechnicianSelect.value = reservation.technicianId;
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

  if (elements.technicianForm.technicianId.value === technicianId) {
    resetTechnicianForm();
  }
  if (elements.technicianEditForm.technicianId.value === technicianId) {
    resetTechnicianEditForm();
  }
  await loadAdminData();
  setStatus("技師已刪除。", "success");
}

async function deleteReservation(reservationId, customerName) {
  const reservation = state.reservations.find((item) => item.reservationId === reservationId);
  const detailText = reservation
    ? `\n\n日期：${reservation.date}\n時間：${reservation.startTime} - ${reservation.endTime}\n技師：${reservation.technicianName || reservation.technicianId}\n服務：${reservation.serviceName || reservation.serviceId}`
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

function bindEvents() {
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

  elements.technicianForm.addEventListener("submit", async (event) => {
    try {
      await submitTechnician(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.serviceEditForm.addEventListener("submit", async (event) => {
    try {
      await submitServiceEdit(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.technicianEditForm.addEventListener("submit", async (event) => {
    try {
      await submitTechnicianEdit(event);
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

  elements.technicianResetButton.addEventListener("click", () => {
    resetTechnicianForm();
    setStatus("技師表單已重設。", "info");
  });

  elements.technicianEditResetButton.addEventListener("click", () => {
    resetTechnicianEditForm();
    setStatus("已取消技師編輯。", "info");
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
    renderTechnicianTable();
  });

  elements.technicianFormServiceCategorySelect.addEventListener("change", () => {
    syncTechnicianServiceSelection(
      elements.technicianFormServiceCategorySelect,
      elements.technicianFormServiceCheckboxes,
      getSelectedServiceIdsFromContainer(elements.technicianFormServiceCheckboxes)
    );
  });

  elements.technicianEditServiceCategorySelect.addEventListener("change", () => {
    syncTechnicianServiceSelection(
      elements.technicianEditServiceCategorySelect,
      elements.technicianEditServiceCheckboxes,
      getSelectedServiceIdsFromContainer(elements.technicianEditServiceCheckboxes)
    );
  });

  elements.technicianFormSelectVisibleButton.addEventListener("click", () => {
    const count = setVisibleServiceSelection(elements.technicianFormServiceCheckboxes, true);
    setStatus(count ? "已全選目前分類服務。" : "目前分類沒有可勾選的服務項目。", count ? "info" : "info");
  });

  elements.technicianFormClearVisibleButton.addEventListener("click", () => {
    const count = setVisibleServiceSelection(elements.technicianFormServiceCheckboxes, false);
    setStatus(count ? "已清除目前分類服務。" : "目前分類沒有可清除的服務項目。", count ? "info" : "info");
  });

  elements.technicianEditSelectVisibleButton.addEventListener("click", () => {
    const count = setVisibleServiceSelection(elements.technicianEditServiceCheckboxes, true);
    setStatus(count ? "已全選目前分類服務。" : "目前分類沒有可勾選的服務項目。", count ? "info" : "info");
  });

  elements.technicianEditClearVisibleButton.addEventListener("click", () => {
    const count = setVisibleServiceSelection(elements.technicianEditServiceCheckboxes, false);
    setStatus(count ? "已清除目前分類服務。" : "目前分類沒有可清除的服務項目。", count ? "info" : "info");
  });

  elements.technicianStatusFilter.addEventListener("change", (event) => {
    state.filters.technicianStatus = event.target.value;
    renderTechnicianTable();
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

  elements.scheduleAllDayButton.addEventListener("click", () => {
    setSchedulePreset("00:00", "23:59");
    setStatus("已套用 24 小時班表預設。", "info");
  });

  elements.scheduleResetButton.addEventListener("click", () => {
    resetScheduleForm();
    setStatus("班表表單已重設。", "info");
  });

  elements.scheduleDayShiftButton.addEventListener("click", () => {
    setSchedulePreset("08:00", "20:00");
    setStatus("已套用熱門日班預設。", "info");
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

  elements.scheduleTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-schedule]");
    if (!button) {
      return;
    }

    const [dateText, technicianId] = button.dataset.editSchedule.split("::");
    const schedule = state.schedules.find((item) => item.date === dateText && item.technicianId === technicianId);
    if (!schedule) {
      setStatus("找不到這筆班表資料。", "error");
      return;
    }

    fillScheduleForm(schedule);
    setStatus("已載入班表資料，可直接修改。", "info");
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

  elements.technicianTable.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-technician]");
    if (editButton) {
      fillTechnicianForm(editButton.dataset.editTechnician);
      setStatus("已載入技師資料，可直接修改。", "info");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-technician]");
    if (!deleteButton) return;

    try {
      await deleteTechnician(
        deleteButton.dataset.deleteTechnician,
        deleteButton.dataset.technicianName
      );
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
}

async function initializeApp() {
  await loadConfigFromJson();
  applyGasUrlPreference();
  applyPasswordPreference();
  loadServiceCategoryMap();
  bindEvents();
  setActivePage(state.ui.activePage);
  resetServiceForm();
  resetServiceEditForm();
  resetTechnicianForm();
  resetTechnicianEditForm();
  resetScheduleForm();
  resetReservationForm();

  if (state.gasUrl && state.password) {
    loadAdminData().catch((error) => setStatus(error.message, "error"));
    return;
  }

  setStatus("請檢查 admin/config.json 內的 gasWebAppUrl 與 adminPassword。", "info");
}

initializeApp();
