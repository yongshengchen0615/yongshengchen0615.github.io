(function () {
  "use strict";

  const STORAGE_KEY = "studentApprovalSession";
  const OAUTH_KEY = "lineOAuth";
  const AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";

  const elements = {
    refreshButton: document.getElementById("refreshButton"),
    notice: document.getElementById("notice"),
    profile: document.getElementById("profile"),
    profileAvatar: document.getElementById("profileAvatar"),
    profileName: document.getElementById("profileName"),
    profileUuid: document.getElementById("profileUuid"),
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
    setStatus(isBusy ? "busy" : "idle", message);
  }

  function setStatus(status, message) {
    elements.statusDot.className = "status-dot status-dot--" + status;
    elements.statusText.textContent = message || statusText[status] || statusText.idle;
  }

  function setNotice(message) {
    elements.notice.textContent = message;
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
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(OAUTH_KEY);
  }

  function renderStudent(student) {
    const status = student.status || "pending";
    setStatus(status, statusText[status] || "待師資審核");

    elements.profile.hidden = false;
    elements.profileAvatar.src = student.linePictureUrl || AppApi.avatarPlaceholder();
    elements.profileAvatar.alt = student.lineName ? student.lineName + " 的 LINE 頭像" : "LINE 頭像";
    elements.profileName.textContent = student.lineName || "LINE 使用者";
    elements.profileUuid.textContent = student.lineUserId || student.uuid;
    elements.refreshButton.hidden = false;

    if (status === "approved") {
      setNotice("審核已通過，可以進入後續學員流程。");
    } else if (status === "rejected") {
      setNotice(student.reviewNote || "審核未通過，請聯繫師資確認資料。");
    } else {
      setNotice("資料已送出，目前等待師資審核。");
    }
  }

  function renderLoggedOut() {
    elements.profile.hidden = true;
    elements.refreshButton.hidden = true;
    setStatus("idle", "尚未登入");
    setNotice("系統會自動開啟 LINE 登入，並送出資料等待師資審核。");
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
    }
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", refreshStatus);
  }

  async function init() {
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
