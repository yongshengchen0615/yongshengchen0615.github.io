const STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
};
const CONFIG_PATH = "./config.json";
const SLOT_INTERVAL_MINUTES = 30;
const AUTO_SYNC_INTERVAL_MS = 30000;

const state = {
  gasUrl: "",
  configGasUrl: "",
  liffId: "",
  technicians: [],
  services: [],
  schedules: [],
  reservations: [],
  selectedTechnicianId: "",
  selectedServiceIds: [],
  profile: null,
  user: null,
  isSubmittingBooking: false,
  isLoadingPublicData: false,
};

const elements = {
  applicationPanel: document.querySelector("#applicationPanel"),
  applicationForm: document.querySelector("#applicationForm"),
  applicationSubmitButton: document.querySelector("#applicationSubmitButton"),
  applicationStatusText: document.querySelector("#applicationStatusText"),
  bookingPanelTitle: document.querySelector("#bookingPanelTitle"),
  bookingPanelCopy: document.querySelector("#bookingPanelCopy"),
  bookingForm: document.querySelector("#bookingForm"),
  technicianSelect: document.querySelector("#technicianSelect"),
  serviceSelect: document.querySelector("#serviceSelect"),
  dateSelect: document.querySelector("#dateSelect"),
  timeSelect: document.querySelector("#timeSelect"),
  statusBox: document.querySelector("#statusBox"),
  approvalGate: document.querySelector("#approvalGate"),
  bookingSummary: document.querySelector("#bookingSummary"),
  bookingSubmitButton: document.querySelector("#bookingSubmitButton"),
  heroTechnicianCount: document.querySelector("#heroTechnicianCount"),
  heroServiceCount: document.querySelector("#heroServiceCount"),
  heroNextAvailableDate: document.querySelector("#heroNextAvailableDate"),
  overviewTechnician: document.querySelector("#overviewTechnician"),
  overviewServiceCount: document.querySelector("#overviewServiceCount"),
  overviewDateCount: document.querySelector("#overviewDateCount"),
  userAvatar: document.querySelector("#userAvatar"),
  userDisplayName: document.querySelector("#userDisplayName"),
  userStatusBadge: document.querySelector("#userStatusBadge"),
  userStatusText: document.querySelector("#userStatusText"),
  loginButton: document.querySelector("#loginButton"),
  refreshUserButton: document.querySelector("#refreshUserButton"),
};

function normalizeGasUrl(value) {
  return String(value || "").trim();
}

