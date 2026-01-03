/* ================================
 * 02_config.js
 * Load config.json + audit helpers
 * ================================ */

const AUDIT_ENUM = ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"];

function normalizeAudit_(v) {
  const s = String(v || "").trim();
  if (!s) return "待審核";
  return AUDIT_ENUM.includes(s) ? s : "其他";
}

async function loadConfig_() {
  const res = await fetch("config.json", { cache: "no-store" });
  const cfg = await res.json();

  API_BASE_URL = String(cfg.API_BASE_URL || "").trim();
  if (!API_BASE_URL) throw new Error("config.json missing API_BASE_URL");

  ADMIN_API_URL = String(cfg.ADMIN_API_URL || "").trim();
  if (!ADMIN_API_URL) throw new Error("config.json missing ADMIN_API_URL");

  LIFF_ID = String(cfg.LIFF_ID || "").trim();
  if (!LIFF_ID) throw new Error("config.json missing LIFF_ID");

  const defView = String(cfg.DEFAULT_VIEW || "").trim();
  if (!localStorage.getItem("users_view") && defView) {
    localStorage.setItem("users_view", defView);
  }

  return cfg;
}

