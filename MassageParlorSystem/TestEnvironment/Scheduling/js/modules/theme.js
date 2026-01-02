/**
 * theme.js
 *
 * 主題切換：
 * - 讀取/寫入 localStorage
 * - 設定 <html data-theme="dark|light">
 * - 同步按鈕文字
 * - 主題切換後重新套表頭顏色與我的狀態 token
 */

import { dom } from "./dom.js";
import { reapplyTableHeaderColorsFromDataset } from "./table.js";
import { updateMyMasterStatusUI } from "./myMasterStatus.js";

export function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", finalTheme);
  localStorage.setItem("dashboardTheme", finalTheme);

  if (dom.themeToggleBtn) dom.themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";

  // 主題改變後：表頭 token 顏色、我的狀態 token 需要重算
  reapplyTableHeaderColorsFromDataset();
  updateMyMasterStatusUI();
}

export function initTheme() {
  const saved = localStorage.getItem("dashboardTheme") || "dark";
  setTheme(saved);

  if (dom.themeToggleBtn) {
    dom.themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      setTheme(current === "dark" ? "light" : "dark");
    });
  }
}
