// ==UserScript==
// @name         Report Auto Sync -> GAS (ULTRA FAST + STABLE)
// @namespace    https://local/
// @version      2.9
// @description  ULTRA: observer-driven + debounce + clientHash + once-per-hash + backoff retry
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

  // FNV-1a 32-bit
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

  /* ---------- Once-per-hash ---------- */
  const KEY = "P_STATIC";
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

  /* ---------- Debounce scheduler ---------- */
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

  function scheduleTry(delayMs = 120) {
    if (done) return;
    if (debounceT) clearTimeout(debounceT);
    debounceT = setTimeout(trySend, delayMs);
  }

  async function trySend() {
    if (done || sending || !isTargetPage()) return;

    const techNo = getTechNo();
    const summary = getSummary();
    const detail = getDetail();
    if (!techNo || !summary || !detail) return;

    const clientHash = fnv1a32(JSON.stringify({ techNo, summary, detail }));
    if (wasSent(clientHash)) {
      // 已成功送過同一份資料：直接停止，避免 CPU/重送
      stopAll();
      return;
    }

    const payload = {
      mode: "upsertReport_v1",
      techNo,
      summary,
      detail,
      pageUrl: location.href,
      pageTitle: document.title || "",
      source: "scriptcat",
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
          console.log("[ReportSync] OK", j);
          stopAll();
          return;
        }

        console.warn("[ReportSync] FAIL", res.status, raw);

        // 永久錯：不重試，直接停（避免狂打）
        if (isPermanentError(j)) {
          stopAll();
          return;
        }

        // 可重試：退避後再試
        if (isRetryableError(j, res.status)) {
          await sleepMs(retryDelay);
          retryDelay = Math.min(RETRY_MAX, Math.floor(retryDelay * 1.8));
          scheduleTry(0);
          return;
        }

        // 其他未知錯：延遲一點再試一次（不無限狂打）
        await sleepMs(1200);
        scheduleTry(0);
      },
      ontimeout: async () => {
        sending = false;
        console.warn("[ReportSync] TIMEOUT");
        await sleepMs(retryDelay);
        retryDelay = Math.min(RETRY_MAX, Math.floor(retryDelay * 1.8));
        scheduleTry(0);
      },
      onerror: async (e) => {
        sending = false;
        console.warn("[ReportSync] ERROR", e);
        await sleepMs(retryDelay);
        retryDelay = Math.min(RETRY_MAX, Math.floor(retryDelay * 1.8));
        scheduleTry(0);
      },
    });
  }

  // Observer 主導：DOM 一有變動 → 小 debounce → 嘗試送
  observer = new MutationObserver(() => scheduleTry(120));
  observer.observe(document.body, { childList: true, subtree: true });

  // 首次進入：快速試一次（不用等 DOM 事件）
  scheduleTry(60);

  // fallback：5 秒內每 800ms 試一次，超過就停（避免長期輪詢）
  let fallbackCount = 0;
  const fb = setInterval(() => {
    if (done) return clearInterval(fb);
    fallbackCount++;
    scheduleTry(80);
    if (fallbackCount >= 7) clearInterval(fb);
  }, 800);
})();
