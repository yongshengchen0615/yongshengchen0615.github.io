// ==UserScript==
// @name         TestEnvironment Local Ready Event ONLY (Transition to 準備, GM_xhr, Dedup + TestPlanV3 Scheduler)
// @namespace    http://scriptcat.org/
// @version      1.4
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅TestPlanV3：可排程（幾秒後幾位師傅準備，再過幾秒再幾位）
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================================================
  // ✅ 1) GAS Web App 端點（/exec）
  // =========================================================
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbzW5MQM1vMPkfTIHzojicGu4TSuPO5SbKmfRFrHy2ksxW-Y4-U-uVebDgn1p_Qmm7-T/exec";

  // =========================================================
  // ✅ 2) 正式掃描設定（定時掃描 DOM）
  // =========================================================
  const INTERVAL_MS = 2000; // 每 2 秒掃一次

  // LOG_MODE：
  // - "full"  ：詳細 log（含回應摘要）
  // - "group" ：折疊群組 log（較乾淨）
  // - "off"   ：完全不印
  const LOG_MODE = "group";

  // ✅ 是否啟用「準備事件」送出（正式核心功能）
  const ENABLE_READY_EVENT = true;

  // ✅ 前端去重：同一 panel + masterId，準備事件最短間隔
  // 建議 > INTERVAL_MS，可吸收 UI 抖動
  const READY_EVENT_DEDUP_MS = 5000;

  console.log("[ReadyOnly] 🟢 start (GM_xmlhttpRequest mode)");

  // =========================================================
  // ✅ 3) 工具：時間字串
  // =========================================================
  function nowIso() {
    return new Date().toISOString();
  }

  // =========================================================
  // ✅ 4) DOM 工具
  // =========================================================
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

  // =========================================================
  // ✅ 5) 解析單列
  // =========================================================
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

  // =========================================================
  // ✅ 6) GM POST
  // =========================================================
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

  function logGroup(title, payload) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") return console.log(title, payload);
    console.groupCollapsed(title);
    console.log("payload =", payload);
    console.groupEnd();
  }

  // =========================================================
  // ✅ 7) 正式核心：狀態轉換追蹤（非準備 → 準備 才送）
  // =========================================================
  const lastStatus = new Map(); // key=panel::masterId -> "準備"/"工作中"/...
  const readySentAt = new Map(); // key=panel::masterId -> ms

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

    // ✅ 只有「非準備 → 準備」才送
    const isReadyTransition = nowStatus === "準備" && prev !== "準備";

    if (isReadyTransition) {
      const nowMs = Date.now();
      const lastMs = readySentAt.get(k) || 0;

      // ✅ 前端去重：避免 UI 抖動連發
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
          source: "live_scan",
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

  // =========================================================
  // ✅ 8) TestPlan v3：排程波次（幾秒後幾位師傅準備，再過幾秒再幾位）
  // =========================================================
  const TEST_PLAN_V3 = {
    enabled: true,
    autorun: true,
    delayMs: 800,

    // ✅ 推播目標（可多個，會 round-robin）
    targetUserIds: [
      "U974e3043db80b35e38fca1f5172fa917",
      // "Uxxxx...",
    ],

    // ✅ 師傅池（你要模擬多少人）
    masters: Array.from({ length: 30 }, (_, i) => `T${String(i + 1).padStart(3, "0")}`),

    // ✅ 冷卻：同師傅進入準備後，至少隔多久才允許再次被安排進準備（避免不合理重複）
    cooldownMs: 8000,

    // ✅ 是否允許重複（true：可在 cooldown 內再次被排，測 dedup/queue）
    allowDuplicate: false,

    // ✅ 你要的排程：afterSec（從開始算起第幾秒）
    // 例：3秒後10位準備；再過2秒（也就是第5秒）2位準備
    list: [
      { name: "wave-1", afterSec: 3, count: 10, panel: "body", gapMs: 800 },
      { name: "wave-2", afterSec: 5, count: 2, panel: "body", gapMs: 800 },
      // 你也可以指定固定師傅：
      // { name: "wave-3", afterSec: 9, masterIds: ["T001","T002","T003"], panel: "foot", gapMs: 150 },
    ],

    testRunId: `TP3-${Date.now()}`,
  };

  const TEST_TIMEOUT_MS = 45000;

  // 記錄每位師傅上次準備時間（用於 cooldown）
  const __tp3State = new Map(); // masterId -> { lastReadyAt }
  let __tp3Seq = 0;
  let __tp3TargetIdx = 0;

  function __tp3Iso(ms) {
    return new Date(ms || Date.now()).toISOString();
  }

  function __tp3InitMaster(masterId) {
    if (!__tp3State.has(masterId)) __tp3State.set(masterId, { lastReadyAt: 0 });
    return __tp3State.get(masterId);
  }

  // round-robin 取目標 userId（比 random 更平均）
  function __tp3PickTargetUserId() {
    const ids = (TEST_PLAN_V3.targetUserIds || []).filter(Boolean).map(String);
    if (!ids.length) return "";
    const id = ids[__tp3TargetIdx % ids.length].trim();
    __tp3TargetIdx++;
    return id;
  }

  // 從 masters 池挑「不重複」的一批（考慮 cooldown）
  function __tp3PickUniqueMasters(count, allowDuplicate) {
    const masters = (TEST_PLAN_V3.masters || []).filter(Boolean).map(String);

    // 洗牌（Fisher–Yates）
    for (let i = masters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [masters[i], masters[j]] = [masters[j], masters[i]];
    }

    const out = [];
    const now = Date.now();
    const cooldown = Math.max(0, TEST_PLAN_V3.cooldownMs || 0);

    for (const m of masters) {
      if (out.length >= count) break;

      const st = __tp3InitMaster(m);
      const inCooldown = now - (st.lastReadyAt || 0) < cooldown;

      if (!allowDuplicate && inCooldown) continue;
      out.push(m);
    }

    // 如果 out.length < count：代表池太小或 cooldown 太長 → 這波就送能挑到的數量
    return out;
  }

  function __tp3MarkReady(masterId) {
    const st = __tp3InitMaster(masterId);
    st.lastReadyAt = Date.now();
  }

  function __tp3BuildEvent({ masterId, panel, targetUserId, waveName, plannedAtMs }) {
    __tp3Seq += 1;
    const sentAtMs = Date.now();

    return {
      mode: "ready_event_v1",
      timestamp: __tp3Iso(sentAtMs),
      panel: panel || "body",
      masterId,
      status: "準備",

      // ✅ 測試指定推播目標（GAS 端應支援：有 targetUserId 就直接推）
      targetUserId,

      // ✅ 對帳欄位
      source: "test_plan_v3",
      testRunId: TEST_PLAN_V3.testRunId,
      wave: waveName,
      seq: __tp3Seq,
      plannedAt: __tp3Iso(plannedAtMs),
      sentAt: __tp3Iso(sentAtMs),

      // 模擬畫面欄位（可選）
      appointment: "TEST",
      bgStatus: "bg-test",
      colorStatus: "text-test",
    };
  }

  function __tp3Send(evt) {
    if (LOG_MODE !== "off") {
      console.log(
        `[TP3] ▶ send wave=${evt.wave} seq=${evt.seq} panel=${evt.panel} master=${evt.masterId} to=${evt.targetUserId}`
      );
    }
    postJsonGM(GAS_URL, evt, TEST_TIMEOUT_MS);
  }

  function __tp3RunWave(wave) {
    const waveName = String(wave.name || "wave").trim();
    const panel = wave.panel === "foot" ? "foot" : "body";
    const gapMs = Math.max(0, parseInt(wave.gapMs || 0, 10));
    const allowDup = !!TEST_PLAN_V3.allowDuplicate;

    // 1) 若指定 masterIds：用指定清單（忽略 count）
    let masters =
      Array.isArray(wave.masterIds) && wave.masterIds.length
        ? wave.masterIds.map(String)
        : null;

    // 2) 否則依 count 從池子挑一批
    if (!masters) {
      const count = Math.max(0, parseInt(wave.count || 0, 10));
      masters = __tp3PickUniqueMasters(count, allowDup);
    }

    console.log(
      `[TP3] ▶ wave start: ${waveName} masters=${masters.length} panel=${panel} gapMs=${gapMs}`
    );

    const plannedAtMs = Date.now();

    // 同一波內逐一送（gapMs 可讓它更像「陸續變準備」）
    masters.forEach((masterId, idx) => {
      const delay = gapMs ? idx * gapMs : 0;

      setTimeout(() => {
        // 模擬「工作中 → 準備」：先標記 lastReadyAt，避免下一波不合理重複
        __tp3MarkReady(masterId);

        const targetUserId = __tp3PickTargetUserId();
        const evt = __tp3BuildEvent({
          masterId,
          panel,
          targetUserId,
          waveName,
          plannedAtMs,
        });

        __tp3Send(evt);
      }, delay);
    });
  }

  function runTestPlanV3() {
    if (!GAS_URL) return console.error("[TP3] missing GAS_URL");
    if (!TEST_PLAN_V3.enabled) return console.warn("[TP3] enabled=false");

    const ids = (TEST_PLAN_V3.targetUserIds || []).filter(Boolean);
    if (!ids.length) return console.error("[TP3] missing targetUserIds[]");

    const masters = (TEST_PLAN_V3.masters || []).filter(Boolean);
    if (!masters.length) return console.error("[TP3] missing masters[]");

    const list = Array.isArray(TEST_PLAN_V3.list) ? TEST_PLAN_V3.list : [];
    if (!list.length) return console.error("[TP3] missing list[]");

    console.log("[TP3] 🚀 start", {
      testRunId: TEST_PLAN_V3.testRunId,
      targets: ids.length,
      masters: masters.length,
      cooldownMs: TEST_PLAN_V3.cooldownMs,
      allowDuplicate: TEST_PLAN_V3.allowDuplicate,
      list,
    });

    // 依 afterSec 排程每一波
    list.forEach((wave) => {
      const afterSec = Number(wave.afterSec || 0);
      const startDelayMs = Math.max(0, Math.round(afterSec * 1000));
      setTimeout(() => __tp3RunWave(wave), startDelayMs);
    });
  }

  // =========================================================
  // ✅ 9) start：啟動正式掃描 + 掛測試入口
  // =========================================================
  function start() {
    console.log("[ReadyOnly] ▶️ start loop", INTERVAL_MS, "ms");

    // 正式掃描啟動
    tick();
    setInterval(tick, INTERVAL_MS);

    // Console 手動觸發：
    // window.__runTestPlanV3()
    window.__runTestPlanV3 = runTestPlanV3;

    // 自動跑測試（若 autorun=true）
    if (TEST_PLAN_V3.enabled && TEST_PLAN_V3.autorun) {
      setTimeout(runTestPlanV3, Math.max(0, TEST_PLAN_V3.delayMs || 0));
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
