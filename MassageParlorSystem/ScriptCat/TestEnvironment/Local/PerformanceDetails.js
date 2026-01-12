// ==UserScript==
// @name         PerformanceDetails Auto Sync -> GAS (P_DETAIL, reliable commit)
// @namespace    https://local/
// @version      1.8
// @description  Collect techNo + summary + detail rows from POS(#/performance?tab=P_DETAIL) and GitHub page; send only when changed (clientHash). Commit hash only after ok:true.
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

  /* =====================================================
   * 0) Page Gate（判斷目前是哪個頁面）
   * ===================================================== */
  const PAGE = detectPage_();
  if (!PAGE) return;

  console.log("[AUTO_PERF] loaded:", PAGE, location.href, "hash=", location.hash);

  function detectPage_() {
    const href = String(location.href || "");

    // A) POS：#/performance?tab=P_DETAIL
    if (href.startsWith("https://yspos.youngsong.com.tw/")) {
      const h = String(location.hash || "");
      if (h.startsWith("#/performance") && h.includes("tab=P_DETAIL")) return "POS_P_DETAIL";
      return "";
    }

    // B) GitHub 靜態頁
    if (href.startsWith("https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html")) {
      return "GITHUB_PERF_DETAIL";
    }

    return "";
  }

  function stillOnTargetPage_() {
    // POS 是 SPA，hash 可能切走；GitHub 不會
    if (PAGE === "POS_P_DETAIL") {
      const h = String(location.hash || "");
      return h.startsWith("#/performance") && h.includes("tab=P_DETAIL");
    }
    return true;
  }

  /* =====================================================
   * 1) Config（@resource JSON）
   * ===================================================== */
  const GAS_RESOURCE = "gasConfigPerformanceDetailsTEL";
  const DEFAULT_CFG = { GAS_URL: "" };
  let CFG = { ...DEFAULT_CFG };

  function safeJsonParse_(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function loadJsonOverrides_() {
    try {
      if (typeof GM_getResourceText !== "function") return {};
      const raw = GM_getResourceText(GAS_RESOURCE);
      const parsed = safeJsonParse_(raw);
      if (!parsed || typeof parsed !== "object") return {};
      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL")) out.GAS_URL = parsed.GAS_URL;
      return out;
    } catch {
      return {};
    }
  }

  function applyConfigOverrides_() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverrides_() };
  }

  applyConfigOverrides_();

  if (!CFG.GAS_URL) {
    console.warn(
      "[AUTO_PERF] ⚠️ CFG.GAS_URL is empty. Will keep scanning DOM, but will NOT send network requests.\n" +
        'Check @resource JSON: {"GAS_URL":"https://script.google.com/macros/s/.../exec"}'
    );
  }

  const SOURCE_NAME = "performance_details_v1";
  const THROTTLE_MS = 650;

  /* =====================================================
   * 2) Utils
   * ===================================================== */
  function text_(el) {
    return (el && el.textContent ? el.textContent : "").trim();
  }

  function safeNumber_(v) {
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function nowIso_() {
    return new Date().toISOString();
  }

  // FNV-1a 32-bit（輕量 hash，用於判斷內容是否變動）
  function makeHash_(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  // 日期正規化：轉成 YYYY-MM-DD，讓 rangeKey 穩定
  function normalizeDate_(s) {
    const raw = String(s || "").trim();
    if (!raw) return "";

    // yy-mm-dd 例如 26-01-11 => 2026-01-11
    let m = raw.match(/^(\d{2})-(\d{2})-(\d{2})$/);
    if (m) {
      const yy = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return raw;
      return `${String(2000 + yy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }

    // yyyy/mm/dd or yyyy-mm-dd or yyyy.m.d
    m = raw.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (m) {
      const yyyy = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return raw;
      return `${String(yyyy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }

    return raw;
  }

  /* =====================================================
   * 3) Extractors（擷取 techNo / summary / detail）
   * ===================================================== */

  // 師傅號碼：<p>師傅號碼：<span>10</span></p>
  function extractTechNo_() {
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim();
  }

  // POS 的 summary cards（div.flex.mb-4）
  function extractSummaryCards_POS_() {
    const flex = document.querySelector("div.flex.mb-4");
    if (!flex) return {};
    const blocks = Array.from(flex.children).filter((d) => d && d.querySelector);
    const out = {};
    for (const block of blocks) {
      const title = text_(block.querySelector("p.mb-2")); // 排班/老點/總計
      const tds = Array.from(block.querySelectorAll("tbody td")).map((td) => text_(td));
      if (!title || tds.length < 4) continue;
      out[title] = {
        單數: safeNumber_(tds[0]),
        筆數: safeNumber_(tds[1]),
        數量: safeNumber_(tds[2]),
        金額: safeNumber_(tds[3]),
      };
    }
    return out;
  }

  // GitHub summary：先沿用 POS selector，抓不到就 {}
  function extractSummaryCards_GITHUB_() {
    return extractSummaryCards_POS_();
  }

  // POS AntD table（13 欄）
  function extractDetailRows_POS_() {
    const tbody = document.querySelector(".ant-table-body tbody.ant-table-tbody");
    if (!tbody) return [];

    const rows = Array.from(tbody.querySelectorAll("tr.ant-table-row")).filter(
      (tr) => !tr.classList.contains("ant-table-measure-row")
    );

    const out = [];
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll("td.ant-table-cell"));
      if (tds.length < 13) continue;

      out.push({
        訂單日期: normalizeDate_(text_(tds[0])),
        訂單編號: text_(tds[1]),
        序: safeNumber_(text_(tds[2])),
        拉牌: text_(tds[3]),
        服務項目: text_(tds[4]),
        業績金額: safeNumber_(text_(tds[5])),
        抽成金額: safeNumber_(text_(tds[6])),
        數量: safeNumber_(text_(tds[7])),
        小計: safeNumber_(text_(tds[8])),
        分鐘: safeNumber_(text_(tds[9])),
        開工: text_(tds[10]),
        完工: text_(tds[11]),
        狀態: text_(tds[12]),
      });
    }
    return out;
  }

  // GitHub：優先吃 ant-table 結構；不行就找一般 <table>（表頭含訂單日期/訂單編號）
  function extractDetailRows_GITHUB_() {
    const ant = extractDetailRows_POS_();
    if (ant.length) return ant;

    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const ths = Array.from(table.querySelectorAll("thead th")).map((th) => text_(th));
      const hasDate = ths.some((t) => t.includes("訂單") && t.includes("日期")) || ths.includes("訂單日期");
      const hasNo = ths.some((t) => t.includes("訂單") && t.includes("編號")) || ths.includes("訂單編號");
      if (!hasDate || !hasNo) continue;

      const out = [];
      const trs = Array.from(table.querySelectorAll("tbody tr"));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll("td")).map((td) => text_(td));
        if (tds.length < 13) continue;

        out.push({
          訂單日期: normalizeDate_(tds[0]),
          訂單編號: tds[1],
          序: safeNumber_(tds[2]),
          拉牌: tds[3],
          服務項目: tds[4],
          業績金額: safeNumber_(tds[5]),
          抽成金額: safeNumber_(tds[6]),
          數量: safeNumber_(tds[7]),
          小計: safeNumber_(tds[8]),
          分鐘: safeNumber_(tds[9]),
          開工: tds[10],
          完工: tds[11],
          狀態: tds[12],
        });
      }
      if (out.length) return out;
    }
    return [];
  }

  /* =====================================================
   * 4) Build payload（計算 rangeKey + clientHash）
   * ===================================================== */
  function buildPayload_() {
    const techNo = extractTechNo_();
    const summary = PAGE === "POS_P_DETAIL" ? extractSummaryCards_POS_() : extractSummaryCards_GITHUB_();
    const detail = PAGE === "POS_P_DETAIL" ? extractDetailRows_POS_() : extractDetailRows_GITHUB_();

    // rangeKey：用訂單日期算 min~max，確保同一個範圍 key 固定
    let minDate = "";
    let maxDate = "";
    for (const r of detail) {
      const d = String(r["訂單日期"] || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
    const rangeKey = minDate && maxDate ? `${minDate}~${maxDate}` : "";

    const payload = {
      mode: "upsertDetailPerf_v1",
      source: SOURCE_NAME,
      pageType: PAGE, // 方便 GAS/除錯辨識來源
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso_(),
      techNo,
      rangeKey,
      summary,
      detail,
    };

    // clientHash：只根據「內容」產生（不能含時間）
    payload.clientHash = makeHash_(
      JSON.stringify({
        pageType: payload.pageType,
        techNo: payload.techNo,
        rangeKey: payload.rangeKey,
        summary: payload.summary,
        detail: payload.detail,
      })
    );

    return payload;
  }

  /* =====================================================
   * 5) POST to GAS
   * ===================================================== */
  function postToGAS_(payload) {
    return new Promise((resolve, reject) => {
      if (!CFG.GAS_URL) return resolve({ status: 0, json: { ok: false, error: "CFG_GAS_URL_EMPTY" } });

      GM_xmlhttpRequest({
        method: "POST",
        url: CFG.GAS_URL,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        onload: (res) => {
          try {
            const json = JSON.parse(res.responseText || "{}");
            resolve({ status: res.status, json });
          } catch {
            resolve({ status: res.status, text: res.responseText });
          }
        },
        onerror: reject,
      });
    });
  }

  /* =====================================================
   * 6) Auto watch + send only when changed
   *    ✅ 只有 ok:true 才 commit lastHash（修正核心問題）
   * ===================================================== */
  let lastHash = "";       // 已成功寫入 GAS 的 hash
  let pendingHash = "";    // 正在嘗試送出的 hash（避免並發重送）
  let inFlight = false;    // 避免同時多個請求
  let timer = null;

  // 用來避免 console 一直刷同樣 skip 訊息
  let lastSkipReason = "";
  function logSkip_(reason, extra) {
    const msg = String(reason || "");
    if (!msg || msg === lastSkipReason) return;
    lastSkipReason = msg;
    console.log("[AUTO_PERF] skip:", msg, extra || "");
  }

  async function checkAndSend_() {
    try {
      if (!stillOnTargetPage_()) return;
      if (inFlight) return;

      const payload = buildPayload_();

      // 1) 明細沒有 → 不送（GAS 會擋 EMPTY_DETAIL）
      if (!payload.detail.length) {
        logSkip_("EMPTY_DETAIL", { pageType: payload.pageType });
        return;
      }

      // 2) techNo 沒有 → 不送（GAS 會擋 MISSING_techNo）
      if (!String(payload.techNo || "").trim()) {
        logSkip_("MISSING_TECHNO", { pageType: payload.pageType });
        return;
      }

      // 3) rangeKey 算不出來 → 不送（key 不穩）
      if (!payload.rangeKey) {
        const sampleDates = payload.detail.slice(0, 3).map((r) => String(r["訂單日期"] || ""));
        logSkip_("MISSING_RANGEKEY", { sampleDates });
        return;
      }

      // 4) 已成功同步過同一份內容 → 不送
      if (payload.clientHash === lastHash) {
        logSkip_("NO_CHANGE_HASH", { hash: payload.clientHash });
        return;
      }

      // 5) 同一份內容正在送 → 不重送
      if (payload.clientHash === pendingHash) {
        logSkip_("PENDING_HASH", { hash: payload.clientHash });
        return;
      }

      inFlight = true;
      pendingHash = payload.clientHash;

      const res = await postToGAS_(payload);
      const ok = res && res.json && res.json.ok === true;

      if (ok) {
        // ✅ 成功才 commit（這就是你要修的「GAS 不更新」核心）
        lastHash = payload.clientHash;
        pendingHash = "";

        console.log("[AUTO_PERF] ok:", res.json.result, "key=", res.json.key, "hash=", lastHash);
      } else {
        // ❗失敗不 commit，讓下次還能重送
        console.warn("[AUTO_PERF] fail:", { status: res && res.status, body: res && (res.json || res.text) });
        pendingHash = "";
      }
    } catch (e) {
      console.warn("[AUTO_PERF] error:", e);
      pendingHash = "";
    } finally {
      inFlight = false;
    }
  }

  function schedule_() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      checkAndSend_();
    }, THROTTLE_MS);
  }

  /* =====================================================
   * 7) Start（啟動監聽）
   * ===================================================== */

  // 初次執行一次（頁面可能已經渲染好）
  schedule_();

  // DOM 變動監聽（React/AntD / GitHub JS 也可能改 DOM）
  const observer = new MutationObserver(schedule_);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // POS 是 SPA：hash 切換要補觸發
  window.addEventListener("hashchange", schedule_);

  // 保險：低頻輪詢（避免某些更新沒觸發 mutation）
  setInterval(() => {
    if (!stillOnTargetPage_()) return;
    schedule_();
  }, 4000);
})();
