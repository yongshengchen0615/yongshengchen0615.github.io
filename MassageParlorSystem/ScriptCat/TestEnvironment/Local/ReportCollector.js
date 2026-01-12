// ==UserScript==
// @name         Report Auto Sync -> GAS（自動同步報表到 GAS）
// @namespace    https://local/
// @version      1.9
// @description  只要擷取到資料就送出（同次開頁只送一次）；僅在 GAS 回 ok:true 後才視為成功提交
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

  /* =====================================================
   * 0) Page Gate（頁面閘門）
   * ===================================================== */
  function isTargetPage_() {
    const h = String(location.hash || "");
    return h.startsWith("#/performance") && h.includes("tab=P_STATIC");
  }
  if (!isTargetPage_()) return;

  console.log("[AUTO_REPORT] loaded:", location.href, "hash=", location.hash);

  /* =====================================================
   * 1) Config（從 @resource JSON 讀取 GAS_URL）
   * ===================================================== */
  const GAS_RESOURCE = "gasConfigReportTEL";
  const DEFAULT_CFG = { GAS_URL: "" };
  let CFG = { ...DEFAULT_CFG };

  function safeJsonParse_(s) {
    try { return JSON.parse(s); } catch { return null; }
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
      "[AUTO_REPORT] ⚠️ CFG.GAS_URL is empty.\n" +
        "腳本會持續監聽 DOM，但不會送出任何請求。\n" +
        '請確認 @resource JSON 內容為：{"GAS_URL":"https://script.google.com/macros/s/.../exec"}'
    );
  }

  /* =====================================================
   * 2) 執行期常數
   * ===================================================== */
  const SOURCE_NAME = "report_page_v1";
  const THROTTLE_MS = 600;

  /* =====================================================
   * 3) 工具函式
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

  // 輕量 hash（保留：用於「避免同一份 payload 被重複送出」）
  function makeHash_(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /* =====================================================
   * 4) 擷取師傅號碼 techNo
   * ===================================================== */
  function extractTechNo_() {
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim();
  }

  /* =====================================================
   * 5) 擷取摘要卡片（排班 / 老點 / 總計）
   * ===================================================== */
  function extractSummaryCards_() {
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

  /* =====================================================
   * 6) 擷取 Ant Design 表格明細
   * ===================================================== */
  function extractAntTableRows_() {
    const tbody = document.querySelector(".ant-table-body tbody.ant-table-tbody");
    if (!tbody) return [];

    const rows = Array.from(tbody.querySelectorAll("tr.ant-table-row")).filter(
      (tr) => !tr.classList.contains("ant-table-measure-row")
    );

    const data = [];
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll("td.ant-table-cell"));
      if (tds.length < 10) continue;

      data.push({
        服務項目: text_(tds[0]),
        總筆數: safeNumber_(text_(tds[1])),
        總節數: safeNumber_(text_(tds[2])),
        總計金額: safeNumber_(text_(tds[3])),
        老點筆數: safeNumber_(text_(tds[4])),
        老點節數: safeNumber_(text_(tds[5])),
        老點金額: safeNumber_(text_(tds[6])),
        排班筆數: safeNumber_(text_(tds[7])),
        排班節數: safeNumber_(text_(tds[8])),
        排班金額: safeNumber_(text_(tds[9])),
      });
    }
    return data;
  }

  /* =====================================================
   * 7) 組合送往 GAS 的 payload
   * ===================================================== */
  function buildPayload_() {
    const techNo = extractTechNo_();
    const summary = extractSummaryCards_();
    const detail = extractAntTableRows_();

    const dateKey = ""; // 交由 GAS 以「台北今天」補齊

    const payload = {
      mode: "upsertReport_v1",
      source: SOURCE_NAME,
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso_(),
      techNo,
      dateKey,
      summary,
      detail,
    };

    // 用於「避免同一個畫面在 Mutation 轟炸下重送」
    // 注意：不把時間放進去，才不會每次都變
    payload.clientHash = makeHash_(
      JSON.stringify({
        techNo: payload.techNo,
        dateKey: payload.dateKey,
        summary: payload.summary,
        detail: payload.detail,
      })
    );

    return payload;
  }

  /* =====================================================
   * 8) POST 到 GAS
   * ===================================================== */
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

  /* =====================================================
   * 9) 核心邏輯：只要讀取到資料就送（同次進入只送一次）
   * ===================================================== */
  let inFlight = false;
  let pendingHash = "";

  // ✅ 成功送過一次就不再送（避免你「看一下就關」時被 MutationObserver 洗爆）
  let sentOnce = false;

  // 若 hashchange 重新進入目標頁，可再送一次
  function resetSendState_() {
    inFlight = false;
    pendingHash = "";
    sentOnce = false;
  }

  async function checkAndSend_() {
    try {
      if (!isTargetPage_()) return;
      if (inFlight) return;
      if (sentOnce) return; // ✅ 同次開頁/同次進入：成功後就不送了

      const payload = buildPayload_();

      // 沒抓到明細 → 不送（等資料載入完成）
      if (!payload.detail.length) return;

      // 沒抓到師傅號碼 → 不送
      if (!String(payload.techNo || "").trim()) return;

      // 同一份內容正在送 → 不重送
      if (payload.clientHash === pendingHash) return;

      inFlight = true;
      pendingHash = payload.clientHash;

      const res = await postToGAS_(payload);
      const ok = res && res.json && res.json.ok === true;

      if (ok) {
        sentOnce = true; // ✅ 只要成功一次，這次就結束
        console.log(
          "[AUTO_REPORT] ok:",
          res.json.result,
          "key=",
          res.json.key,
          "hash=",
          payload.clientHash
        );
      } else {
        // 失敗不鎖死，讓下一次 mutation / interval 還能再送
        console.warn("[AUTO_REPORT] fail:", res);
        pendingHash = "";
      }
    } catch (e) {
      console.warn("[AUTO_REPORT] error:", e);
      pendingHash = "";
    } finally {
      inFlight = false;
    }
  }

  function debounceSchedule_() {
    if (debounceSchedule_._t) clearTimeout(debounceSchedule_._t);
    debounceSchedule_._t = setTimeout(() => {
      debounceSchedule_._t = null;
      checkAndSend_();
    }, THROTTLE_MS);
  }

  /* =====================================================
   * 10) 啟動監聽
   * ===================================================== */
  debounceSchedule_();

  const observer = new MutationObserver(debounceSchedule_);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.addEventListener("hashchange", () => {
    // hash 切換：如果又進入目標 tab，允許再送一次
    if (isTargetPage_()) resetSendState_();
    debounceSchedule_();
  });

  // 保險輪詢：若 DOM 更新沒觸發 mutation
  setInterval(() => {
    if (!isTargetPage_()) return;
    debounceSchedule_();
  }, 1200);
})();
