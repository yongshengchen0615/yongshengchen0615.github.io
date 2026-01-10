import { config } from "./config.js";

function buildUrl(params) {
  const base = String(config.DATE_DB_ENDPOINT || "").trim();
  const qs = new URLSearchParams(params || {}).toString();
  return qs ? (base.includes("?") ? base + "&" + qs : base + "?" + qs) : base;
}

async function fetchJson(url, opts = {}) {
  let resp;
  try {
    resp = await fetch(url, { cache: "no-store", ...opts });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    throw new Error(`FETCH_FAILED ${String(url || "").slice(0, 200)} ${msg}`);
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`NON_JSON ${text.slice(0, 200)}`);
  }
}

async function postJsonNoCorsPreflight(url, payload) {
  const endpoint = String(url || "").trim();
  let resp;
  try {
    resp = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify(payload || {}),
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    throw new Error(`FETCH_FAILED ${endpoint} ${msg}`);
  }

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

/**
 * 列出客人審核申請。
 * 預期 GAS 支援：POST { entity:"auth", action:"requests_list", data:{ masterId, passphrase, status? } }
 */
export async function listReviewRequests({ masterId, passphrase, status }) {
  const payload = {
    entity: "auth",
    action: "requests_list",
    data: {
      masterId: String(masterId || "").trim(),
      passphrase: String(passphrase || ""),
      status: String(status || "pending").trim() || "pending",
    },
  };
  return await postJsonNoCorsPreflight(config.AUTH_ENDPOINT || config.DATE_DB_ENDPOINT, payload);
}

/**
 * 通過申請並取得一次性 token。
 * 注意：token 本身可長期有效；兌換後的 session 亦為長期有效，除非師傅撤銷。
 * 預期 GAS 支援：POST { entity:"auth", action:"requests_approve", data:{ masterId, passphrase, requestId } }
 */
export async function approveReviewRequest({ masterId, passphrase, requestId, dashboardUrl }) {
  const payload = {
    entity: "auth",
    action: "requests_approve",
    data: {
      masterId: String(masterId || "").trim(),
      passphrase: String(passphrase || ""),
      requestId: String(requestId || "").trim(),
      dashboardUrl: String(dashboardUrl || "").trim(),
    },
  };
  return await postJsonNoCorsPreflight(config.AUTH_ENDPOINT || config.DATE_DB_ENDPOINT, payload);
}

/**
 * 拒絕申請。
 * 預期 GAS 支援：POST { entity:"auth", action:"requests_deny", data:{ masterId, passphrase, requestId } }
 */
export async function denyReviewRequest({ masterId, passphrase, requestId }) {
  const payload = {
    entity: "auth",
    action: "requests_deny",
    data: {
      masterId: String(masterId || "").trim(),
      passphrase: String(passphrase || ""),
      requestId: String(requestId || "").trim(),
    },
  };
  return await postJsonNoCorsPreflight(config.AUTH_ENDPOINT || config.DATE_DB_ENDPOINT, payload);
}

/**
 * 刪除（禁止）已通過客人：撤銷 session 並刪除該筆 request。
 * 預期 GAS 支援：POST { entity:"auth", action:"requests_delete", data:{ masterId, passphrase, requestId } }
 */
export async function deleteReviewRequest({ masterId, passphrase, requestId }) {
  const payload = {
    entity: "auth",
    action: "requests_delete",
    data: {
      masterId: String(masterId || "").trim(),
      passphrase: String(passphrase || ""),
      requestId: String(requestId || "").trim(),
    },
  };
  return await postJsonNoCorsPreflight(config.AUTH_ENDPOINT || config.DATE_DB_ENDPOINT, payload);
}
