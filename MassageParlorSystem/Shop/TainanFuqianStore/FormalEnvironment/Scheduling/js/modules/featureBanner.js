/**
 * featureBanner.js
 *
 * 功能開通提示列（固定顯示 chip）：
 * - 叫班提醒
* - 技師休假與狀態
 * - 排班表
 * - 業績
 */

import { dom } from "./dom.js";
import { state } from "./state.js";
import { config } from "./config.js";
import { applyScheduleUiMode } from "./scheduleUi.js";
import { setPersonalToolsEnabled } from "./personalTools.js";
import { setViewMode, VIEW } from "./viewSwitch.js";

function normalizeYesNo(v) {
  return String(v || "").trim() === "是" ? "是" : "否";
}

function buildChip(label, enabled) {
  const on = enabled === "是";
  const cls = on ? "feature-chip" : "feature-chip feature-chip-disabled";
  const badge = on ? "" : `<span class="feature-chip-badge">未開通</span>`;
  return `<span class="${cls}">${label}${badge}</span>`;
}

function buildChipAlways(label) {
  return `<span class="feature-chip">${label}</span>`;
}

function renderFeatureBanner() {
  const bannerEl = document.getElementById("featureBanner");
  const chipsEl = document.getElementById("featureChips");
  if (!chipsEl) return;

  const push = normalizeYesNo(state.feature.pushEnabled);
  const personal = normalizeYesNo(state.feature.personalStatusEnabled);
  const schedule = normalizeYesNo(state.feature.scheduleEnabled);
  const performance = normalizeYesNo(state.feature.performanceEnabled);
  const booking = normalizeYesNo(state.feature.bookingEnabled);

  // 若預約查詢 URL 沒設定，即使後端回傳「是」也視為不可用（等同未開通顯示）。
  const bookingUrlOk = !!String(config.BOOKING_API_URL || "").trim();

  const disabledChips = [];
  // 需求：未開通功能不需要額外「未開通樣式」→ 一律用一般 chip 呈現。
  if (push !== "是") disabledChips.push(buildChipAlways("叫班提醒"));
  if (schedule !== "是") disabledChips.push(buildChipAlways("排班表"));
  if (personal !== "是") disabledChips.push(buildChipAlways("技師休假與狀態"));
  if (performance !== "是") disabledChips.push(buildChipAlways("業績"));
  if (booking !== "是" || !bookingUrlOk) disabledChips.push(buildChipAlways("預約查詢"));

  chipsEl.innerHTML = disabledChips.join("");

  // 全部已開通：整段隱藏，避免空白佔位。
  if (bannerEl) bannerEl.style.display = disabledChips.length ? "flex" : "none";
}

function applyFeatureUi_() {
  const scheduleOk = normalizeYesNo(state.feature.scheduleEnabled) === "是";
  const performanceOk = normalizeYesNo(state.feature.performanceEnabled) === "是";
  const personalOk = normalizeYesNo(state.feature.personalStatusEnabled) === "是";
  const bookingOk = normalizeYesNo(state.feature.bookingEnabled) === "是";
  const bookingUrlOk = !!String(config.BOOKING_API_URL || "").trim();

  // 個人工具按鈕（技師管理員/休假與狀態）
  try {
    setPersonalToolsEnabled(personalOk);
  } catch {
    // ignore
  }

  // 排班表（按鈕 + 面板 UI）
  try {
    applyScheduleUiMode(scheduleOk);
  } catch {
    // ignore
  }

  // 業績（按鈕）
  if (dom.btnPerformanceEl) dom.btnPerformanceEl.style.display = performanceOk ? "" : "none";

  // 預約查詢（按鈕）
  if (dom.btnBookingEl) dom.btnBookingEl.style.display = bookingOk && bookingUrlOk ? "" : "none";

  // 若功能關閉且目前正在該視圖：切回我的狀態，避免空白畫面
  try {
    const vm = String(state.viewMode || "");
    if (!scheduleOk && vm === VIEW.SCHEDULE) setViewMode(VIEW.MY_STATUS);
    if (!performanceOk && vm === VIEW.PERFORMANCE) setViewMode(VIEW.MY_STATUS);
    if ((!bookingOk || !bookingUrlOk) && vm === VIEW.BOOKING) setViewMode(VIEW.MY_STATUS);
  } catch {
    // ignore
  }

  // 防呆：關閉業績時，確保業績卡片不可見
  if (!performanceOk && dom.perfCardEl) dom.perfCardEl.style.display = "none";

  // 防呆：關閉預約查詢時，確保預約卡片不可見
  if ((!bookingOk || !bookingUrlOk) && dom.bookingCardEl) dom.bookingCardEl.style.display = "none";
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
  state.feature.bookingEnabled = normalizeYesNo(data && data.bookingEnabled);
  renderFeatureBanner();
  applyFeatureUi_();
}
