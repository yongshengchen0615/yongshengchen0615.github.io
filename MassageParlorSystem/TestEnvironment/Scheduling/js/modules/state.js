/**
 * state.js
 *
 * 這裡集中管理「可變狀態」：
 * - 面板資料 rawData
 * - 篩選條件
 * - 排班 UI 開關
 * - 我的師傅資訊
 * - polling 狀態
 *
 * 用單一物件 export，方便不同模組共享與修改。
 */

export const state = {
  rawData: {
    body: [],
    foot: [],
  },

  // 資料健康度（用於判斷「太久沒有更新」）
  dataHealth: {
    lastDataTimestampMs: null,
    stale: false,
    staleSinceMs: null,
  },

  // UI 狀態
  activePanel: "body",
  filterMaster: "",
  filterStatus: "all",
  scheduleUiEnabled: true,

  // 刷新/快照保護
  refreshInFlight: false,
  emptyStreak: { body: 0, foot: 0 },

  // 我的師傅狀態（由 AUTH 回傳決定）
  myMaster: {
    isMaster: false,
    techNo: "", // 例如 "07"
  },

  // 功能開通狀態（feature banner）
  feature: {
    pushEnabled: "否",
    personalStatusEnabled: "否",
    scheduleEnabled: "否",
  },

  // Adaptive polling
  poll: {
    successStreak: 0,
    failStreak: 0,
    nextMs: 3000,
  },

  pollTimer: null,
};
