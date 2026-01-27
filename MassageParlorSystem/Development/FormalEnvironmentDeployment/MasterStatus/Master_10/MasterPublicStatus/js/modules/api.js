import { config, buildSheetAllUrl, buildDateTypesListUrl } from "./config.js";

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`NON_JSON ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

function pickEdgeTryOrder(urls) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!list.length) return [];
  const start = Math.floor(Math.random() * list.length);
  const order = [];
  for (let i = 0; i < list.length; i++) order.push(list[(start + i) % list.length]);
  return order;
}

export async function fetchSheetAll() {
  const timeout = typeof config.STATUS_FETCH_TIMEOUT_MS === "number" ? config.STATUS_FETCH_TIMEOUT_MS : 8000;

  // Try edges first
  for (const edgeBase of pickEdgeTryOrder(config.EDGE_STATUS_URLS)) {
    try {
      const url = buildSheetAllUrl(edgeBase);
      const data = await fetchJsonWithTimeout(url, timeout);

      const body = Array.isArray(data.body) ? data.body : [];
      const foot = Array.isArray(data.foot) ? data.foot : [];
      if (body.length === 0 && foot.length === 0) throw new Error("EDGE_SHEET_EMPTY");

      return { source: "edge", bodyRows: body, footRows: foot };
    } catch (e) {
      // continue
    }
  }

  // Fallback origin cache
  {
    const originUrl = buildSheetAllUrl(config.FALLBACK_ORIGIN_CACHE_URL);
    const data = await fetchJsonWithTimeout(originUrl, timeout + 4000);
    return {
      source: "origin",
      bodyRows: Array.isArray(data.body) ? data.body : [],
      footRows: Array.isArray(data.foot) ? data.foot : [],
    };
  }
}

export async function listHolidays() {
  const url = buildDateTypesListUrl();
  const data = await fetchJsonWithTimeout(url, 12000);
  if (!data || data.ok !== true) throw new Error((data && (data.error || data.err)) || "datetypes list not ok");

  const rows = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.rows)
      ? data.rows
      : [];

  const holidays = rows
    .map((r) => ({
      Type: r && (r.Type || r.DateType),
      Date: r && (r.Date || r.date),
    }))
    .filter((r) => String(r.Type || "").trim() === "holiday")
    .map((r) => String(r.Date || "").trim())
    .filter(Boolean);

  // unique + sort
  return Array.from(new Set(holidays)).sort();
}
