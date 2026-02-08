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

const initialLoadingEl = document.getElementById("initialLoading");
const initialLoadingTextEl = document.getElementById("initialLoadingText");

function showInitialLoading_(text) {
  if (initialLoadingEl) {
    if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
    initialLoadingEl.classList.remove("initial-loading-hidden");
  }
}

function hideInitialLoading_(text) {
  if (initialLoadingEl) {
    if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
    initialLoadingEl.classList.add("initial-loading-hidden");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  showInitialLoading_("資料載入中…");

  try {
    const withTimeout_ = (promise, ms, label) => {
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 逾時（${ms / 1000}s）`)), ms);
      });
      return Promise.race([promise, timeout]).finally(() => timer && clearTimeout(timer));
    };

    // Users/技師資料管理（獨立區塊）：先初始化 UI，避免後續流程失敗時卡在預設「載入中」
    if (typeof initUsersPanel_ === "function") initUsersPanel_();

    const cfg = await loadConfig_();
    initTheme_();

    // 事件綁定（僅做一次）
    bindTopbar_();
    bindSearch_();
    bindChips_();
    bindBulk_();
    bindTableDelegation_();

    // 先通過 LIFF + AUTH Gate（可由 config.json 的 USE_LIFF 控制）才載入資料
    if (typeof uSetFooter_ === "function") uSetFooter_("管理員驗證中...");
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_("管理員驗證中...");

    if (typeof USE_LIFF === "undefined" || USE_LIFF) {
      await withTimeout_(liffGate_(), 15000, "LIFF/管理員驗證");
    } else {
      // 跳過 LIFF（測試模式）：使用可選的 config.debug 設定或預設值
      setAuthText_("跳過 LIFF（測試模式）");
      me.userId = String(cfg.DEBUG_USER_ID || "LOCAL_TEST").trim();
      me.displayName = String(cfg.DEBUG_DISPLAY_NAME || "Local Tester").trim();
      me.audit = String(cfg.DEBUG_USER_AUDIT || "通過").trim();
      setAuthText_(`${me.displayName}（${me.audit}）`);
    }

    await loadAdmins_();

    // Users 資料（不影響 admin 清單）
    if (typeof uSetFooter_ === "function") uSetFooter_("載入 Users 資料中...");
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_("載入 Users 資料中...");
    if (typeof bootUsersPanel_ === "function") await bootUsersPanel_();
  } catch (e) {
    console.error(e);
    toast("初始化失敗（請檢查 config.json / LIFF / GAS）", "err");

    // 同步把錯誤狀態顯示在 Users 區塊（如果存在）
    const msg = `初始化失敗：${String(e?.message || e)}`;
    if (typeof uSetFooter_ === "function") uSetFooter_(msg);
    if (typeof uSetTbodyMessage_ === "function") uSetTbodyMessage_(msg);
  } finally {
    hideInitialLoading_();
  }
});
