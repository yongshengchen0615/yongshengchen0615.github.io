// ==UserScript==
// @name         YSPOS P_DETAIL Capture + Analyze -> GAS (FULL, FIXED)
// @namespace    https://local/
// @version      3.3
// @description  Capture XHR/fetch on #/performance?tab=P_DETAIL; store to NetworkCapture GAS; ALSO forward /api/performance/total/{storeId} (200) JSON response to Analyze GAS to write summary/items tables.
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
  // ① 你現在用來存 NetworkCapture 的 GAS（captureNetwork_v1）
  const GAS_CAPTURE_URL =
    "https://script.google.com/macros/s/AKfycbzAc4BzsBddHhjVEke_uTdDnktv82TTHcxR3KnlQeFOB4EkKaHUixq8Vd8De8vp82mCKw/exec";

  // ② 你用來「接收分析結果」的 GAS（analyzePerfTotal_v1）
  const GAS_ANALYZE_URL =
    "https://script.google.com/macros/s/AKfycbzICSr5W_-R8Ntztuq123rAZKu5GVi4dRqz-nquB64nokAVH414EPj0ZKRnG1I0HKUu/exec";

  /*****************************************************************
   * 1) Capture Rules
   *****************************************************************/
  const CAPTURE_RULES = {
    pageHashMustInclude: "#/performance",
    pageHashMustInclude2: "tab=P_DETAIL",

    urlSubstringsAny: ["/api/"],

    allowNonJson: false,

    maxQueuePerFlush: 8,
    flushIntervalMs: 1200,

    maxTextLen: 12000,

    verbose: true,
  };

  /*****************************************************************
   * 2) Page gate (SPA-safe)
   *****************************************************************/
  function isTargetPage() {
    const h = String(location.hash || "");
    return (
      h.includes(CAPTURE_RULES.pageHashMustInclude) &&
      h.includes(CAPTURE_RULES.pageHashMustInclude2)
    );
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
      log("[P_DETAIL_CAPTURE] START on", location.href);

      pingGas_(GAS_CAPTURE_URL, "capture");
      if (GAS_ANALYZE_URL && !String(GAS_ANALYZE_URL).includes("PASTE_")) {
        pingGas_(GAS_ANALYZE_URL, "analyze");
      } else {
        warn("[P_DETAIL_CAPTURE] GAS_ANALYZE_URL not set; analyze forwarding disabled.");
      }

      startFlushLoop();
    } else if (!ok && ACTIVE) {
      ACTIVE = false;
      log("[P_DETAIL_CAPTURE] STOP on", location.href);
      stopFlushLoop();
    }
  }

  // hashchange + 保險輪詢（避免 SPA 某些情境沒觸發 hashchange）
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
    const qs = new URLSearchParams(location.search);
    if (qs.get("techNo")) return qs.get("techNo");

    const h = String(location.hash || "");
    const m = h.match(/techNo=([0-9A-Za-z_-]+)/);
    if (m) return m[1];

    return (sessionStorage.getItem("techNo") || localStorage.getItem("techNo") || "");
  }

  function urlMatches(url) {
    const u = String(url || "");
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
      onload: (res) => log(`[P_DETAIL_CAPTURE] ping(${tag}) status=`, res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => warn(`[P_DETAIL_CAPTURE] ping(${tag}) error`, err),
      ontimeout: () => warn(`[P_DETAIL_CAPTURE] ping(${tag}) timeout`),
    });
  }

  /*****************************************************************
   * 4) Queue + Dedup + Flush to GAS_CAPTURE_URL
   *****************************************************************/
  const QUEUE = [];
  const SENT_HASH = new Set();

  function enqueue(item) {
    QUEUE.push(item);
    log("[P_DETAIL_CAPTURE] enqueue => queueLen=", QUEUE.length);
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
      onload: (res) => log("[P_DETAIL_CAPTURE] capture sent", batch.length, "status=", res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => {
        warn("[P_DETAIL_CAPTURE] capture send error", err);
        QUEUE.unshift(...batch);
      },
      ontimeout: () => {
        warn("[P_DETAIL_CAPTURE] capture send timeout");
        QUEUE.unshift(...batch);
      },
    });
  }

  /*****************************************************************
   * 5) Forward target API response -> GAS_ANALYZE_URL
   *    Target: POST /api/performance/total/{storeId}
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
        requestHeaders: opt.headers || null,
        requestBody: opt.body || null,
        status: res.status,
        response: json || truncateText_(text, CAPTURE_RULES.maxTextLen),
      };

      const hash = await sha1Hex(JSON.stringify(record));
      if (!SENT_HASH.has(hash)) {
        SENT_HASH.add(hash);

        enqueue({ hash, record });
        log("[P_DETAIL_CAPTURE][fetch] captured:", record.url, "status=", record.status);

        forwardToAnalyze_(record, hash);
      }
    } catch (e) {
      warn("[P_DETAIL_CAPTURE][fetch] hook failed", e);
    }

    return res;
  };

  /*****************************************************************
   * 7) Hook XHR (axios / legacy)
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
      if (this && this._cap_reqHeaders) this._cap_reqHeaders[String(k)] = String(v);
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
              requestHeaders: xhr._cap_reqHeaders || null,
              requestBody: reqBody || null,
              status: xhr.status,
              response: json || truncateText_(text, CAPTURE_RULES.maxTextLen),
            };

            const hash = await sha1Hex(JSON.stringify(record));
            if (!SENT_HASH.has(hash)) {
              SENT_HASH.add(hash);

              enqueue({ hash, record });
              log("[P_DETAIL_CAPTURE][xhr] captured:", record.url, "status=", record.status);

              forwardToAnalyze_(record, hash);
            }
          } catch (e) {
            warn("[P_DETAIL_CAPTURE][xhr] parse failed", e);
          }
        });
      }
    } catch (e) {
      warn("[P_DETAIL_CAPTURE][xhr] hook failed", e);
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
