// ==UserScript==
// @name         Report Auto Sync -> GAS (FAST, one-shot)
// @namespace    https://local/
// @version      2.0
// @description  FAST: detect ready → send once → hard stop
// @match        https://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @run-at       document-idle
// @resource     gasConfigReportTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/Local/gas-report-config-TEL.json
// ==/UserScript==

(function () {
  "use strict";

  /* ---------- Page Gate ---------- */
  function isTargetPage() {
    const h = location.hash || "";
    return h.startsWith("#/performance") && h.includes("tab=P_STATIC");
  }
  if (!isTargetPage()) return;

  /* ---------- Config ---------- */
  let CFG = {};
  try {
    CFG = JSON.parse(GM_getResourceText("gasConfigReportTEL") || "{}");
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

  function getSummary() {
    const flex = document.querySelector("div.flex.mb-4");
    if (!flex) return null;

    const out = {};
    for (const block of flex.children) {
      const title = text(block.querySelector("p.mb-2"));
      const tds = [...block.querySelectorAll("tbody td")].map((td) => text(td));
      if (!title || tds.length < 4) continue;
      out[title] = {
        單數: num(tds[0]),
        筆數: num(tds[1]),
        數量: num(tds[2]),
        金額: num(tds[3]),
      };
    }
    return Object.keys(out).length ? out : null;
  }

  function getDetail() {
    const tbody = document.querySelector(".ant-table-tbody");
    if (!tbody) return null;
    const rows = [...tbody.querySelectorAll("tr.ant-table-row")];
    if (!rows.length) return null;

    return rows.map((tr) => {
      const td = tr.querySelectorAll("td");
      return {
        服務項目: text(td[0]),
        總筆數: num(text(td[1])),
        總節數: num(text(td[2])),
        總計金額: num(text(td[3])),
      };
    });
  }

  /* ---------- One-shot Send ---------- */
  let done = false;
  let observer, timer;

  function stopAll() {
    done = true;
    observer && observer.disconnect();
    timer && clearInterval(timer);
  }

  function trySend() {
    if (done || !isTargetPage()) return;

    const techNo = getTechNo();
    const summary = getSummary();
    const detail = getDetail();

    if (!techNo || !summary || !detail) return;

    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        mode: "upsertReport_v1",
        techNo,
        summary,
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

  observer = new MutationObserver(trySend);
  observer.observe(document.body, { childList: true, subtree: true });
  timer = setInterval(trySend, 400);
})();
