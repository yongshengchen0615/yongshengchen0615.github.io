// ==UserScript==
// @name         API Spy + GAS Logger (fetch + XHR)
// @namespace    scriptcat-api-spy-gas
// @version      1.0.0
// @description  Observe endpoints, save responses, and ship logs to GAS Sheet for debugging.
// @match        http://yspos.youngsong.com.tw/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
  "use strict";

  /* =========================
   * CONFIG
   * ========================= */
  const CFG = {
    // --- UI/local ---
    MAX_LOGS: 300,
    PREVIEW_LIMIT: 2000,
    BODY_LIMIT: 20000,
    STORE_KEY: "api_spy_logs_v1",

    // --- GAS shipper ---
    GAS_ENDPOINT: "https://script.google.com/macros/s/AKfycbzzDqKr3lCAsxEIsMTxYJgBmxyv17RPRKIuT2Qn0px3_DTfKKwnyTPQDCZRrMTr7vOR/exec", // <-- 改成你的 Web App URL
    GAS_API_KEY: "SPY_API_KEY",                               // <-- 改成你設定的 SPY_API_KEY
    SHIP_ENABLED: true,

    // 批次送出策略
    SHIP_BATCH_SIZE: 20,     // 每次最多送幾筆
    SHIP_FLUSH_MS: 2500,     // 有新 log 後，幾秒內批次送
    SHIP_RETRY_MAX: 6,       // 最多重試次數
    SHIP_BACKOFF_BASE_MS: 1200,
    SHIP_QUEUE_KEY: "api_spy_ship_queue_v1"
  };

  /* =========================
   * Utils
   * ========================= */
  const nowMs = () => Date.now();
  const safeJsonParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const truncate = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…(truncated)" : s);
  const toStr = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const pickHeaders = (headersObj) => {
    const out = {};
    try {
      if (!headersObj) return out;
      if (headersObj instanceof Headers) {
        headersObj.forEach((v, k) => (out[k] = v));
        return out;
      }
      for (const k of Object.keys(headersObj)) out[k] = headersObj[k];
      return out;
    } catch {
      return out;
    }
  };

  /* =========================
   * Storage (logs + ship queue)
   * ========================= */
  const loadVal = async (k, dflt) => {
    try {
      const raw = typeof GM_getValue === "function" ? await GM_getValue(k, dflt) : localStorage.getItem(k) || dflt;
      return raw;
    } catch {
      return dflt;
    }
  };
  const saveVal = async (k, v) => {
    if (typeof GM_setValue === "function") return GM_setValue(k, v);
    localStorage.setItem(k, v);
  };
  const delVal = async (k) => {
    if (typeof GM_deleteValue === "function") return GM_deleteValue(k);
    localStorage.removeItem(k);
  };

  const loadLogs = async () => {
    const raw = await loadVal(CFG.STORE_KEY, "[]");
    const arr = safeJsonParse(raw);
    return Array.isArray(arr) ? arr : [];
  };
  const saveLogs = async (logs) => saveVal(CFG.STORE_KEY, JSON.stringify(logs));

  const loadShipQueue = async () => {
    const raw = await loadVal(CFG.SHIP_QUEUE_KEY, "[]");
    const arr = safeJsonParse(raw);
    return Array.isArray(arr) ? arr : [];
  };
  const saveShipQueue = async (q) => saveVal(CFG.SHIP_QUEUE_KEY, JSON.stringify(q));

  /* =========================
   * UI (minimal: just toast; 你若要保留完整面板我也可再合併)
   * ========================= */
  const toast = (msg) => {
    let el = document.getElementById("__apiSpyToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "__apiSpyToast";
      el.style.cssText =
        "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483647;" +
        "padding:8px 10px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.88);" +
        "color:#e5e7eb;border-radius:999px;font:12px system-ui;display:none;" +
        "box-shadow:0 12px 30px rgba(0,0,0,.35);backdrop-filter: blur(10px);";
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toast.__t);
    toast.__t = setTimeout(() => (el.style.display = "none"), 900);
  };

  /* =========================
   * Shipper (batch to GAS)
   * ========================= */
  let shipTimer = null;
  let shipping = false;

  const enqueueForShip = async (entry) => {
    if (!CFG.SHIP_ENABLED) return;
    if (!CFG.GAS_ENDPOINT || !CFG.GAS_API_KEY) return;

    const q = await loadShipQueue();
    q.push({
      entry,
      retry: 0,
      nextAt: 0
    });
    await saveShipQueue(q);
    scheduleFlush();
  };

  const scheduleFlush = () => {
    if (!CFG.SHIP_ENABLED) return;
    if (shipTimer) return;
    shipTimer = setTimeout(() => {
      shipTimer = null;
      flushShipQueue().catch(() => {});
    }, CFG.SHIP_FLUSH_MS);
  };

  const flushShipQueue = async () => {
    if (shipping) return;
    shipping = true;

    try {
      let q = await loadShipQueue();
      if (!q.length) return;

      const now = nowMs();
      const ready = q.filter(x => (x.nextAt || 0) <= now);
      if (!ready.length) return;

      const batch = ready.slice(0, CFG.SHIP_BATCH_SIZE);
      const batchIds = new Set(batch.map(x => x.entry.id));

      // 先從 queue 移除這批（樂觀鎖），失敗再塞回（避免重複 flush）
      q = q.filter(x => !batchIds.has(x.entry.id));
      await saveShipQueue(q);

      const payload = {
        key: CFG.GAS_API_KEY,
        meta: {
          pageUrl: location.href,
          ua: navigator.userAgent
        },
        logs: batch.map(x => x.entry)
      };

      const res = await fetch(CFG.GAS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      let ok = false;
      try {
        const j = await res.json();
        ok = !!j && j.ok === true;
      } catch {
        ok = res.ok;
      }

      if (!ok) {
        // 送回 queue，並做重試退避
        const failed = batch.map(x => bumpRetry_(x));
        const q2 = await loadShipQueue();
        await saveShipQueue(q2.concat(failed));
        toast("GAS ship failed (queued)");
      } else {
        toast(`GAS ship ok (+${batch.length})`);
      }

    } finally {
      shipping = false;
      // 若還有資料，繼續排下一輪（不爆打）
      const q = await loadShipQueue();
      if (q.length) scheduleFlush();
    }
  };

  const bumpRetry_ = (x) => {
    const retry = (x.retry || 0) + 1;
    if (retry > CFG.SHIP_RETRY_MAX) {
      // 超過就丟棄（你也可以改成保留）
      return null;
    }
    const backoff = CFG.SHIP_BACKOFF_BASE_MS * Math.pow(2, retry - 1);
    const jitter = Math.floor(Math.random() * 500);
    return {
      entry: x.entry,
      retry,
      nextAt: nowMs() + backoff + jitter
    };
  };

  /* =========================
   * Log recorder
   * ========================= */
  let logs = [];
  const newId = () => `${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

  const pushLog = async (entry) => {
    logs.push(entry);
    if (logs.length > CFG.MAX_LOGS) logs = logs.slice(logs.length - CFG.MAX_LOGS);
    await saveLogs(logs);
    await enqueueForShip(entry);
  };

  /* =========================
   * fetch hook
   * ========================= */
  const hookFetch = () => {
    const _fetch = window.fetch;
    if (typeof _fetch !== "function") return;

    window.fetch = async function (input, init) {
      const t0 = nowMs();
      let url = "";
      let method = "GET";
      let reqHeaders = {};
      let reqBody = "";

      try {
        if (typeof input === "string") url = input;
        else if (input && input.url) url = input.url;

        method = (init && init.method) || (input && input.method) || "GET";
        reqHeaders = pickHeaders((init && init.headers) || (input && input.headers));
        reqBody = init && init.body != null ? truncate(toStr(init.body), CFG.BODY_LIMIT) : "";
      } catch {}

      const id = newId();

      try {
        const res = await _fetch.apply(this, arguments);
        const t1 = nowMs();

        let respText = "";
        let respHeaders = {};
        let status = res.status;

        try {
          respHeaders = pickHeaders(res.headers);
          const clone = res.clone();
          respText = await clone.text();
        } catch (e) {
          respText = `<<unable to read response: ${e && e.message ? e.message : e}>>`;
        }

        const entry = {
          id,
          type: "fetch",
          t0,
          t1,
          ms: t1 - t0,
          url,
          method,
          status,
          reqHeaders,
          reqBody,
          respHeaders,
          respText: truncate(respText, CFG.BODY_LIMIT),
          respPreview: truncate(respText, CFG.PREVIEW_LIMIT),
          err: ""
        };

        await pushLog(entry);
        return res;
      } catch (e) {
        const t1 = nowMs();
        await pushLog({
          id,
          type: "fetch",
          t0,
          t1,
          ms: t1 - t0,
          url,
          method,
          status: null,
          reqHeaders,
          reqBody,
          respHeaders: {},
          respText: "",
          respPreview: "",
          err: e && e.message ? e.message : String(e)
        });
        throw e;
      }
    };
  };

  /* =========================
   * XHR hook
   * ========================= */
  const hookXHR = () => {
    const XHR = window.XMLHttpRequest;
    if (!XHR) return;

    const _open = XHR.prototype.open;
    const _send = XHR.prototype.send;
    const _setRequestHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url) {
      this.__apiSpy = {
        id: newId(),
        type: "xhr",
        t0: nowMs(),
        url: url,
        method: method || "GET",
        reqHeaders: {},
        reqBody: ""
      };
      return _open.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (k, v) {
      try {
        if (this.__apiSpy) this.__apiSpy.reqHeaders[k] = v;
      } catch {}
      return _setRequestHeader.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      try {
        if (this.__apiSpy) this.__apiSpy.reqBody = body != null ? truncate(toStr(body), CFG.BODY_LIMIT) : "";
      } catch {}

      const spy = this.__apiSpy;

      const onDone = async () => {
        try { this.removeEventListener("loadend", onDone); } catch {}
        if (!spy) return;

        const t1 = nowMs();
        let respText = "";
        try {
          respText = this.responseText != null ? String(this.responseText) : "";
        } catch (e) {
          respText = `<<unable to read responseText: ${e && e.message ? e.message : e}>>`;
        }

        await pushLog({
          id: spy.id,
          type: "xhr",
          t0: spy.t0,
          t1,
          ms: t1 - spy.t0,
          url: spy.url,
          method: spy.method,
          status: this.status,
          reqHeaders: spy.reqHeaders,
          reqBody: spy.reqBody,
          respHeaders: {},
          respText: truncate(respText, CFG.BODY_LIMIT),
          respPreview: truncate(respText, CFG.PREVIEW_LIMIT),
          err: this.status === 0 ? "status=0 (可能 CORS/網路/被 abort)" : ""
        });
      };

      try { this.addEventListener("loadend", onDone); } catch {}
      return _send.apply(this, arguments);
    };
  };

  /* =========================
   * Boot
   * ========================= */
  const boot = async () => {
    logs = await loadLogs();
    hookFetch();
    hookXHR();

    // 啟動後也 flush 一次（可能有殘留 queue）
    if (CFG.SHIP_ENABLED) scheduleFlush();

    // 小提示
    setTimeout(() => {
      if (CFG.SHIP_ENABLED) toast("API Spy + GAS ship ready");
      else toast("API Spy ready");
    }, 600);
  };

  boot();
})();
