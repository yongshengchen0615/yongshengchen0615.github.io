const STORAGE_KEYS = {
  gasUrl: "beauty-booking-gas-url",
};
const CONFIG_PATH = "./config.json";
const SLOT_INTERVAL_MINUTES = 30;
const AUTO_SYNC_INTERVAL_MS = 120000;
const MIN_SILENT_REFRESH_INTERVAL_MS = 20000;
const UNSPECIFIED_TECHNICIAN_VALUE = "__ANY_TECHNICIAN__";

const state = {
  gasUrl: "",
  configGasUrl: "",
  liffId: "",
  liffLoginRequired: true,
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
  lastSilentRefreshAt: 0,
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
  dateScheduleHint: document.querySelector("#dateScheduleHint"),
  timeSelect: document.querySelector("#timeSelect"),
  statusBox: document.querySelector("#statusBox"),
  approvalGate: document.querySelector("#approvalGate"),
  bookingSummary: document.querySelector("#bookingSummary"),
  bookingSubmitButton: document.querySelector("#bookingSubmitButton"),
  reservationHistoryCopy: document.querySelector("#reservationHistoryCopy"),
  reservationHistoryList: document.querySelector("#reservationHistoryList"),
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

function normalizePhoneInput(value) {
  return String(value || "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248))
    .replace(/＋/g, "+")
    .replace(/－/g, "-")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/＃/g, "#")
    .replace(/[\u3000\t\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDisplayDate(dateText) {
  const normalizedDate = String(dateText || "").trim();
  const match = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return normalizedDate || "未指定";
  }

  const [, yearText, monthText, dayText] = match;
  const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${normalizedDate} (${weekdays[date.getDay()]})`;
}

function formatDateTimeText(dateText, startTime, endTime) {
  const dateLabel = formatDisplayDate(dateText);
  if (!startTime) {
    return dateLabel;
  }

  return `${dateLabel} ${startTime}${endTime ? ` - ${endTime}` : ""}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  if (placeholder) {
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);
  }

  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    select.appendChild(item);
  });
}

function isSpecificTechnicianSelected(technicianId) {
  return Boolean(technicianId) && technicianId !== UNSPECIFIED_TECHNICIAN_VALUE;
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
  elements.applicationForm.phone.value = normalizePhoneInput(state.user?.phone || "");
}

function fillBookingContactFields() {
  if (!elements.bookingForm) {
    return;
  }

  elements.bookingForm.customerName.value = state.user?.customerName || state.profile?.displayName || "";
  elements.bookingForm.phone.value = normalizePhoneInput(state.user?.phone || "");
}

function updateAccessView() {
  const canEnterBooking = isApprovedUser() && hasCompletedApplication();

  elements.applicationPanel.classList.toggle("is-hidden", canEnterBooking);
  elements.bookingForm.classList.toggle("is-hidden", !canEnterBooking);

  if (canEnterBooking) {
    elements.bookingPanelTitle.textContent = "填寫預約資訊";
    elements.bookingPanelCopy.textContent = "依序選擇技師、服務、日期時段，再確認聯絡資料即可送出；也可選擇不指定技師，由現場安排。";
    fillBookingContactFields();
    return;
  }

  elements.bookingPanelTitle.textContent = "送出審核申請";
  elements.bookingPanelCopy.textContent = "先完成 LINE 登入，再填寫稱呼與電話送出審核。管理員通過後才可正式預約。";
  fillApplicationForm();
}

function getUserReservations() {
  const currentUserId = String(state.user?.userId || state.profile?.userId || "").trim();
  if (!currentUserId) {
    return [];
  }

  return state.reservations
    .filter((item) => String(item.userId || "").trim() === currentUserId)
    .slice()
    .sort((left, right) => {
      const rightKey = `${String(right.date || "")} ${String(right.startTime || "")}`;
      const leftKey = `${String(left.date || "")} ${String(left.startTime || "")}`;
      return rightKey.localeCompare(leftKey, "zh-Hant");
    });
}

function getReservationStatusTone(status) {
  if (status === "已完成") {
    return "approved";
  }

  if (status === "已取消") {
    return "blocked";
  }

  return "pending";
}

function getReservationServiceSummary(reservation) {
  const metrics = getServiceMetrics(reservation.serviceIds || String(reservation.serviceId || "").split(","));
  const serviceNames = metrics.services.length
    ? metrics.services.map((service) => formatServiceLabel(service)).join("、")
    : String(reservation.serviceName || "").trim() || "未指定服務";

  return {
    serviceNames,
    totalDuration: metrics.totalDuration || Math.max(toMinutes(reservation.endTime || reservation.startTime || "00:00") - toMinutes(reservation.startTime || "00:00"), 0),
    totalPrice: metrics.services.length ? metrics.totalPrice : null,
  };
}

