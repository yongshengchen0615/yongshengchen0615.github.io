export const state = {
  rawData: {
    body: [],
    foot: [],
  },

  dataHealth: {
    lastDataTimestampMs: null,
    stale: false,
    staleSinceMs: null,
  },

  activePanel: "body",
  filterMaster: "",
  filterStatus: "all",
  scheduleUiEnabled: true,
  viewMode: "schedule",

  refreshInFlight: false,
  emptyStreak: { body: 0, foot: 0 },

  myMaster: {
    isMaster: false,
    techNo: "",
  },

  feature: {
    pushEnabled: "否",
    personalStatusEnabled: "否",
    scheduleEnabled: "否",
    performanceEnabled: "否",
  },

  poll: {
    successStreak: 0,
    failStreak: 0,
    nextMs: 3000,
  },

  pollTimer: null,
};
