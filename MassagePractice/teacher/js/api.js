(function () {
  "use strict";

  const CONFIG_PATH = "config.json";
  const PLACEHOLDER_RE = /^YOUR_/;
  let config = null;
  let configPromise = null;

  function getConfig() {
    return config || window.APP_CONFIG || {};
  }

  async function loadConfig() {
    if (config) return config;
    if (configPromise) return configPromise;

    configPromise = fetch(CONFIG_PATH, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        const loaded = await response.json();
        if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
          throw new Error("config.json 格式必須是 JSON 物件。");
        }

        config = loaded;
        window.APP_CONFIG = loaded;
        return config;
      })
      .catch((error) => {
        configPromise = null;
        throw new Error("讀取 config.json 失敗：" + error.message);
      });

    return configPromise;
  }

  function isConfigured(value) {
    return typeof value === "string" && value.trim() && !PLACEHOLDER_RE.test(value.trim());
  }

  function requireConfig(options) {
    options = options || {};
    const config = getConfig();
    const missing = [];

    if (!isConfigured(config.gasWebAppUrl)) missing.push("gasWebAppUrl");
    if (options.line && !isConfigured(config.lineChannelId)) missing.push("lineChannelId");

    if (missing.length) {
      throw new Error("尚未設定 config.json: " + missing.join(", "));
    }

    return config;
  }

  function studentRedirectUri() {
    const config = getConfig();
    if (isConfigured(config.studentRedirectUri)) return config.studentRedirectUri.trim();
    return window.location.origin + window.location.pathname;
  }

  function teacherRedirectUri() {
    const config = getConfig();
    if (isConfigured(config.teacherRedirectUri)) return config.teacherRedirectUri.trim();
    return window.location.origin + window.location.pathname;
  }

  function cleanOauthParams() {
    const url = new URL(window.location.href);
    [
      "code",
      "state",
      "error",
      "error_description",
      "friendship_status_changed",
      "liffClientId",
      "liffRedirectUri"
    ].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  async function post(action, payload) {
    const config = requireConfig();
    const response = await fetch(config.gasWebAppUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        action,
        payload: payload || {}
      }),
      redirect: "follow"
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error("GAS 回傳不是 JSON，請確認 Web App 部署與權限。");
    }

    if (!data.ok) {
      throw new Error(data.error || "GAS 請求失敗");
    }

    return data.data;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function avatarPlaceholder() {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
      '<rect width="120" height="120" rx="60" fill="#eef2ed"/>' +
      '<circle cx="60" cy="45" r="20" fill="#b7c4bb"/>' +
      '<path d="M25 105c5-25 22-38 35-38s30 13 35 38" fill="#b7c4bb"/>' +
      "</svg>";

    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  window.AppApi = {
    avatarPlaceholder,
    cleanOauthParams,
    escapeHtml,
    formatDate,
    getConfig,
    loadConfig,
    post,
    requireConfig,
    studentRedirectUri,
    teacherRedirectUri
  };
})();