function getReservationTechnicianLabel(reservation) {
  if (reservation.assignmentType === "現場安排") {
    return "現場安排";
  }

  const technician = getTechnicianById(reservation.technicianId);
  return reservation.technicianName || getTechnicianDisplayName(technician);
}

function renderReservationHistory() {
  if (!elements.reservationHistoryList || !elements.reservationHistoryCopy) {
    return;
  }

  if (!state.profile) {
    elements.reservationHistoryCopy.textContent = "登入後可查看自己的預約狀態、預約時間與服務內容。";
    elements.reservationHistoryList.innerHTML = '<div class="empty-state">請先完成 LINE 登入後查看預約紀錄。</div>';
    return;
  }

  if (!state.user) {
    elements.reservationHistoryCopy.textContent = "系統正在同步你的預約紀錄。";
    elements.reservationHistoryList.innerHTML = '<div class="empty-state">正在讀取你的預約紀錄。</div>';
    return;
  }

  const reservations = getUserReservations();
  if (!reservations.length) {
    elements.reservationHistoryCopy.textContent = "這裡會列出你送出過的預約，方便你確認目前狀態。";
    elements.reservationHistoryList.innerHTML = '<div class="empty-state">目前還沒有你的預約紀錄。</div>';
    return;
  }

  elements.reservationHistoryCopy.textContent = `目前共有 ${reservations.length} 筆預約紀錄，最新的預約會顯示在最前面。`;
  elements.reservationHistoryList.innerHTML = reservations
    .map((reservation) => {
      const serviceSummary = getReservationServiceSummary(reservation);
      const technicianLabel = getReservationTechnicianLabel(reservation);
      const reservationId = escapeHtml(reservation.reservationId || "未提供編號");
      const reservationStatus = escapeHtml(reservation.status || "已預約");
      const reservationTime = escapeHtml(formatDateTimeText(reservation.date, reservation.startTime, reservation.endTime));
      const technicianText = escapeHtml(technicianLabel);
      const serviceText = escapeHtml(serviceSummary.serviceNames);
      const customerName = escapeHtml(reservation.customerName || state.user.customerName || "未提供");
      const noteText = reservation.note ? escapeHtml(reservation.note) : "";
      return `
        <article class="reservation-status-item">
          <div class="summary__header">
            <h3>${reservationId}</h3>
            <span class="status-badge" data-tone="${getReservationStatusTone(reservation.status)}">${reservationStatus}</span>
          </div>
          <dl class="reservation-status-item__rows">
            <div><dt>預約時間</dt><dd>${reservationTime}</dd></div>
            <div><dt>技師</dt><dd>${technicianText}</dd></div>
            <div><dt>服務</dt><dd>${serviceText}</dd></div>
            <div><dt>總時長</dt><dd>${serviceSummary.totalDuration ? `${serviceSummary.totalDuration} 分鐘` : "未提供"}</dd></div>
            <div><dt>金額</dt><dd>${serviceSummary.totalPrice !== null ? `NT$ ${Number(serviceSummary.totalPrice).toLocaleString("zh-TW")}` : "依現場確認"}</dd></div>
            <div><dt>聯絡人</dt><dd>${customerName}</dd></div>
            ${reservation.note ? `<div><dt>備註</dt><dd>${noteText}</dd></div>` : ""}
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderUserState() {
  if (!state.profile) {
    elements.userDisplayName.textContent = "尚未登入 LINE";
    elements.userStatusBadge.textContent = "未登入";
    elements.userStatusBadge.dataset.tone = "muted";
    elements.userStatusText.textContent = "請先完成 LINE 登入，系統才能同步你的預約資格。";
    elements.userAvatar.classList.add("is-hidden");
    elements.loginButton.textContent = "LINE 登入";
    setApprovalGate("需先完成 LINE 登入，若尚未通過審核則需等待管理員通過。", "info");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = "請先登入 LINE，再填寫稱呼與電話送出審核。";
    }
    updateAccessView();
    updateSubmitState();
    renderReservationHistory();
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
    renderReservationHistory();
    return;
  }

  elements.userStatusBadge.textContent = state.user.status;

  if (state.user.status === "已通過") {
    elements.userStatusBadge.dataset.tone = "approved";
    elements.userStatusText.textContent = "你的 LINE 帳號已通過審核，可以直接進入預約流程。";
    setApprovalGate("已通過審核，可以開始預約。", "approved");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = "你的審核已通過，系統會自動帶入稱呼與電話。";
    }
  } else if (state.user.status === "待審核") {
    elements.userStatusBadge.dataset.tone = "pending";
    elements.userStatusText.textContent = "你已完成登入，目前正在等待管理員審核。";
    setApprovalGate("目前為待審核狀態，請等待管理員通過後再預約。", "pending");
    if (elements.applicationStatusText) {
      elements.applicationStatusText.textContent = hasCompletedApplication()
        ? "你的稱呼與電話已送出，正在等待管理員審核。"
        : "請先填寫稱呼與電話，送出審核申請。";
    }
  } else if (state.user.status === "未送審核") {
    elements.userStatusBadge.dataset.tone = "muted";
    elements.userStatusText.textContent = "請先填寫稱呼與電話送出審核，通過後才可開始預約。";
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
  renderReservationHistory();
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

function getTechnicianDisplayName(technician) {
  return String(technician?.name || technician?.profileDisplayName || "").trim() || "未指定";
}

function getServiceById(serviceId) {
  return state.services.find((item) => item.serviceId === serviceId);
}

function getServiceCategory(service) {
  return String(service?.category || "").trim() || "未分類";
}

function getEligibleTechnicians(serviceIds = [], technicianId = state.selectedTechnicianId) {
  const normalizedServiceIds = normalizeServiceIds(serviceIds);
  const baseTechnicians = isSpecificTechnicianSelected(technicianId)
    ? getActiveTechnicians().filter((item) => item.technicianId === technicianId)
    : getActiveTechnicians();

  if (!normalizedServiceIds.length) {
    return baseTechnicians;
  }

  return baseTechnicians.filter((technician) => {
    return normalizedServiceIds.every((serviceId) => (technician.serviceIds || []).includes(serviceId));
  });
}

function getAllowedServices(technicianId, selectedServiceIds = []) {
  const normalizedSelectedServiceIds = normalizeServiceIds(selectedServiceIds);
  const eligibleTechnicians = getEligibleTechnicians(normalizedSelectedServiceIds, technicianId);
  if (!eligibleTechnicians.length) return [];

  return getActiveServices().filter((service) => {
    const combinedServiceIds = normalizedSelectedServiceIds.includes(service.serviceId)
      ? normalizedSelectedServiceIds
      : normalizedSelectedServiceIds.concat(service.serviceId);

    return eligibleTechnicians.some((technician) => {
      return combinedServiceIds.every((serviceId) => (technician.serviceIds || []).includes(serviceId));
    });
  });
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

function formatServiceLabel(service) {
  return `[${getServiceCategory(service)}] ${service.name}`;
}

function renderServiceOptions(selectedIds = []) {
  const allowedServices = getAllowedServices(state.selectedTechnicianId, selectedIds);
  const checked = new Set(normalizeServiceIds(selectedIds));

  if (!allowedServices.length) {
    elements.serviceSelect.innerHTML = '<div class="empty-state">目前沒有符合條件的可預約服務，請改選技師或稍後再試。</div>';
    return;
  }

  const groupedServices = allowedServices.reduce((result, service) => {
    const category = getServiceCategory(service);
    if (!result[category]) {
      result[category] = [];
    }
    result[category].push(service);
    return result;
  }, {});

  elements.serviceSelect.innerHTML = `
    <div class="service-category-list">
      ${Object.entries(groupedServices)
        .sort(([left], [right]) => left.localeCompare(right, "zh-Hant"))
        .map(
          ([category, services]) => `
            <section class="service-category-block">
              <div class="service-category-block__header">
                <strong>${category}</strong>
                <small>${services.length} 項服務</small>
              </div>
              <div class="checkbox-grid">
                ${services
                  .map(
                    (service) => `
                      <label class="checkbox-pill checkbox-pill--service">
                        <input type="checkbox" name="serviceIds" value="${service.serviceId}" ${
                          checked.has(service.serviceId) ? "checked" : ""
                        } />
                        <span>
                          <strong>${service.name}</strong>
                          <small class="service-category-tag">${category}</small>
                          <small>${service.durationMinutes} 分鐘 / NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}</small>
                        </span>
                      </label>
                    `
                  )
                  .join("")}
              </div>
            </section>
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

function getScheduleForTechnicianAndDate(technicianId, date) {
  return getSchedulesForTechnician(technicianId).find((item) => item.date === date);
}

function getShiftEndMinutes(startTime, endTime) {
  const shiftStart = toMinutes(startTime);
  let shiftEnd = endTime === "23:59" ? 24 * 60 : toMinutes(endTime);

  if (shiftEnd <= shiftStart) {
    shiftEnd += 24 * 60;
  }

  return shiftEnd;
}

function isOvernightShift(startTime, endTime) {
  return getShiftEndMinutes(startTime, endTime) > 24 * 60;
}

function addDaysToDate(dateText, offsetDays) {
  const baseDate = new Date(`${dateText}T00:00:00`);
  baseDate.setDate(baseDate.getDate() + Number(offsetDays || 0));
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, "0");
  const day = String(baseDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentDateText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPastDate(dateText) {
  return String(dateText || "") < getCurrentDateText();
}

function isExpiredDateTime(dateText, timeText) {
  if (!dateText || !timeText) {
    return false;
  }

  if (isPastDate(dateText)) {
    return true;
  }

  if (dateText !== getCurrentDateText()) {
    return false;
  }

  return toMinutes(timeText) <= new Date().getHours() * 60 + new Date().getMinutes();
}

function getScheduleCoverageForDate(schedule, actualDate) {
  const shiftStart = toMinutes(schedule.startTime);
  const shiftEnd = getShiftEndMinutes(schedule.startTime, schedule.endTime);

  if (schedule.date === actualDate) {
    return {
      start: shiftStart,
      end: shiftEnd,
    };
  }

  if (isOvernightShift(schedule.startTime, schedule.endTime) && addDaysToDate(schedule.date, 1) === actualDate) {
    return {
      start: 0,
      end: shiftEnd - 24 * 60,
    };
  }

  return null;
}

function getSchedulesForTechnicianOnDate(technicianId, actualDate) {
  return getSchedulesForTechnician(technicianId).filter((schedule) => Boolean(getScheduleCoverageForDate(schedule, actualDate)));
}

function getTechnicianScheduleCoveragesOnDate(technicianId, actualDate) {
  return getSchedulesForTechnicianOnDate(technicianId, actualDate)
    .map((schedule) => getScheduleCoverageForDate(schedule, actualDate))
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

function formatScheduleCoverageLabel(coverage) {
  if (!coverage) {
    return "";
  }

  return `${toTimeText(coverage.start)} - ${toTimeText(coverage.end)}${coverage.end > 24 * 60 ? " (跨日)" : ""}`;
}

function getTechnicianWorkingHoursText(technicianId, actualDate) {
  if (!isSpecificTechnicianSelected(technicianId) || !actualDate) {
    return "";
  }

  return getTechnicianScheduleCoveragesOnDate(technicianId, actualDate)
    .map((coverage) => formatScheduleCoverageLabel(coverage))
    .filter(Boolean)
    .join("、");
}

function updateDateScheduleHint() {
  if (!elements.dateScheduleHint) {
    return;
  }

  const technicianId = elements.technicianSelect?.value || state.selectedTechnicianId;
  const date = elements.dateSelect?.value || "";

  if (!isSpecificTechnicianSelected(technicianId)) {
    elements.dateScheduleHint.classList.add("is-hidden");
    elements.dateScheduleHint.innerHTML = "";
    delete elements.dateScheduleHint.dataset.tone;
    return;
  }

  const technician = getTechnicianById(technicianId);
  const technicianName = getTechnicianDisplayName(technician);

  if (!date) {
    elements.dateScheduleHint.classList.remove("is-hidden");
    elements.dateScheduleHint.dataset.tone = "muted";
    elements.dateScheduleHint.innerHTML = `<strong>${escapeHtml(technicianName)} 班表</strong><span>選擇日期後會顯示當日上班時段。</span>`;
    return;
  }

  const workingHoursText = getTechnicianWorkingHoursText(technicianId, date);
  elements.dateScheduleHint.classList.remove("is-hidden");
  elements.dateScheduleHint.dataset.tone = workingHoursText ? "info" : "muted";
  elements.dateScheduleHint.innerHTML = workingHoursText
    ? `<strong>${escapeHtml(formatDisplayDate(date))} 班表</strong><span>${escapeHtml(technicianName)}：${escapeHtml(workingHoursText)}</span>`
    : `<strong>${escapeHtml(formatDisplayDate(date))} 班表</strong><span>${escapeHtml(technicianName)} 當日未排班。</span>`;
}

function evaluateReservationWithinTechnicianSchedule(technicianId, actualDate, startTime, durationMinutes) {
  const coverages = getTechnicianScheduleCoveragesOnDate(technicianId, actualDate);
  if (!coverages.length) {
    return { ok: false, reason: "no-schedule" };
  }

  const reservationStart = toMinutes(startTime);
  const reservationEnd = reservationStart + Number(durationMinutes || 0);
  const isWithinCoverage = coverages.some((coverage) => {
    return reservationStart >= coverage.start && reservationEnd <= coverage.end;
  });

  return isWithinCoverage
    ? { ok: true }
    : { ok: false, reason: "out-of-range" };
}

function getReservationsForTechnicianNearDate(technicianId, date) {
  return state.reservations.filter(
    (item) => item.technicianId === technicianId
      && item.status !== "已取消"
      && (item.date === date || addDaysToDate(item.date, 1) === date)
  );
}

function getReservationOccupiedEnd(item) {
  const reservedStart = toMinutes(item.startTime);
  const calculatedEnd = reservedStart + getServiceMetrics(item.serviceIds || String(item.serviceId || "").split(",")).totalDuration;

  if (!item.endTime) {
    return calculatedEnd;
  }

  let storedEnd = toMinutes(item.endTime);
  if (storedEnd <= reservedStart) {
    storedEnd += 24 * 60;
  }

  return Math.max(storedEnd, calculatedEnd);
}

function getReservationCoverageForDate(item, actualDate) {
  const reservationStart = toMinutes(item.startTime);
  const reservationEnd = getReservationOccupiedEnd(item);

  if (item.date === actualDate) {
    return {
      start: reservationStart,
      end: reservationEnd,
    };
  }

  if (addDaysToDate(item.date, 1) === actualDate && reservationEnd > 24 * 60) {
    return {
      start: 0,
      end: reservationEnd - 24 * 60,
    };
  }

  return null;
}

function toMinutes(timeText) {
  const [hours, minutes] = timeText.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTimeText(totalMinutes) {
  const normalizedMinutes = ((Number(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = String(Math.floor(normalizedMinutes / 60)).padStart(2, "0");
  const minutes = String(normalizedMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getAvailableDates(technicianId, serviceIds = state.selectedServiceIds) {
  const eligibleTechnicians = getEligibleTechnicians(serviceIds, technicianId);
  const scheduleDates = [];

  eligibleTechnicians.forEach((technician) => {
    getSchedulesForTechnician(technician.technicianId).forEach((schedule) => {
      scheduleDates.push(schedule.date);
      if (isOvernightShift(schedule.startTime, schedule.endTime)) {
        scheduleDates.push(addDaysToDate(schedule.date, 1));
      }
    });
  });

  const dates = Array.from(new Set(scheduleDates))
    .filter((date) => !isPastDate(date))
    .sort((left, right) => left.localeCompare(right));
  if (!serviceIds.length) {
    return dates;
  }

  return dates.filter((date) => getAvailableTimeSlots(technicianId, serviceIds, date).length > 0);
}

function hasConflict(candidateStart, candidateEnd, reservations) {
  return reservations.some((item) => {
    return candidateStart < item.end && item.start < candidateEnd;
  });
}

function getAvailableTimeSlots(technicianId, serviceIds, date) {
  const metrics = getServiceMetrics(serviceIds);
  if (!metrics.services.length) return [];

  const serviceDuration = metrics.totalDuration;
  const eligibleTechnicians = getEligibleTechnicians(serviceIds, technicianId);
  const slotMap = new Map();

  eligibleTechnicians.forEach((technician) => {
    const baseCoverages = getReservationsForTechnicianNearDate(technician.technicianId, date)
      .map((item) => getReservationCoverageForDate(item, date))
      .filter(Boolean);

    // 跨日衝突偵測：當班表跨午夜時，也需排除隔日已有的預約
    const nextDate = addDaysToDate(date, 1);
    const nextDayCoverages = state.reservations
      .filter((item) => item.technicianId === technician.technicianId && item.status !== "已取消" && item.date === nextDate)
      .map((item) => ({
        start: toMinutes(item.startTime) + 24 * 60,
        end: getReservationOccupiedEnd(item) + 24 * 60,
      }));

    const reservations = baseCoverages.concat(nextDayCoverages);

    getSchedulesForTechnicianOnDate(technician.technicianId, date).forEach((schedule) => {
      const coverage = getScheduleCoverageForDate(schedule, date);
      if (!coverage) {
        return;
      }

      for (let current = coverage.start; current + serviceDuration <= coverage.end; current += SLOT_INTERVAL_MINUTES) {
        const end = current + serviceDuration;
        if (!hasConflict(current, end, reservations) && !isExpiredDateTime(date, toTimeText(current))) {
          const timeValue = toTimeText(current);
          if (!slotMap.has(timeValue)) {
            slotMap.set(timeValue, {
              value: timeValue,
              label: `${timeValue} - ${toTimeText(end)}`,
            });
          }
        }
      }
    });
  });

  return Array.from(slotMap.values()).sort((left, right) => left.value.localeCompare(right.value));
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
  return getNextAvailableDate();
}

function setBookingSubmitting(isSubmitting) {
  state.isSubmittingBooking = isSubmitting;
  elements.bookingSubmitButton.classList.toggle("button--submitting", isSubmitting);
  updateSubmitState();
}

function renderPendingSummary(metrics, date, time, technicianId) {
  let lead = "先從 Step 1 開始，選擇技師，再勾選至少一個服務項目。";

  if (metrics.services.length && !date) {
    lead = "已選好技師與服務，接著請從 Step 2 挑選可預約日期。";
  } else if (metrics.services.length && date && !time) {
    lead = "日期已選定，接著請選擇可預約時段。";
  }

  const rows = [];
  if (metrics.services.length) {
    rows.push(`<div class="summary__row"><dt>已選服務</dt><dd>${metrics.services.map((service) => formatServiceLabel(service)).join("、")}</dd></div>`);
    rows.push(`<div class="summary__row"><dt>總時長</dt><dd>${metrics.totalDuration} 分鐘</dd></div>`);
    rows.push(`<div class="summary__row"><dt>預估金額</dt><dd>NT$ ${Number(metrics.totalPrice || 0).toLocaleString("zh-TW")}</dd></div>`);
  }

  if (date) {
    rows.push(`<div class="summary__row"><dt>日期</dt><dd>${formatDisplayDate(date)}</dd></div>`);
  }

  if (date && isSpecificTechnicianSelected(technicianId)) {
    const workingHoursText = getTechnicianWorkingHoursText(technicianId, date);
    rows.push(
      `<div class="summary__row"><dt>班表</dt><dd>${workingHoursText || "當日未排班"}</dd></div>`
    );
  }

  return `
    <div class="summary__header">
      <h3>預約摘要</h3>
      <span class="summary__badge">即時整理</span>
    </div>
    <p class="summary__lead">${lead}</p>
    ${rows.length ? `<dl class="summary__rows">${rows.join("")}</dl>` : ""}
  `;
}

function updateSummary() {
  const formData = new FormData(elements.bookingForm);
  const technician = getTechnicianById(formData.get("technicianId"));
  const metrics = getServiceMetrics(state.selectedServiceIds);
  const technicianId = formData.get("technicianId");
  const date = formData.get("date");
  const time = formData.get("startTime");

  if (!metrics.services.length || !date || !time) {
    elements.bookingSummary.innerHTML = renderPendingSummary(metrics, date, time, technicianId);
    updateDateScheduleHint();
    updateDashboard();
    return;
  }

  const endTime = toTimeText(toMinutes(time) + metrics.totalDuration);
  const workingHoursText = isSpecificTechnicianSelected(technicianId)
    ? getTechnicianWorkingHoursText(technicianId, date)
    : "";
  elements.bookingSummary.innerHTML = `
    <div class="summary__header">
      <h3>預約摘要</h3>
      <span class="summary__badge">即時整理</span>
    </div>
    <dl class="summary__rows">
      <div class="summary__row"><dt>技師</dt><dd>${isSpecificTechnicianSelected(formData.get("technicianId")) ? getTechnicianDisplayName(technician) : "不指定技師，由現場安排"}</dd></div>
      <div class="summary__row"><dt>服務</dt><dd>${metrics.services.map((service) => formatServiceLabel(service)).join("、")}</dd></div>
      <div class="summary__row"><dt>日期</dt><dd>${formatDisplayDate(date)}</dd></div>
      ${workingHoursText ? `<div class="summary__row"><dt>班表</dt><dd>${workingHoursText}</dd></div>` : ""}
      <div class="summary__row"><dt>時段</dt><dd>${time} - ${endTime}</dd></div>
      <div class="summary__row"><dt>總時長</dt><dd>${metrics.totalDuration} 分鐘</dd></div>
      <div class="summary__row"><dt>總金額</dt><dd>NT$ ${Number(metrics.totalPrice || 0).toLocaleString("zh-TW")}</dd></div>
    </dl>
  `;
  updateDateScheduleHint();
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

  const allowedServices = getAllowedServices(state.selectedTechnicianId, state.selectedServiceIds);
  if (!allowedServices.length) {
    setStatus(
      state.selectedServiceIds.length
        ? "目前沒有單一技師可同時服務這組項目，請減少服務項目或改選技師。"
        : isSpecificTechnicianSelected(state.selectedTechnicianId)
          ? "這位技師目前沒有啟用中的服務項目。"
          : "目前沒有可由現場安排的服務項目。",
      "info"
    );
    return;
  }

  if (!state.selectedServiceIds.length) {
    setStatus("請先選擇至少一個服務項目。", "info");
    return;
  }

  const availableDates = getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds);
  if (!availableDates.length) {
    setStatus(
      isSpecificTechnicianSelected(state.selectedTechnicianId)
        ? "這位技師目前沒有符合服務條件的可預約日期。"
        : "目前沒有可預約日期，請聯絡店家或稍後再試。",
      "info"
    );
    return;
  }

  const selectedDate = elements.dateSelect.value;
  const availableTimeSlots = selectedDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceIds, selectedDate)
    : [];
  if (!availableTimeSlots.length) {
    if (isSpecificTechnicianSelected(state.selectedTechnicianId) && selectedDate) {
      const workingHoursText = getTechnicianWorkingHoursText(state.selectedTechnicianId, selectedDate);
      setStatus(
        workingHoursText
          ? `這位技師在 ${formatDisplayDate(selectedDate)} 的上班時間為 ${workingHoursText}，目前此區間已無可預約時段。`
          : `這位技師在 ${formatDisplayDate(selectedDate)} 未排班，請改選其他日期。`,
        "info"
      );
      return;
    }

    setStatus("當日已無可預約時段，請改選其他日期。", "info");
    return;
  }

  setStatus("目前時段可預約，請確認資料後送出。", "success");
}

function refreshSelects() {
  const previousDate = elements.dateSelect.value;
  const previousTime = elements.timeSelect.value;

  const technicianOptions = [
    { value: UNSPECIFIED_TECHNICIAN_VALUE, label: "不指定技師，由現場安排" },
    ...getActiveTechnicians()
    .slice()
    .sort((left, right) => getTechnicianDisplayName(left).localeCompare(getTechnicianDisplayName(right), "zh-Hant"))
    .map((item) => ({
      value: item.technicianId,
      label: getTechnicianDisplayName(item),
    })),
  ];
  setOptions(elements.technicianSelect, technicianOptions);
  if (technicianOptions.some((item) => item.value === state.selectedTechnicianId)) {
    elements.technicianSelect.value = state.selectedTechnicianId;
  } else if (technicianOptions.length) {
    elements.technicianSelect.value = UNSPECIFIED_TECHNICIAN_VALUE;
  } else {
    elements.technicianSelect.value = "";
  }
  state.selectedTechnicianId = elements.technicianSelect.value;

  const allowedServiceIds = new Set(getAllowedServices(state.selectedTechnicianId, state.selectedServiceIds).map((item) => item.serviceId));
  state.selectedServiceIds = normalizeServiceIds(state.selectedServiceIds).filter((serviceId) => allowedServiceIds.has(serviceId));
  renderServiceOptions(state.selectedServiceIds);
  state.selectedServiceIds = getSelectedServiceIds();

  const dates = state.selectedServiceIds.length
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds)
    : [];
  setOptions(
    elements.dateSelect,
    dates.map((item) => ({ value: item, label: formatDisplayDate(item) })),
    "請選擇日期"
  );

  if (dates.includes(previousDate)) {
    elements.dateSelect.value = previousDate;
  } else if (dates.length) {
    elements.dateSelect.value = dates[0];
  }

  const currentDate = elements.dateSelect.value;
  const timeSlots = state.selectedServiceIds.length && currentDate
    ? getAvailableTimeSlots(state.selectedTechnicianId, state.selectedServiceIds, currentDate)
    : [];
  setOptions(elements.timeSelect, timeSlots, "請選擇時段");

  if (timeSlots.some((item) => item.value === previousTime)) {
    elements.timeSelect.value = previousTime;
  } else if (timeSlots.length) {
    elements.timeSelect.value = timeSlots[0].value;
  }

  updateDateScheduleHint();
  updateSummary();
  updateAvailabilityStatus();
  updateDashboard();
}

function syncDateAndTimeOptions() {
  const dates = state.selectedServiceIds.length
    ? getAvailableDates(state.selectedTechnicianId, state.selectedServiceIds)
    : [];
  const previousDate = elements.dateSelect.value;
  setOptions(
    elements.dateSelect,
    dates.map((item) => ({ value: item, label: formatDisplayDate(item) })),
    "請選擇日期"
  );
  if (dates.includes(previousDate)) {
    elements.dateSelect.value = previousDate;
  } else if (dates.length) {
    elements.dateSelect.value = dates[0];
  }

  const selectedDate = elements.dateSelect.value;
  const timeSlots = state.selectedServiceIds.length && selectedDate
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
    if (isSpecificTechnicianSelected(state.selectedTechnicianId)) {
      const workingHoursText = getTechnicianWorkingHoursText(state.selectedTechnicianId, selectedDate);
      setStatus(
        workingHoursText
          ? `這位技師在 ${formatDisplayDate(selectedDate)} 的上班時間為 ${workingHoursText}，目前此區間已無可預約時段。`
          : `這位技師在 ${formatDisplayDate(selectedDate)} 未排班，請改選其他日期。`,
        "info"
      );
    } else {
      setStatus("該日期已無可預約時段，請改選其他日期。", "info");
    }
  }

  updateDateScheduleHint();
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
    url.searchParams.set("_ts", String(Date.now()));
    const response = await fetch(url.toString(), { cache: "no-store" });
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
  const phone = normalizePhoneInput(formData.get("phone") || "");

  elements.applicationForm.phone.value = phone;

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
  if (!state.liffLoginRequired) {
    state.profile = {
      userId: "TEST_CLIENT_USER",
      displayName: "測試用戶",
      pictureUrl: "",
    };
    renderUserState();
    await syncLineUser();
    return true;
  }

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
    setStatus("正在同步可預約資料...");
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
      state.selectedTechnicianId = UNSPECIFIED_TECHNICIAN_VALUE;
    }

    const allowedServiceIds = new Set(getAllowedServices(state.selectedTechnicianId, state.selectedServiceIds).map((item) => item.serviceId));
    state.selectedServiceIds = normalizeServiceIds(state.selectedServiceIds).filter((serviceId) => allowedServiceIds.has(serviceId));

    refreshSelects();
    renderReservationHistory();
    if (!silent) {
      updateAvailabilityStatus();
    }
  } finally {
    state.isLoadingPublicData = false;
  }
}

async function refreshUserAndData(options = {}) {
  const { silent = false, force = false } = options;

  if (silent && !force) {
    if (document.visibilityState === "hidden") {
      return;
    }

    const now = Date.now();
    if (now - state.lastSilentRefreshAt < MIN_SILENT_REFRESH_INTERVAL_MS) {
      return;
    }

    state.lastSilentRefreshAt = now;
  }

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
  const metrics = getServiceMetrics(serviceIds);

  if (!serviceIds.length) {
    setStatus("請先選擇至少一個服務項目。", "error");
    return;
  }

  const payload = {
    userId: state.user.userId,
    userDisplayName: state.user.displayName,
    customerName: formData.get("customerName").trim(),
    phone: normalizePhoneInput(formData.get("phone") || ""),
    technicianId: isSpecificTechnicianSelected(formData.get("technicianId")) ? formData.get("technicianId") : "",
    serviceIds,
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    note: formData.get("note").trim(),
  };

  if (payload.technicianId) {
    const technicianScheduleEvaluation = evaluateReservationWithinTechnicianSchedule(
      payload.technicianId,
      payload.date,
      payload.startTime,
      metrics.totalDuration
    );

    if (!technicianScheduleEvaluation.ok) {
      syncDateAndTimeOptions();
      setStatus(
        technicianScheduleEvaluation.reason === "no-schedule"
          ? "所選技師在該日期未排班，請改選其他日期。"
          : "所選時段不在該技師當日上班時間內，請重新選擇。",
        "error"
      );
      return;
    }
  }

  if (isExpiredDateTime(payload.date, payload.startTime)) {
    syncDateAndTimeOptions();
    setStatus("不可選擇已過期的日期或時段，請重新選擇可預約時段。", "error");
    return;
  }

  elements.bookingForm.phone.value = payload.phone;

  setStatus("正在送出預約...");
  setBookingSubmitting(true);

  try {
    const result = await requestApi("POST", {}, { action: "createReservation", payload });

    if (!result.ok) {
      throw new Error(result.message || "預約失敗");
    }

    state.reservations = [
      result.data,
      ...state.reservations.filter((item) => item.reservationId !== result.data.reservationId),
    ];
    updateDashboard();
    renderReservationHistory();

    setStatus(
      `預約成功，預約編號：${result.data.reservationId}${result.data.assignmentType === "現場安排" ? "，技師將於現場安排" : result.data.technicianName ? `，已安排 ${result.data.technicianName}` : ""}`,
      "success"
    );
    elements.bookingForm.reset();
    state.selectedTechnicianId = payload.technicianId || UNSPECIFIED_TECHNICIAN_VALUE;
    state.selectedServiceIds = [];
    try {
      await loadPublicData();
    } catch (refreshError) {
      setStatus(
        `預約已送出，預約編號：${result.data.reservationId}。但重新同步最新資料失敗，請稍後手動重新整理。`,
        "success"
      );
    }
    fillBookingContactFields();
  } finally {
    setBookingSubmitting(false);
  }
}

function bindEvents() {
  [elements.applicationForm?.phone, elements.bookingForm?.phone].filter(Boolean).forEach((input) => {
    input.addEventListener("blur", () => {
      input.value = normalizePhoneInput(input.value);
    });
  });

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

    const nextSelectedServiceIds = getSelectedServiceIds();
    if (nextSelectedServiceIds.length && !getEligibleTechnicians(nextSelectedServiceIds, state.selectedTechnicianId).length) {
      event.target.checked = false;
      setStatus("目前沒有單一技師可同時服務這組項目，請減少服務項目或改選技師。", "info");
      return;
    }

    state.selectedServiceIds = nextSelectedServiceIds;
    renderServiceOptions(state.selectedServiceIds);
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
      if (!state.liffLoginRequired) {
        state.profile = null;
        state.user = null;
        renderUserState();
        setStatus("測試模式：已重置登入狀態。", "info");
        return;
      }

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
    if (!state.profile || state.isSubmittingBooking || state.isLoadingPublicData || document.visibilityState !== "visible") {
      return;
    }

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
