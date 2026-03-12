const STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
};
const CONFIG_PATH = "./config.json";
const SLOT_INTERVAL_MINUTES = 30;
const AUTO_SYNC_INTERVAL_MS = 30000;

const state = {
  gasUrl: "",
  configGasUrl: "",
  technicians: [],
  services: [],
  schedules: [],
  reservations: [],
  selectedTechnicianId: "",
  selectedServiceId: "",
  isLoadingPublicData: false,
};

const elements = {
  bookingForm: document.querySelector("#bookingForm"),
  technicianSelect: document.querySelector("#technicianSelect"),
  serviceSelect: document.querySelector("#serviceSelect"),
  dateSelect: document.querySelector("#dateSelect"),
  timeSelect: document.querySelector("#timeSelect"),
  statusBox: document.querySelector("#statusBox"),
  bookingSummary: document.querySelector("#bookingSummary"),
};

function normalizeGasUrl(value) {
  return String(value || "").trim();
}

async function loadGasUrlFromConfig() {
  try {
    const response = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`config load failed: ${response.status}`);
    }

    const config = await response.json();
    state.configGasUrl = normalizeGasUrl(config.gasWebAppUrl || config.gasUrl);
  } catch (error) {
    state.configGasUrl = "";
  }
}

function applyGasUrlPreference() {
  const savedGasUrl = normalizeGasUrl(localStorage.getItem(STORAGE_KEYS.gasUrl));
  if (state.configGasUrl) {
    state.gasUrl = state.configGasUrl;
    localStorage.setItem(STORAGE_KEYS.gasUrl, state.gasUrl);
  } else {
    state.gasUrl = savedGasUrl;
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

function getActiveTechnicians() {
  return state.technicians.filter((item) => item.active);
}

function getActiveServices() {
  return state.services.filter((item) => item.active);
}

function getTechnicianById(technicianId) {
  return state.technicians.find((item) => item.technicianId === technicianId);
}

function getServiceById(serviceId) {
  return state.services.find((item) => item.serviceId === serviceId);
}

function getAllowedServices(technicianId) {
  const technician = getTechnicianById(technicianId);
  if (!technician) return [];
  const allowed = new Set(technician.serviceIds || []);
  return getActiveServices().filter((service) => allowed.has(service.serviceId));
}

function getSchedulesForTechnician(technicianId) {
  return state.schedules
    .filter((item) => item.technicianId === technicianId && item.isWorking)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function getReservationsForTechnicianAndDate(technicianId, date) {
  return state.reservations.filter(
    (item) => item.technicianId === technicianId && item.date === date && item.status !== "cancelled"
  );
}

function getReservationOccupiedEnd(item) {
  const reservedStart = toMinutes(item.startTime);
  const serviceDuration = Number(getServiceById(item.serviceId)?.durationMinutes || 0);
  const calculatedEnd = reservedStart + serviceDuration;

  if (!item.endTime) {
    return calculatedEnd;
  }

  return Math.max(toMinutes(item.endTime), calculatedEnd);
}

function toMinutes(timeText) {
  const [hours, minutes] = timeText.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTimeText(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getAvailableDates(technicianId, serviceId = state.selectedServiceId) {
  const schedules = getSchedulesForTechnician(technicianId);
  if (!serviceId) {
    return schedules.map((item) => item.date);
  }

  return schedules
    .filter((item) => getAvailableTimeSlots(technicianId, serviceId, item.date).length > 0)
    .map((item) => item.date);
}

function hasConflict(candidateStart, candidateEnd, reservations) {
  return reservations.some((item) => {
    const reservedStart = toMinutes(item.startTime);
    const reservedEnd = getReservationOccupiedEnd(item);
    return candidateStart < reservedEnd && reservedStart < candidateEnd;
  });
}

function getAvailableTimeSlots(technicianId, serviceId, date) {
  const service = getServiceById(serviceId);
  const schedule = getSchedulesForTechnician(technicianId).find((item) => item.date === date);

  if (!service || !schedule) return [];

  const shiftStart = toMinutes(schedule.startTime);
  const shiftEnd = toMinutes(schedule.endTime);
  const serviceDuration = Number(service.durationMinutes || 0);
  const reservations = getReservationsForTechnicianAndDate(technicianId, date);
  const slots = [];

  for (
    let current = shiftStart;
    current + serviceDuration <= shiftEnd;
    current += SLOT_INTERVAL_MINUTES
  ) {
    const end = current + serviceDuration;
    if (!hasConflict(current, end, reservations)) {
      slots.push({
        value: toTimeText(current),
        label: `${toTimeText(current)} - ${toTimeText(end)}`,
      });
    }
  }

  return slots;
}

function updateSummary() {
  const formData = new FormData(elements.bookingForm);
  const technician = getTechnicianById(formData.get("technicianId"));
  const service = getServiceById(formData.get("serviceId"));
  const date = formData.get("date");
  const time = formData.get("startTime");

  if (!technician || !service || !date || !time) {
    elements.bookingSummary.innerHTML = "<h3>預約摘要</h3><p>尚未選定完整預約資訊。</p>";
    return;
  }

  const endTime = toTimeText(toMinutes(time) + Number(service.durationMinutes));
  elements.bookingSummary.innerHTML = `
    <h3>預約摘要</h3>
    <p>技師：${technician.name}</p>
    <p>服務：${service.name}</p>
    <p>日期：${date}</p>
    <p>時段：${time} - ${endTime}</p>
    <p>時長：約 ${service.durationMinutes} 分鐘</p>
    <p>價格：NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}</p>
  `;
}

function updateAvailabilityStatus() {
  const activeTechnicians = getActiveTechnicians();
  if (!activeTechnicians.length) {
    setStatus("目前沒有可預約的技師。", "info");
    return;
  }

  if (!state.selectedTechnicianId) {
    setStatus("請先選擇技師。", "info");
    return;
  }

  const allowedServices = getAllowedServices(state.selectedTechnicianId);
  if (!allowedServices.length) {
    setStatus("這位技師目前沒有啟用中的服務項目。", "info");
    return;
  }

  if (!state.selectedServiceId) {
    setStatus("請先選擇服務項目。", "info");
    return;
  }

  const availableDates = getAvailableDates(state.selectedTechnicianId, state.selectedServiceId);
  if (!availableDates.length) {
    setStatus("目前沒有可預約日期，請聯絡店家或稍後再試。", "info");
    return;
  }

  const selectedDate = elements.dateSelect.value;
  const availableTimeSlots = selectedDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceId, selectedDate)
    : [];
  if (!availableTimeSlots.length) {
    setStatus("當日已無可預約時段，請改選其他日期。", "info");
    return;
  }
}

function refreshSelects() {
  const previousDate = elements.dateSelect.value;
  const previousTime = elements.timeSelect.value;

  const technicianOptions = getActiveTechnicians().map((item) => ({
    value: item.technicianId,
    label: item.name,
  }));
  setOptions(elements.technicianSelect, technicianOptions, "請選擇技師");
  if (technicianOptions.some((item) => item.value === state.selectedTechnicianId)) {
    elements.technicianSelect.value = state.selectedTechnicianId;
  } else if (technicianOptions.length) {
    elements.technicianSelect.value = technicianOptions[0].value;
  }
  state.selectedTechnicianId = elements.technicianSelect.value;

  const serviceOptions = state.selectedTechnicianId
    ? getAllowedServices(state.selectedTechnicianId).map((item) => ({
        value: item.serviceId,
        label: `${item.name} / ${item.durationMinutes} 分鐘 / NT$ ${item.price}`,
      }))
    : [];
  setOptions(elements.serviceSelect, serviceOptions, "請選擇服務");
  if (serviceOptions.some((item) => item.value === state.selectedServiceId)) {
    elements.serviceSelect.value = state.selectedServiceId;
  } else if (serviceOptions.length) {
    elements.serviceSelect.value = serviceOptions[0].value;
  }
  state.selectedServiceId = elements.serviceSelect.value;

  const dates = state.selectedTechnicianId
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceId)
    : [];
  setOptions(
    elements.dateSelect,
    dates.map((item) => ({ value: item, label: item })),
    "請選擇日期"
  );

  if (dates.includes(previousDate)) {
    elements.dateSelect.value = previousDate;
  } else if (dates.length) {
    elements.dateSelect.value = dates[0];
  }

  const currentDate = elements.dateSelect.value;
  const timeSlots = state.selectedTechnicianId && state.selectedServiceId && currentDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceId, currentDate)
    : [];
  setOptions(elements.timeSelect, timeSlots, "請選擇時段");

  if (timeSlots.some((item) => item.value === previousTime)) {
    elements.timeSelect.value = previousTime;
  } else if (timeSlots.length) {
    elements.timeSelect.value = timeSlots[0].value;
  }

  updateSummary();
  updateAvailabilityStatus();
}

function syncDateAndTimeOptions() {
  const dates = state.selectedTechnicianId
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceId)
    : [];
  const previousDate = elements.dateSelect.value;
  setOptions(
    elements.dateSelect,
    dates.map((item) => ({ value: item, label: item })),
    "請選擇日期"
  );
  if (dates.includes(previousDate)) {
    elements.dateSelect.value = previousDate;
  } else if (dates.length) {
    elements.dateSelect.value = dates[0];
  }

  const selectedDate = elements.dateSelect.value;
  const timeSlots = state.selectedTechnicianId && state.selectedServiceId && selectedDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceId, selectedDate)
    : [];
  const previousTime = elements.timeSelect.value;
  setOptions(elements.timeSelect, timeSlots, "請選擇時段");
  if (timeSlots.some((item) => item.value === previousTime)) {
    elements.timeSelect.value = previousTime;
  } else if (timeSlots.length) {
    elements.timeSelect.value = timeSlots[0].value;
  }

  if (!timeSlots.length && selectedDate) {
    setStatus("該日期已無可預約時段，請改選其他日期。", "info");
  }

  updateSummary();
  updateAvailabilityStatus();
}

