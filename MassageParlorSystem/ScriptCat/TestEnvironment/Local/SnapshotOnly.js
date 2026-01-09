// ==UserScript==
// @name         TEL Body+Foot Snapshot ONLY (Queue + InFlight + Exponential Backoff, GM_xhr) - FULL DEBUG
// @namespace    http://scriptcat.org/
// @version      1.79
// @description  身體/腳底 snapshot_v1：change-only + 單一佇列 + in-flight 防重送 + ACK 才 commit + 指數退避重試；只用 GM_xmlhttpRequest（可驗證回應）+ 加強偵測/除錯
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @resource     gasConfigSnapshotTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/Local/gas-snapshot-config-local.json
// ==/UserScript==

(function () {
  "use strict";

  /* =========================
   * 0) Config
   * ========================= */
  const GAS_RESOURCE = "gasConfigSnapshotTEL";

  const DEFAULT_CFG = {
    GAS_URL: ""
  };

  let CFG = { ...DEFAULT_CFG };

  // 掃描頻率
  const INTERVAL_MS = 1000;

  // 送出節流：正常情況下最短間隔（ACK 成功後才會重算下一次）
  const MIN_SEND_GAP_MS = 2000;

  // 心跳：即使畫面不變也定期重送一次，避免卡死/後端重置（建議 3~10 分鐘）
  const HEARTBEAT_MS = 5 * 60 * 1000;

  // GM request timeout
  const REQUEST_TIMEOUT_MS = 20000;

  // Backoff
  const BACKOFF_BASE_MS = 800;        // 初始退避
  const BACKOFF_MAX_MS = 20000;       // 最大退避
  const BACKOFF_JITTER_MS = 250;      // 抖動避免同時重送

  // LOG_MODE: "full" | "group" | "off"
  // - full: console.log 全量
  // - group: groupCollapsed
  // - off: 幾乎不印（但仍會印重大 error）
  const LOG_MODE = "group";

  // 正式開關
  const ENABLE_SNAPSHOT = true;

  applyConfigOverrides();
  console.log("[SnapshotQ] 🟢 start (Queue + InFlight + Backoff)");
  console.log("[SnapshotQ] CFG =", CFG);

  if (!CFG.GAS_URL) {
    console.warn(
      "[SnapshotQ] ⚠️ CFG.GAS_URL is empty. Will keep scanning DOM and logging, but will NOT send network requests.\n" +
      "Check @resource JSON is valid and contains: {\"GAS_URL\":\"https://script.google.com/macros/s/.../exec\"}"
    );
  }

  /* =========================
   * 1) Utils
   * ========================= */
  function nowIso() {
    return new Date().toISOString();
  }
  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  function loadJsonOverrides() {
    try {
      if (typeof GM_getResourceText !== "function") return {};
      const raw = GM_getResourceText(GAS_RESOURCE);
      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") return {};

      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL")) out.GAS_URL = parsed.GAS_URL;
      return out;
    } catch {
      return {};
    }
  }
  function applyConfigOverrides() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverrides() };
  }
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function logGroup(title, obj) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") return console.log(title, obj);
    console.groupCollapsed(title);
    console.log(obj);
    console.groupEnd();
  }
  function hashStr(str) {
    str = String(str || "");
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  /* =========================
   * 2) DOM helpers
   * ========================= */
  function getText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, "").trim();
  }
  function getFirstSpanClass(el) {
    if (!el) return "";
    const span = el.querySelector("span[class]");
    return span ? span.className.trim() : "";
  }
  function getBgClass(el) {
    if (!el) return "";
    const cls = (el.className || "").toString();
    const m = cls.match(/\bbg-[A-Za-z0-9_-]+\b/);
    return m ? m[0] : "";
  }

  function parseRow(row) {
    const cells = row.querySelectorAll(":scope > div");
    if (cells.length < 4) return null;

    const indexCell = cells[0];
    const masterCell = cells[1];
    const statusCell = cells[2];
    const appointmentCell = cells[3];

    const indexText = getText(indexCell);
    const masterText = getText(masterCell);
    let statusText = getText(statusCell);
    const appointment = getText(appointmentCell);

    if (!masterText) return null;

    let remaining = "";
    if (/^-?\d+$/.test(statusText)) {
      remaining = parseInt(statusText, 10);
      statusText = "工作中";
    }

    const colorIndex = getFirstSpanClass(indexCell);
    const colorMaster = getFirstSpanClass(masterCell);
    const colorStatus = getFirstSpanClass(statusCell);

    const bgIndex = getBgClass(indexCell);
    const bgMaster = getBgClass(masterCell);
    const bgStatus = getBgClass(statusCell);
    const bgAppointment = getBgClass(appointmentCell);

    const idxNum = indexText ? parseInt(indexText, 10) : "";

    return {
      index: idxNum,
      sort: idxNum,
      masterId: masterText || "",
      status: statusText || "",
      appointment: appointment || "",
      remaining: remaining,
      colorIndex,
      colorMaster,
      colorStatus,
      bgIndex,
      bgMaster,
      bgStatus,
      bgAppointment,
    };
  }

  function scanPanel(panelEl) {
    if (!panelEl) return [];
    // ✅ 放寬：不要綁死 border-gray-400
    const rows = panelEl.querySelectorAll(".flex.justify-center.items-center.flex-1.border-b");
    const list = [];
    rows.forEach((row) => {
      const r = parseRow(row);
      if (r) list.push(r);
    });
    return list;
  }

  function findBodyPanel() {
    const list = document.querySelectorAll("div.flex.flex-col.flex-1.mr-2");
    for (const el of list) {
      const t = el.querySelector("div.flex.justify-center.items-center");
      if (t && t.textContent.includes("身體")) return el;
    }
    return null;
  }
  function findFootPanel() {
    const list = document.querySelectorAll("div.flex.flex-col.flex-1.ml-2");
    for (const el of list) {
      const t = el.querySelector("div.flex.justify-center.items-center");
      if (t && t.textContent.includes("腳底")) return el;
    }
    return null;
  }

  function stableRowsForHash(rows) {
    return (rows || []).map((r) => ({
      index: r.index ?? "",
      sort: r.sort ?? "",
      masterId: r.masterId ?? "",
      status: r.status ?? "",
      appointment: r.appointment ?? "",
      remaining: r.remaining ?? "",
      colorIndex: r.colorIndex ?? "",
      colorMaster: r.colorMaster ?? "",
      colorStatus: r.colorStatus ?? "",
      bgIndex: r.bgIndex ?? "",
      bgMaster: r.bgMaster ?? "",
      bgStatus: r.bgStatus ?? "",
      bgAppointment: r.bgAppointment ?? "",
    }));
  }

  /* =========================
   * 3) Network (GM + ACK)
   * ========================= */
  function postJsonGMWithAck(url, payload) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: "POST",
          url,
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          data: JSON.stringify(payload),
          timeout: REQUEST_TIMEOUT_MS,

          onload: function (resp) {
            try {
              const text = resp.responseText || "";
              const json = JSON.parse(text);
              if (json && json.ok) return resolve(json);
              return reject({
                code: "RESP_NOT_OK",
                error: (json && json.error) || "RESP_NOT_OK",
                json,
              });
            } catch (e) {
              return reject({ code: "RESP_PARSE_FAIL", error: String(e) });
            }
          },

          onerror: function (err) {
            reject({ code: "NETWORK_ERROR", error: err });
          },

          ontimeout: function () {
            reject({ code: "TIMEOUT", error: "TIMEOUT" });
          },
        });
      } catch (e) {
        reject({ code: "GM_EXCEPTION", error: String(e) });
      }
    });
  }

  /* =========================
   * 4) Queue + InFlight + Backoff state
   * ========================= */
  let lastAckHash = "";
  let lastAckMs = 0;
  let lastHeartbeatMs = 0;
  let inFlight = false;

  // latest-wins single queue
  let queuedJob = null; // { hash, payload, meta, attempt, nextTryMs }
  let latestSeenHash = "";

  function computeBackoffMs(attempt) {
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    const jitter = randInt(0, BACKOFF_JITTER_MS);
    return Math.min(BACKOFF_MAX_MS, exp + jitter);
  }

  function canSendNow() {
    const nowMs = Date.now();
    if (inFlight) return false;
    if (nowMs - lastAckMs < MIN_SEND_GAP_MS) return false;
    if (queuedJob && queuedJob.nextTryMs && nowMs < queuedJob.nextTryMs) return false;
    return true;
  }

  function enqueueLatest(payload, hash, meta) {
    if (hash && hash === lastAckHash) return;

    const nowMs = Date.now();
    const base = queuedJob && queuedJob.hash === hash ? queuedJob : null;

    queuedJob = {
      hash,
      payload,
      meta,
      attempt: base ? base.attempt : 0,
      nextTryMs: base ? base.nextTryMs : nowMs,
    };
  }

  async function pumpQueue(reason) {
    try {
      if (!ENABLE_SNAPSHOT) return;
      if (!CFG.GAS_URL) return;          // ✅ 沒 URL 不送
      if (!queuedJob) return;
      if (!canSendNow()) return;

      const job = queuedJob;

      if (job.hash === lastAckHash) {
        queuedJob = null;
        return;
      }

      inFlight = true;

      const title = `[SnapshotQ] 📤 send ${reason || ""} attempt=${job.attempt + 1} hash=${job.hash} body=${job.meta.bodyCount} foot=${job.meta.footCount} ts=${job.meta.ts}`;
      logGroup(title, { meta: job.meta, queued: true });

      try {
        const res = await postJsonGMWithAck(CFG.GAS_URL, job.payload);

        lastAckHash = job.hash;
        lastAckMs = Date.now();
        inFlight = false;

        if (queuedJob && queuedJob.hash === job.hash) queuedJob = null;

        logGroup(`[SnapshotQ] ✅ ACK hash=${job.hash}`, res);

        pumpQueue("post-ack");
      } catch (err) {
        inFlight = false;

        const errMsg = (err && (err.error || err.code)) || "UNKNOWN_ERR";
        const shouldRetry = true;

        if (!queuedJob || queuedJob.hash !== job.hash) {
          console.warn("[SnapshotQ] ⚠️ failed but superseded by newer job:", err);
          return;
        }

        if (!shouldRetry) {
          console.error("[SnapshotQ] ❌ non-retryable:", err);
          queuedJob = null;
          return;
        }

        queuedJob.attempt = (queuedJob.attempt || 0) + 1;
        const backoff = computeBackoffMs(queuedJob.attempt);
        queuedJob.nextTryMs = Date.now() + backoff;

        console.warn(
          `[SnapshotQ] ⏳ retry scheduled in ${backoff}ms (attempt=${queuedJob.attempt}) err=${errMsg}`,
          err
        );

        setTimeout(() => pumpQueue("backoff"), backoff + 5);
      }
    } catch (e) {
      console.error("[SnapshotQ] 🔥 pumpQueue crashed:", e);
      inFlight = false;
    }
  }

  /* =========================
   * 5) tick: scan -> change-only -> enqueue -> pump
   * ========================= */
  function tick() {
    try {
      if (!ENABLE_SNAPSHOT) return;

      const ts = nowIso();
      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();

      const bodyRowsRaw = scanPanel(bodyPanel);
      const footRowsRaw = scanPanel(footPanel);

      // ✅ 無論能不能送，都先印掃描狀態（解決你現在「沒偵測」的黑盒問題）
      if (LOG_MODE !== "off") {
        console.log(
          `[SnapshotQ] scan ts=${ts} GAS_URL=${CFG.GAS_URL ? "OK" : "EMPTY"} bodyPanel=${!!bodyPanel} footPanel=${!!footPanel} bodyRows=${bodyRowsRaw.length} footRows=${footRowsRaw.length}`
        );
      }

      // ✅ 沒 URL：只掃不送
      if (!CFG.GAS_URL) return;

      const bodyStable = stableRowsForHash(bodyRowsRaw);
      const footStable = stableRowsForHash(footRowsRaw);

      const snapshotHash = hashStr(JSON.stringify({ body: bodyStable, foot: footStable }));
      latestSeenHash = snapshotHash;

      const nowMs = Date.now();
      const heartbeatDue = nowMs - lastHeartbeatMs >= HEARTBEAT_MS;

      const changedSinceAck = snapshotHash !== lastAckHash;
      const shouldEnqueue = changedSinceAck || heartbeatDue;

      if (shouldEnqueue) {
        lastHeartbeatMs = nowMs;

        const bodyRows = bodyRowsRaw.map((r) => ({ timestamp: ts, ...r }));
        const footRows = footRowsRaw.map((r) => ({ timestamp: ts, ...r }));

        const payload = {
          mode: "snapshot_v1",
          timestamp: ts,
          body: bodyRows,
          foot: footRows,
        };

        enqueueLatest(payload, snapshotHash, {
          ts,
          bodyCount: bodyRows.length,
          footCount: footRows.length,
          heartbeat: heartbeatDue && !changedSinceAck,
        });

        pumpQueue(heartbeatDue && !changedSinceAck ? "heartbeat" : "changed");
      } else {
        if (LOG_MODE !== "off") console.log(`[SnapshotQ] ⏸ unchanged (${ts})`);
        pumpQueue("unchanged");
      }
    } catch (e) {
      console.error("[SnapshotQ] 🔥 tick error:", e);
    }
  }

  /* =========================
   * 6) lifecycle
   * ========================= */
  function start() {
    console.log("[SnapshotQ] ▶️ start loop", INTERVAL_MS, "ms");
    tick();
    setInterval(tick, INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        try { tick(); } catch (_) {}
        pumpQueue("visibility");
      }
    });

    window.addEventListener("pagehide", () => pumpQueue("pagehide"));
    window.addEventListener("beforeunload", () => pumpQueue("beforeunload"));
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
