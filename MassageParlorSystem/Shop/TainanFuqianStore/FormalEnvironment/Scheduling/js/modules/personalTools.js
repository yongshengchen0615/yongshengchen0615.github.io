/**
 * personalTools.js
 *
 * 個人狀態快捷按鈕列：
 * - 技師管理員（開啟 技師管理員liff / adminLiff）
 * - 技師休假與狀態（開啟 個人看板liff / personalBoardLiff）
 *
 * 由 AUTH 的 personalStatusEnabled=是 才顯示。
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { withQuery } from "./core.js";
import { state } from "./state.js";

async function fetchPersonalStatusRow(userId) {
  const url = withQuery(config.AUTH_API_URL, "mode=getPersonalStatus&userId=" + encodeURIComponent(userId));
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("getPersonalStatus HTTP " + resp.status);
  return await resp.json();
}

function pickField(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function showPersonalToolsFinal(psRow) {
  if (!dom.personalToolsEl || !dom.btnUserManageEl || !dom.btnPersonalStatusEl) return;

  dom.personalToolsEl.style.display = "flex";
  dom.btnUserManageEl.style.display = "inline-flex";
  dom.btnPersonalStatusEl.style.display = "inline-flex";

  const adminLiff = pickField(psRow, ["adminLiff", "manageLiff", "技師管理員liff"]);
  const personalBoardLiff = pickField(psRow, ["personalBoardLiff", "personalLiff", "個人看板liff"]);

  dom.btnUserManageEl.onclick = () => {
    if (!adminLiff) {
      alert("尚未設定『技師管理員』連結，請管理員至後台填入技師管理員liff。 ");
      return;
    }
    window.location.href = adminLiff;
  };
  dom.btnPersonalStatusEl.onclick = () => {
    if (!personalBoardLiff) {
      alert("尚未設定『技師休假與狀態』連結，請管理員至後台填入個人看板liff。 ");
      return;
    }
    window.location.href = personalBoardLiff;
  };

  // 保留原本的除錯用全域
  window.__personalLinks = { adminLiff, personalBoardLiff, psRow };
}

export function hidePersonalTools() {
  if (dom.personalToolsEl) dom.personalToolsEl.style.display = "none";
}

/**
 * 根據 feature flag 顯示/隱藏個人工具按鈕（不會 fetch 連結）
 * @param {boolean} enabled
 */
export function setPersonalToolsEnabled(enabled) {
  if (!dom.btnUserManageEl || !dom.btnPersonalStatusEl) return;
  if (enabled) {
    // 預設為 inline-flex（若尚未 load 連結，點擊會提示或由 loadAndShowPersonalTools 覆寫 onclick）
    dom.btnUserManageEl.style.display = "inline-flex";
    dom.btnPersonalStatusEl.style.display = "inline-flex";
    if (dom.personalToolsEl) dom.personalToolsEl.style.display = "flex";
  } else {
    dom.btnUserManageEl.style.display = "none";
    dom.btnPersonalStatusEl.style.display = "none";
    if (dom.personalToolsEl) dom.personalToolsEl.style.display = "none";
  }
}

/**
 * 依照 userId 向 AUTH 取個人連結並顯示按鈕。
 * 若取不到，仍會顯示按鈕但點擊會 console.error。
 * @param {string} userId 使用者 ID（通常是 LIFF userId）。
 * @returns {Promise<void>}
 */
export async function loadAndShowPersonalTools(userId) {
  try {
    const ps = await fetchPersonalStatusRow(userId);
    if (ps && ps.ok === false) throw new Error(ps.error || "getPersonalStatus_failed");
    const psRow = (ps && (ps.data || ps.row || ps.payload) ? ps.data || ps.row || ps.payload : ps) || {};
    showPersonalToolsFinal(psRow);
  } catch (e) {
    showPersonalToolsFinal({});
    console.error("[PersonalTools] getPersonalStatus failed:", e);
  }
}
