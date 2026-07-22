(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var STATE_IDS = [
    "loading-state",
    "login-state",
    "setup-state",
    "access-state",
    "member-state",
    "error-state",
  ];
  var currentIdToken = "";
  var isDemoSession = false;
  var toastTimer = null;
  var bootVersion = 0;
  var INVALID_TOKEN_RECOVERY_PREFIX = "persona-member-invalid-token-recovery:";

  function loadConfig() {
    if (!window.MemberApi) {
      return Promise.reject(
        createClientError("CLIENT_LIBRARY_ERROR", "無法載入會員資料連線元件，請重新整理頁面。")
      );
    }

    return window.MemberApi
      .loadConfig("config.json", ["LIFF_ID", "GAS_WEB_APP_URL", "BRAND_NAME"])
      .then(function (config) {
        CONFIG = config;
      });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function boot() {
    var thisBoot = ++bootVersion;
    isDemoSession = false;
    setView("loading-state");
    setConnection("正在連線", "loading");

    if (hasDemoQuery()) {
      renderDemoMember();
      return Promise.resolve();
    }

    if (!hasCompleteConfig()) {
      setConnection("等待設定", "setup");
      setView("setup-state");
      return Promise.resolve();
    }

    if (!window.liff) {
      showError(
        "LIFF_SDK_UNAVAILABLE",
        "無法載入 LINE 登入元件。請確認網路連線，或稍後重新整理頁面。"
      );
      return Promise.resolve();
    }

    return window.liff
      .init({
        liffId: String(CONFIG.LIFF_ID).trim(),
        withLoginOnExternalBrowser: false,
      })
      .then(function () {
        if (thisBoot !== bootVersion) return;

        if (!window.liff.isLoggedIn()) {
          setConnection("等待登入", "idle");
          setView("login-state");
          return;
        }

        return syncMember(thisBoot);
      })
      .catch(function (error) {
        if (thisBoot !== bootVersion) return;
        handleClientError(error);
      });
  }

  function syncMember(expectedBootVersion) {
    setConnection("驗證會員身分", "loading");
    setLoadingCopy("正在驗證會員身分", "後台正向 LINE 核對本次登入，請稍候。");
    setView("loading-state");

    currentIdToken = window.liff.getIDToken() || "";
    if (!currentIdToken) {
      throw createClientError(
        "MISSING_ID_TOKEN",
        "沒有取得 LINE ID Token。請確認 LIFF 已勾選 openid 權限後重新登入。"
      );
    }

    return sendGasRequest("upsertMember", currentIdToken, getLiffContext())
      .then(function (response) {
        if (expectedBootVersion !== bootVersion) return;
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();

        if (
          !response.data ||
          !response.data.access ||
          typeof response.data.access.allowed !== "boolean"
        ) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員存取狀態格式不完整。");
        }

        if (!response.data.access.allowed) {
          renderAccessState(response.data.access.status, Boolean(response.data.created));
          return;
        }

        if (!response.data.member) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員資料格式不完整。");
        }

        renderMember(response.data.member, Boolean(response.data.created));
      })
      .catch(function (error) {
        if (expectedBootVersion !== bootVersion) return;
        throw error;
      });
  }

  function handleLogin() {
    var button = byId("login-button");
    if (!window.liff || button.disabled) return;

    if (window.liff.isLoggedIn()) {
      boot();
      return;
    }

    if (window.liff.isInClient()) {
      showError("LIFF_LOGIN_ERROR", "LINE 應用程式內沒有取得登入狀態，請關閉頁面後從 LIFF 網址重新開啟。");
      return;
    }

    setButtonBusy(button, true, "前往 LINE 登入");

    try {
      window.liff.login({ redirectUri: getCleanPageUrl() });
    } catch (error) {
      setButtonBusy(button, false);
      handleClientError(error);
    }
  }

  function handleLogout() {
    if (isDemoSession) {
      isDemoSession = false;
      setConnection("等待設定", "setup");
      setView("setup-state");
      showToast("已離開預覽模式");
      return;
    }

    if (!window.liff) return;

    currentIdToken = "";
    clearInvalidTokenRecoveryGuard();

    if (window.liff.isInClient()) {
      window.liff.closeWindow();
      return;
    }

    if (window.liff.isLoggedIn()) {
      window.liff.logout();
    }

    window.location.replace(getCleanPageUrl());
  }

  function handleDeleteMember() {
    var button = byId("delete-confirm-button");
    if (button.disabled) return;

    if (isDemoSession) {
      closeDialog(byId("delete-dialog"));
      showToast("預覽模式不會建立或刪除真實資料");
      return;
    }

    var token = currentIdToken || (window.liff && window.liff.getIDToken()) || "";
    if (!token) {
      closeDialog(byId("delete-dialog"));
      showError("MISSING_ID_TOKEN", "登入狀態已失效，請重新登入後再刪除會員資料。");
      return;
    }

    setButtonBusy(button, true, "正在刪除");

    sendGasRequest("deleteMember", token, getLiffContext())
      .then(function (response) {
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();
        closeDialog(byId("delete-dialog"));
        showToast("會員資料已永久刪除");

        window.setTimeout(function () {
          handleLogout();
        }, 900);
      })
      .catch(function (error) {
        closeDialog(byId("delete-dialog"));
        handleClientError(error);
      })
      .finally(function () {
        setButtonBusy(button, false);
      });
  }

  function sendGasRequest(action, idToken, context) {
    return window.MemberApi.sendRequest({
      gasUrl: String(CONFIG.GAS_WEB_APP_URL).trim(),
      action: action,
      idToken: idToken,
      context: context || {},
    });
  }

  function assertSuccessfulResponse(response) {
    if (response && response.ok) return;

    var code = response && response.code ? response.code : "BACKEND_ERROR";
    var message = response && response.message ? response.message : "會員後台暫時無法處理這次請求。";
    throw createClientError(code, message);
  }

  function renderAccessState(status, wasCreated) {
    byId("access-icon").textContent = "×";
    byId("access-badge").textContent = "已停用";
    byId("access-title").textContent = "目前無法進入會員中心";
    byId("access-message").textContent =
      "管理員目前已停用這個帳號的會員系統使用權。若你認為狀態有誤，請聯絡服務人員後再重新確認。";
    byId("access-state").dataset.status = "denied";
    byId("access-logout-button").textContent =
      window.liff && window.liff.isInClient() ? "關閉會員中心" : "登出目前裝置";

    setConnection("已停用", "error");
    setView("access-state");

    if (wasCreated) {
      showToast("會員資料已建立，但目前無法使用", "error");
    }
  }

  function renderMember(member, wasCreated) {
    var name = cleanDisplayText(member.displayName, "LINE 會員");
    var pictureUrl = getSafeImageUrl(member.pictureUrl);

    byId("member-greeting-name").textContent = name;
    byId("member-display-name").textContent = name;
    byId("member-avatar-fallback").textContent = getInitial(name);
    byId("member-id").textContent = cleanDisplayText(member.memberId, "—");
    byId("member-since").textContent = formatShortDate(member.joinedAt);
    byId("member-email").textContent = cleanDisplayText(member.email, "尚未授權");
    byId("member-login-count").textContent = formatLoginCount(member.loginCount);
    byId("member-last-login").textContent = formatDateTime(member.lastLoginAt);
    byId("member-environment").textContent = formatEnvironment(member.loginContext);
    byId("sync-caption").textContent = wasCreated ? "會員建立完成" : "會員資料已同步";

    var avatar = byId("member-avatar");
    var fallback = byId("member-avatar-fallback");
    avatar.onload = function () {
      fallback.hidden = true;
      avatar.hidden = false;
    };
    avatar.onerror = function () {
      avatar.hidden = true;
      fallback.hidden = false;
      avatar.removeAttribute("src");
    };

    if (pictureUrl) {
      avatar.alt = name + " 的 LINE 頭像";
      avatar.referrerPolicy = "no-referrer";
      avatar.src = pictureUrl;
    } else {
      avatar.hidden = true;
      fallback.hidden = false;
      avatar.removeAttribute("src");
    }

    var logoutButton = byId("logout-button");
    logoutButton.textContent =
      window.liff && window.liff.isInClient() ? "關閉會員中心" : "登出目前裝置";

    setConnection(isDemoSession ? "展示模式" : "安全連線", isDemoSession ? "setup" : "connected");
    setView("member-state");

    if (wasCreated) {
      showToast("會員資料建立完成，歡迎加入");
    }
  }

  function renderDemoMember() {
    isDemoSession = true;
    var now = new Date();
    renderMember(
      {
        memberId: "MBR-PREVIEW",
        displayName: "王小明",
        pictureUrl: "",
        email: "hello@example.com",
        joinedAt: new Date(now.getFullYear(), 0, 18).toISOString(),
        lastLoginAt: now.toISOString(),
        loginCount: 12,
        loginContext: { type: "utou", os: "ios", language: "zh-TW" },
      },
      false
    );
    byId("sync-caption").textContent = "這是預覽資料，不會寫入後台";
  }

  function setView(activeId) {
    STATE_IDS.forEach(function (id) {
      var element = byId(id);
      if (element) element.hidden = id !== activeId;
    });
  }

  function setConnection(label, tone) {
    byId("connection-label").textContent = label;
    byId("connection-status").dataset.tone = tone || "loading";
  }

  function setLoadingCopy(title, message) {
    byId("loading-title").textContent = title;
    var copy = byId("loading-state").querySelector(":scope > p:last-child");
    if (copy) copy.textContent = message;
  }

  function showError(code, message) {
    byId("error-code").textContent = String(code || "CONNECTION_ERROR").replace(/_/g, " ");
    byId("error-message").textContent = message || "連線時發生問題，請稍後再試。";
    setConnection("連線失敗", "error");
    setView("error-state");
  }

  function handleClientError(error) {
    var normalized = normalizeClientError(error);
    console.error("Member app error:", normalized.code, error);

    if (
      (normalized.code === "INVALID_TOKEN" || normalized.code === "INVALID_ID_TOKEN") &&
      tryExternalTokenRecovery()
    ) {
      return;
    }

    showError(normalized.code, normalized.message);
  }

  function tryExternalTokenRecovery() {
    if (!window.liff || window.liff.isInClient()) return false;

    var guardKey =
      INVALID_TOKEN_RECOVERY_PREFIX + String(CONFIG.LIFF_ID || "unknown").trim();

    try {
      if (window.sessionStorage.getItem(guardKey) === "attempted") return false;
      window.sessionStorage.setItem(guardKey, "attempted");
    } catch (_error) {
      // Without a tab-scoped guard, automatic login could redirect forever.
      return false;
    }

    currentIdToken = "";
    setConnection("正在重新登入", "loading");
    setLoadingCopy("正在更新 LINE 登入", "偵測到舊的登入憑證，正在安全地重新登入。");
    setView("loading-state");

    try {
      if (window.liff.isLoggedIn()) window.liff.logout();
      window.liff.login({ redirectUri: getCleanPageUrl() });
      return true;
    } catch (_error) {
      try {
        window.sessionStorage.removeItem(guardKey);
      } catch (_storageError) {
        // The existing error state remains the safe fallback.
      }
      return false;
    }
  }

  function clearInvalidTokenRecoveryGuard() {
    var guardKey =
      INVALID_TOKEN_RECOVERY_PREFIX + String(CONFIG.LIFF_ID || "unknown").trim();
    try {
      window.sessionStorage.removeItem(guardKey);
    } catch (_error) {
      // sessionStorage may be unavailable in privacy-restricted browsers.
    }
  }

  function normalizeClientError(error) {
    var code = error && (error.code || error.name);
    var message = error && error.message;
    var knownMessages = {
      INVALID_TOKEN: "LINE 登入憑證無效或已過期，請重新登入後再試。",
      INVALID_ID_TOKEN: "LINE 登入憑證已失效，請重新登入後再試。",
      MISSING_ID_TOKEN: "沒有取得 LINE 登入憑證。請確認 LIFF 已勾選 openid 權限。",
      CONFIG_ERROR: "GAS 後台尚未完成設定，請檢查 Script Properties。",
      ORIGIN_NOT_ALLOWED: "目前網站來源未被 GAS 允許，請檢查 ALLOWED_ORIGINS。",
      SPREADSHEET_ERROR: "會員試算表目前無法使用，請檢查試算表 ID 與權限。",
      BUSY: "會員資料正在同步，請稍候幾秒後再試。",
      LINE_RATE_LIMITED: "LINE 驗證請求較多，請稍候一分鐘再試。",
      LINE_UNAVAILABLE: "LINE 驗證服務暫時無法使用，請稍後再試。",
      MEMBER_DELETED: "會員資料剛完成刪除，請重新登入後再建立會員。",
    };

    if (knownMessages[code]) message = knownMessages[code];

    return {
      code: code || "CONNECTION_ERROR",
      message: message || "連線時發生問題，請稍後再試。",
    };
  }

  function createClientError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function getLiffContext() {
    var context = {};

    try {
      var liffContext = window.liff.getContext() || {};
      context.type = cleanContextValue(liffContext.type);
      context.viewType = cleanContextValue(liffContext.viewType);
      context.os = cleanContextValue(window.liff.getOS());
      context.language = cleanContextValue(
        typeof window.liff.getAppLanguage === "function"
          ? window.liff.getAppLanguage()
          : window.navigator.language
      );
      context.inClient = Boolean(window.liff.isInClient());
    } catch (_error) {
      context.os = cleanContextValue(window.navigator.platform);
      context.language = cleanContextValue(window.navigator.language);
    }

    return context;
  }

  function cleanContextValue(value) {
    return String(value || "").trim().slice(0, 40);
  }

  function hasCompleteConfig() {
    var liffId = String(CONFIG.LIFF_ID || "").trim();
    var gasUrl = String(CONFIG.GAS_WEB_APP_URL || "").trim();

    if (!liffId || /YOUR_|請填入|REPLACE/i.test(liffId)) return false;
    if (!gasUrl || /YOUR_|請填入|REPLACE/i.test(gasUrl)) return false;

    return Boolean(window.MemberApi && window.MemberApi.isValidGasUrl(gasUrl));
  }

  function hasDemoQuery() {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  }

  function getCleanPageUrl() {
    var url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function cleanDisplayText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || fallback;
  }

  function getInitial(name) {
    return Array.from(String(name || "M").trim())[0] || "M";
  }

  function getSafeImageUrl(value) {
    if (!value) return "";
    try {
      var url = new URL(String(value));
      return url.protocol === "https:" ? url.toString() : "";
    } catch (_error) {
      return "";
    }
  }

  function formatShortDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(date)
      .replace(/\//g, ".");
  }

  function formatDateTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function formatLoginCount(value) {
    var count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count).toLocaleString("zh-TW") + " 次" : "—";
  }

  function formatEnvironment(context) {
    context = context || {};
    var typeLabels = {
      utou: "LINE 一對一聊天室",
      group: "LINE 群組",
      room: "LINE 多人聊天室",
      external: "外部瀏覽器",
      none: "LINE 應用程式",
    };
    var osLabels = { ios: "iOS", android: "Android", web: "Web" };
    var source = typeLabels[context.type] || (context.inClient ? "LINE 應用程式" : "瀏覽器");
    var os = osLabels[context.os] || cleanDisplayText(context.os, "");
    return os ? source + " · " + os : source;
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    var label = button.querySelector("span") || button;

    if (busy) {
      button.dataset.originalLabel = label.textContent;
      button.dataset.originalDisabled = String(button.disabled);
      button.disabled = true;
      label.textContent = busyLabel || "處理中";
      button.setAttribute("aria-busy", "true");
      return;
    }

    if (!("originalLabel" in button.dataset)) {
      button.removeAttribute("aria-busy");
      return;
    }

    button.disabled = button.dataset.originalDisabled === "true";
    label.textContent = button.dataset.originalLabel || label.textContent;
    button.removeAttribute("aria-busy");
    delete button.dataset.originalLabel;
    delete button.dataset.originalDisabled;
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.id === "delete-dialog") resetDeleteConfirmation();
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function resetDeleteConfirmation() {
    var button = byId("delete-confirm-button");
    setButtonBusy(button, false);
    byId("delete-confirm-input").value = "";
    button.disabled = true;
  }

  function showToast(message, tone) {
    var toast = byId("toast");
    window.clearTimeout(toastTimer);
    byId("toast-message").textContent = message;
    toast.dataset.tone = tone || "success";
    toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 4200);
  }

  function applyBrand() {
    var brand = cleanDisplayText(CONFIG.BRAND_NAME, "PERSONA").slice(0, 28);
    document.querySelectorAll("[data-brand-name]").forEach(function (element) {
      element.textContent = brand;
    });
    document.title = brand + " MEMBERS｜會員中心";
  }

  function bindInteractions() {
    byId("login-button").addEventListener("click", handleLogin);
    byId("logout-button").addEventListener("click", handleLogout);
    byId("access-refresh-button").addEventListener("click", boot);
    byId("access-logout-button").addEventListener("click", handleLogout);
    byId("retry-button").addEventListener("click", start);
    byId("preview-button").addEventListener("click", renderDemoMember);
    byId("delete-confirm-button").addEventListener("click", handleDeleteMember);

    document.querySelectorAll("[data-open-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDialog(byId(button.dataset.openDialog));
      });
    });

    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeDialog(button.closest("dialog"));
      });
    });

    document.querySelectorAll("dialog").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    byId("delete-confirm-input").addEventListener("input", function (event) {
      byId("delete-confirm-button").disabled = event.target.value.trim() !== "刪除";
    });

    byId("delete-dialog").addEventListener("close", function () {
      resetDeleteConfirmation();
    });
  }

  bindInteractions();
  byId("current-year").textContent = String(new Date().getFullYear());

  function start() {
    setConnection("正在載入設定", "loading");
    setLoadingCopy("正在載入會員系統", "讀取公開設定並準備 LINE 登入服務。請稍候。");
    setView("loading-state");

    return loadConfig()
      .then(function () {
        applyBrand();
        return boot();
      })
      .catch(handleClientError);
  }

  start();
})();
