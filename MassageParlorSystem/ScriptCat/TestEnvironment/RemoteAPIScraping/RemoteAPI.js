// ==UserScript==
// @name         NET Capture → GAS (XHR + fetch, auto schema)
// @namespace    http://scriptcat.org/
// @version      1.0
// @description  Capture ALL XHR + fetch requests and send to GAS. GAS auto creates sheet/columns.
// @match        http://yspos.youngsong.com.tw/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // ✅ 1) 你的 GAS Web App /exec
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzzDqKr3lCAsxEIsMTxYJgBmxyv17RPRKIuT2Qn0px3_DTfKKwnyTPQDCZRrMTr7vOR/exec";

  // ✅ 2) 是否要排除常見雜訊（分析/追蹤）
  const NOISE_HOSTS = [
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "facebook.com",
    "fbcdn.net",
  ];

  // ✅ 3) 是否全部送（true=全送；false=只送同網域）
  const SEND_ALL = true;

  // ✅ 4) 防爆：每 1 秒最多送 N 筆（避免把 GAS 打爆）
  const MAX_SEND_PER_SEC = 8;

  // -----------------------------------------
  // Rate limit queue
  // -----------------------------------------
  let sentInCurrentSec = 0;
  let secTick = Math.floor(Date.now() / 1000);
  const sendQueue = [];

  function enqueueSend(payload) {
    sendQueue.push(payload);
    pump();
  }

  function pump() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec !== secTick) {
      secTick = nowSec;
      sentInCurrentSec = 0;
    }
    while (sentInCurrentSec < MAX_SEND_PER_SEC && sendQueue.length) {
      sentInCurrentSec++;
      const p = sendQueue.shift();
      postToGAS(p);
    }
  }

  setInterval(pump, 120);

  function isNoise(url) {
    try {
      const u = new URL(url, location.href);
      return NOISE_HOSTS.some((h) => u.hostname.includes(h));
    } catch (_) {
      return false;
    }
  }

  function shouldCapture(url) {
    if (!SEND_ALL) {
      try {
        const u = new URL(url, location.href);
        if (u.hostname !== location.hostname) return false;
      } catch (_) {}
    }
    if (isNoise(url)) return false;
    return true;
  }

  // -----------------------------------------
  // Helpers
  // -----------------------------------------
  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch (_) { return null; }
  }

  function normalizeBody(body) {
    if (body == null) return null;

    // string: might be JSON or urlencoded
    if (typeof body === "string") {
      const js = safeJsonParse(body);
      return js !== null ? js : body;
    }

    // FormData
    if (body instanceof FormData) {
      const out = {};
      for (const [k, v] of body.entries()) {
        out[k] = v instanceof File ? `[File ${v.name} ${v.type} ${v.size}]` : v;
      }
      return { __type: "FormData", ...out };
    }

    // Blob / ArrayBuffer / others
    if (body instanceof Blob) return `[Blob ${body.type} ${body.size}]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength}]`;

    // object
    try { return JSON.parse(JSON.stringify(body)); } catch (_) {}
    return String(body);
  }

  function headersToObj(h) {
    // fetch headers can be Headers, array, or plain object
    const out = {};
    try {
      if (h instanceof Headers) {
        h.forEach((v, k) => (out[k] = v));
        return out;
      }
      if (Array.isArray(h)) {
        h.forEach(([k, v]) => (out[String(k)] = String(v)));
        return out;
      }
      if (h && typeof h === "object") {
        Object.keys(h).forEach((k) => (out[k] = String(h[k])));
        return out;
      }
    } catch (_) {}
    return out;
  }

  function postToGAS(data) {
    GM_xmlhttpRequest({
      method: "POST",
      url: GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ mode: "netcap_v1", data }),
    });
  }

  // -----------------------------------------
  // XHR Hook
  // -----------------------------------------
  (function hookXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__netcap = {
        kind: "xhr",
        method: String(method || "GET").toUpperCase(),
        url: String(url || ""),
        headers: {},
        start: Date.now(),
      };
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (this.__netcap) this.__netcap.headers[String(k)] = String(v);
      return origSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (this.__netcap) this.__netcap.body = normalizeBody(body);

      this.addEventListener("loadend", () => {
        const s = this.__netcap;
        if (!s) return;
        if (!shouldCapture(s.url)) return;

        const payload = {
          kind: s.kind,
          ts: new Date().toISOString(),
          method: s.method,
          url: s.url,
          status: Number(this.status || 0),
          durationMs: Date.now() - s.start,
          headers: s.headers,
          body: s.body ?? null,
        };

        enqueueSend(payload);
      });

      return origSend.apply(this, arguments);
    };
  })();

  // -----------------------------------------
  // fetch Hook
  // -----------------------------------------
  (function hookFetch() {
    const origFetch = window.fetch;

    window.fetch = async function (input, init = {}) {
      const start = Date.now();

      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const headers = headersToObj((init && init.headers) || (input && input.headers));
      const body = normalizeBody(init && init.body);

      const res = await origFetch.apply(this, arguments);

      try {
        if (shouldCapture(url)) {
          enqueueSend({
            kind: "fetch",
            ts: new Date().toISOString(),
            method,
            url,
            status: Number(res.status || 0),
            durationMs: Date.now() - start,
            headers,
            body: body ?? null,
          });
        }
      } catch (_) {}

      return res;
    };
  })();
})();
