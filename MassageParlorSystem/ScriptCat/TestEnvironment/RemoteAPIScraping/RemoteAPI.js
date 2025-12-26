// ==UserScript==
// @name         Net Capture → GAS (fetch/xhr/beacon/ws/sse) + Batch + Dedup
// @namespace    http://scriptcat.org/
// @version      2.5
// @description  Capture network calls (best-effort) and send to GAS via GM_xmlhttpRequest
// @match        http://yspos.youngsong.com.tw/*
// @match        https://yspos.youngsong.com.tw/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  "use strict";

  /***********************
   * 0) Config
   ***********************/
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzzDqKr3lCAsxEIsMTxYJgBmxyv17RPRKIuT2Qn0px3_DTfKKwnyTPQDCZRrMTr7vOR/exec"; // ← 換成你的
  const FLUSH_INTERVAL_MS = 800;      // 批次送出頻率
  const MAX_BATCH = 20;              // 單次最多送幾筆
  const MAX_QUEUE = 300;             // 佇列上限（避免爆）
  const DEDUP_MS = 1200;             // 去重時間窗
  const CAPTURE_BODY_MAX = 2000;     // body 最多存幾字（避免太大）
  const CAPTURE_HEADERS = false;     // 建議先 false（避免敏感資訊外洩）

  // 可選：只抓特定 API（白名單）。空陣列=全抓。
  const URL_ALLOWLIST = [
    // "/api/",
    // "master",
  ];

  // 可選：黑名單（例如排除靜態檔、圖片、第三方）
  const URL_BLOCKLIST = [
    ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2",
    "google-analytics", "doubleclick", "googletagmanager"
  ];

  /***********************
   * 1) Small utils
   ***********************/
  const nowIso = () => new Date().toISOString();

  function safeToString(x) {
    try {
      if (x == null) return "";
      if (typeof x === "string") return x;
      if (x instanceof URLSearchParams) return x.toString();
      if (x instanceof FormData) {
        const o = {};
        for (const [k, v] of x.entries()) o[k] = String(v);
        return JSON.stringify(o);
      }
      if (x instanceof Blob) return `[Blob size=${x.size} type=${x.type}]`;
      if (x instanceof ArrayBuffer) return `[ArrayBuffer byteLength=${x.byteLength}]`;
      if (typeof x === "object") return JSON.stringify(x);
      return String(x);
    } catch (e) {
      return `[unstringifiable:${Object.prototype.toString.call(x)}]`;
    }
  }

  function clip(s, max) {
    if (!s) return s;
    s = String(s);
    return s.length > max ? s.slice(0, max) + `…(clipped ${s.length - max})` : s;
  }

  function passUrl(url) {
    try {
      const u = String(url || "");
      const lower = u.toLowerCase();

      if (URL_BLOCKLIST.some(x => lower.includes(String(x).toLowerCase()))) return false;

      if (!URL_ALLOWLIST || URL_ALLOWLIST.length === 0) return true;
      return URL_ALLOWLIST.some(x => u.includes(x));
    } catch {
      return true;
    }
  }

  function hashLite(str) {
    // 輕量 hash（去重用，不追求安全）
    str = String(str || "");
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /***********************
   * 2) Queue + batch flush
   ***********************/
  const queue = [];
  const dedupMap = new Map(); // key -> lastTs

  function enqueue(evt) {
    try {
      if (!evt || !passUrl(evt.url)) return;

      // 去重 key：method+url+body(前一段)
      const bodyKey = evt.requestBody ? evt.requestBody.slice(0, 200) : "";
      const key = `${evt.type}|${evt.method}|${evt.url}|${bodyKey}`;
      const k = hashLite(key);
      const t = Date.now();
      const last = dedupMap.get(k);
      if (last && (t - last) < DEDUP_MS) return;
      dedupMap.set(k, t);

      queue.push(evt);
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    } catch {}
  }

  function flush() {
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);

    const payload = {
      mode: "netCaptureBatch",
      page: location.href,
      ua: navigator.userAgent,
      ts: nowIso(),
      items: batch,
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 15000,
      onload: () => {},
      onerror: () => {
        // 失敗塞回去（簡單回填）
        queue.unshift(...batch);
      },
      ontimeout: () => {
        queue.unshift(...batch);
      },
    });
  }

  setInterval(flush, FLUSH_INTERVAL_MS);

  /***********************
   * 3) Hook: fetch
   ***********************/
  const _fetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const start = Date.now();
    const url = (typeof input === "string") ? input : (input && input.url) || "";
    const method = (init && init.method) || (input && input.method) || "GET";

    let reqBody = "";
    try {
      reqBody = clip(safeToString(init.body), CAPTURE_BODY_MAX);
    } catch {}

    const evtBase = {
      type: "fetch",
      time: nowIso(),
      url: String(url),
      method: String(method).toUpperCase(),
      requestBody: reqBody,
      // headers 可能含 token/cookie，預設不抓
      requestHeaders: CAPTURE_HEADERS ? safeToString(init.headers) : "",
    };

    try {
      const res = await _fetch.apply(this, arguments);
      // clone 一份讀 body（避免影響原本使用）
      let resText = "";
      try {
        const clone = res.clone();
        // 只讀 text，避免大量 binary
        resText = clip(await clone.text(), CAPTURE_BODY_MAX);
      } catch {}

      enqueue({
        ...evtBase,
        status: res.status,
        ok: res.ok,
        durationMs: Date.now() - start,
        responseBody: resText,
      });
      return res;
    } catch (err) {
      enqueue({
        ...evtBase,
        status: -1,
        ok: false,
        durationMs: Date.now() - start,
        error: String(err && err.message ? err.message : err),
      });
      throw err;
    }
  };

  /***********************
   * 4) Hook: XMLHttpRequest
   ***********************/
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cap = { method: String(method).toUpperCase(), url: String(url), headers: {} };
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (this.__cap && CAPTURE_HEADERS) this.__cap.headers[String(k)] = String(v);
    } catch {}
    return _setRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const start = Date.now();
    const cap = this.__cap || { method: "GET", url: "" };
    const reqBody = clip(safeToString(body), CAPTURE_BODY_MAX);

    const onLoadEnd = () => {
      try {
        const resText = clip(safeToString(this.responseText), CAPTURE_BODY_MAX);
        enqueue({
          type: "xhr",
          time: nowIso(),
          url: cap.url,
          method: cap.method,
          requestBody: reqBody,
          requestHeaders: CAPTURE_HEADERS ? safeToString(cap.headers) : "",
          status: this.status,
          ok: this.status >= 200 && this.status < 400,
          durationMs: Date.now() - start,
          responseBody: resText,
        });
      } catch {}
      this.removeEventListener("loadend", onLoadEnd);
    };

    this.addEventListener("loadend", onLoadEnd);
    return _send.apply(this, arguments);
  };

  /***********************
   * 5) Hook: sendBeacon
   ***********************/
  if (navigator.sendBeacon) {
    const _beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      enqueue({
        type: "beacon",
        time: nowIso(),
        url: String(url),
        method: "POST",
        requestBody: clip(safeToString(data), CAPTURE_BODY_MAX),
      });
      return _beacon(url, data);
    };
  }

  /***********************
   * 6) Hook: WebSocket (metadata + send payload)
   *     注意：看不到 server->client frame 內容的話也能靠 message event 取到文字訊息
   ***********************/
  const _WS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new _WS(url, protocols) : new _WS(url);

    try {
      enqueue({ type: "ws_open", time: nowIso(), url: String(url), method: "WS" });
    } catch {}

    const _sendWs = ws.send;
    ws.send = function (data) {
      enqueue({
        type: "ws_send",
        time: nowIso(),
        url: String(url),
        method: "WS",
        requestBody: clip(safeToString(data), CAPTURE_BODY_MAX),
      });
      return _sendWs.apply(this, arguments);
    };

    ws.addEventListener("message", (ev) => {
      // 只記錄 text/binary 描述，不做重度解析
      enqueue({
        type: "ws_message",
        time: nowIso(),
        url: String(url),
        method: "WS",
        responseBody: clip(safeToString(ev.data), CAPTURE_BODY_MAX),
      });
    });

    ws.addEventListener("close", (ev) => {
      enqueue({
        type: "ws_close",
        time: nowIso(),
        url: String(url),
        method: "WS",
        status: ev.code,
        ok: true,
      });
    });

    return ws;
  };
  window.WebSocket.prototype = _WS.prototype;

  /***********************
   * 7) Hook: EventSource (SSE)
   ***********************/
  if (window.EventSource) {
    const _ES = window.EventSource;
    window.EventSource = function (url, config) {
      const es = new _ES(url, config);
      enqueue({ type: "sse_open", time: nowIso(), url: String(url), method: "SSE" });

      es.addEventListener("message", (ev) => {
        enqueue({
          type: "sse_message",
          time: nowIso(),
          url: String(url),
          method: "SSE",
          responseBody: clip(safeToString(ev.data), CAPTURE_BODY_MAX),
        });
      });

      es.addEventListener("error", () => {
        enqueue({ type: "sse_error", time: nowIso(), url: String(url), method: "SSE", ok: false });
      });

      return es;
    };
    window.EventSource.prototype = _ES.prototype;
  }

  console.log("[NetCapture] installed");
})();
