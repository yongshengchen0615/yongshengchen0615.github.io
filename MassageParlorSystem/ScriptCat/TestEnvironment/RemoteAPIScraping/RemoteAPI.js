// ==UserScript==
// @name         YSPOS P_DETAIL Network Capture -> GAS
// @namespace    https://local/
// @version      2.0
// @description  Capture fetch/XHR responses on #/performance?tab=P_DETAIL and send matched payload to GAS (dedupe + SPA-safe)
// @match        https://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  /*****************************************************************
   * 0) Settings (YOU MUST EDIT)
   *****************************************************************/
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzAc4BzsBddHhjVEke_uTdDnktv82TTHcxR3KnlQeFOB4EkKaHUixq8Vd8De8vp82mCKw/exec"; // TODO: 換成你的 GAS WebApp /exec

  // 你可以先用寬鬆規則抓到「真正的 API URL」後，再縮小範圍
  const CAPTURE_RULES = {
    // 只在這個頁面啟動
    pageHashMustInclude: "#/performance",
    pageHashMustInclude2: "tab=P_DETAIL",

    // URL 命中規則：先寬鬆（建議先抓一次，看 console 後再收斂）
    // 命中任一 substring 就會被記錄/送出
    urlSubstringsAny: [
      "/performance",
      "/perf",
      "/report",
      "/detail",
      "/details",
      "P_DETAIL",
      "GetDetail",
      "getDetail",
      "api",
    ],

    // 回應 JSON 命中規則（可選）：若你已知回應結構，可加強判斷
    // 例如：包含 summary / detail / rows / data 等 key
    jsonKeysAny: ["detail", "details", "rows", "data", "summary", "list"],

    // 一次最多送出幾筆（避免 payload 太大）
    maxQueuePerFlush: 10,

    // flush 間隔（ms）
    flushIntervalMs: 1500,
  };

  /*****************************************************************
   * 1) Page gate (SPA-safe)
   *****************************************************************/
  function isTargetPage() {
    const h = String(location.hash || "");
    return h.includes(CAPTURE_RULES.pageHashMustInclude) && h.includes(CAPTURE_RULES.pageHashMustInclude2);
  }

  // SPA 切頁監聽
  let ACTIVE = false;
  let FLUSH_TIMER = null;

  function startIfNeeded() {
    const ok = isTargetPage();
    if (ok && !ACTIVE) {
      ACTIVE = true;
      console.log("[P_DETAIL_CAPTURE] START on", location.href);
      startFlushLoop();
    } else if (!ok && ACTIVE) {
      ACTIVE = false;
      console.log("[P_DETAIL_CAPTURE] STOP on", location.href);
      stopFlushLoop();
    }
  }

  // hash 變化（SPA）
  window.addEventListener("hashchange", startIfNeeded, true);
  // 初次
  startIfNeeded();

  /*****************************************************************
   * 2) Utilities
   *****************************************************************/
  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function pickTechNo() {
    // 盡量從常見地方抓 techNo（你也可以改成更精準的 DOM 解析）
    const qs = new URLSearchParams(location.search);
    if (qs.get("techNo")) return qs.get("techNo");
    const h = String(location.hash || "");
    const m = h.match(/techNo=([0-9A-Za-z_-]+)/);
    if (m) return m[1];
    // 最後嘗試：sessionStorage / localStorage 常見 key（你可依你專案調）
    return (
      sessionStorage.getItem("techNo") ||
      localStorage.getItem("techNo") ||
      ""
    );
  }

  function urlMatches(url) {
    const u = String(url || "");
    return CAPTURE_RULES.urlSubstringsAny.some((s) => u.includes(s));
  }

  function jsonLooksLikeTarget(obj) {
    if (!obj || typeof obj !== "object") return false;
    // 有任一 key 命中就算
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

  /*****************************************************************
   * 3) Queue + Dedup + Flush to GAS
   *****************************************************************/
  const QUEUE = [];
  const SENT_HASH = new Set(); // runtime dedupe（頁面存活期間）

  function enqueue(item) {
    QUEUE.push(item);
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
      url: GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 30000,
      onload: (res) => {
        console.log("[P_DETAIL_CAPTURE] sent", batch.length, "status=", res.status);
      },
      onerror: (err) => {
        console.warn("[P_DETAIL_CAPTURE] send error", err);
        // 失敗就塞回去（簡單重試）
        QUEUE.unshift(...batch);
      },
      ontimeout: () => {
        console.warn("[P_DETAIL_CAPTURE] send timeout");
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

      // 若是 JSON 且看起來像目標資料才送（避免送 HTML/JS）
      if (json && !jsonLooksLikeTarget(json)) return res;

      const record = {
        kind: "fetch",
        url: String(url),
        method: String(opt.method || "GET"),
        requestHeaders: opt.headers || null,
        requestBody: opt.body || null,
        status: res.status,
        response: json || text,
      };

      const hash = await sha1Hex(JSON.stringify(record));
      if (!SENT_HASH.has(hash)) {
        SENT_HASH.add(hash);
        enqueue({ hash, record });
        console.log("[P_DETAIL_CAPTURE][fetch] captured:", record.url, "status=", record.status);
      }
    } catch (e) {
      // 不要讓頁面壞掉
      console.warn("[P_DETAIL_CAPTURE][fetch] hook failed", e);
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

            if (json && !jsonLooksLikeTarget(json)) return;

            const record = {
              kind: "xhr",
              url: String(xhr._cap_url),
              method: String(xhr._cap_method || "GET"),
              requestBody: reqBody || null,
              status: xhr.status,
              response: json || text,
            };

            const hash = await sha1Hex(JSON.stringify(record));
            if (!SENT_HASH.has(hash)) {
              SENT_HASH.add(hash);
              enqueue({ hash, record });
              console.log("[P_DETAIL_CAPTURE][xhr] captured:", record.url, "status=", record.status);
            }
          } catch (e) {
            console.warn("[P_DETAIL_CAPTURE][xhr] parse failed", e);
          }
        });
      }
    } catch (e) {
      console.warn("[P_DETAIL_CAPTURE][xhr] hook failed", e);
    }

    return _send.apply(this, arguments);
  };

  /*****************************************************************
   * 6) Page lifecycle flush (best-effort)
   *****************************************************************/
  window.addEventListener("pagehide", () => {
    try { flushQueue(); } catch (_) {}
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try { flushQueue(); } catch (_) {}
    }
  });
})();
