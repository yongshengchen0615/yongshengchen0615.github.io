// ==UserScript==
// @name         Report Auto Sync -> GAS（自動同步報表到 GAS）
// @namespace    https://local/
// @version      1.7
// @description  自動擷取師傅號碼、摘要卡片、明細表，資料有變才送；僅在 GAS 回 ok:true 後才視為成功提交
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
   *    目的：@match 放寬成整個 domain，
   *    但只在指定頁面才真正啟動腳本
   * ===================================================== */
  function isTargetPage_() {
    // 目標頁面：#/performance?tab=P_STATIC
    const h = String(location.hash || "");
    return h.startsWith("#/performance") && h.includes("tab=P_STATIC");
  }

  // 若不是目標頁，直接結束（不監聽、不掃 DOM、不送 request）
  if (!isTargetPage_()) return;

  console.log("[AUTO_REPORT] loaded:", location.href, "hash=", location.hash);

  /* =====================================================
   * 1) Config（從 @resource JSON 讀取 GAS_URL）
   * ===================================================== */
  const GAS_RESOURCE = "gasConfigReportTEL";

  // 預設設定（若 resource 讀不到，至少不會噴錯）
  const DEFAULT_CFG = {
    GAS_URL: "",
  };

  let CFG = { ...DEFAULT_CFG };

  // 安全 JSON.parse（避免格式錯誤整支炸掉）
  function safeJsonParse_(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  // 從 @resource 讀取設定檔
  function loadJsonOverrides_() {
    try {
      if (typeof GM_getResourceText !== "function") return {};
      const raw = GM_getResourceText(GAS_RESOURCE);
      const parsed = safeJsonParse_(raw);
      if (!parsed || typeof parsed !== "object") return {};

      const out = {};
      if (Object.prototype.hasOwnProperty.call(parsed, "GAS_URL")) {
        out.GAS_URL = parsed.GAS_URL;
      }
      return out;
    } catch {
      return {};
    }
  }

  // 套用設定
  function applyConfigOverrides_() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverrides_() };
  }

  applyConfigOverrides_();

  // 若沒設定 GAS_URL，只警告、不送資料
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
  const SOURCE_NAME = "report_page_v1"; // 資料來源標記
  const THROTTLE_MS = 600;              // 節流時間（避免 React DOM 爆量觸發）

  /* =====================================================
   * 3) 工具函式
   * ===================================================== */

  // 取文字並 trim
  function text_(el) {
    return (el && el.textContent ? el.textContent : "").trim();
  }

  // 將數字字串轉為 number（自動去除逗號）
  function safeNumber_(v) {
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  // 取得 ISO 時間字串（UTC）
  function nowIso_() {
    return new Date().toISOString();
  }

  // 輕量 hash（FNV-1a 32bit）
  // 用來判斷「資料內容是否有變」
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
    // 範例 DOM：
    // <p class="text-C599F48">師傅號碼：<span>10</span></p>
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
      const title = text_(block.querySelector("p.mb-2")); // 卡片標題
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

    // dateKey 留空，交由 GAS 以「台北今天」補齊
    const dateKey = "";

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

    // clientHash 只根據「內容」產生，不能包含時間
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
   * 9) 核心邏輯：自動偵測 + 只在成功後 commit hash
   * ===================================================== */
  let lastHash = "";     // 已成功寫入 GAS 的 hash
  let pendingHash = ""; // 正在嘗試送出的 hash
  let inFlight = false; // 是否有請求進行中

  async function checkAndSend_() {
    try {
      if (!isTargetPage_()) return;
      if (inFlight) return;

      const payload = buildPayload_();

      // 沒抓到明細 → 不送
      if (!payload.detail.length) return;

      // 沒抓到師傅號碼 → 不送
      if (!String(payload.techNo || "").trim()) return;

      // 內容沒變 → 不送
      if (payload.clientHash === lastHash) return;

      // 同一份內容正在送 → 不重送
      if (payload.clientHash === pendingHash) return;

      inFlight = true;
      pendingHash = payload.clientHash;

      const res = await postToGAS_(payload);
      const ok = res && res.json && res.json.ok === true;

      if (ok) {
        // ✅ 只有成功才視為已同步
        lastHash = payload.clientHash;
        pendingHash = "";
        console.log("[AUTO_REPORT] ok:", res.json.result, "key=", res.json.key, "hash=", lastHash);
      } else {
        // ❗失敗不 commit，讓下次還能重送
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

  // 節流排程（避免短時間內大量觸發）
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

  // 頁面載入後先跑一次
  debounceSchedule_();

  // 監聽 DOM 變化（React / AntD 會頻繁改 DOM）
  const observer = new MutationObserver(debounceSchedule_);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // SPA hash 切換時補觸發
  window.addEventListener("hashchange", debounceSchedule_);

  // 低頻保險輪詢（避免某些更新沒觸發 mutation）
  setInterval(() => {
    if (!isTargetPage_()) return;
    debounceSchedule_();
  }, 4000);
})();
