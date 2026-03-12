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
};

const elements = {
  serviceForm: document.querySelector("#serviceForm"),
  serviceFormMode: document.querySelector("#serviceFormMode"),
  serviceSubmitButton: document.querySelector("#serviceSubmitButton"),
  serviceResetButton: document.querySelector("#serviceResetButton"),
  technicianForm: document.querySelector("#technicianForm"),
  technicianFormMode: document.querySelector("#technicianFormMode"),
  technicianSubmitButton: document.querySelector("#technicianSubmitButton"),
  technicianResetButton: document.querySelector("#technicianResetButton"),
  technicianServiceForm: document.querySelector("#technicianServiceForm"),
  technicianServiceTechnicianSelect: document.querySelector("#technicianServiceTechnicianSelect"),
  technicianServiceResetButton: document.querySelector("#technicianServiceResetButton"),
  scheduleForm: document.querySelector("#scheduleForm"),
  reservationForm: document.querySelector("#reservationForm"),
  reservationFormMode: document.querySelector("#reservationFormMode"),
  reservationSubmitButton: document.querySelector("#reservationSubmitButton"),
  reservationResetButton: document.querySelector("#reservationResetButton"),
  reservationEditorHint: document.querySelector("#reservationEditorHint"),
  serviceTable: document.querySelector("#serviceTable"),
  technicianTable: document.querySelector("#technicianTable"),
  scheduleTable: document.querySelector("#scheduleTable"),
  reservationTable: document.querySelector("#reservationTable"),
  serviceCheckboxes: document.querySelector("#serviceCheckboxes"),
  scheduleTechnicianSelect: document.querySelector("#scheduleTechnicianSelect"),
  reservationTechnicianSelect: document.querySelector("#reservationTechnicianSelect"),
  reservationServiceSelect: document.querySelector("#reservationServiceSelect"),
  technicianStat: document.querySelector("#technicianStat"),
  serviceStat: document.querySelector("#serviceStat"),
  scheduleStat: document.querySelector("#scheduleStat"),
  reservationStat: document.querySelector("#reservationStat"),
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
  const editing = isEditingService();
  elements.serviceFormMode.textContent = editing ? "編輯模式" : "新增模式";
  elements.serviceSubmitButton.textContent = editing ? "更新服務" : "新增服務";
  elements.serviceResetButton.textContent = editing ? "取消編輯" : "清空表單";
}

