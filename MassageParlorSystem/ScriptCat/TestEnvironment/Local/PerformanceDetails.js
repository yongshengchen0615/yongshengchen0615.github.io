// ==UserScript==
// @name         PerformanceDetails Auto Sync -> GAS (ULTRA FAST + STABLE)
// @namespace    https://local/
// @version      3.9
// @description  ULTRA: observer-driven + debounce + stable-hash gate + once-per-hash + backoff retry
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

  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function sleepMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isRetryableError(j, status) {
    const err = String((j && (j.error || j.message)) || "");
    if (status === 429) return true;
    if (err.includes("LOCKED_TRY_LATER")) return true;
    if (err.includes("Service invoked too many times")) return true;
    return false;
  }

  function isPermanentError(j) {
    const err = String((j && (j.error || j.message)) || "");
    return (
      err.includes("MISSING_") ||
      err.includes("BAD_MODE") ||
      err.includes("EMPTY_DETAIL") ||
      err.includes("EMPTY_BODY")
    );
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

  // rangeKey：抓日期區間；抓不到就 today~today
  function getRangeKey() {
    const all = [...document.querySelectorAll("input, span, div, p")];
    const txt = all
      .map((e) => text(e))
      .find((t) => /(\d{4}[\/-]\d{2}[\/-]\d{2}).*(\d{4}[\/-]\d{2}[\/-]\d{2})/.test(t));
    if (txt) {
      const m = txt.match(/(\d{4}[\/-]\d{2}[\/-]\d{2}).*(\d{4}[\/-]\d{2}[\/-]\d{2})/);
      if (m) {
        const a = m[1].replace(/\//g, "-");
        const b = m[2].replace(/\//g, "-");
        return `${a}~${b}`;
      }
    }
    const d = new Date();
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const today = `${y}-${mm}-${dd}`;
    return `${today}~${today}`;
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

  /* ---------- Stable-hash gate (更準、更快) ---------- */
  // 用「局部指紋」快速判定是否已穩定（避免每次都 full extract）
  function quickFingerprint(rows) {
    const pick = [];
    const n = rows.length;
    const idxs = [];
    for (let i = 0; i < Math.min(3, n); i++) idxs.push(i);
    for (let i = Math.max(0, n - 3); i < n; i++) if (!idxs.includes(i)) idxs.push(i);

    for (const i of idxs) {
      const td = rows[i].querySelectorAll("td");
      // 選幾個關鍵欄位組指紋：日期、編號、項目、金額、狀態
      pick.push(
        [
          text(td[0]),
          text(td[1]),
          text(td[4]),
          text(td[5]),
          text(td[12]),
        ].join("|")
      );
    }
    return fnv1a32(`${n}::${pick.join("||")}`);
  }

  let lastFp = "";
  let stableHits = 0;
  const STABLE_NEED = 2;

  /* ---------- Once-per-hash ---------- */
  const KEY = "P_DETAIL";
  function sessKey(hash) {
    return `scat:${KEY}:sent:${hash}`;
  }
  function wasSent(hash) {
    try {
      return sessionStorage.getItem(sessKey(hash)) === "1";
    } catch {
      return false;
    }
  }
  function markSent(hash) {
    try {
      sessionStorage.setItem(sessKey(hash), "1");
    } catch {}
  }

  /* ---------- Scheduler ---------- */
  let done = false;
  let observer = null;
  let debounceT = null;

  // retry state
  let sending = false;
  let retryDelay = 600;
  const RETRY_MAX = 8000;

  function stopAll() {
    done = true;
    if (observer) observer.disconnect();
    if (debounceT) clearTimeout(debounceT);
  }

  function scheduleCheck(delayMs = 140) {
    if (done) return;
    if (debounceT) clearTimeout(debounceT);
    debounceT = setTimeout(checkReady, delayMs);
  }

  async function checkReady() {
    if (done || sending || !isDetailPage()) return;

    const techNo = getTechNo();
    if (!techNo) return;

    const rows = getRows();
    if (!rows.length) return;

    // hash 穩定判定：同一指紋連續命中 2 次才送
    const fp = quickFingerprint(rows);
    if (fp === lastFp) stableHits++;
    else {
      lastFp = fp;
      stableHits = 0;
      return;
    }
    if (stableHits < STABLE_NEED) return;

    // 到這裡才做 full extract（省 CPU）
    const rangeKey = getRangeKey();
    const detail = extractDetail(rows);
    const clientHash = fnv1a32(JSON.stringify({ techNo, rangeKey, detail }));

    if (wasSent(clientHash)) {
      stopAll();
      return;
    }

    const payload = {
      mode: "upsertDetailPerf_v1",
      techNo,
      rangeKey,
      summary: {}, // 目前不抓 summary
      detail,
      source: "scriptcat",
      pageUrl: location.href,
      pageTitle: document.title || "",
      clientTsIso: new Date().toISOString(),
      clientHash,
    };

    sending = true;

    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.GAS_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      timeout: 15000,
      onload: async (res) => {
        sending = false;

        const raw = res.responseText || "";
        let j = null;
        try {
          j = JSON.parse(raw);
        } catch {}

        if (j && j.ok === true) {
          markSent(clientHash);
          console.log("[P_DETAIL] OK", j);
          stopAll();
          return;
        }

        console.warn("[P_DETAIL] FAIL", res.status, raw);

        // 永久錯：停掉，避免狂送
        if (isPermanentError(j)) {
          stopAll();
          return;
        }

        // 可重試：退避後再試
        if (isRetryableError(j, res.status)) {
          await sleepMs(retryDelay);
          retryDelay = Math.min(RETRY_MAX, Math.floor(retryDelay * 1.8));
          scheduleCheck(0);
          return;
        }

        // 其他未知錯：延遲再試一次（不狂打）
        await sleepMs(1200);
        scheduleCheck(0);
      },
      ontimeout: async () => {
        sending = false;
        console.warn("[P_DETAIL] TIMEOUT");
        await sleepMs(retryDelay);
        retryDelay = Math.min(RETRY_MAX, Math.floor(retryDelay * 1.8));
        scheduleCheck(0);
      },
      onerror: async (e) => {
        sending = false;
        console.warn("[P_DETAIL] ERROR", e);
        await sleepMs(retryDelay);
        retryDelay = Math.min(RETRY_MAX, Math.floor(retryDelay * 1.8));
        scheduleCheck(0);
      },
    });
  }

  // Observer 主導：DOM 變動 → debounce → check
  observer = new MutationObserver(() => scheduleCheck(140));
  observer.observe(document.body, { childList: true, subtree: true });

  // 首次快速檢查
  scheduleCheck(80);

  // fallback：6 秒內每 900ms 檢查一次，之後停（避免長期輪詢）
  let fallbackCount = 0;
  const fb = setInterval(() => {
    if (done) return clearInterval(fb);
    fallbackCount++;
    scheduleCheck(60);
    if (fallbackCount >= 7) clearInterval(fb);
  }, 900);
})();
