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
import { refreshStatus } from "./table.js";
import { updateMyMasterStatusUI } from "./myMasterStatus.js";
import { showLoadingHint, hideLoadingHint } from "./uiHelpers.js";

const POLL = {
  BASE_MS: 3000,
  MAX_MS: 20000,
  FAIL_MAX_MS: 60000,
  STABLE_UP_AFTER: 3,
  CHANGED_BOOST_MS: 4500,
  JITTER_RATIO: 0.2,
};

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
  const wait = withJitter(ms, POLL.JITTER_RATIO);

  state.pollTimer = setTimeout(async () => {
    if (document.hidden) return;

    const res = await refreshStatusAdaptive(false);
    const next = computeNextInterval(res);
    scheduleNextPoll(next);
  }, wait);
}

function computeNextInterval(res) {
  const ok = !!(res && res.ok);
  const changed = !!(res && res.changed);

  if (!ok) {
    state.poll.failStreak += 1;
    state.poll.successStreak = 0;

    const backoff = Math.min(POLL.FAIL_MAX_MS, POLL.BASE_MS * Math.pow(2, state.poll.failStreak));
    state.poll.nextMs = Math.max(POLL.BASE_MS, backoff);
    return state.poll.nextMs;
  }

  state.poll.successStreak += 1;
  state.poll.failStreak = 0;

  if (changed) {
    state.poll.nextMs = Math.max(POLL.BASE_MS, Math.min(POLL.MAX_MS, POLL.CHANGED_BOOST_MS));
    return state.poll.nextMs;
  }

  if (state.poll.successStreak < POLL.STABLE_UP_AFTER) {
    state.poll.nextMs = Math.max(POLL.BASE_MS, state.poll.nextMs);
    return state.poll.nextMs;
  }

  const s = state.poll.successStreak;
  let target;
  if (s < 6) target = 5000;
  else if (s < 10) target = 8000;
  else if (s < 16) target = 12000;
  else target = POLL.MAX_MS;

  state.poll.nextMs = Math.min(POLL.MAX_MS, Math.max(POLL.BASE_MS, target));
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
  state.poll.nextMs = POLL.BASE_MS;
}

/**
 * 啟動輪詢
 * - scheduleUiEnabled=false：也會輪詢（只更新 rawData + 我的狀態/提示）
 */
export function startPolling() {
  // 手動重整
  if (dom.refreshBtn) {
    dom.refreshBtn.addEventListener("click", async () => {
      resetPollState();
      showLoadingHint("同步資料中…");

      const res = await refreshStatusAdaptive(true);
      updateMyMasterStatusUI();

      hideLoadingHint();
      const next = computeNextInterval(res);
      scheduleNextPoll(next);
    });
  }

  // 初次啟動
  refreshStatusAdaptive(false).then((res) => {
    updateMyMasterStatusUI();
    const next = computeNextInterval(res);
    scheduleNextPoll(next);
  });

  // 從背景回來時立即刷新
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden) {
      resetPollState();
      const res = await refreshStatusAdaptive(false);
      const next = computeNextInterval(res);
      scheduleNextPoll(next);
    }
  });
}
