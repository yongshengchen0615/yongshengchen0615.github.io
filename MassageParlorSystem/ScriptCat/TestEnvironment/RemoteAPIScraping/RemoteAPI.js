// ==UserScript==
// @name         YSPOS Capture (MASTER_COMPLEX + P_DETAIL + P_STATIC) -> GAS + Analyze
// @namespace    https://local/
// @version      3.5
// @description  Capture XHR/fetch on 3 pages (#/master?listStatus=COMPLEX, #/performance?tab=P_DETAIL, #/performance?tab=P_STATIC). Store to NetworkCapture GAS. Also forward /api/performance/total/{storeId} (200 JSON) to Analyze GAS to write summary/items tables.
// @match        https://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  "use strict";

  /*****************************************************************
   * 0) YOU MUST EDIT
   *****************************************************************/
  const GAS_CAPTURE_URL =
    "https://script.google.com/macros/s/AKfycbzAc4BzsBddHhjVEke_uTdDnktv82TTHcxR3KnlQeFOB4EkKaHUixq8Vd8De8vp82mCKw/exec";

  const GAS_ANALYZE_URL =
    "https://script.google.com/macros/s/AKfycbzICSr5W_-R8Ntztuq123rAZKu5GVi4dRqz-nquB64nokAVH414EPj0ZKRnG1I0HKUu/exec";

  /*****************************************************************
   * 1) Capture Rules
   *****************************************************************/
  const CAPTURE_RULES = {
    // ✅ 只抓 /api/（最安全、最不爆）
    urlSubstringsAny: ["/api/"],

    // 非 JSON 是否允許（建議 false，避免大回應爆表）
    allowNonJson: false,

    // 佇列與送出節流
    maxQueuePerFlush: 8,
    flushIntervalMs: 1200,

    // response 截斷（非 JSON 時使用）
    maxTextLen: 12000,

    // 脫敏
    redactSensitiveHeaders: true,

    // Debug
    verbose: true,
  };

  // ✅ 分析轉送開關
  const ENABLE_ANALYZE = true;

  /*****************************************************************
   * 2) Page gate (3 pages)
   *****************************************************************/
  function isTargetPage() {
    const h = String(location.hash || "");

    // 1) Master complex list
    const isMasterComplex = h.startsWith("#/master") && h.includes("listStatus=COMPLEX");

    // 2) Performance P_DETAIL / P_STATIC
    const isPerfDetail = h.startsWith("#/performance") && h.includes("tab=P_DETAIL");
    const isPerfStatic = h.startsWith("#/performance") && h.includes("tab=P_STATIC");

    return isMasterComplex || isPerfDetail || isPerfStatic;
  }

  let ACTIVE = false;
  let FLUSH_TIMER = null;
  let GUARD_TIMER = null;

  function log(...args) {
    if (CAPTURE_RULES.verbose) console.log(...args);
  }
  function warn(...args) {
    console.warn(...args);
  }

  function startIfNeeded() {
    const ok = isTargetPage();
    if (ok && !ACTIVE) {
      ACTIVE = true;
      log("[YS_CAPTURE] START on", location.href, "hash=", location.hash);

      pingGas_(GAS_CAPTURE_URL, "capture");
      if (ENABLE_ANALYZE && GAS_ANALYZE_URL && !String(GAS_ANALYZE_URL).includes("PASTE_")) {
        pingGas_(GAS_ANALYZE_URL, "analyze");
      }

      startFlushLoop();
    } else if (!ok && ACTIVE) {
      ACTIVE = false;
      log("[YS_CAPTURE] STOP on", location.href, "hash=", location.hash);
      stopFlushLoop();
    }
  }

  // SPA-safe：hashchange + 輪詢保險
  window.addEventListener("hashchange", startIfNeeded, true);
  GUARD_TIMER = setInterval(startIfNeeded, 600);
  startIfNeeded();

  /*****************************************************************
   * 3) Utilities
   *****************************************************************/
  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function truncateText_(s, maxLen) {
    const str = String(s == null ? "" : s);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + `...<truncated:${str.length - maxLen}>`;
  }

  function pickTechNo() {
    // 先嘗試 query/hash
    const qs = new URLSearchParams(location.search);
    if (qs.get("techNo")) return qs.get("techNo");

    const h = String(location.hash || "");
    const m = h.match(/techNo=([0-9A-Za-z_-]+)/);
    if (m) return m[1];

    // 再嘗試 storage（你未來可以把 techNo 存這裡）
    return (sessionStorage.getItem("techNo") || localStorage.getItem("techNo") || "");
  }

  function isGASUrl_(url) {
    const u = String(url || "");
    return u.includes("script.google.com") || u.includes("script.googleusercontent.com");
  }

  function urlMatches(url) {
    const u = String(url || "");
    if (!u) return false;

    // 避免回捲：不抓送往 GAS 的請求
    if (isGASUrl_(u)) return false;

    // 只抓 /api/
    return CAPTURE_RULES.urlSubstringsAny.some((s) => u.includes(s));
  }

  async function sha1Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-1", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function pingGas_(gasUrl, tag) {
    if (!gasUrl || String(gasUrl).includes("PASTE_")) return;

    GM_xmlhttpRequest({
      method: "GET",
      url: gasUrl + "?mode=ping&ts=" + Date.now(),
      timeout: 15000,
      onload: (res) => log(`[YS_CAPTURE] ping(${tag}) status=`, res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => warn(`[YS_CAPTURE] ping(${tag}) error`, err),
      ontimeout: () => warn(`[YS_CAPTURE] ping(${tag}) timeout`),
    });
  }

  function sanitizeHeaders_(headers) {
    if (!CAPTURE_RULES.redactSensitiveHeaders) return headers;

    const out = {};
    try {
      if (!headers) return out;

      // Headers instance
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
      } else if (Array.isArray(headers)) {
        for (const it of headers) {
          if (!it) continue;
          out[String(it[0]).toLowerCase()] = String(it[1]);
        }
      } else if (typeof headers === "object") {
        for (const k of Object.keys(headers)) {
          out[String(k).toLowerCase()] = String(headers[k]);
        }
      }
    } catch (_) {}

    const SENSITIVE = [
      "cookie",
      "authorization",
      "x-csrf-token",
      "x-xsrf-token",
      "csrf-token",
      "xsrf-token",
      "x-auth-token",
    ];
    for (const k of SENSITIVE) {
      if (k in out) out[k] = "<redacted>";
    }
    return out;
  }

  /*****************************************************************
   * 4) Queue + Dedup + Flush to GAS_CAPTURE_URL
   *****************************************************************/
  const QUEUE = [];
  const SENT_HASH = new Set();

  function enqueue(item) {
    QUEUE.push(item);
    log("[YS_CAPTURE] enqueue => queueLen=", QUEUE.length);
  }

  function startFlushLoop() {
    if (FLUSH_TIMER) return;
    FLUSH_TIMER = setInterval(flushQueue, CAPTURE_RULES.flushIntervalMs);
  }

  function stopFlushLoop() {
    if (FLUSH_TIMER) clearInterval(FLUSH_TIMER);
    FLUSH_TIMER = null;
  }

  function flushQueue() {
    if (!ACTIVE) return;
    if (QUEUE.length === 0) return;

    const batch = QUEUE.splice(0, CAPTURE_RULES.maxQueuePerFlush);
    const payload = {
      mode: "captureNetwork_v1",
      page: location.href,
      hash: location.hash,
      ts: new Date().toISOString(),
      techNo: pickTechNo(),
      items: batch,
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: GAS_CAPTURE_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 30000,
      onload: (res) => log("[YS_CAPTURE] capture sent", batch.length, "status=", res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => {
        warn("[YS_CAPTURE] capture send error", err);
        QUEUE.unshift(...batch);
      },
      ontimeout: () => {
        warn("[YS_CAPTURE] capture send timeout");
        QUEUE.unshift(...batch);
      },
    });
  }

  /*****************************************************************
   * 5) Analyze Forwarding (perf total)
   *****************************************************************/
  function isPerfTotalApi_(url) {
    const u = String(url || "");
    return /\/api\/performance\/total\/\d+/.test(u);
  }

  function extractStoreId_(url) {
    const u = String(url || "");
    const m = u.match(/\/api\/performance\/total\/(\d+)/);
    return m ? m[1] : "";
  }

  function extractFromTo_(requestBody) {
    let from = "", to = "", size = "", number = "";
    try {
      const obj = JSON.parse(String(requestBody || "{}"));
      from = String(obj.from || "");
      to = String(obj.to || "");
      size = String(obj.size ?? "");
      number = String(obj.number ?? "");
    } catch (_) {}
    return { from, to, size, number };
  }

  function forwardToAnalyze_(record, recordHash) {
    if (!ENABLE_ANALYZE) return;
    if (!GAS_ANALYZE_URL || String(GAS_ANALYZE_URL).includes("PASTE_")) return;

    if (!isPerfTotalApi_(record.url)) return;
    if (Number(record.status) !== 200) return;
    if (!record.response || typeof record.response !== "object") return;

    const storeId = extractStoreId_(record.url);
    const { from, to, size, number } = extractFromTo_(record.requestBody);

    const payload = {
      mode: "analyzePerfTotal_v1",
      meta: {
        storeId,
        from,
        to,
        size,
        number,
        page: location.href,
        hash: location.hash,
        capturedAt: new Date().toISOString(),
        recordHash: String(recordHash || ""),
        requestUrl: String(record.url || ""),
        techNo: pickTechNo(),
      },
      response: record.response,
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: GAS_ANALYZE_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 30000,
      onload: (res) => log("[ANALYZE] sent storeId=", storeId, "status=", res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => warn("[ANALYZE] send error", err),
      ontimeout: () => warn("[ANALYZE] send timeout"),
    });
  }

  /*****************************************************************
   * 6) Hook fetch
   *****************************************************************/
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);

    try {
      if (!ACTIVE) return res;

      const url = args[0];
      const opt = args[1] || {};
      if (!urlMatches(url)) return res;

      const clone = res.clone();
      const text = await clone.text();
      const json = safeJsonParse(text);

      if (!json && !CAPTURE_RULES.allowNonJson) return res;

      const record = {
        kind: "fetch",
        url: String(url),
        method: String(opt.method || "GET"),
        requestHeaders: sanitizeHeaders_(opt.headers || null),
        requestBody: opt.body || null,
        status: res.status,
        response: json || truncateText_(text, CAPTURE_RULES.maxTextLen),
      };

      const hash = await sha1Hex(JSON.stringify(record));
      if (!SENT_HASH.has(hash)) {
        SENT_HASH.add(hash);
        enqueue({ hash, record });
        log("[YS_CAPTURE][fetch] captured:", record.url, "status=", record.status);
        forwardToAnalyze_(record, hash);
      }
    } catch (e) {
      warn("[YS_CAPTURE][fetch] hook failed", e);
    }

    return res;
  };

  /*****************************************************************
   * 7) Hook XHR
   *****************************************************************/
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _setHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._cap_method = method;
    this._cap_url = url;
    this._cap_reqHeaders = {};
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (this && this._cap_reqHeaders) this._cap_reqHeaders[String(k).toLowerCase()] = String(v);
    } catch (_) {}
    return _setHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (ACTIVE && urlMatches(this._cap_url)) {
        const xhr = this;
        const reqBody = body;

        xhr.addEventListener("load", async function () {
          try {
            const text = xhr.responseText;
            const json = safeJsonParse(text);

            if (!json && !CAPTURE_RULES.allowNonJson) return;

            const record = {
              kind: "xhr",
              url: String(xhr._cap_url),
              method: String(xhr._cap_method || "GET"),
              requestHeaders: sanitizeHeaders_(xhr._cap_reqHeaders || null),
              requestBody: reqBody || null,
              status: xhr.status,
              response: json || truncateText_(text, CAPTURE_RULES.maxTextLen),
            };

            const hash = await sha1Hex(JSON.stringify(record));
            if (!SENT_HASH.has(hash)) {
              SENT_HASH.add(hash);
              enqueue({ hash, record });
              log("[YS_CAPTURE][xhr] captured:", record.url, "status=", record.status);
              forwardToAnalyze_(record, hash);
            }
          } catch (e) {
            warn("[YS_CAPTURE][xhr] parse failed", e);
          }
        });
      }
    } catch (e) {
      warn("[YS_CAPTURE][xhr] hook failed", e);
    }

    return _send.apply(this, arguments);
  };

  /*****************************************************************
   * 8) Page lifecycle flush
   *****************************************************************/
  window.addEventListener("pagehide", () => { try { flushQueue(); } catch (_) {} });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try { flushQueue(); } catch (_) {}
    }
  });
})();
