/**
 * config.js
 *
 * 負責讀取 ./config.json（以 index.html 的 URL 為基準），並把設定集中到 config 物件。
 * 其他模組只要 import { config } 就能取用。
 */

const CONFIG_JSON_URL = "./config.json";

export const config = {
  /** Edge 狀態讀取用的 GAS Web App URL 清單（會先經 sanitizeEdgeUrls 清理/去重）。 */
  EDGE_STATUS_URLS: [],

  /** 所有 Edge 端點失效時使用的後備（Origin Cache）GAS URL。 */
  FALLBACK_ORIGIN_CACHE_URL: "",

  /** 權限驗證用 GAS API：支援 check / register / getPersonalStatus 等 mode。 */
  AUTH_API_URL: "",

  /** LINE LIFF 應用程式 ID（給 liff.init({ liffId }) 使用）。 */
  LIFF_ID: "",

  /** 是否啟用 LINE LIFF 登入流程（false 時走 No-LIFF 模式，方便測試）。 */
  ENABLE_LINE_LOGIN: true,

  // （可選）使用頻率紀錄
  /** （可選）使用頻率紀錄用 GAS Web App URL；留空則不送出任何使用紀錄。 */
  USAGE_LOG_URL: "",

  /** （可選）同一 userId 最小送出間隔（毫秒）；避免重整/回前景狂送。 */
  USAGE_LOG_MIN_INTERVAL_MS: 30 * 60 * 1000,
};

/**
 * 載入並套用 ./config.json 到 `config` 物件。
 * - 會做基本型別轉換與 trim
 * - 會檢查必要欄位是否存在（缺少則丟 Error）
 *
 * @returns {Promise<void>} 載入成功則 resolve；失敗會 throw。
 */
export async function loadConfigJson() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();

  const edges = Array.isArray(cfg.EDGE_STATUS_URLS) ? cfg.EDGE_STATUS_URLS : [];
  config.EDGE_STATUS_URLS = edges.map((u) => String(u || "").trim()).filter(Boolean);

  config.FALLBACK_ORIGIN_CACHE_URL = String(cfg.FALLBACK_ORIGIN_CACHE_URL || "").trim();
  config.AUTH_API_URL = String(cfg.AUTH_API_URL || "").trim();
  config.LIFF_ID = String(cfg.LIFF_ID || "").trim();
  config.ENABLE_LINE_LOGIN = Boolean(cfg.ENABLE_LINE_LOGIN);

  // optional: usage log
  config.USAGE_LOG_URL = String(cfg.USAGE_LOG_URL || "").trim();
  const minMs = Number(cfg.USAGE_LOG_MIN_INTERVAL_MS);
  if (!Number.isNaN(minMs) && minMs > 0) config.USAGE_LOG_MIN_INTERVAL_MS = minMs;

  if (config.ENABLE_LINE_LOGIN && !config.LIFF_ID) throw new Error("CONFIG_LIFF_ID_MISSING");
  if (!config.AUTH_API_URL) throw new Error("CONFIG_AUTH_API_URL_MISSING");
  if (!config.FALLBACK_ORIGIN_CACHE_URL) throw new Error("CONFIG_FALLBACK_ORIGIN_CACHE_URL_MISSING");
  if (!config.EDGE_STATUS_URLS.length) throw new Error("CONFIG_EDGE_STATUS_URLS_EMPTY");
}

/**
 * Edge URL 清理：
 * - 去重
 * - 只接受 script.google.com/macros/s/.../exec
 */
export function sanitizeEdgeUrls() {
  const seen = new Set();

  config.EDGE_STATUS_URLS = (config.EDGE_STATUS_URLS || [])
    .map((u) => String(u || "").trim())
    .filter((u) => u && u.startsWith("https://script.google.com/macros/s/") && u.includes("/exec"))
    .filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });

  if (!config.EDGE_STATUS_URLS.length) console.warn("[EdgeURL] EDGE_STATUS_URLS empty; fallback only");
}