function normalizeLiffId(value) {
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
    state.liffId = normalizeLiffId(config.liffId);
  } catch (error) {
    state.configGasUrl = "";
    state.liffId = "";
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

function setApprovalGate(message, tone = "info") {
  elements.approvalGate.textContent = message;
  elements.approvalGate.dataset.tone = tone;
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

function isApprovedUser() {
  return state.user?.status === "已通過";
}

function updateSubmitState() {
  if (state.isSubmittingBooking) {
    elements.bookingSubmitButton.disabled = true;
    elements.bookingSubmitButton.textContent = "送出中...";
    return;
  }

  elements.bookingSubmitButton.disabled = !isApprovedUser();
  if (isApprovedUser()) {
    elements.bookingSubmitButton.textContent = "送出預約";
    return;
  }

  if (state.user?.status === "待審核") {
    elements.bookingSubmitButton.textContent = "等待管理員審核";
    return;
  }

  elements.bookingSubmitButton.textContent = "需先通過審核";
}

function hasCompletedApplication() {
  return Boolean(state.user && state.user.customerName && state.user.phone);
}

function fillApplicationForm() {
  if (!elements.applicationForm) {
    return;
  }

  elements.applicationForm.customerName.value = state.user?.customerName || state.profile?.displayName || "";
  elements.applicationForm.phone.value = state.user?.phone || "";
}

function fillBookingContactFields() {
  if (!elements.bookingForm) {
    return;
  }

  elements.bookingForm.customerName.value = state.user?.customerName || state.profile?.displayName || "";
  elements.bookingForm.phone.value = state.user?.phone || "";
}

function updateAccessView() {
  const canEnterBooking = isApprovedUser() && hasCompletedApplication();

  elements.applicationPanel.classList.toggle("is-hidden", canEnterBooking);
  elements.bookingForm.classList.toggle("is-hidden", !canEnterBooking);

  if (canEnterBooking) {
    elements.bookingPanelTitle.textContent = "填寫預約資訊";
    elements.bookingPanelCopy.textContent = "先選技師，系統會自動過濾這位技師可提供的服務、日期與時段。";
    fillBookingContactFields();
    return;
  }

  elements.bookingPanelTitle.textContent = "送出審核申請";
  elements.bookingPanelCopy.textContent = "先登入 LINE，並填寫稱呼與電話送出審核。管理員通過後才可進入預約畫面。";
  fillApplicationForm();
}

function renderUserState() {
  if (!state.profile) {
    elements.userDisplayName.textContent = "尚未登入 LINE";
    elements.userStatusBadge.textContent = "未登入";
    elements.userStatusBadge.dataset.tone = "muted";
    elements.userStatusText.textContent = "進入頁面後會直接要求 LINE 登入。";
    elements.userAvatar.classList.add("is-hidden");
    elements.loginButton.textContent = "LINE 登入";
    setApprovalGate("需先完成 LINE 登入，若尚未通過審核則需等待管理員通過。", "info");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = "請先登入 LINE，再填寫稱呼與電話送出審核。";
    }
    updateAccessView();
    updateSubmitState();
    return;
  }

  elements.userDisplayName.textContent = state.profile.displayName || "LINE 使用者";
  elements.loginButton.textContent = "切換 LINE 帳號";

  if (state.profile.pictureUrl) {
    elements.userAvatar.src = state.profile.pictureUrl;
    elements.userAvatar.classList.remove("is-hidden");
  } else {
    elements.userAvatar.classList.add("is-hidden");
  }

  if (!state.user) {
    elements.userStatusBadge.textContent = "同步中";
    elements.userStatusBadge.dataset.tone = "pending";
    elements.userStatusText.textContent = "正在同步你的 LINE 身分與審核狀態。";
    setApprovalGate("正在確認用戶狀態，若尚未通過審核則需等待管理員通過。", "pending");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = "正在讀取你的送審資料。";
    }
    updateAccessView();
    updateSubmitState();
    return;
  }

  elements.userStatusBadge.textContent = state.user.status;

  if (state.user.status === "已通過") {
    elements.userStatusBadge.dataset.tone = "approved";
    elements.userStatusText.textContent = "你的 LINE 帳號已通過審核，可以直接預約。";
    setApprovalGate("已通過審核，可以開始預約。", "approved");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = "你的送審資料已通過，系統會自動帶入稱呼與電話。";
    }
  } else if (state.user.status === "待審核") {
    elements.userStatusBadge.dataset.tone = "pending";
    elements.userStatusText.textContent = "你已完成 LINE 登入，目前需等待管理員通過審核。";
    setApprovalGate("目前為待審核狀態，請等待管理員通過後再預約。", "pending");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = hasCompletedApplication()
        ? "你的稱呼與電話已送出，正在等待管理員審核。"
        : "請先填寫稱呼與電話，送出審核申請。";
    }
  } else if (state.user.status === "未送審核") {
    elements.userStatusBadge.dataset.tone = "muted";
    elements.userStatusText.textContent = "請先填寫稱呼與電話送出審核，通過後才可進入預約畫面。";
    setApprovalGate("尚未送出審核資料，請先填寫稱呼與電話。", "info");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = "請先填寫稱呼與電話，送出給管理員審核。";
    }
  } else {
    elements.userStatusBadge.dataset.tone = "blocked";
    elements.userStatusText.textContent = state.user.note || "此 LINE 帳號目前無法預約，請聯絡店家。";
    setApprovalGate("此帳號目前不可預約，請聯絡管理員或店家。", "blocked");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = state.user.note || "此申請目前不可進入預約畫面，若需協助請聯絡店家。";
    }
  }

  updateAccessView();
  updateSubmitState();
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

function normalizeServiceIds(serviceIds) {
  return Array.from(new Set((serviceIds || []).filter(Boolean)));
}

function getSelectedServiceIds() {
  return Array.from(elements.serviceSelect.querySelectorAll('input[name="serviceIds"]:checked')).map(
    (input) => input.value
  );
}

