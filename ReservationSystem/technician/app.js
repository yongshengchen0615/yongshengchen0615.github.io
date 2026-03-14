const CONFIG_PATH = "./config.json";

const state = {
  gasUrl: "",
  configGasUrl: "",
  liffId: "",
  liffLoginRequired: true,
  profile: null,
  technician: null,
  services: [],
  schedules: [],
  reservations: [],
  calendar: {
    currentMonth: getMonthKeyFromDate(new Date()),
    selectedDate: "",
  },
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
  technicianContent: document.querySelector("#technicianContent"),
  heroTitle: document.querySelector("#heroTitle"),
  heroCopy: document.querySelector("#heroCopy"),
  technicianIdentityTag: document.querySelector("#technicianIdentityTag"),
  technicianShiftTag: document.querySelector("#technicianShiftTag"),
  technicianActivationTag: document.querySelector("#technicianActivationTag"),
  lastLoginLabel: document.querySelector("#lastLoginLabel"),
  technicianCodeLabel: document.querySelector("#technicianCodeLabel"),
  serviceCountStat: document.querySelector("#serviceCountStat"),
  scheduleCountStat: document.querySelector("#scheduleCountStat"),
  reservationCountStat: document.querySelector("#reservationCountStat"),
  serviceList: document.querySelector("#serviceList"),
  calendarPrevButton: document.querySelector("#calendarPrevButton"),
  calendarNextButton: document.querySelector("#calendarNextButton"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarDetail: document.querySelector("#calendarDetail"),
  calendarDetailTitle: document.querySelector("#calendarDetailTitle"),
  calendarDetailContent: document.querySelector("#calendarDetailContent"),
  calendarCloseButton: document.querySelector("#calendarCloseButton"),
};

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function getMonthKeyFromDate(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
}

function parseMonthKey(monthKey) {
  const [yearText, monthText] = String(monthKey || "").split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month) {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }

  return { year, month };
}

function shiftMonthKey(monthKey, delta) {
  const { year, month } = parseMonthKey(monthKey);
  return getMonthKeyFromDate(new Date(year, month - 1 + delta, 1));
}

function getDateKey(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const matched = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matched) {
    return `${matched[1]}-${padNumber(matched[2])}-${padNumber(matched[3])}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function createLocalDateFromKey(dateKey) {
  const [yearText, monthText, dayText] = String(dateKey || "").split("-");
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function formatMonthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey);
  return `${year} 年 ${padNumber(month)} 月`;
}

function formatCalendarDateLabel(dateKey) {
  const date = createLocalDateFromKey(dateKey);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 星期${weekday}`;
}

function getMonthKeyFromDateKey(dateKey) {
  return String(dateKey || "").slice(0, 7);
}

function normalizeGasUrl(value) {
  return String(value || "").trim();
}

function normalizeLiffId(value) {
  return String(value || "").trim();
}

