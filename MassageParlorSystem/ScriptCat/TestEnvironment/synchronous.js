// ==UserScript==
// @name         Body+Foot Snapshot + Ready Event (Change-only, GM_xhr, Throttle 2s, No Silent Catch)
// @namespace    http://scriptcat.org/
// @version      5.3.3
// @description  掃描「身體/腳底」面板；change-only snapshot + 最多每2秒送一次；非準備→準備 即刻送 ready_event；用 GM_xmlhttpRequest 避開 CSP；不靜默吞錯
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @updateURL    https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/synchronous.js
// @downloadURL  https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/synchronous.js
// ==/UserScript==


(function () {
  "use strict";

  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbz5MZWyQjFE1eCAkKpXZCh1-hf0-rKY8wzlwWoBkVdpU8lDSOYH4IuPu1eLMX4jz_9j/exechttps://script.google.com/macros/s/AKfycbzC8H1KKbPKkkUNejHGa3jOLDUVscFr6xzcSrlPT_QPDdo82N7ws_ZKDGQQ7aqUYV_H/exec";

  const INTERVAL_MS = 1000;
  const SNAPSHOT_THROTTLE_MS = 2000;

  const LOG_MODE = "group"; // "full" | "group" | "off"======
  const ENABLE_SNAPSHOT = true;
  const ENABLE_READY_EVENT = true;
  const READY_EVENT_DEDUP_MS = 3000;

  console.log("[PanelScan] 🟢 start (GM_xmlhttpRequest mode)");

  function nowIso() {
    return new Date().toISOString();
  }

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

  function hashStr(str) {
    str = String(str || "");
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
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

  // =========================
  // ✅ Network (GM_xmlhttpRequest)
  // =========================
  function postJsonGM(url, payload) {
    if (!url) return;
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        data: JSON.stringify(payload),
        timeout: 8000,
        onload: function () {
          // 不讀 response 也行；但這裡保留可觀測性
        },
        onerror: function (err) {
          console.error("[PanelScan] ❌ GM_xmlhttpRequest POST failed:", err);
        },
        ontimeout: function () {
          console.error("[PanelScan] ❌ GM_xmlhttpRequest POST timeout");
        },
      });
    } catch (e) {
      console.error("[PanelScan] ❌ GM_xmlhttpRequest exception:", e);
    }
  }

  function postBeaconFirst(url, payload, tag) {
    if (!url) return;

    // 先試 beacon（若 CSP 擋，通常會直接 false 或丟錯）
    try {
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "text/plain;charset=utf-8",
        });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return;
        console.warn(`[PanelScan] ⚠️ sendBeacon failed${tag ? " (" + tag + ")" : ""} → fallback GM`);
      }
    } catch (e) {
      console.warn(`[PanelScan] ⚠️ sendBeacon error${tag ? " (" + tag + ")" : ""} → fallback GM`, e);
    }

    // ✅ CSP 最穩 fallback
    postJsonGM(url, payload);
  }

  function logGroup(title, payload) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") {
      console.log(title, payload);
      return;
    }
    console.groupCollapsed(title);
    console.log("payload =", payload);
    console.groupEnd();
  }

  let lastSnapshotHash = "";
  let lastSnapshotSentMs = 0;
  let pendingSnapshot = null;
  let pendingSnapshotHash = "";

  const lastStatus = new Map();
  const readySentAt = new Map();

  function statusKey(panel, masterId) {
    return `${panel}::${masterId}`;
  }

  function maybeSendReadyEvent(panel, row, payloadTs) {
    if (!ENABLE_READY_EVENT) return;
    if (!row || !row.masterId) return;

    const masterId = String(row.masterId || "").trim();
    if (!masterId) return;

    const k = statusKey(panel, masterId);
    const prev = lastStatus.get(k) || "";
    const nowStatus = String(row.status || "").trim();

    const isReadyTransition = nowStatus === "準備" && prev !== "準備";

    if (isReadyTransition) {
      const nowMs = Date.now();
      const lastMs = readySentAt.get(k) || 0;

      if (nowMs - lastMs >= READY_EVENT_DEDUP_MS) {
        readySentAt.set(k, nowMs);

        const evt = {
          mode: "ready_event_v1",
          timestamp: payloadTs,
          panel: panel,
          masterId: masterId,
          status: "準備",
          index: row.index ?? "",
          appointment: row.appointment ?? "",
          remaining: row.remaining ?? "",
          bgStatus: row.bgStatus ?? "",
          colorStatus: row.colorStatus ?? "",
        };

        postBeaconFirst(GAS_URL, evt, "ready_event");
        logGroup(`[PanelScan] ⚡ ready_event ${payloadTs} ${panel} master=${masterId}`, evt);
      }
    }

    lastStatus.set(k, nowStatus);
  }

  function flushPendingSnapshot(force) {
    if (!pendingSnapshot) return;

    const nowMs = Date.now();
    if (!force && nowMs - lastSnapshotSentMs < SNAPSHOT_THROTTLE_MS) return;

    const { payload, title } = pendingSnapshot;

    postBeaconFirst(GAS_URL, payload, "snapshot");
    logGroup(title, payload);

    lastSnapshotSentMs = nowMs;
    lastSnapshotHash = pendingSnapshotHash;

    pendingSnapshot = null;
    pendingSnapshotHash = "";
  }

  function safeFlushPendingSnapshot(force, reason) {
    try {
      flushPendingSnapshot(force);
    } catch (e) {
      console.error(`[PanelScan] ❌ flushPendingSnapshot failed (${reason || "unknown"})`, e);
    }
  }

  function tick() {
    try {
      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();

      const ts = nowIso();

      const bodyRowsRaw = scanPanel(bodyPanel);
      const footRowsRaw = scanPanel(footPanel);

      bodyRowsRaw.forEach((r) => maybeSendReadyEvent("body", r, ts));
      footRowsRaw.forEach((r) => maybeSendReadyEvent("foot", r, ts));

      if (ENABLE_SNAPSHOT && GAS_URL) {
        const bodyStable = stableRowsForHash(bodyRowsRaw);
        const footStable = stableRowsForHash(footRowsRaw);

        const snapshotHash = hashStr(JSON.stringify({ body: bodyStable, foot: footStable }));

        if (snapshotHash !== lastSnapshotHash) {
          const bodyRows = bodyRowsRaw.map((r) => ({ timestamp: ts, ...r }));
          const footRows = footRowsRaw.map((r) => ({ timestamp: ts, ...r }));

          const payload = {
            mode: "snapshot_v1",
            timestamp: ts,
            body: bodyRows,
            foot: footRows,
          };

          pendingSnapshot = {
            payload,
            title: `[PanelScan] 📤 snapshot_changed(throttle<=2s) ${ts} body=${bodyRows.length} foot=${footRows.length}`,
          };
          pendingSnapshotHash = snapshotHash;

          safeFlushPendingSnapshot(false, "tick");
        } else {
          if (LOG_MODE !== "off") console.log(`[PanelScan] ⏸ snapshot unchanged (${ts})`);
          safeFlushPendingSnapshot(false, "tick-unchanged");
        }
      }
    } catch (e) {
      console.error("[PanelScan] 🔥 tick error:", e);
    }
  }

  function start() {
    console.log("[PanelScan] ▶️ start loop", INTERVAL_MS, "ms");
    tick();
    setInterval(tick, INTERVAL_MS);

    window.addEventListener("pagehide", () => safeFlushPendingSnapshot(true, "pagehide"));
    window.addEventListener("beforeunload", () => safeFlushPendingSnapshot(true, "beforeunload"));
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
