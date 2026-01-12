// ==UserScript==
// @name         PerformanceDetails Auto Sync -> GAS (FAST, one-shot)
// @namespace    https://local/
// @version      3.1
// @description  FAST: wait table stable → extract once → send → hard stop
// @match        https://yspos.youngsong.com.tw/*
// @match        https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @run-at       document-idle
// @resource     gasConfigPerformanceDetailsTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/Local/gas-PerformanceDetails-config-TEL.json
// ==/UserScript==

(function () {
  "use strict";

  /* ---------- Page Detect ---------- */
  function isDetailPage() {
    if (location.href.includes("github.io/Performancedetails")) return true;
    const h = location.hash || "";
    return h.startsWith("#/performance") && h.includes("tab=P_DETAIL");
  }

  /* ---------- Config ---------- */
  let CFG = {};
  try {
    CFG = JSON.parse(GM_getResourceText("gasConfigPerformanceDetailsTEL") || "{}");
  } catch {}
  if (!CFG.GAS_URL) return;

  /* ---------- Utils ---------- */
  const text = (el) => (el && el.textContent ? el.textContent : "").trim();
  const num = (v) => {
    const n = Number(String(v || "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  /* ---------- Extract ---------- */
  function getTechNo() {
    const p = [...document.querySelectorAll("p")].find((e) =>
      (e.textContent || "").includes("師傅號碼")
    );
    return p?.querySelector("span")?.textContent.trim() || "";
  }

  function getRows() {
    const tbody = document.querySelector(".ant-table-tbody");
    if (!tbody) return [];
    return [...tbody.querySelectorAll("tr.ant-table-row")];
  }

  function extractDetail(rows) {
    return rows.map((tr) => {
      const td = tr.querySelectorAll("td");
      return {
        訂單日期: text(td[0]),
        訂單編號: text(td[1]),
        服務項目: text(td[4]),
        業績金額: num(text(td[5])),
        小計: num(text(td[8])),
        狀態: text(td[12]),
      };
    });
  }

  /* ---------- Ready Gate ---------- */
  let lastCount = 0;
  let stableHits = 0;
  const STABLE_NEED = 2;

  let observer, timer, done = false;

  function stopAll() {
    done = true;
    observer && observer.disconnect();
    timer && clearInterval(timer);
  }

  function checkReady() {
    if (done || !isDetailPage()) return;

    const techNo = getTechNo();
    if (!techNo) return;

    const rows = getRows();
    if (!rows.length) return;

    if (rows.length === lastCount) {
      stableHits++;
    } else {
      lastCount = rows.length;
      stableHits = 0;
      return;
    }

    if (stableHits < STABLE_NEED) return;

    const detail = extractDetail(rows);

    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        mode: "upsertDetailPerf_v1",
        techNo,
        detail,
        pageUrl: location.href,
        clientTsIso: new Date().toISOString(),
      }),
      onload: (res) => {
        try {
          const j = JSON.parse(res.responseText || "{}");
          if (j.ok === true) stopAll();
        } catch {}
      },
    });
  }

  observer = new MutationObserver(checkReady);
  observer.observe(document.body, { childList: true, subtree: true });
  timer = setInterval(checkReady, 350);
})();
