import { installConsoleFilter, debounce } from "./modules/core.js";
import { loadConfigJson, sanitizeEdgeUrls } from "./modules/config.js";
import { config } from "./modules/config.js";
import { dom } from "./modules/dom.js";
import { state } from "./modules/state.js";
import { showGate, showInitialLoading, hideInitialLoading, setInitialLoadingProgress } from "./modules/uiHelpers.js";
import { initTheme } from "./modules/theme.js";
import { setActivePanel } from "./modules/table.js";
import { startPolling } from "./modules/polling.js";
import { logAppOpen } from "./modules/usageLog.js";
import { initViewSwitch, setViewMode, VIEW } from "./modules/viewSwitch.js";

let eventsBound = false;

function bindEventsOnce() {
  if (eventsBound) return;
  eventsBound = true;

  const rerenderDebounced = debounce(() => {
    // trigger table re-evaluation for current active panel (applies filters)
    try { setActivePanel(state.activePanel); } catch (e) { console.error("rerenderDebounced error", e); }
  }, 150);

  if (dom.tabBodyBtn) {
    dom.tabBodyBtn.addEventListener("click", () => {
      setActivePanel("body");
    });
  }
  if (dom.tabFootBtn) {
    dom.tabFootBtn.addEventListener("click", () => {
      setActivePanel("foot");
    });
  }

  if (dom.filterMasterInput) {
    dom.filterMasterInput.addEventListener("input", (e) => {
      state.filterMaster = e.target.value || "";
      rerenderDebounced();
    });
  }
  if (dom.filterStatusSelect) {
    dom.filterStatusSelect.addEventListener("change", (e) => {
      state.filterStatus = e.target.value || "all";
      rerenderDebounced();
    });
  }
}

async function boot() {
  installConsoleFilter();
  initTheme();

  showInitialLoading("資料載入中…");
  setInitialLoadingProgress(5, "啟動中…");

  try {
    setInitialLoadingProgress(12, "讀取設定中…");
    await loadConfigJson();
    sanitizeEdgeUrls();
  } catch (e) {
    console.error("[Config] load failed:", e);
    hideInitialLoading();
    showGate("⚠ 無法載入 config.json，請確認檔案存在且可被存取。", true);
    return;
  }

  setInitialLoadingProgress(28, "初始化介面中…");

  bindEventsOnce();

  setInitialLoadingProgress(45, "初始化完成（跳過登入認證）…");

  // skip auth entirely; directly proceed
  const authRes = { ok: true, userId: "ADMIN_SCHEDULE", displayName: "Admin Schedule" };
  if (!authRes || !authRes.ok) {
    hideInitialLoading();
    return;
  }

  setInitialLoadingProgress(62, "準備功能模組中…");

  initViewSwitch();

  if (state.scheduleUiEnabled) setActivePanel("body");
  setViewMode(VIEW.SCHEDULE);

  try {
    logAppOpen({ userId: authRes.userId, displayName: authRes.displayName });
  } catch {}

  setInitialLoadingProgress(78, "載入排班資料中…");
  startPolling();
}

window.addEventListener("load", () => {
  boot().catch((e) => {
    console.error("[Boot] failed:", e);
    hideInitialLoading();
    showGate("⚠ 初始化失敗，請稍後再試。", true);
  });
});
