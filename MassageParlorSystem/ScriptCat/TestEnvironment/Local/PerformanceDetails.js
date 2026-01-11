// ==UserScript==
// @name         PerformanceDetails Auto Sync -> GAS (POS P_DETAIL + GitHub)
// @namespace    https://local/
// @version      1.5
// @description  Collect techNo + summary + detail rows from POS(#/performance?tab=P_DETAIL) and GitHub page; send only when changed (clientHash)
// @match        https://yspos.youngsong.com.tw/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @run-at       document-idle
// @resource     gasConfigPerformanceDetailsTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/Local/gas-PerformanceDetails-config-TEL.json
// ==/UserScript==

(function () {
  "use strict";

  /* =========================
   * 0) Page Gate（分兩種頁面）
   * ========================= */
  const PAGE = detectPage_();
  if (!PAGE) return;

  console.log("[AUTO_PERF] loaded:", PAGE, location.href, "hash=", location.hash);

  function detectPage_() {
    const href = String(location.href || "");

    // A) POS：#/performance?tab=P_DETAIL
    if (href.startsWith("https://yspos.youngsong.com.tw/")) {
      const h = String(location.hash || "");
      if (h.startsWith("#/performance") && h.includes("tab=P_DETAIL")) return "POS_P_DETAIL";
    }

    // B) GitHub 靜態頁
    if (href.startsWith("https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html")) {
      return "GITHUB_PERF_DETAIL";
    }

    return "";
  }

  /* =========================
   * 1) Config（@resource JSON）
   * ========================= */
  const GAS_RESOURCE = "gasConfigPerformanceDetailsTEL";
  const DEFAULT_CFG = { GAS_URL: "" };
  let CFG = { ...DEFAULT_CFG };

  function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

  function loadJsonOverrides() {
    try {
      if (typeof GM_getResourceText !== "function") return {};
      const raw = GM_getResourceText(GAS_RESOURCE);
      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL")) out.GAS_URL = parsed.GAS_URL;
      return out;
    } catch { return {}; }
  }

  function applyConfigOverrides() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverrides() };
  }

  applyConfigOverrides();

  if (!CFG.GAS_URL) {
    console.warn(
      "[AUTO_PERF] ⚠️ CFG.GAS_URL is empty. Will keep scanning DOM, but will NOT send network requests.\n" +
      'Check @resource JSON: {"GAS_URL":"https://script.google.com/macros/s/.../exec"}'
    );
  }

  const SOURCE_NAME = "performance_details_v1";
  const THROTTLE_MS = 650;

  /* =========================
   * Utils
   * ========================= */
  function text(el) { return (el && el.textContent ? el.textContent : "").trim(); }

  function safeNumber(v) {
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function nowIso() { return new Date().toISOString(); }

  function makeHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  // 26-01-11 => 2026-01-11
  function normalizeDateYY_(s) {
    const m = String(s || "").trim().match(/^(\d{2})-(\d{2})-(\d{2})$/);
    if (!m) return String(s || "").trim();
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return String(s || "").trim();
    return `${String(2000 + yy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  /* =========================
   * Extractors (shared)
   * ========================= */

  // POS 有「師傅號碼：<span>10</span>」
  // GitHub 可能沒有，允許空字串（GAS 端可改用 querystring 或頁面上顯示的 techNo）
  function extractTechNo_Generic_() {
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
      const title = text(block.querySelector("p.mb-2")); // 排班/老點/總計
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

  // GitHub 的 summary：先嘗試沿用 POS selector；抓不到就回空 {}
  function extractSummaryCards_GITHUB_() {
    // 你 GitHub 若有同樣 DOM，直接吃到；沒有就 {}（不擋送出）
    return extractSummaryCards_POS_();
  }

  /* =========================
   * Detail rows - POS (AntD)
   * ========================= */
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

      const orderDate = normalizeDateYY_(text(tds[0]));

      out.push({
        訂單日期: orderDate,
        訂單編號: text(tds[1]),
        序: safeNumber(text(tds[2])),
        拉牌: text(tds[3]),
        服務項目: text(tds[4]),
        業績金額: safeNumber(text(tds[5])),
        抽成金額: safeNumber(text(tds[6])),
        數量: safeNumber(text(tds[7])),
        小計: safeNumber(text(tds[8])),
        分鐘: safeNumber(text(tds[9])),
        開工: text(tds[10]),
        完工: text(tds[11]),
        狀態: text(tds[12]),
      });
    }
    return out;
  }

  /* =========================
   * Detail rows - GitHub
   * 1) 優先找 table（最常見）
   * 2) fallback：找 class 含 ant-table（如果你 GitHub 是把 ant-table HTML 直接貼出來）
   * ========================= */
  function extractDetailRows_GITHUB_() {
    // (A) 如果 GitHub 頁面其實也有 ant-table 結構
    const ant = extractDetailRows_POS_();
    if (ant.length) return ant;

    // (B) 通用 table：找「表頭含 訂單日期/訂單編號」的 table
    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const ths = Array.from(table.querySelectorAll("thead th")).map((th) => text(th));
      const hasDate = ths.some((t) => t.includes("訂單") && t.includes("日期")) || ths.includes("訂單日期");
      const hasNo = ths.some((t) => t.includes("訂單") && t.includes("編號")) || ths.includes("訂單編號");
      if (!hasDate || !hasNo) continue;

      const out = [];
      const trs = Array.from(table.querySelectorAll("tbody tr"));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll("td")).map((td) => text(td));
        if (tds.length < 13) continue;

        out.push({
          訂單日期: normalizeDateYY_(tds[0]),
          訂單編號: tds[1],
          序: safeNumber(tds[2]),
          拉牌: tds[3],
          服務項目: tds[4],
          業績金額: safeNumber(tds[5]),
          抽成金額: safeNumber(tds[6]),
          數量: safeNumber(tds[7]),
          小計: safeNumber(tds[8]),
          分鐘: safeNumber(tds[9]),
          開工: tds[10],
          完工: tds[11],
          狀態: tds[12],
        });
      }

      if (out.length) return out;
    }

    return [];
  }

  /* =========================
   * Build payload (shared)
   * - rangeKey：minDate~maxDate（從明細日期算）
   * ========================= */
  function buildPayload_() {
    const techNo = extractTechNo_Generic_();

    const summary = (PAGE === "POS_P_DETAIL")
      ? extractSummaryCards_POS_()
      : extractSummaryCards_GITHUB_();

    const detail = (PAGE === "POS_P_DETAIL")
      ? extractDetailRows_POS_()
      : extractDetailRows_GITHUB_();

    let minDate = "";
    let maxDate = "";
    for (const r of detail) {
      const d = String(r["訂單日期"] || "");
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
    const rangeKey = (minDate && maxDate) ? `${minDate}~${maxDate}` : "";

    const payload = {
      mode: "upsertDetailPerf_v1",
      source: SOURCE_NAME,
      pageType: PAGE,            // ✅ 讓 GAS/除錯好分辨來源
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso(),
      techNo,
      rangeKey,
      summary,
      detail,
    };

    payload.clientHash = makeHash(
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

  /* =========================
   * POST to GAS
   * ========================= */
  function postToGAS_(payload) {
    return new Promise((resolve, reject) => {
      if (!CFG.GAS_URL) {
        return resolve({ status: 0, json: { ok: false, error: "CFG_GAS_URL_EMPTY" } });
      }
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

  /* =========================
   * Auto watch + send only when changed
   * ========================= */
  let lastHash = "";
  let timer = null;

  async function checkAndSend_() {
    try {
      // SPA：POS 可能 hash 切走；GitHub 不用但也不傷
      if (!detectPage_()) return;

      const payload = buildPayload_();

      // Debug：讓你一眼知道抓到了沒
      console.log("[AUTO_PERF] scan:", {
        pageType: payload.pageType,
        techNo: payload.techNo,
        rangeKey: payload.rangeKey,
        detailLen: payload.detail.length,
      });

      // 1) 沒抓到明細 → 不送
      if (!payload.detail.length) return;

      // 2) rangeKey 算不出來 → 不送（key 不穩）
      if (!payload.rangeKey) return;

      // 3) hash 沒變 → 不送
      if (payload.clientHash === lastHash) return;

      lastHash = payload.clientHash;

      const res = await postToGAS_(payload);
      if (res.json && res.json.ok) {
        console.log("[AUTO_PERF] ok:", res.json.result, "key=", res.json.key, "hash=", payload.clientHash);
      } else {
        console.warn("[AUTO_PERF] fail:", res.json || res.text);
      }
    } catch (e) {
      console.warn("[AUTO_PERF] error:", e);
    }
  }

  function schedule_() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      checkAndSend_();
    }, THROTTLE_MS);
  }

  // 初次
  schedule_();

  // React/AntD / 或 GitHub JS 渲染
  const observer = new MutationObserver(schedule_);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // POS hash 變動
  window.addEventListener("hashchange", schedule_);
})();
