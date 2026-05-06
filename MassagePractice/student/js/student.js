(function () {
  "use strict";

  const STORAGE_KEY = "studentApprovalSession";
  const VIEW_STORAGE_KEY = "studentActiveView";
  const THEME_STORAGE_KEY = "massageTheme";
  const OAUTH_KEY = "lineOAuth";
  const AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
  const PRACTICE_OTHER_OPTION_ID = "__other__";
  const PRACTICE_OTHER_OPTION_NAME = "其他";
  let currentStudent = null;
  let activeStudentView = readStudentView();
  let practiceTimerId = 0;
  let practiceTimerStartMs = 0;
  let practiceTimerPendingStart = false;

  const elements = {
    refreshButton: document.getElementById("refreshButton"),
    checkInButton: document.getElementById("checkInButton"),
    checkOutButton: document.getElementById("checkOutButton"),
    attendancePanel: document.getElementById("attendancePanel"),
    attendanceState: document.getElementById("attendanceState"),
    attendanceList: document.getElementById("attendanceList"),
    studentViewTabs: document.getElementById("studentViewTabs"),
    studentViewButtons: Array.from(document.querySelectorAll("[data-student-view]")),
    practicePanel: document.getElementById("practicePanel"),
    practiceState: document.getElementById("practiceState"),
    practiceTargetSelect: document.getElementById("practiceTargetSelect"),
    practiceTargetOtherField: document.getElementById("practiceTargetOtherField"),
    practiceTargetOtherInput: document.getElementById("practiceTargetOtherInput"),
    practiceItemSelect: document.getElementById("practiceItemSelect"),
    practiceItemOtherField: document.getElementById("practiceItemOtherField"),
    practiceItemOtherInput: document.getElementById("practiceItemOtherInput"),
    startPracticeButton: document.getElementById("startPracticeButton"),
    endPracticeButton: document.getElementById("endPracticeButton"),
    practiceTimerOverlay: document.getElementById("practiceTimerOverlay"),
    practiceTimerValue: document.getElementById("practiceTimerValue"),
    practiceTimerMeta: document.getElementById("practiceTimerMeta"),
    practiceTimerStartedAt: document.getElementById("practiceTimerStartedAt"),
    practiceList: document.getElementById("practiceList"),
    notice: document.getElementById("notice"),
    profile: document.getElementById("profile"),
    profileAvatar: document.getElementById("profileAvatar"),
    profileName: document.getElementById("profileName"),
    themeToggle: document.getElementById("themeToggle"),
    themeToggleIcon: document.getElementById("themeToggleIcon"),
    themeToggleText: document.getElementById("themeToggleText"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText")
  };

  const statusText = {
    idle: "尚未登入",
    pending: "待師資審核",
    approved: "已通過審核",
    rejected: "未通過審核",
    busy: "處理中"
  };

  function normalizeStatus(value) {
    const status = String(value || "").trim().toLowerCase();

    if (["approved", "通過", "已通過", "已通過審核"].includes(status)) return "approved";
    if (["rejected", "未通過", "不通過", "拒絕"].includes(status)) return "rejected";
    if (["pending", "待審", "待審核", "待師資審核", ""].includes(status)) return "pending";

    return status;
  }

  function randomString(byteLength) {
    const bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  function base64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sha256(value) {
    if (!window.crypto.subtle) return "";
    const encoded = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", encoded);
    return base64Url(new Uint8Array(digest));
  }

  function setBusy(isBusy, message) {
    elements.refreshButton.disabled = isBusy;
    elements.checkInButton.disabled = isBusy;
    elements.checkOutButton.disabled = isBusy;
    elements.practiceTargetSelect.disabled = isBusy;
    elements.practiceTargetOtherInput.disabled = isBusy;
    elements.practiceItemSelect.disabled = isBusy;
    elements.practiceItemOtherInput.disabled = isBusy;
    elements.startPracticeButton.disabled = isBusy;
    elements.endPracticeButton.disabled = isBusy;
    setStatus(isBusy ? "busy" : "idle", message);
  }

  function setStatus(status, message) {
    elements.statusDot.className = "status-dot status-dot--" + status;
    elements.statusText.textContent = message || statusText[status] || statusText.idle;
  }

  function setNotice(message) {
    elements.notice.textContent = message;
  }

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

  function readStudentView() {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === "practice" ? "practice" : "attendance";
    } catch (error) {
      return "attendance";
    }
  }

  function saveStudentView(view) {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch (error) {
      // View persistence is optional; the controls still work without localStorage.
    }
  }

  function setStudentView(view, options) {
    const nextView = view === "practice" ? "practice" : "attendance";
    const isApproved = currentStudent && normalizeStatus(currentStudent.status) === "approved";
    activeStudentView = nextView;

    if (!options || options.persist !== false) {
      saveStudentView(nextView);
    }

    elements.studentViewTabs.hidden = !isApproved;
    elements.attendancePanel.hidden = !isApproved || nextView !== "attendance";
    elements.practicePanel.hidden = !isApproved || nextView !== "practice";

    elements.studentViewButtons.forEach((button) => {
      const isSelected = button.dataset.studentView === nextView;
      button.classList.toggle("is-active", isSelected);
      button.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
  }

  function hideStudentViews() {
    elements.studentViewTabs.hidden = true;
    elements.attendancePanel.hidden = true;
    elements.practicePanel.hidden = true;
  }

  function renderStudentSections(student) {
    renderAttendance(student);
    renderPractice(student);
    setStudentView(activeStudentView, { persist: false });
  }

  function padTimerPart(value) {
    return String(value).padStart(2, "0");
  }

  function formatElapsedTime(startMs) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    return [hours, minutes, seconds].map(padTimerPart).join(":");
  }

  function renderPracticeTimerValue() {
    if (!practiceTimerStartMs) {
      elements.practiceTimerValue.textContent = "00:00:00";
      return;
    }

    elements.practiceTimerValue.textContent = formatElapsedTime(practiceTimerStartMs);
  }

  function selectedPracticeName(select, otherInput) {
    if (isPracticeOtherOption(select.value)) return cleanPracticeInput(otherInput);
    const option = select.options[select.selectedIndex];
    return option ? option.textContent.trim() : "";
  }

  function currentPracticeDraftRecord() {
    return {
      targetName: selectedPracticeName(elements.practiceTargetSelect, elements.practiceTargetOtherInput),
      itemName: selectedPracticeName(elements.practiceItemSelect, elements.practiceItemOtherInput),
      startedAt: new Date().toISOString()
    };
  }

  function clearPracticeTimerInterval() {
    if (!practiceTimerId) return;
    window.clearInterval(practiceTimerId);
    practiceTimerId = 0;
  }

  function showPracticeTimer(record, options) {
    options = options || {};
    const start = new Date(record.startedAt);
    const startMs =
      options.preserveStart && practiceTimerStartMs
        ? practiceTimerStartMs
        : Number.isNaN(start.getTime())
          ? Date.now()
          : start.getTime();
    const wasHidden = elements.practiceTimerOverlay.hidden;
    const practiceLabel = [record.targetName, record.itemName]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" / ");

    practiceTimerStartMs = startMs;
    practiceTimerPendingStart = Boolean(options.pendingStart);
    elements.practiceTimerOverlay.hidden = false;
    elements.practiceTimerMeta.textContent = practiceLabel || "練習進行中";
    elements.practiceTimerStartedAt.textContent = practiceTimerPendingStart
      ? "正在建立練習紀錄"
      : record.startedAt
        ? "開始 " + AppApi.formatDate(record.startedAt)
        : "";
    elements.endPracticeButton.textContent = practiceTimerPendingStart ? "開始中" : "結束練習";
    elements.endPracticeButton.disabled = practiceTimerPendingStart;
    document.body.classList.add("practice-timer-open");
    renderPracticeTimerValue();

    if (!practiceTimerId) {
      practiceTimerId = window.setInterval(renderPracticeTimerValue, 1000);
    }

    if (wasHidden) {
      elements.endPracticeButton.focus({ preventScroll: true });
    }
  }

  function freezePracticeTimer(message) {
    renderPracticeTimerValue();
    clearPracticeTimerInterval();
    practiceTimerPendingStart = false;
    elements.endPracticeButton.disabled = true;
    elements.endPracticeButton.textContent = message || "處理中";
  }

  function hidePracticeTimer() {
    clearPracticeTimerInterval();

    practiceTimerStartMs = 0;
    practiceTimerPendingStart = false;
    elements.practiceTimerOverlay.hidden = true;
    elements.practiceTimerValue.textContent = "00:00:00";
    elements.practiceTimerMeta.textContent = "";
    elements.practiceTimerStartedAt.textContent = "";
    elements.endPracticeButton.disabled = true;
    elements.endPracticeButton.textContent = "結束練習";
    document.body.classList.remove("practice-timer-open");
  }

  function saveSession(student) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        uuid: student.uuid,
        publicToken: student.publicToken
      })
    );
  }

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (session && session.uuid && session.publicToken) return session;
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }
    return null;
  }

  function clearSession() {
    currentStudent = null;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(OAUTH_KEY);
  }

  function renderStudent(student) {
    currentStudent = student;
    const status = normalizeStatus(student.status);
    setStatus(status, statusText[status] || "待師資審核");

    elements.profile.hidden = false;
    elements.profileAvatar.src = student.linePictureUrl || AppApi.avatarPlaceholder();
    elements.profileAvatar.alt = student.lineName ? student.lineName + " 的 LINE 頭像" : "LINE 頭像";
    elements.profileName.textContent = student.lineName || "LINE 使用者";
    elements.refreshButton.hidden = false;
    renderStudentSections(student);

    if (status === "approved") {
      setNotice("審核已通過，可以使用簽到簽退與練習紀錄。");
    } else if (status === "rejected") {
      setNotice(student.reviewNote || "審核未通過，請聯繫師資確認資料。");
    } else {
      setNotice("資料已送出，目前等待師資審核。");
    }
  }

  function renderLoggedOut() {
    currentStudent = null;
    elements.profile.hidden = true;
    elements.refreshButton.hidden = true;
    hideStudentViews();
    hidePracticeTimer();
    setStatus("idle", "尚未登入");
    setNotice("系統會自動開啟 LINE 登入，並送出資料等待師資審核。");
  }

  function renderAttendance(student) {
    const isApproved = normalizeStatus(student.status) === "approved";
    const attendance = student.attendance || {};
    const records = Array.isArray(attendance.recent) ? attendance.recent : [];
    const isActive = Boolean(attendance.active && attendance.current);

    if (!isApproved) {
      elements.attendancePanel.hidden = true;
      elements.checkInButton.disabled = true;
      elements.checkOutButton.disabled = true;
      elements.attendanceList.innerHTML = "";
      return;
    }

    elements.attendanceState.textContent = isActive ? "已簽到" : "尚未簽到";
    elements.checkInButton.disabled = isActive;
    elements.checkOutButton.disabled = !isActive;

    elements.attendanceList.innerHTML = records.length
      ? records
          .map((record) => {
            const checkOutText = record.checkOutAt ? AppApi.formatDate(record.checkOutAt) : "尚未簽退";
            const stateClass = record.checkOutAt ? "attendance-record--closed" : "attendance-record--active";
            const stateText = record.checkOutAt ? "已簽退" : "進行中";

            return `
              <div class="attendance-record ${stateClass}">
                <div class="attendance-times">
                  <span>簽到 ${AppApi.formatDate(record.checkInAt)}</span>
                  <span>簽退 ${checkOutText}</span>
                  <span>停留時間 ${durationLabel(record.checkInAt, record.checkOutAt)}</span>
                </div>
                <strong>${stateText}</strong>
              </div>
            `;
          })
          .join("")
      : '<div class="attendance-empty">尚無簽到紀錄。</div>';
  }

  function durationLabel(startValue, endValue) {
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

  function renderPractice(student) {
    const isApproved = normalizeStatus(student.status) === "approved";
    const practice = student.practice || {};
    const options = practice.options || {};
    const targets = Array.isArray(options.targets) ? options.targets : [];
    const items = Array.isArray(options.items) ? options.items : [];
    const records = Array.isArray(practice.recent) ? practice.recent : [];
    const isActive = Boolean(practice.active && practice.current);
    const hasOptions = true;

    if (!isApproved) {
      elements.practicePanel.hidden = true;
      elements.practiceTargetSelect.disabled = true;
      elements.practiceTargetOtherField.hidden = true;
      elements.practiceTargetOtherInput.disabled = true;
      elements.practiceItemSelect.disabled = true;
      elements.practiceItemOtherField.hidden = true;
      elements.practiceItemOtherInput.disabled = true;
      elements.startPracticeButton.disabled = true;
      elements.endPracticeButton.disabled = true;
      elements.practiceList.innerHTML = "";
      hidePracticeTimer();
      return;
    }

    elements.practiceState.textContent = isActive ? "練習中" : "尚未練習";
    elements.practiceTargetSelect.innerHTML = selectOptions(targets, "選擇練習對象");
    elements.practiceItemSelect.innerHTML = selectOptions(items, "選擇練習項目");
    elements.practiceTargetSelect.disabled = isActive;
    elements.practiceItemSelect.disabled = isActive;
    updatePracticeOtherFields(isActive);
    elements.endPracticeButton.disabled = !isActive;
    if (isActive) {
      showPracticeTimer(practice.current, { preserveStart: practiceTimerPendingStart });
    } else {
      hidePracticeTimer();
    }

    elements.practiceList.innerHTML = records.length
      ? records
          .map((record) => {
            const endText = record.endedAt ? AppApi.formatDate(record.endedAt) : "尚未結束";
            const stateClass = record.endedAt ? "attendance-record--closed" : "attendance-record--active";
            const stateText = record.endedAt ? "已結束" : "進行中";

            return `
              <div class="attendance-record ${stateClass}">
                <div class="attendance-times">
                  <span>${AppApi.escapeHtml(record.targetName || "-")} / ${AppApi.escapeHtml(record.itemName || "-")}</span>
                  <span>開始 ${AppApi.formatDate(record.startedAt)}</span>
                  <span>結束 ${endText}</span>
                  <span>練習時間 ${durationLabel(record.startedAt, record.endedAt)}</span>
                </div>
                <strong>${stateText}</strong>
              </div>
            `;
          })
          .join("")
      : `<div class="attendance-empty">${hasOptions ? "尚無練習紀錄。" : "請先由師資端新增練習對象與練習項目。"}</div>`;
  }

  function selectOptions(options, placeholder) {
    return (
      `<option value="">${AppApi.escapeHtml(placeholder)}</option>` +
      options
        .filter((option) => String(option.name || "").trim() !== PRACTICE_OTHER_OPTION_NAME)
        .map((option) => {
          return `<option value="${AppApi.escapeHtml(option.id)}">${AppApi.escapeHtml(option.name)}</option>`;
        })
        .join("") +
      `<option value="${PRACTICE_OTHER_OPTION_ID}">${PRACTICE_OTHER_OPTION_NAME}</option>`
    );
  }

  function isPracticeOtherOption(value) {
    return value === PRACTICE_OTHER_OPTION_ID;
  }

  function currentPracticeActive() {
    const practice = (currentStudent && currentStudent.practice) || {};
    return Boolean(practice.active && practice.current);
  }

  function cleanPracticeInput(input) {
    return input.value.replace(/\s+/g, " ").trim();
  }

  function practiceSelectionComplete() {
    const targetId = elements.practiceTargetSelect.value;
    const itemId = elements.practiceItemSelect.value;

    if (!targetId || !itemId) return false;
    if (isPracticeOtherOption(targetId) && !cleanPracticeInput(elements.practiceTargetOtherInput)) return false;
    if (isPracticeOtherOption(itemId) && !cleanPracticeInput(elements.practiceItemOtherInput)) return false;

    return true;
  }

  function updatePracticeOtherFields(isActive) {
    const isApproved = currentStudent && normalizeStatus(currentStudent.status) === "approved";
    const disabledByActive = typeof isActive === "boolean" ? isActive : currentPracticeActive();
    const targetIsOther = isPracticeOtherOption(elements.practiceTargetSelect.value);
    const itemIsOther = isPracticeOtherOption(elements.practiceItemSelect.value);

    elements.practiceTargetOtherField.hidden = !targetIsOther;
    elements.practiceTargetOtherInput.disabled = disabledByActive || !targetIsOther;
    elements.practiceTargetOtherInput.required = targetIsOther;
    if (!targetIsOther) elements.practiceTargetOtherInput.value = "";

    elements.practiceItemOtherField.hidden = !itemIsOther;
    elements.practiceItemOtherInput.disabled = disabledByActive || !itemIsOther;
    elements.practiceItemOtherInput.required = itemIsOther;
    if (!itemIsOther) elements.practiceItemOtherInput.value = "";

    elements.startPracticeButton.disabled = !isApproved || disabledByActive || !practiceSelectionComplete();
  }

  async function beginLineLogin() {
    try {
      setStatus("busy", "正在開啟 LINE 登入");
      setNotice("正在前往 LINE 登入頁面。");

      const config = AppApi.requireConfig({ line: true });
      const redirectUri = AppApi.studentRedirectUri();
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
      setStatus("rejected", "設定未完成");
      setNotice(error.message);
    }
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const code = params.get("code");
    const returnedState = params.get("state");

    if (error) {
      AppApi.cleanOauthParams();
      setStatus("rejected", "LINE 登入取消");
      setNotice(params.get("error_description") || "LINE 登入未完成。");
      return true;
    }

    if (!code) return false;

    setBusy(true, "正在驗證 LINE 登入");

    try {
      const oauth = JSON.parse(sessionStorage.getItem(OAUTH_KEY) || "null");
      if (!oauth || oauth.state !== returnedState) {
        throw new Error("LINE state 驗證失敗，請重新登入。");
      }

      const student = await AppApi.post("lineLogin", {
        code,
        nonce: oauth.nonce,
        codeVerifier: oauth.codeVerifier,
        redirectUri: oauth.redirectUri
      });

      sessionStorage.removeItem(OAUTH_KEY);
      saveSession(student);
      AppApi.cleanOauthParams();
      renderStudent(student);
    } catch (error) {
      setStatus("rejected", "登入失敗");
      setNotice(error.message);
    } finally {
      elements.refreshButton.disabled = false;
    }

    return true;
  }

  async function recordAttendance(action) {
    const session = readSession();
    if (!session) {
      renderLoggedOut();
      await beginLineLogin();
      return;
    }

    setBusy(true, action === "checkIn" ? "正在簽到" : "正在簽退");

    try {
      const student = await AppApi.post(action, session);
      saveSession(student);
      renderStudent(student);
    } catch (error) {
      setStatus("rejected", action === "checkIn" ? "簽到失敗" : "簽退失敗");
      setNotice(error.message);
    } finally {
      elements.refreshButton.disabled = false;
      if (currentStudent) {
        renderStudentSections(currentStudent);
      }
    }
  }

  async function recordPractice(action) {
    const session = readSession();
    if (!session) {
      renderLoggedOut();
      await beginLineLogin();
      return;
    }

    const payload = {
      uuid: session.uuid,
      publicToken: session.publicToken
    };

    if (action === "startPractice") {
      payload.targetId = elements.practiceTargetSelect.value;
      payload.itemId = elements.practiceItemSelect.value;

      if (!payload.targetId || !payload.itemId) {
        setStatus("rejected", "練習資料未完成");
        setNotice("請先選擇練習對象與練習項目。");
        return;
      }

      if (isPracticeOtherOption(payload.targetId)) {
        payload.targetName = cleanPracticeInput(elements.practiceTargetOtherInput);

        if (!payload.targetName) {
          setStatus("rejected", "練習資料未完成");
          setNotice("請輸入其他練習對象。");
          updatePracticeOtherFields(false);
          return;
        }
      }

      if (isPracticeOtherOption(payload.itemId)) {
        payload.itemName = cleanPracticeInput(elements.practiceItemOtherInput);

        if (!payload.itemName) {
          setStatus("rejected", "練習資料未完成");
          setNotice("請輸入其他練習項目。");
          updatePracticeOtherFields(false);
          return;
        }
      }
    }

    if (action === "startPractice") {
      showPracticeTimer(currentPracticeDraftRecord(), { pendingStart: true });
    } else {
      freezePracticeTimer("結束中");
    }

    setBusy(true, action === "startPractice" ? "正在開始練習" : "正在結束練習");

    try {
      const student = await AppApi.post(action, payload);
      saveSession(student);
      renderStudent(student);
    } catch (error) {
      if (action === "startPractice") {
        hidePracticeTimer();
      } else if (currentPracticeActive()) {
        showPracticeTimer(currentStudent.practice.current, { preserveStart: true });
      }

      setStatus("rejected", action === "startPractice" ? "開始失敗" : "結束失敗");
      setNotice(error.message);
    } finally {
      elements.refreshButton.disabled = false;
      if (currentStudent) {
        renderStudentSections(currentStudent);
      }
    }
  }

  async function refreshStatus() {
    const session = readSession();
    if (!session) {
      renderLoggedOut();
      return;
    }

    setBusy(true, "正在更新審核狀態");

    try {
      const student = await AppApi.post("getStudentStatus", session);
      renderStudent(student);
    } catch (error) {
      setStatus("rejected", "更新失敗");
      setNotice(error.message);
      clearSession();
      await beginLineLogin();
    } finally {
      elements.refreshButton.disabled = false;
      if (currentStudent) {
        renderStudentSections(currentStudent);
      }
    }
  }

  function bindEvents() {
    elements.themeToggle.addEventListener("click", toggleTheme);
    elements.refreshButton.addEventListener("click", refreshStatus);
    elements.studentViewButtons.forEach((button) => {
      button.addEventListener("click", () => setStudentView(button.dataset.studentView));
    });
    elements.checkInButton.addEventListener("click", () => recordAttendance("checkIn"));
    elements.checkOutButton.addEventListener("click", () => recordAttendance("checkOut"));
    elements.practiceTargetSelect.addEventListener("change", () => updatePracticeOtherFields());
    elements.practiceTargetOtherInput.addEventListener("input", () => updatePracticeOtherFields());
    elements.practiceItemSelect.addEventListener("change", () => updatePracticeOtherFields());
    elements.practiceItemOtherInput.addEventListener("input", () => updatePracticeOtherFields());
    elements.startPracticeButton.addEventListener("click", () => recordPractice("startPractice"));
    elements.endPracticeButton.addEventListener("click", () => recordPractice("endPractice"));
  }

  async function init() {
    setTheme(currentTheme(), { persist: false });
    bindEvents();

    try {
      await AppApi.loadConfig();
    } catch (error) {
      setStatus("rejected", "設定讀取失敗");
      setNotice(error.message);
      elements.refreshButton.disabled = true;
      return;
    }

    const handledCallback = await handleCallback();
    if (handledCallback) return;

    const session = readSession();
    if (session) {
      await refreshStatus();
      return;
    }

    renderLoggedOut();
    await beginLineLogin();
  }

  init();
})();
