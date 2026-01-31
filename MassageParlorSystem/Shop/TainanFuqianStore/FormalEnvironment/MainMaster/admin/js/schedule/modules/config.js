const CONFIG_JSON_URL = "./config.json";

export const config = {
  EDGE_STATUS_URLS: [],
  FALLBACK_ORIGIN_CACHE_URL: "",
  AUTH_API_URL: "",
  LIFF_ID: "",
  ENABLE_LINE_LOGIN: true,
  USAGE_LOG_URL: "",
  REPORT_API_URL: "",
  DETAIL_PERF_API_URL: "",
  PERF_SYNC_API_URL: "",
  USAGE_LOG_MIN_INTERVAL_MS: 30 * 60 * 1000,
  POLL_BASE_MS: 3000,
  POLL_MAX_MS: 20000,
  POLL_FAIL_MAX_MS: 60000,
  POLL_STABLE_UP_AFTER: 3,
  POLL_CHANGED_BOOST_MS: 4500,
  POLL_JITTER_RATIO: 0.2,
  POLL_ALLOW_BACKGROUND: false,
  STATUS_FETCH_TIMEOUT_MS: 8000,
  STATUS_FETCH_ORIGIN_EXTRA_MS: 4000,
  STALE_DATA_MAX_AGE_MS: 10 * 60 * 1000,
};

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

  config.USAGE_LOG_URL = String(cfg.USAGE_LOG_URL || "").trim();
  config.REPORT_API_URL = String(cfg.REPORT_API_URL || "").trim();
  config.DETAIL_PERF_API_URL = String(cfg.DETAIL_PERF_API_URL || "").trim();
  config.PERF_SYNC_API_URL = String(cfg.PERF_SYNC_API_URL || "").trim();

  const minMs = Number(cfg.USAGE_LOG_MIN_INTERVAL_MS);
  if (!Number.isNaN(minMs) && minMs > 0) config.USAGE_LOG_MIN_INTERVAL_MS = minMs;

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

  const allowBgRaw = cfg.POLL_ALLOW_BACKGROUND;
  if (typeof allowBgRaw === "boolean") config.POLL_ALLOW_BACKGROUND = allowBgRaw;
  else if (typeof allowBgRaw === "string") config.POLL_ALLOW_BACKGROUND = allowBgRaw.trim() === "是";
  else if (typeof allowBgRaw === "number") config.POLL_ALLOW_BACKGROUND = allowBgRaw === 1;

  const fetchTimeout = Number(cfg.STATUS_FETCH_TIMEOUT_MS);
  if (!Number.isNaN(fetchTimeout) && fetchTimeout >= 1000) config.STATUS_FETCH_TIMEOUT_MS = fetchTimeout;

  const originExtra = Number(cfg.STATUS_FETCH_ORIGIN_EXTRA_MS);
  if (!Number.isNaN(originExtra) && originExtra >= 0) config.STATUS_FETCH_ORIGIN_EXTRA_MS = originExtra;

  const staleMaxAge = Number(cfg.STALE_DATA_MAX_AGE_MS);
  if (!Number.isNaN(staleMaxAge)) config.STALE_DATA_MAX_AGE_MS = staleMaxAge;

  // In admin integration, config keys may differ. Do not throw on missing optional fields.
  // Map common admin keys if present.
  if (!config.USAGE_LOG_URL && typeof cfg.USAGE_LOG_API_URL === "string") config.USAGE_LOG_URL = String(cfg.USAGE_LOG_API_URL).trim();
  if (!config.AUTH_API_URL && typeof cfg.AUTH_API_URL === "string") config.AUTH_API_URL = String(cfg.AUTH_API_URL).trim();
  if (!config.FALLBACK_ORIGIN_CACHE_URL && typeof cfg.FALLBACK_ORIGIN_CACHE_URL === "string") config.FALLBACK_ORIGIN_CACHE_URL = String(cfg.FALLBACK_ORIGIN_CACHE_URL).trim();
  // EDGE_STATUS_URLS may be absent; leave empty and allow fallback behavior.
}

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
