export const dom = {
  gateEl: document.getElementById("gate"),
  appRootEl: document.getElementById("appRoot"),
  initialLoadingEl: document.getElementById("initialLoading"),
  initialLoadingTextEl: document.getElementById("initialLoadingText"),
  initialLoadingBarEl: document.getElementById("initialLoadingBar"),
  initialLoadingPercentEl: document.getElementById("initialLoadingPercent"),
  initialLoadingProgressEl: document.getElementById("initialLoading")
    ? document.getElementById("initialLoading").querySelector(".initial-loading-progress")
    : null,

  topLoadingEl: document.getElementById("topLoading"),
  topLoadingTextEl: document.getElementById("topLoading")
    ? document.getElementById("topLoading").querySelector(".top-loading-text")
    : null,

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
  btnMyStatusEl: document.getElementById("btnMyStatus"),
  btnScheduleEl: document.getElementById("btnSchedule"),
  btnPerformanceEl: document.getElementById("btnPerformance"),

  usageBannerEl: document.getElementById("usageBanner"),
  usageBannerTextEl: document.getElementById("usageBanner")
    ? document.getElementById("usageBanner").querySelector("#usageBannerText")
    : document.getElementById("usageBannerText"),

  personalToolsEl: document.getElementById("personalTools"),
  btnUserManageEl: document.getElementById("btnUserManage"),
  btnPersonalStatusEl: document.getElementById("btnPersonalStatus"),

  myMasterStatusEl: document.getElementById("myMasterStatus"),
  myMasterStatusTextEl: document.getElementById("myMasterStatusText"),

  toolbarEl: document.querySelector(".toolbar"),
  mainEl: document.querySelector("main.main"),
  cardTableEl: document.querySelector(".card.card-table"),

  filterMasterWrapEl: document.getElementById("filterMaster")
    ? document.getElementById("filterMaster").closest(".filter")
    : null,
  filterStatusWrapEl: document.getElementById("filterStatus")
    ? document.getElementById("filterStatus").closest(".filter")
    : null,

  perfCardEl: document.getElementById("perfCard"),
  perfDateStartInput: document.getElementById("perfDateStart"),
  perfDateEndInput: document.getElementById("perfDateEnd"),
  perfChartEl: document.getElementById("perfChart"),

  perfDateKeyInput: document.getElementById("perfDateKey"),
  perfSearchBtn: document.getElementById("perfSearch"),
  perfSearchSummaryBtn: document.getElementById("perfSearchSummary"),
  perfSearchDetailBtn: document.getElementById("perfSearchDetail"),
  perfStatusEl: document.getElementById("perfStatus"),
  perfMetaEl: document.getElementById("perfMeta"),
  perfMonthRatesEl: document.getElementById("perfMonthRates"),
  perfSummaryRowsEl: document.getElementById("perfSummaryRows"),
  perfDetailHeadRowEl: document.getElementById("perfDetailHeadRow"),
  perfDetailRowsEl: document.getElementById("perfDetailRows"),
  perfEmptyEl: document.getElementById("perfEmpty"),
  perfErrorEl: document.getElementById("perfError"),
  perfDetailCountEl: document.getElementById("perfDetailCount"),
};
