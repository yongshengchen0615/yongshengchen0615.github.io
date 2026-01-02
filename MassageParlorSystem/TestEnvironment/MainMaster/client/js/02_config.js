/* ============================================
 * 02_config.js
 * - 讀取 config.json
 * ============================================ */

/**
 * 載入 config.json，並把結果寫入全域變數
 * @returns {Promise<Object>} cfg - 原始設定物件（方便 debug）
 */
async function loadConfig_() {
  const res = await fetch("config.json", { cache: "no-store" });
  const cfg = await res.json();

  // Users API
  API_BASE_URL = String(cfg.API_BASE_URL || "").trim();
  if (!API_BASE_URL) throw new Error("config.json missing API_BASE_URL");

  // Admin Gate API
  ADMIN_API_URL = String(cfg.ADMIN_API_URL || "").trim();
  if (!ADMIN_API_URL) throw new Error("config.json missing ADMIN_API_URL");

  // LIFF
  LIFF_ID = String(cfg.LIFF_ID || "").trim();
  if (!LIFF_ID) throw new Error("config.json missing LIFF_ID");

  // 預設分頁（只在 localStorage 尚未設定時套用）
  const defView = String(cfg.DEFAULT_VIEW || "").trim();
  if (!localStorage.getItem("users_view") && defView) {
    localStorage.setItem("users_view", defView);
  }

  return cfg;
}
