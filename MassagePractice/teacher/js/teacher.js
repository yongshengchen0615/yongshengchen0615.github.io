(function () {
  "use strict";

  const TEACHER_SESSION_KEY = "teacherApprovalSession";
  const THEME_STORAGE_KEY = "massageTheme";
  const OAUTH_KEY = "teacherLineOAuth";
  const AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
  const PRACTICE_OTHER_OPTION_NAME = "其他";
  const DEFAULT_MAP_CENTER = [25.033964, 121.564468];
  let students = [];
  let selectedAttendanceUuid = "";
  let selectedPracticeUuid = "";
  let currentTeacher = null;
  let locationMap = null;
  let locationMarker = null;
  let locationCircle = null;
  let practiceSettings = {
    targets: [],
    items: [],
    location: null
  };

  const elements = {
    teacherTitle: document.getElementById("teacher-title"),
    viewButtons: Array.from(document.querySelectorAll("[data-view]")),
    studentsView: document.getElementById("studentsView"),
    practiceTargetsView: document.getElementById("practiceTargetsView"),
    practiceItemsView: document.getElementById("practiceItemsView"),
    locationSettingsView: document.getElementById("locationSettingsView"),
    teacherAuthName: document.getElementById("teacherAuthName"),
    teacherAuthStatus: document.getElementById("teacherAuthStatus"),
    connectButton: document.getElementById("connectButton"),
    logoutButton: document.getElementById("logoutButton"),
    reloadButton: document.getElementById("reloadButton"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    totalCount: document.getElementById("totalCount"),
    pendingCount: document.getElementById("pendingCount"),
    approvedCount: document.getElementById("approvedCount"),
    emptyState: document.getElementById("emptyState"),
    tableWrap: document.getElementById("tableWrap"),
    studentsBody: document.getElementById("studentsBody"),
    attendanceRegion: document.getElementById("attendanceRegion"),
    attendanceTitle: document.getElementById("attendanceTitle"),
    attendanceEmpty: document.getElementById("attendanceEmpty"),
    attendanceTableWrap: document.getElementById("attendanceTableWrap"),
    attendanceBody: document.getElementById("attendanceBody"),
    closeAttendanceButton: document.getElementById("closeAttendanceButton"),
    practiceTargetInput: document.getElementById("practiceTargetInput"),
    practiceItemInput: document.getElementById("practiceItemInput"),
    addPracticeTargetButton: document.getElementById("addPracticeTargetButton"),
    addPracticeItemButton: document.getElementById("addPracticeItemButton"),
    practiceTargetList: document.getElementById("practiceTargetList"),
    practiceItemList: document.getElementById("practiceItemList"),
    practiceRecordRegion: document.getElementById("practiceRecordRegion"),
    practiceRecordTitle: document.getElementById("practiceRecordTitle"),
    practiceRecordEmpty: document.getElementById("practiceRecordEmpty"),
    practiceRecordTableWrap: document.getElementById("practiceRecordTableWrap"),
    practiceRecordBody: document.getElementById("practiceRecordBody"),
    closePracticeRecordButton: document.getElementById("closePracticeRecordButton"),
    locationEnabledInput: document.getElementById("locationEnabledInput"),
    locationNameInput: document.getElementById("locationNameInput"),
    locationLatitudeInput: document.getElementById("locationLatitudeInput"),
    locationLongitudeInput: document.getElementById("locationLongitudeInput"),
    locationRadiusInput: document.getElementById("locationRadiusInput"),
    detectLocationButton: document.getElementById("detectLocationButton"),
    openLocationMapButton: document.getElementById("openLocationMapButton"),
    closeLocationMapButton: document.getElementById("closeLocationMapButton"),
    locationMapPanel: document.getElementById("locationMapPanel"),
    locationMap: document.getElementById("locationMap"),
    saveLocationButton: document.getElementById("saveLocationButton"),
    locationSummary: document.getElementById("locationSummary"),
    themeToggle: document.getElementById("themeToggle"),
    themeToggleIcon: document.getElementById("themeToggleIcon"),
    themeToggleText: document.getElementById("themeToggleText")
  };

  const statusLabels = {
    pending: "待審核",
    approved: "已通過",
    rejected: "未通過"
  };

  const viewTitles = {
    studentsView: "學員審核",
    practiceTargetsView: "練習對象",
    practiceItemsView: "練習項目",
    locationSettingsView: "定位範圍"
  };

  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function setTheme(theme, options) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    const isDark = nextTheme === "dark";
    document.documentElement.dataset.theme = nextTheme;
    elements.themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
    elements.themeToggleIcon.textContent = isDark ? "☾" : "☀";
    elements.themeToggleText.textContent = isDark ? "暗色調" : "亮色調";

    if (!options || options.persist !== false) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch (error) {
        // Theme persistence is optional; the switch still works for this page view.
      }
    }
  }

  function toggleTheme() {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  }

  function normalizeStatus(value) {
    const status = String(value || "").trim().toLowerCase();

    if (["approved", "通過", "已通過", "已通過審核"].includes(status)) return "approved";
    if (["rejected", "未通過", "不通過", "拒絕"].includes(status)) return "rejected";
    if (["pending", "待審", "待審核", "待師資審核", ""].includes(status)) return "pending";

    return status;
  }

  function base64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(byteLength) {
    const bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function sha256(value) {
    if (!window.crypto.subtle) return "";
    const encoded = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", encoded);
    return base64Url(new Uint8Array(digest));
  }

  function saveTeacherSession(teacher) {
    localStorage.setItem(
      TEACHER_SESSION_KEY,
      JSON.stringify({
        uuid: teacher.uuid,
        publicToken: teacher.publicToken
      })
    );
  }

  function readTeacherSession() {
    try {
      const session = JSON.parse(localStorage.getItem(TEACHER_SESSION_KEY) || "null");
      if (session && session.uuid && session.publicToken) return session;
    } catch (error) {
      localStorage.removeItem(TEACHER_SESSION_KEY);
    }
    return null;
  }

  function clearTeacherSession() {
    currentTeacher = null;
    localStorage.removeItem(TEACHER_SESSION_KEY);
    sessionStorage.removeItem(OAUTH_KEY);
  }

  function teacherPayload(extra) {
    const session = readTeacherSession();
    if (!session) {
      throw new Error("請先使用 LINE 登入師資帳號。");
    }

    return Object.assign(
      {
        teacherUuid: session.uuid,
        teacherToken: session.publicToken
      },
      extra || {}
    );
  }

  function renderTeacherAuth(teacher, message) {
    currentTeacher = teacher || null;

    if (!teacher) {
      elements.teacherAuthName.textContent = "師資登入";
      elements.teacherAuthStatus.textContent = message || "使用 LINE 登入後等待審核。";
      elements.connectButton.textContent = "LINE 登入";
      elements.logoutButton.hidden = true;
      return;
    }

    const status = normalizeStatus(teacher.status);
    elements.teacherAuthName.textContent = teacher.lineName || "LINE 使用者";
    elements.teacherAuthStatus.textContent =
      message ||
      (status === "approved"
        ? "師資審核已通過。"
        : status === "rejected"
          ? teacher.reviewNote || "師資審核未通過。"
          : "已送出師資登入資料，請在 GAS teachers 工作表將 status 改為 approved。");
    elements.connectButton.textContent = status === "approved" ? "重新整理" : "重新檢查";
    elements.logoutButton.hidden = false;
  }

  function renderLoggedOut() {
    students = [];
    practiceSettings = {
      targets: [],
      items: [],
      location: null
    };
    hideAttendanceRecords();
    hidePracticeRecords();
    updateMetrics();
    renderTeacherAuth(null);
    setEmpty("請先使用 LINE 登入師資帳號。");
    elements.practiceTargetList.textContent = "師資審核通過後載入。";
    elements.practiceItemList.textContent = "師資審核通過後載入。";
    elements.locationSummary.textContent = "師資審核通過後載入。";
  }

  function requireApprovedTeacher() {
    if (!currentTeacher || normalizeStatus(currentTeacher.status) !== "approved") {
      window.alert("師資審核通過後才能使用師資系統。");
      return false;
    }
    return true;
  }

  function showView(viewId) {
    [elements.studentsView, elements.practiceTargetsView, elements.practiceItemsView, elements.locationSettingsView].forEach((view) => {
      view.hidden = view.id !== viewId;
    });

    elements.viewButtons.forEach((button) => {
      const isActive = button.dataset.view === viewId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    elements.teacherTitle.textContent = viewTitles[viewId] || viewTitles.studentsView;

    if (viewId !== "studentsView") {
      hideAttendanceRecords();
      hidePracticeRecords();
    }

    if (viewId === "locationSettingsView" && locationMap && !elements.locationMapPanel.hidden) {
      window.setTimeout(refreshLocationMap, 0);
    }
  }

  function setLoading(isLoading) {
    elements.connectButton.disabled = isLoading;
    elements.logoutButton.disabled = isLoading;
    elements.reloadButton.disabled = isLoading;
    elements.addPracticeTargetButton.disabled = isLoading;
    elements.addPracticeItemButton.disabled = isLoading;
    elements.detectLocationButton.disabled = isLoading;
    elements.openLocationMapButton.disabled = isLoading;
    elements.closeLocationMapButton.disabled = isLoading;
    elements.saveLocationButton.disabled = isLoading;
  }

  function setEmpty(message) {
    elements.emptyState.textContent = message;
    elements.emptyState.hidden = false;
    elements.tableWrap.hidden = true;
  }

  function setAttendanceEmpty(message) {
    elements.attendanceEmpty.textContent = message;
    elements.attendanceEmpty.hidden = false;
    elements.attendanceTableWrap.hidden = true;
  }

  function setPracticeRecordEmpty(message) {
    elements.practiceRecordEmpty.textContent = message;
    elements.practiceRecordEmpty.hidden = false;
    elements.practiceRecordTableWrap.hidden = true;
  }

  function studentDisplayName(student) {
    return student && student.lineName ? student.lineName : "未命名學員";
  }

  function filteredStudents() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const status = elements.statusFilter.value;

    return students.filter((student) => {
      const matchesStatus = status === "all" || student.status === status;
      const haystack = [student.lineName].join(" ").toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }

  function updateMetrics() {
    elements.totalCount.textContent = String(students.length);
    elements.pendingCount.textContent = String(students.filter((student) => student.status === "pending").length);
    elements.approvedCount.textContent = String(students.filter((student) => student.status === "approved").length);
  }

  function durationLabel(record) {
    const startValue = record.checkInAt || record.startedAt;
    const endValue = record.checkOutAt || record.endedAt;

    if (!endValue) return "進行中";

    const start = new Date(startValue);
    const end = new Date(endValue);
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

    if (!Number.isFinite(minutes)) return "-";
    if (minutes < 60) return `${minutes} 分鐘`;

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`;
  }

  function distanceText(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance)) return "";
    return `${Math.round(distance)} 公尺`;
  }

  function attendanceLocationText(record) {
    const checkIn = distanceText(record.checkInDistanceMeters);
    const checkOut = distanceText(record.checkOutDistanceMeters);
    return [checkIn ? `簽到 ${checkIn}` : "", checkOut ? `簽退 ${checkOut}` : ""].filter(Boolean).join(" / ") || "-";
  }

  function practiceLocationText(record) {
    const start = distanceText(record.startDistanceMeters);
    const end = distanceText(record.endDistanceMeters);
    return [start ? `開始 ${start}` : "", end ? `結束 ${end}` : ""].filter(Boolean).join(" / ") || "-";
  }

  function hideAttendanceRecords() {
    selectedAttendanceUuid = "";
    elements.attendanceRegion.hidden = true;
    elements.attendanceBody.innerHTML = "";
  }

  function hidePracticeRecords() {
    selectedPracticeUuid = "";
    elements.practiceRecordRegion.hidden = true;
    elements.practiceRecordBody.innerHTML = "";
  }

  function renderPracticeSettings() {
    renderPracticeOptionList(elements.practiceTargetList, practiceSettings.targets, "deletePracticeTarget");
    renderPracticeOptionList(elements.practiceItemList, practiceSettings.items, "deletePracticeItem");
    renderLocationSettings();
  }

  function defaultLocationSettings() {
    return {
      name: "",
      enabled: false,
      latitude: "",
      longitude: "",
      radiusMeters: 100
    };
  }

  function normalizeLocationSettings(setting) {
    const fallback = defaultLocationSettings();
    const location = setting || fallback;
    const hasRadius = location.radiusMeters === 0 || location.radiusMeters;

    return {
      name: location.name || "",
      enabled: Boolean(location.enabled),
      latitude: location.latitude === 0 || location.latitude ? location.latitude : "",
      longitude: location.longitude === 0 || location.longitude ? location.longitude : "",
      radiusMeters: hasRadius ? location.radiusMeters : setting ? "" : fallback.radiusMeters
    };
  }

  function locationValue(value) {
    return value === 0 || value ? String(value) : "";
  }

  function renderLocationSettings() {
    const location = normalizeLocationSettings(practiceSettings.location);

    elements.locationEnabledInput.checked = Boolean(location.enabled);
    elements.locationNameInput.value = location.name || "";
    elements.locationLatitudeInput.value = locationValue(location.latitude);
    elements.locationLongitudeInput.value = locationValue(location.longitude);
    elements.locationRadiusInput.value = locationValue(location.radiusMeters);
    renderLocationSummary(location);
    updateLocationMapFromForm();
  }

  function renderLocationSummary(location, message) {
    const setting = normalizeLocationSettings(location);
    const radius = Number(setting.radiusMeters);
    const latitude = Number(setting.latitude);
    const longitude = Number(setting.longitude);
    const hasCoordinates =
      setting.latitude !== "" && setting.longitude !== "" && Number.isFinite(latitude) && Number.isFinite(longitude);
    const hasRadius = setting.radiusMeters !== "" && Number.isFinite(radius);

    if (message) {
      elements.locationSummary.textContent = message;
      return;
    }

    if (!setting.enabled) {
      elements.locationSummary.textContent = "目前未啟用定位限制。";
      return;
    }

    if (!hasCoordinates || !hasRadius) {
      elements.locationSummary.textContent = "定位限制已啟用，但座標或半徑尚未完整。";
      return;
    }

    elements.locationSummary.textContent = `已啟用：${setting.name || "指定地點"}，半徑 ${Math.round(radius)} 公尺。`;
  }

  function formLocationPoint() {
    const latitudeValue = elements.locationLatitudeInput.value.trim();
    const longitudeValue = elements.locationLongitudeInput.value.trim();

    if (!latitudeValue || !longitudeValue) return null;

    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

    return [latitude, longitude];
  }

  function formLocationRadius() {
    const radius = Number(elements.locationRadiusInput.value);
    return Number.isFinite(radius) && radius > 0 ? radius : 100;
  }

  function setLocationPoint(latitude, longitude, options) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    elements.locationLatitudeInput.value = lat.toFixed(6);
    elements.locationLongitudeInput.value = lng.toFixed(6);
    if (!elements.locationRadiusInput.value.trim()) elements.locationRadiusInput.value = "100";
    elements.locationEnabledInput.checked = true;
    renderLocationSummary(currentLocationFormValue(), options && options.message);
    updateLocationMapMarker([lat, lng], options);
  }

  function openLocationMap() {
    elements.locationMapPanel.hidden = false;

    if (!window.L) {
      renderLocationSummary(currentLocationFormValue(), "地圖套件載入失敗，請確認網路連線後重新整理。");
      return;
    }

    ensureLocationMap();

    const selectedPoint = formLocationPoint();
    const point = selectedPoint || DEFAULT_MAP_CENTER;
    locationMap.setView(point, selectedPoint ? Math.max(locationMap.getZoom() || 16, 16) : 13);

    if (selectedPoint) {
      updateLocationMapMarker(point, { preserveView: true });
    } else {
      clearLocationMapMarker();
    }

    window.setTimeout(refreshLocationMap, 0);
    renderLocationSummary(currentLocationFormValue());
  }

  function closeLocationMap() {
    elements.locationMapPanel.hidden = true;
  }

  function ensureLocationMap() {
    if (locationMap) return;

    const point = formLocationPoint() || DEFAULT_MAP_CENTER;
    locationMap = window.L.map(elements.locationMap, {
      zoomControl: true
    }).setView(point, formLocationPoint() ? 16 : 13);

    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(locationMap);

    locationMap.on("click", (event) => {
      if (!event.latlng) return;
      setLocationPoint(event.latlng.lat, event.latlng.lng, { message: "已套用地圖座標。" });
    });
  }

  function updateLocationMapFromForm() {
    if (!locationMap || elements.locationMapPanel.hidden) return;

    const point = formLocationPoint();
    if (!point) return;

    updateLocationMapMarker(point, { preserveView: true });
  }

  function updateLocationMapMarker(point, options) {
    if (!locationMap) return;

    const radius = formLocationRadius();
    const latLng = window.L.latLng(point[0], point[1]);

    if (!locationMarker) {
      locationMarker = window.L.marker(latLng, {
        draggable: true
      }).addTo(locationMap);
      locationMarker.on("dragend", () => {
        const next = locationMarker.getLatLng();
        if (!next) return;
        setLocationPoint(next.lat, next.lng, { message: "已套用地圖座標。" });
      });
    } else {
      locationMarker.setLatLng(latLng);
    }

    if (!locationCircle) {
      locationCircle = window.L.circle(latLng, {
        radius,
        color: "#168455",
        opacity: 0.9,
        weight: 2,
        fillColor: "#168455",
        fillOpacity: 0.12
      }).addTo(locationMap);
    } else {
      locationCircle.setLatLng(latLng);
      locationCircle.setRadius(radius);
    }

    if (!options || !options.preserveView) {
      locationMap.setView(latLng, Math.max(locationMap.getZoom() || 16, 16));
    }
  }

  function clearLocationMapMarker() {
    if (!locationMap) return;

    if (locationMarker) {
      locationMarker.remove();
      locationMarker = null;
    }

    if (locationCircle) {
      locationCircle.remove();
      locationCircle = null;
    }
  }

  function refreshLocationMap() {
    if (!locationMap) return;

    const point = formLocationPoint() || DEFAULT_MAP_CENTER;
    locationMap.invalidateSize();
    locationMap.setView(point, locationMap.getZoom() || 13, { animate: false });
  }

  function renderPracticeOptionList(container, options, action) {
    const systemOption = `
      <div class="option-pill option-pill--system">
        <span>${PRACTICE_OTHER_OPTION_NAME}</span>
        <small>學員自填</small>
      </div>
    `;

    if (!options.length) {
      container.innerHTML = systemOption + '<div class="option-list__empty">尚未新增其他固定選項以外的內容。</div>';
      return;
    }

    container.innerHTML =
      systemOption +
      options
        .map((option) => {
          return `
            <div class="option-pill">
              <span>${AppApi.escapeHtml(option.name)}</span>
              <button class="button button--delete" data-action="${action}" data-id="${AppApi.escapeHtml(option.id)}" type="button">移除</button>
            </div>
          `;
        })
        .join("");
  }

  function render() {
    updateMetrics();
    const rows = filteredStudents();

    if (!rows.length) {
      setEmpty(students.length ? "沒有符合條件的學員。" : "目前沒有學員資料。");
      return;
    }

    elements.emptyState.hidden = true;
    elements.tableWrap.hidden = false;

    elements.studentsBody.innerHTML = rows
      .map((student) => {
        const status = student.status || "pending";
        const name = AppApi.escapeHtml(studentDisplayName(student));
        const picture = AppApi.escapeHtml(student.linePictureUrl || AppApi.avatarPlaceholder());
        const uuid = AppApi.escapeHtml(student.uuid || "");
        const statusText = AppApi.escapeHtml(statusLabels[status] || status);
        const badge = `<span class="badge badge--${AppApi.escapeHtml(status)}">${statusText}</span>`;
        const reviewNote = student.reviewNote
          ? `<span class="student-note">${AppApi.escapeHtml(student.reviewNote)}</span>`
          : "";

        return `
          <tr>
            <td data-label="學員">
              <div class="student-cell">
                <img src="${picture}" alt="" loading="lazy" />
                <div>
                  <strong>${name}</strong>
                  ${reviewNote}
                </div>
              </div>
            </td>
            <td data-label="狀態">${badge}</td>
            <td data-label="建立時間">${AppApi.formatDate(student.createdAt)}</td>
            <td data-label="更新時間">${AppApi.formatDate(student.updatedAt)}</td>
            <td data-label="操作">
              <div class="actions">
                <div class="actions__group actions__group--review" aria-label="審核操作">
                  <button class="button button--approve" data-action="approved" data-uuid="${uuid}" type="button">通過</button>
                  <button class="button button--pending" data-action="pending" data-uuid="${uuid}" type="button">待審</button>
                </div>
                <div class="actions__group actions__group--records" aria-label="紀錄操作">
                  <button class="button button--records" data-action="records" data-uuid="${uuid}" type="button">簽到</button>
                  <button class="button button--records" data-action="practiceRecords" data-uuid="${uuid}" type="button">練習</button>
                </div>
                <div class="actions__group actions__group--danger" aria-label="移除操作">
                  <button class="button button--delete" data-action="delete" data-uuid="${uuid}" type="button">移除</button>
                </div>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function beginLineLogin() {
    try {
      setLoading(true);
      setEmpty("正在前往 LINE 登入頁面。");
      renderTeacherAuth(null, "正在開啟 LINE 登入。");

      const config = AppApi.requireConfig({ line: true });
      const redirectUri = AppApi.teacherRedirectUri();
      const state = randomString(24);
      const nonce = randomString(24);
      const codeVerifier = randomString(64);
      const codeChallenge = await sha256(codeVerifier);

      sessionStorage.setItem(
        OAUTH_KEY,
        JSON.stringify({
          state,
          nonce,
          codeVerifier,
          redirectUri
        })
      );

      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.lineChannelId,
        redirect_uri: redirectUri,
        state,
        scope: "profile openid",
        nonce
      });

      if (codeChallenge) {
        params.set("code_challenge", codeChallenge);
        params.set("code_challenge_method", "S256");
      }

      window.location.assign(AUTH_URL + "?" + params.toString());
    } catch (error) {
      renderTeacherAuth(null, error.message);
      setEmpty(error.message);
      setLoading(false);
    }
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const code = params.get("code");
    const returnedState = params.get("state");

    if (error) {
      AppApi.cleanOauthParams();
      renderTeacherAuth(null, params.get("error_description") || "LINE 登入未完成。");
      setEmpty("LINE 登入未完成。");
      return true;
    }

    if (!code) return false;

    setLoading(true);
    setEmpty("正在驗證 LINE 登入。");
    renderTeacherAuth(null, "正在驗證 LINE 登入。");

    try {
      const oauth = JSON.parse(sessionStorage.getItem(OAUTH_KEY) || "null");
      if (!oauth || oauth.state !== returnedState) {
        throw new Error("LINE state 驗證失敗，請重新登入。");
      }

      const teacher = await AppApi.post("teacherLineLogin", {
        code,
        nonce: oauth.nonce,
        codeVerifier: oauth.codeVerifier,
        redirectUri: oauth.redirectUri
      });

      sessionStorage.removeItem(OAUTH_KEY);
      saveTeacherSession(teacher);
      AppApi.cleanOauthParams();
      renderTeacherAuth(teacher);

      if (normalizeStatus(teacher.status) === "approved") {
        await loadStudents();
      } else {
        setEmpty("師資帳號尚未審核通過。請在 GAS 的 teachers 工作表將此 LINE 使用者 status 改為 approved。");
      }
    } catch (callbackError) {
      renderTeacherAuth(null, callbackError.message);
      setEmpty(callbackError.message);
    } finally {
      setLoading(false);
    }

    return true;
  }

  async function refreshTeacherStatus(options) {
    const session = readTeacherSession();
    if (!session) {
      renderLoggedOut();
      return;
    }

    setLoading(true);
    if (!options || options.showMessage !== false) {
      setEmpty("正在檢查師資審核狀態。");
    }

    try {
      const teacher = await AppApi.post("getTeacherStatus", {
        teacherUuid: session.uuid,
        teacherToken: session.publicToken
      });
      saveTeacherSession(teacher);
      renderTeacherAuth(teacher);

      if (normalizeStatus(teacher.status) !== "approved") {
        students = [];
        updateMetrics();
        setEmpty("師資帳號尚未審核通過。請在 GAS 的 teachers 工作表將 status 改為 approved。");
        return;
      }

      await loadStudents();
    } catch (error) {
      clearTeacherSession();
      renderTeacherAuth(null, error.message);
      setEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadStudents() {
    if (!requireApprovedTeacher()) return;

    setLoading(true);
    setEmpty("正在載入學員名單。");
    hideAttendanceRecords();
    hidePracticeRecords();

    try {
      const data = await AppApi.post("listStudents", teacherPayload());
      const settings = await AppApi.post("listPracticeSettings", teacherPayload());
      students = data.students || [];
      practiceSettings = {
        targets: settings.targets || [],
        items: settings.items || [],
        location: settings.location || defaultLocationSettings()
      };
      renderPracticeSettings();
      render();
    } catch (error) {
      setEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(uuid, status) {
    if (!requireApprovedTeacher()) return;
    const current = students.find((student) => student.uuid === uuid);
    const note =
      status === "rejected"
        ? window.prompt("未通過原因，可留空：", current ? current.reviewNote || "" : "") || ""
        : "";

    setLoading(true);

    try {
      const updated = await AppApi.post("updateStudentStatus", teacherPayload({
        uuid,
        status,
        reviewNote: note
      }));

      students = students.map((student) => (student.uuid === uuid ? updated.student : student));
      render();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteStudent(uuid) {
    if (!requireApprovedTeacher()) return;
    const current = students.find((student) => student.uuid === uuid);
    const name = studentDisplayName(current);

    if (!window.confirm(`確定移除「${name}」？這會從 Google Sheet 刪除此學員資料。`)) {
      return;
    }

    setLoading(true);

    try {
      await AppApi.post("deleteStudent", teacherPayload({
        uuid
      }));

      students = students.filter((student) => student.uuid !== uuid);
      if (selectedAttendanceUuid === uuid) hideAttendanceRecords();
      if (selectedPracticeUuid === uuid) hidePracticeRecords();
      render();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttendanceRecords(uuid) {
    if (!requireApprovedTeacher()) return;
    const current = students.find((student) => student.uuid === uuid);
    const name = studentDisplayName(current);

    selectedAttendanceUuid = uuid;
    elements.attendanceRegion.hidden = false;
    elements.attendanceTitle.textContent = `${name} 簽到紀錄`;
    elements.attendanceBody.innerHTML = "";
    setAttendanceEmpty("正在載入簽到紀錄。");
    setLoading(true);

    try {
      const data = await AppApi.post("listAttendanceRecords", teacherPayload({
        uuid
      }));
      const records = data.records || [];

      elements.attendanceTitle.textContent = `${data.student.lineName || name} 簽到紀錄`;

      if (!records.length) {
        setAttendanceEmpty("目前沒有簽到紀錄。");
        return;
      }

      elements.attendanceEmpty.hidden = true;
      elements.attendanceTableWrap.hidden = false;
      elements.attendanceBody.innerHTML = records
        .map((record) => {
          const status = record.checkOutAt
            ? '<span class="badge badge--closed">已簽退</span>'
            : '<span class="badge badge--active">進行中</span>';

          return `
            <tr>
              <td>${AppApi.formatDate(record.checkInAt)}</td>
              <td>${record.checkOutAt ? AppApi.formatDate(record.checkOutAt) : "-"}</td>
              <td>${durationLabel(record)}</td>
              <td>${AppApi.escapeHtml(attendanceLocationText(record))}</td>
              <td>${status}</td>
            </tr>
          `;
        })
        .join("");
    } catch (error) {
      setAttendanceEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPracticeRecords(uuid) {
    if (!requireApprovedTeacher()) return;
    const current = students.find((student) => student.uuid === uuid);
    const name = studentDisplayName(current);

    selectedPracticeUuid = uuid;
    elements.practiceRecordRegion.hidden = false;
    elements.practiceRecordTitle.textContent = `${name} 練習紀錄`;
    elements.practiceRecordBody.innerHTML = "";
    setPracticeRecordEmpty("正在載入練習紀錄。");
    setLoading(true);

    try {
      const data = await AppApi.post("listPracticeRecords", teacherPayload({
        uuid
      }));
      const records = data.records || [];

      elements.practiceRecordTitle.textContent = `${data.student.lineName || name} 練習紀錄`;

      if (!records.length) {
        setPracticeRecordEmpty("目前沒有練習紀錄。");
        return;
      }

      elements.practiceRecordEmpty.hidden = true;
      elements.practiceRecordTableWrap.hidden = false;
      elements.practiceRecordBody.innerHTML = records
        .map((record) => {
          const status = record.endedAt
            ? '<span class="badge badge--closed">已結束</span>'
            : '<span class="badge badge--active">進行中</span>';

          return `
            <tr>
              <td>${AppApi.escapeHtml(record.targetName || "-")}</td>
              <td>${AppApi.escapeHtml(record.itemName || "-")}</td>
              <td>${AppApi.formatDate(record.startedAt)}</td>
              <td>${record.endedAt ? AppApi.formatDate(record.endedAt) : "-"}</td>
              <td>${durationLabel(record)}</td>
              <td>${AppApi.escapeHtml(practiceLocationText(record))}</td>
              <td>${status}</td>
            </tr>
          `;
        })
        .join("");
    } catch (error) {
      setPracticeRecordEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function addPracticeOption(action, input, settingsKey) {
    if (!requireApprovedTeacher()) return;
    const name = input.value.trim();

    if (!name) {
      window.alert("請輸入名稱。");
      return;
    }

    if (name === PRACTICE_OTHER_OPTION_NAME) {
      window.alert("「其他」已是系統固定選項。");
      return;
    }

    setLoading(true);

    try {
      const data = await AppApi.post(action, teacherPayload({
        name
      }));
      const option = data.target || data.item;
      practiceSettings[settingsKey] = [option].concat(practiceSettings[settingsKey]);
      input.value = "";
      renderPracticeSettings();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deletePracticeOption(action, id, settingsKey) {
    if (!requireApprovedTeacher()) return;

    if (!window.confirm("確定移除此選項？既有練習紀錄會保留原本名稱。")) {
      return;
    }

    setLoading(true);

    try {
      await AppApi.post(action, teacherPayload({
        id
      }));
      practiceSettings[settingsKey] = practiceSettings[settingsKey].filter((option) => option.id !== id);
      renderPracticeSettings();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  function currentLocationFormValue() {
    return {
      enabled: elements.locationEnabledInput.checked,
      name: elements.locationNameInput.value.trim(),
      latitude: elements.locationLatitudeInput.value.trim(),
      longitude: elements.locationLongitudeInput.value.trim(),
      radiusMeters: elements.locationRadiusInput.value.trim()
    };
  }

  function validateLocationForm(payload) {
    if (!payload.enabled) return "";

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const radius = Number(payload.radiusMeters);

    if (
      !payload.latitude ||
      !payload.longitude ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return "請先使用目前定位或地圖選點設定位置。";
    }
    if (!Number.isFinite(radius) || radius < 10 || radius > 10000) return "半徑需介於 10 到 10000 公尺。";

    return "";
  }

  function getTeacherCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("此瀏覽器不支援定位。"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : ""
          });
        },
        (error) => {
          const messages = {
            1: "定位權限被拒絕。",
            2: "目前無法取得定位。",
            3: "取得定位逾時。"
          };
          reject(new Error(messages[error.code] || "取得定位失敗。"));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  async function detectLocation() {
    setLoading(true);
    renderLocationSummary(currentLocationFormValue(), "正在取得目前定位。");

    try {
      const location = await getTeacherCurrentLocation();
      if (!elements.locationRadiusInput.value.trim()) elements.locationRadiusInput.value = "100";
      if (!elements.locationNameInput.value.trim()) elements.locationNameInput.value = "練習地點";
      const accuracyText = location.accuracy ? `精準度約 ${location.accuracy} 公尺。` : "已填入目前定位。";
      setLocationPoint(location.latitude, location.longitude, { message: accuracyText });
    } catch (error) {
      renderLocationSummary(currentLocationFormValue(), error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveLocationSettings() {
    if (!requireApprovedTeacher()) return;

    const payload = currentLocationFormValue();
    const validationMessage = validateLocationForm(payload);
    if (validationMessage) {
      window.alert(validationMessage);
      return;
    }

    setLoading(true);

    try {
      const data = await AppApi.post("updateLocationSettings", teacherPayload(payload));
      practiceSettings.location = data.location || defaultLocationSettings();
      renderLocationSettings();
      renderLocationSummary(practiceSettings.location, "定位範圍已儲存。");
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  function bindEvents() {
    elements.themeToggle.addEventListener("click", toggleTheme);
    elements.viewButtons.forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.view));
    });
    elements.connectButton.addEventListener("click", () => {
      if (readTeacherSession()) {
        refreshTeacherStatus();
      } else {
        beginLineLogin();
      }
    });
    elements.logoutButton.addEventListener("click", () => {
      clearTeacherSession();
      renderLoggedOut();
    });
    elements.reloadButton.addEventListener("click", () => refreshTeacherStatus());
    elements.closeAttendanceButton.addEventListener("click", hideAttendanceRecords);
    elements.closePracticeRecordButton.addEventListener("click", hidePracticeRecords);
    elements.addPracticeTargetButton.addEventListener("click", () => {
      addPracticeOption("addPracticeTarget", elements.practiceTargetInput, "targets");
    });
    elements.addPracticeItemButton.addEventListener("click", () => {
      addPracticeOption("addPracticeItem", elements.practiceItemInput, "items");
    });
    elements.detectLocationButton.addEventListener("click", detectLocation);
    elements.openLocationMapButton.addEventListener("click", openLocationMap);
    elements.closeLocationMapButton.addEventListener("click", closeLocationMap);
    elements.saveLocationButton.addEventListener("click", saveLocationSettings);
    [
      elements.locationEnabledInput,
      elements.locationNameInput,
      elements.locationLatitudeInput,
      elements.locationLongitudeInput,
      elements.locationRadiusInput
    ].forEach((input) => {
      input.addEventListener("input", () => {
        renderLocationSummary(currentLocationFormValue());
        updateLocationMapFromForm();
      });
      input.addEventListener("change", () => {
        renderLocationSummary(currentLocationFormValue());
        updateLocationMapFromForm();
      });
    });
    elements.practiceTargetInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addPracticeOption("addPracticeTarget", elements.practiceTargetInput, "targets");
    });
    elements.practiceItemInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addPracticeOption("addPracticeItem", elements.practiceItemInput, "items");
    });
    elements.searchInput.addEventListener("input", render);
    elements.statusFilter.addEventListener("change", render);

    elements.studentsBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      if (button.dataset.action === "delete") {
        deleteStudent(button.dataset.uuid);
        return;
      }

      if (button.dataset.action === "records") {
        loadAttendanceRecords(button.dataset.uuid);
        return;
      }

      if (button.dataset.action === "practiceRecords") {
        loadPracticeRecords(button.dataset.uuid);
        return;
      }

      updateStatus(button.dataset.uuid, button.dataset.action);
    });

    elements.practiceTargetList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      deletePracticeOption(button.dataset.action, button.dataset.id, "targets");
    });

    elements.practiceItemList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      deletePracticeOption(button.dataset.action, button.dataset.id, "items");
    });
  }

  async function init() {
    setTheme(currentTheme(), { persist: false });
    bindEvents();

    setLoading(true);
    try {
      await AppApi.loadConfig();
    } catch (error) {
      setEmpty(error.message);
      setLoading(false);
      return;
    }
    setLoading(false);

    const handledCallback = await handleCallback();
    if (handledCallback) return;

    if (readTeacherSession()) {
      await refreshTeacherStatus({ showMessage: false });
      return;
    }

    renderLoggedOut();
  }

  init();
})();
