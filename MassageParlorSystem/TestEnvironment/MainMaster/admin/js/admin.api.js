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
  API_BASE_URL = String(cfg.API_BASE_URL || "").trim();
  USAGE_LOG_API_URL = String(cfg.USAGE_LOG_API_URL || "").trim();
  TECH_USAGE_LOG_URL = String(cfg.TECH_USAGE_LOG_URL || "").trim();

  if (!ADMIN_API_URL) throw new Error("config.json missing ADMIN_API_URL");
  if (!AUTH_API_URL) throw new Error("config.json missing AUTH_API_URL");
  if (!LIFF_ID) throw new Error("config.json missing LIFF_ID");
  if (!API_BASE_URL) throw new Error("config.json missing API_BASE_URL");

  return cfg;
}

/**
 * 呼叫「技師使用紀錄」GAS（GET querystring）。
 * - 依你提供的 GAS：doGet?mode=log 用來寫入
 * - 顯示列表需 GAS 額外支援 mode=list（回傳 JSON）
 * @param {Record<string, any>} params
 */
async function techUsageLogGet_(params) {
  if (!TECH_USAGE_LOG_URL) return { ok: false, error: "missing TECH_USAGE_LOG_URL" };
  const url = new URL(TECH_USAGE_LOG_URL);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || String(v).trim() === "") return;
    url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), { cache: "no-store" });
  return await res.json().catch(() => ({}));
}

/**
 * 呼叫 UsageLog GAS（text/plain + JSON 字串）。
 * - mode: appendUsageLog | listUsageLog
 * - 若未設定 USAGE_LOG_API_URL，會直接回傳 { ok:false, error:"missing USAGE_LOG_API_URL" }
 * @param {Object} bodyObj
 */
async function usageLogPost_(bodyObj) {
  if (!USAGE_LOG_API_URL) return { ok: false, error: "missing USAGE_LOG_API_URL" };
  const res = await fetch(USAGE_LOG_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj),
  });
  return await res.json().catch(() => ({}));
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
