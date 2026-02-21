/**
 * config.js
 *
 * 負責讀取 ./config.json（以 index.html 的 URL 為基準），並把設定集中到 config 物件。
 * 其他模組只要 import { config } 就能取用。
 */

const CONFIG_JSON_URL = "./config.json";

const CONFIG_FETCH_TIMEOUT_MS_DEFAULT = 8000;

let configLoadInFlight_ = null;

export const config = {
  /** Edge 狀態讀取用的 GAS Web App URL 清單（會先經 sanitizeEdgeUrls 清理/去重）。 */
  EDGE_STATUS_URLS: [],

  /** 所有 Edge 端點失效時使用的後備（Origin Cache）GAS URL。 */
  FALLBACK_ORIGIN_CACHE_URL: "",

  /** 權限驗證用 GAS API：支援 check / register / getPersonalStatus 等 mode。 */
  AUTH_API_URL: "",

  /** （可選）預約查詢用 GAS Web App URL（bookingQuery_v1）。 */
  BOOKING_API_URL: "",

  /** （可選）儲值序號 GAS Web App URL（TopUp）。若留空則不顯示儲值入口。 */
  TOPUP_API_URL: "",

  /** LINE LIFF 應用程式 ID（給 liff.init({ liffId }) 使用）。 */
  LIFF_ID: "",

  /** 是否啟用 LINE LIFF 登入流程（false 時走 No-LIFF 模式，方便測試）。 */
  ENABLE_LINE_LOGIN: true,

  // （可選）使用頻率紀錄
  /** （可選）使用頻率紀錄用 GAS Web App URL；留空則不送出任何使用紀錄。 */
  USAGE_LOG_URL: "",

  /** （可選）師傅業績查詢用 GAS Web App URL（report Web App）。 */
  REPORT_API_URL: "",

  /** （可選）師傅業績「明細」查詢用 GAS Web App URL（DetailPerf Web App）。 */
  DETAIL_PERF_API_URL: "",

  /** 業績同步（storeId 版）GAS Web App URL */
  PERF_SYNC_API_URL: "",
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

  /** 是否允許在背景（document.hidden=true）時仍嘗試輪詢更新。注意：行動裝置/LINE WebView 可能仍會暫停或降頻。 */
  POLL_ALLOW_BACKGROUND: false,

  /** 單次狀態抓取 timeout（毫秒）。 */
  STATUS_FETCH_TIMEOUT_MS: 8000,
  /** 是否啟用業績圖表（true/false）。預設 true。 */
  ENABLE_PERF_CHARTS: true,
  /** Origin fallback 額外 timeout（毫秒）。 */
  STATUS_FETCH_ORIGIN_EXTRA_MS: 4000,

  /** （可選）是否啟用 hedged requests（同時嘗試第 2 個 edge，降低尾延遲）。 */
  STATUS_FETCH_HEDGE_ENABLED: true,
  /** （可選）啟動第 2 個 edge 的延遲（毫秒）。 */
  STATUS_FETCH_HEDGE_DELAY_MS: 450,
  /** （可選）hedge 最大並行數（建議 2，避免對 GAS 壓力過大）。 */
  STATUS_FETCH_HEDGE_MAX_PARALLEL: 2,

  /**
   * （可選）資料過久未更新的判定門檻（毫秒）。
   * - 以資料列的 timestamp/sourceTs/updatedAt 為準
   * - 設為 0 或負數可停用此判斷
   */
  STALE_DATA_MAX_AGE_MS: 10 * 60 * 1000,

  /** （可選）啟動時載入 config.json 的 timeout（毫秒）。 */
  CONFIG_FETCH_TIMEOUT_MS: CONFIG_FETCH_TIMEOUT_MS_DEFAULT,
};

/**
 * 載入並套用 ./config.json 到 `config` 物件。
 * - 會做基本型別轉換與 trim
 * - 會檢查必要欄位是否存在（缺少則丟 Error）
 *
 * @returns {Promise<void>} 載入成功則 resolve；失敗會 throw。
 */