async function requestApi(method, params = {}, body = null) {
  if (!state.gasUrl) {
    throw new Error("請先設定 GAS Web App URL");
  }

  if (method === "GET") {
    const url = new URL(state.gasUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url.toString());
    return response.json();
  }

  const response = await fetch(state.gasUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function loadPublicData(options = {}) {
  const { silent = false } = options;
  if (state.isLoadingPublicData) {
    return;
  }

  state.isLoadingPublicData = true;
  if (!silent) {
    setStatus("正在載入可預約資料...");
  }

  try {
    const result = await requestApi("GET", { action: "publicData" });

    if (!result.ok) {
      throw new Error(result.message || "載入失敗");
    }

    state.technicians = result.data.technicians || [];
    state.services = result.data.services || [];
    state.schedules = result.data.schedules || [];
    state.reservations = result.data.reservations || [];

    if (!getActiveTechnicians().some((item) => item.technicianId === state.selectedTechnicianId)) {
      state.selectedTechnicianId = getActiveTechnicians()[0]?.technicianId || "";
    }

    if (!getAllowedServices(state.selectedTechnicianId).some((item) => item.serviceId === state.selectedServiceId)) {
      state.selectedServiceId = getAllowedServices(state.selectedTechnicianId)[0]?.serviceId || "";
    }

    refreshSelects();
    if (!silent) {
      setStatus("資料已更新，可以開始預約。", "success");
    }
  } finally {
    state.isLoadingPublicData = false;
  }
}

async function submitBooking(event) {
  event.preventDefault();
  const formData = new FormData(elements.bookingForm);
  const service = getServiceById(formData.get("serviceId"));

  if (!service) {
    setStatus("請先選擇服務項目。", "error");
    return;
  }

  const payload = {
    customerName: formData.get("customerName").trim(),
    phone: formData.get("phone").trim(),
    technicianId: formData.get("technicianId"),
    serviceId: formData.get("serviceId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    note: formData.get("note").trim(),
  };

  setStatus("正在送出預約...");
  const result = await requestApi("POST", {}, { action: "createReservation", payload });

  if (!result.ok) {
    throw new Error(result.message || "預約失敗");
  }

  setStatus(`預約成功，預約編號：${result.data.reservationId}`, "success");
  elements.bookingForm.reset();
  state.selectedTechnicianId = payload.technicianId;
  state.selectedServiceId = payload.serviceId;
  await loadPublicData();
}

function bindEvents() {
  elements.technicianSelect.addEventListener("change", (event) => {
    state.selectedTechnicianId = event.target.value;
    state.selectedServiceId = getAllowedServices(state.selectedTechnicianId)[0]?.serviceId || "";
    refreshSelects();
  });

  elements.serviceSelect.addEventListener("change", (event) => {
    state.selectedServiceId = event.target.value;
    syncDateAndTimeOptions();
  });

  elements.dateSelect.addEventListener("change", syncDateAndTimeOptions);
  elements.timeSelect.addEventListener("change", updateSummary);
  elements.bookingForm.addEventListener("input", updateSummary);
  elements.bookingForm.addEventListener("submit", async (event) => {
    try {
      await submitBooking(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  window.addEventListener("focus", () => {
    loadPublicData({ silent: true }).catch(() => {});
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadPublicData({ silent: true }).catch(() => {});
    }
  });
}

function startAutoSync() {
  window.setInterval(() => {
    loadPublicData({ silent: true }).catch(() => {});
  }, AUTO_SYNC_INTERVAL_MS);
}

async function initializeApp() {
  await loadGasUrlFromConfig();
  applyGasUrlPreference();
  bindEvents();
  startAutoSync();

  if (state.gasUrl) {
    loadPublicData().catch((error) => setStatus(error.message, "error"));
    return;
  }

  refreshSelects();
  setStatus("尚未找到 GAS Web App URL，請檢查 client/config.json。", "info");
}

initializeApp();
