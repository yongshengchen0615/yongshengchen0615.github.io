import { withQuery, normalizeTechNo } from "./core.js";

const CONFIG_JSON_URL = "./config.json";

export const config = {
  TARGET_TECH_NO: "",
  EDGE_STATUS_URLS: [],
  FALLBACK_ORIGIN_CACHE_URL: "",
  VACATION_DATE_DB_ENDPOINT: "",
  AUTH_ENDPOINT: "",
  STATUS_FETCH_TIMEOUT_MS: 8000,
  LIFF_ID: "",
  LIFF_AUTO_LOGIN: false,
  LIFF_PREFILL_GUEST_NAME: true,
};

function pick_(cfg, key) {
  const v = cfg ? cfg[key] : undefined;
  if (v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, "value")) return v.value;
  return v;
}

export async function loadConfig() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();

  config.TARGET_TECH_NO = normalizeTechNo(pick_(cfg, "TARGET_TECH_NO"));

  const edgesRaw = pick_(cfg, "EDGE_STATUS_URLS");
  const edges = Array.isArray(edgesRaw) ? edgesRaw : [];
  config.EDGE_STATUS_URLS = edges.map((u) => String(u || "").trim()).filter(Boolean);
  config.FALLBACK_ORIGIN_CACHE_URL = String(pick_(cfg, "FALLBACK_ORIGIN_CACHE_URL") || "").trim();
  config.VACATION_DATE_DB_ENDPOINT = String(pick_(cfg, "VACATION_DATE_DB_ENDPOINT") || "").trim();
  config.AUTH_ENDPOINT = String(pick_(cfg, "AUTH_ENDPOINT") || "").trim() || config.VACATION_DATE_DB_ENDPOINT;

  const t = Number(pick_(cfg, "STATUS_FETCH_TIMEOUT_MS"));
  if (!Number.isNaN(t) && t >= 1000) config.STATUS_FETCH_TIMEOUT_MS = t;

  config.LIFF_ID = String(pick_(cfg, "LIFF_ID") || "").trim();
  config.LIFF_AUTO_LOGIN = Boolean(pick_(cfg, "LIFF_AUTO_LOGIN"));
  {
    const v = pick_(cfg, "LIFF_PREFILL_GUEST_NAME");
    config.LIFF_PREFILL_GUEST_NAME = v === undefined ? true : Boolean(v);
  }

  sanitizeEdgeUrls();

  if (!config.TARGET_TECH_NO) throw new Error("CONFIG_TARGET_TECH_NO_MISSING");
  if (!/^https:\/\/script.google.com\/.+\/exec$/.test(config.VACATION_DATE_DB_ENDPOINT)) {
    throw new Error("CONFIG_VACATION_DATE_DB_ENDPOINT_INVALID");
  }

  if (!/^https:\/\/script.google.com\/.+\/exec$/.test(config.AUTH_ENDPOINT)) {
    throw new Error("CONFIG_AUTH_ENDPOINT_INVALID");
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