function getCurrentTechnicianUserId() {
  return String(state.profile?.userId || state.technician?.lineUserId || "").trim();
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

function setApprovalMessage(message, tone = "info") {
  if (!elements.approvalBanner) {
    return;
  }

  elements.approvalBanner.textContent = message;
  elements.approvalBanner.dataset.tone = tone;
}

function setContentAccess(canAccess) {
  elements.technicianContent?.classList.toggle("is-hidden", !canAccess);
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

  return date.toLocaleString("zh-TW", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusTone(status) {
  if (status === "已通過") {
    return "approved";
  }
  if (status === "待審核") {
    return "pending";
  }
  if (status === "未綁定") {
    return "muted";
  }
  return "blocked";
}

function getStatusPill(status) {
  if (status === "已通過") {
    return '<span class="status-pill status-pill--approved">已通過</span>';
  }
  if (status === "已預約") {
    return '<span class="status-pill status-pill--booked">已預約</span>';
  }
  if (status === "已完成") {
    return '<span class="status-pill status-pill--completed">已完成</span>';
  }
  if (status === "可預約") {
    return '<span class="status-pill status-pill--working">可預約</span>';
  }
  if (status === "休假") {
    return '<span class="status-pill status-pill--off">休假</span>';
  }
  if (status === "待審核") {
    return '<span class="status-pill status-pill--pending">待審核</span>';
  }
  if (status === "未綁定") {
    return '<span class="status-pill status-pill--draft">未綁定</span>';
  }
  if (status === "已拒絕") {
    return '<span class="status-pill status-pill--rejected">已拒絕</span>';
  }
  if (status === "已停用") {
    return '<span class="status-pill status-pill--disabled">已停用</span>';
  }
  if (status === "已取消") {
    return '<span class="status-pill status-pill--cancelled">已取消</span>';
  }
  return `<span class="status-pill status-pill--draft">${status || "未設定"}</span>`;
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
    state.gasUrl = state.configGasUrl;
    state.liffId = normalizeLiffId(config.liffId);
    state.liffLoginRequired = config.liffLoginRequired !== false;
  } catch (error) {
    state.configGasUrl = "";
    state.gasUrl = "";
    state.liffId = "";
    state.liffLoginRequired = true;
  }
}

async function ensureLiffSession() {
  if (!state.liffLoginRequired) {
    state.profile = {
      userId: "TEST_TECHNICIAN_USER",
      displayName: "測試技師",
      pictureUrl: "",
    };
    renderAccessState();
    return true;
  }

  if (!state.liffId) {
    throw new Error("請先在 technician/config.json 設定 liffId。");
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
    throw new Error("請先在 technician/config.json 設定 GAS Web App URL");
  }

  const technicianUserId = getCurrentTechnicianUserId();
  if (!technicianUserId && method !== "POST") {
    throw new Error("請先完成 LINE 登入");
  }

  startBusyState();

  try {
    if (method === "GET") {
      const url = new URL(state.gasUrl);
      Object.entries({ ...params, technicianUserId }).forEach(([key, value]) => {
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
      body: JSON.stringify({ ...body, technicianUserId }),
    });
    return response.json();
  } finally {
    endBusyState();
  }
}

async function syncTechnicianUser() {
  const result = await requestApi("POST", {}, {
    action: "syncTechnicianUser",
    payload: {
      userId: state.profile.userId,
      displayName: state.profile.displayName,
      pictureUrl: state.profile.pictureUrl || "",
    },
  });

  if (!result.ok) {
    throw new Error(result.message || "同步技師 LINE 身分失敗");
  }

  state.technician = result.data;
  renderAccessState();
}

function renderAccessState() {
  if (!state.profile) {
    elements.displayName.textContent = "尚未登入 LINE";
    elements.statusBadge.textContent = "未登入";
    elements.statusBadge.dataset.tone = "muted";
    elements.statusText.textContent = "請先登入 LINE，系統會確認你的技師審核狀態。";
    elements.avatar.classList.add("is-hidden");
    elements.loginButton.textContent = "LINE 登入";
    elements.logoutButton.disabled = true;
    setApprovalMessage("需先完成 LINE 登入並通過技師審核，才可使用技師頁面。", "info");
    setContentAccess(false);
    return;
  }

  elements.displayName.textContent = state.profile.displayName || "LINE 技師";
  elements.loginButton.textContent = "切換 LINE 帳號";
  elements.logoutButton.disabled = false;

  if (state.profile.pictureUrl) {
    elements.avatar.src = state.profile.pictureUrl;
    elements.avatar.classList.remove("is-hidden");
  } else {
    elements.avatar.classList.add("is-hidden");
  }

  if (!state.technician) {
    elements.statusBadge.textContent = "同步中";
    elements.statusBadge.dataset.tone = "pending";
    elements.statusText.textContent = "正在同步你的技師身分。";
    setApprovalMessage("正在確認技師權限...", "pending");
    setContentAccess(false);
    return;
  }

  elements.statusBadge.textContent = state.technician.status;
  elements.statusBadge.dataset.tone = getStatusTone(state.technician.status);

  if (state.technician.status === "已通過") {
    elements.statusText.textContent = "技師帳號已通過審核，可查看自己的工作資料。";
    setApprovalMessage("已通過技師審核，可查看自己的服務、班表與預約。", "approved");
    setContentAccess(true);
    return;
  }

  if (state.technician.status === "待審核") {
    elements.statusText.textContent = "已完成 LINE 登入，等待 admin 在技師區塊審核通過。";
    setApprovalMessage("目前為待審核狀態，請通知 admin 到技師區塊完成審核。", "pending");
    setContentAccess(false);
    return;
  }

  if (state.technician.status === "已拒絕" || state.technician.status === "已停用") {
    elements.statusText.textContent = state.technician.note || "此技師帳號目前不可使用技師頁面。";
    setApprovalMessage(state.technician.note || "請聯絡 admin 調整你的技師審核狀態。", "blocked");
    setContentAccess(false);
    return;
  }

  elements.statusText.textContent = "請先由 admin 完成技師資料設定與帳號綁定。";
  setApprovalMessage("目前尚未完成技師帳號綁定，請先聯絡 admin。", "info");
  setContentAccess(false);
}

function renderServices() {
  if (!elements.serviceList) {
    return;
  }

  if (!state.services.length) {
    elements.serviceList.innerHTML = '<div class="empty-state">admin 尚未為你綁定任何服務項目。</div>';
    return;
  }

  elements.serviceList.innerHTML = state.services
    .map((service) => `
      <article class="service-card">
        <strong>${escapeHtml(service.name)}</strong>
        <p>${escapeHtml(service.category || "未分類")}</p>
        <div class="service-card__meta">
          <span class="hero-tag">${service.durationMinutes} 分鐘</span>
          <span class="hero-tag">NT$ ${Number(service.price || 0).toLocaleString("zh-TW")}</span>
          <span class="hero-tag">${service.active ? "啟用中" : "已停用"}</span>
        </div>
      </article>
    `)
    .join("");
}

function getCalendarDataMap() {
  const dataMap = new Map();

  const ensureEntry = (dateKey) => {
    if (!dataMap.has(dateKey)) {
      dataMap.set(dateKey, {
        schedules: [],
        reservations: [],
      });
    }
    return dataMap.get(dateKey);
  };

  state.schedules.forEach((schedule) => {
    const dateKey = getDateKey(schedule.date);
    if (!dateKey) {
      return;
    }
    ensureEntry(dateKey).schedules.push(schedule);
  });

  state.reservations.forEach((reservation) => {
    const dateKey = getDateKey(reservation.date);
    if (!dateKey) {
      return;
    }
    ensureEntry(dateKey).reservations.push(reservation);
  });

  dataMap.forEach((entry) => {
    entry.schedules.sort((left, right) => String(left.startTime || "").localeCompare(String(right.startTime || ""), "zh-TW"));
    entry.reservations.sort((left, right) => String(left.startTime || "").localeCompare(String(right.startTime || ""), "zh-TW"));
  });

  return dataMap;
}

function getCalendarMonthBounds(dataMap) {
  let minMonthKey = getMonthKeyFromDate(new Date());
  let maxMonthKey = minMonthKey;

  dataMap.forEach((_, dateKey) => {
    const monthKey = getMonthKeyFromDateKey(dateKey);
    if (monthKey < minMonthKey) {
      minMonthKey = monthKey;
    }
    if (monthKey > maxMonthKey) {
      maxMonthKey = monthKey;
    }
  });

  return { minMonthKey, maxMonthKey };
}

function syncCalendarMonthWithData() {
  const dataMap = getCalendarDataMap();
  const monthKeys = [...new Set([...dataMap.keys()].map((dateKey) => getMonthKeyFromDateKey(dateKey)))].sort();
  const currentMonthKey = getMonthKeyFromDate(new Date());

  if (!monthKeys.length) {
    state.calendar.currentMonth = currentMonthKey;
    state.calendar.selectedDate = "";
    return;
  }

  const matchingUpcomingMonth = monthKeys.find((monthKey) => monthKey >= currentMonthKey);
  state.calendar.currentMonth = matchingUpcomingMonth || monthKeys[monthKeys.length - 1];

  if (state.calendar.selectedDate && getMonthKeyFromDateKey(state.calendar.selectedDate) !== state.calendar.currentMonth) {
    state.calendar.selectedDate = "";
  }
}

function renderCalendarDetail(dataMap) {
  if (!elements.calendarDetail || !elements.calendarDetailTitle || !elements.calendarDetailContent) {
    return;
  }

  if (!state.calendar.selectedDate) {
    elements.calendarDetail.classList.add("is-hidden");
    elements.calendarDetailTitle.textContent = "請先選擇日期";
    elements.calendarDetailContent.innerHTML = "";
    return;
  }

  const entry = dataMap.get(state.calendar.selectedDate) || { schedules: [], reservations: [] };
  elements.calendarDetail.classList.remove("is-hidden");
  elements.calendarDetailTitle.textContent = formatCalendarDateLabel(state.calendar.selectedDate);
  elements.calendarDetailContent.innerHTML = `
    <section class="calendar-detail-block">
      <div class="calendar-detail-block__header">
        <strong>班表安排</strong>
        <span class="hero-tag">${entry.schedules.length} 筆</span>
      </div>
      ${entry.schedules.length
        ? `<div class="calendar-detail-list">${entry.schedules
            .map(
              (schedule) => `
                <article class="calendar-detail-card">
                  <div>
                    <strong>${escapeHtml(schedule.startTime)} - ${escapeHtml(schedule.endTime)}</strong>
                    <p>${escapeHtml(schedule.note || "班表已同步")}</p>
                  </div>
                  ${getStatusPill(schedule.isWorking ? "可預約" : "休假")}
                </article>
              `
            )
            .join("")}</div>`
        : '<div class="empty-state">當日沒有班表資料。</div>'}
    </section>
    <section class="calendar-detail-block">
      <div class="calendar-detail-block__header">
        <strong>預約安排</strong>
        <span class="hero-tag">${entry.reservations.length} 筆</span>
      </div>
      ${entry.reservations.length
        ? `<div class="calendar-detail-list">${entry.reservations
            .map(
              (reservation) => `
                <article class="calendar-detail-card">
                  <div>
                    <strong>${escapeHtml(reservation.startTime)} - ${escapeHtml(reservation.endTime)}</strong>
                    <p>${escapeHtml(reservation.serviceName || "未設定服務")}</p>
                  </div>
                  ${getStatusPill(reservation.status)}
                </article>
              `
            )
            .join("")}</div>`
        : '<div class="empty-state">當日沒有預約安排。</div>'}
    </section>
  `;
}

function renderCalendar() {
  if (!elements.calendarGrid || !elements.calendarMonthLabel || !elements.calendarPrevButton || !elements.calendarNextButton) {
    return;
  }

  const dataMap = getCalendarDataMap();
  const { minMonthKey, maxMonthKey } = getCalendarMonthBounds(dataMap);
  const { year, month } = parseMonthKey(state.calendar.currentMonth);
  const firstDayIndex = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstDayIndex + daysInMonth) / 7) * 7;
  const dayCells = [];

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    const dayNumber = cellIndex - firstDayIndex + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      dayCells.push('<div class="calendar-day calendar-day--empty" aria-hidden="true"></div>');
      continue;
    }

    const dateKey = `${year}-${padNumber(month)}-${padNumber(dayNumber)}`;
    const entry = dataMap.get(dateKey) || { schedules: [], reservations: [] };
    const isToday = dateKey === getDateKey(new Date());
    const isSelected = dateKey === state.calendar.selectedDate;
    const scheduleCount = entry.schedules.length;
    const reservationCount = entry.reservations.length;

    dayCells.push(`
      <button
        type="button"
        class="calendar-day${isToday ? " calendar-day--today" : ""}${isSelected ? " calendar-day--selected" : ""}${scheduleCount ? " calendar-day--has-schedule" : ""}${reservationCount ? " calendar-day--has-reservation" : ""}"
        data-date="${dateKey}"
        aria-pressed="${isSelected ? "true" : "false"}"
      >
        <span class="calendar-day__number">${dayNumber}</span>
        <span class="calendar-day__badges">
          ${scheduleCount ? `<span class="calendar-day__badge calendar-day__badge--schedule">班表 ${scheduleCount}</span>` : ""}
          ${reservationCount ? `<span class="calendar-day__badge calendar-day__badge--reservation">預約 ${reservationCount}</span>` : ""}
        </span>
      </button>
    `);
  }

  elements.calendarMonthLabel.textContent = formatMonthLabel(state.calendar.currentMonth);
  elements.calendarPrevButton.disabled = state.calendar.currentMonth <= minMonthKey;
  elements.calendarNextButton.disabled = state.calendar.currentMonth >= maxMonthKey;
  elements.calendarGrid.innerHTML = dayCells.join("");

  if (state.calendar.selectedDate && getMonthKeyFromDateKey(state.calendar.selectedDate) !== state.calendar.currentMonth) {
    state.calendar.selectedDate = "";
  }

  renderCalendarDetail(dataMap);
}

