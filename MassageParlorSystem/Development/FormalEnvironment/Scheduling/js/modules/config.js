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

  // （可選）輪詢/效能調校（不填則使用預設值）
  /** 輪詢基本間隔（毫秒）。 */
  POLL_BASE_MS: 3000,
  /** 輪詢最大間隔（毫秒）。 */
  POLL_MAX_MS: 20000,
  /** 失敗退避最大間隔（毫秒）。 */
  POLL_FAIL_MAX_MS: 60000,
  /** 連續成功幾次後開始放慢。 */
  POLL_STABLE_UP_AFTER: 3,
  /** 偵測到資料變更時的下一次輪詢間隔（毫秒）。 */
  POLL_CHANGED_BOOST_MS: 4500,
  /** 輪詢抖動比例（0~1）。 */
  POLL_JITTER_RATIO: 0.2,

  /** 單次狀態抓取 timeout（毫秒）。 */
  STATUS_FETCH_TIMEOUT_MS: 8000,
  /** Origin fallback 額外 timeout（毫秒）。 */
  STATUS_FETCH_ORIGIN_EXTRA_MS: 4000,
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

  // optional: polling & fetch tuning
  const pollBase = Number(cfg.POLL_BASE_MS);
  if (!Number.isNaN(pollBase) && pollBase >= 800) config.POLL_BASE_MS = pollBase;

  const pollMax = Number(cfg.POLL_MAX_MS);
  if (!Number.isNaN(pollMax) && pollMax >= config.POLL_BASE_MS) config.POLL_MAX_MS = pollMax;

  const pollFailMax = Number(cfg.POLL_FAIL_MAX_MS);
  if (!Number.isNaN(pollFailMax) && pollFailMax >= config.POLL_BASE_MS) config.POLL_FAIL_MAX_MS = pollFailMax;

  const stableUpAfter = Number(cfg.POLL_STABLE_UP_AFTER);
  if (!Number.isNaN(stableUpAfter) && stableUpAfter >= 1) config.POLL_STABLE_UP_AFTER = stableUpAfter;

  const changedBoost = Number(cfg.POLL_CHANGED_BOOST_MS);
  if (!Number.isNaN(changedBoost) && changedBoost >= config.POLL_BASE_MS) config.POLL_CHANGED_BOOST_MS = changedBoost;

  const jitterRatio = Number(cfg.POLL_JITTER_RATIO);
  if (!Number.isNaN(jitterRatio) && jitterRatio >= 0 && jitterRatio <= 1) config.POLL_JITTER_RATIO = jitterRatio;

  const fetchTimeout = Number(cfg.STATUS_FETCH_TIMEOUT_MS);
  if (!Number.isNaN(fetchTimeout) && fetchTimeout >= 1000) config.STATUS_FETCH_TIMEOUT_MS = fetchTimeout;

  const originExtra = Number(cfg.STATUS_FETCH_ORIGIN_EXTRA_MS);
  if (!Number.isNaN(originExtra) && originExtra >= 0) config.STATUS_FETCH_ORIGIN_EXTRA_MS = originExtra;

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
