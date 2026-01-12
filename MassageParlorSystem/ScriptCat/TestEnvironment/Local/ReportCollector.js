// ==UserScript==
// @name         Report Auto Sync -> GAS (no-leak, SPA-safe, multi-tech safe)
// @namespace    https://local/
// @version      4.1
// @description  P_STATIC: SPA-safe start/stop; edge-trigger send when ready; commit hash only after ok:true; pagehide/visibility flush; sessionStorage pending per techNo (multi-tech safe).
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

  /* =========================
   * 0) Page Gate (SPA-safe)
   * ========================= */
  function isTargetPage_() {
    const h = String(location.hash || "");
    return h.startsWith("#/performance") && h.includes("tab=P_STATIC");
  }

  /* =========================
   * 1) Config
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
    } catch {
      return {};
    }
  }

  function applyConfigOverrides() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverrides() };
  }

  applyConfigOverrides();

  if (!CFG.GAS_URL) {
    console.warn(
      "[AUTO_REPORT] ⚠️ CFG.GAS_URL is empty. Will scan, but will NOT send.\n" +
      'Check @resource JSON: {"GAS_URL":"https://script.google.com/macros/s/.../exec"}'
    );
  }

  /* =========================
   * 2) Constants / State
   * ========================= */
  const SOURCE_NAME = "report_page_v2_1";
  const EDGE_DEBOUNCE_MS = 120;
  const SCAN_INTERVAL_MS = 1500;

  // pending base (per-techNo)
  const PENDING_BASE = "AUTO_REPORT_PENDING_V1";
  const TECH_MARK_KEY = "AUTO_REPORT_ACTIVE_TECH_V1"; // 記住上次啟用的 techNo（同分頁）

  let started = false;
  let observer = null;
  let debounceTimer = null;
  let intervalTimer = null;

  // multi-tech safe
  let activeTechNo = "";      // 目前偵測到的 techNo
  let committedHash = "";     // 只對 activeTechNo 有效
  let sending = false;
  let queued = false;

  // 去重 log
  let lastSkipReason = "";

  /* =========================
   * 3) Utils
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

  function logSkip_(reason, extra) {
    const msg = String(reason || "");
    if (!msg) return;
    if (msg === lastSkipReason) return;
    lastSkipReason = msg;
    console.log("[AUTO_REPORT] skip:", msg, extra || "");
  }

  function resetSkip_() { lastSkipReason = ""; }

  /* =========================
   * 4) Extractors
   * ========================= */
  function extractTechNo() {
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim();
  }

  function extractSummaryCards() {
    const flex = document.querySelector("div.flex.mb-4");
    if (!flex) return {};
    const blocks = Array.from(flex.children).filter((d) => d && d.querySelector);
    const out = {};
    for (const block of blocks) {
      const title = text(block.querySelector("p.mb-2"));
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

  function extractAntTableRows() {
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
        服務項目: text(tds[0]),
        總筆數: safeNumber(text(tds[1])),
        總節數: safeNumber(text(tds[2])),
        總計金額: safeNumber(text(tds[3])),
        老點筆數: safeNumber(text(tds[4])),
        老點節數: safeNumber(text(tds[5])),
        老點金額: safeNumber(text(tds[6])),
        排班筆數: safeNumber(text(tds[7])),
        排班節數: safeNumber(text(tds[8])),
        排班金額: safeNumber(text(tds[9])),
      });
    }
    return data;
  }

  /* =========================
   * 5) Build payload
   * ========================= */
  function buildPayload() {
    const techNo = extractTechNo();
    const summary = extractSummaryCards();
    const detail = extractAntTableRows();
    const dateKey = ""; // 留空：GAS 用台北今日補

    const payload = {
      mode: "upsertReport_v1",
      source: SOURCE_NAME,
      pageUrl: location.href,
      pageTitle: document.title,
      clientTsIso: nowIso(),
      techNo,
      dateKey,
      summary,
      detail,
    };

    payload.clientHash = makeHash(
      JSON.stringify({
        techNo: payload.techNo,
        dateKey: payload.dateKey,
        summary: payload.summary,
        detail: payload.detail,
      })
    );

    return payload;
  }

  /* =========================
   * 6) Network
   * ========================= */
  function postToGAS(payload) {
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

  /* =========================
   * 7) Pending per-techNo (sessionStorage)
   * ========================= */
  function normalizeTech_(t) { return String(t || "").trim(); }

  function pendingKeyForTech_(techNo) {
    const t = normalizeTech_(techNo);
    if (!t) return ""; // 沒 techNo 不存 pending（避免跨師傅風險）
    return `${PENDING_BASE}_${t}`;
  }

  function savePending_(payload) {
    try {
      const key = pendingKeyForTech_(payload.techNo);
      if (!key) return;
      const pack = { techNo: normalizeTech_(payload.techNo), hash: payload.clientHash, payload, ts: Date.now() };
      sessionStorage.setItem(key, JSON.stringify(pack));
    } catch {}
  }

  function clearPendingByTech_(techNo) {
    try {
      const key = pendingKeyForTech_(techNo);
      if (!key) return;
      sessionStorage.removeItem(key);
    } catch {}
  }

  function loadPendingByTech_(techNo) {
    try {
      const key = pendingKeyForTech_(techNo);
      if (!key) return null;
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.payload || !obj.hash || !obj.techNo) return null;
      if (normalizeTech_(obj.techNo) !== normalizeTech_(techNo)) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function getLastActiveTech_() {
    try { return normalizeTech_(sessionStorage.getItem(TECH_MARK_KEY)); } catch { return ""; }
  }
  function setLastActiveTech_(techNo) {
    try { sessionStorage.setItem(TECH_MARK_KEY, normalizeTech_(techNo)); } catch {}
  }

  /* =========================
   * 8) Multi-tech switch guard
   * - techNo 變更：重置 committedHash、取消 queued、避免跨師傅補送
   * ========================= */
  function ensureActiveTech_(techNo) {
    const t = normalizeTech_(techNo);
    if (!t) return false;

    if (t !== activeTechNo) {
      const prev = activeTechNo;
      activeTechNo = t;

      // 換師傅：重置狀態（避免上一位的 committedHash 影響下一位）
      committedHash = "";
      queued = false;

      // 記錄目前 active tech
      setLastActiveTech_(activeTechNo);

      console.log("[AUTO_REPORT] tech switch:", { from: prev || "(none)", to: activeTechNo });

      // 只補送「當前師傅」的 pending
      flushPendingForTech_(activeTechNo);
    }
    return true;
  }

  /* =========================
   * 9) Send core (commit-on-success)
   * ========================= */
  function isReady_(payload) {
    if (!payload) return false;

    if (!isTargetPage_()) {
      logSkip_("NOT_TARGET_PAGE", { hash: location.hash });
      return false;
    }

    if (!String(payload.techNo || "").trim()) {
      logSkip_("MISSING_TECHNO");
      return false;
    }

    if (!payload.detail || !payload.detail.length) {
      logSkip_("EMPTY_DETAIL");
      return false;
    }

    return true;
  }

  async function flushPendingForTech_(techNo) {
    const t = normalizeTech_(techNo);
    if (!t) return;
    if (!isTargetPage_()) return;
    if (sending) return;

    const pending = loadPendingByTech_(t);
    if (!pending) return;

    // 同 techNo：若已 commit 同 hash，就清掉
    if (pending.hash && pending.hash === committedHash) {
      clearPendingByTech_(t);
      return;
    }

    try {
      sending = true;
      const res = await postToGAS(pending.payload);
      if (res.json && res.json.ok) {
        committedHash = pending.hash; // ✅ 成功才 commit
        clearPendingByTech_(t);
        console.log("[AUTO_REPORT] pending ok:", res.json.result, "key=", res.json.key, "hash=", committedHash, "techNo=", t);
      } else {
        console.warn("[AUTO_REPORT] pending fail:", res.json || res.text, "techNo=", t);
      }
    } catch (e) {
      console.warn("[AUTO_REPORT] pending error:", e, "techNo=", t);
    } finally {
      sending = false;
    }
  }

  async function checkAndSendNow_(reason) {
    if (!started) return;
    resetSkip_();

    if (sending) { queued = true; return; }

    const payload = buildPayload();

    // techNo 還沒出現：不要做任何 pending（避免跨師傅）
    if (!ensureActiveTech_(payload.techNo)) {
      logSkip_("TECH_NOT_READY");
      return;
    }

    // 只要有明細就存 pending（以 techNo 分桶）
    if (payload.detail && payload.detail.length) {
      savePending_(payload);
    }

    if (!isReady_(payload)) return;

    if (payload.clientHash === committedHash) {
      logSkip_("NO_CHANGE_COMMITTED_HASH", { hash: payload.clientHash, techNo: activeTechNo });
      return;
    }

    try {
      sending = true;

      const res = await postToGAS(payload);

      if (res.json && res.json.ok) {
        committedHash = payload.clientHash; // ✅ success 才 commit
        clearPendingByTech_(activeTechNo);
        console.log("[AUTO_REPORT] ok:", res.json.result, "key=", res.json.key, "hash=", committedHash, "techNo=", activeTechNo, "reason=", reason || "");
      } else {
        console.warn("[AUTO_REPORT] fail:", res.json || res.text, "techNo=", activeTechNo, "reason=", reason || "");
      }
    } catch (e) {
      console.warn("[AUTO_REPORT] error:", e, "techNo=", activeTechNo, "reason=", reason || "");
    } finally {
      sending = false;

      if (queued) {
        queued = false;
        setTimeout(() => checkAndSendNow_("queued"), 0);
      }
    }
  }

  /* =========================
   * 10) Scheduler (edge-trigger)
   * ========================= */
  function scheduleEdge_(reason) {
    if (!started) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      checkAndSendNow_(reason || "mutation");
    }, EDGE_DEBOUNCE_MS);
  }

  /* =========================
   * 11) Start/Stop for SPA
   * ========================= */
  function start_() {
    if (started) return;
    started = true;

    console.log("[AUTO_REPORT] started:", location.href, "hash=", location.hash);

    // 若上一輪（同分頁）有記錄 active tech，先嘗試補送（但仍會在 ensureActiveTech 後再補一次）
    const lastTech = getLastActiveTech_();
    if (lastTech) flushPendingForTech_(lastTech);

    scheduleEdge_("start");

    observer = new MutationObserver(() => scheduleEdge_("mutation"));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    intervalTimer = setInterval(() => scheduleEdge_("interval"), SCAN_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibilityChange_, true);
    window.addEventListener("pagehide", onPageHide_, true);
    window.addEventListener("beforeunload", onBeforeUnload_, true);
  }

  function stop_() {
    if (!started) return;

    // stop 前 best-effort flush
    checkAndSendNow_("stop");

    started = false;

    if (observer) { try { observer.disconnect(); } catch {} observer = null; }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;

    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;

    document.removeEventListener("visibilitychange", onVisibilityChange_, true);
    window.removeEventListener("pagehide", onPageHide_, true);
    window.removeEventListener("beforeunload", onBeforeUnload_, true);

    console.log("[AUTO_REPORT] stopped:", location.href, "hash=", location.hash);
  }

  function refreshActive_() {
    if (isTargetPage_()) start_();
    else stop_();
  }

  /* =========================
   * 12) Leave/Hide handlers
   * ========================= */
  function onVisibilityChange_() {
    if (!started) return;
    if (document.hidden) checkAndSendNow_("visibility_hidden");
  }

  function onPageHide_() {
    if (!started) return;
    checkAndSendNow_("pagehide");
  }

  function onBeforeUnload_() {
    if (!started) return;
    checkAndSendNow_("beforeunload");
  }

  /* =========================
   * 13) Bootstrap
   * ========================= */
  window.addEventListener("hashchange", refreshActive_, true);
  refreshActive_();
})();
