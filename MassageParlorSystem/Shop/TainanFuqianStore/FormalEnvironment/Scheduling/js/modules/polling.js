/**
 * polling.js
 *
 * Adaptive Polling（降低 GAS 壓力）：
 * - 成功/穩定後逐步拉長間隔
 * - 失敗後 exponential backoff
 * - 變更時加速下一次
 */

import { state } from "./state.js";
import { dom } from "./dom.js";
import { refreshStatus, hydrateStatusFromCache } from "./table.js";
import { updateMyMasterStatusUI } from "./myMasterStatus.js";
import { showLoadingHint, hideLoadingHint, showInitialLoading, hideInitialLoading, setInitialLoadingProgress } from "./uiHelpers.js";
import { config } from "./config.js";
import { manualRefreshPerformance } from "./performance.js";
import { maybeShowDailyFirstOpenHint } from "./dailyHint.js";

const POLL = {
  BASE_MS: 3000,
  MAX_MS: 20000,
  FAIL_MAX_MS: 60000,
  STABLE_UP_AFTER: 3,
  CHANGED_BOOST_MS: 4500,
  JITTER_RATIO: 0.2,
};

function getPollCfg() {
  // config 會在 boot 時 loadConfigJson() 後就緒
  return {
    BASE_MS: Number(config.POLL_BASE_MS) || POLL.BASE_MS,
    MAX_MS: Number(config.POLL_MAX_MS) || POLL.MAX_MS,
    FAIL_MAX_MS: Number(config.POLL_FAIL_MAX_MS) || POLL.FAIL_MAX_MS,
    STABLE_UP_AFTER: Number(config.POLL_STABLE_UP_AFTER) || POLL.STABLE_UP_AFTER,
    CHANGED_BOOST_MS: Number(config.POLL_CHANGED_BOOST_MS) || POLL.CHANGED_BOOST_MS,
    JITTER_RATIO: typeof config.POLL_JITTER_RATIO === "number" ? config.POLL_JITTER_RATIO : POLL.JITTER_RATIO,
  };
}

function withJitter(ms, ratio) {
  const r = typeof ratio === "number" ? ratio : 0.15;
  const delta = ms * r;
  const j = (Math.random() * 2 - 1) * delta;
  return Math.max(800, Math.floor(ms + j));
}

function clearPoll() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

function scheduleNextPoll(ms) {
  clearPoll();
  const pc = getPollCfg();
  const wait = withJitter(ms, pc.JITTER_RATIO);

  state.pollTimer = setTimeout(async () => {
    if (document.hidden && !config.POLL_ALLOW_BACKGROUND) {
      // 背景輪詢關閉：停掉 timer，等待回前景事件 kick。
      clearPoll();
      return;
    }

    const res = await refreshStatusAdaptive(false);
    const next = computeNextInterval(res);
    scheduleNextPoll(next);
  }, wait);
}

function computeNextInterval(res) {
  const pc = getPollCfg();
  const ok = !!(res && res.ok);
  const changed = !!(res && res.changed);

  if (!ok) {
    state.poll.failStreak += 1;
    state.poll.successStreak = 0;

    const backoff = Math.min(pc.FAIL_MAX_MS, pc.BASE_MS * Math.pow(2, state.poll.failStreak));
    state.poll.nextMs = Math.max(pc.BASE_MS, backoff);
    return state.poll.nextMs;
  }

  state.poll.successStreak += 1;
  state.poll.failStreak = 0;

  if (changed) {
    // ✅ 即時性優先：偵測到變更後，下一次直接用 BASE 再抓一次
    // - 常見情境：短時間連續變更（師傅狀態、預約等）
    // - 代價：只有在「確定有變更」時才會更密集
    state.poll.nextMs = Math.max(pc.BASE_MS, Number(pc.CHANGED_BOOST_MS) || pc.BASE_MS);
    return state.poll.nextMs;
  }

  if (state.poll.successStreak < pc.STABLE_UP_AFTER) {
    state.poll.nextMs = Math.max(pc.BASE_MS, state.poll.nextMs);
    return state.poll.nextMs;
  }

  const s = state.poll.successStreak;
  let target;
  if (s < 6) target = 5000;
  else if (s < 10) target = 8000;
  else if (s < 16) target = 12000;
  else target = POLL.MAX_MS;

  state.poll.nextMs = Math.min(pc.MAX_MS, Math.max(pc.BASE_MS, target));
  return state.poll.nextMs;
}

async function refreshStatusAdaptive(isManual) {
  try {
    const beforeBody = state.rawData.body;
    const beforeFoot = state.rawData.foot;

    await refreshStatus({ isManual });

    const changed = beforeBody !== state.rawData.body || beforeFoot !== state.rawData.foot;
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, changed: false };
  }
}