function getServiceMetrics(serviceIds) {
  const selectedServices = normalizeServiceIds(serviceIds)
    .map((serviceId) => getServiceById(serviceId))
    .filter(Boolean);

  return {
    services: selectedServices,
    totalDuration: selectedServices.reduce((sum, service) => sum + Number(service.durationMinutes || 0), 0),
    totalPrice: selectedServices.reduce((sum, service) => sum + Number(service.price || 0), 0),
  };
}

function renderServiceOptions(selectedIds = []) {
  const allowedServices = state.selectedTechnicianId ? getAllowedServices(state.selectedTechnicianId) : [];
  const checked = new Set(normalizeServiceIds(selectedIds));

  if (!allowedServices.length) {
    elements.serviceSelect.innerHTML = '<div class="empty-state">請先選擇技師，或確認這位技師已有可預約服務。</div>';
    return;
  }

  elements.serviceSelect.innerHTML = `
    <div class="checkbox-grid">
      ${allowedServices
        .map(
          (service) => `
            <label class="checkbox-pill">
              <input type="checkbox" name="serviceIds" value="${service.serviceId}" ${
                checked.has(service.serviceId) ? "checked" : ""
              } />
              <span>${service.name}<small>${service.durationMinutes} 分鐘 / NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}</small></span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function getSchedulesForTechnician(technicianId) {
  return state.schedules
    .filter((item) => item.technicianId === technicianId && item.isWorking)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function getScheduleEndMinutes(timeText) {
  if (timeText === "23:59") {
    return 24 * 60;
  }
  return toMinutes(timeText);
}

function getReservationsForTechnicianAndDate(technicianId, date) {
  return state.reservations.filter(
    (item) => item.technicianId === technicianId && item.date === date && item.status !== "已取消"
  );
}

function getReservationOccupiedEnd(item) {
  const reservedStart = toMinutes(item.startTime);
  const calculatedEnd = reservedStart + getServiceMetrics(item.serviceIds || String(item.serviceId || "").split(",")).totalDuration;

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

function getAvailableDates(technicianId, serviceIds = state.selectedServiceIds) {
  const schedules = getSchedulesForTechnician(technicianId);
  if (!serviceIds.length) {
    return schedules.map((item) => item.date);
  }

  return schedules
    .filter((item) => getAvailableTimeSlots(technicianId, serviceIds, item.date).length > 0)
    .map((item) => item.date);
}

function hasConflict(candidateStart, candidateEnd, reservations) {
  return reservations.some((item) => {
    const reservedStart = toMinutes(item.startTime);
    const reservedEnd = getReservationOccupiedEnd(item);
    return candidateStart < reservedEnd && reservedStart < candidateEnd;
  });
}

function getAvailableTimeSlots(technicianId, serviceIds, date) {
  const metrics = getServiceMetrics(serviceIds);
  const schedule = getSchedulesForTechnician(technicianId).find((item) => item.date === date);

  if (!metrics.services.length || !schedule) return [];

  const shiftStart = toMinutes(schedule.startTime);
  const shiftEnd = getScheduleEndMinutes(schedule.endTime);
  const serviceDuration = metrics.totalDuration;
  const reservations = getReservationsForTechnicianAndDate(technicianId, date);
  const slots = [];

  for (let current = shiftStart; current + serviceDuration <= shiftEnd; current += SLOT_INTERVAL_MINUTES) {
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

function getNextAvailableDate() {
  const dates = [];

  getActiveTechnicians().forEach((technician) => {
    getAllowedServices(technician.technicianId).forEach((service) => {
      getAvailableDates(technician.technicianId, [service.serviceId]).forEach((date) => {
        dates.push(date);
      });
    });
  });

  if (!dates.length) {
    return "暫無可預約日期";
  }

  return dates.sort((left, right) => left.localeCompare(right))[0];
}

function updateDashboard() {
  const activeTechnicians = getActiveTechnicians();
  const activeServices = getActiveServices();
  const selectedTechnician = getTechnicianById(state.selectedTechnicianId);
  const availableServices = state.selectedTechnicianId ? getAllowedServices(state.selectedTechnicianId) : [];
  const selectedMetrics = getServiceMetrics(state.selectedServiceIds);
  const availableDates = state.selectedTechnicianId && state.selectedServiceIds.length
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds)
    : [];

  elements.heroTechnicianCount.textContent = String(activeTechnicians.length);
  elements.heroServiceCount.textContent = String(activeServices.length);
  elements.heroNextAvailableDate.textContent = getNextAvailableDate();

  elements.overviewTechnician.textContent = selectedTechnician ? selectedTechnician.name : "尚未選擇";
  elements.overviewServiceCount.textContent = `${selectedMetrics.services.length} / ${availableServices.length} 項`;
  elements.overviewDateCount.textContent = `${availableDates.length} 天`;
}

function setBookingSubmitting(isSubmitting) {
  state.isSubmittingBooking = isSubmitting;
  updateSubmitState();
}

function updateSummary() {
  const formData = new FormData(elements.bookingForm);
  const technician = getTechnicianById(formData.get("technicianId"));
  const metrics = getServiceMetrics(state.selectedServiceIds);
  const date = formData.get("date");
  const time = formData.get("startTime");

  if (!technician || !metrics.services.length || !date || !time) {
    elements.bookingSummary.innerHTML = `
      <div class="summary__header">
        <h3>預約摘要</h3>
        <span class="summary__badge">即時更新</span>
      </div>
      <p>尚未選定完整預約資訊。</p>
    `;
    updateDashboard();
    return;
  }

  const endTime = toTimeText(toMinutes(time) + metrics.totalDuration);
  elements.bookingSummary.innerHTML = `
    <div class="summary__header">
      <h3>預約摘要</h3>
      <span class="summary__badge">即時更新</span>
    </div>
    <dl class="summary__rows">
      <div class="summary__row"><dt>技師</dt><dd>${technician.name}</dd></div>
      <div class="summary__row"><dt>服務</dt><dd>${metrics.services.map((service) => service.name).join("、")}</dd></div>
      <div class="summary__row"><dt>日期</dt><dd>${date}</dd></div>
      <div class="summary__row"><dt>時段</dt><dd>${time} - ${endTime}</dd></div>
      <div class="summary__row"><dt>總時長</dt><dd>${metrics.totalDuration} 分鐘</dd></div>
      <div class="summary__row"><dt>總金額</dt><dd>NT$ ${Number(metrics.totalPrice || 0).toLocaleString("zh-TW")}</dd></div>
    </dl>
  `;
  updateDashboard();
}

function updateAvailabilityStatus() {
  if (!state.profile) {
    setStatus("進入頁面後需先完成 LINE 登入。", "info");
    return;
  }

  if (!state.user || state.user.status === "待審核") {
    setStatus("你已完成 LINE 登入，請等待管理員審核通過。", "info");
    return;
  }

  if (!isApprovedUser()) {
    setStatus("此 LINE 帳號目前無法預約，請聯絡店家。", "error");
    return;
  }

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

  if (!state.selectedServiceIds.length) {
    setStatus("請先選擇至少一個服務項目。", "info");
    return;
  }

  const availableDates = getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds);
  if (!availableDates.length) {
    setStatus("目前沒有可預約日期，請聯絡店家或稍後再試。", "info");
    return;
  }

  const selectedDate = elements.dateSelect.value;
  const availableTimeSlots = selectedDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceIds, selectedDate)
    : [];
  if (!availableTimeSlots.length) {
    setStatus("當日已無可預約時段，請改選其他日期。", "info");
    return;
  }

  setStatus("目前時段可預約，請確認資料後送出。", "success");
}

function refreshSelects() {
  const previousDate = elements.dateSelect.value;
  const previousTime = elements.timeSelect.value;

  const technicianOptions = getActiveTechnicians()
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hant"))
    .map((item) => ({
      value: item.technicianId,
      label: item.name,
    }));
  setOptions(elements.technicianSelect, technicianOptions, "請選擇技師");
  if (technicianOptions.some((item) => item.value === state.selectedTechnicianId)) {
    elements.technicianSelect.value = state.selectedTechnicianId;
  } else if (technicianOptions.length) {
    elements.technicianSelect.value = technicianOptions[0].value;
  } else {
    elements.technicianSelect.value = "";
  }
  state.selectedTechnicianId = elements.technicianSelect.value;

  const allowedServiceIds = new Set(getAllowedServices(state.selectedTechnicianId).map((item) => item.serviceId));
  state.selectedServiceIds = normalizeServiceIds(state.selectedServiceIds).filter((serviceId) => allowedServiceIds.has(serviceId));
  renderServiceOptions(state.selectedServiceIds);
  state.selectedServiceIds = getSelectedServiceIds();

  const dates = state.selectedTechnicianId
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds)
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
  const timeSlots = state.selectedTechnicianId && state.selectedServiceIds.length && currentDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceIds, currentDate)
    : [];
  setOptions(elements.timeSelect, timeSlots, "請選擇時段");

  if (timeSlots.some((item) => item.value === previousTime)) {
    elements.timeSelect.value = previousTime;
  } else if (timeSlots.length) {
    elements.timeSelect.value = timeSlots[0].value;
  }

  updateSummary();
  updateAvailabilityStatus();
  updateDashboard();
}

