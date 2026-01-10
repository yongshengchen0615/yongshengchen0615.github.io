import { config } from "./config.js";

function buildUrl(params) {
  const base = String(config.DATE_DB_ENDPOINT || "").trim();
  const qs = new URLSearchParams(params || {}).toString();
  return qs ? (base.includes("?") ? base + "&" + qs : base + "?" + qs) : base;
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, { cache: "no-store", ...opts });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`NON_JSON ${text.slice(0, 200)}`);
  }
}

/**
 * 讀取日期類型資料。
 * 預期 GAS 支援：GET ?entity=datetypes&action=list
 */
export async function listDateTypes() {
  const url = buildUrl({ entity: "datetypes", action: "list", _cors: "1" });
  return await fetchJson(url, { method: "GET" });
}

/**
 * 批次套用變更（只用 holiday）。
 * 預期 GAS 支援：POST { entity:"batch", action:"apply", data:{ datetypes:{add:[], del:[]} } }
 */
export async function applyHolidayBatch({ add, del }) {
  const payload = {
    entity: "batch",
    action: "apply",
    data: {
      datetypes: {
        add: Array.isArray(add) ? add : [],
        del: Array.isArray(del) ? del : [],
      },
    },
  };

  return await fetchJson(config.DATE_DB_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