function renderSummary() {
  const technicianName = state.technician?.name || state.profile?.displayName || "技師工作台";
  const bookedReservations = state.reservations.filter((item) => item.status === "已預約").length;

  elements.heroTitle.textContent = `${technicianName} 的工作台`;
  elements.heroCopy.textContent = state.technician?.note
    ? `admin 備註：${state.technician.note}`
    : "登入後可在此確認目前綁定的服務、近期班表與預約安排。";
  elements.technicianIdentityTag.textContent = state.technician?.profileDisplayName || state.profile?.displayName || "尚未同步";
  elements.technicianShiftTag.textContent = state.technician ? `${state.technician.startTime} - ${state.technician.endTime}` : "班別尚未設定";
  elements.technicianActivationTag.textContent = state.technician?.active ? "技師資料啟用中" : "技師資料未啟用";
  elements.lastLoginLabel.textContent = formatDateTimeText(state.technician?.lastLoginAt);
  elements.technicianCodeLabel.textContent = state.technician?.technicianId || "尚未同步";
  elements.serviceCountStat.textContent = String(state.services.length);
  elements.scheduleCountStat.textContent = String(state.schedules.length);
  elements.reservationCountStat.textContent = String(bookedReservations);
}

function renderAll() {
  renderSummary();
  renderServices();
  renderCalendar();
}

