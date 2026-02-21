/**
 * app.js（入口檔 / Entry）
 *
 * 拆檔後：
 * - 這個檔案只負責「初始化流程」與「事件綁定」
 * - 業務邏輯分散在 js/modules/*.js
 */

import { debounce, installConsoleFilter, preconnectUrl } from "./modules/core.js";
import { loadConfigJson, sanitizeEdgeUrls } from "./modules/config.js";
import { config } from "./modules/config.js";
import { dom } from "./modules/dom.js";
import { state } from "./modules/state.js";
import { showGate, showInitialLoading, hideInitialLoading, setInitialLoadingProgress, holdLoadingHint } from "./modules/uiHelpers.js";
import { initTheme } from "./modules/theme.js";
import { initLiffAndGuard, initNoLiffAndGuard } from "./modules/auth.js";
import { setActivePanel, renderIncremental } from "./modules/table.js";
import { updateMyMasterStatusUI } from "./modules/myMasterStatus.js";
import { startPolling } from "./modules/polling.js";
import { logAppOpen, logUsageEvent } from "./modules/usageLog.js";
import { initPerformanceUi, prefetchPerformanceOnce, manualRefreshPerformance } from "./modules/performance.js";
import { initBookingUi, prefetchBookingOnce } from "./modules/bookingQuery.js";
import { initViewSwitch, setViewMode, VIEW } from "./modules/viewSwitch.js";
import { isTopupEnabled, runTopupFlow } from "./modules/topup.js";
import { fetchStatusAll } from "./modules/edgeClient.js";

let eventsBound = false;

try {
  // Perf timeline: app start
  performance && performance.mark && performance.mark("app:boot_start");
} catch (_) {}

