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

// Edge cooldown (avoid repeatedly hitting an unhealthy edge)
const EDGE_COOLDOWN_KEY = "edge_cooldown_v1"; // { byUrl: { [url]: expMs } }
const EDGE_COOLDOWN_MS = 2 * 60 * 1000;

const EDGE_ROUTE_KEY = "edge_route_override_v1"; // { idx, exp }
const EDGE_FAIL_KEY = "edge_route_failcount_v1"; // { idx, n, t }

// Edge RTT tracking (best-effort): { byUrl: { [url]: { rttEwma:number, t:number } } }
const EDGE_PERF_KEY = "edge_perf_v1";
const EDGE_PERF_TTL_MS = 12 * 60 * 60 * 1000;
const EDGE_RTT_EWMA_ALPHA = 0.25;

// Keep a stable edge choice for this page session to avoid data flip-flopping
// across different edges (edges may have slightly different cache/update timing).
let sessionEdgeIdx = null;

// Status snapshot cache (for faster initial paint)
const STATUS_SNAPSHOT_KEY = "status_snapshot_v1"; // { t, source, edgeIdx, dataTimestamp, bodyRows, footRows }
const STATUS_SNAPSHOT_DEFAULT_MAX_AGE_MS = 2 * 60 * 1000;
let statusSnapshotMem_ = null;

let fetchAllInFlight_ = null;

let hasEverFetched_ = false;

function readEdgePerf_() {
  const s = readJsonLS(EDGE_PERF_KEY);
  if (!s || typeof s !== "object") return { byUrl: {} };
  if (!s.byUrl || typeof s.byUrl !== "object") return { byUrl: {} };
  return s;
}

function writeEdgePerf_(v) {
  try {
    writeJsonLS(EDGE_PERF_KEY, v);
  } catch {
    // ignore
  }
}

function recordEdgeRtt_(edgeBase, rttMs) {
  const url = String(edgeBase || "").trim();
  const rtt = Math.max(1, Math.floor(Number(rttMs) || 0));
  if (!url || !Number.isFinite(rtt) || rtt <= 0) return;

  const now = Date.now();
  const s = readEdgePerf_();
  const cur = (s.byUrl && s.byUrl[url]) || null;
  const prevEwma = cur && Number.isFinite(Number(cur.rttEwma)) ? Number(cur.rttEwma) : null;
  const ewma = prevEwma === null ? rtt : Math.round(prevEwma * (1 - EDGE_RTT_EWMA_ALPHA) + rtt * EDGE_RTT_EWMA_ALPHA);

  s.byUrl = s.byUrl || {};
  s.byUrl[url] = { rttEwma: ewma, t: now };

  // best-effort cleanup (bounded)
  try {
    const keys = Object.keys(s.byUrl);
    if (keys.length > 60) {
      // remove oldest
      keys
        .map((k) => ({ k, t: Number(s.byUrl[k] && s.byUrl[k].t) || 0 }))
        .sort((a, b) => a.t - b.t)
        .slice(0, Math.max(0, keys.length - 60))
        .forEach((x) => {
          try {
            delete s.byUrl[x.k];
          } catch {}
        });
    }
  } catch {}

  writeEdgePerf_(s);
}

function getBestEdgeIndex_() {
  const urls = Array.isArray(config.EDGE_STATUS_URLS) ? config.EDGE_STATUS_URLS : [];
  const n = urls.length || 0;
  if (!n) return 0;

  const overrideIdx = getOverrideEdgeIndex();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < n) return overrideIdx;

  const s = readEdgePerf_();
  const now = Date.now();
  let bestIdx = null;
  let bestRtt = null;

  for (let i = 0; i < n; i++) {
    const u = String(urls[i] || "").trim();
    if (!u) continue;
    const e = s.byUrl && s.byUrl[u];
    if (!e) continue;
    const age = now - Number(e.t || 0);
    const rtt = Number(e.rttEwma);
    if (!Number.isFinite(rtt) || rtt <= 0) continue;
    if (Number.isFinite(age) && age > EDGE_PERF_TTL_MS) continue;

    if (bestRtt === null || rtt < bestRtt) {
      bestRtt = rtt;
      bestIdx = i;
    }
  }

  if (typeof bestIdx === "number") return bestIdx;
  return Math.floor(Math.random() * n);
}

function safeReadSnapshot_() {
  if (statusSnapshotMem_ && typeof statusSnapshotMem_.t === "number") return statusSnapshotMem_;
  const s = readJsonLS(STATUS_SNAPSHOT_KEY);
  if (!s || typeof s.t !== "number") return null;
  statusSnapshotMem_ = s;
  return s;
}

