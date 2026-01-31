/* ================================
 * Admin 審核管理台（前端單頁）
 *
 * 目的：
 * - 透過 LIFF 取得登入者 userId / displayName
 * - 呼叫 AUTH_API_URL：將登入者寫入/更新為管理員資料，並判斷是否可進入後台
 * - 呼叫 ADMIN_API_URL：載入管理員清單、批次更新、刪除
 * - 提供搜尋/篩選/勾選/批次套用/批次刪除/一次儲存全部變更
 *
 * 注意：
 * - 本檔不引入框架，純原生 DOM 操作。
 * - UI/UX 以 admin.html + admin.css 為準；本次重構不改變畫面與互動行為。
 * - 「技師欄位」使用 是/否 toggle 按鈕，避免 <select> 在 sticky table 內被裁切。
 * ================================ */

/* ================================
 * Admin 審核管理台 - 入口檔
 *
 * 你目前看到的 admin.js 已被「拆分」成多個檔案（constants/state/utils/data/api/ui/features）。
 * 這個檔案只負責：
 * - DOMContentLoaded 初始化流程
 * - 串接前面檔案提供的函式
 *
 * 重要：
 * - admin.html 必須先載入其他檔案，再載入本檔。
 * ================================ */

// ================================
// Initial Loading Overlay
// - admin.html 已有 #initialLoading；admin.css 已有 .initial-loading 樣式
// - 這裡負責在首批資料載入完成前顯示遮罩
// ================================
const initialLoadingEl = document.getElementById("initialLoading");
const initialLoadingTextEl = document.getElementById("initialLoadingText");
const initialLoadingBarEl = document.getElementById("initialLoadingBar");
const initialLoadingPercentEl = document.getElementById("initialLoadingPercent");
const initialLoadingProgressEl = initialLoadingEl?.querySelector?.(".initial-loading-progress") || null;
const appRootEl = document.querySelector(".app");

function hideApp_() {
  appRootEl?.classList.add("app-hidden");
}

function showApp_() {
  appRootEl?.classList.remove("app-hidden");
}

function showInitialLoading_(text) {
  if (!initialLoadingEl) return;
  if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
  // ensure overlay is visible (clear any display:none set by fallback hide)
  try {
    initialLoadingEl.style.display = "";
  } catch (_) {}
  initialLoadingEl.classList.remove("initial-loading-hidden");
  // 不在此隱藏主畫面；保持主畫面可見並讓遮罩蓋住它，避免在切換遮罩時出現空白畫面。

  // 避免「先顯示 0%」：一顯示遮罩就先推進度
  setInitialLoadingProgress_(Math.max(1, Number(initialLoadingProgressEl?.getAttribute?.("aria-valuenow")) || 1));
}

function hideInitialLoading_(text) {
  if (!initialLoadingEl) return;
  if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
  initialLoadingEl.classList.add("initial-loading-hidden");

  // handle CSS transition/animation: remove from flow after transition ends,
  // otherwise fallback to next rAF+timeout to set display:none so user isn't left with invisible overlay
  try {
    const el = initialLoadingEl;
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    const durStr = (cs && (cs.transitionDuration || cs.animationDuration)) || "0s";
    let maxMs = 0;
    durStr.split(",").forEach((s) => {
      const t = String(s || "").trim();
      if (!t) return;
      if (t.endsWith("ms")) maxMs = Math.max(maxMs, Number(t.replace(/ms$/, "")));
      else if (t.endsWith("s")) maxMs = Math.max(maxMs, Number(t.replace(/s$/, "")) * 1000);
    });

    const cleanup = () => {
      try {
        el.style.display = "none";
      } catch (_) {}
      try {
        el.removeEventListener("transitionend", onEnd);
        el.removeEventListener("animationend", onEnd);
      } catch (_) {}
    };

    const onEnd = (ev) => {
      cleanup();
    };

    if (maxMs > 20) {
      el.addEventListener("transitionend", onEnd);
      el.addEventListener("animationend", onEnd);
      // safety fallback in case transitionend/animationend not fired
      setTimeout(() => {
        try {
          cleanup();
        } catch (_) {}
      }, maxMs + 60);
    } else {
      // no transition: hide immediately on next frame
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => setTimeout(() => (el.style.display = "none"), 32));
      } else {
        setTimeout(() => (el.style.display = "none"), 32);
      }
    }
  } catch (e) {
    try {
      initialLoadingEl.style.display = "none";
    } catch (_) {}
  }
}