function bindEventsOnce() {
  if (eventsBound) return;
  eventsBound = true;

  const rerenderDebounced = debounce(() => {
    renderIncremental(state.activePanel);
    updateMyMasterStatusUI();
  }, 120);

  // Tabs
  if (dom.tabBodyBtn) {
    dom.tabBodyBtn.addEventListener("click", () => {
      const from = state.activePanel || "";
      logUsageEvent({ event: "panel_switch", detail: `${from}->body`, noThrottle: true, eventCn: "分頁切換" });
      setActivePanel("body");
    });
  }
  if (dom.tabFootBtn) {
    dom.tabFootBtn.addEventListener("click", () => {
      const from = state.activePanel || "";
      logUsageEvent({ event: "panel_switch", detail: `${from}->foot`, noThrottle: true, eventCn: "分頁切換" });
      setActivePanel("foot");
    });
  }

  // Filters
  if (dom.filterMasterInput) {
    dom.filterMasterInput.addEventListener("change", (e) => {
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

  // TopUp
  if (dom.btnTopupEl) {
    dom.btnTopupEl.addEventListener("click", async () => {
      await runTopupFlow({ context: "app", reloadOnSuccess: false });
    });
  }

  // Performance manual refresh (prominent button in perf card)
  if (dom.perfRefreshBtn) {
    dom.perfRefreshBtn.addEventListener("click", async () => {
      try {
        await manualRefreshPerformance({ showToast: true });
        try {
          const from = (dom.perfDateStartInput && dom.perfDateStartInput.value) || "";
          const to = (dom.perfDateEndInput && dom.perfDateEndInput.value) || "";
          logUsageEvent({ event: "perf_manual_refresh", detail: `${from}->${to}`, noThrottle: true, eventCn: "業績手動重整" });
        } catch {}
      } catch (e) {
        // ignore - performance module shows error badge
      }
    });
  }

  // Auto-refresh when perf date inputs change (debounced)
  const perfDateAutoRefresh = debounce(async () => {
    const release = holdLoadingHint("同步資料中…");
    try {
      await manualRefreshPerformance({ showToast: false });
      try {
        const from = (dom.perfDateStartInput && dom.perfDateStartInput.value) || "";
        const to = (dom.perfDateEndInput && dom.perfDateEndInput.value) || "";
        logUsageEvent({ event: "perf_auto_refresh", detail: `${from}->${to}`, noThrottle: true, eventCn: "業績自動重整" });
      } catch {}
    } catch (e) {
      // ignore - performance module will show errors if needed
    } finally {
      try {
        release();
      } catch (_) {}
    }
  }, 700);

  if (dom.perfDateStartInput) dom.perfDateStartInput.addEventListener("change", perfDateAutoRefresh);
  if (dom.perfDateEndInput) dom.perfDateEndInput.addEventListener("change", perfDateAutoRefresh);
}

async function boot() {
  installConsoleFilter();
  initTheme();

  try {
    performance && performance.mark && performance.mark("app:boot_begin");
  } catch (_) {}

  showInitialLoading("資料載入中…");
  setInitialLoadingProgress(5, "啟動中…");

  try {
    setInitialLoadingProgress(12, "讀取設定中…");
    await loadConfigJson();
    sanitizeEdgeUrls();

    try {
      performance && performance.mark && performance.mark("app:config_ready");
    } catch (_) {}

    // 預熱網路連線：AUTH / TOPUP / USAGE_LOG 常是同一個 GAS 網域，先 preconnect 可降低首次儲值/驗證延遲。
    preconnectUrl(config.AUTH_API_URL);
    preconnectUrl(config.TOPUP_API_URL);
    preconnectUrl(config.USAGE_LOG_URL);

    // ✅ 不阻塞：先暖機一次狀態請求（AUTH 進行的同時就能開始走 DNS/TLS/edge failover）
    // - 不會更新 UI；edgeClient 內部會寫入快取供 startPolling 快速顯示。
    try {
      fetchStatusAll().catch(() => {});
    } catch (_) {}
  } catch (e) {
    console.error("[Config] load failed:", e);
    hideInitialLoading();
    showGate("⚠ 無法載入 config.json，請確認檔案存在且可被存取。", true);
    return;
  }

  setInitialLoadingProgress(28, "初始化介面中…");

  bindEventsOnce();

  // 儲值入口（是否顯示取決於 config.TOPUP_API_URL）
  if (dom.btnTopupEl) dom.btnTopupEl.style.display = isTopupEnabled() ? "" : "none";

  // Auth / Gate
  setInitialLoadingProgress(45, "登入 / 權限檢查中…");
  const authRes = config.ENABLE_LINE_LOGIN ? await initLiffAndGuard() : await initNoLiffAndGuard();
  if (!authRes || !authRes.ok) {
    // 權限未通過（例如：待審核）時，auth 模組會顯示 Gate。
    // 這裡要關掉 initial loading，避免畫面看起來卡在「登入/權限檢查中」。
    hideInitialLoading();
    return;
  }

  try {
    performance && performance.mark && performance.mark("app:auth_ok");
  } catch (_) {}

  setInitialLoadingProgress(62, "準備功能模組中…");

  // 業績 UI（同頁面顯示）
  initPerformanceUi();

  // 預約查詢 UI（同頁面顯示）
  initBookingUi();

  // 同頁面三視圖切換
  initViewSwitch();

  // （可選）使用頻率紀錄：只在授權通過後送出
  logAppOpen({ userId: authRes.userId, displayName: authRes.displayName });

  // 排班表已開通：預設顯示身體面板
  if (state.scheduleUiEnabled) setActivePanel("body");

  // 初始視圖
  setViewMode(VIEW.MY_STATUS);

  // ✅ 登入後：若「業績」開通，預載一次（不需要點擊按鈕）
  let perfReady = null;
  if (String(state.feature && state.feature.performanceEnabled) === "是") {
    setInitialLoadingProgress(72, "載入業績資料中…");
    perfReady = prefetchPerformanceOnce();
  }
  // ✅ 登入後：若「預約查詢」開通，預載一次（不需要點擊按鈕）
  let bookingReady = null;
  if (String(state.feature && state.feature.bookingEnabled) === "是") {
    setInitialLoadingProgress(74, "載入預約資料中…");
    bookingReady = prefetchBookingOnce();
  }

  // 開始輪詢（排班表未開通也要輪詢：只更新我的狀態/提示）
  setInitialLoadingProgress(78, "載入排班資料中…");
  // 需求：切到業績面板時要「馬上可看」→ 初始載入期間把業績預載做完，再進主畫面。
  // combine optional prefetch promises so startPolling can wait a short time for them
  let extraReady = null;
  const _ps = [];
  if (perfReady) _ps.push(perfReady);
  if (bookingReady) _ps.push(bookingReady);
  if (_ps.length === 1) extraReady = _ps[0];
  else if (_ps.length > 1) extraReady = Promise.all(_ps);

  startPolling(extraReady);
  // 避免未處理的 promise 被某些環境視為 error
  if (extraReady && typeof extraReady.then === "function") extraReady.catch(() => {});
}

// Module scripts are deferred by default; DOM is ready when this runs.
boot().catch((e) => {
  console.error("[Boot] failed:", e);
  hideInitialLoading();
  showGate("⚠ 初始化失敗，請稍後再試。", true);
});
