// ==UserScript==
// @name         FED PerformanceDetails Auto Sync -> GAS (no-leak, SPA-safe, multi-tech safe, stable-ready, keepalive)
// @namespace    https://local/
// @version      4.4
// @description  P_DETAIL: stable-ready gate; allowlist GAS_URL; pending per tech; commit after ok:true; pagehide keepalive/beacon best-effort; POS+GitHub.
// @match        https://yspos.youngsong.com.tw/*
// @match        https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @resource     gasConfigPerformanceDetailsTEL https://yongshengchen0615.github.io/MassageParlorSystem/ScriptCat/FormalEnvironmentDeployment/gas-PerformanceDetails-config-FED.json
// ==/UserScript==

(function () {
  "use strict";

  /* =========================
   * 0) Detect page
   * ========================= */
  function detectPage_() {
    const href = String(location.href || "");

    if (href.startsWith("https://yspos.youngsong.com.tw/")) {
      const h = String(location.hash || "");
      if (h.startsWith("#/performance") && h.includes("tab=P_DETAIL")) return "POS_P_DETAIL";
      return "";
    }

    if (href.startsWith("https://yongshengchen0615.github.io/Performancedetails/Performancedetails.html")) {
      return "GITHUB_PERF_DETAIL";
    }

    return "";
  }

  function isActiveTarget_() { return !!detectPage_(); }

  /* =========================
   * 1) Config
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
    } catch {
      return {};
    }
  }

  function isAllowedGASUrl_(u) {
    try {
      const url = new URL(String(u || ""));
      if (url.protocol !== "https:") return false;
      const host = url.hostname.toLowerCase();
      return host === "script.google.com" || host === "script.googleusercontent.com";
    } catch {
      return false;
    }
  }

  function applyConfigOverrides() {
    CFG = { ...DEFAULT_CFG, ...loadJsonOverrides() };
    if (CFG.GAS_URL && !isAllowedGASUrl_(CFG.GAS_URL)) {
      console.warn("[AUTO_PERF] ⚠️ GAS_URL is not allowlisted. Blocked:", CFG.GAS_URL);
      CFG.GAS_URL = "";
    }
  }

  applyConfigOverrides();

  if (!CFG.GAS_URL) {
    console.warn(
      "[AUTO_PERF] ⚠️ CFG.GAS_URL is empty/blocked. Will scan, but will NOT send.\n" +
      'Check @resource JSON: {"GAS_URL":"https://script.google.com/macros/s/.../exec"}'
    );
  }

  /* =========================
   * 2) Constants / State
   * ========================= */
  const SOURCE_NAME = "performance_details_v2_2";
  const EDGE_DEBOUNCE_MS = 80;
  const SCAN_INTERVAL_MS = 1800;
  const STABLE_GAP_MS = 250;
  const MAX_KEEPALIVE_BYTES = 60000;

  const PENDING_BASE = "AUTO_PERF_PENDING_V2";
  const TECH_MARK_KEY = "AUTO_PERF_ACTIVE_TECH_V2";

  let started = false;
  let observer = null;
  let debounceTimer = null;
  let intervalTimer = null;

  let activeTechNo = "";
  let committedHash = "";
  let sending = false;
  let queued = false;

  let lastSkipReason = "";

  // stable-ready state
  let stableTimer = null;
  let lastProbeSig = "";
  let stableCount = 0;

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
    console.log("[AUTO_PERF] skip:", msg, extra || "");
  }
  function resetSkip_() { lastSkipReason = ""; }

  function normalizeTech_(t) { return String(t || "").trim(); }

  function hasAntLoading_() {
    return !!document.querySelector(".ant-spin.ant-spin-spinning, .ant-spin-spinning");
  }

  // Normalize date formats to YYYY-MM-DD
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

  function normalizeRangeKey_(rk) {
    const s = String(rk ?? "").trim();
    if (!s) return "";
    const parts = s.split("~").map((x) => String(x || "").trim());
    if (parts.length !== 2) return s.replaceAll("/", "-");

    const normDate = (d) => {
      const t = String(d ?? "").trim();
      const m = t.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
      if (!m) return t.replaceAll("/", "-");
      const mm = String(m[2]).padStart(2, "0");
      const dd = String(m[3]).padStart(2, "0");
      return `${m[1]}-${mm}-${dd}`;
    };

    return `${normDate(parts[0])}~${normDate(parts[1])}`;
  }

  /* =========================
   * 4) Extractors
   * ========================= */
  function extractTechNo_() {
    const ps = Array.from(document.querySelectorAll("p"));
    const p = ps.find((el) => (el.textContent || "").includes("師傅號碼"));
    if (!p) return "";
    const span = p.querySelector("span");
    return (span ? span.textContent : "").trim();
  }

  function extractSummaryCards_() {
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
        訂單日期: normalizeDate_(text(tds[0])),
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

  function extractDetailRows_GITHUB_() {
    const ant = extractDetailRows_POS_();
    if (ant.length) return ant;

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
          訂單日期: normalizeDate_(tds[0]),
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
   * 5) Build payload
   * ========================= */
  function buildPayload_() {
    const pageType = detectPage_();
    const techNo = extractTechNo_();
    const summary = extractSummaryCards_();
    const detail = pageType === "POS_P_DETAIL" ? extractDetailRows_POS_() : extractDetailRows_GITHUB_();

    let minDate = "";
    let maxDate = "";
    for (const r of detail) {
      const d = String(r["訂單日期"] || "");
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }

    const rawRangeKey = minDate && maxDate ? `${minDate}~${maxDate}` : "";
    const rangeKey = normalizeRangeKey_(rawRangeKey);

    const payload = {
      mode: "upsertDetailPerf_v1",
      source: SOURCE_NAME,
      pageType,
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
        techNo: normalizeTech_(payload.techNo),
        rangeKey: String(payload.rangeKey || "").trim(),
        summary: payload.summary,
        detail: payload.detail,
      })
    );

    return payload;
  }

  /* =========================
   * 6) Network
   * ========================= */
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

  function fireAndForget_(payload) {
    try {
      if (!CFG.GAS_URL) return false;
      const body = JSON.stringify(payload);
      if (body.length > MAX_KEEPALIVE_BYTES) return false;

      if (typeof fetch === "function") {
        fetch(CFG.GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          credentials: "omit",
        }).catch(() => {});
        return true;
      }

      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(CFG.GAS_URL, blob);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /* =========================
   * 7) Pending per-techNo
   * ========================= */
  function pendingKeyForTech_(techNo) {
    const t = normalizeTech_(techNo);
    if (!t) return "";
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
   * ========================= */
  function ensureActiveTech_(techNo) {
    const t = normalizeTech_(techNo);
    if (!t) return false;

    if (t !== activeTechNo) {
      const prev = activeTechNo;
      activeTechNo = t;

      committedHash = "";
      queued = false;

      setLastActiveTech_(activeTechNo);

      lastProbeSig = "";
      stableCount = 0;

      console.log("[AUTO_PERF] tech switch:", { from: prev || "(none)", to: activeTechNo });

      flushPendingForTech_(activeTechNo);
    }
    return true;
  }

  /* =========================
   * 9) Stable-ready gate
   * ========================= */
  function probeSignature_() {
    if (!isActiveTarget_()) return "";
    const pageType = detectPage_();
    const techNo = normalizeTech_(extractTechNo_());

    let rowCount = 0;
    if (pageType === "POS_P_DETAIL") {
      const tbody = document.querySelector(".ant-table-body tbody.ant-table-tbody");
      rowCount = tbody ? tbody.querySelectorAll("tr.ant-table-row:not(.ant-table-measure-row)").length : 0;
    } else {
      // GitHub：抓第一個符合欄位的 table 的 tbody rowCount（粗略即可）
      const tBodies = Array.from(document.querySelectorAll("table tbody"));
      rowCount = tBodies.length ? tBodies[0].querySelectorAll("tr").length : 0;
    }

    const loading = hasAntLoading_() ? "L1" : "L0";
    return `${pageType}|${techNo}|R${rowCount}|${loading}`;
  }

  function scheduleStableCheck_(reason) {
    if (!started) return;
    if (stableTimer) clearTimeout(stableTimer);

    stableTimer = setTimeout(() => {
      stableTimer = null;

      const sig = probeSignature_();
      if (!sig) return;

      if (sig === lastProbeSig) stableCount++;
      else stableCount = 0;

      lastProbeSig = sig;

      if (stableCount >= 1) {
        checkAndSendNow_(reason || "stable_ready");
      }
    }, STABLE_GAP_MS);
  }

  /* =========================
   * 10) Send core
   * ========================= */
  function isReady_(payload) {
    if (!payload) return false;

    if (!payload.pageType) {
      logSkip_("NOT_TARGET_PAGE", { href: location.href, hash: location.hash });
      return false;
    }

    if (!normalizeTech_(payload.techNo)) {
      logSkip_("MISSING_TECHNO", { pageType: payload.pageType });
      return false;
    }

    if (hasAntLoading_()) {
      logSkip_("ANT_LOADING", { pageType: payload.pageType });
      return false;
    }

    if (!payload.detail || !payload.detail.length) {
      logSkip_("EMPTY_DETAIL", { pageType: payload.pageType });
      return false;
    }

    if (!payload.rangeKey || !/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(payload.rangeKey)) {
      const sampleDates = payload.detail.slice(0, 3).map((r) => String(r["訂單日期"] || ""));
      logSkip_("MISSING_OR_BAD_RANGEKEY", { rangeKey: payload.rangeKey, sampleDates });
      return false;
    }

    return true;
  }

  async function flushPendingForTech_(techNo) {
    const t = normalizeTech_(techNo);
    if (!t) return;
    if (!isActiveTarget_()) return;
    if (sending) return;

    const pending = loadPendingByTech_(t);
    if (!pending) return;

    if (pending.hash && pending.hash === committedHash) {
      clearPendingByTech_(t);
      return;
    }

    try {
      sending = true;
      const res = await postToGAS_(pending.payload);
      if (res.json && res.json.ok) {
        committedHash = pending.hash;
        clearPendingByTech_(t);
        console.log("[AUTO_PERF] pending ok:", res.json.result, "key=", res.json.key, "hash=", committedHash, "techNo=", t);
      } else {
        console.warn("[AUTO_PERF] pending fail:", res.json || res.text, "techNo=", t);
      }
    } catch (e) {
      console.warn("[AUTO_PERF] pending error:", e, "techNo=", t);
    } finally {
      sending = false;
    }
  }

  async function checkAndSendNow_(reason) {
    if (!started) return;
    resetSkip_();

    if (sending) { queued = true; return; }

    const payload = buildPayload_();

    if (!ensureActiveTech_(payload.techNo)) {
      logSkip_("TECH_NOT_READY", { pageType: payload.pageType });
      return;
    }

    // ✅ 只有 ready 才落地 pending
    if (!isReady_(payload)) return;

    savePending_(payload);

    if (payload.clientHash === committedHash) {
      logSkip_("NO_CHANGE_COMMITTED_HASH", { hash: payload.clientHash, techNo: activeTechNo });
      return;
    }

    try {
      sending = true;

      const res = await postToGAS_(payload);

      if (res.json && res.json.ok) {
        committedHash = payload.clientHash;
        clearPendingByTech_(activeTechNo);
        console.log("[AUTO_PERF] ok:", res.json.result, "key=", res.json.key, "hash=", committedHash, "techNo=", activeTechNo, "reason=", reason || "");
      } else {
        console.warn("[AUTO_PERF] fail:", res.json || res.text, "techNo=", activeTechNo, "reason=", reason || "");
      }
    } catch (e) {
      console.warn("[AUTO_PERF] error:", e, "techNo=", activeTechNo, "reason=", reason || "");
    } finally {
      sending = false;

      if (queued) {
        queued = false;
        setTimeout(() => checkAndSendNow_("queued"), 0);
      }
    }
  }

  /* =========================
   * 11) Scheduler
   * ========================= */
  function scheduleEdge_(reason) {
    if (!started) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      scheduleStableCheck_(reason || "mutation");
    }, EDGE_DEBOUNCE_MS);
  }

  /* =========================
   * 12) Start/Stop
   * ========================= */
  function start_() {
    if (started) return;
    started = true;

    console.log("[AUTO_PERF] started:", detectPage_(), location.href, "hash=", location.hash);

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

    bestEffortFlushOnLeave_("stop");

    started = false;

    if (observer) { try { observer.disconnect(); } catch {} observer = null; }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;

    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;

    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;

    document.removeEventListener("visibilitychange", onVisibilityChange_, true);
    window.removeEventListener("pagehide", onPageHide_, true);
    window.removeEventListener("beforeunload", onBeforeUnload_, true);

    console.log("[AUTO_PERF] stopped:", location.href, "hash=", location.hash);
  }

  function refreshActive_() {
    if (isActiveTarget_()) start_();
    else stop_();
  }

  /* =========================
   * 13) Leave/Hide handlers (background send)
   * ========================= */
  function bestEffortFlushOnLeave_(why) {
    try {
      if (!isActiveTarget_()) return;

      const payload = buildPayload_();
      if (!ensureActiveTech_(payload.techNo)) return;

      if (!isReady_(payload)) return;

      savePending_(payload);
      fireAndForget_(payload);
      console.log("[AUTO_PERF] leave-fire:", why, "pageType=", payload.pageType, "techNo=", normalizeTech_(payload.techNo), "hash=", payload.clientHash);
    } catch {}
  }

  function onVisibilityChange_() {
    if (!started) return;
    if (document.hidden) bestEffortFlushOnLeave_("visibility_hidden");
  }

  function onPageHide_() {
    if (!started) return;
    bestEffortFlushOnLeave_("pagehide");
  }

  function onBeforeUnload_() {
    if (!started) return;
    bestEffortFlushOnLeave_("beforeunload");
  }

  /* =========================
   * 14) Bootstrap
   * ========================= */
  window.addEventListener("hashchange", refreshActive_, true);
  refreshActive_();
})();
