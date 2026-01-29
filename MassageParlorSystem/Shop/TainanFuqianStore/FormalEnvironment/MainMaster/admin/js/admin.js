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
  initialLoadingEl.classList.remove("initial-loading-hidden");
  hideApp_();

  // 避免「先顯示 0%」：一顯示遮罩就先推進度
  setInitialLoadingProgress_(Math.max(1, Number(initialLoadingProgressEl?.getAttribute?.("aria-valuenow")) || 1));
}

function hideInitialLoading_(text) {
  if (!initialLoadingEl) return;
  if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
  initialLoadingEl.classList.add("initial-loading-hidden");
}

function setInitialLoadingProgress_(percent, text) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
  if (initialLoadingBarEl) initialLoadingBarEl.style.width = `${p}%`;
  if (initialLoadingPercentEl) initialLoadingPercentEl.textContent = `${Math.round(p)}%`;
  if (initialLoadingProgressEl) initialLoadingProgressEl.setAttribute("aria-valuenow", String(Math.round(p)));
}

// defer 腳本會在 DOM 解析後、DOMContentLoaded 前執行。
// admin.html 的 loading 預設可見，因此這裡先把 0% 推進到初始值，避免看到 0%。
setInitialLoadingProgress_(1);

document.addEventListener("DOMContentLoaded", async () => {
  // 先顯示初始載入遮罩，避免白畫面/閃爍
  showInitialLoading_("資料載入中…");
  setInitialLoadingProgress_(5);

  try {
    const withTimeout_ = (promise, ms, label) => {
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 逾時（${ms / 1000}s）`)), ms);
      });
      return Promise.race([promise, timeout]).finally(() => timer && clearTimeout(timer));
    };

    const initListViewToggle_ = () => {
      const btnAdmins = document.getElementById("viewAdminsBtn");
      const btnLogs = document.getElementById("viewAdminLogsBtn");
      const btnUsers = document.getElementById("viewUsersBtn");
      const btnTechUsageLogs = document.getElementById("viewTechUsageLogsBtn");

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

      if (!btnAdmins || !btnUsers || !btnLogs || !btnTechUsageLogs) return;

      const setView_ = (view) => {
        const isAdmins = view === "admins";
        const isLogs = view === "logs";
        const isUsers = view === "users";
        const isTechUsageLogs = view === "techUsageLogs";

        if (adminsKpi) adminsKpi.hidden = !isAdmins;
        if (adminsPanel) adminsPanel.hidden = !isAdmins;
        if (logsPanel) logsPanel.hidden = !isLogs;
        if (usersKpi) usersKpi.hidden = !isUsers;
        if (usersPanel) usersPanel.hidden = !isUsers;
        if (techUsageLogsPanel) techUsageLogsPanel.hidden = !isTechUsageLogs;
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
      };

      // 預設顯示管理員切面（符合「切換」的直覺：一次只看一個名單）
      setView_("admins");

      btnAdmins.addEventListener("click", () => setView_("admins"));
      btnLogs.addEventListener("click", () => setView_("logs"));
      btnUsers.addEventListener("click", () => setView_("users"));
      btnTechUsageLogs.addEventListener("click", () => setView_("techUsageLogs"));
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

    // ✅ 驗證通過後，直接並行載入所有資料（admins + users）
    if (typeof uSetFooter_ === "function") uSetFooter_("載入 Users 資料中...");
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_("載入 Users 資料中...");

    setInitialLoadingProgress_(50, "載入資料中…");

    const tasks = [];
    if (typeof loadAdmins_ === "function") {
      tasks.push(
        (async () => {
          await loadAdmins_();
          return "admins";
        })()
      );
    }

    if (typeof bootUsersPanel_ === "function") {
      tasks.push(
        (async () => {
          await bootUsersPanel_();
          return "users";
        })()
      );
    }

    // 管理員紀錄 / 技師使用紀錄：登入後一次載入（切換頁面不重新打 API）
    if (typeof loadAdminLogs_ === "function") {
      tasks.push(
        (async () => {
          await loadAdminLogs_();
          return "adminLogs";
        })()
      );
    }

    if (typeof loadTechUsageLogs_ === "function") {
      tasks.push(
        (async () => {
          await loadTechUsageLogs_();
          return "techUsageLogs";
        })()
      );
    }

    // 進度：用「完成的任務數」估算（避免卡住在某一步）
    const total = Math.max(1, tasks.length);
    let done = 0;
    const trackedTasks = tasks.map((t) =>
      Promise.resolve(t)
        .catch((e) => {
          throw e;
        })
        .finally(() => {
          done += 1;
          // 50% ~ 95%：隨任務完成推進
          const p = 50 + (done / total) * 45;
          setInitialLoadingProgress_(p, `載入資料中…（${done}/${total}）`);
        })
    );

    const results = await Promise.allSettled(trackedTasks);
    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length) {
      const reasonText = rejected
        .map((r) => String(r.reason?.message || r.reason))
        .filter(Boolean)
        .slice(0, 2)
        .join("；");
      toast(`部分資料載入失敗：${reasonText || "請查看 console"}`, "err");
    }

    setInitialLoadingProgress_(100, "完成");
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
    // 並在首批資料流程結束後再顯示主畫面
    showApp_();
    hideInitialLoading_();
  }
});
