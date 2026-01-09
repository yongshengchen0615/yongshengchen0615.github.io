// ==UserScript==
// @name         Report Collector -> GAS (with techNo)
// @namespace    https://yourdomain.local/
// @version      1.0.0
// @description  Collect techNo + summary cards + ant-table rows and POST to GAS
// @match        https://yongshengchen0615.github.io/Performance.html
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ✅ 改成你的 GAS Web App URL（/exec）
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzuU4eN6-qchYYA43AMNdkiRXbjScOp_XMvrVi1G9AkBgNX3eWXNANNAnGF4sTD7Mnd/exec";

  // ✅ 資料來源標記（可自訂）
  const SOURCE_NAME = "report_page_v1";

  // ✅ 是否自動定時送出（建議先用手動按鈕驗證）
  const AUTO_SEND = true;
  const AUTO_SEND_INTERVAL_MS = 5 * 1000;

  // ----------------------------
  // Utils
  // ----------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function text(el) {
    return (el && el.textContent ? el.textContent : "").trim();
  }

  function safeNumber(v) {
    // 允許 1.5 這種節數
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeHash(str) {
    // 輕量 hash（非加密）避免同內容重送
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  // ----------------------------
  // Extract: techNo (師傅號碼)
  // ----------------------------
  function extractTechNo() {
    // 例如：<p class="text-C599F48">師傅號碼：<span>10</span></p>
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";

    const span = p.querySelector("span");
    const v = (span ? span.textContent : "").trim();
    return v; // "10"
  }

  // ----------------------------
  // Extract: Summary cards (排班 / 老點 / 總計)
  // ----------------------------
  function extractSummaryCards() {
    // 你的結構：<div class="flex mb-4"> ... <div><p>排班</p><table>...</table></div> ... </div>
    const flex = document.querySelector("div.flex.mb-4");
    if (!flex) return {};

    const blocks = Array.from(flex.children).filter((d) => d && d.querySelector);
    const out = {};

    for (const block of blocks) {
      const title = text(block.querySelector("p.mb-2"));
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

  // ----------------------------
  // Extract: Ant table rows
  // ----------------------------
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

  // ----------------------------
  // Build payload
  // ----------------------------
  function buildPayload() {
    const techNo = extractTechNo();
    const summary = extractSummaryCards();
    const detail = extractAntTableRows();

    const payload = {
      mode: "appendReport_v1",
      source: SOURCE_NAME,
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso(),
      techNo, // ✅ 新增
      summary,
      detail,
    };

    // ✅ 把 techNo 也納入去重 key
    payload.clientHash = makeHash(
      JSON.stringify({
        pageUrl: payload.pageUrl,
        techNo: payload.techNo,
        summary: payload.summary,
        detail: payload.detail,
      })
    );

    return payload;
  }

  // ----------------------------
  // POST to GAS
  // ----------------------------
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

  // ----------------------------
  // UI Button (Manual send)
  // ----------------------------
  function mountButton() {
    const btn = document.createElement("button");
    btn.textContent = "送出報表";
    btn.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      padding: 10px 14px; border-radius: 10px; border: 1px solid #999;
      background: #111; color: #fff; font-size: 14px; cursor: pointer;
      box-shadow: 0 6px 18px rgba(0,0,0,.25);
    `;

    const badge = document.createElement("div");
    badge.style.cssText = `
      position: fixed; right: 16px; bottom: 56px; z-index: 999999;
      background: rgba(0,0,0,.75); color: #fff; padding: 6px 10px;
      border-radius: 10px; font-size: 12px; display: none;
      max-width: 45vw;
      white-space: pre-wrap;
    `;

    document.body.appendChild(btn);
    document.body.appendChild(badge);

    function toast(msg) {
      badge.textContent = msg;
      badge.style.display = "block";
      setTimeout(() => (badge.style.display = "none"), 2800);
    }

    btn.addEventListener("click", async () => {
      try {
        const payload = buildPayload();

        if (!payload.detail.length) {
          toast("抓不到明細表：請確認表格已載入完成");
          return;
        }

        toast(
          `送出中…\ntechNo=${payload.techNo || "(未抓到)"}\n明細=${payload.detail.length}筆`
        );
        const res = await postToGAS(payload);

        if (res.json && res.json.ok) {
          toast(
            `✅ 寫入成功\nsummary=${res.json.summaryAppended} detail=${res.json.detailAppended}\n${
              res.json.deduped ? "（去重：未重寫）" : ""
            }`
          );
        } else {
          toast(`⚠️ 送出失敗：${JSON.stringify(res.json || res.text).slice(0, 220)}`);
        }
      } catch (e) {
        toast(`❌ 送出錯誤：${String(e)}`);
      }
    });
  }

  // ----------------------------
  // Boot
  // ----------------------------
  mountButton();

  if (AUTO_SEND) {
    (async () => {
      while (true) {
        await sleep(AUTO_SEND_INTERVAL_MS);
        try {
          const payload = buildPayload();
          if (!payload.detail.length) continue;
          await postToGAS(payload);
        } catch (_) {}
      }
    })();
  }
})();
