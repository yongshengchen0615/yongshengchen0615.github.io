// ==UserScript==
// @name         PerformanceDetails Auto Sync -> GAS (FAST, one-shot)
// @namespace    https://local/
// @version      3.3
// @description  FAST: wait table stable → extract once → send → hard stop (with rangeKey + clientHash)
// @match        https://yspos.youngsong.com.tw/*
// @match        https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @connect      script.googleusercontent.com
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
  if (!isDetailPage()) return;

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

  // FNV-1a 32-bit
  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // rangeKey: 先抓頁面上「日期區間」，抓不到就給 today~today（台北）
  function getRangeKey() {
    // 常見：日期選擇器 input / span 會出現 "YYYY-MM-DD" 或 "YYYY/MM/DD"
    const all = [...document.querySelectorAll("input, span, div, p")];
    const txt = all.map((e) => text(e)).find((t) => /(\d{4}[\/-]\d{2}[\/-]\d{2}).*(\d{4}[\/-]\d{2}[\/-]\d{2})/.test(t));
    if (txt) {
      const m = txt.match(/(\d{4}[\/-]\d{2}[\/-]\d{2}).*(\d{4}[\/-]\d{2}[\/-]\d{2})/);
      if (m) {
        const a = m[1].replace(/\//g, "-");
        const b = m[2].replace(/\//g, "-");
        return `${a}~${b}`;
      }
    }
    // fallback: today in Asia/Taipei
    const d = new Date();
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const today = `${y}-${mm}-${dd}`;
    return `${today}~${today}`;
  }

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
        // 你的 GAS DETAIL_HEADERS 需要更多欄位，這裡先最小必需
        服務項目: text(td[4]),
        業績金額: num(text(td[5])),
        小計: num(text(td[8])),
        狀態: text(td[12]),

        // 其他欄位缺就讓 GAS 端寫入空/0（GAS 目前就是這樣處理）
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

    if (rows.length === lastCount) stableHits++;
    else {
      lastCount = rows.length;
      stableHits = 0;
      return;
    }
    if (stableHits < STABLE_NEED) return;

    const rangeKey = getRangeKey();
    const detail = extractDetail(rows);

    const payload = {
      mode: "upsertDetailPerf_v1",
      techNo,
      rangeKey,
      summary: {}, // 你目前沒抓 summary，但 GAS 允許空物件
      detail,
      source: "scriptcat",
      pageUrl: location.href,
      pageTitle: document.title || "",
      clientTsIso: new Date().toISOString(),
      clientHash: fnv1a32(JSON.stringify({ techNo, rangeKey, detail })),
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
          console.log("[P_DETAIL] OK", j);
          stopAll();
        } else {
          console.warn("[P_DETAIL] FAIL", res.status, raw);
        }
      },
      ontimeout: () => console.warn("[P_DETAIL] TIMEOUT"),
      onerror: (e) => console.warn("[P_DETAIL] ERROR", e),
    });
  }

  observer = new MutationObserver(checkReady);
  observer.observe(document.body, { childList: true, subtree: true });
  timer = setInterval(checkReady, 350);
})();
