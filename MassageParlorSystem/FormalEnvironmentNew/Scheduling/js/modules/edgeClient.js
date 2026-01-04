/**
 * edgeClient.js
 *
 * 負責：
 * - Edge failover + timeout
 * - sticky reroute（記憶失敗的 edge，暫時切到下一個）
 * - 最後才打 fallback origin cache
 */

import { config } from "./config.js";
import { withQuery, readJsonLS, writeJsonLS } from "./core.js";

const STATUS_FETCH_TIMEOUT_MS = 8000;
const EDGE_TRY_MAX = 3;
const EDGE_FAIL_THRESHOLD = 2;
const EDGE_REROUTE_TTL_MS = 30 * 60 * 1000;

const EDGE_ROUTE_KEY = "edge_route_override_v1"; // { idx, exp }
const EDGE_FAIL_KEY = "edge_route_failcount_v1"; // { idx, n, t }

function getOverrideEdgeIndex() {
  const o = readJsonLS(EDGE_ROUTE_KEY);
  if (!o || typeof o.idx !== "number") return null;
  if (typeof o.exp === "number" && Date.now() > o.exp) {
    localStorage.removeItem(EDGE_ROUTE_KEY);
    return null;
  }
  return o.idx;
}

function setOverrideEdgeIndex(idx) {
  writeJsonLS(EDGE_ROUTE_KEY, { idx, exp: Date.now() + EDGE_REROUTE_TTL_MS });
}

function bumpFailCount(idx) {
  const s = readJsonLS(EDGE_FAIL_KEY) || {};
  const sameIdx = s && s.idx === idx;
  const n = sameIdx ? Number(s.n || 0) + 1 : 1;
  writeJsonLS(EDGE_FAIL_KEY, { idx, n, t: Date.now() });
  return n;
}

function resetFailCount() {
  localStorage.removeItem(EDGE_FAIL_KEY);
}

function getRandomEdgeIndex() {
  const n = config.EDGE_STATUS_URLS.length || 0;
  if (!n) return 0;

  const overrideIdx = getOverrideEdgeIndex();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < n) return overrideIdx;

  return Math.floor(Math.random() * n);
}

function buildEdgeTryOrder(startIdx) {
  const n = config.EDGE_STATUS_URLS.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push((startIdx + i) % n);
  return order.slice(0, Math.min(EDGE_TRY_MAX, n));
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || STATUS_FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
    const text = await resp.text();

    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`NON_JSON ${text.slice(0, 160)}`);
    }

    if (json && json.ok === false) throw new Error(`NOT_OK ${json.err || json.error || "response not ok"}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 取得身體/腳底面板資料（含 failover）
 * - 會先嘗試 Edge（多個端點 + timeout + sticky reroute）
 * - Edge 全部失敗才打 fallback origin cache
 *
 * 回傳格式固定：
 * - source: "edge" | "origin"（資料來源）
 * - edgeIdx: number | null（使用的 edge 索引；origin 時為 null）
 * - bodyRows / footRows: Array（原始列資料）
 *
 * @returns {Promise<{source:"edge"|"origin", edgeIdx:number|null, bodyRows:any[], footRows:any[]}>}
 */
export async function fetchStatusAll() {
  const jitterBust = Date.now();

  const startIdx = getRandomEdgeIndex();
  const tryEdgeIdxList = buildEdgeTryOrder(startIdx);

  for (const idx of tryEdgeIdxList) {
    const edgeBase = config.EDGE_STATUS_URLS[idx];
    if (!edgeBase) continue;

    const url = withQuery(edgeBase, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));

    try {
      const data = await fetchJsonWithTimeout(url, STATUS_FETCH_TIMEOUT_MS);

      const body = Array.isArray(data.body) ? data.body : [];
      const foot = Array.isArray(data.foot) ? data.foot : [];

      if (body.length === 0 && foot.length === 0) throw new Error("EDGE_SHEET_EMPTY");

      resetFailCount();
      return { source: "edge", edgeIdx: idx, bodyRows: body, footRows: foot };
    } catch (e) {
      if (idx === startIdx) {
        const n = bumpFailCount(idx);
        if (config.EDGE_STATUS_URLS.length > 1 && n >= EDGE_FAIL_THRESHOLD) {
          const nextIdx = (idx + 1) % config.EDGE_STATUS_URLS.length;
          setOverrideEdgeIndex(nextIdx);
        }
      }
    }
  }

  const originUrl = withQuery(config.FALLBACK_ORIGIN_CACHE_URL, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));
  const data = await fetchJsonWithTimeout(originUrl, STATUS_FETCH_TIMEOUT_MS + 4000);

  resetFailCount();
  return {
    source: "origin",
    edgeIdx: null,
    bodyRows: Array.isArray(data.body) ? data.body : [],
    footRows: Array.isArray(data.foot) ? data.foot : [],
  };
}