function safeWriteSnapshot_(snap) {
  try {
    statusSnapshotMem_ = snap;
    writeJsonLS(STATUS_SNAPSHOT_KEY, snap);
  } catch {
    // ignore
  }
}

/**
 * 取得最近一次成功的快取快照（若仍在有效時間內）。
 * - 用於初次進入時先顯示「上一筆資料」，再背景同步最新。
 */
export function getCachedStatusSnapshot({ maxAgeMs } = {}) {
  const snap = safeReadSnapshot_();
  if (!snap) return null;
  const age = Date.now() - Number(snap.t || 0);
  const limit = Number.isFinite(Number(maxAgeMs)) ? Number(maxAgeMs) : STATUS_SNAPSHOT_DEFAULT_MAX_AGE_MS;
  if (limit > 0 && age > limit) return null;
  if (!Array.isArray(snap.bodyRows) || !Array.isArray(snap.footRows)) return null;
  return snap;
}

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

function readCooldown_() {
  const s = readJsonLS(EDGE_COOLDOWN_KEY);
  if (!s || typeof s !== "object" || !s.byUrl || typeof s.byUrl !== "object") return { byUrl: {} };
  return s;
}

function setCooldown_(edgeBase, ms) {
  const u = String(edgeBase || "").trim();
  if (!u) return;
  const now = Date.now();
  const exp = now + Math.max(0, Number(ms) || 0);
  const s = readCooldown_();
  s.byUrl = s.byUrl || {};
  s.byUrl[u] = exp;
  writeJsonLS(EDGE_COOLDOWN_KEY, s);
}

function isCooled_(edgeBase) {
  const u = String(edgeBase || "").trim();
  if (!u) return false;
  const s = readCooldown_();
  const exp = Number(s.byUrl && s.byUrl[u]);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  return Date.now() < exp;
}

function resetFailCount() {
  localStorage.removeItem(EDGE_FAIL_KEY);
}

function getRandomEdgeIndex() {
  const n = config.EDGE_STATUS_URLS.length || 0;
  if (!n) return 0;

  const overrideIdx = getOverrideEdgeIndex();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < n) return overrideIdx;

  return getBestEdgeIndex_();
}

function getStickyEdgeIndex() {
  const n = config.EDGE_STATUS_URLS.length || 0;
  if (!n) return 0;

  const overrideIdx = getOverrideEdgeIndex();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < n) return overrideIdx;

  if (typeof sessionEdgeIdx === "number" && sessionEdgeIdx >= 0 && sessionEdgeIdx < n) return sessionEdgeIdx;

  sessionEdgeIdx = getBestEdgeIndex_();
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

    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);
      err.httpStatus = resp.status;
      throw err;
    }

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

function shouldUseHedge_({ isManual } = {}) {
  // Hedge only when user-facing latency matters; keep background polling light.
  if (document.hidden && !config.POLL_ALLOW_BACKGROUND) return false;
  if (config.STATUS_FETCH_HEDGE_ENABLED === false) return false;
  if (isManual) return true;
  // First ever fetch on this page load: speed up initial sync.
  if (!hasEverFetched_) return true;
  return false;
}

function getHedgeCfg_() {
  const delayMs = Number(config.STATUS_FETCH_HEDGE_DELAY_MS);
  const maxParallel = Number(config.STATUS_FETCH_HEDGE_MAX_PARALLEL);
  return {
    delayMs: !Number.isNaN(delayMs) && delayMs >= 0 ? delayMs : 450,
    maxParallel: !Number.isNaN(maxParallel) && maxParallel >= 1 ? Math.min(3, Math.floor(maxParallel)) : 2,
  };
}

async function fetchEdgeOne_(idx, baseTimeout, jitterBust) {
  const edgeBase = config.EDGE_STATUS_URLS[idx];
  if (!edgeBase) return { ok: false, idx, err: new Error("EDGE_URL_MISSING") };

  const url = withQuery(edgeBase, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));
  const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  try {
    const data = await fetchJsonWithTimeout(url, baseTimeout);
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const rttMs = Math.max(1, Math.round(t1 - t0));
    recordEdgeRtt_(edgeBase, rttMs);
    return { ok: true, idx, edgeBase, data };
  } catch (e) {
    // Mark the edge as temporarily unhealthy for retry storms.
    try {
      const name = String(e && e.name);
      const hs = Number(e && e.httpStatus);
      const isTimeout = name === "AbortError";
      const isServer = Number.isFinite(hs) && (hs === 429 || (hs >= 500 && hs <= 599));
      if (isTimeout || isServer) setCooldown_(edgeBase, EDGE_COOLDOWN_MS);
    } catch {}
    return { ok: false, idx, edgeBase, err: e };
  }
}

