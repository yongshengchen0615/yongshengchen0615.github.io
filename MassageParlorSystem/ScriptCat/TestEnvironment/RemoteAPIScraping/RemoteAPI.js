// ==UserScript==
// @name         YSPOS P_DETAIL Network Capture -> GAS (DEBUG)
// @namespace    https://local/
// @version      2.3
// @description  DEBUG: ping GAS on enter; capture fetch/XHR on #/performance?tab=P_DETAIL; loosen filters first-run; flush logs
// @match        https://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  /*****************************************************************
   * 0) Settings
   *****************************************************************/
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzAc4BzsBddHhjVEke_uTdDnktv82TTHcxR3KnlQeFOB4EkKaHUixq8Vd8De8vp82mCKw/exec";

  // ✅ 第一輪先抓全量：urlSubstringsAny = [""] 永遠命中
  // ✅ jsonKeysAny = [] 代表「不做 key 檢查」
  // ✅ allowNonJson = true：不是 JSON 的回應也可送（先抓 URL 再收斂）
  const CAPTURE_RULES = {
    pageHashMustInclude: "#/performance",
    pageHashMustInclude2: "tab=P_DETAIL",

    urlSubstringsAny: [""],      // ✅第一輪：全部 URL 都命中
    jsonKeysAny: [],             // ✅第一輪：不做 JSON key 檢查
    allowNonJson: true,          // ✅第一輪：非 JSON 也送（先定位 URL）

    maxQueuePerFlush: 8,
    flushIntervalMs: 1200,

    // 避免送太大
    maxTextLen: 8000,

    // debug
    verbose: true,
  };

  /*****************************************************************
   * 1) Page gate (SPA-safe)
   *****************************************************************/
  function isTargetPage() {
    const h = String(location.hash || "");
    return h.includes(CAPTURE_RULES.pageHashMustInclude) && h.includes(CAPTURE_RULES.pageHashMustInclude2);
  }

  let ACTIVE = false;
  let FLUSH_TIMER = null;

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
      pingGas_();          // ✅進頁先 ping，確認 GAS 通不通
      startFlushLoop();
    } else if (!ok && ACTIVE) {
      ACTIVE = false;
      log("[P_DETAIL_CAPTURE] STOP on", location.href);
      stopFlushLoop();
    }
  }

  window.addEventListener("hashchange", startIfNeeded, true);
  startIfNeeded();

  /*****************************************************************
   * 2) Utilities
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

  function jsonLooksLikeTarget(obj) {
    if (!obj || typeof obj !== "object") return false;

    // ✅jsonKeysAny 為空：直接放行
    if (!CAPTURE_RULES.jsonKeysAny || CAPTURE_RULES.jsonKeysAny.length === 0) return true;

    const keys = new Set();
    (function walk(o, depth) {
      if (!o || typeof o !== "object" || depth > 2) return;
      Object.keys(o).forEach((k) => keys.add(String(k)));
      for (const k of Object.keys(o)) walk(o[k], depth + 1);
    })(obj, 0);

    return CAPTURE_RULES.jsonKeysAny.some((k) => keys.has(k));
  }

  async function sha1Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-1", enc);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function pingGas_() {
    GM_xmlhttpRequest({
      method: "GET",
      url: GAS_URL + "?mode=ping&ts=" + Date.now(),
      timeout: 15000,
      onload: (res) => {
        log("[P_DETAIL_CAPTURE] ping status=", res.status, "body=", truncateText_(res.responseText, 300));
      },
      onerror: (err) => warn("[P_DETAIL_CAPTURE] ping error", err),
      ontimeout: () => warn("[P_DETAIL_CAPTURE] ping timeout"),
    });
  }

  /*****************************************************************
   * 3) Queue + Dedup + Flush to GAS
   *****************************************************************/
  const QUEUE = [];
  const SENT_HASH = new Set();

  function enqueue(item) {
    QUEUE.push(item);
    log("[P_DETAIL_CAPTURE] enqueue =>", "queueLen=", QUEUE.length);
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
    if (QUEUE.length === 0) {
      log("[P_DETAIL_CAPTURE] flush skip (queue empty)");
      return;
    }

    const batch = QUEUE.splice(0, CAPTURE_RULES.maxQueuePerFlush);
    const payload = {
      mode: "captureNetwork_v1",
      page: location.href,
      hash: location.hash,
      ts: new Date().toISOString(),
      techNo: pickTechNo(),
      items: batch,
    };

    log("[P_DETAIL_CAPTURE] flushing", batch.length, "items...");

    GM_xmlhttpRequest({
      method: "POST",
      url: GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 30000,
      onload: (res) => {
        log("[P_DETAIL_CAPTURE] sent", batch.length, "status=", res.status, "body=", truncateText_(res.responseText, 300));
      },
      onerror: (err) => {
        warn("[P_DETAIL_CAPTURE] send error", err);
        QUEUE.unshift(...batch);
      },
      ontimeout: () => {
        warn("[P_DETAIL_CAPTURE] send timeout");
        QUEUE.unshift(...batch);
      },
    });
  }

  /*****************************************************************
   * 4) Hook fetch
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

      // ✅ 不是 JSON：第一輪允許送（可關掉）
      if (!json && !CAPTURE_RULES.allowNonJson) return res;

      // ✅ 是 JSON 但 key 不像：可擋（第一輪 jsonKeysAny=[] 會直接放行）
      if (json && !jsonLooksLikeTarget(json)) return res;

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
      }
    } catch (e) {
      warn("[P_DETAIL_CAPTURE][fetch] hook failed", e);
    }

    return res;
  };

  /*****************************************************************
   * 5) Hook XHR (axios / legacy)
   *****************************************************************/
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._cap_method = method;
    this._cap_url = url;
    return _open.apply(this, arguments);
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
            if (json && !jsonLooksLikeTarget(json)) return;

            const record = {
              kind: "xhr",
              url: String(xhr._cap_url),
              method: String(xhr._cap_method || "GET"),
              requestBody: reqBody || null,
              status: xhr.status,
              response: json || truncateText_(text, CAPTURE_RULES.maxTextLen),
            };

            const hash = await sha1Hex(JSON.stringify(record));
            if (!SENT_HASH.has(hash)) {
              SENT_HASH.add(hash);
              enqueue({ hash, record });
              log("[P_DETAIL_CAPTURE][xhr] captured:", record.url, "status=", record.status);
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
   * 6) Page lifecycle flush
   *****************************************************************/
  window.addEventListener("pagehide", () => { try { flushQueue(); } catch (_) {} });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { try { flushQueue(); } catch (_) {} }
  });
})();
