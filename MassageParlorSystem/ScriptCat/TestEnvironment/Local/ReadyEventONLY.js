// ==UserScript==
// @name        TestEnvironment Local Ready Event ONLY + TestPlan Scheduler (GM_xhr, Dedup + Stress)
// @namespace    http://scriptcat.org/
// @version      2.4
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅TestPlan：用 list 排程幾秒後送哪個版面/送幾筆/送給哪些使用者；✅附壓測模組（可關閉）
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
    "https://script.google.com/macros/s/AKfycbzW5MQM1vMPkfTIHzojicGu4TSuPO5SbKmfRFrHy2ksxW-Y4-U-uVebDgn1p_Qmm7-T/exec";

  // =========================
  // ✅ 2) 正式掃描設定（定時掃描 DOM）
  // =========================
  // ⚠️ 注意：2000ms = 2 秒（不是 2 分鐘）
  const INTERVAL_MS = 2000;

  // LOG_MODE：
  // - "full"  ：詳細 log（包含回應等）
  // - "group" ：折疊群組 log（較乾淨）
  // - "off"   ：完全不印 log
  const LOG_MODE = "group";

  // 是否啟用「準備事件」送出（正式核心功能）
  const ENABLE_READY_EVENT = true;

  // 正式端去重（同一位師傅、同一面板，兩次準備事件至少隔多久才允許再送）
  // ⚠️ 注意：2000ms = 2 秒（不是 2 分鐘）
  const READY_EVENT_DEDUP_MS = 2000;

  // =========================
  // ✅ 3) 壓力測試設定（保留原本 STRESS）
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
  // ✅ 3.5) 測試模組（Test Plan：用 list 排程）
  // =========================
  // 你只要改這邊的 jobs[] 即可控制測試行為
  const TEST_PLAN = {
    enabled: true,   // ✅ 要跑測試就改 true
    autorun: true,   // ✅ 要載入後自動跑就改 true
    delayMs: 1200,    // autorun 延遲
    timeoutMs: 45000, // 測試用 timeout（較長，避免 lock wait）

    // ✅ jobs：每一筆 job = 幾秒後送哪個版面/送給誰/送幾筆
    // 規格：
    // - atSec: 從開始跑測試起算，幾秒後執行
    // - panel: "body" | "foot"
    // - targets: ["T001","T002"] (指定名單)
    // - auto: { prefix:"T", autoCount:10, pad:3 } (自動產生 T001..T010)
    // - burst: true=同瞬間全部送；false=依 gapMs 間隔送（建議 false 較穩）
    // - gapMs: burst=false 時，每筆間隔
    // - repeat: 送幾輪（同一批 targets 重複送）
    // - repeatGapMs: 每輪間隔（ms）
  jobs: [
  // Batch 1 (T001..T010) — body
  {
    atSec: 1,
    panel: "body",
    targets: [
      "T001","T002","T003","T004","T005",
      "T006","T007","T008","T009","T010"
    ],
    burst: false,
    gapMs: 220,
  },

  // Batch 2 (T011..T020) — foot
  {
    atSec: 11,
    panel: "foot",
    targets: [
      "T011","T012","T013","T014","T015",
      "T016","T017","T018","T019","T020"
    ],
    burst: false,
    gapMs: 220,
  },

  // Batch 3 (T021..T030) — body + 輕量 repeat（模擬重送壓力，但不新增 masterId）
  {
    atSec: 21,
    panel: "body",
    targets: [
      "T021","T022","T023","T024","T025",
      "T026","T027","T028","T029","T030"
    ],
    burst: false,
    gapMs: 220,
    repeat: 2,
    repeatGapMs: 1200,
  },
],


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
  // ✅ 7) DOM 工具：從 className 裡抓出 bg-*（背景色 class）
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
  // ✅ 12) 網路送出：GM_xmlhttpRequest（避 CSP、跨域可用）
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

    // ✅ 嚴格：只有 "準備" 才送（若你頁面會出現 "準備中" 請改成 includes）
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
  // ✅ 17) 壓測：產生壓測用 masterId
  // =========================
  function makeStressMasterId(i) {
    return String(STRESS.masterPrefix || "T") + String(i + 1).padStart(3, "0");
  }

  // =========================
  // ✅ 18) 壓測：送出單筆 ready_event_v1
  // =========================
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
  // ✅ 19.5) TestPlan：工具（產生 targets）
  // =========================
  function makeAutoTargets(autoCfg) {
    const prefix = String(autoCfg?.prefix || "T");
    const n = Number(autoCfg?.autoCount || 0);
    const pad = Number(autoCfg?.pad ?? 3);

    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(prefix + String(i + 1).padStart(pad, "0"));
    }
    return out;
  }

  function normalizePanel(p) {
    const v = String(p || "").toLowerCase();
    if (v === "body" || v === "foot") return v;
    return "body";
  }

  // 送出一筆「測試 ready_event_v1」
  function sendTestEvent(panel, masterId, idx, timeoutMs) {
    const ts = nowIso();
    const evt = {
      mode: "ready_event_v1",
      timestamp: ts,
      panel: normalizePanel(panel),
      masterId: String(masterId || "").trim(),
      status: "準備",
      index: idx ?? "",
      appointment: "TEST_PLAN",
      remaining: "",
      bgStatus: "bg-test",
      colorStatus: "text-test",
      source: "test_plan",
    };

    if (LOG_MODE !== "off") console.log("[TestPlan] ▶ send", evt.panel, evt.masterId, ts);
    postJsonGM(GAS_URL, evt, timeoutMs || TEST_PLAN.timeoutMs);
  }

  // 執行單一 job（含 repeat）
  function runOneJob(job, baseDelayMs) {
    const panel = normalizePanel(job.panel);
    const timeoutMs = job.timeoutMs ?? TEST_PLAN.timeoutMs;

    let targets = Array.isArray(job.targets) ? job.targets.slice() : [];
    if (!targets.length && job.auto) targets = makeAutoTargets(job.auto);

    if (!targets.length) {
      const cnt = Number(job.count || 0);
      if (cnt > 0) targets = makeAutoTargets({ prefix: "T", autoCount: cnt, pad: 3 });
    }

    if (!targets.length) {
      console.warn("[TestPlan] ⚠️ job has no targets:", job);
      return;
    }

    const burst = !!job.burst;
    const gapMs = Number(job.gapMs ?? 120);

    const repeat = Math.max(1, Number(job.repeat || 1));
    const repeatGapMs = Number(job.repeatGapMs ?? 0);

    for (let round = 0; round < repeat; round++) {
      const roundDelay = baseDelayMs + round * repeatGapMs;

      if (LOG_MODE !== "off") {
        console.log(
          `[TestPlan] 🧪 job @+${Math.round(roundDelay / 1000)}s round ${round + 1}/${repeat} panel=${panel} targets=${targets.length} burst=${burst}`
        );
      }

      if (burst) {
        setTimeout(() => {
          for (let i = 0; i < targets.length; i++) {
            sendTestEvent(panel, targets[i], i + 1, timeoutMs);
          }
        }, roundDelay);
      } else {
        setTimeout(() => {
          for (let i = 0; i < targets.length; i++) {
            setTimeout(() => sendTestEvent(panel, targets[i], i + 1, timeoutMs), i * gapMs);
          }
        }, roundDelay);
      }
    }
  }

  // 跑整份 list
  function runTestPlan() {
    if (!GAS_URL) return console.error("[TestPlan] missing GAS_URL");
    if (!TEST_PLAN.enabled) return console.warn("[TestPlan] TEST_PLAN.enabled=false");

    const jobs = Array.isArray(TEST_PLAN.jobs) ? TEST_PLAN.jobs : [];
    if (!jobs.length) return console.warn("[TestPlan] no jobs");

    console.log(`[TestPlan] 🚀 start jobs=${jobs.length}`);

    for (const job of jobs) {
      const atSec = Number(job.atSec ?? 0);
      const baseDelayMs = Math.max(0, atSec * 1000);
      runOneJob(job, baseDelayMs);
    }
  }

  // =========================
  // ✅ 20) start：啟動正式掃描 + 掛入口（壓測/測試）
  // =========================
  function start() {
    console.log("[ReadyOnly] ▶️ start loop", INTERVAL_MS, "ms");

    // 立刻跑一次
    tick();

    // 進入定時掃描
    setInterval(tick, INTERVAL_MS);

    // ✅ Console 手動觸發壓測
    // 用法：window.__runStress()
    window.__runStress = runStress;

    // ✅ Console 手動觸發 TestPlan
    // 用法：window.__runTestPlan()
    window.__runTestPlan = runTestPlan;

    // ✅ 可選：載入後自動壓測
    if (STRESS.enabled && STRESS.autorun) {
      setTimeout(runStress, Math.max(0, STRESS.delayMs || 0));
    }

    // ✅ 可選：載入後自動跑 TestPlan
    if (TEST_PLAN.enabled && TEST_PLAN.autorun) {
      setTimeout(runTestPlan, Math.max(0, TEST_PLAN.delayMs || 0));
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
