// ==UserScript==
// @name         TestEnvironment Local Ready Event ONLY + StressPlan List (GM_xhr, Dedup)
// @namespace    http://scriptcat.org/
// @version      2.5
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅壓測：list 排程（秒數/人數/prefix/panel/間隔/burst）
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 1) GAS Web App 端點（/exec）
  // =========================
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbzW5MQM1vMPkfTIHzojicGu4TSuPO5SbKmfRFrHy2ksxW-Y4-U-uVebDgn1p_Qmm7-T/exec";

  // =========================
  // ✅ 2) 正式掃描設定（定時掃描 DOM）
  // =========================
  const INTERVAL_MS = 2000; // 每 2000ms 掃一次（若要 2 分鐘=120000）

  // LOG_MODE：
  // - "full"  ：詳細 log
  // - "group" ：折疊群組 log
  // - "off"   ：完全不印 log
  const LOG_MODE = "group";

  // 是否啟用「準備事件」送出（正式核心功能）
  const ENABLE_READY_EVENT = true;

  // 正式端去重：同一位師傅、同一面板，兩次準備事件至少隔多久才允許再送
  const READY_EVENT_DEDUP_MS = 2000; // 2000ms（若要 2 分鐘=120000）

  // =========================
  // ✅ 3) 壓測 list 排程模組（預設關閉）
  // =========================
  const STRESS_PLAN = {
    enabled: true, // ✅ 壓測總開關（正式預設 false）
    autorun: true, // ✅ 是否載入後自動跑（建議 false）
    delayMs: 1500,  // autorun 延遲（ms）

    // ✅ list：可排多組
    // afterSec：幾秒後開始
    // count：人數
    // prefix：masterId 前綴（你要的「組數的開頭字母」）
    // panel：body 或 foot
    // burst：true=同時全部送；false=依 gapMs 間隔送
    // gapMs：burst=false 時每筆間隔
    // timeoutMs：GM 超時（GAS lock/寫表慢建議 45000）
    // startIndex：序號起始（預設 1 → prefix001）
    // pad：補零位數（預設 3）
    list: [
      // 範例（需要就打開 enabled + Console 跑）
       { afterSec: 1,  count: 10, prefix: "A", panel: "body", burst: true, gapMs: 600, timeoutMs: 45000 },
       { afterSec: 5, count: 2, prefix: "B", panel: "foot", burst: true, gapMs: 600, timeoutMs: 45000 },
    ],
  };

  console.log("[ReadyOnly] 🟢 start (GM_xmlhttpRequest mode)");

  // =========================
  // ✅ 4) 工具：ISO 時間
  // =========================
  function nowIso() {
    return new Date().toISOString();
  }

  // =========================
  // ✅ 5) DOM 工具：取文字（去空白）
  // =========================
  function getText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, "").trim();
  }

  // =========================
  // ✅ 6) DOM 工具：取狀態欄第一個 span 的 class
  // =========================
  function getFirstSpanClass(el) {
    if (!el) return "";
    const span = el.querySelector("span[class]");
    return span ? span.className.trim() : "";
  }

  // =========================
  // ✅ 7) DOM 工具：從 className 抓 bg-*
  // =========================
  function getBgClass(el) {
    if (!el) return "";
    const cls = (el.className || "").toString();
    const m = cls.match(/\bbg-[A-Za-z0-9_-]+\b/);
    return m ? m[0] : "";
  }

  // =========================
  // ✅ 8) 解析單列師傅資料（1 row -> object）
  // =========================
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

    // 若 statusText 是純數字 -> 工作中 + remaining
    let remaining = "";
    if (/^-?\d+$/.test(statusText)) {
      remaining = parseInt(statusText, 10);
      statusText = "工作中";
    }

    const colorStatus = getFirstSpanClass(statusCell);
    const bgStatus = getBgClass(statusCell);

    const idxNum = indexText ? parseInt(indexText, 10) : "";

    return {
      index: idxNum,
      sort: idxNum,
      masterId: masterText || "",
      status: statusText || "",
      appointment: appointment || "",
      remaining: remaining,
      bgStatus,
      colorStatus,
    };
  }

  // =========================
  // ✅ 9) 掃描某個面板取得所有列資料
  // =========================
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

  // =========================
  // ✅ 10) 找到「身體」面板容器
  // =========================
  function findBodyPanel() {
    const list = document.querySelectorAll("div.flex.flex-col.flex-1.mr-2");
    for (const el of list) {
      const t = el.querySelector("div.flex.justify-center.items-center");
      if (t && t.textContent.includes("身體")) return el;
    }
    return null;
  }

  // =========================
  // ✅ 11) 找到「腳底」面板容器
  // =========================
  function findFootPanel() {
    const list = document.querySelectorAll("div.flex.flex-col.flex-1.ml-2");
    for (const el of list) {
      const t = el.querySelector("div.flex.justify-center.items-center");
      if (t && t.textContent.includes("腳底")) return el;
    }
    return null;
  }

  // =========================
  // ✅ 12) 網路送出：GM_xmlhttpRequest
  // =========================
  const DEFAULT_TIMEOUT_MS = 8000;

  function postJsonGM(url, payload, timeoutMs) {
    if (!url) return;
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        data: JSON.stringify(payload),
        timeout: timeoutMs || DEFAULT_TIMEOUT_MS,

        onload: function (res) {
          if (LOG_MODE === "full") {
            const txt = (res.responseText || "").replace(/\s+/g, " ").slice(0, 200);
            console.log("[ReadyOnly] ✅", res.status, "resp:", txt);
          }
        },

        onerror: function (err) {
          console.error("[ReadyOnly] ❌ GM POST failed:", err);
        },

        ontimeout: function () {
          console.error(
            "[ReadyOnly] ❌ GM POST timeout",
            "(timeout_ms=" + (timeoutMs || DEFAULT_TIMEOUT_MS) + ")"
          );
        },
      });
    } catch (e) {
      console.error("[ReadyOnly] ❌ GM exception:", e);
    }
  }

  // =========================
  // ✅ 13) 送出策略：sendBeacon 優先，失敗再 fallback GM
  // =========================
  function postBeaconFirst(url, payload, tag, timeoutMs) {
    if (!url) return;

    try {
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "text/plain;charset=utf-8",
        });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return;

        if (LOG_MODE !== "off") {
          console.warn(
            `[ReadyOnly] ⚠️ sendBeacon failed${tag ? " (" + tag + ")" : ""} → fallback GM`
          );
        }
      }
    } catch (e) {
      if (LOG_MODE !== "off") {
        console.warn(
          `[ReadyOnly] ⚠️ sendBeacon error${tag ? " (" + tag + ")" : ""} → fallback GM`,
          e
        );
      }
    }

    postJsonGM(url, payload, timeoutMs);
  }

  // =========================
  // ✅ 14) Log 工具：group/console 控制
  // =========================
  function logGroup(title, payload) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") return console.log(title, payload);
    console.groupCollapsed(title);
    console.log("payload =", payload);
    console.groupEnd();
  }

  // =========================
  // ✅ 15) 正式核心：狀態轉換追蹤（非準備 -> 準備）
  // =========================
  const lastStatus = new Map();   // key -> last status
  const readySentAt = new Map();  // key -> last sent ms

  function statusKey(panel, masterId) {
    return `${panel}::${masterId}`;
  }

  function maybeSendReadyEvent(panel, row, payloadTs) {
    if (!ENABLE_READY_EVENT || !GAS_URL) return;
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
          source: "prod",
        };

        postBeaconFirst(GAS_URL, evt, "ready_event", DEFAULT_TIMEOUT_MS);
        logGroup(`[ReadyOnly] ⚡ ready_event ${payloadTs} ${panel} master=${masterId}`, evt);
      }
    }

    lastStatus.set(k, nowStatus);
  }

  // =========================
  // ✅ 16) tick：掃描身體+腳底
  // =========================
  function tick() {
    try {
      if (!ENABLE_READY_EVENT || !GAS_URL) return;

      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();
      const ts = nowIso();

      const bodyRows = scanPanel(bodyPanel);
      const footRows = scanPanel(footPanel);

      bodyRows.forEach((r) => maybeSendReadyEvent("body", r, ts));
      footRows.forEach((r) => maybeSendReadyEvent("foot", r, ts));
    } catch (e) {
      console.error("[ReadyOnly] 🔥 tick error:", e);
    }
  }

  // =========================
  // ✅ 17) 壓測 list 模組：masterId 產生器
  // =========================
  function makePlannedMasterId(prefix, seq, pad) {
    const p = String(prefix || "T");
    const w = Number.isFinite(pad) ? pad : 3;
    return p + String(seq).padStart(w, "0");
  }

  // =========================
  // ✅ 18) 壓測 list 模組：送出單筆（依 plan item）
  // =========================
  function sendOnePlanned(planItem, i) {
    const ts = nowIso();
    const startIndex = Number.isFinite(planItem.startIndex) ? planItem.startIndex : 1;
    const pad = Number.isFinite(planItem.pad) ? planItem.pad : 3;

    const seq = startIndex + i;
    const masterId = makePlannedMasterId(planItem.prefix, seq, pad);

    const evt = {
      mode: "ready_event_v1",
      timestamp: ts,
      panel: planItem.panel || "body",
      masterId,
      status: "準備",
      index: seq,
      appointment: "TEST",
      remaining: "",
      bgStatus: "bg-test",
      colorStatus: "text-test",
      source: "stress_plan",
      planAfterSec: planItem.afterSec ?? "",
      planPrefix: planItem.prefix ?? "",
    };

    if (LOG_MODE !== "off") console.log("[StressPlan] ▶ send", masterId, ts, "panel=", evt.panel);

    postJsonGM(GAS_URL, evt, planItem.timeoutMs || 45000);
  }

  // =========================
  // ✅ 19) 壓測 list 模組：跑單一 group
  // =========================
  function runOnePlan(planItem) {
    if (!planItem) return;
    const count = Number(planItem.count || 0);
    if (!count || count <= 0) return;

    const burst = !!planItem.burst;
    const gapMs = Number(planItem.gapMs || 0);

    console.log(
      `[StressPlan] 🚀 group start: afterSec=${planItem.afterSec}s count=${count} prefix=${planItem.prefix} panel=${planItem.panel} burst=${burst} gapMs=${gapMs}`
    );

    if (burst) {
      for (let i = 0; i < count; i++) sendOnePlanned(planItem, i);
    } else {
      for (let i = 0; i < count; i++) {
        setTimeout(() => sendOnePlanned(planItem, i), i * gapMs);
      }
    }
  }

  // =========================
  // ✅ 20) 壓測 list 模組：依 list 排程多組
  // =========================
  function runStressPlan() {
    if (!GAS_URL) return console.error("[StressPlan] missing GAS_URL");
    if (!STRESS_PLAN.enabled) return console.warn("[StressPlan] STRESS_PLAN.enabled=false");
    if (!Array.isArray(STRESS_PLAN.list) || STRESS_PLAN.list.length === 0) {
      return console.warn("[StressPlan] list empty");
    }

    console.log(`[StressPlan] 🧩 schedule groups = ${STRESS_PLAN.list.length}`);

    STRESS_PLAN.list.forEach((item, idx) => {
      const afterSec = Number(item.afterSec || 0);
      const delay = Math.max(0, afterSec * 1000);

      setTimeout(() => {
        console.log(`[StressPlan] ⏱️ run group #${idx + 1}`);
        runOnePlan(item);
      }, delay);
    });
  }

  // =========================
  // ✅ 21) start：啟動正式掃描 + 掛壓測入口
  // =========================
  function start() {
    console.log("[ReadyOnly] ▶️ start loop", INTERVAL_MS, "ms");

    // 立刻跑一次
    tick();

    // 進入定時掃描
    setInterval(tick, INTERVAL_MS);

    // ✅ Console 入口
    // 用法：window.__runStressPlan()
    window.__runStressPlan = runStressPlan;

    // ✅ 可選：載入後自動跑 list 壓測（預設關閉）
    if (STRESS_PLAN.enabled && STRESS_PLAN.autorun) {
      setTimeout(runStressPlan, Math.max(0, STRESS_PLAN.delayMs || 0));
    }
  }

  // =========================
  // ✅ 22) DOM Ready 判斷
  // =========================
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