function resetPollState() {
  state.poll.successStreak = 0;
  state.poll.failStreak = 0;
  state.poll.nextMs = getPollCfg().BASE_MS;
}

/**
 * 啟動輪詢
 * - scheduleUiEnabled=false：也會輪詢（只更新 rawData + 我的狀態/提示）
 * - 內建自適應間隔：穩定後加長、失敗後退避、資料變更時加速下一次
 * @returns {void}
 */
export function startPolling(extraReadyPromise) {
  showInitialLoading("資料載入中…");
  setInitialLoadingProgress(85, "同步資料中…");

  try {
    performance && performance.mark && performance.mark("poll:start");
  } catch {}

  // ✅ 先用快取快照快速顯示（若有）：縮短「白屏/遮罩」時間
  // - 仍會在背景立刻同步最新資料
  const hydrated = (() => {
    try {
      return hydrateStatusFromCache({ maxAgeMs: 2 * 60 * 1000 });
    } catch {
      return false;
    }
  })();

  if (hydrated) {
    try {
      setInitialLoadingProgress(90, "已載入上次資料，正在同步最新資料…");
      hideInitialLoading();
      showLoadingHint("同步最新資料中…");

      try {
        performance && performance.mark && performance.mark("status:cached_paint");
      } catch {}
    } catch {
      // ignore
    }
  }

  // 手動重整
  if (dom.refreshBtn) {
    dom.refreshBtn.addEventListener("click", async () => {
      resetPollState();
      showLoadingHint("同步資料中…");

      const res = await refreshStatusAdaptive(true);
      updateMyMasterStatusUI();

      // 若目前在「業績」視圖：手動重整也要同步更新業績快取（按鈕只讀快取）。
      if (state.viewMode === "performance" && String(state.feature && state.feature.performanceEnabled) === "是") {
        try {
          await manualRefreshPerformance({ showToast: false });
        } catch {}
      }

      hideLoadingHint();
      const next = computeNextInterval(res);
      scheduleNextPoll(next);
    });
  }

  // 初次啟動
  refreshStatusAdaptive(false).then(async (res) => {
    try {
      performance && performance.mark && performance.mark("status:first_sync_done");
    } catch {}

    // optional: log key timings for validation
    try {
      if (localStorage && localStorage.getItem("debugPerf") === "1" && performance && performance.measure) {
        performance.measure("t_boot_to_auth_ok", "app:boot_start", "app:auth_ok");
        performance.measure("t_boot_to_cached_paint", "app:boot_start", "status:cached_paint");
        performance.measure("t_boot_to_first_sync", "app:boot_start", "status:first_sync_done");
        const m = performance.getEntriesByType("measure").slice(-8);
        console.log("[PerfMeasures]", m.map((x) => ({ name: x.name, ms: Math.round(x.duration) })));
      }
    } catch {}

    updateMyMasterStatusUI();

    // 允許 boot() 在初次載入時額外等待其他資料（例如：業績預載）
    // - 若已用快取顯示 UI，就不要再阻塞遮罩
    // - 即使沒有快取，也要限制等待時間，避免卡在遮罩太久
    try {
      if (!hydrated) setInitialLoadingProgress(92, "準備中…");
      const EXTRA_WAIT_MAX_MS = 1500;
      await Promise.race([
        Promise.resolve(extraReadyPromise),
        new Promise((resolve) => setTimeout(resolve, EXTRA_WAIT_MAX_MS)),
      ]);
    } catch {
      // extraReadyPromise 失敗不應阻擋主流程
    }

    if (!hydrated) {
      setInitialLoadingProgress(100, "完成");
      hideInitialLoading();
    }

    try {
      hideLoadingHint();
    } catch {
      // ignore
    }

      // ✅ 當日第一次開啟提示 + 左右滑動提示動畫
    try {
      maybeShowDailyFirstOpenHint();
    } catch {
      // ignore
    }

    const next = computeNextInterval(res);
    scheduleNextPoll(next);
  });

  // 從背景回來時立即刷新
  let lastKickMs_ = 0;
  async function kickImmediateRefresh_(reason) {
    try {
      const now = Date.now();
      if (now - lastKickMs_ < 1200) return; // throttle
      lastKickMs_ = now;

      resetPollState();
      clearPoll();
      const res = await refreshStatusAdaptive(false);
      const next = computeNextInterval(res);
      scheduleNextPoll(next);
    } catch (e) {
      // ignore (adaptive loop will handle retries)
    }
  }

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden) await kickImmediateRefresh_("visibility");
  });

  // 有些環境（特別是某些 WebView）focus/online 比 visibilitychange 更可靠
  try {
    window.addEventListener("focus", () => {
      if (!document.hidden) kickImmediateRefresh_("focus");
    });
    window.addEventListener("online", () => {
      if (!document.hidden) kickImmediateRefresh_("online");
    });
  } catch {}
}