export async function loadConfigJson() {
  if (configLoadInFlight_) return configLoadInFlight_;

  configLoadInFlight_ = (async () => {
    const ctrl = new AbortController();
    const timeoutMs = Number(config.CONFIG_FETCH_TIMEOUT_MS) || CONFIG_FETCH_TIMEOUT_MS_DEFAULT;
    const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));

    try {
      const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store", signal: ctrl.signal });
      if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

      const cfg = await resp.json();

      const edges = Array.isArray(cfg.EDGE_STATUS_URLS) ? cfg.EDGE_STATUS_URLS : [];
      config.EDGE_STATUS_URLS = edges.map((u) => String(u || "").trim()).filter(Boolean);

      config.FALLBACK_ORIGIN_CACHE_URL = String(cfg.FALLBACK_ORIGIN_CACHE_URL || "").trim();
      config.AUTH_API_URL = String(cfg.AUTH_API_URL || "").trim();
      config.BOOKING_API_URL = String(cfg.BOOKING_API_URL || "").trim();
      config.TOPUP_API_URL = String(cfg.TOPUP_API_URL || "").trim();
      config.LIFF_ID = String(cfg.LIFF_ID || "").trim();

      // ENABLE_LINE_LOGIN 預設為 true；只有在 config.json 明確指定時才覆寫
      const enableLineRaw = cfg.ENABLE_LINE_LOGIN;
      if (typeof enableLineRaw === "boolean") config.ENABLE_LINE_LOGIN = enableLineRaw;
      else if (typeof enableLineRaw === "string") config.ENABLE_LINE_LOGIN = enableLineRaw.trim() === "是";
      else if (typeof enableLineRaw === "number") config.ENABLE_LINE_LOGIN = enableLineRaw === 1;

      // optional: usage log
      config.USAGE_LOG_URL = String(cfg.USAGE_LOG_URL || "").trim();
      config.REPORT_API_URL = String(cfg.REPORT_API_URL || "").trim();
      config.DETAIL_PERF_API_URL = String(cfg.DETAIL_PERF_API_URL || "").trim();
      config.PERF_SYNC_API_URL = String(cfg.PERF_SYNC_API_URL || "").trim();

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

      // optional: allow background polling (best-effort)
      const allowBgRaw = cfg.POLL_ALLOW_BACKGROUND;
      if (typeof allowBgRaw === "boolean") config.POLL_ALLOW_BACKGROUND = allowBgRaw;
      else if (typeof allowBgRaw === "string") config.POLL_ALLOW_BACKGROUND = allowBgRaw.trim() === "是";
      else if (typeof allowBgRaw === "number") config.POLL_ALLOW_BACKGROUND = allowBgRaw === 1;

      const fetchTimeout = Number(cfg.STATUS_FETCH_TIMEOUT_MS);
      if (!Number.isNaN(fetchTimeout) && fetchTimeout >= 1000) config.STATUS_FETCH_TIMEOUT_MS = fetchTimeout;

      const originExtra = Number(cfg.STATUS_FETCH_ORIGIN_EXTRA_MS);
      if (!Number.isNaN(originExtra) && originExtra >= 0) config.STATUS_FETCH_ORIGIN_EXTRA_MS = originExtra;

      // optional: hedged requests
      const hedgeEnabled = cfg.STATUS_FETCH_HEDGE_ENABLED;
      if (typeof hedgeEnabled === "boolean") config.STATUS_FETCH_HEDGE_ENABLED = hedgeEnabled;
      else if (typeof hedgeEnabled === "string") config.STATUS_FETCH_HEDGE_ENABLED = hedgeEnabled.trim() === "是";
      else if (typeof hedgeEnabled === "number") config.STATUS_FETCH_HEDGE_ENABLED = hedgeEnabled === 1;

      const hedgeDelay = Number(cfg.STATUS_FETCH_HEDGE_DELAY_MS);
      if (!Number.isNaN(hedgeDelay) && hedgeDelay >= 0) config.STATUS_FETCH_HEDGE_DELAY_MS = hedgeDelay;

      const hedgeMax = Number(cfg.STATUS_FETCH_HEDGE_MAX_PARALLEL);
      if (!Number.isNaN(hedgeMax) && hedgeMax >= 1) config.STATUS_FETCH_HEDGE_MAX_PARALLEL = Math.min(3, Math.floor(hedgeMax));

      // optional: stale data gate
      const staleMaxAge = Number(cfg.STALE_DATA_MAX_AGE_MS);
      if (!Number.isNaN(staleMaxAge)) config.STALE_DATA_MAX_AGE_MS = staleMaxAge;

      // optional: enable perf charts
      const chartsRaw = cfg.ENABLE_PERF_CHARTS;
      if (typeof chartsRaw === "boolean") config.ENABLE_PERF_CHARTS = chartsRaw;
      else if (typeof chartsRaw === "string") config.ENABLE_PERF_CHARTS = chartsRaw.trim().toLowerCase() === "true" || chartsRaw.trim() === "是";
      else if (typeof chartsRaw === "number") config.ENABLE_PERF_CHARTS = chartsRaw === 1;

      // optional: config fetch timeout
      const cfgTimeout = Number(cfg.CONFIG_FETCH_TIMEOUT_MS);
      if (!Number.isNaN(cfgTimeout) && cfgTimeout >= 1000) config.CONFIG_FETCH_TIMEOUT_MS = cfgTimeout;

      if (config.ENABLE_LINE_LOGIN && !config.LIFF_ID) throw new Error("CONFIG_LIFF_ID_MISSING");
      if (!config.AUTH_API_URL) throw new Error("CONFIG_AUTH_API_URL_MISSING");
      if (!config.FALLBACK_ORIGIN_CACHE_URL) throw new Error("CONFIG_FALLBACK_ORIGIN_CACHE_URL_MISSING");
      if (!config.EDGE_STATUS_URLS.length) throw new Error("CONFIG_EDGE_STATUS_URLS_EMPTY");
    } finally {
      clearTimeout(t);
    }
  })();

  try {
    await configLoadInFlight_;
  } finally {
    configLoadInFlight_ = null;
  }
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
