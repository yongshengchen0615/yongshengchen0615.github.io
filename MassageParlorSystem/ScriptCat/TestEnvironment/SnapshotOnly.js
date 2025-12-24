// ==UserScript==
// @name         Body+Foot Snapshot ONLY (Change-only, GM_xhr, Throttle 2s)
// @namespace    http://scriptcat.org/
// @version      1.0.0
// @description  只做「身體/腳底」面板 snapshot_v1：change-only + 2s 節流；GM_xmlhttpRequest 避 CSP；不吞錯
// @match        https://yongshengchen0615.github.io/master.html
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // ✅ 1) GAS Web App 端點（Snapshot 接收 /exec）
  // =========================
  // 前端會把掃描到的「身體/腳底」資料用 snapshot_v1 POST 到這個 URL
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbxtgOJJaPJjX3xddi9g8s-kS2JKvHTkYyhi67Z8pbvJ9ODcxdL0_-GUEjGgWmSN61sdxQ/exec";

  // =========================
  // ✅ 2) 掃描與節流參數
  // =========================
  const INTERVAL_MS = 1000;            // 每 1 秒掃描一次 DOM（掃描頻率）
  const SNAPSHOT_THROTTLE_MS = 2000;   // 最多每 2 秒送出一次 snapshot（送出節流）

  // LOG_MODE：
  // - "full"  ：輸出詳細 log
  // - "group" ：折疊群組 log（較清楚）
  // - "off"   ：不輸出 log（正式建議 off 或 group）
  const LOG_MODE = "group";

  // 是否啟用 snapshot 送出功能（正式開關）
  const ENABLE_SNAPSHOT = true;

  console.log("[SnapshotOnly] 🟢 start (GM_xmlhttpRequest mode)");

  // =========================
  // ✅ 3) 工具：取得 ISO 格式時間字串
  // =========================
  function nowIso() {
    return new Date().toISOString();
  }

  // =========================
  // ✅ 4) DOM 工具：讀取文字（去空白）
  // =========================
  function getText(el) {
    if (!el) return "";
    // 移除所有空白並 trim，避免版面排版造成比對誤差
    return el.textContent.replace(/\s+/g, "").trim();
  }

  // =========================
  // ✅ 5) DOM 工具：取第一個 span 的 class（通常是文字顏色 class）
  // =========================
  function getFirstSpanClass(el) {
    if (!el) return "";
    const span = el.querySelector("span[class]");
    return span ? span.className.trim() : "";
  }

  // =========================
  // ✅ 6) DOM 工具：抓 bg-* 的 class（背景色 class）
  // =========================
  function getBgClass(el) {
    if (!el) return "";
    const cls = (el.className || "").toString();
    // 只抓第一個符合 bg-xxxx 的 class（例如 bg-green-500）
    const m = cls.match(/\bbg-[A-Za-z0-9_-]+\b/);
    return m ? m[0] : "";
  }

  // =========================
  // ✅ 7) hash 工具：把字串做成雜湊（change-only 判斷用）
  // =========================
  // 這裡用的是簡單 hash（類 djb2 變形），速度快、足夠用於「是否變更」判斷
  function hashStr(str) {
    str = String(str || "");
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    // >>>0 轉成無符號 32-bit，最後用 16 進位字串表示
    return (h >>> 0).toString(16);
  }

  // =========================
  // ✅ 8) 產生「穩定欄位」版本（避免 timestamp 造成永遠不同）
  // =========================
  // 核心：change-only 的判斷不能把 timestamp 算進去，否則每秒都不同 → 永遠會送
  // 所以只保留「會影響畫面/狀態」的欄位做 hash
  function stableRowsForHash(rows) {
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
  // ✅ 9) 解析單列資料（1 row -> object）
  // =========================
  function parseRow(row) {
    // 每列通常有 4 個 div：號碼 / 師傅 / 狀態 / 預約
    const cells = row.querySelectorAll(":scope > div");
    if (cells.length < 4) return null;

    const indexCell = cells[0];        // 號碼欄
    const masterCell = cells[1];       // 師傅欄
    const statusCell = cells[2];       // 狀態欄
    const appointmentCell = cells[3];  // 預約欄

    const indexText = getText(indexCell);
    const masterText = getText(masterCell);
    let statusText = getText(statusCell);
    const appointment = getText(appointmentCell);

    // 沒師傅就略過（避免送空資料）
    if (!masterText) return null;

    // 若狀態是純數字，通常代表「剩餘分鐘」之類 → 轉成 工作中 + remaining
    let remaining = "";
    if (/^-?\d+$/.test(statusText)) {
      remaining = parseInt(statusText, 10);
      statusText = "工作中";
    }

    // 抓文字顏色 class（用於 UI/狀態顯示）
    const colorIndex = getFirstSpanClass(indexCell);
    const colorMaster = getFirstSpanClass(masterCell);
    const colorStatus = getFirstSpanClass(statusCell);

    // 抓背景色 class（用於 UI/狀態顯示）
    const bgIndex = getBgClass(indexCell);
    const bgMaster = getBgClass(masterCell);
    const bgStatus = getBgClass(statusCell);
    const bgAppointment = getBgClass(appointmentCell);

    // index 轉數字（轉不了就留空）
    const idxNum = indexText ? parseInt(indexText, 10) : "";

    // 組成統一資料格式（後端/前端都能穩定使用）
    return {
      index: idxNum,
      sort: idxNum,                 // sort 通常同 index（若未來要自訂排序可改）
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

  // =========================
  // ✅ 10) 掃描某個面板（身體/腳底）取得所有列資料
  // =========================
  function scanPanel(panelEl) {
    if (!panelEl) return [];
    // 這個 selector 是每列的 DOM class（若頁面改版需同步調整）
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
  // ✅ 11) 找到「身體」面板容器
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
  // ✅ 12) 找到「腳底」面板容器
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
  // ✅ 13) 網路送出：GM_xmlhttpRequest（避 CSP、跨域可用）
  // =========================
  function postJsonGM(url, payload) {
    if (!url) return;
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        // GAS doPost 常用 text/plain 解析（你後端也多用 e.postData.contents）
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        data: JSON.stringify(payload),

        // 這裡 timeout 8s：若後端瞬間慢（寫表/鎖）可能會 timeout，但不等於沒收到
        timeout: 8000,

        // onload：成功回應（你這裡刻意不印，避免 log 太吵）
        onload: function () {},

        // onerror：網路錯誤
        onerror: function (err) {
          console.error("[SnapshotOnly] ❌ GM POST failed:", err);
        },

        // ontimeout：超時（可能後端收到但回慢）
        ontimeout: function () {
          console.error("[SnapshotOnly] ❌ GM POST timeout");
        },
      });
    } catch (e) {
      console.error("[SnapshotOnly] ❌ GM exception:", e);
    }
  }

  // =========================
  // ✅ 14) 送出策略：sendBeacon 優先，失敗再 fallback GM
  // =========================
  // sendBeacon 優點：背景送出、卸載頁面前也可能送出
  // 缺點：不一定保證成功、不一定能拿到回應
  function postBeaconFirst(url, payload, tag) {
    if (!url) return;

    try {
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "text/plain;charset=utf-8",
        });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return; // ✅ beacon 成功就結束
        console.warn(
          `[SnapshotOnly] ⚠️ sendBeacon failed${tag ? " (" + tag + ")" : ""} → fallback GM`
        );
      }
    } catch (e) {
      console.warn(
        `[SnapshotOnly] ⚠️ sendBeacon error${tag ? " (" + tag + ")" : ""} → fallback GM`,
        e
      );
    }

    // beacon 失敗/例外 → fallback GM
    postJsonGM(url, payload);
  }

  // =========================
  // ✅ 15) log 工具：group/console 控制
  // =========================
  function logGroup(title, payload) {
    if (LOG_MODE === "off") return;
    if (LOG_MODE === "full") return console.log(title, payload);
    console.groupCollapsed(title);
    console.log("payload =", payload);
    console.groupEnd();
  }

  // =========================
  // ✅ 16) change-only + throttle 狀態變數
  // =========================
  let lastSnapshotHash = "";     // 上一次已「成功送出」的 snapshot hash（用來判斷是否變更）
  let lastSnapshotSentMs = 0;    // 上一次送出時間（用來做 2 秒節流）

  // pendingSnapshot：當偵測到變更時，先放到 pending，等節流時間到再送
  let pendingSnapshot = null;      // { payload, title }
  let pendingSnapshotHash = "";    // pending 對應的 hash（送出後會變成 lastSnapshotHash）

  // =========================
  // ✅ 17) flush：嘗試送出 pendingSnapshot（受 throttle 限制）
  // =========================
  function flushPendingSnapshot(force) {
    // 沒有 pending 就不做事
    if (!pendingSnapshot) return;

    const nowMs = Date.now();

    // force=false 時：必須符合「距離上次送出 >= 2秒」才能送
    if (!force && nowMs - lastSnapshotSentMs < SNAPSHOT_THROTTLE_MS) return;

    // 取出 pending payload 與 log title
    const { payload, title } = pendingSnapshot;

    // 送出：beacon 優先，失敗走 GM
    postBeaconFirst(GAS_URL, payload, "snapshot");

    // log（依 LOG_MODE 控制）
    logGroup(title, payload);

    // 更新送出時間與最後 hash（代表這個變更已送出）
    lastSnapshotSentMs = nowMs;
    lastSnapshotHash = pendingSnapshotHash;

    // 清掉 pending（代表已送完）
    pendingSnapshot = null;
    pendingSnapshotHash = "";
  }

  // =========================
  // ✅ 18) safeFlush：避免 flush 例外導致整個 tick 壞掉
  // =========================
  function safeFlushPendingSnapshot(force, reason) {
    try {
      flushPendingSnapshot(force);
    } catch (e) {
      console.error(
        `[SnapshotOnly] ❌ flushPendingSnapshot failed (${reason || "unknown"})`,
        e
      );
    }
  }

  // =========================
  // ✅ 19) tick：每秒掃描一次，變更才送，且最多 2 秒送一次
  // =========================
  function tick() {
    try {
      if (!ENABLE_SNAPSHOT || !GAS_URL) return;

      // 找面板 DOM
      const bodyPanel = findBodyPanel();
      const footPanel = findFootPanel();
      const ts = nowIso();

      // 掃描 raw rows（包含顏色、背景等）
      const bodyRowsRaw = scanPanel(bodyPanel);
      const footRowsRaw = scanPanel(footPanel);

      // 取「穩定欄位」做 hash（避免 timestamp 造成永遠變更）
      const bodyStable = stableRowsForHash(bodyRowsRaw);
      const footStable = stableRowsForHash(footRowsRaw);

      // 生成本次 snapshot hash（body+foot 合併）
      const snapshotHash = hashStr(JSON.stringify({ body: bodyStable, foot: footStable }));

      // ✅ 若 hash 不同 => 代表資料真的變更（change-only）
      if (snapshotHash !== lastSnapshotHash) {
        // 送出 payload 仍保留 timestamp（方便後端追蹤與時序）
        // 注意：timestamp 不參與 hash，但會被送出
        const bodyRows = bodyRowsRaw.map((r) => ({ timestamp: ts, ...r }));
        const footRows = footRowsRaw.map((r) => ({ timestamp: ts, ...r }));

        // snapshot_v1 payload（對應後端模式）
        const payload = {
          mode: "snapshot_v1",
          timestamp: ts,
          body: bodyRows,
          foot: footRows,
        };

        // 先放入 pending（由 throttle 控制是否立刻送）
        pendingSnapshot = {
          payload,
          title: `[SnapshotOnly] 📤 snapshot_changed(throttle<=2s) ${ts} body=${bodyRows.length} foot=${footRows.length}`,
        };
        pendingSnapshotHash = snapshotHash;

        // 嘗試送出（若 2 秒未到會暫不送，留待後續 tick 再送）
        safeFlushPendingSnapshot(false, "tick");
      } else {
        // ✅ 沒變更：不送 payload，僅 log（可關）
        if (LOG_MODE !== "off") console.log(`[SnapshotOnly] ⏸ snapshot unchanged (${ts})`);

        // 即使沒變更，也嘗試 flush（可能有 pending 正在等節流）
        safeFlushPendingSnapshot(false, "tick-unchanged");
      }
    } catch (e) {
      console.error("[SnapshotOnly] 🔥 tick error:", e);
    }
  }

  // =========================
  // ✅ 20) start：啟動 loop + 在離開頁面時強制 flush
  // =========================
  function start() {
    console.log("[SnapshotOnly] ▶️ start loop", INTERVAL_MS, "ms");

    // 立刻跑一次，避免等 1 秒才出第一筆
    tick();

    // 每 1 秒掃一次
    setInterval(tick, INTERVAL_MS);

    // ✅ pagehide/beforeunload：頁面離開前強制 flush pending（避免最後一筆變更丟失）
    window.addEventListener("pagehide", () => safeFlushPendingSnapshot(true, "pagehide"));
    window.addEventListener("beforeunload", () => safeFlushPendingSnapshot(true, "beforeunload"));
  }

  // =========================
  // ✅ 21) DOM Ready 判斷（確保 DOM 已載入）
  // =========================
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
