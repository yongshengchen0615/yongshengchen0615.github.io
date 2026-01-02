/**
 * config.js
 *
 * 負責讀取 ./config.json（以 index.html 的 URL 為基準），並把設定集中到 config 物件。
 * 其他模組只要 import { config } 就能取用。
 */

const CONFIG_JSON_URL = "./config.json";

export const config = {
  EDGE_STATUS_URLS: [],
  FALLBACK_ORIGIN_CACHE_URL: "",
  AUTH_API_URL: "",
  LIFF_ID: "",
  ENABLE_LINE_LOGIN: true,
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
