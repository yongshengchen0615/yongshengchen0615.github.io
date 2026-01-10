/**
 * personalTools.js
 *
 * 個人狀態快捷按鈕列：
 * - 技師管理員（開啟 技師管理員liff / adminLiff）
 * - 個人狀態（開啟 個人看板liff / personalBoardLiff）
 * - 複製個人狀態連結（複製 個人看板liff / personalBoardLiff）
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

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function showPersonalToolsFinal(psRow) {
  if (!dom.personalToolsEl || !dom.btnUserManageEl || !dom.btnVacationEl || !dom.btnPersonalStatusEl) return;

  dom.personalToolsEl.style.display = "flex";
  dom.btnUserManageEl.style.display = "inline-flex";
  dom.btnVacationEl.style.display = "inline-flex";
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
      alert("尚未設定『個人狀態』連結，請管理員至後台填入個人看板liff。 ");
      return;
    }
    window.location.href = personalBoardLiff;
  };

  dom.btnVacationEl.onclick = async () => {
    if (!personalBoardLiff) {
      alert("尚未設定『個人狀態』連結，請管理員至後台填入個人看板liff。 ");
      return;
    }

    const ok = await copyTextToClipboard(personalBoardLiff);
    if (ok) alert("已複製個人狀態連結");
    else window.prompt("複製個人狀態連結：", personalBoardLiff);
  };

  // 保留原本的除錯用全域
  window.__personalLinks = { adminLiff, personalBoardLiff, psRow };
}

export function hidePersonalTools() {
  if (dom.personalToolsEl) dom.personalToolsEl.style.display = "none";
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
