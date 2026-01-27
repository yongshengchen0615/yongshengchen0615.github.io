// ==UserScript==
// @name         FE YSPOS Capture (MASTER_LOGIN + MASTER_COMPLEX + P_DETAIL + P_STATIC) -> GAS + Analyze (sessionKey linked) [FULL REPLACE + DOM TECHNO + MASTER_COMPLEX ANALYZE + FIX]
// @namespace    https://local/
// @version      4.7.1
// @description  ✅FIX: avoid missing injection on http/https; ✅FIX: show injected log always; ✅FIX: loosen page gate to avoid missing login/redirect pages; keep /api/ filter + dedup. Capture XHR/fetch to GAS, forward PerfTotal + MasterComplex to Analyze GAS.
// @match        *://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @run-at       document-start
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @resource     gasConfigRemoteAPI_FE https://yongshengchen0615.github.io/MassageParlorSystem/Shop/TainanFuqianStore/ScriptCat/FormalEnvironment/gas-config-remoteapi-FE.json
// ==/UserScript==

(function () {
  "use strict";

  // ✅ FIX#0: injection proof (independent of ACTIVE)
  try {
    console.log("[YS_CAPTURE] injected", { href: location.href, host: location.host, hash: location.hash, ua: navigator.userAgent });
  } catch (_) {}

  /*****************************************************************
   * 0) Config (FED-style: @resource + allowlist)
   *****************************************************************/
  const GAS_RESOURCE = "gasConfigRemoteAPI_FE";
  const DEFAULT_CFG = {
    GAS_CAPTURE_URL: "",
    GAS_ANALYZE_URL: "",
    SHIP_ENABLED: true,
  };
  let CFG = { ...DEFAULT_CFG };

  function stripBom_(s) {
    const str = String(s == null ? "" : s);
    return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
  }

  function safeJsonParse(text) {
    try {
      const t = stripBom_(text).trim();
      if (!t) return null;
      return JSON.parse(t);
    } catch (_) {
      return null;
    }
  }

  function loadJsonOverridesCfg_() {
    try {
      if (typeof GM_getResourceText !== "function") return {};
      const raw = GM_getResourceText(GAS_RESOURCE);
      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") return {};

      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_CAPTURE_URL")) out.GAS_CAPTURE_URL = parsed.GAS_CAPTURE_URL;
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_ANALYZE_URL")) out.GAS_ANALYZE_URL = parsed.GAS_ANALYZE_URL;
      if (Object.prototype.hasOwnProperty.call(parsed, "SHIP_ENABLED")) out.SHIP_ENABLED = !!parsed.SHIP_ENABLED;

      // legacy keys
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_ENDPOINT") && !out.GAS_CAPTURE_URL) out.GAS_CAPTURE_URL = parsed.GAS_ENDPOINT;
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL") && !out.GAS_CAPTURE_URL) out.GAS_CAPTURE_URL = parsed.GAS_URL;

      return out;
    } catch {
      return {};
    }
  }

  function isAllowedGASUrl_(u) {
    try {
      const url = new URL(String(u || ""));
      if (url.protocol !== "https:") return false;
      const host = url.hostname.toLowerCase();
      return host === "script.google.com" || host === "script.googleusercontent.com";
    } catch {
      return false;
    }
  }

  function applyConfigOverrides_() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverridesCfg_() };

    CFG.GAS_CAPTURE_URL = String(CFG.GAS_CAPTURE_URL || "").trim();
    CFG.GAS_ANALYZE_URL = String(CFG.GAS_ANALYZE_URL || "").trim();

    if (CFG.GAS_CAPTURE_URL && !isAllowedGASUrl_(CFG.GAS_CAPTURE_URL)) {
      console.warn("[YS_CAPTURE] ⚠️ GAS_CAPTURE_URL is not allowlisted. Blocked:", CFG.GAS_CAPTURE_URL);
      CFG.GAS_CAPTURE_URL = "";
    }
    if (CFG.GAS_ANALYZE_URL && !isAllowedGASUrl_(CFG.GAS_ANALYZE_URL)) {
      console.warn("[YS_CAPTURE] ⚠️ GAS_ANALYZE_URL is not allowlisted. Blocked:", CFG.GAS_ANALYZE_URL);
      CFG.GAS_ANALYZE_URL = "";
    }
  }

  applyConfigOverrides_();

  /*****************************************************************
   * 1) Capture Rules
   *****************************************************************/
  const CAPTURE_RULES = {
    urlSubstringsAny: ["/api/"],
    allowNonJson: false,

    maxQueuePerFlush: 8,
    flushIntervalMs: 1200,

    maxTextLen: 12000,
    redactSensitiveHeaders: true,

    sentHashMax: 3000,
    verbose: true,
  };

  const ENABLE_ANALYZE = true;

  /*****************************************************************
   * 2) Page gate (FIX)
   *****************************************************************/
  // ✅ FIX#1: loosen gate — keep hooks active on whole domain.
  // This prevents missing login/redirect/intermediate pages; still only captures "/api/" via urlMatches().
  function isTargetPage() {
    return location.hostname === "yspos.youngsong.com.tw";
  }

  let ACTIVE = false;
  let FLUSH_TIMER = null;
  let TECHNO_OBSERVER_STARTED = false;

  function log(...args) {
    if (CAPTURE_RULES.verbose) console.log(...args);
  }
  function warn(...args) {
    console.warn(...args);
  }

  function startIfNeeded() {
    const ok = isTargetPage();
    if (ok && !ACTIVE) {
      if (!CFG.SHIP_ENABLED) {
        warn("[YS_CAPTURE] SHIP_ENABLED=false; capture disabled.");
        return;
      }
      if (!CFG.GAS_CAPTURE_URL) {
        warn(
          "[YS_CAPTURE] ⚠️ CFG.GAS_CAPTURE_URL is empty/blocked; capture disabled.\n" +
            'Check @resource JSON: {"GAS_CAPTURE_URL":"https://script.google.com/macros/s/.../exec"}'
        );
        return;
      }

      ACTIVE = true;
      log("[YS_CAPTURE] START on", location.href, "hash=", location.hash);

      if (!TECHNO_OBSERVER_STARTED) {
        TECHNO_OBSERVER_STARTED = true;
        startTechNoObserver_();
      }

      pingGas_(CFG.GAS_CAPTURE_URL, "capture");
      if (ENABLE_ANALYZE && CFG.GAS_ANALYZE_URL && !String(CFG.GAS_ANALYZE_URL).includes("PASTE_")) {
        pingGas_(CFG.GAS_ANALYZE_URL, "analyze");
      }

      startFlushLoop();
    } else if (!ok && ACTIVE) {
      ACTIVE = false;
      log("[YS_CAPTURE] STOP on", location.href, "hash=", location.hash);
      stopFlushLoop();
    }
  }

  window.addEventListener("hashchange", startIfNeeded, true);
  setInterval(startIfNeeded, 600);
  startIfNeeded();

  /*****************************************************************
   * 3) Utilities
   *****************************************************************/
  function truncateText_(s, maxLen) {
    const str = String(s == null ? "" : s);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + `...<truncated:${str.length - maxLen}>`;
  }

  const SESSION_KEY_NAME = "YS_CAPTURE_SESSION_KEY";
  function genSessionKey_() {
    try {
      const rnd = new Uint8Array(16);
      crypto.getRandomValues(rnd);
      const hex = Array.from(rnd)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `sess_${Date.now()}_${hex}`;
    } catch (_) {
      return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
  }
  function getSessionKey_() {
    try {
      let k = sessionStorage.getItem(SESSION_KEY_NAME);
      if (!k) {
        k = genSessionKey_();
        sessionStorage.setItem(SESSION_KEY_NAME, k);
      }
      return k;
    } catch (_) {
      return genSessionKey_();
    }
  }

  /*****************************************************************
   * 3.1) ✅ TechNo from DOM: <p class="text-C599F48">師傅號碼：<span>10</span></p>
   *****************************************************************/
  let TECHNO_CACHE = "";

  function readTechNoFromDom_() {
    try {
      const ps = Array.from(document.querySelectorAll("p.text-C599F48"));
      for (const p of ps) {
        const txt = (p.textContent || "").replace(/\s+/g, "");
        if (!txt.includes("師傅號碼")) continue;

        const sp = p.querySelector("span");
        const v1 = sp ? String(sp.textContent || "").trim() : "";
        const v2 = String(txt).replace("師傅號碼：", "").replace("師傅號碼:", "").trim();
        const v = v1 || v2;

        const m = String(v).match(/\d+/);
        if (!m) continue;
        return m[0];
      }
    } catch (_) {}
    return "";
  }

  function startTechNoObserver_() {
    const refresh = () => {
      const v = readTechNoFromDom_();
      if (v && v !== TECHNO_CACHE) {
        TECHNO_CACHE = v;
        try {
          sessionStorage.setItem("techNo", TECHNO_CACHE);
          localStorage.setItem("techNo", TECHNO_CACHE);
        } catch (_) {}
        log("[YS_CAPTURE] TECHNO_CACHE updated from DOM =>", TECHNO_CACHE);
      }
    };

    try {
      refresh();
    } catch (_) {}

    try {
      const mo = new MutationObserver(() => refresh());
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {
      setInterval(refresh, 1200);
    }
  }

  function pickTechNo() {
    const qs = new URLSearchParams(location.search);
    if (qs.get("techNo")) return qs.get("techNo");

    const h = String(location.hash || "");
    const m = h.match(/techNo=([0-9A-Za-z_-]+)/);
    if (m) return m[1];

    if (TECHNO_CACHE) return TECHNO_CACHE;

    return sessionStorage.getItem("techNo") || localStorage.getItem("techNo") || "";
  }

  function isGoogleScriptHost_(url) {
    try {
      const u = new URL(String(url || ""), location.origin);
      const host = u.hostname.toLowerCase();
      return host === "script.google.com" || host === "script.googleusercontent.com";
    } catch (_) {
      const s = String(url || "");
      return s.includes("script.google.com") || s.includes("script.googleusercontent.com");
    }
  }

  function urlMatches(url) {
    const u = String(url || "");
    if (!u) return false;
    if (isGoogleScriptHost_(u)) return false;
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
    const out = {};
    try {
      if (!headers) return out;

      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach((v, k) => {
          out[String(k).toLowerCase()] = String(v);
        });
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

    if (!CAPTURE_RULES.redactSensitiveHeaders) return out;

    const SENSITIVE = ["cookie", "authorization", "x-csrf-token", "x-xsrf-token", "csrf-token", "xsrf-token", "x-auth-token"];
    for (const k of SENSITIVE) {
      if (k in out) out[k] = "<redacted>";
    }
    return out;
  }

  function normalizeFetchUrl_(input) {
    try {
      if (typeof Request !== "undefined" && input instanceof Request) return input.url;
      return String(input || "");
    } catch (_) {
      return String(input || "");
    }
  }

  function bodyToString_(body) {
    try {
      if (body == null) return "";
      if (typeof body === "string") return body;

      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
        return body.toString();
      }

      if (typeof FormData !== "undefined" && body instanceof FormData) {
        const usp = new URLSearchParams();
        for (const [k, v] of body.entries()) usp.append(String(k), String(v));
        return usp.toString();
      }

      return "";
    } catch (_) {
      return "";
    }
  }

  /*****************************************************************
   * 4) Queue + Dedup + Flush to GAS_CAPTURE_URL
   *****************************************************************/
  const QUEUE = [];
  const SENT_HASH = new Set();
  const SENT_HASH_FIFO = [];

  function addSentHash_(h) {
    if (SENT_HASH.has(h)) return;
    SENT_HASH.add(h);
    SENT_HASH_FIFO.push(h);
    const max = Number(CAPTURE_RULES.sentHashMax || 0) || 0;
    if (max > 0 && SENT_HASH_FIFO.length > max) {
      const old = SENT_HASH_FIFO.splice(0, SENT_HASH_FIFO.length - max);
      for (const x of old) SENT_HASH.delete(x);
    }
  }

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

    if (!CFG.SHIP_ENABLED || !CFG.GAS_CAPTURE_URL) {
      warn("[YS_CAPTURE] capture disabled (missing URL / SHIP_ENABLED=false). Dropping queued items:", QUEUE.length);
      QUEUE.length = 0;
      return;
    }

    const batch = QUEUE.splice(0, CAPTURE_RULES.maxQueuePerFlush);
    const payload = {
      mode: "captureNetwork_v1",
      page: location.href,
      hash: location.hash,
      ts: new Date().toISOString(),
      techNo: pickTechNo(),
      sessionKey: getSessionKey_(),
      items: batch,
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.GAS_CAPTURE_URL,
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
   * 5) Analyze Forwarding
   *****************************************************************/
  function isPerfTotalApi_(url) {
    const u = String(url || "");
    return /\/api\/performance\/total\/\d+/.test(u);
  }

  function extractStoreIdFromPerfTotal_(url) {
    const u = String(url || "");
    const m = u.match(/\/api\/performance\/total\/(\d+)/);
    return m ? m[1] : "";
  }

  function isMasterComplexApi_(url) {
    const u = String(url || "");
    if (!u.includes("/api/")) return false;
    if (u.includes("listStatus=COMPLEX")) return true;
    if (u.includes("COMPLEX")) return true;
    return false;
  }

  function extractStoreIdFromAny_(url) {
    try {
      const u = new URL(String(url || ""), location.origin);
      const q = u.searchParams;
      const qsKeys = ["storeId", "store_id", "sid"];
      for (const k of qsKeys) {
        const v = String(q.get(k) || "");
        if (v && /^\d+$/.test(v)) return v;
      }
      const m = u.pathname.match(/\/(\d+)(?:\/|$)/);
      if (m && m[1]) return m[1];
      return "";
    } catch (_) {
      return "";
    }
  }

  function extractFromTo_(requestBody, requestUrl) {
    let from = "", to = "", size = "", number = "";

    try {
      const t = stripBom_(String(requestBody || "")).trim();
      if (t && (t.startsWith("{") || t.startsWith("["))) {
        const obj = JSON.parse(t);
        from = String(obj.from || "");
        to = String(obj.to || "");
        size = String(obj.size ?? "");
        number = String(obj.number ?? "");
        if (from || to) return { from, to, size, number };
      }
    } catch (_) {}

    try {
      const bodyStr = bodyToString_(requestBody) || String(requestBody || "");
      const bs = stripBom_(bodyStr).trim();
      if (bs && (bs.includes("=") || bs.includes("&"))) {
        const usp = new URLSearchParams(bs);
        from = String(usp.get("from") || "");
        to = String(usp.get("to") || "");
        size = String(usp.get("size") || "");
        number = String(usp.get("number") || "");
        if (from || to) return { from, to, size, number };
      }
    } catch (_) {}

    try {
      const u = new URL(String(requestUrl || ""), location.origin);
      const usp = u.searchParams;
      from = String(usp.get("from") || "");
      to = String(usp.get("to") || "");
      size = String(usp.get("size") || "");
      number = String(usp.get("number") || "");
      if (from || to) return { from, to, size, number };
    } catch (_) {}

    return { from: "", to: "", size: "", number: "" };
  }

  function sendAnalyze_(payload, tag) {
    if (!ENABLE_ANALYZE) return;
    if (!CFG.SHIP_ENABLED) return;
    if (!CFG.GAS_ANALYZE_URL || String(CFG.GAS_ANALYZE_URL).includes("PASTE_")) return;

    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.GAS_ANALYZE_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 30000,
      onload: (res) => log(`[ANALYZE:${tag}] status=`, res.status, "body=", truncateText_(res.responseText, 200)),
      onerror: (err) => warn(`[ANALYZE:${tag}] send error`, err),
      ontimeout: () => warn(`[ANALYZE:${tag}] send timeout`),
    });
  }

  function forwardToAnalyzePerfTotal_(record, recordHash) {
    if (!isPerfTotalApi_(record.url)) return;
    if (Number(record.status) !== 200) return;
    if (!record.response || typeof record.response !== "object") return;

    const storeId = extractStoreIdFromPerfTotal_(record.url);
    const { from, to, size, number } = extractFromTo_(record.requestBody, record.url);

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
        sessionKey: getSessionKey_(),
      },
      response: record.response,
    };

    sendAnalyze_(payload, `perfTotal storeId=${storeId || "?"}`);
  }

  function forwardToAnalyzeMasterComplex_(record, recordHash) {
    if (!isMasterComplexApi_(record.url)) return;
    if (Number(record.status) !== 200) return;
    if (!record.response || typeof record.response !== "object") return;

    const storeId = extractStoreIdFromAny_(record.url);
    const payload = {
      mode: "analyzeMasterComplex_v1",
      meta: {
        storeId,
        page: location.href,
        hash: location.hash,
        capturedAt: new Date().toISOString(),
        recordHash: String(recordHash || ""),
        requestUrl: String(record.url || ""),
        techNo: pickTechNo(),
        sessionKey: getSessionKey_(),
      },
      response: record.response,
    };

    sendAnalyze_(payload, `masterComplex storeId=${storeId || "?"}`);
  }

  function forwardToAnalyzeAll_(record, recordHash) {
    try { forwardToAnalyzePerfTotal_(record, recordHash); } catch (e) { warn("[ANALYZE] perfTotal forward failed", e); }
    try { forwardToAnalyzeMasterComplex_(record, recordHash); } catch (e) { warn("[ANALYZE] masterComplex forward failed", e); }
  }

  /*****************************************************************
   * 6) Hook fetch
   *****************************************************************/
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);

    try {
      if (!ACTIVE) return res;

      const url = normalizeFetchUrl_(args[0]);
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
        requestBody: bodyToString_(opt.body) || (typeof opt.body === "string" ? opt.body : null),
        status: res.status,
        response: json || truncateText_(text, CAPTURE_RULES.maxTextLen),
      };

      const hash = await sha1Hex(JSON.stringify(record));
      if (!SENT_HASH.has(hash)) {
        addSentHash_(hash);
        enqueue({ hash, record });
        log("[YS_CAPTURE][fetch] captured:", record.url, "status=", record.status);

        if (json && typeof json === "object") forwardToAnalyzeAll_(record, hash);
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
        const reqBodyStr = bodyToString_(body) || (typeof body === "string" ? body : null);

        xhr.addEventListener("load", async function () {
          try {
            const rt = String(xhr.responseType || "");
            let json = null;
            let respOut = "";

            if (rt === "" || rt === "text") {
              const text = xhr.responseText;
              json = safeJsonParse(text);
              if (!json) respOut = truncateText_(text, CAPTURE_RULES.maxTextLen);
            } else if (rt === "json") {
              const r = xhr.response;
              if (r && typeof r === "object") json = r;
              else if (r != null) {
                const t = String(r);
                json = safeJsonParse(t);
                if (!json) respOut = truncateText_(t, CAPTURE_RULES.maxTextLen);
              } else {
                respOut = "<null json response>";
              }
            } else {
              respOut = `<non-text responseType:${rt}>`;
            }

            if (!json && !CAPTURE_RULES.allowNonJson && respOut.startsWith("<non-text")) return;
            if (!json && !CAPTURE_RULES.allowNonJson && !respOut) return;

            const record = {
              kind: "xhr",
              url: String(xhr._cap_url),
              method: String(xhr._cap_method || "GET"),
              requestHeaders: sanitizeHeaders_(xhr._cap_reqHeaders || null),
              requestBody: reqBodyStr,
              status: xhr.status,
              response: json || respOut,
            };

            const hash = await sha1Hex(JSON.stringify(record));
            if (!SENT_HASH.has(hash)) {
              addSentHash_(hash);
              enqueue({ hash, record });
              log("[YS_CAPTURE][xhr] captured:", record.url, "status=", record.status);

              if (json && typeof json === "object") forwardToAnalyzeAll_(record, hash);
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
