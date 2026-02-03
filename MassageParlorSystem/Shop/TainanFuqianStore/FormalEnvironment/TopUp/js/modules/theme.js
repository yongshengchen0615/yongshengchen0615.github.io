import { dom } from "./dom.js";

export function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", finalTheme);
  try {
    localStorage.setItem("dashboardTheme", finalTheme);
  } catch (_) {}

  if (dom.themeToggleBtn) dom.themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";
}

export function initTheme() {
  let saved = "dark";
  try {
    saved = localStorage.getItem("dashboardTheme") || "dark";
  } catch (_) {}
  setTheme(saved);

  dom.themeToggleBtn?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "dark" ? "light" : "dark");
  });
}
