/**
 * viewSwitch.js
 *
 * 同頁面切換三個面板：
 * - 我的狀態（myMasterStatus）
 * - 排班表（toolbar + main/card-table）
 * - 業績（perfCard）
 */

import { dom } from "./dom.js";
import { state } from "./state.js";
import { updateMyMasterStatusUI } from "./myMasterStatus.js";
import { renderIncremental } from "./table.js";
import { logUsageEvent } from "./usageLog.js";

let perfModPromise_ = null;
async function loadPerformanceModule_() {
  if (perfModPromise_) return perfModPromise_;
  perfModPromise_ = import("./performance.js");
  return perfModPromise_;
}

export const VIEW = {
  SCHEDULE: "schedule",
  MY_STATUS: "myStatus",
  PERFORMANCE: "performance",
};

function showScheduleUI_(show) {
  const scheduleVisible = show && state.scheduleUiEnabled;

  if (dom.toolbarEl) dom.toolbarEl.style.display = scheduleVisible ? "" : "none";
  if (dom.mainEl) dom.mainEl.style.display = scheduleVisible ? "" : "none";
  if (dom.cardTableEl) dom.cardTableEl.style.display = scheduleVisible ? "" : "none";

  // schedule 未開通時：讓使用者知道原因
  if (show && !state.scheduleUiEnabled && dom.connectionStatusEl) {
    dom.connectionStatusEl.textContent = "排班表未開通（僅顯示我的狀態）";
  }
}

function showMyStatus_(show) {
  if (!dom.myMasterStatusEl) return;

  if (show) {
    dom.myMasterStatusEl.style.display = "flex";
    updateMyMasterStatusUI();
  } else {
    dom.myMasterStatusEl.style.display = "none";
  }
}

function showPerformance_(show) {
  if (!dom.perfCardEl) return;

  dom.perfCardEl.style.display = show ? "" : "none";
  if (show) {
    // lazy-load performance module (large)
    loadPerformanceModule_()
      .then((perf) => {
        try {
          perf.initPerformanceUi && perf.initPerformanceUi();
        } catch {}
        try {
          perf.onShowPerformance && perf.onShowPerformance();
        } catch {}
      })
      .catch((e) => console.error("[Perf] module load failed:", e));
  }
}

export function setViewMode(mode) {
  const m = mode === VIEW.MY_STATUS || mode === VIEW.PERFORMANCE ? mode : VIEW.SCHEDULE;
  state.viewMode = m;

  // 互斥顯示
  showScheduleUI_(m === VIEW.SCHEDULE);
  showMyStatus_(m === VIEW.MY_STATUS);
  showPerformance_(m === VIEW.PERFORMANCE);

  // 需要顯示排班表時補一次 render（避免切回來仍是舊 DOM）
  if (m === VIEW.SCHEDULE && state.scheduleUiEnabled) {
    try {
      renderIncremental(state.activePanel);
    } catch {}
  }
}

export function initViewSwitch() {
  if (dom.btnMyStatusEl) {
    dom.btnMyStatusEl.addEventListener("click", () => {
      const from = state.viewMode || "";
      logUsageEvent({ event: "view_switch", detail: `${from}->${VIEW.MY_STATUS}`, noThrottle: true, eventCn: "視圖切換" });
      setViewMode(VIEW.MY_STATUS);
    });
  }
  if (dom.btnScheduleEl) {
    dom.btnScheduleEl.addEventListener("click", () => {
      const from = state.viewMode || "";
      logUsageEvent({ event: "view_switch", detail: `${from}->${VIEW.SCHEDULE}`, noThrottle: true, eventCn: "視圖切換" });
      setViewMode(VIEW.SCHEDULE);
    });
  }
  if (dom.btnPerformanceEl) {
    dom.btnPerformanceEl.addEventListener("click", () => {
      const from = state.viewMode || "";
      logUsageEvent({ event: "view_switch", detail: `${from}->${VIEW.PERFORMANCE}`, noThrottle: true, eventCn: "視圖切換" });
      setViewMode(VIEW.PERFORMANCE);
    });
  }
}
