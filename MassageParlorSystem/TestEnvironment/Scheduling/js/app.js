/**
 * app.js（入口檔 / Entry）
 *
 * 拆檔後：
 * - 這個檔案只負責「初始化流程」與「事件綁定」
 * - 業務邏輯分散在 js/modules/*.js
 */

import { debounce, installConsoleFilter } from "./modules/core.js";
import { loadConfigJson, sanitizeEdgeUrls } from "./modules/config.js";
import { config } from "./modules/config.js";
import { dom } from "./modules/dom.js";
import { state } from "./modules/state.js";
import { showGate, showInitialLoading, setInitialLoadingProgress } from "./modules/uiHelpers.js";
import { initTheme } from "./modules/theme.js";
import { initLiffAndGuard, initNoLiffAndGuard } from "./modules/auth.js";
import { setActivePanel, renderIncremental } from "./modules/table.js";
import { updateMyMasterStatusUI } from "./modules/myMasterStatus.js";
import { startPolling } from "./modules/polling.js";
import { logAppOpen } from "./modules/usageLog.js";

let eventsBound = false;

function bindEventsOnce() {
  if (eventsBound) return;
  eventsBound = true;

  const rerenderDebounced = debounce(() => {
    renderIncremental(state.activePanel);
    updateMyMasterStatusUI();
  }, 120);

  // Tabs
  if (dom.tabBodyBtn) dom.tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
  if (dom.tabFootBtn) dom.tabFootBtn.addEventListener("click", () => setActivePanel("foot"));

  // Filters
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
    showGate("⚠ 無法載入 config.json，請確認檔案存在且可被存取。", true);
    return;
  }

  setInitialLoadingProgress(28, "初始化介面中…");

  bindEventsOnce();

  // Auth / Gate
  setInitialLoadingProgress(45, "登入 / 權限檢查中…");
  const authRes = config.ENABLE_LINE_LOGIN ? await initLiffAndGuard() : await initNoLiffAndGuard();
  if (!authRes || !authRes.ok) return;

  setInitialLoadingProgress(62, "準備功能模組中…");

  // （可選）使用頻率紀錄：只在授權通過後送出
  logAppOpen({ userId: authRes.userId, displayName: authRes.displayName });

  // 排班表已開通：預設顯示身體面板
  if (state.scheduleUiEnabled) setActivePanel("body");

  // 開始輪詢（排班表未開通也要輪詢：只更新我的狀態/提示）
  setInitialLoadingProgress(78, "載入排班資料中…");
  startPolling();
}

window.addEventListener("load", () => {
  boot().catch((e) => {
    console.error("[Boot] failed:", e);
    showGate("⚠ 初始化失敗，請稍後再試。", true);
  });
});
