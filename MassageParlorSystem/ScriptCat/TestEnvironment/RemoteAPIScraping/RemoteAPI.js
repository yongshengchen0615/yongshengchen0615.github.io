// ==UserScript==
// @name         FULL Net Capture → GAS (XHR/fetch/beacon/ws/sse)
// @namespace    http://scriptcat.org/
// @version      2.1
// @description  Capture as much as possible from JS network APIs and send to GAS (bypass CSP)
// @match        http://yspos.youngsong.com.tw/*
// @match        https://yspos.youngsong.com.tw/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  "use strict";

  const GAS_URL = "https://script.google.com/macros/s/AKfycbzzDqKr3lCAsxEIsMTxYJgBmxyv17RPRKIuT2Qn0px3_DTfKKwnyTPQDCZRrMTr7vOR/exec";

  // === throughput guard (avoid GAS quota/429) ===
  const FLUSH_INTERVAL_MS = 500;
  const MAX_BATCH = 20;          // per flush
  const MAX_QUEUE = 2000;        // drop oldest if too much

  const q = [];
  let flushing = false;

  function nowIso() { return new Date().toISOString(); }

  function enqueue(evt) {
    if (!evt) return;
    evt.pageUrl = location.href;
    evt.ua = navigator.userAgent;

    q.push(evt);
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE); // drop oldest
  }

  function safeStringify(x) {
    const seen = new WeakSet();
    return JSON.stringify(x, function (k, v) {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    });
  }

  function normalizeHeadersAny(h) {
    const out = {};
    try {
      if (!h) return out;
      if (h instanceof Headers) {
        h.forEach((v, k) => (out[k] = v));
        return out;
      }
      if (Array.isArray(h)) {
        h.forEach(([k, v]) => (out[String(k)] = String(v)));
        return out;
      }
      if (typeof h === "object") {
        Object.keys(h).forEach((k) => (out[k] = String(h[k])));
        return out;
      }
    } catch (_) {}
    return out;
  }

  function normalizeBody(body) {
    if (body == null) return null;

    if (typeof body === "string") {
      try { return JSON.parse(body); } catch (_) { return body; }
    }

    if (body instanceof FormData) {
      const out = {};
      for (const [k, v] of body.entries()) {
        out[k] = v instanceof File ? `[File ${v.name} ${v.type} ${v.size}]` : v;
      }
      return { __type: "FormData", ...out };
    }

    if (body instanceof Blob) return `[Blob ${body.type} ${body.size}]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength}]`;

    // Request/Response body streams are not safely readable here; keep tag
    if (body instanceof ReadableStream) return "[ReadableStream]";

    try { return JSON.parse(safeStringify(body)); } catch (_) {}
    return String(body);
  }

  function flush() {
    if (flushing) return;
    if (!q.length) return;
    flushing = true;

    const batch = q.splice(0, MAX_BATCH);
    GM_xmlhttpRequest({
      method: "POST",
      url: GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: safeStringify({ mode: "netcap_v2", items: batch }),
      onload: () => { flushing = false; },
      onerror: () => { flushing = false; },
      timeout: 15000,
      ontimeout: () => { flushing = false; },
    });
  }

  setInterval(flush, FLUSH_INTERVAL_MS);

  // ---------------------------
  // XHR
  // ---------------------------
  (function hookXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__cap = {
        t: "xhr",
        ts: nowIso(),
        method: String(method || "GET").toUpperCase(),
        url: String(url || ""),
        headers: {},
        start: performance.now(),
      };
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (this.__cap) this.__cap.headers[String(k)] = String(v);
      return origSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (this.__cap) this.__cap.body = normalizeBody(body);

      this.addEventListener("loadend", () => {
        const c = this.__cap;
        if (!c) return;
        enqueue({
          ...c,
          status: Number(this.status || 0),
          durationMs: Math.round(performance.now() - c.start),
          // response preview optional; keep short to avoid huge logs
          respPreview: (() => {
            try { return String(this.responseText || "").slice(0, 300); } catch (_) { return ""; }
          })(),
        });
      });

      return origSend.apply(this, arguments);
    };
  })();

  // ---------------------------
  // fetch
  // ---------------------------
  (function hookFetch() {
    const origFetch = window.fetch;

    window.fetch = async function (input, init = {}) {
      const start = performance.now();
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const headers = normalizeHeadersAny((init && init.headers) || (input && input.headers));
      const body = normalizeBody(init && init.body);

      const res = await origFetch.apply(this, arguments);

      enqueue({
        t: "fetch",
        ts: nowIso(),
        method,
        url,
        headers,
        body,
        status: Number(res.status || 0),
        durationMs: Math.round(performance.now() - start),
      });

      return res;
    };
  })();

  // ---------------------------
  // sendBeacon
  // ---------------------------
  (function hookBeacon() {
    const orig = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (!orig) return;

    navigator.sendBeacon = function (url, data) {
      try {
        enqueue({
          t: "beacon",
          ts: nowIso(),
          method: "POST",
          url: String(url || ""),
          headers: {},
          body: normalizeBody(data),
          status: -1,
          durationMs: 0,
        });
      } catch (_) {}
      return orig(url, data);
    };
  })();

  // ---------------------------
  // WebSocket
  // ---------------------------
  (function hookWS() {
    const OrigWS = window.WebSocket;
    if (!OrigWS) return;

    window.WebSocket = function (url, protocols) {
      const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
      const wsUrl = String(url || "");

      enqueue({ t: "ws_open", ts: nowIso(), url: wsUrl });

      const origSend = ws.send;
      ws.send = function (data) {
        try {
          enqueue({
            t: "ws_send",
            ts: nowIso(),
            url: wsUrl,
            body: normalizeBody(data),
          });
        } catch (_) {}
        return origSend.apply(this, arguments);
      };

      ws.addEventListener("message", (ev) => {
        try {
          // message may be huge; preview only
          const msg = (typeof ev.data === "string") ? ev.data.slice(0, 300) : normalizeBody(ev.data);
          enqueue({ t: "ws_msg", ts: nowIso(), url: wsUrl, body: msg });
        } catch (_) {}
      });

      ws.addEventListener("close", (ev) => {
        enqueue({ t: "ws_close", ts: nowIso(), url: wsUrl, code: ev.code, reason: ev.reason });
      });

      ws.addEventListener("error", () => {
        enqueue({ t: "ws_error", ts: nowIso(), url: wsUrl });
      });

      return ws;
    };

    // keep prototype chain
    window.WebSocket.prototype = OrigWS.prototype;
  })();

  // ---------------------------
  // EventSource (SSE)
  // ---------------------------
  (function hookSSE() {
    const OrigES = window.EventSource;
    if (!OrigES) return;

    window.EventSource = function (url, config) {
      const es = new OrigES(url, config);
      const sseUrl = String(url || "");
      enqueue({ t: "sse_open", ts: nowIso(), url: sseUrl });

      es.addEventListener("message", (ev) => {
        try {
          enqueue({ t: "sse_msg", ts: nowIso(), url: sseUrl, body: String(ev.data || "").slice(0, 300) });
        } catch (_) {}
      });

      es.addEventListener("error", () => {
        enqueue({ t: "sse_error", ts: nowIso(), url: sseUrl });
      });

      return es;
    };

    window.EventSource.prototype = OrigES.prototype;
  })();

  console.log("[FULL Net Capture] running", location.href);
})();
