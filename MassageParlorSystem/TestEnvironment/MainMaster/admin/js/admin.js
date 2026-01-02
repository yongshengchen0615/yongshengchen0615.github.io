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

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadConfig_();
    initTheme_();

    // 事件綁定（僅做一次）
    bindTopbar_();
    bindSearch_();
    bindChips_();
    bindBulk_();
    bindTableDelegation_();

    // 先通過 LIFF + AUTH Gate 才載入資料
    await liffGate_();
    await loadAdmins_();
  } catch (e) {
    console.error(e);
    toast("初始化失敗（請檢查 config.json / LIFF / GAS）", "err");
  }
});