function syncDateAndTimeOptions() {
  const dates = state.selectedTechnicianId
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds)
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
  const timeSlots = state.selectedTechnicianId && state.selectedServiceIds.length && selectedDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceIds, selectedDate)
    : [];
  const previousTime = elements.timeSelect.value;
  setOptions(elements.timeSelect, timeSlots, "請選擇時段");
  if (timeSlots.some((item) => item.value === previousTime)) {
    elements.timeSelect.value = previousTime;
  } else if (timeSlots.length) {
    elements.timeSelect.value = timeSlots[0].value;
  }

  if (!timeSlots.length && selectedDate && isApprovedUser()) {
    setStatus("該日期已無可預約時段，請改選其他日期。", "info");
  }

  updateSummary();
  updateAvailabilityStatus();
  updateDashboard();
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

async function syncLineUser() {
  if (!state.profile) {
    return null;
  }

  const result = await requestApi("POST", {}, {
    action: "syncLineUser",
    payload: {
      userId: state.profile.userId,
      displayName: state.profile.displayName,
      pictureUrl: state.profile.pictureUrl || "",
    },
  });

  if (!result.ok) {
    throw new Error(result.message || "同步 LINE 用戶失敗");
  }

  state.user = result.data;
  renderUserState();
  updateAvailabilityStatus();
  return result.data;
}