async function loadTechnicianData() {
  const result = await requestApi("GET", { action: "technicianData" });
  if (!result.ok) {
    throw new Error(result.message || "載入技師資料失敗");
  }

  state.technician = result.data.technician || state.technician;
  state.services = result.data.services || [];
  state.schedules = result.data.schedules || [];
  state.reservations = result.data.reservations || [];
  syncCalendarMonthWithData();
  renderAccessState();
  renderAll();
  setStatus("技師資料已同步。", "success");
}

async function refreshTechnicianIdentity(options = {}) {
  const { loadData = true } = options;

  showLoading("正在確認技師 LINE 身分...", "loading");
  state.technician = null;
  renderAccessState();

  const isLoggedIn = await ensureLiffSession();
  if (!isLoggedIn) {
    return false;
  }

  await syncTechnicianUser();

  if (state.technician?.status === "已通過") {
    if (loadData) {
      await loadTechnicianData();
    } else {
      setStatus("技師身分已更新。", "success");
    }
    return true;
  }

  setStatus(
    state.technician?.status === "待審核"
      ? "技師帳號尚待 admin 審核，通過前無法查看工作資料。"
      : state.technician?.note || "此技師帳號目前不可使用技師頁面。",
    state.technician?.status === "待審核" ? "info" : "error"
  );
  return false;
}