function setInitialLoadingProgress_(percent, text) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
  if (initialLoadingBarEl) initialLoadingBarEl.style.width = `${p}%`;
  if (initialLoadingPercentEl) initialLoadingPercentEl.textContent = `${Math.round(p)}%`;
  if (initialLoadingProgressEl) initialLoadingProgressEl.setAttribute("aria-valuenow", String(Math.round(p)));
}

// 隱藏排班面板內的 loading / empty / error 提示，避免只剩背景畫面
function hideScheduleStates_() {
  try {
    const scheduleSection = document.getElementById("schedulePanelSection");
    // hide any .initial-loading inside schedule panel (there's a duplicated id there)
    if (scheduleSection) {
      scheduleSection.querySelectorAll(".initial-loading").forEach((el) => el.classList.add("initial-loading-hidden"));
      const top = scheduleSection.querySelector("#topLoading");
      if (top) top.classList.add("hidden");
      const empty = scheduleSection.querySelector("#emptyState");
      if (empty) empty.style.display = "none";
      const loading = scheduleSection.querySelector("#loadingState");
      if (loading) loading.style.display = "none";
      const error = scheduleSection.querySelector("#errorState");
      if (error) error.style.display = "none";
      const gate = scheduleSection.querySelector("#gate");
      if (gate) gate.classList.add("gate-hidden");
    }

    // also hide any global-top ones (fallback)
    const globalTop = document.getElementById("topLoading");
    if (globalTop) globalTop.classList.add("hidden");
    const globalEmpty = document.getElementById("emptyState");
    if (globalEmpty) globalEmpty.style.display = "none";
    const globalLoading = document.getElementById("loadingState");
    if (globalLoading) globalLoading.style.display = "none";
    const globalError = document.getElementById("errorState");
    if (globalError) globalError.style.display = "none";
  } catch (e) {
    console.warn("hideScheduleStates_ failed", e);
  }
}

// defer 腳本會在 DOM 解析後、DOMContentLoaded 前執行。
// admin.html 的 loading 預設可見，因此這裡先把 0% 推進到初始值，避免看到 0%。
setInitialLoadingProgress_(1);