async function fetchEdgesHedged_(tryEdgeIdxList, baseTimeout, jitterBust) {
  const cfg = getHedgeCfg_();
  const remaining = Array.isArray(tryEdgeIdxList) ? [...tryEdgeIdxList] : [];
  const inFlight = [];

  function startNext_() {
    if (!remaining.length) return;
    if (inFlight.length >= cfg.maxParallel) return;
    const idx = remaining.shift();
    const p = fetchEdgeOne_(idx, baseTimeout, jitterBust);
    inFlight.push(p);
  }

  // Always start first.
  startNext_();

  // Start the 2nd after a short delay to cut tail latency.
  let hedgeTimer = null;
  if (cfg.delayMs >= 0) {
    hedgeTimer = setTimeout(() => {
      try {
        startNext_();
      } catch {
        // ignore
      }
    }, cfg.delayMs);
  }

  let lastErr = null;
  try {
    while (inFlight.length) {
      // Track which promise finished so we can remove it.
      const tracked = inFlight.map((p) => p.then((v) => ({ v, p })));
      const { v, p } = await Promise.race(tracked);
      const i = inFlight.indexOf(p);
      if (i >= 0) inFlight.splice(i, 1);

      if (v && v.ok) return v;
      lastErr = (v && v.err) || lastErr;

      // Keep pipeline full.
      startNext_();
    }
  } finally {
    if (hedgeTimer) clearTimeout(hedgeTimer);
  }

  throw lastErr || new Error("EDGE_ALL_FAILED");
}

async function doFetchStatusAll_({ isManual } = {}) {
  const jitterBust = Date.now();

  const baseTimeout = typeof config.STATUS_FETCH_TIMEOUT_MS === "number" ? config.STATUS_FETCH_TIMEOUT_MS : 8000;
  const originExtra = typeof config.STATUS_FETCH_ORIGIN_EXTRA_MS === "number" ? config.STATUS_FETCH_ORIGIN_EXTRA_MS : 4000;

  const startIdx = getStickyEdgeIndex();
  const tryEdgeIdxListAll = buildEdgeTryOrder(startIdx);
  const tryEdgeIdxList = (() => {
    try {
      const filtered = tryEdgeIdxListAll.filter((idx) => {
        const u = config.EDGE_STATUS_URLS[idx];
        return u && !isCooled_(u);
      });
      return filtered.length ? filtered : tryEdgeIdxListAll;
    } catch {
      return tryEdgeIdxListAll;
    }
  })();

  const normalizeEdgeData_ = (idx, data) => {
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

    return { source: "edge", edgeIdx: idx, bodyRows: annotatedBody, footRows: annotatedFoot, dataTimestamp: dataTs };
  };

  if (shouldUseHedge_({ isManual }) && tryEdgeIdxList.length >= 2) {
    try {
      const win = await fetchEdgesHedged_(tryEdgeIdxList, baseTimeout, jitterBust);
      resetFailCount();
      return normalizeEdgeData_(win.idx, win.data);
    } catch (e) {
      // fall through to sequential attempt + origin
    }
  }

  for (const idx of tryEdgeIdxList) {
    const out = await fetchEdgeOne_(idx, baseTimeout, jitterBust);
    if (out && out.ok) {
      try {
        resetFailCount();
        return normalizeEdgeData_(idx, out.data);
      } catch (e) {
        // Treat as edge failure and continue.
      }
    }

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
export async function fetchStatusAll({ force, isManual } = {}) {
  if (!force && fetchAllInFlight_) return fetchAllInFlight_;

  fetchAllInFlight_ = (async () => {
    const res = await doFetchStatusAll_({ isManual: !!isManual });
    hasEverFetched_ = true;
    // persist snapshot for fast initial paint
    try {
      safeWriteSnapshot_({
        t: Date.now(),
        source: res.source,
        edgeIdx: res.edgeIdx,
        dataTimestamp: res.dataTimestamp || null,
        bodyRows: Array.isArray(res.bodyRows) ? res.bodyRows : [],
        footRows: Array.isArray(res.footRows) ? res.footRows : [],
      });
    } catch {
      // ignore
    }
    return res;
  })();

  try {
    return await fetchAllInFlight_;
  } finally {
    fetchAllInFlight_ = null;
  }
}
