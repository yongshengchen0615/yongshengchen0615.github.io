(function () {
  "use strict";

  var PLACEHOLDER_PATTERN = /YOUR_|請填入|REPLACE/i;

  function cleanContextValue(value) {
    return String(value || "").trim().slice(0, 40);
  }

  function getContext(liff, navigatorValue) {
    var context = {};
    var browser = navigatorValue || {};

    try {
      var liffContext = liff.getContext() || {};
      context.type = cleanContextValue(liffContext.type);
      context.viewType = cleanContextValue(liffContext.viewType);
      context.os = cleanContextValue(liff.getOS());
      context.language = cleanContextValue(
        typeof liff.getAppLanguage === "function"
          ? liff.getAppLanguage()
          : browser.language
      );
      context.inClient = Boolean(liff.isInClient());
    } catch (_error) {
      context.os = cleanContextValue(browser.platform);
      context.language = cleanContextValue(browser.language);
    }

    return context;
  }

  function hasCompleteConfig(config, memberApi) {
    var value = config && typeof config === "object" ? config : {};
    var liffId = String(value.LIFF_ID || "").trim();
    var gasUrl = String(value.GAS_WEB_APP_URL || "").trim();

    if (!liffId || PLACEHOLDER_PATTERN.test(liffId)) return false;
    if (!gasUrl || PLACEHOLDER_PATTERN.test(gasUrl)) return false;
    return Boolean(
      memberApi &&
        typeof memberApi.isValidGasUrl === "function" &&
        memberApi.isValidGasUrl(gasUrl)
    );
  }

  function hasDemoQuery(search) {
    return new URLSearchParams(String(search || "")).get("demo") === "1";
  }

  window.LiffRuntime = Object.freeze({
    getContext: getContext,
    hasCompleteConfig: hasCompleteConfig,
    hasDemoQuery: hasDemoQuery,
  });
})();
