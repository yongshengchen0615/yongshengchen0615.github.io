/**
 * featureBanner.js
 *
 * 功能開通提示列（固定顯示 chip）：
 * - 叫班提醒
 * - 個人狀態
 * - 排班表
 * - 業績
 */

import { state } from "./state.js";

function normalizeYesNo(v) {
  return String(v || "").trim() === "是" ? "是" : "否";
}

function buildChip(label, enabled) {
  const on = enabled === "是";
  const cls = on ? "feature-chip" : "feature-chip feature-chip-disabled";
  const badge = on ? "" : `<span class="feature-chip-badge">未開通</span>`;
  return `<span class="${cls}">${label}${badge}</span>`;
}

function renderFeatureBanner() {
  const chipsEl = document.getElementById("featureChips");
  if (!chipsEl) return;

  const push = normalizeYesNo(state.feature.pushEnabled);
  const personal = normalizeYesNo(state.feature.personalStatusEnabled);
  const schedule = normalizeYesNo(state.feature.scheduleEnabled);
    const performance = normalizeYesNo(state.feature.performanceEnabled);

    chipsEl.innerHTML = [
      buildChip("叫班提醒", push),
      buildChip("排班表", schedule),
      buildChip("個人狀態", personal),
      buildChip("業績", performance),
    ].join("");
}

/**
 * 更新 feature 狀態並重新渲染。
 * data 通常是 AUTH 回傳的物件。
 * @param {any} data 後端回傳資料；至少包含 pushEnabled/personalStatusEnabled/scheduleEnabled。
 */
export function updateFeatureState(data) {
  state.feature.pushEnabled = normalizeYesNo(data && data.pushEnabled);
  state.feature.personalStatusEnabled = normalizeYesNo(data && data.personalStatusEnabled);
  state.feature.scheduleEnabled = normalizeYesNo(data && data.scheduleEnabled);
  state.feature.performanceEnabled = normalizeYesNo(data && data.performanceEnabled);
  renderFeatureBanner();
}
