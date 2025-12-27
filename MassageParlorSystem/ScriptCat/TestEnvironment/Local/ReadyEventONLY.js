// ==UserScript==
// @name         TestEnvironment Remote Ready Event ONLY (Transition to 準備, GM_xhr, Dedup + Stress) + API_KEY
// @namespace    http://scriptcat.org/
// @version      2.3
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅附壓測模組（可關閉）；✅Version B: payload 加 key（對應 GAS READY_API_KEY）
// @match        http://yspos.youngsong.com.tw/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 0) Security: READY_API_KEY（對應 GAS Script Properties: READY_API_KEY）
  // =========================
  // 你在 GAS Script Properties 設：READY_API_KEY=xxxx
  // 這裡要填同一個值，否則 GAS 會回 AUTH_FORBIDDEN
  const READY_API_KEY = "READY_API_KEY"; // ← 必填

  // =========================
  // ✅ 1) 你的 GAS Web App 端點（/exec）
  // =========================
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbyVTR0LkxX9raylD7rQb5sZCtFIfL8pLRiTGU4wHnsN364gBq5tFOkZHBfNJp6KOUzuJQ/exec";

  // =========================
  // ✅ 2) 正式掃描設定（定時掃描 DOM）
  // =========================
  const INTERVAL_MS = 1000; // 每 xxms 掃一次

  // LOG_MODE：
  // - "full"  ：詳細 log（包含回應等）
  // - "group" ：折疊群組 log（較乾淨）
  // - "off"   ：完全不印 log（正式建議 off 或 group）
  const LOG_MODE = "group";

  // 是否啟用「準備事件」送出（正式核心功能）
  const ENABLE_READY_EVENT = true;

  // 正式端去重（同一位師傅、同一面板，兩次準備事件至少隔多久才允許再送）
  const READY_EVENT_DEDUP_MS = 3000; // 3 秒

  // =========================
  // ✅ 3) 壓力測試設定（整合進正式腳本，但預設關閉）
  // =========================
  const STRESS = {
    enabled: false,
    autorun: false,
    delayMs: 1500,

    count: 30,
    panel: "body",

    burst: false,
    gapMs: 120,

    timeoutMs: 45000,

    masterPrefix: "T",
  };

  console.log("[ReadyOnly] 🟢 start (GM_xmlhttpRequest mode)");

  // =========================
  // ✅ 4) 工具：取得 ISO 時間字串
  // =========================
  function nowIso() {
    return new Date().toISOString();
  }

  // =========================
  // ✅ 5) DOM 工具：取文字（去掉空白）
  // =========================
  function getText(el) {
    if (!el) return "";
    return el.textContent.replace(/\s+/g, "").trim();
  }

  // =========================
  // ✅ 6) DOM 工具：取狀態欄位裡第一個 span 的 class
  // =========================
  function getFirstSpanClass(el) {
    if (!el) return "";
    const span = el.querySelector("span[class]");
    return span ? span.className.trim() : "";
  }

  // =========================
  // ✅ 7) DOM 工具：從 className 裡抓出 bg-*
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
  // ✅ 9) 掃描某個面板（身體/腳底）
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
          // full 模式才印回應
          if (LOG_MODE === "full") {
            const txt = (res.responseText || "").replace(/\s+/g, " ").slice(0, 300);
            console.log("[ReadyOnly] ✅", res.status, "resp:", txt);
          } else if (LOG_MODE === "group") {
            // group 模式：如果是授權錯誤，至少要看得到
            const t = String(res.responseText || "");
            if (t.includes("AUTH_FORBIDDEN") || t.includes("AUTH_MISCONFIG")) {
              console.warn("[ReadyOnly] ⚠️ auth resp:", t.slice(0, 300));
            }
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

        if (ok) {
          // group/full 模式給個小提示，確認 beacon 有送
          if (LOG_MODE === "full") console.log(`[ReadyOnly] 📮 beacon ok${tag ? " (" + tag + ")" : ""}`);
          return;
        }

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
  // ✅ 15) 核心：狀態轉換追蹤（非準備 -> 準備）
  // =========================
  const lastStatus = new Map();
  const readySentAt = new Map();

  function statusKey(panel, masterId) {
    return `${panel}::${masterId}`;
  }

  function maybeSendReadyEvent(panel, row, payloadTs) {
    if (!ENABLE_READY_EVENT || !GAS_URL) return;
    if (!row || !row.masterId) return;

    if (!READY_API_KEY || READY_API_KEY === "請填入你的READY_API_KEY") {
      // 避免你忘了填 key 但一直狂送造成困惑
      if (LOG_MODE !== "off") console.warn("[ReadyOnly] ⚠️ READY_API_KEY not set; skip sending");
      return;
    }

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

        // ✅ Version B：payload 必須包含 key
        const evt = {
          mode: "ready_event_v1",
          key: READY_API_KEY, // ← 新增（必要）
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

  // =========================
  // ✅ 16) tick：每次掃描一次頁面（身體+腳底）
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
  // ✅ 17) 壓測：產生 masterId
  // =========================
  function makeStressMasterId(i) {
    return String(STRESS.masterPrefix || "T") + String(i + 1).padStart(3, "0");
  }

  // =========================
  // ✅ 18) 壓測：送出單筆 ready_event_v1
  // =========================
  function sendOneStress(i) {
    if (!READY_API_KEY || READY_API_KEY === "請填入你的READY_API_KEY") {
      return console.warn("[Stress] READY_API_KEY not set; skip");
    }

    const ts = nowIso();
    const masterId = makeStressMasterId(i);

    const evt = {
      mode: "ready_event_v1",
      key: READY_API_KEY, // ← 新增（必要）
      timestamp: ts,
      panel: STRESS.panel,
      masterId: masterId,
      status: "準備",
      index: i + 1,
      appointment: "TEST",
      remaining: "",
      bgStatus: "bg-test",
      colorStatus: "text-test",
      source: "stress",
    };

    if (LOG_MODE !== "off") console.log("[Stress] ▶ send", masterId, ts);

    postJsonGM(GAS_URL, evt, STRESS.timeoutMs);
  }

  // =========================
  // ✅ 19) 壓測：跑 N 人（burst 或 gap）
  // =========================
  function runStress() {
    if (!GAS_URL) return console.error("[Stress] missing GAS_URL");
    if (!STRESS.enabled) return console.warn("[Stress] STRESS.enabled=false");

    console.log(
      `[Stress] 🚀 start: count=${STRESS.count}, burst=${STRESS.burst}, gap=${STRESS.gapMs}ms, timeout=${STRESS.timeoutMs}ms, panel=${STRESS.panel}`
    );

    if (STRESS.burst) {
      for (let i = 0; i < STRESS.count; i++) sendOneStress(i);
    } else {
      for (let i = 0; i < STRESS.count; i++) {
        setTimeout(() => sendOneStress(i), i * STRESS.gapMs);
      }
    }
  }

  // =========================
  // ✅ 20) start：啟動正式掃描 + 掛壓測入口
  // =========================
  function start() {
    console.log("[ReadyOnly] ▶️ start loop", INTERVAL_MS, "ms");

    tick();
    setInterval(tick, INTERVAL_MS);

    window.__runStress = runStress;

    if (STRESS.enabled && STRESS.autorun) {
      setTimeout(runStress, Math.max(0, STRESS.delayMs || 0));
    }
  }

  // =========================
  // ✅ 21) DOM Ready 判斷
  // =========================
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
