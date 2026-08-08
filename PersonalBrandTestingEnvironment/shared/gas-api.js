(function () {
  "use strict";

  var CONFIG_TIMEOUT_MS = 8000;
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
    "pointCardTarget",
    "pointCardMilestones",
    "pointCardRewards",
    "pointCardExpiryMode",
    "pointCardExpiresOn",
    "lotteryTypeId",
    "cardRoundKey",
    "lotteryTypeName",
    "lotteryPrizes",
  ];

  function loadConfig(relativePath, requiredStringKeys) {
    var configUrl = new URL(relativePath, document.baseURI).toString();
    return fetchTextWithTimeout(
      configUrl,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-cache",
        credentials: "same-origin",
      },
      CONFIG_TIMEOUT_MS,
      "CONFIG_TIMEOUT",
      "讀取設定檔逾時，請確認網路連線後再試。"
    )
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

        preconnectGasUrl(config.GAS_WEB_APP_URL);
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

  function preconnectGasUrl(value) {
    if (!isValidGasUrl(value)) return;
    if (!document || typeof document.createElement !== "function") return;

    var parent = document.head || document.documentElement;
    if (!parent || typeof parent.appendChild !== "function") return;

    var origin = new URL(String(value).trim()).origin;
    var selector = 'link[rel="preconnect"][href="' + origin + '"]';
    if (
      typeof document.querySelector === "function" &&
      document.querySelector(selector)
    ) {
      return;
    }

    var link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    parent.appendChild(link);
  }

  function performanceNow() {
    return window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : Date.now();
  }

  function emitTransportMetric(startedAt, source) {
    if (
      typeof window.dispatchEvent !== "function" ||
      typeof window.CustomEvent !== "function"
    ) {
      return;
    }
    try {
      window.dispatchEvent(
        new window.CustomEvent("persona:gas-performance", {
          detail: Object.freeze({
            phase: "gas_request",
            durationMs: Math.max(
              0,
              Math.round((performanceNow() - startedAt) * 10) / 10
            ),
            source: source,
          }),
        })
      );
    } catch (_error) {
      // Diagnostics must never affect request delivery.
    }
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
    var action = String(options.action || "").trim();
    if (!/^[a-z][a-zA-Z0-9]{1,63}$/.test(action)) {
      return Promise.reject(createError("INVALID_ACTION", "請求動作格式不正確。"));
    }

    var request = {
      action: action,
      idToken: String(options.idToken || ""),
      requestId: requestId,
      callbackOrigin: getCallbackOrigin(),
      context: normalizeContext(options.context),
      transport: "fetch",
    };
    var fields = options.fields && typeof options.fields === "object" ? options.fields : {};

    EXTRA_FIELD_NAMES.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(fields, name)) {
        request[name] = fields[name];
      }
    });

    var gasUrl = String(options.gasUrl || "").trim();
    if (!isValidGasUrl(gasUrl)) {
      return Promise.reject(
        createError("INVALID_GAS_URL", "GAS Web App 網址格式不正確，請使用正式 /exec 網址。")
      );
    }

    var startedAt = performanceNow();
    var transportSource = "fetch";
    return postWithFetch(gasUrl, request).catch(function (error) {
        if (!shouldUseBridgeFallback(error)) throw error;
        transportSource = "bridge";
        return postWithBridge(gasUrl, request);
      })
      .then(
        function (result) {
          emitTransportMetric(startedAt, transportSource);
          return result;
        },
        function (error) {
          emitTransportMetric(startedAt, transportSource + "-error");
          throw error;
        }
      );
  }

  function postWithFetch(gasUrl, request) {
    return fetchTextWithTimeout(
      gasUrl,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
      },
      FETCH_TIMEOUT_MS,
      "BACKEND_TIMEOUT",
      "GAS 後台目前沒有回應。"
    ).then(function (text) {
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
    });
  }

  function fetchTextWithTimeout(url, fetchOptions, timeoutMs, timeoutCode, timeoutMessage) {
    var controller =
      typeof AbortController === "function" ? new AbortController() : null;
    var options = Object.assign({}, fetchOptions || {});
    if (controller) options.signal = controller.signal;

    var timeout = 0;
    var timeoutPromise = new Promise(function (_resolve, reject) {
      timeout = window.setTimeout(function () {
        if (controller) controller.abort();
        reject(createError(timeoutCode, timeoutMessage));
      }, timeoutMs);
    });

    var fetchPromise = window.fetch(url, options).then(function (response) {
      if (!response || !response.ok) {
        throw createError(
          fetchOptions && fetchOptions.method === "GET"
            ? "CONFIG_LOAD_ERROR"
            : "BACKEND_HTTP_ERROR",
          fetchOptions && fetchOptions.method === "GET"
            ? "無法載入設定檔。請確認 config.json 已與頁面一起發布。"
            : "GAS 後台目前無法回應。"
        );
      }
      return response.text();
    });

    return Promise.race([fetchPromise, timeoutPromise]).finally(function () {
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
            name === "lotteryPrizes" || name === "pointCardRewards"
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
            "GAS 後台目前沒有回應。請稍後重試；若持續發生，再確認 Web App 已發布為可存取。"
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

  function normalizeContext(value) {
    var source = value && typeof value === "object" ? value : {};
    var context = {};
    ["type", "viewType", "os", "language"].forEach(function (name) {
      if (source[name] !== undefined && source[name] !== null) {
        context[name] = String(source[name]).trim().slice(0, 40);
      }
    });
    if (source.inClient !== undefined) context.inClient = Boolean(source.inClient);
    return context;
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
      (error &&
        (error.name === "AbortError" ||
          error.code === "FETCH_NETWORK_ERROR" ||
          error.code === "BACKEND_TIMEOUT"))
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
