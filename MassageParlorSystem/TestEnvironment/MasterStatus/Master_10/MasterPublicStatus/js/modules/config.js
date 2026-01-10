import { withQuery, normalizeTechNo } from "./core.js";

const CONFIG_JSON_URL = "./config.json";

export const config = {
  TARGET_TECH_NO: "",
  EDGE_STATUS_URLS: [],
  FALLBACK_ORIGIN_CACHE_URL: "",
  VACATION_DATE_DB_ENDPOINT: "",
  STATUS_FETCH_TIMEOUT_MS: 8000,
};

export async function loadConfig() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();

  config.TARGET_TECH_NO = normalizeTechNo(cfg.TARGET_TECH_NO);

  const edges = Array.isArray(cfg.EDGE_STATUS_URLS) ? cfg.EDGE_STATUS_URLS : [];
  config.EDGE_STATUS_URLS = edges.map((u) => String(u || "").trim()).filter(Boolean);
  config.FALLBACK_ORIGIN_CACHE_URL = String(cfg.FALLBACK_ORIGIN_CACHE_URL || "").trim();
  config.VACATION_DATE_DB_ENDPOINT = String(cfg.VACATION_DATE_DB_ENDPOINT || "").trim();

  const t = Number(cfg.STATUS_FETCH_TIMEOUT_MS);
  if (!Number.isNaN(t) && t >= 1000) config.STATUS_FETCH_TIMEOUT_MS = t;

  sanitizeEdgeUrls();

  if (!config.TARGET_TECH_NO) throw new Error("CONFIG_TARGET_TECH_NO_MISSING");
  if (!/^https:\/\/script.google.com\/.+\/exec$/.test(config.VACATION_DATE_DB_ENDPOINT)) {
    throw new Error("CONFIG_VACATION_DATE_DB_ENDPOINT_INVALID");
  }

  if (!config.FALLBACK_ORIGIN_CACHE_URL) throw new Error("CONFIG_FALLBACK_ORIGIN_CACHE_URL_MISSING");
  if (!config.EDGE_STATUS_URLS.length) throw new Error("CONFIG_EDGE_STATUS_URLS_EMPTY");
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
}

export function buildSheetAllUrl(baseUrl) {
  const jitterBust = Date.now();
  return withQuery(baseUrl, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));
}

export function buildDateTypesListUrl() {
  const base = String(config.VACATION_DATE_DB_ENDPOINT || "").trim();
  const qs = new URLSearchParams({ entity: "datetypes", action: "list", _cors: "1" }).toString();
  return withQuery(base, qs);
}
