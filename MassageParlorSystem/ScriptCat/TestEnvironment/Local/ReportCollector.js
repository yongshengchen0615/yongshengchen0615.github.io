// ==UserScript==
// @name         Report Auto Sync -> GAS (no button, hash-based)
// @namespace    https://local/
// @version      1.1
// @description  Auto collect techNo + summary + ant-table detail; only send when data changed (clientHash)
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ✅ 1) 改成你的 GAS Web App URL（/exec）
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzuU4eN6-qchYYA43AMNdkiRXbjScOp_XMvrVi1G9AkBgNX3eWXNANNAnGF4sTD7Mnd/exec";

  // ✅ 2) 資料來源標記（可自訂）
  const SOURCE_NAME = "report_page_v1";

  // ✅ 3) 節流（React/AntD 會頻繁改 DOM）
  const THROTTLE_MS = 600;

  // =========================
  // Utils
  // =========================
  function text(el) {
    return (el && el.textContent ? el.textContent : "").trim();
  }

  function safeNumber(v) {
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // 輕量 hash（非加密），用於判斷資料是否變動
  function makeHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  // =========================
  // Extract: techNo（師傅號碼）
  // =========================
  function extractTechNo() {
    // 例：<p class="text-C599F48">師傅號碼：<span>10</span></p>
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim(); // "10"
  }

  // =========================
  // Extract: Summary cards（排班/老點/總計）
  // =========================
  function extractSummaryCards() {
    const flex = document.querySelector("div.flex.mb-4");
    if (!flex) return {};

    const blocks = Array.from(flex.children).filter((d) => d && d.querySelector);
    const out = {};

    for (const block of blocks) {
      const title = text(block.querySelector("p.mb-2")); // 排班 / 老點 / 總計
      const tds = Array.from(block.querySelectorAll("tbody td")).map((td) => text(td));
      if (!title || tds.length < 4) continue;

      out[title] = {
        單數: safeNumber(tds[0]),
        筆數: safeNumber(tds[1]),
        數量: safeNumber(tds[2]),
        金額: safeNumber(tds[3]),
      };
    }
    return out;
  }

  // =========================
  // Extract: Ant table rows（明細）
  // =========================
  function extractAntTableRows() {
    const tbody = document.querySelector(".ant-table-body tbody.ant-table-tbody");
    if (!tbody) return [];

    const rows = Array.from(tbody.querySelectorAll("tr.ant-table-row")).filter(
      (tr) => !tr.classList.contains("ant-table-measure-row")
    );

    const data = [];
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll("td.ant-table-cell"));
      if (tds.length < 10) continue;

      data.push({
        服務項目: text(tds[0]),
        總筆數: safeNumber(text(tds[1])),
        總節數: safeNumber(text(tds[2])),
        總計金額: safeNumber(text(tds[3])),
        老點筆數: safeNumber(text(tds[4])),
        老點節數: safeNumber(text(tds[5])),
        老點金額: safeNumber(text(tds[6])),
        排班筆數: safeNumber(text(tds[7])),
        排班節數: safeNumber(text(tds[8])),
        排班金額: safeNumber(text(tds[9])),
      });
    }
    return data;
  }

  // =========================
  // Build payload
  // =========================
  function buildPayload() {
    const techNo = extractTechNo();
    const summary = extractSummaryCards();
    const detail = extractAntTableRows();

    // ⚠️ 若你之後要「同一天」以外的 key（例如頁面可切日期），可在這裡加 dateKey（從頁面抓）
    const dateKey = ""; // 先留空，GAS 會用「台北今天」當 dateKey

    const payload = {
      mode: "upsertReport_v1",
      source: SOURCE_NAME,
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso(),
      techNo,
      dateKey, // 可選
      summary,
      detail,
    };

    // ✅ clientHash 必須只由「報表內容」組成（不要放時間）
    payload.clientHash = makeHash(
      JSON.stringify({
        techNo: payload.techNo,
        dateKey: payload.dateKey, // 可留空
        summary: payload.summary,
        detail: payload.detail,
      })
    );

    return payload;
  }

  // =========================
  // POST to GAS
  // =========================
  function postToGAS(payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: GAS_URL,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        onload: (res) => {
          try {
            const json = JSON.parse(res.responseText || "{}");
            resolve({ status: res.status, json });
          } catch (e) {
            resolve({ status: res.status, text: res.responseText });
          }
        },
        onerror: reject,
      });
    });
  }

  // =========================
  // Auto watch + send only when changed
  // =========================
  let lastHash = "";
  let timer = null;

  async function checkAndSend() {
    try {
      const payload = buildPayload();

      // 1) 沒抓到明細 → 不送
      if (!payload.detail.length) return;

      // 2) 同頁面中 hash 沒變 → 不送（不算更新）
      if (payload.clientHash === lastHash) return;

      // 3) hash 變了 → 送出（算一次更新）
      lastHash = payload.clientHash;

      const res = await postToGAS(payload);
      if (res.json && res.json.ok) {
        console.log("[AUTO_REPORT] ok:", res.json.result, "key=", res.json.key, "hash=", payload.clientHash);
      } else {
        console.warn("[AUTO_REPORT] fail:", res.json || res.text);
      }
    } catch (e) {
      console.warn("[AUTO_REPORT] error:", e);
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      checkAndSend();
    }, THROTTLE_MS);
  }

  // 先跑一次（頁面已載入時）
  schedule();

  // 監聽 DOM 變動（React/AntD）
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();
