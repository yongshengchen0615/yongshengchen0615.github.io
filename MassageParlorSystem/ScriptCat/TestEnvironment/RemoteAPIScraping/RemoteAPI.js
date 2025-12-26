// ==UserScript==
// @name         FULL Net Capture → GAS (DIAG)
// @namespace    http://scriptcat.org/
// @version      2.3
// @description  Capture XHR/fetch/beacon/ws/sse and send to GAS with diagnostics
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

  const FLUSH_INTERVAL_MS = 500;
  const MAX_BATCH = 20;
  const MAX_QUEUE = 2000;

  const q = [];
  let flushing = false;
  let ENQ = 0;
  let SENT = 0;

  function nowIso() { return new Date().toISOString(); }

  function enqueue(evt) {
    try {
      if (!evt) return;
      evt.pageUrl = location.href;
      evt.ua = navigator.userAgent;

      q.push(evt);
      if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);

      ENQ++;
      if (ENQ % 10 === 0) console.log("[NETCAP] enqueued=", ENQ, "queueLen=", q.length);
    } catch (e) {
      console.warn("[NETCAP] enqueue error", e);
    }
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
      if (h instanceof Headers) { h.forEach((v, k) => (out[k] = v)); return out; }
      if (Array.isArray(h)) { h.forEach(([k, v]) => (out[String(k)] = String(v))); return out; }
      if (typeof h === "object") { Object.keys(h).forEach((k) => (out[k] = String(h[k]))); return out; }
    } catch (_) {}
    return out;
  }

  function normalizeBody(body) {
    try {
      if (body == null) return null;

      if (typeof body === "string") {
        try { return JSON.parse(body); } catch (_) { return body; }
      }
      if (body instanceof FormData) {
        const out = {};
        for (const [k, v] of body.entries()) out[k] = v instanceof File ? `[File ${v.name} ${v.type} ${v.size}]` : v;
        return { __type: "FormData", ...out };
      }
      if (body instanceof Blob) return `[Blob ${body.type} ${body.size}]`;
      if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength}]`;
      if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return "[ReadableStream]";

      return JSON.parse(safeStringify(body));
    } catch (_) {
      try { return String(body); } catch (__) { return "[unserializable]"; }
    }
  }

  function flush() {
    try {
      if (flushing) return;
      if (!q.length) return;
      flushing = true;

      const batch = q.splice(0, MAX_BATCH);
      const payload = safeStringify({ mode: "netcap_v2", items: batch });

      GM_xmlhttpRequest({
        method: "POST",
        url: GAS_URL,
        headers: { "Content-Type": "application/json" },
        data: payload,
        onload: (res) => {
          flushing = false;
          SENT += batch.length;
          console.log("[NETCAP→GAS] OK", res.status, "batch=", batch.length, "sentTotal=", SENT, "resp=", String(res.responseText || "").slice(0, 120));
        },
        onerror: (err) => {
          flushing = false;
          console.warn("[NETCAP→GAS] ERROR", "batch=", batch.length, err);
          // put back to queue head (best effort)
          q.unshift(...batch);
        },
        timeout: 15000,
        ontimeout: () => {
          flushing = false;
          console.warn("[NETCAP→GAS] TIMEOUT", "batch=", batch.length);
          q.unshift(...batch);
        },
      });
    } catch (e) {
      flushing = false;
      console.warn("[NETCAP] flush error", e);
    }
  }

  setInterval(flush, FLUSH_INTERVAL_MS);

  // ---------------------------
  // XHR
  // ---------------------------
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__cap = { t: "xhr", ts: nowIso(), method: String(method || "GET").toUpperCase(), url: String(url || ""), headers: {}, start: performance.now() };
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
          respPreview: (() => { try { return String(this.responseText || "").slice(0, 200); } catch (_) { return ""; } })(),
        });
      });

      return origSend.apply(this, arguments);
    };

    console.log("[NETCAP] XHR hook OK");
  } catch (e) {
    console.warn("[NETCAP] XHR hook failed", e);
  }

  // ---------------------------
  // fetch (guarded)
  // ---------------------------
  try {
    if (typeof window.fetch === "function") {
      const origFetch = window.fetch;
      window.fetch = async function (input, init = {}) {
        const start = performance.now();
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        const headers = normalizeHeadersAny((init && init.headers) || (input && input.headers));
        const body = normalizeBody(init && init.body);

        const res = await origFetch.apply(this, arguments);

        enqueue({ t: "fetch", ts: nowIso(), method, url, headers, body, status: Number(res.status || 0), durationMs: Math.round(performance.now() - start) });
        return res;
      };
      console.log("[NETCAP] fetch hook OK");
    } else {
      console.log("[NETCAP] fetch not available; skipped");
    }
  } catch (e) {
    console.warn("[NETCAP] fetch hook failed", e);
  }

  // sendBeacon
  try {
    const orig = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (orig) {
      navigator.sendBeacon = function (url, data) {
        enqueue({ t: "beacon", ts: nowIso(), method: "POST", url: String(url || ""), headers: {}, body: normalizeBody(data), status: -1, durationMs: 0 });
        return orig(url, data);
      };
      console.log("[NETCAP] beacon hook OK");
    }
  } catch (e) {
    console.warn("[NETCAP] beacon hook failed", e);
  }

  // WebSocket
  try {
    const OrigWS = window.WebSocket;
    if (OrigWS) {
      window.WebSocket = function (url, protocols) {
        const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
        const wsUrl = String(url || "");
        enqueue({ t: "ws_open", ts: nowIso(), url: wsUrl });

        const origSend = ws.send;
        ws.send = function (data) {
          enqueue({ t: "ws_send", ts: nowIso(), url: wsUrl, body: normalizeBody(data) });
          return origSend.apply(this, arguments);
        };

        ws.addEventListener("message", (ev) => {
          const msg = (typeof ev.data === "string") ? ev.data.slice(0, 200) : normalizeBody(ev.data);
          enqueue({ t: "ws_msg", ts: nowIso(), url: wsUrl, body: msg });
        });

        ws.addEventListener("close", (ev) => enqueue({ t: "ws_close", ts: nowIso(), url: wsUrl, code: ev.code, reason: ev.reason }));
        ws.addEventListener("error", () => enqueue({ t: "ws_error", ts: nowIso(), url: wsUrl }));

        return ws;
      };
      window.WebSocket.prototype = OrigWS.prototype;
      console.log("[NETCAP] WebSocket hook OK");
    }
  } catch (e) {
    console.warn("[NETCAP] WebSocket hook failed", e);
  }

  // EventSource
  try {
    const OrigES = window.EventSource;
    if (OrigES) {
      window.EventSource = function (url, config) {
        const es = new OrigES(url, config);
        const sseUrl = String(url || "");
        enqueue({ t: "sse_open", ts: nowIso(), url: sseUrl });

        es.addEventListener("message", (ev) => enqueue({ t: "sse_msg", ts: nowIso(), url: sseUrl, body: String(ev.data || "").slice(0, 200) }));
        es.addEventListener("error", () => enqueue({ t: "sse_error", ts: nowIso(), url: sseUrl }));
        return es;
      };
      window.EventSource.prototype = OrigES.prototype;
      console.log("[NETCAP] EventSource hook OK");
    }
  } catch (e) {
    console.warn("[NETCAP] EventSource hook failed", e);
  }

  console.log("[FULL Net Capture DIAG] running", location.href);
})();
