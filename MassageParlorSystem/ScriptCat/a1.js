// ==UserScript==
// @name         Body+Foot Full Snapshot (Every 1s) -> GAS
// @namespace    http://scriptcat.org/
// @version      3.0
// @updateURL    https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/a1.js
// @description  每秒掃描「身體/腳底」面板，全量用 JSON 字串送到 GAS，GAS 覆寫 Data_Body/Data_Foot
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const GAS_URL = "https://script.google.com/macros/s/AKfycbz5MZWyQjFE1eCAkKpXZCh1-hf0-rKY8wzlwWoBkVdpU8lDSOYH4IuPu1eLMX4jz_9j/exec"; // <-- 換成你的
  const INTERVAL_MS = 1000;

  console.log("[PanelScan] 🟢 啟動：每秒全量送出 身體+腳底 -> GAS");

  /* ========= 小工具 ======11111=== */

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

  // 解析一列：index / masterId / status / appointment / remaining + 顏色
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
      colorStatus
    };
  }

  function scanPanel(panelEl) {
    if (!panelEl) return [];
    const rows = panelEl.querySelectorAll(
      ".flex.justify-center.items-center.flex-1.border-b.border-gray-400"
    );
    const list = [];
    rows.forEach(row => {
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

  function postSnapshot(payload) {
    // 用 text/plain + no-cors，避免 preflight/CORS
    fetch(GAS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).catch(err => console.error("[PanelScan] ❌ POST 失敗:", err));
  }

  /* ========= 主循環 ========= */

  let bodyPanel = null;
  let footPanel = null;

  function tick() {
    try {
      // 面板可能被重繪，允許每次重新抓（成本可接受）
      bodyPanel = findBodyPanel();
      footPanel = findFootPanel();

      const ts = new Date().toISOString();

      const bodyRows = scanPanel(bodyPanel).map(r => ({ timestamp: ts, ...r }));
      const footRows = scanPanel(footPanel).map(r => ({ timestamp: ts, ...r }));

      const payload = {
        mode: "snapshot_v1",
        timestamp: ts,
        body: bodyRows,
        foot: footRows
      };

      postSnapshot(payload);

      // 你要看 console 可以打開這行（但每秒會很多）
      // console.log("[PanelScan] 📤 snapshot sent", payload);

    } catch (e) {
      console.error("[PanelScan] 🔥 tick error:", e);
    }
  }

  function start() {
    console.log("[PanelScan] ▶️ start loop", INTERVAL_MS, "ms");
    tick(); // 立刻送一次
    setInterval(tick, INTERVAL_MS);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