function bindEvents() {
  elements.loginButton.addEventListener("click", async () => {
    try {
      await refreshTechnicianIdentity();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.refreshButton.addEventListener("click", async () => {
    try {
      await refreshTechnicianIdentity();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.logoutButton.addEventListener("click", async () => {
    try {
      if (state.liffLoginRequired) {
        if (!state.liffId) {
          throw new Error("請先在 technician/config.json 設定 liffId。");
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
      state.technician = null;
      state.services = [];
      state.schedules = [];
      state.reservations = [];
      state.calendar.currentMonth = getMonthKeyFromDate(new Date());
      state.calendar.selectedDate = "";
      renderAccessState();
      renderAll();
      setStatus("已登出 LINE 帳號。", "info");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.calendarPrevButton?.addEventListener("click", () => {
    state.calendar.currentMonth = shiftMonthKey(state.calendar.currentMonth, -1);
    state.calendar.selectedDate = "";
    renderCalendar();
  });

  elements.calendarNextButton?.addEventListener("click", () => {
    state.calendar.currentMonth = shiftMonthKey(state.calendar.currentMonth, 1);
    state.calendar.selectedDate = "";
    renderCalendar();
  });

  elements.calendarGrid?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-date]");
    if (!target) {
      return;
    }

    state.calendar.selectedDate = target.dataset.date || "";
    renderCalendar();
  });

  elements.calendarCloseButton?.addEventListener("click", () => {
    state.calendar.selectedDate = "";
    renderCalendar();
  });
}

async function initializeApp() {
  await loadConfigFromJson();
  bindEvents();
  renderAccessState();
  renderAll();

  if (state.gasUrl && state.liffId) {
    refreshTechnicianIdentity().catch((error) => setStatus(error.message, "error"));
    return;
  }

  setStatus("請檢查 technician/config.json 內的 gasWebAppUrl 與 liffId。", "info");
}

initializeApp();