async function submitUserApplication(event) {
  event.preventDefault();

  if (!state.profile) {
    setStatus("請先完成 LINE 登入。", "error");
    return;
  }

  const formData = new FormData(elements.applicationForm);
  const customerName = String(formData.get("customerName") || "").trim();
  const phone = String(formData.get("phone") || "").trim();

  if (!customerName || !phone) {
    setStatus("稱呼與電話號碼都必須填寫，才能送出審核。", "error");
    return;
  }

  elements.applicationSubmitButton.disabled = true;
  elements.applicationSubmitButton.textContent = "送審中...";
  setStatus("正在送出審核申請...", "info");

  try {
    const result = await requestApi("POST", {}, {
      action: "submitUserApplication",
      payload: {
        userId: state.profile.userId,
        displayName: state.profile.displayName,
        pictureUrl: state.profile.pictureUrl || "",
        customerName,
        phone,
      },
    });

    if (!result.ok) {
      throw new Error(result.message || "送出審核申請失敗");
    }

    state.user = result.data;
    renderUserState();
    updateAvailabilityStatus();
    setStatus(state.user.status === "已通過" ? "資料已更新，可直接進入預約畫面。" : "審核申請已送出，請等待管理員通過。", "success");
  } finally {
    elements.applicationSubmitButton.disabled = false;
    elements.applicationSubmitButton.textContent = state.user?.status === "已通過" ? "更新聯絡資料" : "送出審核申請";
  }
}

