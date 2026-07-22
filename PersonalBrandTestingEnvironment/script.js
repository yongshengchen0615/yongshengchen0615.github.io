(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var STATE_IDS = ["loading-state", "login-state", "setup-state", "member-state", "error-state"];
  var FETCH_TIMEOUT_MS = 12000;
  var BRIDGE_TIMEOUT_MS = 20000;
  var currentIdToken = "";
  var isDemoSession = false;
  var toastTimer = null;
  var bootVersion = 0;

  function loadConfig() {
    return window
      .fetch(new URL("config.json", document.baseURI).toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
      })
      .then(function (response) {
        if (!response.ok) {
          throw createClientError(
            "CONFIG_LOAD_ERROR",
            "無法載入 config.json。請確認設定檔已與 index.html 一起發布。"
          );
        }
        return response.json();
      })
      .then(function (config) {
        if (!config || typeof config !== "object" || Array.isArray(config)) {
          throw createClientError("CONFIG_FORMAT_ERROR", "config.json 的最外層必須是 JSON 物件。");
        }

        ["LIFF_ID", "GAS_WEB_APP_URL", "BRAND_NAME"].forEach(function (key) {
          if (typeof config[key] !== "string") {
            throw createClientError(
              "CONFIG_FORMAT_ERROR",
              "config.json 的 " + key + " 必須是字串。"
            );
          }
        });

        CONFIG = Object.freeze({
          LIFF_ID: config.LIFF_ID,
          GAS_WEB_APP_URL: config.GAS_WEB_APP_URL,
          BRAND_NAME: config.BRAND_NAME,
        });
      })
      .catch(function (error) {
        if (error && error.code) throw error;
        throw createClientError(
          "CONFIG_LOAD_ERROR",
          "無法讀取 config.json。請透過網站伺服器開啟頁面並確認 JSON 格式正確。"
        );
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

        if (!response.data || !response.data.member) {
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
      // 不指定 redirectUri，讓 LIFF 使用 Console 中的 Endpoint URL，避免網址不符。
      window.liff.login();
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
    var request = {
      action: action,
      idToken: idToken,
      requestId: createRequestId(),
      callbackOrigin: getCallbackOrigin(),
      context: context || {},
      transport: "fetch",
    };

    return postWithFetch(request).catch(function (error) {
      if (!shouldUseBridgeFallback(error)) throw error;
      return postWithBridge(request);
    });
  }

  function postWithFetch(request) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    return window
      .fetch(String(CONFIG.GAS_WEB_APP_URL).trim(), {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      })
      .then(function (response) {
        if (!response.ok) {
          throw createClientError("BACKEND_HTTP_ERROR", "GAS 後台目前無法回應。");
        }
        return response.text();
      })
      .then(function (text) {
        var result;
        try {
          result = JSON.parse(text);
        } catch (_error) {
          throw createClientError(
            "BACKEND_RESPONSE_ERROR",
            "GAS 回傳的不是 JSON。請確認 Web App 已設為「任何人」可存取，並使用 /exec 網址。"
          );
        }
        return validateResponseEnvelope(result, request.requestId);
      })
      .finally(function () {
        window.clearTimeout(timeout);
      });
  }

  function postWithBridge(originalRequest) {
    return new Promise(function (resolve, reject) {
      var requestSecret = createRandomHex(24);
      var frameName = "gas_bridge_" + originalRequest.requestId.replace(/[^a-zA-Z0-9]/g, "");
      var iframe = document.createElement("iframe");
      var form = document.createElement("form");
      var timeout;
      var settled = false;

      iframe.name = frameName;
      iframe.title = "會員資料同步通道";
      iframe.hidden = true;

      form.method = "POST";
      form.action = String(CONFIG.GAS_WEB_APP_URL).trim();
      form.target = frameName;
      form.acceptCharset = "UTF-8";
      form.hidden = true;

      appendHiddenField(form, "action", originalRequest.action);
      appendHiddenField(form, "idToken", originalRequest.idToken);
      appendHiddenField(form, "requestId", originalRequest.requestId);
      appendHiddenField(form, "requestSecret", requestSecret);
      appendHiddenField(form, "callbackOrigin", originalRequest.callbackOrigin);
      appendHiddenField(form, "context", JSON.stringify(originalRequest.context || {}));
      appendHiddenField(form, "transport", "bridge");

      function cleanup() {
        window.clearTimeout(timeout);
        window.removeEventListener("message", receiveMessage);
        form.remove();
        window.setTimeout(function () {
          iframe.remove();
        }, 0);
      }

      function finish(callback, value) {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      }

      function receiveMessage(event) {
        var message = event.data;
        if (!isPlausibleGasOrigin(event.origin)) return;
        if (!message || message.type !== "MEMBER_GAS_RESPONSE") return;
        if (message.requestId !== originalRequest.requestId || message.requestSecret !== requestSecret) return;

        try {
          finish(resolve, validateResponseEnvelope(message.result, originalRequest.requestId));
        } catch (error) {
          finish(reject, error);
        }
      }

      window.addEventListener("message", receiveMessage);
      document.body.appendChild(iframe);
      document.body.appendChild(form);

      timeout = window.setTimeout(function () {
        finish(
          reject,
          createClientError(
            "BACKEND_TIMEOUT",
            "等待 GAS 回應逾時。請確認 ALLOWED_ORIGINS 與 Web App 存取權限設定。"
          )
        );
      }, BRIDGE_TIMEOUT_MS);

      form.submit();
    });
  }

  function appendHiddenField(form, name, value) {
    var input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value == null ? "" : String(value);
    form.appendChild(input);
  }

  function validateResponseEnvelope(result, requestId) {
    if (!result || typeof result !== "object" || result.requestId !== requestId) {
      throw createClientError("INVALID_RESPONSE", "無法確認 GAS 回應與本次請求相符。");
    }
    return result;
  }

  function shouldUseBridgeFallback(error) {
    return (
      error instanceof TypeError ||
      (error && (error.name === "AbortError" || error.code === "FETCH_NETWORK_ERROR"))
    );
  }

  function isPlausibleGasOrigin(origin) {
    if (origin === "https://script.google.com") return true;
    try {
      var url = new URL(origin);
      return (
        url.protocol === "https:" &&
        (url.hostname === "script.googleusercontent.com" ||
          url.hostname.endsWith(".script.googleusercontent.com"))
      );
    } catch (_error) {
      return false;
    }
  }

  function assertSuccessfulResponse(response) {
    if (response && response.ok) return;

    var code = response && response.code ? response.code : "BACKEND_ERROR";
    var message = response && response.message ? response.message : "會員後台暫時無法處理這次請求。";
    throw createClientError(code, message);
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
    showError(normalized.code, normalized.message);
  }

  function normalizeClientError(error) {
    var code = error && (error.code || error.name);
    var message = error && error.message;
    var knownMessages = {
      INVALID_TOKEN: "LINE 登入憑證無效或已過期，請重新登入後再試。",
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

    try {
      var url = new URL(gasUrl);
      return (
        url.protocol === "https:" &&
        url.hostname === "script.google.com" &&
        /\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  function hasDemoQuery() {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  }

  function getCallbackOrigin() {
    return window.location.origin && window.location.origin !== "null" ? window.location.origin : "";
  }

  function getCleanPageUrl() {
    var url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "req-" + createRandomHex(16);
  }

  function createRandomHex(byteLength) {
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") {
      throw createClientError("SECURE_RANDOM_UNAVAILABLE", "目前瀏覽器不支援安全連線所需功能。");
    }

    var bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
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
