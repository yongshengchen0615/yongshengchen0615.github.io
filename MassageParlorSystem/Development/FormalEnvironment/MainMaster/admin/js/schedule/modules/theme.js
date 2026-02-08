import { dom } from "./dom.js";
import { renderIncremental, reapplyTableHeaderColorsFromDataset } from "./table.js";
import { updateMyMasterStatusUI } from "./myMasterStatus.js";
import { state } from "./state.js";

export function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", finalTheme);
  // use the same storage key as admin UI to avoid conflicting state
  localStorage.setItem("theme", finalTheme);

  if (dom.themeToggleBtn) dom.themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";

  if (state.scheduleUiEnabled) renderIncremental(state.activePanel);
  else reapplyTableHeaderColorsFromDataset();
  updateMyMasterStatusUI();
}

export function initTheme() {
  // prefer admin's theme key; fall back to dark
  const saved = localStorage.getItem("theme") || "dark";
  setTheme(saved);

  // Avoid binding the global topbar toggle if admin already provides a handler.
  // Admin's scripts expose `toggleTheme_` and `initTheme_` — if present, let them own the button.
  if (dom.themeToggleBtn && typeof window.toggleTheme_ !== "function") {
    dom.themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      setTheme(current === "dark" ? "light" : "dark");
    });
  }
}
