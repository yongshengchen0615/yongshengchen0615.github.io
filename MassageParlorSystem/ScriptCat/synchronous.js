// ==UserScript==
// @name         Body+Foot Snapshot + Ready Event (Change-only)
// @namespace    http://scriptcat.org/
// @version      5.1
// @description  掃描「身體/腳底」面板；snapshot_v1 改為「變更才送」；偵測 非準備→準備 即刻送 ready_event_v1（小包）以加速 LINE 推播
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        none
//
// @updateURL    https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/synchronous.js
// @downloadURL  https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/synchronous.js
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 設定區
  // =========================

  // 主 GAS endpoint（同一支即可，同時收 snapshot_v1 / ready_event_v1）
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbz5MZWyQjFE1eCAkKpXZCh1-hf0-rKY8wzlwWoBkVdpU8lDSOYH4IuPu1eLMX4jz_9j/exec";

  // 掃描間隔
  const INTERVAL_MS = 1000;

  // ✅ log 模式：full = 完整 payload；group = 摘要+可展開；off = 不印
  const LOG_MODE = "group"; // "full" | "group" | "off"

  // ✅ 是否送 snapshot_v1（保留你的資料管線）
  const ENABLE_SNAPSHOT = true;

  // ✅ 是否送 ready_event_v1（推播快路徑）
  const ENABLE_READY_EVENT = true;

  // ✅ ready_event 防抖：同一 masterId 在 N 秒內重複觸發就忽略（避免 UI 抖動造成重送）
  const READY_EVENT_DEDUP_MS = 3000;

  console.log("[PanelScan] 🟢 啟動：掃描 + change-only snapshot + ready_event");

  // =========================
  // Utils
  // =========================

  function nowIso() {
    return new Date().toISOString();
  }

  function getText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, "").trim();
  }

  // 抓某格裡面「第一個有 class 的 span」的 className 當顏色標記
  function getFirstSpanClass(el) {
    if (!el) return "";
    const span = el.querySelector("span[class]");
    return span ? span.className.trim() : "";
  }

  // 抓元素 className 裡第一個 bg-xxx（例如 bg-CCBCBCB）
  function getBgClass(el) {
    if (!el) return "";
    const cls = (el.className || "").toString();
    const m = cls.match(/\bbg-[A-Za-z0-9_-]+\b/);
    return m ? m[0] : "";
  }

  // 簡單 hash（djb2）
  function hashStr(str) {
    str = String(str || "");
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    // 轉成無號 32-bit
    return (h >>> 0).toString(16);
  }

  function stableRowsForHash(rows) {
    // 只取穩定欄位，避免順序外的雜訊
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

  // =========================
  // Parse / Scan
  // =========================

  // 解析一列：index / masterId / status / appointment / remaining + 顏色 + 背景
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

    // 第三格是純數字 → remaining；status 視為「工作中」
    if (/^-?\d+$/.test(statusText)) {
      remaining = parseInt(statusText, 10);
      statusText = "工作中";
    }

    const colorIndex = getFirstSpanClass(indexCell);
    const colorMaster = getFirstSpanClass(masterCell);
    // 注意：statusText 是字串，不是 element。原本程式碼這裡會拿錯
    // 這裡改成用 statusCell 取 span class
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

  // 找「身體」panel（mr-2）
  function findBodyPanel() {
    const list = document.querySelectorAll("div.flex.flex-col.flex-1.mr-2");
    for (const el of list) {
      const t = el.querySelector("div.flex.justify-center.items-center");
      if (t && t.textContent.includes("身體")) return el;
    }
    return null;
  }

  // 找「腳底」panel（ml-2）
  function findFootPanel() {
    const list = document.querySelectorAll("div.flex.flex-col.flex-1.ml-2");
    for (const el of list) {
      const t = el.querySelector("div.flex.justify-center.items-center");
      if (t && t.textContent.includes("腳底")) return el;
    }
    return null;
  }

  // =========================
  // Network
  // =========================

  function postJsonNoCors(url, payload) {
    if (!url) return;
    fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).catch((err) => console.error("[PanelScan] ❌ POST 失敗:", err));
  }

  // =========================
  // Logging
  // =========================

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

  // =========================
  // Change-only + Ready detect
  // =========================

  // 上一版 snapshot hash
  let lastSnapshotHash = "";

  // 狀態記憶：panel::masterId -> status
  const lastStatus = new Map();

  // ready_event 防重：panel::masterId -> lastSentMs
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

    // 更新 lastStatus（先更新或後更新都可，這裡採「先判斷後更新」）
    const nowStatus = String(row.status || "").trim();

    const isReadyTransition = nowStatus === "準備" && prev !== "準備";

    if (isReadyTransition) {
      const nowMs = Date.now();
      const lastMs = readySentAt.get(k) || 0;
      if (nowMs - lastMs < READY_EVENT_DEDUP_MS) {
        // 防抖：短時間內略過
      } else {
        readySentAt.set(k, nowMs);

        const evt = {
          mode: "ready_event_v1",
          timestamp: payloadTs,
          panel: panel, // "body" | "foot"
          masterId: masterId,
          status: "準備",
          index: row.index ?? "",
          appointment: row.appointment ?? "",
          remaining: row.remaining ?? "",
          bgStatus: row.bgStatus ?? "",
          colorStatus: row.colorStatus ?? "",
        };

        postJsonNoCors(GAS_URL, evt);
        logGroup(`[PanelScan] ⚡ ready_event ${payloadTs} ${panel} master=${masterId}`, evt);
      }
    }

    // 最後更新狀態
    lastStatus.set(k, nowStatus);
  }

  // =========================
  // Main loop
  // =========================

  function tick() {
    try {
      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();

      const ts = nowIso();

      const bodyRowsRaw = scanPanel(bodyPanel);
      const footRowsRaw = scanPanel(footPanel);

      // ✅ 先做 ready_event 偵測（用 raw rows 即可，不需要 timestamp 展開）
      bodyRowsRaw.forEach((r) => maybeSendReadyEvent("body", r, ts));
      footRowsRaw.forEach((r) => maybeSendReadyEvent("foot", r, ts));

      // ✅ snapshot_v1：改成「變更才送」
      if (ENABLE_SNAPSHOT && GAS_URL) {
        const bodyStable = stableRowsForHash(bodyRowsRaw);
        const footStable = stableRowsForHash(footRowsRaw);

        const snapshotHash = hashStr(JSON.stringify({ body: bodyStable, foot: footStable }));

        if (snapshotHash !== lastSnapshotHash) {
          lastSnapshotHash = snapshotHash;

          const bodyRows = bodyRowsRaw.map((r) => ({ timestamp: ts, ...r }));
          const footRows = footRowsRaw.map((r) => ({ timestamp: ts, ...r }));

          const payload = {
            mode: "snapshot_v1",
            timestamp: ts,
            body: bodyRows,
            foot: footRows,
          };

          postJsonNoCors(GAS_URL, payload);
          logGroup(`[PanelScan] 📤 snapshot_changed ${ts} body=${bodyRows.length} foot=${footRows.length}`, payload);
        } else {
          // 沒變就不送
          if (LOG_MODE !== "off") {
            console.log(`[PanelScan] ⏸ snapshot unchanged (${ts})`);
          }
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
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