document.addEventListener("DOMContentLoaded", async () => {
  // 先顯示初始載入遮罩，避免白畫面/閃爍
  showInitialLoading_();
  setInitialLoadingProgress_(5);
  // 使主畫面在遮罩下可見，避免遮罩關閉時出現短暫空白
  try { showApp_(); } catch (_) {}

  try {
    const withTimeout_ = (promise, ms, label) => {
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 逾時（${ms / 1000}s）`)), ms);
      });
      return Promise.race([promise, timeout]).finally(() => timer && clearTimeout(timer));
    };

    // collection of view buttons (disabled until initial data loaded)
    const __viewButtons = [];

    const initListViewToggle_ = () => {
      const btnAdmins = document.getElementById("viewAdminsBtn");
        const btnLogs = document.getElementById("viewAdminLogsBtn");
        const btnUsers = document.getElementById("viewUsersBtn");
        const btnTechUsageLogs = document.getElementById("viewTechUsageLogsBtn");
        const btnSchedule = document.getElementById("viewScheduleBtn");

      const summaryText = document.getElementById("summaryText");
      const reloadBtn = document.getElementById("reloadBtn");
      const saveAllBtn = document.getElementById("saveAllBtn");

      const adminsKpi = document.getElementById("adminsKpiSection");
      const adminsPanel = document.getElementById("adminsPanelSection");
      const logsPanel = document.getElementById("adminLogsPanelSection");
      const usersKpi = document.getElementById("usersKpiSection");
      const usersPanel = document.getElementById("usersPanelSection");
      const techUsageLogsPanel = document.getElementById("techUsageLogsPanelSection");
      const techUsageChartPanel = document.getElementById("techUsageChartSection");
      const schedulePanel = document.getElementById("schedulePanelSection");

      if (!btnAdmins || !btnUsers || !btnLogs || !btnTechUsageLogs) return;

      // disable view buttons until initial data is fully loaded
      [btnAdmins, btnLogs, btnUsers, btnTechUsageLogs, btnSchedule].forEach((b) => {
        if (!b) return;
        b.disabled = true;
        b.classList.add("btn--disabled");
        __viewButtons.push(b);
      });

      const setView_ = (view) => {
        const isAdmins = view === "admins";
        const isLogs = view === "logs";
        const isUsers = view === "users";
        const isTechUsageLogs = view === "techUsageLogs";
        const isSchedule = view === "schedule";

        if (adminsKpi) adminsKpi.hidden = !isAdmins;
        if (adminsPanel) adminsPanel.hidden = !isAdmins;
        if (logsPanel) logsPanel.hidden = !isLogs;
        if (usersKpi) usersKpi.hidden = !isUsers;
        if (usersPanel) usersPanel.hidden = !isUsers;
        if (techUsageLogsPanel) techUsageLogsPanel.hidden = !isTechUsageLogs;
        if (schedulePanel) schedulePanel.hidden = !isSchedule;
        if (techUsageChartPanel) {
          techUsageChartPanel.hidden = !isTechUsageLogs;
          techUsageChartPanel.style.display = isTechUsageLogs ? "" : "none";
        }

        // 額外隱藏「不屬於該切面」的頂部 UI，避免混淆
        if (summaryText) summaryText.hidden = !isAdmins;
        if (reloadBtn) reloadBtn.hidden = !isAdmins;
        if (saveAllBtn) saveAllBtn.hidden = !isAdmins;

        btnAdmins.classList.toggle("primary", isAdmins);
        btnAdmins.classList.toggle("ghost", !isAdmins);
        btnAdmins.setAttribute("aria-pressed", isAdmins ? "true" : "false");

        btnLogs.classList.toggle("primary", isLogs);
        btnLogs.classList.toggle("ghost", !isLogs);
        btnLogs.setAttribute("aria-pressed", isLogs ? "true" : "false");

        btnUsers.classList.toggle("primary", isUsers);
        btnUsers.classList.toggle("ghost", !isUsers);
        btnUsers.setAttribute("aria-pressed", isUsers ? "true" : "false");

        btnTechUsageLogs.classList.toggle("primary", isTechUsageLogs);
        btnTechUsageLogs.classList.toggle("ghost", !isTechUsageLogs);
        btnTechUsageLogs.setAttribute("aria-pressed", isTechUsageLogs ? "true" : "false");

        if (btnSchedule) {
          btnSchedule.classList.toggle("primary", isSchedule);
          btnSchedule.classList.toggle("ghost", !isSchedule);
          btnSchedule.setAttribute("aria-pressed", isSchedule ? "true" : "false");
        }
      };

      // 預設顯示管理員切面（符合「切換」的直覺：一次只看一個名單）
      setView_("admins");

      btnAdmins.addEventListener("click", () => setView_("admins"));
      btnLogs.addEventListener("click", () => setView_("logs"));
      btnUsers.addEventListener("click", () => setView_("users"));
      btnTechUsageLogs.addEventListener("click", () => setView_("techUsageLogs"));
      if (btnSchedule) btnSchedule.addEventListener("click", () => setView_("schedule"));
    };

    // expose small helper to enable view buttons after initial data load
    const enableViewButtons_ = () => {
      __viewButtons.forEach((b) => {
        if (!b) return;
        b.disabled = false;
        b.classList.remove("btn--disabled");
      });
    };

    // Users/技師資料管理（獨立區塊）：先初始化 UI，避免後續流程失敗時卡住
    if (typeof initUsersPanel_ === "function") initUsersPanel_();

    setInitialLoadingProgress_(10, "讀取設定中…");
    const cfg = await loadConfig_();
    setInitialLoadingProgress_(18, "初始化介面中…");
    initTheme_();

    // 上方切換「管理員名單 / 技師名單」
    initListViewToggle_();

    // 管理員紀錄
    if (typeof bindAdminLogs_ === "function") bindAdminLogs_();

    // 技師使用紀錄
    if (typeof bindTechUsageLogs_ === "function") bindTechUsageLogs_();

    // 事件綁定（僅做一次）
    bindTopbar_();
    bindSearch_();
    bindChips_();
    bindBulk_();
    bindTableDelegation_();

    // 先通過 LIFF + AUTH Gate（可由 config.json 的 USE_LIFF 控制）才載入資料
    setInitialLoadingProgress_(28, "管理員驗證中…");
    if (typeof uSetFooter_ === "function") uSetFooter_("管理員驗證中...");
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_("管理員驗證中...");

    if (typeof USE_LIFF === "undefined" || USE_LIFF) {
      await withTimeout_(liffGate_(), 15000, "LIFF/管理員驗證");
      setInitialLoadingProgress_(40, "驗證通過，準備載入資料…");
    } else {
      // 跳過 LIFF（測試模式）
      setInitialLoadingProgress_(40, "跳過 LIFF（測試模式）");
      setAuthText_("跳過 LIFF（測試模式）");
      me.userId = String(cfg.DEBUG_USER_ID || "LOCAL_TEST").trim();
      me.displayName = String(cfg.DEBUG_DISPLAY_NAME || "Local Tester").trim();
      me.audit = String(cfg.DEBUG_USER_AUDIT || "通過").trim();
      setAuthText_(`${me.displayName}（${me.audit}）`);
    }

    // ✅ 驗證通過後記一筆（不阻擋）
    if (typeof appendAdminUsageLog_ === "function") appendAdminUsageLog_();

    // ✅ 驗證通過後，直接並行啟動所有模組，再以事件驅動等待每個模組完成 render
    if (typeof uSetFooter_ === "function") uSetFooter_("載入 Users 資料中...");
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_("載入 Users 資料中...");

    setInitialLoadingProgress_(50, "載入資料中…");

    // 使用純事件驅動：先註冊監聽，再啟動模組；當收到所有預期的 render 事件後才結束 loading
    const expected = ["admins", "adminLogs", "users", "techUsageLogs", "schedule"];
    const expectedSet = new Set(expected);
    let done = 0;

    const masterPromise = new Promise((resolve) => {
      const onEvent = (ev) => {
        try {
          const name = String(ev?.detail || "");
          if (!name) return;
          if (expectedSet.has(name)) {
            // remove to avoid double-counting
            expectedSet.delete(name);
            done += 1;
            const p = 50 + (done / expected.length) * 45;
            setInitialLoadingProgress_(p, `載入資料中…（${done}/${expected.length}）`);
            if (expectedSet.size === 0) {
              window.removeEventListener("admin:rendered", onEvent);
              return resolve({ ok: true });
            }
          }
        } catch (e) {}
      };

      window.addEventListener("admin:rendered", onEvent);

      // also listen to schedule boot promise in case it resolves without dispatch (safety)
      if (window.__scheduleBootPromise && typeof window.__scheduleBootPromise.then === "function") {
        Promise.resolve(window.__scheduleBootPromise).then(() => {
          // dispatch synthetic event if schedule hasn't been received yet
          try {
            window.dispatchEvent(new CustomEvent('admin:rendered', { detail: 'schedule' }));
          } catch (e) {}
        });
      }

      // start modules after listener is attached
      try {
        if (typeof loadAdmins_ === "function") loadAdmins_().catch((e) => console.warn("loadAdmins_ failed", e));
        if (typeof bootUsersPanel_ === "function") bootUsersPanel_().catch((e) => console.warn("bootUsersPanel_ failed", e));
        if (typeof loadAdminLogs_ === "function") loadAdminLogs_().catch((e) => console.warn("loadAdminLogs_ failed", e));
        if (typeof loadTechUsageLogs_ === "function") loadTechUsageLogs_().catch((e) => console.warn("loadTechUsageLogs_ failed", e));
      } catch (e) {
        console.warn("start modules failed", e);
      }
    });

    const results = await masterPromise;
    const allSucceeded = !!results.ok;
    setInitialLoadingProgress_(100, allSucceeded ? "完成" : "載入失敗");

    if (allSucceeded) {
      // ensure schedule-specific loading states are cleared
      hideScheduleStates_();
      // 只有全部成功才啟用切換並顯示主畫面
      try {
        if (typeof enableViewButtons_ === "function") enableViewButtons_();
      } catch (e) {
        console.warn("enableViewButtons_ failed", e);
      }

      showApp_();
      hideInitialLoading_();
    } else {
      // 若有任務失敗：隱藏 initial loading，顯示 blocker（含錯誤訊息），避免只顯示背景
      try {
        // 顯示主畫面以便 blocker overlay 可見在上方
        // clear schedule states first
        hideScheduleStates_();
        showApp_();
        hideInitialLoading_();

        if (typeof showBlocker_ === "function") {
          showBlocker_(`部分資料載入失敗：${reasonText || "請查看 console"}`);
        } else {
          // fallback: 顯示 toast 並保持主畫面
          toast(`部分資料載入失敗：${reasonText || "請查看 console"}`, "err");
        }
      } catch (e) {
        console.warn("showBlocker_ failed", e);
        // fallback ensure loading is hidden so user isn't left with blank overlay
        hideInitialLoading_();
        showApp_();
      }
    }
  } catch (e) {
    const code = String(e?.code || "");
    const message = String(e?.message || e);

    // ✅ 權限未通過：showBlocker_ 已顯示，不視為「初始化失敗」
    if (code === "ADMIN_NOT_ALLOWED" || message === "ADMIN_NOT_ALLOWED") {
      console.warn("[AuthGate] admin not allowed");
      const msg = "尚未通過審核（請由總管理員改為『通過』）";
      if (typeof uSetFooter_ === "function") uSetFooter_(msg);
      if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_(msg);
      return;
    }

    // ✅ LIFF 導頁登入：不顯示錯誤 toast
    if (code === "LIFF_LOGIN_REDIRECT" || message === "LIFF_LOGIN_REDIRECT") {
      console.info("[AuthGate] redirecting to LIFF login");
      const msg = "導向登入中...";
      if (typeof uSetFooter_ === "function") uSetFooter_(msg);
      if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_(msg);
      return;
    }

    console.error(e);
    toast("初始化失敗（請檢查 config.json / LIFF / GAS）", "err");

    const msg = `初始化失敗：${message}`;
    if (typeof uSetFooter_ === "function") uSetFooter_(msg);
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_(msg);
  } finally {
    // 不論成功或失敗，都要把遮罩收起來（避免卡住頁面）
    // 先印出 overlay 狀態以便除錯（可在瀏覽器 console 檢查）
    try {
      try {
        const il = document.getElementById("initialLoading");
        const appEl = document.querySelector(".app");
        const blocker = document.getElementById("blocker");
        const scheduleGate = document.getElementById("gate");
        console.debug("[overlay-debug] initialLoading:", !!il, "aria-valuenow=", il?.querySelector?.(".initial-loading-progress")?.getAttribute("aria-valuenow"));
        console.debug("[overlay-debug] app has .app-hidden:", !!appEl && appEl.classList.contains("app-hidden"));
        console.debug("[overlay-debug] blocker present & hidden:", !!blocker, blocker ? blocker.hidden : undefined);
        console.debug("[overlay-debug] schedule gate present & gate-hidden:", !!scheduleGate, scheduleGate ? scheduleGate.classList.contains("gate-hidden") : undefined);
      } catch (e) {
        console.debug("[overlay-debug] inspect failed", e);
      }

      // 在關閉遮罩前短暫等待一個 frame + 小延遲，確保 DOM/圖表有機會 repaint
      await new Promise((res) => {
        if (typeof requestAnimationFrame !== "undefined") return requestAnimationFrame(() => setTimeout(res, 40));
        return setTimeout(res, 40);
      });
    } catch (_) {}

    // 關閉前再次印一次狀態
    try {
      const il2 = document.getElementById("initialLoading");
      const appEl2 = document.querySelector(".app");
      const blocker2 = document.getElementById("blocker");
      console.debug("[overlay-debug-after] initialLoading present:", !!il2, "app-hidden:", !!appEl2 && appEl2.classList.contains("app-hidden"), "blocker.hidden:", blocker2 ? blocker2.hidden : undefined);
    } catch (_) {}

    // 注意：不要在此處無條件顯示主畫面或關閉遮罩，
    // 初始載入應以事件驅動完成為準（見上方的 allSucceeded 處理）。
    console.debug("[overlay-debug] final: leaving overlay state to event-driven handlers");
  }
});
