// ==UserScript==
// @name         YSPOS Capture ALL fetch/xhr -> GAS (FULL SITE)
// @namespace    https://local/
// @version      3.4
// @description  Capture ALL XHR/fetch on https://yspos.youngsong.com.tw/* (all pages). Store to NetworkCapture GAS. Optional: still forward /api/performance/total/{storeId} (200) to Analyze GAS.
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

  // 若你仍要保留「業績 total」轉送分析就留著；不需要可把 ENABLE_ANALYZE=false
  const GAS_ANALYZE_URL =
    "https://script.google.com/macros/s/AKfycbzICSr5W_-R8Ntztuq123rAZKu5GVi4dRqz-nquB64nokAVH414EPj0ZKRnG1I0HKUu/exec";

  /*****************************************************************
   * 1) Capture Rules (FULL SITE)
   *****************************************************************/
  const CAPTURE_RULES = {
    // ✅ 全站抓：不再做 #/performance gate
    captureAllPages: true,

    // ✅ 全站抓：不限制 /api，所有 fetch/xhr 都抓（但會排除 GAS 網域避免回捲）
    captureAllUrls: true,

    // ✅ 非 JSON 也抓（HTML/JS/CSS/文字），但會截斷
    allowNonJson: true,

    // 佇列與送出節流
    maxQueuePerFlush: 8,
    flushIntervalMs: 1200,

    // 防爆：responseText 截斷
    maxTextLen: 12000,

    // ✅ 預設脫敏（強烈建議保持 true）
    redactSensitiveHeaders: true,

    // Debug
    verbose: true,
  };

  // Analyze 開關（可關掉）
  const ENABLE_ANALYZE = true;

  /*****************************************************************
   * 2) Page gate (now FULL SITE)
   *****************************************************************/
  function isActiveNow() {
    // 全站抓就是永遠 active
    if (CAPTURE_RULES.captureAllPages) return true;
    return true;
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
    const ok = isActiveNow();
    if (ok && !ACTIVE) {
      ACTIVE = true;
      log("[YS_CAPTURE_ALL] START on", location.href);

      pingGas_(GAS_CAPTURE_URL, "capture");
      if (ENABLE_ANALYZE && GAS_ANALYZE_URL && !String(GAS_ANALYZE_URL).includes("PASTE_")) {
        pingGas_(GAS_ANALYZE_URL, "analyze");
      }
      startFlushLoop();
    } else if (!ok && ACTIVE) {
      ACTIVE = false;
      log("[YS_CAPTURE_ALL] STOP on", location.href);
      stopFlushLoop();
    }
  }

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
    // 保留原邏輯：若後續你抓到 techNo 來源，可寫入 sessionStorage("techNo")
    const qs = new URLSearchParams(location.search);
    if (qs.get("techNo")) return qs.get("techNo");

    const h = String(location.hash || "");
    const m = h.match(/techNo=([0-9A-Za-z_-]+)/);
    if (m) return m[1];

    return (sessionStorage.getItem("techNo") || localStorage.getItem("techNo") || "");
  }

  function isGASUrl_(url) {
    const u = String(url || "");
    return u.includes("script.google.com") || u.includes("script.googleusercontent.com");
  }

  function urlMatches(url) {
    const u = String(url || "");
    if (!u) return false;

    // ✅ 避免回捲：不抓送往 GAS 的請求
    if (isGASUrl_(u)) return false;

    // ✅ 全抓：fetch/xhr 都抓
    if (CAPTURE_RULES.captureAllUrls) return true;

    // 若你未來想收斂，可改回 substring allowlist
    return u.includes("/api/");
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
      onload: (res) => log(`[YS_CAPTURE_ALL] ping(${tag}) status=`, res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => warn(`[YS_CAPTURE_ALL] ping(${tag}) error`, err),
      ontimeout: () => warn(`[YS_CAPTURE_ALL] ping(${tag}) timeout`),
    });
  }

  function sanitizeHeaders_(headers) {
    if (!CAPTURE_RULES.redactSensitiveHeaders) return headers;

    // 支援 object / Headers / array
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

    // 脫敏：cookie / token / csrf 類
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
    log("[YS_CAPTURE_ALL] enqueue => queueLen=", QUEUE.length);
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
      onload: (res) => log("[YS_CAPTURE_ALL] capture sent", batch.length, "status=", res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => {
        warn("[YS_CAPTURE_ALL] capture send error", err);
        QUEUE.unshift(...batch);
      },
      ontimeout: () => {
        warn("[YS_CAPTURE_ALL] capture send timeout");
        QUEUE.unshift(...batch);
      },
    });
  }

  /*****************************************************************
   * 5) Optional: Forward perf total -> Analyze GAS
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

      // 非 JSON 也抓：會存截斷文字
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
        log("[YS_CAPTURE_ALL][fetch] captured:", record.url, "status=", record.status);

        forwardToAnalyze_(record, hash);
      }
    } catch (e) {
      warn("[YS_CAPTURE_ALL][fetch] hook failed", e);
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
              log("[YS_CAPTURE_ALL][xhr] captured:", record.url, "status=", record.status);

              forwardToAnalyze_(record, hash);
            }
          } catch (e) {
            warn("[YS_CAPTURE_ALL][xhr] parse failed", e);
          }
        });
      }
    } catch (e) {
      warn("[YS_CAPTURE_ALL][xhr] hook failed", e);
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
