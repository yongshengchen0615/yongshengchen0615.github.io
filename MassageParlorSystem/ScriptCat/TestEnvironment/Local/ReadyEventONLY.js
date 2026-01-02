// ==UserScript==
// @name        TestEnvironment Local Ready Event ONLY + TestPlan (same userId / multi masterIds)
// @namespace    http://scriptcat.org/
// @version      1.50
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅TestPlan：可排程幾秒後送幾筆（支援多個 masterId 平均分配→多個 userId）；✅附壓測模組（可關閉）
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 1) 你的 GAS Web App 端點（/exec）
  // =========================
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbyD3h_QT3foNjpw67iWzbgGtVmWh9LsYW1Hi6LVHqdduy74Pv2q1EpJVTXJlaAU-LGr/exec";

  // =========================
  // ✅ 2) 正式掃描設定（定時掃描 DOM）
  // =========================
  const INTERVAL_MS = 2000; // 2000ms=2秒
  const LOG_MODE = "group"; // "full" | "group" | "off"
  const ENABLE_READY_EVENT = true;
  const READY_EVENT_DEDUP_MS = 2000; // 2000ms=2秒

  console.log("[ReadyOnly] 🟢 start (GM_xmlhttpRequest mode)");

  // =========================
  // ✅ 3) TestPlan：測試排程（支援多個 masterId 平均分配）
  // =========================
  // 用途：你可以設定「幾秒後開始」+「送幾筆」+「每筆間隔」
  //      並用 fixedMasterIds 設定多個 techNo，測試人數會平均分配到這些 masterId 上
  // 前提：GAS 端是用 masterId/techNo 去 Users 表找到 userId
  const TEST_PLAN = {
    enabled: false,
    autorun: false,

    // ✅ 多個 masterId 平均分配（Round-robin）
    // 例：count=12 時，大約 10/08/12 各 4 筆
    fixedMasterIds: ["10"],

    // ✅ 也支援權重（可選）
    // fixedMasterIds: [{ id: "10", w: 3 }, { id: "08", w: 1 }],

    list: [
      { name: "batch-1", afterSec: 3, count: 10, gapMs: 800, panel: "body" },
      { name: "batch-2", afterSec: 6, count: 2, gapMs: 800, panel: "body" },
    ],

    timeoutMs: 45000,
  };

  // =========================
  // ✅ 4) 壓力測試設定（保留）
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

  // =========================
  // ✅ 5) 工具：時間 / 文字
  // =========================
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

  // =========================
  // ✅ 6) 解析單列師傅資料
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
  // ✅ 7) 掃描面板
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
  // ✅ 8) 找面板（身體 / 腳底）
  // =========================
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
  // ✅ 9) 送出：GM_xmlhttpRequest
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
  // ✅ 10) 送出：beacon 優先，失敗 fallback GM
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

  function logGroup(title, payload) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") return console.log(title, payload);
    console.groupCollapsed(title);
    console.log("payload =", payload);
    console.groupEnd();
  }

  // =========================
  // ✅ 11) 正式核心：狀態轉換（非準備 -> 準備）
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
          source: "prod", // ✅建議明確標記正式
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
  // ✅ 12) TestPlan：多個 masterId 平均分配（round-robin）
  // =========================
  function expandWeightedIds_(idsOrWeighted) {
    if (!Array.isArray(idsOrWeighted) || idsOrWeighted.length === 0) return [];

    // A) ["10","08","12"]
    if (typeof idsOrWeighted[0] === "string") {
      return idsOrWeighted.map((x) => String(x).trim()).filter(Boolean);
    }

    // B) [{id:"10", w:3}, {id:"08", w:1}]
    const out = [];
    idsOrWeighted.forEach((it) => {
      const id = String(it.id || "").trim();
      const w = Math.max(0, Number(it.w || 0));
      if (!id || !isFinite(w) || w <= 0) return;
      for (let i = 0; i < w; i++) out.push(id);
    });
    return out;
  }

  // round-robin 指標（跨 job 也會平均輪）
  let __tp_rr = 0;

  function pickMasterIdForTest_(pool) {
    if (!pool || pool.length === 0) return "";
    const id = pool[__tp_rr % pool.length];
    __tp_rr++;
    return id;
  }

  function sendOneTestPlan(jobName, panel, seq, masterId) {
    const ts = nowIso();
    const evt = {
      mode: "ready_event_v1",
      timestamp: ts,
      panel: panel || "body",
      masterId: String(masterId || "").trim(),
      status: "準備",
      index: seq,
      appointment: `TEST_PLAN:${jobName}`,
      remaining: "",
      bgStatus: "bg-test",
      colorStatus: "text-test",
      source: "test_plan",
      job: jobName,
      seq: seq,
    };

    if (!evt.masterId) {
      console.error("[TestPlan] ❌ missing masterId (請設定 TEST_PLAN.fixedMasterIds)");
      return;
    }

    if (LOG_MODE !== "off")
      console.log(
        `[TestPlan] ▶ send job=${jobName} seq=${seq} masterId=${evt.masterId} ts=${ts}`
      );

    postJsonGM(GAS_URL, evt, TEST_PLAN.timeoutMs || 45000);
  }

  function runTestPlan() {
    if (!GAS_URL) return console.error("[TestPlan] ❌ missing GAS_URL");
    if (!TEST_PLAN.enabled) return console.warn("[TestPlan] TEST_PLAN.enabled=false");
    if (!Array.isArray(TEST_PLAN.list) || TEST_PLAN.list.length === 0)
      return console.warn("[TestPlan] list is empty");

    // ✅ 向下相容：如果你還留著 fixedMasterId
    const idsRaw =
      TEST_PLAN.fixedMasterIds && Array.isArray(TEST_PLAN.fixedMasterIds)
        ? TEST_PLAN.fixedMasterIds
        : TEST_PLAN.fixedMasterId
        ? [TEST_PLAN.fixedMasterId]
        : [];

    const pool = expandWeightedIds_(idsRaw);

    if (!pool.length) {
      console.error(
        "[TestPlan] ❌ TEST_PLAN.fixedMasterIds is empty（請設定多個 masterId，例如 ['10','08']）"
      );
      return;
    }

    console.log(
      `[TestPlan] 🚀 start: masterIdPool=${JSON.stringify(pool)}, jobs=${TEST_PLAN.list.length}`
    );

    TEST_PLAN.list.forEach((job) => {
      const name = job.name || "job";
      const afterSec = Number(job.afterSec || 0);
      const count = Number(job.count || 1);
      const gapMs = Number(job.gapMs || 0);
      const panel = job.panel || "body";

      const startDelayMs = Math.max(0, afterSec * 1000);

      setTimeout(() => {
        console.log(
          `[TestPlan] ▶ run job=${name} panel=${panel} count=${count} gapMs=${gapMs} afterSec=${afterSec}`
        );

        for (let i = 0; i < count; i++) {
          const seq = i + 1;
          const d = gapMs > 0 ? i * gapMs : 0;

          setTimeout(() => {
            const masterId = pickMasterIdForTest_(pool); // ✅平均分配
            sendOneTestPlan(name, panel, seq, masterId);
          }, d);
        }
      }, startDelayMs);
    });
  }

  // =========================
  // ✅ 13) 壓力測試（保留）
  // =========================
  function makeStressMasterId(i) {
    return String(STRESS.masterPrefix || "T") + String(i + 1).padStart(3, "0");
  }

  function sendOneStress(i) {
    const ts = nowIso();
    const masterId = makeStressMasterId(i);

    const evt = {
      mode: "ready_event_v1",
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
  // ✅ 14) start：啟動正式掃描 + 掛載測試入口
  // =========================
  function start() {
    console.log("[ReadyOnly] ▶️ start loop", INTERVAL_MS, "ms");

    tick();
    setInterval(tick, INTERVAL_MS);

    // Console 手動觸發入口
    window.__runStress = runStress;
    window.__runTestPlan = runTestPlan;

    // 可選：自動跑
    if (TEST_PLAN.enabled && TEST_PLAN.autorun) {
      setTimeout(runTestPlan, 0);
    }
    if (STRESS.enabled && STRESS.autorun) {
      setTimeout(runStress, Math.max(0, STRESS.delayMs || 0));
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
