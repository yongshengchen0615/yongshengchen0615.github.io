// ==UserScript==
// @name         Body+Foot Snapshot (Clean LS every 5 days)
// @namespace    http://scriptcat.org/
// @version      3.7
// @updateURL    https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/a1.js
// @description  每次掃描「身體/腳底」面板；可選全量送主GAS；localStorage 每 5 天自動清除一次；含 span 顏色 class + div 背景 bg-* class
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 設定區
  // =========================

  // 你的主GAS（若你還要照舊送全量 snapshot 就保留；不需要可改成空字串）
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbz5MZWyQjFE1eCAkKpXZCh1-hf0-rKY8wzlwWoBkVdpU8lDSOYH4IuPu1eLMX4jz_9j/exec";

  // 掃描間隔
  const INTERVAL_MS = 1000;

  // ✅ localStorage：清除週期（保留，但不再記錄 ready 狀態）
  const LS_CLEAN_TS_KEY = "__PANELSCAN_CLEAN_TS__";
  const LS_CLEAN_DAYS = 5; // 每 5 天清一次

  // ✅ log 模式：full = 完整 payload；group = 摘要+可展開
  const LOG_MODE = "group"; // "full" | "group"

  console.log("[PanelScan] 🟢 啟動：掃描 + Snapshot（每 5 天清 localStorage）");

  // =========================
  // Utils
  // =========================

  function nowIso() {
    return new Date().toISOString();
  }

  function maybeCleanLocalStorage() {
    try {
      const now = Date.now();
      const intervalMs = LS_CLEAN_DAYS * 24 * 60 * 60 * 1000;
      const lastClean = parseInt(localStorage.getItem(LS_CLEAN_TS_KEY) || "0", 10);

      if (!lastClean || now - lastClean >= intervalMs) {
        // ✅ 清除本腳本相關 key（避免誤刪其他站點資料）
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          // 只刪除你腳本命名空間的 key（可自行擴充）
          if (k.startsWith("__READY_") || k.startsWith("__PANELSCAN_")) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));

        localStorage.setItem(LS_CLEAN_TS_KEY, String(now));
        console.warn(
          `[PanelScan] 🧹 localStorage 已清除（超過 ${LS_CLEAN_DAYS} 天），removed=${keysToRemove.length}`
        );
      }
    } catch (e) {
      console.warn("[PanelScan] localStorage clean failed:", e);
    }
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

  function logPayload(ts, bodyRows, footRows, payload) {
    if (LOG_MODE === "full") {
      console.log("[PanelScan] 📤 snapshot payload =", payload);
      return;
    }
    console.groupCollapsed(
      `[PanelScan] 📤 ${ts} body=${bodyRows.length} foot=${footRows.length}`
    );
    console.log("payload =", payload);
    console.groupEnd();
  }

  // =========================
  // Main loop
  // =========================

  function tick() {
    try {
      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();

      const ts = nowIso();

      const bodyRows = scanPanel(bodyPanel).map((r) => ({ timestamp: ts, ...r }));
      const footRows = scanPanel(footPanel).map((r) => ({ timestamp: ts, ...r }));

      // ✅ 全量送主GAS snapshot（可關閉 GAS_URL）
      if (GAS_URL) {
        const payload = {
          mode: "snapshot_v1",
          timestamp: ts,
          body: bodyRows,
          foot: footRows,
        };
        postJsonNoCors(GAS_URL, payload);
        logPayload(ts, bodyRows, footRows, payload);
      }
    } catch (e) {
      console.error("[PanelScan] 🔥 tick error:", e);
    }
  }

  function start() {
    // ✅ 每 5 天自動清除一次 localStorage（僅清本腳本 key）
    maybeCleanLocalStorage();

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
