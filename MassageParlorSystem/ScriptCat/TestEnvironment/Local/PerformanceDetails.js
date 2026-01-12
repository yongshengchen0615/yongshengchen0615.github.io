// ==UserScript==
// @name         PerformanceDetails Auto Sync -> GAS (P_DETAIL, send only when ALL data ready)
// @namespace    https://local/
// @version      2.5
// @description  Collect techNo + summary + detail rows; send ONLY when all required data is ready (techNo + 3 summary cards + detail rows). Send once per page-entry.
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

  // FNV-1a 32-bit
  function makeHash_(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function normalizeDate_(s) {
    const raw = String(s || "").trim();
    if (!raw) return "";

    let m = raw.match(/^(\d{2})-(\d{2})-(\d{2})$/);
    if (m) {
      const yy = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return raw;
      return `${String(2000 + yy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }

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

  function extractTechNo_() {
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim();
  }

  function extractSummaryCards_POS_() {
    const flex = document.querySelector("div.flex.mb-4");
    if (!flex) return {};
    const blocks = Array.from(flex.children).filter((d) => d && d.querySelector);
    const out = {};
    for (const block of blocks) {
      const title = text_(block.querySelector("p.mb-2"));
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

  function extractSummaryCards_GITHUB_() {
    return extractSummaryCards_POS_();
  }

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
        狀態: text_(tds[12]), // ✅ 允許空字串（DOM: <div></div>）
      });
    }
    return out;
  }

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
          狀態: tds[12], // ✅ 允許空字串
        });
      }
      if (out.length) return out;
    }
    return [];
  }

  /* =====================================================
   * 3.5) ✅ Completeness Checks（偵測到「所有資料」才送）
   * ===================================================== */

  // summary 必須有三張卡：排班 / 老點 / 總計，且四欄都存在
  function isSummaryComplete_(summary) {
    const need = ["排班", "老點", "總計"];
    for (const k of need) {
      const c = summary && summary[k];
      if (!c) return false;
      // 四欄必須是 number（0 也算有效）
      if (![c.單數, c.筆數, c.數量, c.金額].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
    }
    return true;
  }

  // detail：只要有資料列，且核心欄位存在（狀態允許空）
  function isDetailComplete_(detail) {
    if (!Array.isArray(detail) || detail.length <= 0) return false;

    for (const r of detail) {
      const d = String(r["訂單日期"] || "").trim();
      const no = String(r["訂單編號"] || "").trim();
      const item = String(r["服務項目"] || "").trim();

      if (!d) return false;
      if (!no) return false;
      if (!item) return false;
    }
    return true;
  }

  /* =====================================================
   * 4) Build payload（計算 rangeKey + clientHash）
   * ===================================================== */
  function buildPayload_() {
    const techNo = extractTechNo_();
    const summary = PAGE === "POS_P_DETAIL" ? extractSummaryCards_POS_() : extractSummaryCards_GITHUB_();
    const detail = PAGE === "POS_P_DETAIL" ? extractDetailRows_POS_() : extractDetailRows_GITHUB_();

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
      pageType: PAGE,
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso_(),
      techNo,
      rangeKey,
      summary,
      detail,
    };

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
   * 6) Auto watch + send ONLY when ALL ready (send once)
   * ===================================================== */
  let inFlight = false;
  let pendingHash = "";
  let timer = null;
  let sentOnce = false;

  function resetSendState_() {
    inFlight = false;
    pendingHash = "";
    sentOnce = false;
  }

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
      if (sentOnce) return;

      // ✅ 快速判斷：ant-table 已經出現真正資料列才做 buildPayload（省效能）
      const tbody = document.querySelector(".ant-table-body tbody.ant-table-tbody");
      const tableRows = tbody
        ? Array.from(tbody.querySelectorAll("tr.ant-table-row")).filter(
            (tr) => !tr.classList.contains("ant-table-measure-row")
          )
        : [];
      if (!tableRows.length) {
        logSkip_("TABLE_NOT_READY");
        return;
      }

      const payload = buildPayload_();

      // ✅ 1) techNo 必須有
      if (!String(payload.techNo || "").trim()) {
        logSkip_("MISSING_TECHNO", { pageType: payload.pageType });
        return;
      }

      // ✅ 2) summary 必須完整（三卡四欄）
      if (!isSummaryComplete_(payload.summary)) {
        logSkip_("SUMMARY_NOT_READY", { gotKeys: Object.keys(payload.summary || {}) });
        return;
      }

      // ✅ 3) detail 必須完整（核心欄位有；狀態允許空）
      if (!isDetailComplete_(payload.detail)) {
        logSkip_("DETAIL_NOT_READY", { rows: (payload.detail || []).length });
        return;
      }

      // ✅ 4) rangeKey 必須算得出來（表示日期格式已穩定）
      if (!payload.rangeKey) {
        const sampleDates = payload.detail.slice(0, 3).map((r) => String(r["訂單日期"] || ""));
        logSkip_("RANGEKEY_NOT_READY", { sampleDates });
        return;
      }

      // 同一份內容正在送 → 不重送
      if (payload.clientHash === pendingHash) {
        logSkip_("PENDING_HASH", { hash: payload.clientHash });
        return;
      }

      inFlight = true;
      pendingHash = payload.clientHash;

      const res = await postToGAS_(payload);
      const ok = res && res.json && res.json.ok === true;

      if (ok) {
        sentOnce = true; // ✅ 成功一次就停止（同次進入頁面）
        pendingHash = "";
        console.log("[AUTO_PERF] ok:", res.json.result, "key=", res.json.key, "hash=", payload.clientHash);
      } else {
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
  schedule_();

  const observer = new MutationObserver(schedule_);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // POS 是 SPA：hash 切換要補觸發
  window.addEventListener("hashchange", () => {
    if (stillOnTargetPage_()) resetSendState_();
    schedule_();
  });

  // 保險：低頻輪詢（避免你看一下就關）
  setInterval(() => {
    if (!stillOnTargetPage_()) return;
    schedule_();
  }, 1200);
})();
