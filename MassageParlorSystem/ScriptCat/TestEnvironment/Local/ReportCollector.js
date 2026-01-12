// ==UserScript==
// @name         Report Auto Sync -> GAS (FAST, one-shot)
// @namespace    https://local/
// @version      2.2
// @description  FAST: detect ready → send once → hard stop (with clientHash)
// @match        https://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @connect      script.googleusercontent.com
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

  // FNV-1a 32-bit (快、夠用)
  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

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

    const payload = {
      mode: "upsertReport_v1",
      techNo,
      summary,
      detail,
      pageUrl: location.href,
      pageTitle: document.title || "",
      source: "scriptcat",
      clientTsIso: new Date().toISOString(),
      // ✅ GAS 必填
      clientHash: fnv1a32(JSON.stringify({ techNo, summary, detail })),
      // dateKey 可不送；GAS 會用今天（台北）
      // dateKey: "yyyy-MM-dd",
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 15000,
      onload: (res) => {
        const raw = res.responseText || "";
        let j = null;
        try { j = JSON.parse(raw); } catch {}
        if (j && j.ok === true) {
          stopAll();
          console.log("[ReportSync] OK", j);
        } else {
          console.warn("[ReportSync] FAIL", res.status, raw);
        }
      },
      ontimeout: () => console.warn("[ReportSync] TIMEOUT"),
      onerror: (e) => console.warn("[ReportSync] ERROR", e),
    });
  }

  observer = new MutationObserver(trySend);
  observer.observe(document.body, { childList: true, subtree: true });
  timer = setInterval(trySend, 400);
})();
