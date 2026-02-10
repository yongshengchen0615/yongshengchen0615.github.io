// ==UserScript==
// @name         FE YSPOS Capture -> GAS + Analyze [MASTER PAGE-GATE + BROAD API FORWARD] (STABLE v5.3) (FULL REPLACE)
// @namespace    https://local/
// @version      5.6
// @description  ✅Capture XHR/fetch to GAS; ✅PerfTotal Analyze on /api/performance/total/{storeId}; ✅Master Analyze on #/master page (NO listStatus required), forwards ANY /api/ JSON(200) response on that page.
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

  try {
    console.log("[YS_CAPTURE] injected", { href: location.href, host: location.host, hash: location.hash, ua: navigator.userAgent });
  } catch (_) {}

  /*****************************************************************
   * 0) Config
   *****************************************************************/
  const GAS_RESOURCE = "gasConfigRemoteAPI_FE";
  const DEFAULT_CFG = { GAS_CAPTURE_URL: "", GAS_ANALYZE_URL: "", SHIP_ENABLED: true };
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
      console.warn("[YS_CAPTURE] ⚠️ GAS_CAPTURE_URL not allowlisted. Blocked:", CFG.GAS_CAPTURE_URL);
      CFG.GAS_CAPTURE_URL = "";
    }
    if (CFG.GAS_ANALYZE_URL && !isAllowedGASUrl_(CFG.GAS_ANALYZE_URL)) {
      console.warn("[YS_CAPTURE] ⚠️ GAS_ANALYZE_URL not allowlisted. Blocked:", CFG.GAS_ANALYZE_URL);
      CFG.GAS_ANALYZE_URL = "";
    }
  }
  applyConfigOverrides_();

  /*****************************************************************
   * 1) Rules / Flags
   *****************************************************************/
  const CAPTURE_RULES = {
    urlSubstringsAny: ["/api/"],
    // allow capturing non-JSON responses (text/html, xml, etc.)
    allowNonJson: true,
    // capture response headers as well (redacted if sensitive)
    captureResponseHeaders: true,
    // persist queue to localStorage to avoid data loss on page close
    persistQueue: true,
    // persist sent hashes to sessionStorage to avoid duplicate across reloads
    persistSentHash: true,
    maxQueuePerFlush: 16,
    flushIntervalMs: 1200,
    maxTextLen: 12000,
    // When FULL_CAPTURE is enabled, try to return full bodies (but still capped)
    FULL_CAPTURE: true,
    FULL_CAPTURE_MAX_TEXT_LEN: 1000000,
    FULL_CAPTURE_MAX_BINARY_BYTES: 200000,
    redactSensitiveHeaders: true,
    sentHashMax: 3000,
    verbose: true,
  };

  const ENABLE_ANALYZE = true;
  
  // Backoff state for GAS 429 handling
  let BACKOFF_UNTIL_MS = 0;
  let BACKOFF_EXPONENT = 0;

  /*****************************************************************
   * 2) Page gate
   *****************************************************************/
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

      // restore persisted state
      try {
        loadSentHashFromStorage_();
        loadQueueFromStorage_();
      } catch (e) {}

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
    // If FULL_CAPTURE enabled, allow much larger max (but still cap)
    const effectiveMax = (CAPTURE_RULES && CAPTURE_RULES.FULL_CAPTURE)
      ? Math.max(Number(maxLen || 0), Number(CAPTURE_RULES.FULL_CAPTURE_MAX_TEXT_LEN || 1000000))
      : Number(maxLen || 0);
    if (effectiveMax <= 0) return str;
    if (str.length <= effectiveMax) return str;
    return str.slice(0, effectiveMax) + `...<truncated:${str.length - effectiveMax}>`;
  }

  const SESSION_KEY_NAME = "YS_CAPTURE_SESSION_KEY";
  function genSessionKey_() {
    try {
      const rnd = new Uint8Array(16);
      crypto.getRandomValues(rnd);
      const hex = Array.from(rnd).map((b) => b.toString(16).padStart(2, "0")).join("");
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
   * 3.1) TechNo from DOM
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
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

      if (typeof headers === 'string') {
        // parse raw header string from XHR.getAllResponseHeaders()
        const lines = headers.split(/\r?\n/);
        for (const l of lines) {
          const idx = l.indexOf(":");
          if (idx <= 0) continue;
          const k = l.slice(0, idx).trim().toLowerCase();
          const v = l.slice(idx + 1).trim();
          out[k] = v;
        }
      } else if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach((v, k) => (out[String(k).toLowerCase()] = String(v)));
      } else if (Array.isArray(headers)) {
        for (const it of headers) {
          if (!it) continue;
          out[String(it[0]).toLowerCase()] = String(it[1]);
        }
      } else if (typeof headers === "object") {
        for (const k of Object.keys(headers)) out[String(k).toLowerCase()] = String(headers[k]);
      }
    } catch (_) {
      return out;
    }

    // If FULL_CAPTURE is enabled, do not redact headers (user consent)
    if (CAPTURE_RULES.FULL_CAPTURE) return out;
    if (!CAPTURE_RULES.redactSensitiveHeaders) return out;

    const SENSITIVE = ["cookie", "authorization", "x-csrf-token", "x-xsrf-token", "csrf-token", "xsrf-token", "x-auth-token"];
    for (const k of SENSITIVE) if (k in out) out[k] = "<redacted>";
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

      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();

      if (typeof FormData !== "undefined" && body instanceof FormData) {
        const usp = new URLSearchParams();
        for (const [k, v] of body.entries()) usp.append(String(k), String(v));
        return usp.toString();
      }
      // other types (ArrayBuffer, Blob, Object) - try JSON stringify
      try {
        return JSON.stringify(body);
      } catch (_) {
        return String(body || "");
      }
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

  // Persistence keys
  const STORAGE_KEY_QUEUE = "YS_CAPTURE_QUEUE_V1";
  const STORAGE_KEY_SENT = "YS_CAPTURE_SENT_V1";

  function saveQueueToStorage_() {
    try {
      if (!CAPTURE_RULES.persistQueue) return;
      const toSave = QUEUE.slice(0, 1000); // cap
      try {
        localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(toSave));
      } catch (e) {}
    } catch (e) {}
  }

  function loadQueueFromStorage_() {
    try {
      if (!CAPTURE_RULES.persistQueue) return;
      const raw = localStorage.getItem(STORAGE_KEY_QUEUE);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      // prepend to in-memory queue
      while (arr.length) {
        QUEUE.unshift(arr.pop());
      }
    } catch (e) {}
  }

  function saveSentHashToStorage_() {
    try {
      if (!CAPTURE_RULES.persistSentHash) return;
      const arr = Array.from(SENT_HASH_FIFO || []).slice(-CAPTURE_RULES.sentHashMax);
      try {
        sessionStorage.setItem(STORAGE_KEY_SENT, JSON.stringify(arr));
      } catch (e) {}
    } catch (e) {}
  }

  function loadSentHashFromStorage_() {
    try {
      if (!CAPTURE_RULES.persistSentHash) return;
      const raw = sessionStorage.getItem(STORAGE_KEY_SENT);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (const h of arr) {
        if (!SENT_HASH.has(h)) {
          SENT_HASH.add(h);
          SENT_HASH_FIFO.push(h);
        }
      }
    } catch (e) {}
  }

  function scrubBody_(s) {
    try {
      if (CAPTURE_RULES.FULL_CAPTURE) return String(s == null ? "" : s);
      let out = String(s == null ? "" : s);
      // Email
      out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted_email>");
      // Phone (simple)
      out = out.replace(/\+?\d{2,4}[\s-]?\d{6,12}/g, "<redacted_phone>");
      // ID numbers (simple generic)
      out = out.replace(/\b\d{6,20}\b/g, "<redacted_id>");
      return out;
    } catch (e) {
      return String(s || "");
    }
  }

  function addSentHash_(h) {
    if (SENT_HASH.has(h)) return;
    SENT_HASH.add(h);
    SENT_HASH_FIFO.push(h);
    const max = Number(CAPTURE_RULES.sentHashMax || 0) || 0;
    if (max > 0 && SENT_HASH_FIFO.length > max) {
      const old = SENT_HASH_FIFO.splice(0, SENT_HASH_FIFO.length - max);
      for (const x of old) SENT_HASH.delete(x);
    }
    try {
      saveSentHashToStorage_();
    } catch (e) {}
  }

  function enqueue(item) {
    QUEUE.push(item);
    log("[YS_CAPTURE] enqueue => queueLen=", QUEUE.length);
    try {
      saveQueueToStorage_();
    } catch (e) {}
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
    if (Date.now() < (BACKOFF_UNTIL_MS || 0)) return; // in backoff
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
      onload: (res) => {
        try {
          log("[YS_CAPTURE] capture sent", batch.length, "status=", res.status, "body=", truncateText_(res.responseText, 200));
          const code = Number(res.status || 0);
          // handle 429/backoff
          if (code === 429) {
            // try read Retry-After header
            try {
              const hdr = (res.responseHeaders || res.getAllResponseHeaders && res.getAllResponseHeaders()) || res.headers || {};
              let ra = 0;
              if (hdr) {
                // GM_xmlhttpRequest response doesn't always expose headers in same shape; try parse body for Retry-After
                const raMatch = String(res.responseText || "").match(/Retry-After:\s*(\d+)/i);
                if (raMatch) ra = Number(raMatch[1]);
              }
              // exponential fallback
              BACKOFF_EXPONENT = Math.min(6, (BACKOFF_EXPONENT || 0) + 1);
              const base = ra && ra > 0 ? ra * 1000 : Math.pow(2, BACKOFF_EXPONENT) * 1000;
              BACKOFF_UNTIL_MS = Date.now() + base;
              warn("[YS_CAPTURE] entering backoff until", new Date(BACKOFF_UNTIL_MS).toISOString());
            } catch (e) {}
            QUEUE.unshift(...batch);
            try { saveQueueToStorage_(); } catch (e) {}
            return;
          }

          if (code >= 200 && code < 300) {
            // success, clear exponent
            BACKOFF_EXPONENT = 0;
            // remove persisted items already removed from queue
            try { saveQueueToStorage_(); } catch (e) {}
            return;
          }

          // server error -> requeue and increase backoff
          if (code >= 500) {
            BACKOFF_EXPONENT = Math.min(6, (BACKOFF_EXPONENT || 0) + 1);
            BACKOFF_UNTIL_MS = Date.now() + Math.pow(2, BACKOFF_EXPONENT) * 1000;
            QUEUE.unshift(...batch);
            try { saveQueueToStorage_(); } catch (e) {}
            return;
          }

          // other statuses: requeue conservative
          QUEUE.unshift(...batch);
          try { saveQueueToStorage_(); } catch (e) {}
        } catch (e) {
          warn('[YS_CAPTURE] onload handler error', e);
          QUEUE.unshift(...batch);
          try { saveQueueToStorage_(); } catch (e) {}
        }
      },
      onerror: (err) => {
        warn("[YS_CAPTURE] capture send error", err);
        QUEUE.unshift(...batch);
        try { saveQueueToStorage_(); } catch (e) {}
      },
      ontimeout: () => {
        warn("[YS_CAPTURE] capture send timeout");
        QUEUE.unshift(...batch);
        try { saveQueueToStorage_(); } catch (e) {}
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

  // ✅ A) 放寬：只要在 #/master 就 forward（不需 listStatus=COMPLEX）
  function isMasterPage_() {
    const h = String(location.hash || "");
    return h.includes("#/master");
  }

  function isMasterBroadApi_(url) {
    const u = String(url || "");
    return u.includes("/api/");
  }

  function extractFromTo_(requestBody, requestUrl) {
    let from = "",
      to = "",
      size = "",
      number = "";

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

  function extractApiPathKey_(url) {
    // 目的：把 /api/booking/detail/3577 變 /api/booking/detail/:id 方便分類
    try {
      const s = String(url || "");
      if (!s.includes("/api/")) return "";
      const u = new URL(s, location.origin);
      const path = u.pathname || "";
      return path.replace(/\/\d+(?=\/|$)/g, "/:id");
    } catch (_) {
      const s = String(url || "");
      return s.replace(/\?.*$/, "").replace(/\/\d+(?=\/|$)/g, "/:id");
    }
  }

  function extractEntityId_(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    const m = s.match(/\/(\d+)(?:\?.*)?$/);
    return m ? m[1] : "";
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

  function forwardToAnalyzeMasterBroad_(record, recordHash) {
    // ✅ A) 只要 #/master 就送
    if (!isMasterPage_()) return;

    if (!isMasterBroadApi_(record.url)) return;
    if (Number(record.status) !== 200) return;
    if (!record.response || typeof record.response !== "object") return;

    const payload = {
      mode: "analyzeMasterComplex_v1",
      meta: {
        storeId: "", // 保留空（很多 API 不是店別）
        apiPathKey: extractApiPathKey_(record.url),
        entityId: extractEntityId_(record.url),
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

    sendAnalyze_(payload, `master broad-api`);
  }

  function forwardToAnalyzeAll_(record, recordHash) {
    try {
      forwardToAnalyzePerfTotal_(record, recordHash);
    } catch (e) {
      warn("[ANALYZE] perfTotal forward failed", e);
    }
    try {
      forwardToAnalyzeMasterBroad_(record, recordHash);
    } catch (e) {
      warn("[ANALYZE] master forward failed", e);
    }
  }

  /*****************************************************************
   * 6) Hook fetch
   *****************************************************************/
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const startTs = Date.now();
    const res = await _fetch.apply(this, args);

    try {
      if (!ACTIVE) return res;

      const url = normalizeFetchUrl_(args[0]);
      const opt = args[1] || {};
      if (!urlMatches(url)) return res;

      const clone = res.clone();
      let text = "";
      let json = null;
      let binarySummary = null;
      try {
        text = await clone.text();
        json = safeJsonParse(text);
      } catch (e) {
        // try binary fallback
        try {
          const buf = await clone.arrayBuffer();
            const max = (CAPTURE_RULES.FULL_CAPTURE ? Math.max(1024, Number(CAPTURE_RULES.FULL_CAPTURE_MAX_BINARY_BYTES || 200000)) : 1024);
            const len = Math.min(buf.byteLength, max);
          const view = new Uint8Array(buf.slice(0, len));
          let binStr = "";
          for (let i = 0; i < view.length; i++) binStr += String.fromCharCode(view[i]);
          const b64 = btoa(binStr);
          binarySummary = { mime: (clone.headers && clone.headers.get ? clone.headers.get('content-type') : '') || '', size: buf.byteLength, b64: b64.slice(0, 2048) };
        } catch (e2) {
          // ignore
        }
      }

      if (!json && !CAPTURE_RULES.allowNonJson && !binarySummary) return res;

      const respHeaders = CAPTURE_RULES.captureResponseHeaders && clone.headers ? sanitizeHeaders_(clone.headers) : {};

      let respOut = json && typeof json === 'object' ? json : (text ? truncateText_(text, CAPTURE_RULES.maxTextLen) : (binarySummary ? binarySummary : ''));

      const durationMs = Date.now() - startTs;

      // scrub request/response bodies
      const reqBody = bodyToString_(opt.body) || (typeof opt.body === 'string' ? opt.body : null);
      const record = {
        kind: "fetch",
        url: String(url),
        method: String(opt.method || "GET"),
        requestHeaders: sanitizeHeaders_(opt.headers || null),
        requestBody: scrubBody_(reqBody),
        status: res.status,
        response: typeof respOut === 'string' ? scrubBody_(respOut) : respOut,
        responseHeaders: respHeaders,
        timingMs: durationMs,
        client: {
          ua: navigator.userAgent || '',
          href: location.href,
        }
      };
      // indicate full-capture consent and timestamp
      if (CAPTURE_RULES.FULL_CAPTURE) {
        record.fullCapture = true;
        record.consentAt = new Date().toISOString();
      }

      const hash = await sha1Hex(JSON.stringify(record));
      if (!SENT_HASH.has(hash)) {
        addSentHash_(hash);
        enqueue({ hash, record });
        log("[YS_CAPTURE][fetch] captured:", record.url, "status=", record.status, "dur=", durationMs);

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
        const startTs = Date.now();
        xhr._cap_startTs = startTs;

        xhr.addEventListener("load", async function () {
          try {
            const rt = String(xhr.responseType || "");
            let json = null;
            let respOut = "";
            let binarySummary = null;

            try {
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
                // attempt to get textual representation or size
                try {
                  const hdrs = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : "";
                  const m = String(hdrs || "").match(/content-type:\s*([^\r\n]+)/i);
                  const mime = m ? m[1] : '';
                  // fallback: report non-text response type
                  respOut = `<non-text responseType:${rt} mime:${mime}>`;
                } catch (e) {
                  respOut = `<non-text responseType:${rt}>`;
                }
              }
            } catch (e) {}

            if (!json && !CAPTURE_RULES.allowNonJson && !respOut) return;

            const rawHdrs = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : null;
            const respHeaders = CAPTURE_RULES.captureResponseHeaders ? sanitizeHeaders_(rawHdrs) : {};

            const durationMs = Date.now() - (xhr._cap_startTs || Date.now());

            const record = {
              kind: "xhr",
              url: String(xhr._cap_url),
              method: String(xhr._cap_method || "GET"),
              requestHeaders: sanitizeHeaders_(xhr._cap_reqHeaders || null),
              requestBody: scrubBody_(reqBodyStr),
              status: xhr.status,
              response: typeof respOut === 'string' ? scrubBody_(respOut) : respOut || json,
              responseHeaders: respHeaders,
              timingMs: durationMs,
              client: { ua: navigator.userAgent || '', href: location.href }
            };
            if (CAPTURE_RULES.FULL_CAPTURE) {
              record.fullCapture = true;
              record.consentAt = new Date().toISOString();
            }

            const hash = await sha1Hex(JSON.stringify(record));
            if (!SENT_HASH.has(hash)) {
              addSentHash_(hash);
              enqueue({ hash, record });
              log("[YS_CAPTURE][xhr] captured:", record.url, "status=", record.status, "dur=", durationMs);

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
   * 8) lifecycle flush
   *****************************************************************/
  window.addEventListener("pagehide", () => {
    try {
      flushQueue();
    } catch (_) {}
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try {
        flushQueue();
      } catch (_) {}
    }
  });
})();
