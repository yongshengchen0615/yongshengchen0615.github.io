/* ================================
 * Admin 審核管理台 - API 與設定
 * ================================ */

/**
 * 載入 config.json。
 * - admin.js 會用 fetch 讀取同層的 config.json
 * - 缺少必要欄位會直接 throw，避免後續 API 呼叫出現難追的錯誤
 */
async function loadConfig_() {
  const res = await fetch("config.json", { cache: "no-store" });
  const cfg = await res.json();

  ADMIN_API_URL = String(cfg.ADMIN_API_URL || "").trim();
  AUTH_API_URL = String(cfg.AUTH_API_URL || "").trim();
  LIFF_ID = String(cfg.LIFF_ID || "").trim();

  if (!ADMIN_API_URL) throw new Error("config.json missing ADMIN_API_URL");
  if (!AUTH_API_URL) throw new Error("config.json missing AUTH_API_URL");
  if (!LIFF_ID) throw new Error("config.json missing LIFF_ID");

  return cfg;
}

/**
 * 呼叫 AUTH API（text/plain + JSON 字串）。
 * - 這裡沿用既有 GAS 設定：Content-Type 使用 text/plain
 * @param {Object} bodyObj
 */
async function authPost_(bodyObj) {
  const res = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj),
  });
  return await res.json().catch(() => ({}));
}

/**
 * 呼叫 ADMIN API（text/plain + JSON 字串）。
 * - mode: listAdmins | updateAdminsBatch | deleteAdmin
 * @param {Object} bodyObj
 */
async function apiPost_(bodyObj) {
  const res = await fetch(ADMIN_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj),
  });
  return await res.json().catch(() => ({}));
}