function updateTechnicianFormMode() {
  const editing = isEditingTechnician();
  elements.technicianFormMode.textContent = editing ? "編輯模式" : "新增模式";
  elements.technicianSubmitButton.textContent = editing ? "更新技師" : "新增技師";
  elements.technicianResetButton.textContent = editing ? "取消編輯" : "清空表單";
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

function resetTechnicianForm() {
  elements.technicianForm.reset();
  elements.technicianForm.technicianId.value = "";
  elements.technicianForm.active.checked = true;
  updateTechnicianFormMode();
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

function renderReservationServiceOptions(selectedServiceId = "") {
  const technicianId = elements.reservationTechnicianSelect.value;
  const services = technicianId ? getAllowedReservationServices(technicianId) : state.services;
  setOptions(
    elements.reservationServiceSelect,
    services.map((service) => ({
      value: service.serviceId,
      label: `${service.name} / ${service.durationMinutes} 分鐘 / NT$ ${service.price}`,
    })),
    "請選擇服務"
  );

  if (services.some((service) => service.serviceId === selectedServiceId)) {
    elements.reservationServiceSelect.value = selectedServiceId;
  }
}

function resetReservationForm() {
  elements.reservationForm.reset();
  elements.reservationForm.reservationId.value = "";
  elements.reservationForm.status.value = "booked";
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
}

function updateStats() {
  elements.technicianStat.textContent = String(state.technicians.length);
  elements.serviceStat.textContent = String(state.services.length);
  elements.scheduleStat.textContent = String(state.schedules.length);
  elements.reservationStat.textContent = String(state.reservations.length);
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
  if (!state.services.length) {
    elements.serviceTable.innerHTML = '<div class="empty-state">尚無服務項目。</div>';
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
        ${state.services
          .map(
            (service) => `
              <tr>
                <td>${service.name}</td>
                <td>${service.durationMinutes} 分鐘</td>
                <td>NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}</td>
                <td>${service.active ? "啟用" : "停用"}</td>
                <td>
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
  if (!state.technicians.length) {
    elements.technicianTable.innerHTML = '<div class="empty-state">尚無技師資料。</div>';
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
        ${state.technicians
          .map((technician) => {
            const serviceBadges = (technician.serviceIds || [])
              .map((serviceId) => getServiceById(serviceId)?.name)
              .filter(Boolean)
              .map((name) => `<span class="service-pill">${name}</span>`)
              .join("");
            return `
              <tr>
                <td>${technician.name}</td>
                <td>${serviceBadges || "<span class=\"helper-text\">尚未綁定</span>"}</td>
                <td>${technician.active ? "啟用" : "停用"}</td>
                <td>
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
              <td>${schedule.date}</td>
              <td>${getTechnicianById(schedule.technicianId)?.name || schedule.technicianId}</td>
              <td>${schedule.startTime} - ${schedule.endTime}</td>
              <td>${schedule.isWorking ? "可預約" : "休假"}</td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;
}

function renderReservationTable() {
  if (!state.reservations.length) {
    elements.reservationTable.innerHTML = '<div class="empty-state">尚無預約紀錄。</div>';
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
        ${state.reservations
          .slice()
          .sort((left, right) => `${right.date}-${right.startTime}`.localeCompare(`${left.date}-${left.startTime}`))
          .map((reservation) => `
            <tr>
              <td>${reservation.date}</td>
              <td>${reservation.startTime} - ${reservation.endTime}</td>
              <td>${reservation.customerName}</td>
              <td>${reservation.phone}</td>
              <td>${reservation.technicianName || reservation.technicianId}</td>
              <td>${reservation.serviceName || reservation.serviceId}</td>
              <td>${reservation.status}</td>
              <td>
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

  if (state.technicians.some((item) => item.technicianId === selectedScheduleTechnicianId && item.active)) {
    elements.scheduleTechnicianSelect.value = selectedScheduleTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === selectedReservationTechnicianId)) {
    elements.reservationTechnicianSelect.value = selectedReservationTechnicianId;
  }

  if (state.technicians.some((item) => item.technicianId === selectedTechnicianServiceTechnicianId)) {
    elements.technicianServiceTechnicianSelect.value = selectedTechnicianServiceTechnicianId;
  }
}

function renderAll() {
  updateStats();
  if (isEditingTechnician()) {
    const currentTechnician = getTechnicianById(elements.technicianForm.technicianId.value);
    renderServiceCheckboxes(currentTechnician?.serviceIds || []);
  } else {
    renderServiceCheckboxes();
  }
  renderServiceTable();
  renderTechnicianTable();
  renderScheduleTable();
  renderReservationTable();
  refreshTechnicianOptions();
  updateServiceFormMode();
  updateTechnicianFormMode();
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
  setStatus("管理資料已同步。", "success");
}

async function submitService(event) {
  event.preventDefault();
  const formData = new FormData(elements.serviceForm);
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

  resetServiceForm();
  await loadAdminData();
  setStatus(payload.serviceId ? "服務已更新。" : "服務已新增。", "success");
}

async function submitTechnician(event) {
  event.preventDefault();
  const formData = new FormData(elements.technicianForm);
  const payload = {
    technicianId: formData.get("technicianId") || "",
    name: formData.get("name").trim(),
    active: formData.get("active") === "on",
  };

  const result = await requestApi("POST", {}, { action: "saveTechnician", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存技師失敗");
  }

  resetTechnicianForm();
  await loadAdminData();
  setStatus(payload.technicianId ? "技師已更新。" : "技師已新增。", "success");
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
  const payload = {
    technicianId: formData.get("technicianId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    isWorking: formData.get("isWorking") === "on",
  };

  const result = await requestApi("POST", {}, { action: "saveSchedule", payload });
  if (!result.ok) {
    throw new Error(result.message || "儲存班表失敗");
  }

  elements.scheduleForm.reset();
  elements.scheduleForm.isWorking.checked = true;
  elements.scheduleForm.startTime.value = "10:00";
  elements.scheduleForm.endTime.value = "18:00";
  await loadAdminData();
}

async function submitReservation(event) {
  event.preventDefault();
  const formData = new FormData(elements.reservationForm);
  const payload = {
    reservationId: formData.get("reservationId") || "",
    customerName: formData.get("customerName").trim(),
    phone: formData.get("phone").trim(),
    technicianId: formData.get("technicianId"),
    serviceId: formData.get("serviceId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    status: formData.get("status"),
    note: formData.get("note").trim(),
  };

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
  elements.serviceForm.serviceId.value = service.serviceId;
  elements.serviceForm.name.value = service.name;
  elements.serviceForm.durationMinutes.value = service.durationMinutes;
  elements.serviceForm.price.value = service.price;
  elements.serviceForm.active.checked = Boolean(service.active);
  updateServiceFormMode();
}

function fillTechnicianForm(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) return;
  elements.technicianForm.technicianId.value = technician.technicianId;
  elements.technicianForm.name.value = technician.name;
  elements.technicianForm.active.checked = Boolean(technician.active);
  updateTechnicianFormMode();
  fillTechnicianServiceForm(technicianId);
}

function fillReservationForm(reservationId) {
  const reservation = state.reservations.find((item) => item.reservationId === reservationId);
  if (!reservation) return;

  elements.reservationForm.reservationId.value = reservation.reservationId;
  elements.reservationForm.customerName.value = reservation.customerName;
  elements.reservationForm.phone.value = reservation.phone;
  elements.reservationForm.date.value = reservation.date;
  elements.reservationForm.startTime.value = reservation.startTime;
  elements.reservationForm.status.value = reservation.status || "booked";
  elements.reservationForm.note.value = reservation.note || "";
  elements.reservationTechnicianSelect.value = reservation.technicianId;
  renderReservationServiceOptions(reservation.serviceId);
  updateReservationFormMode();
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
  await loadAdminData();
  setStatus("技師已刪除。", "success");
}

async function deleteReservation(reservationId, customerName) {
  const confirmed = window.confirm(`確定要刪除 ${customerName} 的預約嗎？`);
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
  elements.serviceForm.addEventListener("submit", async (event) => {
    try {
      await submitService(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.technicianForm.addEventListener("submit", async (event) => {
    try {
      await submitTechnician(event);
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

  elements.technicianResetButton.addEventListener("click", () => {
    resetTechnicianForm();
    setStatus("技師表單已重設。", "info");
  });

  elements.technicianServiceResetButton.addEventListener("click", () => {
    fillTechnicianServiceForm(elements.technicianServiceTechnicianSelect.value);
    setStatus("技師服務項目已重新載入。", "info");
  });

  elements.technicianServiceTechnicianSelect.addEventListener("change", (event) => {
    fillTechnicianServiceForm(event.target.value);
  });

  elements.reservationResetButton.addEventListener("click", () => {
    resetReservationForm();
    setStatus("預約表單已重設。", "info");
  });

  elements.reservationTechnicianSelect.addEventListener("change", () => {
    renderReservationServiceOptions();
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
  resetTechnicianForm();
  resetTechnicianServiceForm();
  resetReservationForm();

  if (state.gasUrl && state.password) {
    loadAdminData().catch((error) => setStatus(error.message, "error"));
    return;
  }

  setStatus("請檢查 admin/config.json 內的 gasWebAppUrl 與 adminPassword。", "info");
}

initializeApp();
