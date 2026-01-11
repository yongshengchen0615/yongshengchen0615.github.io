// ==UserScript==
// @name         PerformanceDetails Report Auto Sync -> GAS (P_DETAIL, hash-based)
// @namespace    https://local/
// @version      1.0
// @description  Auto collect techNo + summary cards + P_DETAIL ant-table rows; send only when changed (clientHash)
// @match        https://yspos.youngsong.com.tw/*
// @match        https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @run-at       document-idle
// @resource     gasConfigReportTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/TestEnvironment/Local/gas-report-config-TEL.json
// ==/UserScript==

(function () {
  "use strict";

  /* =========================
   * 0) Page Gate（只在 P_DETAIL 跑）
   * ========================= */
  function isTargetPage_() {
    const h = String(location.hash || "");
    return h.startsWith("#/performance") && h.includes("tab=P_DETAIL");
  }
  if (!isTargetPage_()) return;

  console.log("[AUTO_DETAIL] loaded:", location.href, "hash=", location.hash);

  /* =========================
   * 1) Config（@resource JSON）
   * ========================= */
  const GAS_RESOURCE = "gasConfigReportTEL";
  const DEFAULT_CFG = { GAS_URL: "" };
  let CFG = { ...DEFAULT_CFG };

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }
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
      "[AUTO_DETAIL] ⚠️ CFG.GAS_URL is empty. Will keep scanning DOM, but will NOT send network requests.\n" +
      'Check @resource JSON: {"GAS_URL":"https://script.google.com/macros/s/.../exec"}'
    );
  }

  const SOURCE_NAME = "report_detail_v1";
  const THROTTLE_MS = 650;

  /* =========================
   * Utils
   * ========================= */
  function text(el) {
    return (el && el.textContent ? el.textContent : "").trim();
  }
  function safeNumber(v) {
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function nowIso() { return new Date().toISOString(); }

  // 輕量 hash（非加密）
  function makeHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  // 解析 26-01-11 => 2026-01-11（若格式不符就回傳原字串）
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
   * Extract: techNo（師傅號碼）
   * - 沿用你之前的抓法：找含「師傅號碼」的 p
   * ========================= */
  function extractTechNo() {
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim();
  }

  /* =========================
   * Extract: Summary cards（排班/老點/總計）
   * ========================= */
  function extractSummaryCards() {
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

  /* =========================
   * Extract: P_DETAIL table rows
   * ========================= */
  function extractDetailRows() {
    const tbody = document.querySelector(".ant-table-body tbody.ant-table-tbody");
    if (!tbody) return [];

    const rows = Array.from(tbody.querySelectorAll("tr.ant-table-row")).filter(
      (tr) => !tr.classList.contains("ant-table-measure-row")
    );

    const out = [];
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll("td.ant-table-cell"));
      // 期望 13 欄（不含 scrollbar 虛欄）
      if (tds.length < 13) continue;

      const orderDateRaw = text(tds[0]);
      const orderDate = normalizeDateYY_(orderDateRaw);

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
   * Build payload
   * - rangeKey：minDate~maxDate（從明細日期算）
   * ========================= */
  function buildPayload() {
    const techNo = extractTechNo();
    const summary = extractSummaryCards();
    const detail = extractDetailRows();

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
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso(),
      techNo,
      rangeKey, // 重要：這頁通常跨多天
      summary,
      detail,
    };

    // clientHash：只含內容，不含時間
    payload.clientHash = makeHash(
      JSON.stringify({
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
  function postToGAS(payload) {
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

  async function checkAndSend() {
    try {
      if (!isTargetPage_()) return;

      const payload = buildPayload();

      // 1) 沒抓到明細 → 不送
      if (!payload.detail.length) return;

      // 2) rangeKey 算不出來（通常代表日期欄抓不到）→ 不送（避免 key 不穩）
      if (!payload.rangeKey) return;

      // 3) 同頁面 hash 沒變 → 不送
      if (payload.clientHash === lastHash) return;

      lastHash = payload.clientHash;

      const res = await postToGAS(payload);
      if (res.json && res.json.ok) {
        console.log("[AUTO_DETAIL] ok:", res.json.result, "key=", res.json.key, "hash=", payload.clientHash);
      } else {
        console.warn("[AUTO_DETAIL] fail:", res.json || res.text);
      }
    } catch (e) {
      console.warn("[AUTO_DETAIL] error:", e);
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      checkAndSend();
    }, THROTTLE_MS);
  }

  schedule();

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.addEventListener("hashchange", schedule);
})();