async function ensureLiffSession() {
  if (!state.liffId) {
    throw new Error("請先在 client/config.json 設定 liffId。");
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

  renderUserState();
  await syncLineUser();
  return true;
}

async function loadPublicData(options = {}) {
  const { silent = false } = options;
  if (state.isLoadingPublicData) {
    return;
  }

  state.isLoadingPublicData = true;
  if (!silent && isApprovedUser()) {
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

    const allowedServiceIds = new Set(getAllowedServices(state.selectedTechnicianId).map((item) => item.serviceId));
    state.selectedServiceIds = normalizeServiceIds(state.selectedServiceIds).filter((serviceId) => allowedServiceIds.has(serviceId));

    refreshSelects();
    if (!silent) {
      updateAvailabilityStatus();
    }
  } finally {
    state.isLoadingPublicData = false;
  }
}

async function refreshUserAndData(options = {}) {
  const { silent = false } = options;

  if (state.profile) {
    try {
      await syncLineUser();
    } catch (error) {
      if (!silent) {
        setStatus(error.message, "error");
      }
    }
  }

  await loadPublicData({ silent });
}

async function submitBooking(event) {
  event.preventDefault();

  if (!state.profile) {
    setStatus("請先完成 LINE 登入。", "error");
    return;
  }

  if (!state.user || state.user.status === "待審核") {
    setStatus("你已完成 LINE 登入，請等待管理員審核通過。", "error");
    return;
  }

  if (!isApprovedUser()) {
    setStatus("此 LINE 帳號目前無法預約，請聯絡店家。", "error");
    return;
  }

  const formData = new FormData(elements.bookingForm);
  const serviceIds = normalizeServiceIds(state.selectedServiceIds);

  if (!serviceIds.length) {
    setStatus("請先選擇至少一個服務項目。", "error");
    return;
  }

  const payload = {
    userId: state.user.userId,
    userDisplayName: state.user.displayName,
    customerName: formData.get("customerName").trim(),
    phone: formData.get("phone").trim(),
    technicianId: formData.get("technicianId"),
    serviceIds,
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    note: formData.get("note").trim(),
  };

  setStatus("正在送出預約...");
  setBookingSubmitting(true);

  try {
    const result = await requestApi("POST", {}, { action: "createReservation", payload });

    if (!result.ok) {
      throw new Error(result.message || "預約失敗");
    }

    setStatus(`預約成功，預約編號：${result.data.reservationId}`, "success");
    elements.bookingForm.reset();
    state.selectedTechnicianId = payload.technicianId;
    state.selectedServiceIds = [];
    await loadPublicData();
    fillBookingContactFields();
  } finally {
    setBookingSubmitting(false);
  }
}

function bindEvents() {
  elements.applicationForm.addEventListener("submit", async (event) => {
    try {
      await submitUserApplication(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.technicianSelect.addEventListener("change", (event) => {
    state.selectedTechnicianId = event.target.value;
    state.selectedServiceIds = [];
    refreshSelects();
  });

  elements.serviceSelect.addEventListener("change", (event) => {
    if (!event.target.matches('input[name="serviceIds"]')) {
      return;
    }

    state.selectedServiceIds = getSelectedServiceIds();
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

  elements.loginButton.addEventListener("click", async () => {
    try {
      if (!state.liffId) {
        throw new Error("請先在 client/config.json 設定 liffId。");
      }

      await window.liff.init({ liffId: state.liffId });
      if (window.liff.isLoggedIn()) {
        window.liff.logout();
        window.location.reload();
        return;
      }

      window.liff.login({ redirectUri: window.location.href });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.refreshUserButton.addEventListener("click", async () => {
    try {
      await refreshUserAndData({ silent: false });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  window.addEventListener("focus", () => {
    refreshUserAndData({ silent: true }).catch(() => {});
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshUserAndData({ silent: true }).catch(() => {});
    }
  });
}

function startAutoSync() {
  window.setInterval(() => {
    refreshUserAndData({ silent: true }).catch(() => {});
  }, AUTO_SYNC_INTERVAL_MS);
}

async function initializeApp() {
  await loadConfigFromJson();
  applyGasUrlPreference();
  bindEvents();
  startAutoSync();
  renderUserState();
  updateAccessView();

  if (!state.gasUrl) {
    refreshSelects();
    setStatus("尚未找到 GAS Web App URL，請檢查 client/config.json。", "info");
    updateDashboard();
    return;
  }

  const isLoggedIn = await ensureLiffSession();
  if (!isLoggedIn) {
    return;
  }

  await loadPublicData();
}

initializeApp().catch((error) => {
  console.error(error);
  setStatus("初始化應用程式時發生錯誤，請稍後再試。", "error");
});
