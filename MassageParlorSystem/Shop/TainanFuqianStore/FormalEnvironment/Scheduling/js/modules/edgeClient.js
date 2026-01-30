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
import { logUsageEvent } from "./usageLog.js";

const EDGE_TRY_MAX = 3;
const EDGE_FAIL_THRESHOLD = 2;
const EDGE_REROUTE_TTL_MS = 30 * 60 * 1000;

const EDGE_ROUTE_KEY = "edge_route_override_v1"; // { idx, exp }
const EDGE_FAIL_KEY = "edge_route_failcount_v1"; // { idx, n, t }

// Keep a stable edge choice for this page session to avoid data flip-flopping
// across different edges (edges may have slightly different cache/update timing).
let sessionEdgeIdx = null;

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

function getStickyEdgeIndex() {
  const n = config.EDGE_STATUS_URLS.length || 0;
  if (!n) return 0;

  const overrideIdx = getOverrideEdgeIndex();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < n) return overrideIdx;

  if (typeof sessionEdgeIdx === "number" && sessionEdgeIdx >= 0 && sessionEdgeIdx < n) return sessionEdgeIdx;

  sessionEdgeIdx = Math.floor(Math.random() * n);
  return sessionEdgeIdx;
}

function buildEdgeTryOrder(startIdx) {
  const n = config.EDGE_STATUS_URLS.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push((startIdx + i) % n);
  return order.slice(0, Math.min(EDGE_TRY_MAX, n));
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const fallbackTimeout = typeof config.STATUS_FETCH_TIMEOUT_MS === "number" ? config.STATUS_FETCH_TIMEOUT_MS : 8000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs || fallbackTimeout);

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

  const baseTimeout = typeof config.STATUS_FETCH_TIMEOUT_MS === "number" ? config.STATUS_FETCH_TIMEOUT_MS : 8000;
  const originExtra = typeof config.STATUS_FETCH_ORIGIN_EXTRA_MS === "number" ? config.STATUS_FETCH_ORIGIN_EXTRA_MS : 4000;

  const startIdx = getStickyEdgeIndex();
  const tryEdgeIdxList = buildEdgeTryOrder(startIdx);

  for (const idx of tryEdgeIdxList) {
    const edgeBase = config.EDGE_STATUS_URLS[idx];
    if (!edgeBase) continue;

    const url = withQuery(edgeBase, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));

    try {
      const data = await fetchJsonWithTimeout(url, baseTimeout);

      const body = Array.isArray(data.body) ? data.body : [];
      const foot = Array.isArray(data.foot) ? data.foot : [];

      // try to obtain a top-level timestamp (edge server time or json meta)
      const dataTs = data.timestamp || (data.bodyMeta && data.bodyMeta.timestamp) || (data.footMeta && data.footMeta.timestamp) || null;

      // annotate rows with a source timestamp when individual rows lack one
      function annotateRows(rows) {
        return (rows || []).map((r) => {
          r = r || {};
          if (!r.timestamp && !r.sourceTs && !r.updatedAt && dataTs) r.sourceTs = dataTs;
          return r;
        });
      }

      const annotatedBody = annotateRows(body);
      const annotatedFoot = annotateRows(foot);

      if (annotatedBody.length === 0 && annotatedFoot.length === 0) throw new Error("EDGE_SHEET_EMPTY");

      resetFailCount();
      return { source: "edge", edgeIdx: idx, bodyRows: annotatedBody, footRows: annotatedFoot, dataTimestamp: dataTs };
    } catch (e) {
      if (idx === startIdx) {
        const n = bumpFailCount(idx);
        if (config.EDGE_STATUS_URLS.length > 1 && n >= EDGE_FAIL_THRESHOLD) {
          const nextIdx = (idx + 1) % config.EDGE_STATUS_URLS.length;

          // 切換分流（sticky reroute）
          logUsageEvent({
            event: "edge_reroute",
            detail: JSON.stringify({ from: idx, to: nextIdx, failCount: n, threshold: EDGE_FAIL_THRESHOLD }),
            eventCn: "Edge分流切換",
          });

          setOverrideEdgeIndex(nextIdx);
        }
      }
    }
  }

  const originUrl = withQuery(config.FALLBACK_ORIGIN_CACHE_URL, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));
  const data = await fetchJsonWithTimeout(originUrl, baseTimeout + originExtra);

  // annotate origin rows similarly
  const originDataTs = data.timestamp || (data.bodyMeta && data.bodyMeta.timestamp) || (data.footMeta && data.footMeta.timestamp) || null;
  function annotateOriginRows(rows) {
    return (rows || []).map((r) => {
      r = r || {};
      if (!r.timestamp && !r.sourceTs && !r.updatedAt && originDataTs) r.sourceTs = originDataTs;
      return r;
    });
  }

  resetFailCount();
  return {
    source: "origin",
    edgeIdx: null,
    bodyRows: annotateOriginRows(Array.isArray(data.body) ? data.body : []),
    footRows: annotateOriginRows(Array.isArray(data.foot) ? data.foot : []),
    dataTimestamp: originDataTs,
  };
}
