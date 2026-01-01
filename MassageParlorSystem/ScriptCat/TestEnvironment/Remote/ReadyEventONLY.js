// ==UserScript==
// @name        TestEnvironment Local Ready Event ONLY (Transition to 準備, GM_xhr, Dedup + Stress)
// @namespace    http://scriptcat.org/
// @version      1.7
// @description  ✅正式：偵測「非準備→準備」立刻送 ready_event_v1；✅附壓測模組（可關閉）
// @match        http://yspos.youngsong.com.tw/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 1) 你的 GAS Web App 端點（/exec）=====
  // =========================
  // 這個 URL 是「Ready Event 接收 / 推播」的 GAS Web App
  // 前端偵測到師傅從「非準備」變成「準備」時，就會 POST 到這裡
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbwP_LueNqPfxJlr0PtCyK9UBbGLxILfIWIvYQl1CNmBVZ41ZyIe4dTx6_rxfs0JHNhr/exec";

  // =========================
  // ✅ 2) 正式掃描設定（定時掃描 DOM）
  // =========================
  const INTERVAL_MS = 2000; // 每 2 分鐘掃一次（避免太頻繁造成效能負擔 / 不必要流量）

  // LOG_MODE：
  // - "full"  ：詳細 log（包含回應等）
  // - "group" ：折疊群組 log（較乾淨）
  // - "off"   ：完全不印 log（正式建議 off 或 group）
  const LOG_MODE = "group";

  // 是否啟用「準備事件」送出（正式核心功能）
  const ENABLE_READY_EVENT = true;

  // 正式端去重（同一位師傅、同一面板，兩次準備事件至少隔多久才允許再送）
  // 目的：避免 UI 抖動/重繪導致短時間內重送
  const READY_EVENT_DEDUP_MS = 2000; // 2 分鐘

  // =========================
  // ✅ 3) 壓力測試設定（整合進正式腳本，但預設關閉）
  // =========================
  // 壓測用途：模擬 30 個 ready_event_v1 同時/連續打進 GAS
  // 注意：正式不要開，避免誤推
  const STRESS = {
    enabled: false,      // ✅ 壓測總開關（正式預設 false）
    autorun: false,      // ✅ 是否載入後自動跑壓測（建議 false）
    delayMs: 1500,       // autorun 延遲（ms）

    count: 30,           // ✅ 壓測人數：30
    panel: "body",       // 壓測面板：body 或 foot

    // burst：
    // - true  ：同一瞬間全部送出（最極限併發，容易造成 lock 競爭 / timeout）
    // - false ：依 gapMs 間隔送出（較穩，符合「穩定 + 不誤判」）
    burst: false,        // ✅ 推薦 false
    gapMs: 120,          // ✅ 推薦 120ms（30 人大概 3.6 秒內送完）

    // timeout：壓測用 timeout（避免 GAS lock 等待 30s 時，前端先誤判 timeout）
    timeoutMs: 45000,    // ✅ 推薦 45s

    // 壓測用 masterId 前綴，會產生：T001 ~ T030
    // 目的：可讀、可辨識；避免跟真實師傅 ID 混淆（你也可以改成 STRESS-）
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
    // 將所有空白壓縮並移除，避免格式影響比對
    return el.textContent.replace(/\s+/g, "").trim();
  }

  // =========================
  // ✅ 6) DOM 工具：取狀態欄位裡第一個 span 的 class（文字顏色等）
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
    // 只抓第一個符合 bg-xxxx 的 class（例如 bg-green-500）
    const m = cls.match(/\bbg-[A-Za-z0-9_-]+\b/);
    return m ? m[0] : "";
  }

  // =========================
  // ✅ 8) 解析單列師傅資料（1 row -> object）
  // =========================
  function parseRow(row) {
    // 每列通常有 4 個 div：號碼 / 師傅 / 狀態 / 預約
    const cells = row.querySelectorAll(":scope > div");
    if (cells.length < 4) return null;

    const indexCell = cells[0];        // 號碼
    const masterCell = cells[1];       // 師傅 ID/名稱
    const statusCell = cells[2];       // 狀態（準備/休息/工作中/數字剩餘等）
    const appointmentCell = cells[3];  // 預約

    const indexText = getText(indexCell);
    const masterText = getText(masterCell);
    let statusText = getText(statusCell);
    const appointment = getText(appointmentCell);

    // 沒師傅就跳過
    if (!masterText) return null;

    // 若 statusText 是純數字，代表「剩餘分鐘」之類 → 轉成「工作中 + remaining」
    let remaining = "";
    if (/^-?\d+$/.test(statusText)) {
      remaining = parseInt(statusText, 10);
      statusText = "工作中";
    }

    // 抓樣式 class（可用於推播訊息或 UI 追蹤）
    const colorStatus = getFirstSpanClass(statusCell);
    const bgStatus = getBgClass(statusCell);

    // index 轉數字（若解析失敗則留空）
    const idxNum = indexText ? parseInt(indexText, 10) : "";

    // 回傳統一格式
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
  // ✅ 9) 掃描某個面板（身體/腳底）取得所有列資料
  // =========================
  function scanPanel(panelEl) {
    if (!panelEl) return [];
    // 這個 selector 是你目前頁面每一列的 DOM class（若頁面 class 改了要同步調整）
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
  // DEFAULT_TIMEOUT_MS：正式送出用的 timeout（可短一點）
  const DEFAULT_TIMEOUT_MS = 8000;

  // 用 GM_xmlhttpRequest 送 POST JSON
  // timeoutMs 可選：正式用 8 秒；壓測用 45 秒
  function postJsonGM(url, payload, timeoutMs) {
    if (!url) return;
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        data: JSON.stringify(payload),
        timeout: timeoutMs || DEFAULT_TIMEOUT_MS,

        // onload：成功回應
        onload: function (res) {
          // 正式預設不吵，full 才印回應
          if (LOG_MODE === "full") {
            const txt = (res.responseText || "").replace(/\s+/g, " ").slice(0, 200);
            console.log("[ReadyOnly] ✅", res.status, "resp:", txt);
          }
        },

        // onerror：連線/網路錯誤
        onerror: function (err) {
          console.error("[ReadyOnly] ❌ GM POST failed:", err);
        },

        // ontimeout：超時（不代表後端沒收到；可能是後端卡 lock 或寫表慢）
        ontimeout: function () {
          console.error(
            "[ReadyOnly] ❌ GM POST timeout",
            "(timeout_ms=" + (timeoutMs || DEFAULT_TIMEOUT_MS) + ")"
          );
        },
      });
    } catch (e) {
      // GM 呼叫本身拋錯（通常是腳本環境問題）
      console.error("[ReadyOnly] ❌ GM exception:", e);
    }
  }

  // =========================
  // ✅ 13) 送出策略：sendBeacon 優先，失敗再 fallback GM
  // =========================
  // sendBeacon 優點：頁面 unload 時也比較容易送出去；非阻塞
  // 缺點：不一定可靠、也不一定拿得到回應
  function postBeaconFirst(url, payload, tag, timeoutMs) {
    if (!url) return;

    try {
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "text/plain;charset=utf-8",
        });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return; // ✅ beacon 成功就結束

        // beacon 失敗 → fallback GM
        if (LOG_MODE !== "off") {
          console.warn(`[ReadyOnly] ⚠️ sendBeacon failed${tag ? " (" + tag + ")" : ""} → fallback GM`);
        }
      }
    } catch (e) {
      // beacon 例外 → fallback GM
      if (LOG_MODE !== "off") {
        console.warn(`[ReadyOnly] ⚠️ sendBeacon error${tag ? " (" + tag + ")" : ""} → fallback GM`, e);
      }
    }

    // fallback：用 GM_xmlhttpRequest
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
  // lastStatus：記錄每位師傅上次狀態（用於判斷 transition）
  const lastStatus = new Map(); // key -> last status string

  // readySentAt：記錄每位師傅上次送 ready_event 的時間（用於 dedup）
  const readySentAt = new Map(); // key -> last sent ms

  // 產生唯一 key：面板 + 師傅
  function statusKey(panel, masterId) {
    return `${panel}::${masterId}`;
  }

  // 判斷是否要送 ready_event（只在「轉換成準備」時送）
  function maybeSendReadyEvent(panel, row, payloadTs) {
    if (!ENABLE_READY_EVENT || !GAS_URL) return;
    if (!row || !row.masterId) return;

    const masterId = String(row.masterId || "").trim();
    if (!masterId) return;

    const k = statusKey(panel, masterId);
    const prev = lastStatus.get(k) || "";                 // 前一次狀態
    const nowStatus = String(row.status || "").trim();    // 現在狀態

    // ✅ 只有「現在=準備」且「上一筆不是準備」才算 transition
    const isReadyTransition = nowStatus === "準備" && prev !== "準備";

    if (isReadyTransition) {
      const nowMs = Date.now();
      const lastMs = readySentAt.get(k) || 0;

      // ✅ 前端 dedup：避免 UI 抖動短時間重送
      if (nowMs - lastMs >= READY_EVENT_DEDUP_MS) {
        readySentAt.set(k, nowMs);

        // 組 ready_event_v1 payload（對應你 GAS 端的格式）
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
          // source: "prod", // 如要區分來源可打開
        };

        // 送出：beacon 優先（快），失敗用 GM（穩）
        postBeaconFirst(GAS_URL, evt, "ready_event", DEFAULT_TIMEOUT_MS);

        // log（依 LOG_MODE 控制）
        logGroup(`[ReadyOnly] ⚡ ready_event ${payloadTs} ${panel} master=${masterId}`, evt);
      }
    }

    // 更新 lastStatus（必須放最後，否則 transition 判斷會失效）
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

      // 掃描 DOM 取得每一列資料
      const bodyRows = scanPanel(bodyPanel);
      const footRows = scanPanel(footPanel);

      // 對每一位師傅判斷是否出現準備 transition
      bodyRows.forEach((r) => maybeSendReadyEvent("body", r, ts));
      footRows.forEach((r) => maybeSendReadyEvent("foot", r, ts));
    } catch (e) {
      // 防止 tick 任何錯誤導致整個 interval 失效
      console.error("[ReadyOnly] 🔥 tick error:", e);
    }
  }

  // =========================
  // ✅ 17) 壓測：產生壓測用 masterId
  // =========================
  function makeStressMasterId(i) {
    // 例：T001 ~ T030
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
      source: "stress", // 用於後端 log 區分（如果你要）
    };

    if (LOG_MODE !== "off") console.log("[Stress] ▶ send", masterId, ts);

    // 壓測用：timeout 拉長到 45 秒，避免 GAS lock wait 造成誤判
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

    // burst=true：同一瞬間爆發（最極限，最容易 timeout）
    if (STRESS.burst) {
      for (let i = 0; i < STRESS.count; i++) sendOneStress(i);
    } else {
      // burst=false：每 gapMs 送一次（推薦，較穩）
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

    // 立刻跑一次（避免等第一個 interval）
    tick();

    // 進入定時掃描
    setInterval(tick, INTERVAL_MS);

    // ✅ 提供 Console 手動觸發壓測
    // 用法：window.__runStress()
    window.__runStress = runStress;

    // ✅ 可選：載入後自動壓測（預設關閉）
    if (STRESS.enabled && STRESS.autorun) {
      setTimeout(runStress, Math.max(0, STRESS.delayMs || 0));
    }
  }

  // =========================
  // ✅ 21) DOM Ready 判斷（確保 DOM 可掃）
  // =========================
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
