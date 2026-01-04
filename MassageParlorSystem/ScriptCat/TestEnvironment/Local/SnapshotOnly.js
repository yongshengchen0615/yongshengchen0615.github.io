// ==UserScript==
// @name        TEL  Body+Foot Snapshot ONLY (Queue + InFlight + Exponential Backoff, GM_xhr)
// @namespace    http://scriptcat.org/
// @version      1.80
// @description  身體/腳底 snapshot_v1：change-only + 單一佇列 + in-flight 防重送 + ACK 才 commit + 指數退避重試；只用 GM_xmlhttpRequest（可驗證回應）
// @match        https://yongshengchen0615.github.io/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @resource     gasConfigSnapshotTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/Local/gas-snapshot-config-local.json
// ==/UserScript==

(function () {
  "use strict";

  console.log("[SnapshotQ] 🧩 injected on", location.href);

  /* =========================
   * 0) Config------
   * ========================= */
  const GAS_RESOURCE = "gasConfigSnapshotTEL";
  const FALLBACK_CONFIG_URL = new URL("gas-snapshot-config-local.json", location.href).href;

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
  const LOG_MODE = "group";

  // 正式開關
  const ENABLE_SNAPSHOT = true;

  // 註：Local 測試環境常見情境是 ScriptCat 沒把本機檔名自動當作 @resource 綁定。
  // 我們會在 start() 內再嘗試用同網域抓取 JSON（master.html 同資料夾）。

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
      if (typeof raw !== "string" || raw.trim() === "") {
        console.warn(
          `[Config] @resource '${GAS_RESOURCE}' is empty. ` +
            `Check ScriptCat resources and ensure '@resource ${GAS_RESOURCE} gas-snapshot-config-local.json' is actually attached to this script.`
        );
        return {};
      }
      const parsed = safeJsonParse(raw);
      if (!parsed) {
        console.warn(
          `[Config] @resource '${GAS_RESOURCE}' is not valid JSON. ` +
            `First 120 chars: ${String(raw).slice(0, 120)}`
        );
        return {};
      }
      if (!parsed || typeof parsed !== "object") return {};

      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL")) out.GAS_URL = parsed.GAS_URL;
      return out;
    } catch {
      return {};
    }
  }
  async function loadJsonOverridesFromUrl(url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[Config] fetch fallback failed (${res.status}) url=${url}`);
        return {};
      }
      const raw = await res.text();
      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") {
        console.warn(`[Config] fetch fallback got non-JSON url=${url} head=${String(raw).slice(0, 120)}`);
        return {};
      }

      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL")) out.GAS_URL = parsed.GAS_URL;
      return out;
    } catch (e) {
      console.warn(`[Config] fetch fallback error url=${url}`, e);
      return {};
    }
  }

  async function applyConfigOverridesAsync() {
    const fromResource = loadJsonOverrides();
    if (fromResource && fromResource.GAS_URL) {
      CFG = { ...DEFAULT_CFG, ...fromResource };
      console.log(`[Config] loaded from @resource '${GAS_RESOURCE}'`);
      return;
    }

    const fromUrl = await loadJsonOverridesFromUrl(FALLBACK_CONFIG_URL);
    if (fromUrl && fromUrl.GAS_URL) {
      CFG = { ...DEFAULT_CFG, ...fromUrl };
      console.log(`[Config] loaded from URL fallback ${FALLBACK_CONFIG_URL}`);
      return;
    }

    CFG = { ...DEFAULT_CFG };
    console.error(
      `[Config] GAS_URL is empty. Resource='${GAS_RESOURCE}'. ` +
        `Tried URL fallback: ${FALLBACK_CONFIG_URL}. ` +
        `Fix by either attaching @resource in ScriptCat, or hosting gas-snapshot-config-local.json next to master.html.`
    );
  }
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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
    const rows = panelEl.querySelectorAll(
      ".flex.justify-center.items-center.flex-1.border-b.border-gray-400"
    );
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

  // 已 ACK 的最新 hash（代表後端確實收到了）
  let lastAckHash = "";

  // 最後一次 ACK 成功時間（控制 MIN_SEND_GAP）
  let lastAckMs = 0;

  // 心跳：避免長時間 unchanged 卡死（或後端被重置）
  let lastHeartbeatMs = 0;

  // in-flight
  let inFlight = false;

  // 單一佇列：只保留「最新的一筆」(latest-wins)
  // job = { hash, payload, meta:{ts, bodyCount, footCount}, attempt, nextTryMs }
  let queuedJob = null;

  // 如果在 inFlight 時又偵測到變更，先暫存「最新 hash」避免重複 enqueue
  let latestSeenHash = "";

  function computeBackoffMs(attempt) {
    // attempt: 1,2,3...
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    const jitter = randInt(0, BACKOFF_JITTER_MS);
    return Math.min(BACKOFF_MAX_MS, exp + jitter);
  }

  function canSendNow() {
    const nowMs = Date.now();
    if (inFlight) return false;
    // 節流：以 ACK 成功為基準
    if (nowMs - lastAckMs < MIN_SEND_GAP_MS) return false;
    // 若有 nextTryMs（退避）也要尊重
    if (queuedJob && queuedJob.nextTryMs && nowMs < queuedJob.nextTryMs) return false;
    return true;
  }

  function enqueueLatest(payload, hash, meta) {
    // 如果這筆已經 ACK 過，就不用排
    if (hash && hash === lastAckHash) return;

    // latest-wins：永遠用最新 hash 覆蓋舊 job
    const nowMs = Date.now();
    const base = queuedJob && queuedJob.hash === hash ? queuedJob : null;

    queuedJob = {
      hash,
      payload,
      meta,
      attempt: base ? base.attempt : 0,
      nextTryMs: base ? base.nextTryMs : nowMs, // 預設可立刻嘗試（但仍受 canSendNow）
    };
  }

  async function pumpQueue(reason) {
    try {
      if (!ENABLE_SNAPSHOT || !CFG.GAS_URL) return;
      if (!queuedJob) return;
      if (!canSendNow()) return;

      // 取 job
      const job = queuedJob;

      // 若 job hash 已經被 ACK（極端競態）直接丟掉
      if (job.hash === lastAckHash) {
        queuedJob = null;
        return;
      }

      inFlight = true;

      const title = `[SnapshotQ] 📤 send ${reason || ""} attempt=${job.attempt + 1} hash=${job.hash} body=${job.meta.bodyCount} foot=${job.meta.footCount} ts=${job.meta.ts}`;

      // 送前 log（可關）
      logGroup(title, { meta: job.meta, queued: true });

      try {
        const res = await postJsonGMWithAck(CFG.GAS_URL, job.payload);

        // ✅ ACK 成功
        lastAckHash = job.hash;
        lastAckMs = Date.now();
        inFlight = false;

        // 只有在 queuedJob 仍是同一筆 hash 時才清掉（避免 inFlight 期間被新 hash 覆蓋）
        if (queuedJob && queuedJob.hash === job.hash) queuedJob = null;

        logGroup(`[SnapshotQ] ✅ ACK hash=${job.hash}`, res);

        // ACK 後立刻再 pump：如果在飛行中已產生新 job，可接著送（仍受 MIN_SEND_GAP 控制）
        pumpQueue("post-ack");
      } catch (err) {
        inFlight = false;

        // 決策：哪些錯誤要退避重試？
        // - LOCK_TIMEOUT / TIMEOUT / NETWORK_ERROR：重試
        // - Unknown mode / NO_POST_DATA 這種程式錯：不重試（但你的後端是固定 snapshot_v1，正常不會）
        const errMsg = (err && (err.error || err.code)) || "UNKNOWN_ERR";
        const shouldRetry = true; // snapshot 通常都應該重試（最新狀態）

        if (!queuedJob || queuedJob.hash !== job.hash) {
          // 已被新 hash 覆蓋，這筆失敗不用管
          console.warn("[SnapshotQ] ⚠️ failed but superseded by newer job:", err);
          return;
        }

        if (!shouldRetry) {
          console.error("[SnapshotQ] ❌ non-retryable:", err);
          // 丟棄這筆，避免卡死
          queuedJob = null;
          return;
        }

        // 退避重試（attempt+1）
        queuedJob.attempt = (queuedJob.attempt || 0) + 1;
        const backoff = computeBackoffMs(queuedJob.attempt);
        queuedJob.nextTryMs = Date.now() + backoff;

        console.warn(
          `[SnapshotQ] ⏳ retry scheduled in ${backoff}ms (attempt=${queuedJob.attempt}) err=${errMsg}`,
          err
        );

        // 安排下一次 pump（不靠 tick 也會跑）
        setTimeout(() => pumpQueue("backoff"), backoff + 5);
      }
    } catch (e) {
      console.error("[SnapshotQ] 🔥 pumpQueue crashed:", e);
      inFlight = false;
    }
  }

  /* =========================
   * 5) tick: scan -> change-only -> enqueue latest -> pump
   * ========================= */
  function tick() {
    try {
      if (!ENABLE_SNAPSHOT || !CFG.GAS_URL) return;

      const ts = nowIso();
      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();

      const bodyRowsRaw = scanPanel(bodyPanel);
      const footRowsRaw = scanPanel(footPanel);

      const bodyStable = stableRowsForHash(bodyRowsRaw);
      const footStable = stableRowsForHash(footRowsRaw);

      const snapshotHash = hashStr(JSON.stringify({ body: bodyStable, foot: footStable }));
      latestSeenHash = snapshotHash;

      const nowMs = Date.now();

      // 心跳：長時間 unchanged 也要送一次（避免卡死/後端重置）
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
        // 即使沒變更，也嘗試 pump（可能有 backoff 到期）
        pumpQueue("unchanged");
      }
    } catch (e) {
      console.error("[SnapshotQ] 🔥 tick error:", e);
    }
  }

  /* =========================
   * 6) lifecycle hooks
   * ========================= */
  function start() {
    applyConfigOverridesAsync().finally(() => {
      console.log("[SnapshotQ] 🟢 start (Queue + InFlight + Backoff)");
      console.log("[SnapshotQ] ▶️ start loop", INTERVAL_MS, "ms");
      tick();
      setInterval(tick, INTERVAL_MS);
    });

    // 回前景：立刻掃 + pump
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        try {
          tick();
        } catch (e) {}
        pumpQueue("visibility");
      }
    });

    // 離開頁面：嘗試最後 pump（注意：GM 不保證 beforeunload 內能完成，但至少會觸發一次）
    window.addEventListener("pagehide", () => pumpQueue("pagehide"));
    window.addEventListener("beforeunload", () => pumpQueue("beforeunload"));
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
