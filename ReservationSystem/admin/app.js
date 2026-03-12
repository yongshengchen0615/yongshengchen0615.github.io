const ADMIN_STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
  password: "beauty-booking-admin-password",
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
  filters: {
    serviceKeyword: "",
    technicianKeyword: "",
    technicianStatus: "all",
    reservationKeyword: "",
    reservationStatus: "all",
    reservationTechnicianId: "",
  },
  ui: {
    busyCount: 0,
  },
};

const elements = {
  refreshDashboardButton: document.querySelector("#refreshDashboardButton"),
  workflowSummary: document.querySelector("#workflowSummary"),
  workflowHint: document.querySelector("#workflowHint"),
  serviceForm: document.querySelector("#serviceForm"),
  serviceFormMode: document.querySelector("#serviceFormMode"),
  serviceResultLabel: document.querySelector("#serviceResultLabel"),
  serviceSubmitButton: document.querySelector("#serviceSubmitButton"),
  serviceResetButton: document.querySelector("#serviceResetButton"),
  serviceSearchInput: document.querySelector("#serviceSearchInput"),
  serviceEditPanel: document.querySelector("#serviceEditPanel"),
  serviceEditForm: document.querySelector("#serviceEditForm"),
  serviceEditMode: document.querySelector("#serviceEditMode"),
  serviceEditResetButton: document.querySelector("#serviceEditResetButton"),
  technicianForm: document.querySelector("#technicianForm"),
  technicianFormMode: document.querySelector("#technicianFormMode"),
  technicianResultLabel: document.querySelector("#technicianResultLabel"),
  technicianSubmitButton: document.querySelector("#technicianSubmitButton"),
  technicianResetButton: document.querySelector("#technicianResetButton"),
  technicianSearchInput: document.querySelector("#technicianSearchInput"),
  technicianStatusFilter: document.querySelector("#technicianStatusFilter"),
  technicianEditPanel: document.querySelector("#technicianEditPanel"),
  technicianEditForm: document.querySelector("#technicianEditForm"),
  technicianEditMode: document.querySelector("#technicianEditMode"),
  technicianEditResetButton: document.querySelector("#technicianEditResetButton"),
  technicianServiceForm: document.querySelector("#technicianServiceForm"),
  technicianServiceTechnicianSelect: document.querySelector("#technicianServiceTechnicianSelect"),
  technicianServiceResetButton: document.querySelector("#technicianServiceResetButton"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleResultLabel: document.querySelector("#scheduleResultLabel"),
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
  serviceCheckboxes: document.querySelector("#serviceCheckboxes"),
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
  statusBox: document.querySelector("#statusBox"),
};

function normalizeGasUrl(value) {
  return String(value || "").trim();
}

function normalizePassword(value) {
  return String(value || "").trim();
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
  elements.statusBox.textContent = message;
  elements.statusBox.dataset.type = type;
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

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.classList.remove("is-flash");
  window.requestAnimationFrame(() => {
    panel.classList.add("is-flash");
    window.setTimeout(() => panel.classList.remove("is-flash"), 900);
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

function getFilteredServices() {
  if (!state.filters.serviceKeyword) {
    return state.services;
  }

  return state.services.filter((item) => matchesKeyword(item.name, state.filters.serviceKeyword));
}

function getFilteredTechnicians() {
  return state.technicians.filter((item) => {
    const matchesName = !state.filters.technicianKeyword || matchesKeyword(item.name, state.filters.technicianKeyword);
    const matchesStatus = state.filters.technicianStatus === "all"
      || (state.filters.technicianStatus === "active" && item.active)
      || (state.filters.technicianStatus === "inactive" && !item.active);

    return matchesName && matchesStatus;
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
  elements.serviceForm.active.checked = true;
  updateServiceFormMode();
}

function isEditingServiceInline() {
  return Boolean(elements.serviceEditForm.serviceId.value);
}

function resetServiceEditForm() {
  elements.serviceEditForm.reset();
  elements.serviceEditForm.serviceId.value = "";
  elements.serviceEditForm.active.checked = true;
  elements.serviceEditPanel.classList.add("is-hidden");
  elements.serviceEditMode.classList.add("is-hidden");
}

function resetTechnicianForm() {
  elements.technicianForm.reset();
  elements.technicianForm.technicianId.value = "";
  elements.technicianForm.active.checked = true;
  updateTechnicianFormMode();
}

function isEditingTechnicianInline() {
  return Boolean(elements.technicianEditForm.technicianId.value);
}

function resetTechnicianEditForm() {
  elements.technicianEditForm.reset();
  elements.technicianEditForm.technicianId.value = "";
  elements.technicianEditForm.active.checked = true;
  elements.technicianEditPanel.classList.add("is-hidden");
  elements.technicianEditMode.classList.add("is-hidden");
}

function setSchedulePreset(startTime, endTime) {
  elements.scheduleForm.startTime.value = startTime;
  elements.scheduleForm.endTime.value = endTime;
}

function resetTechnicianServiceForm() {
  setOptions(
    elements.technicianServiceTechnicianSelect,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "請選擇技師"
  );
  renderServiceCheckboxes();
}

function fillTechnicianServiceForm(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) {
    resetTechnicianServiceForm();
    return;
  }

  setOptions(
    elements.technicianServiceTechnicianSelect,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "請選擇技師"
  );
  elements.technicianServiceTechnicianSelect.value = technician.technicianId;
  renderServiceCheckboxes(technician.serviceIds || []);
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

function renderServiceCheckboxes(selectedIds = []) {
  const checked = new Set(selectedIds);
  if (!state.services.length) {
    elements.serviceCheckboxes.innerHTML = '<div class="empty-state">請先建立服務項目。</div>';
    return;
  }

  elements.serviceCheckboxes.innerHTML = state.services
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

function renderServiceTable() {
  const services = getFilteredServices();
  elements.serviceResultLabel.textContent = `顯示 ${services.length} / ${state.services.length} 項`;
  if (!services.length) {
    elements.serviceTable.innerHTML = `<div class="empty-state">${state.filters.serviceKeyword ? "找不到符合搜尋條件的服務項目。" : "尚無服務項目。"}</div>`;
    return;
  }

  elements.serviceTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>名稱</th>
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

function renderTechnicianTable() {
  const technicians = getFilteredTechnicians();
  elements.technicianResultLabel.textContent = `顯示 ${technicians.length} / ${state.technicians.length} 位`;
  if (!technicians.length) {
    elements.technicianTable.innerHTML = `<div class="empty-state">${state.filters.technicianKeyword || state.filters.technicianStatus !== "all" ? "找不到符合條件的技師資料。" : "尚無技師資料。"}</div>`;
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
            const serviceList = (technician.serviceIds || [])
              .map((serviceId) => getServiceById(serviceId)?.name)
              .filter(Boolean)
              .map((name) => `<li>${name}</li>`)
              .join("");
            return `
              <tr>
                <td data-label="技師">${technician.name}</td>
                <td data-label="可服務項目">${serviceList ? `<ul class="service-list">${serviceList}</ul>` : "<span class=\"helper-text\">尚未綁定</span>"}</td>
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
  if (!state.schedules.length) {
    elements.scheduleTable.innerHTML = '<div class="empty-state">尚無班表資料。</div>';
    return;
  }

  elements.scheduleTable.innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>日期</th>
          <th>技師</th>
          <th>時段</th>
          <th>狀態</th>
        </tr>
      </thead>
      <tbody>
        ${state.schedules
          .slice()
          .sort((left, right) => `${left.date}-${left.technicianId}`.localeCompare(`${right.date}-${right.technicianId}`))
          .map((schedule) => `
            <tr>
              <td data-label="日期">${schedule.date}</td>
              <td data-label="技師">${getTechnicianById(schedule.technicianId)?.name || schedule.technicianId}</td>
              <td data-label="時段">${schedule.startTime} - ${schedule.endTime}</td>
              <td data-label="狀態">${getScheduleStatusPill(schedule.isWorking)}</td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;
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
  const selectedTechnicianServiceTechnicianId = elements.technicianServiceTechnicianSelect.value;

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
    elements.technicianServiceTechnicianSelect,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "請選擇技師"
  );

  setOptions(
    elements.reservationTechnicianFilter,
    state.technicians.map((item) => ({ value: item.technicianId, label: item.name })),
    "全部技師"
  );

  if (state.technicians.some((item) => item.technicianId === selectedScheduleTechnicianId && item.active)) {
    elements.scheduleTechnicianSelect.value = selectedScheduleTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === selectedReservationTechnicianId)) {
    elements.reservationTechnicianSelect.value = selectedReservationTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === selectedTechnicianServiceTechnicianId)) {
    elements.technicianServiceTechnicianSelect.value = selectedTechnicianServiceTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === state.filters.reservationTechnicianId)) {
    elements.reservationTechnicianFilter.value = state.filters.reservationTechnicianId;
  }
}

function renderAll() {
  updateStats();
  updateWorkspaceOverview();
  renderServiceCheckboxes();
  renderServiceTable();
  renderTechnicianTable();
  renderScheduleTable();
  renderReservationTable();
  refreshTechnicianOptions();
  updateServiceFormMode();
  updateTechnicianFormMode();
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
  const technicianServiceTechnicianId = elements.technicianServiceTechnicianSelect.value;
  if (technicianServiceTechnicianId && getTechnicianById(technicianServiceTechnicianId)) {
    fillTechnicianServiceForm(technicianServiceTechnicianId);
  } else {
    resetTechnicianServiceForm();
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
  setStatus("正在載入管理資料...");
  const result = await requestApi("GET", { action: "adminData" });
  if (!result.ok) {
    throw new Error(result.message || "載入失敗");
  }

  state.services = result.data.services || [];
  state.technicians = result.data.technicians || [];
  state.schedules = result.data.schedules || [];
  state.reservations = result.data.reservations || [];
  renderAll();
  updateLastSyncTime();
  setStatus("管理資料已同步。", "success");
}

async function saveServiceForm(form) {
  const formData = new FormData(form);
  const payload = {
    serviceId: formData.get("serviceId") || "",
    name: formData.get("name").trim(),
    durationMinutes: Number(formData.get("durationMinutes")),
    price: Number(formData.get("price")),
    active: formData.get("active") === "on",
  };

  const result = await requestApi("POST", {}, { action: "saveService", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存服務失敗");
  }

  return payload;
}

async function submitService(event) {
  event.preventDefault();
  const payload = await saveServiceForm(elements.serviceForm);

  resetServiceForm();
  await loadAdminData();
  setStatus(payload.serviceId ? "服務已更新。" : "服務已新增。", "success");
}

async function submitServiceEdit(event) {
  event.preventDefault();
  await saveServiceForm(elements.serviceEditForm);

  resetServiceEditForm();
  await loadAdminData();
  setStatus("服務已更新。", "success");
}

async function saveTechnicianForm(form) {
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

  return payload;
}

async function submitTechnician(event) {
  event.preventDefault();
  const payload = await saveTechnicianForm(elements.technicianForm);

  resetTechnicianForm();
  await loadAdminData();
  setStatus(payload.technicianId ? "技師已更新。" : "技師已新增。", "success");
}

async function submitTechnicianEdit(event) {
  event.preventDefault();
  await saveTechnicianForm(elements.technicianEditForm);

  resetTechnicianEditForm();
  await loadAdminData();
  setStatus("技師已更新。", "success");
}

async function submitTechnicianServices(event) {
  event.preventDefault();
  const formData = new FormData(elements.technicianServiceForm);
  const payload = {
    technicianId: formData.get("technicianId"),
    serviceIds: formData.getAll("serviceIds"),
  };

  const result = await requestApi("POST", {}, { action: "saveTechnicianServices", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存技師服務項目失敗");
  }

  await loadAdminData();
  fillTechnicianServiceForm(payload.technicianId);
  setStatus("技師服務項目已更新。", "success");
}

async function submitSchedule(event) {
  event.preventDefault();
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

  elements.scheduleForm.reset();
  elements.scheduleForm.isWorking.checked = true;
  elements.scheduleForm.startTime.value = "00:00";
  elements.scheduleForm.endTime.value = "23:59";
  await loadAdminData();
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
  elements.technicianEditPanel.classList.remove("is-hidden");
  elements.technicianEditMode.classList.remove("is-hidden");
  fillTechnicianServiceForm(technicianId);
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
  await loadAdminData();
  setStatus("服務已刪除。", "success");
}

async function deleteTechnician(technicianId, technicianName) {
  const confirmed = window.confirm(`確定要刪除技師「${technicianName}」嗎？`);
  if (!confirmed) return;

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

  elements.technicianServiceForm.addEventListener("submit", async (event) => {
    try {
      await submitTechnicianServices(event);
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

  elements.technicianServiceResetButton.addEventListener("click", () => {
    fillTechnicianServiceForm(elements.technicianServiceTechnicianSelect.value);
    setStatus("技師服務項目已重新載入。", "info");
  });

  elements.technicianServiceTechnicianSelect.addEventListener("change", (event) => {
    fillTechnicianServiceForm(event.target.value);
    if (event.target.value) {
      setStatus("已切換技師，可直接調整服務項目。", "info");
    }
  });

  elements.serviceSearchInput.addEventListener("input", (event) => {
    state.filters.serviceKeyword = event.target.value;
    renderServiceTable();
  });

  elements.technicianSearchInput.addEventListener("input", (event) => {
    state.filters.technicianKeyword = event.target.value;
    renderTechnicianTable();
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

  elements.scheduleDayShiftButton.addEventListener("click", () => {
    setSchedulePreset("08:00", "20:00");
    setStatus("已套用熱門日班預設。", "info");
  });

  elements.refreshDashboardButton.addEventListener("click", async () => {
    try {
      setStatus("正在重新同步資料...", "info");
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
  bindEvents();
  resetServiceForm();
  resetServiceEditForm();
  resetTechnicianForm();
  resetTechnicianEditForm();
  resetTechnicianServiceForm();
  resetReservationForm();

  if (state.gasUrl && state.password) {
    loadAdminData().catch((error) => setStatus(error.message, "error"));
    return;
  }

  setStatus("請檢查 admin/config.json 內的 gasWebAppUrl 與 adminPassword。", "info");
}

initializeApp();
