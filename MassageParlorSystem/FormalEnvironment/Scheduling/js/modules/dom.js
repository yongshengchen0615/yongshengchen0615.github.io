/**
 * dom.js
 *
 * 這裡集中取得 DOM 節點，避免各模組重複 query。
 * 注意：index.html 的 script 在 body 底部載入，因此這裡直接抓 DOM 是安全的。
 */

export const dom = {
  // Gate / Root
  gateEl: document.getElementById("gate"),
  appRootEl: document.getElementById("appRoot"),

  // Top loading toast
  topLoadingEl: document.getElementById("topLoading"),
  topLoadingTextEl: document.getElementById("topLoading")
    ? document.getElementById("topLoading").querySelector(".top-loading-text")
    : null,

  // Header / controls
  connectionStatusEl: document.getElementById("connectionStatus"),
  refreshBtn: document.getElementById("refreshBtn"),
  tabBodyBtn: document.getElementById("tabBody"),
  tabFootBtn: document.getElementById("tabFoot"),
  filterMasterInput: document.getElementById("filterMaster"),
  filterStatusSelect: document.getElementById("filterStatus"),
  panelTitleEl: document.getElementById("panelTitle"),
  lastUpdateEl: document.getElementById("lastUpdate"),
  tbodyRowsEl: document.getElementById("tbodyRows"),
  emptyStateEl: document.getElementById("emptyState"),
  errorStateEl: document.getElementById("errorState"),
  themeToggleBtn: document.getElementById("themeToggle"),

  // Feature / personal tools
  usageBannerEl: document.getElementById("usageBanner"),
  usageBannerTextEl: document.getElementById("usageBanner")
    ? document.getElementById("usageBanner").querySelector("#usageBannerText")
    : document.getElementById("usageBannerText"),

  personalToolsEl: document.getElementById("personalTools"),
  btnUserManageEl: document.getElementById("btnUserManage"),
  btnPersonalStatusEl: document.getElementById("btnPersonalStatus"),
  btnVacationEl: document.getElementById("btnVacation"),

  // 我的狀態
  myMasterStatusEl: document.getElementById("myMasterStatus"),
  myMasterStatusTextEl: document.getElementById("myMasterStatusText"),

  // 排班 UI（schedule=否 時會整段隱藏）
  toolbarEl: document.querySelector(".toolbar"),
  mainEl: document.querySelector("main.main"),
  cardTableEl: document.querySelector(".card.card-table"),

  // 篩選欄 wrapper（用於整個 filter 區塊隱藏）
  filterMasterWrapEl: document.getElementById("filterMaster")
    ? document.getElementById("filterMaster").closest(".filter")
    : null,
  filterStatusWrapEl: document.getElementById("filterStatus")
    ? document.getElementById("filterStatus").closest(".filter")
    : null,
};
