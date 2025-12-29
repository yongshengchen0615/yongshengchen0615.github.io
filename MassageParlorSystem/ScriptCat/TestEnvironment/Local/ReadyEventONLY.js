// ==UserScript==
// @name         TestEnvironment Local  Ready Event ONLY (Transition to 準備, GM_xhr, Dedup + TestPlan)
// @namespace    http://scriptcat.org/
// @version      1.1
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅TestPlan：用 list 排程幾秒後送幾筆（可指定同一 userId）
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
  const INTERVAL_MS = 2000; // 每 2 秒掃一次（你原註解寫 2 分鐘，但實際是 2 秒）

  // LOG_MODE：
  // - "full"  ：詳細 log（包含回應等）
  // - "group" ：折疊群組 log（較乾淨）
  // - "off"   ：完全不印 log
  const LOG_MODE = "group";

  // 是否啟用「準備事件」送出（正式核心功能）
  const ENABLE_READY_EVENT = true;

  // 前端去重：同一位師傅、同一面板，兩次準備事件至少隔多久才允許再送
  const READY_EVENT_DEDUP_MS = 2000; // 2 秒（你原註解寫 2 分鐘，但實際是 2 秒）

  // =========================
  // ✅ 3) TestPlan：list 測試推播模組（你要的）
  // =========================
  // 目的：不用真的切狀態，也能用排程「幾秒後送幾筆」
  // 特點：全部可以指定送到同一個 userId（targetUserId）
  const TEST_PLAN = {
    enabled: true,            // ✅ 總開關（要測就 true）
    autorun: false,           // ✅ 載入後自動跑（想自動就 true）
    delayMs: 800,             // autorun 延遲

    // ✅ 你的 LINE userId（全部都送到同一人）
    // 你只要改這個就好
    targetUserId: "U974e3043db80b35e38fca1f5172fa917",

    // list：每一項代表一個批次
    // afterSec：幾秒後開始送
    // count：送幾筆（你說的人數，但這裡就是送幾次事件）
    // gapMs：同一批內每筆間隔（避免全塞同一瞬間）
    // panel：body/foot
    list: [
      { name: "batch-1", afterSec: 3, count: 10, gapMs: 300, panel: "body" },
      { name: "batch-2", afterSec: 6, count: 2,  gapMs: 300, panel: "body" },
    ],
  };

  console.log("[ReadyOnly] 🟢 start (GM_xmlhttpRequest mode)");

  // =========================
  // ✅ 4) 工具：時間字串
  // =========================
  function nowIso() {
    return new Date().toISOString();
  }

  // =========================
  // ✅ 5) DOM 工具
  // =========================
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

  // =========================
  // ✅ 6) 解析單列
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
  // ✅ 7) GM POST
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
          console.warn(`[ReadyOnly] ⚠️ sendBeacon failed${tag ? " (" + tag + ")" : ""} → fallback GM`);
        }
      }
    } catch (e) {
      if (LOG_MODE !== "off") {
        console.warn(`[ReadyOnly] ⚠️ sendBeacon error${tag ? " (" + tag + ")" : ""} → fallback GM`, e);
      }
    }

    postJsonGM(url, payload, timeoutMs);
  }

  function logGroup(title, payload) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") return console.log(title, payload);
    console.groupCollapsed(title);
    console.log("payload =", payload);
    console.groupEnd();
  }

  // =========================
  // ✅ 8) 正式核心：狀態轉換追蹤
  // =========================
  const lastStatus = new Map();
  const readySentAt = new Map();

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
        };

        postBeaconFirst(GAS_URL, evt, "ready_event", DEFAULT_TIMEOUT_MS);
        logGroup(`[ReadyOnly] ⚡ ready_event ${payloadTs} ${panel} master=${masterId}`, evt);
      }
    }

    lastStatus.set(k, nowStatus);
  }

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
  // ✅ 9) TestPlan：排程送「測試事件」（全部送同一 userId）
  // =========================
  // 注意：這裡送的是 mode=ready_event_v1，但 payload 會額外帶 targetUserId
  // 你 GAS 端只要做：若 payload.targetUserId 存在 → 直接推給該 userId
  const TEST_TIMEOUT_MS = 45000;

  function sendOneTestEvent(seq, batchName, panel, targetUserId) {
    const ts = nowIso();

    const evt = {
      mode: "ready_event_v1",
      timestamp: ts,
      panel: panel || "body",

      // 仍保留 masterId（方便 log 對照），但你可在 GAS 忽略它
      masterId: `TEST-${batchName}-${String(seq).padStart(3, "0")}`,

      status: "準備",
      index: seq,
      appointment: "TEST",
      remaining: "",
      bgStatus: "bg-test",
      colorStatus: "text-test",

      // ✅ 核心：全部送同一個 userId
      targetUserId: targetUserId,

      source: "test_plan",
      batch: batchName,
    };

    if (LOG_MODE !== "off") console.log("[TestPlan] ▶ send", batchName, "seq=", seq, "to", targetUserId, ts);

    postJsonGM(GAS_URL, evt, TEST_TIMEOUT_MS);
  }

  function runTestPlan() {
    if (!GAS_URL) return console.error("[TestPlan] missing GAS_URL");
    if (!TEST_PLAN.enabled) return console.warn("[TestPlan] TEST_PLAN.enabled=false");
    if (!TEST_PLAN.targetUserId || !String(TEST_PLAN.targetUserId).trim()) {
      return console.error("[TestPlan] missing TEST_PLAN.targetUserId");
    }

    const targetUserId = String(TEST_PLAN.targetUserId).trim();
    const list = Array.isArray(TEST_PLAN.list) ? TEST_PLAN.list : [];

    console.log("[TestPlan] 🚀 start", {
      targetUserId,
      batches: list.length,
      list,
    });

    list.forEach((job) => {
      const name = String(job.name || "batch").trim();
      const afterSec = Number(job.afterSec || 0);
      const count = Math.max(0, parseInt(job.count || 0, 10));
      const gapMs = Math.max(0, parseInt(job.gapMs || 0, 10));
      const panel = job.panel === "foot" ? "foot" : "body";

      const startDelayMs = Math.max(0, Math.round(afterSec * 1000));

      setTimeout(() => {
        console.log(`[TestPlan] ▶ batch start: ${name} afterSec=${afterSec} count=${count} gapMs=${gapMs} panel=${panel}`);

        for (let i = 1; i <= count; i++) {
          const delay = gapMs > 0 ? (i - 1) * gapMs : 0;
          setTimeout(() => sendOneTestEvent(i, name, panel, targetUserId), delay);
        }
      }, startDelayMs);
    });
  }

  // =========================
  // ✅ 10) start：啟動正式掃描 + 掛測試入口
  // =========================
  function start() {
    console.log("[ReadyOnly] ▶️ start loop", INTERVAL_MS, "ms");

    tick();
    setInterval(tick, INTERVAL_MS);

    // Console 手動觸發：
    // window.__runTestPlan()
    window.__runTestPlan = runTestPlan;

    if (TEST_PLAN.enabled && TEST_PLAN.autorun) {
      setTimeout(runTestPlan, Math.max(0, TEST_PLAN.delayMs || 0));
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
