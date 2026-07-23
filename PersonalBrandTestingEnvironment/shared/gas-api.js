(function () {
  "use strict";

  var FETCH_TIMEOUT_MS = 12000;
  var BRIDGE_TIMEOUT_MS = 20000;
  var EXTRA_FIELD_NAMES = [
    "targetMemberId",
    "accessStatus",
    "expectedAccessStatus",
    "expectedAccessUpdatedAt",
    "page",
    "pageSize",
    "phone",
    "birthday",
    "claim",
    "pointAmount",
    "pointTypeId",
    "expiresAt",
    "expiryMode",
    "redemptionMode",
    "lotteryPrizes",
  ];

  function loadConfig(relativePath, requiredStringKeys) {
    return window
      .fetch(new URL(relativePath, document.baseURI).toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
      })
      .then(function (response) {
        if (!response.ok) {
          throw createError(
            "CONFIG_LOAD_ERROR",
            "無法載入設定檔。請確認 config.json 已與頁面一起發布。"
          );
        }
        return response.text();
      })
      .then(function (text) {
        var config;
        try {
          config = JSON.parse(text);
        } catch (_error) {
          throw createError("CONFIG_FORMAT_ERROR", "config.json 不是有效的 JSON。");
        }

        if (!config || typeof config !== "object" || Array.isArray(config)) {
          throw createError("CONFIG_FORMAT_ERROR", "config.json 的最外層必須是 JSON 物件。");
        }

        (requiredStringKeys || []).forEach(function (key) {
          if (typeof config[key] !== "string") {
            throw createError("CONFIG_FORMAT_ERROR", "config.json 的 " + key + " 必須是字串。");
          }
        });

        return Object.freeze(config);
      })
      .catch(function (error) {
        if (error && error.code) throw error;
        throw createError(
          "CONFIG_LOAD_ERROR",
          "無法讀取 config.json。請透過網站伺服器開啟頁面後再試。"
        );
      });
  }

  function sendRequest(options) {
    options = options || {};
    var requestId =
      options.requestId === undefined || options.requestId === null
        ? createRequestId()
        : String(options.requestId || "").trim();
    if (!/^[a-zA-Z0-9-]{10,80}$/.test(requestId)) {
      return Promise.reject(
        createError("INVALID_REQUEST_ID", "請求識別碼格式不正確。")
      );
    }
    var request = {
      action: String(options.action || ""),
      idToken: String(options.idToken || ""),
      requestId: requestId,
      callbackOrigin: getCallbackOrigin(),
      context: options.context && typeof options.context === "object" ? options.context : {},
      transport: "fetch",
    };
    var fields = options.fields && typeof options.fields === "object" ? options.fields : {};

    EXTRA_FIELD_NAMES.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(fields, name)) {
        request[name] = fields[name];
      }
    });

    return postWithFetch(String(options.gasUrl || "").trim(), request).catch(function (error) {
      if (!shouldUseBridgeFallback(error)) throw error;
      return postWithBridge(String(options.gasUrl || "").trim(), request);
    });
  }

  function postWithFetch(gasUrl, request) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    return window
      .fetch(gasUrl, {
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
          throw createError("BACKEND_HTTP_ERROR", "GAS 後台目前無法回應。");
        }
        return response.text();
      })
      .then(function (text) {
        var result;
        try {
          result = JSON.parse(text);
        } catch (_error) {
          throw createError(
            "BACKEND_RESPONSE_ERROR",
            "GAS 回傳的不是 JSON。請確認 Web App 已設為任何人可存取並使用 /exec 網址。"
          );
        }
        return validateResponseEnvelope(result, request.requestId);
      })
      .finally(function () {
        window.clearTimeout(timeout);
      });
  }

  function postWithBridge(gasUrl, originalRequest) {
    return new Promise(function (resolve, reject) {
      var requestSecret = createRandomHex(24);
      var frameName = "gas_bridge_" + originalRequest.requestId.replace(/[^a-zA-Z0-9]/g, "");
      var iframe = document.createElement("iframe");
      var form = document.createElement("form");
      var timeout;
      var settled = false;

      iframe.name = frameName;
      iframe.title = "安全資料同步通道";
      iframe.hidden = true;

      form.method = "POST";
      form.action = gasUrl;
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
      EXTRA_FIELD_NAMES.forEach(function (name) {
        if (Object.prototype.hasOwnProperty.call(originalRequest, name)) {
          appendHiddenField(
            form,
            name,
            name === "lotteryPrizes"
              ? JSON.stringify(originalRequest[name])
              : originalRequest[name]
          );
        }
      });

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
        if (
          message.requestId !== originalRequest.requestId ||
          message.requestSecret !== requestSecret
        ) {
          return;
        }

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
          createError(
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
      throw createError("INVALID_RESPONSE", "無法確認 GAS 回應與本次請求相符。");
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

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "req-" + createRandomHex(16);
  }

  function createRandomHex(byteLength) {
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") {
      throw createError("SECURE_RANDOM_UNAVAILABLE", "目前瀏覽器不支援安全連線所需功能。");
    }

    var bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function getCallbackOrigin() {
    return window.location.origin && window.location.origin !== "null" ? window.location.origin : "";
  }

  function isValidGasUrl(value) {
    try {
      var url = new URL(String(value || "").trim());
      return (
        url.protocol === "https:" &&
        url.hostname === "script.google.com" &&
        /\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  window.MemberApi = Object.freeze({
    loadConfig: loadConfig,
    sendRequest: sendRequest,
    isValidGasUrl: isValidGasUrl,
    createRequestId: createRequestId,
    createError: createError,
  });
})();
