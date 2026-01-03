/**
 * personalTools.js
 *
 * 個人狀態快捷按鈕列：
 * - 使用者管理
 * - 休假設定
 * - 個人狀態
 *
 * 由 AUTH 的 personalStatusEnabled=是 才顯示。
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { withQuery } from "./core.js";

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
  if (!dom.personalToolsEl || !dom.btnUserManageEl || !dom.btnVacationEl || !dom.btnPersonalStatusEl) return;

  dom.personalToolsEl.style.display = "flex";
  dom.btnUserManageEl.style.display = "inline-flex";
  dom.btnVacationEl.style.display = "inline-flex";
  dom.btnPersonalStatusEl.style.display = "inline-flex";

  const manage = pickField(psRow, ["使用者管理liff", "manageLiff", "userManageLiff", "userManageLink"]);
  const vacation = pickField(psRow, ["休假設定連結", "vacationLink"]);
  const personal = pickField(psRow, ["個人狀態連結", "personalStatusLink"]);

  dom.btnUserManageEl.onclick = () => {
    if (!manage) return console.error("PersonalStatus 缺少欄位：使用者管理liff", psRow);
    window.location.href = manage;
  };
  dom.btnVacationEl.onclick = () => {
    if (!vacation) return console.error("PersonalStatus 缺少欄位：休假設定連結", psRow);
    window.location.href = vacation;
  };
  dom.btnPersonalStatusEl.onclick = () => {
    if (!personal) return console.error("PersonalStatus 缺少欄位：個人狀態連結", psRow);
    window.location.href = personal;
  };

  // 保留原本的除錯用全域
  window.__personalLinks = { manage, vacation, personal, psRow };
}

export function hidePersonalTools() {
  if (dom.personalToolsEl) dom.personalToolsEl.style.display = "none";
}

/**
 * 依照 userId 向 AUTH 取個人連結並顯示按鈕。
 * 若取不到，仍會顯示按鈕但點擊會 console.error。
 */
export async function loadAndShowPersonalTools(userId) {
  try {
    const ps = await fetchPersonalStatusRow(userId);
    const psRow = (ps && (ps.data || ps.row || ps.payload) ? ps.data || ps.row || ps.payload : ps) || {};
    showPersonalToolsFinal(psRow);
  } catch (e) {
    showPersonalToolsFinal({});
    console.error("[PersonalTools] getPersonalStatus failed:", e);
  }
}
