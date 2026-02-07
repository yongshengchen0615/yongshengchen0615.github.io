/**
 * table.js
 *
 * 身體/腳底面板：
 * - 篩選列（師傅搜尋、狀態篩選）
 * - 增量渲染（reuse tr）
 * - diff merge（避免 DOM 閃動）
 * - refreshStatus（含 empty snapshot guard）
 */

import { dom } from "./dom.js";
import { state } from "./state.js";
import {
  normalizeText,
  fmtRemainingRaw,
  deriveStatusClass,
  applyPillFromTokens,
  applyTextColorFromToken,
  applyTextColorFromTokenStrong,
  normalizeHex6,
  hexToRgb,
  isLightTheme,
  parseOpacityToken,
  getRgbaString,
} from "./core.js";
import { fetchStatusAll, getCachedStatusSnapshot } from "./edgeClient.js";
import { updateMyMasterStatusUI } from "./myMasterStatus.js";
import { showGate, hideGate } from "./uiHelpers.js";
import { logUsageEvent } from "./usageLog.js";
import { config } from "./config.js";

/* =========================
 * mapping
 * ========================= */
function mapRowsToDisplay(rows) {
  return rows.map((row) => {
    const remaining = row.remaining === 0 || row.remaining ? row.remaining : "";
    return {
      sort: row.sort,
      index: row.index,
      _gasSeq: row._gasSeq,

      masterId: normalizeText(row.masterId),
      status: normalizeText(row.status),
      appointment: normalizeText(row.appointment),

      colorIndex: row.colorIndex || "",
      colorMaster: row.colorMaster || "",
      colorStatus: row.colorStatus || "",

      colorAppointment: row.colorAppointment || row.colorAppt || row.colorBooking || "",
      colorRemaining: row.colorRemaining || row.colorRemain || row.colorTime || "",

      bgIndex: row.bgIndex || "",
      bgMaster: row.bgMaster || "",
      bgStatus: row.bgStatus || "",

      remainingDisplay: fmtRemainingRaw(remaining),
      statusClass: deriveStatusClass(row.status, remaining),
    };
  });
}

/* =========================
 * Filters
 * ========================= */
/**
 * 依目前 rawData 重新建立「狀態篩選」下拉選單。
 * - 會保留使用者原本選擇（若該狀態仍存在）
 * - 會同步更新 state.filterStatus
 */
export function rebuildStatusFilterOptions() {
  if (!dom.filterStatusSelect) return;

  const statuses = new Set();
  ["body", "foot"].forEach((type) => {
    (state.rawData[type] || []).forEach((r) => {
      const s = normalizeText(r.status);
      if (s) statuses.add(s);
    });
  });

  const previous = dom.filterStatusSelect.value || "all";
  dom.filterStatusSelect.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "全部狀態";
  dom.filterStatusSelect.appendChild(optAll);

  for (const s of statuses) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    dom.filterStatusSelect.appendChild(opt);
  }

  dom.filterStatusSelect.value = previous !== "all" && statuses.has(previous) ? previous : "all";
  state.filterStatus = dom.filterStatusSelect.value;
}

/**
 * 依目前 rawData 重新建立「師傅篩選」下拉選單。
 * - 保留使用者原本選擇（若該師傅仍存在）
 * - 會同步更新 state.filterMaster
 */
export function rebuildMasterFilterOptions() {
  if (!dom.filterMasterInput) return;

  const masters = new Set();
  ["body", "foot"].forEach((type) => {
    (state.rawData[type] || []).forEach((r) => {
      const m = normalizeText(r.masterId);
      if (m) masters.add(m);
    });
  });

  const previous = dom.filterMasterInput.value || "";
  dom.filterMasterInput.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "全部師傅";
  dom.filterMasterInput.appendChild(optAll);

  // sort masters for stable order (numeric if possible)
  const masterList = Array.from(masters);
  masterList.sort((a, b) => {
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return parseInt(a, 10) - parseInt(b, 10);
    return String(a).localeCompare(String(b));
  });

  for (const m of masterList) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    dom.filterMasterInput.appendChild(opt);
  }

  dom.filterMasterInput.value = previous && masters.has(previous) ? previous : "";
  state.filterMaster = dom.filterMasterInput.value || "";
}

function applyFilters(list) {
  return list.filter((row) => {
    if (state.filterMaster) {
      const key = String(state.filterMaster).trim();
      const master = String(row.masterId || "").trim();

      if (/^\d+$/.test(key)) {
        if (parseInt(master, 10) !== parseInt(key, 10)) return false;
      } else {
        if (!master.includes(key)) return false;
      }
    }

    if (state.filterStatus && state.filterStatus !== "all") {
      if (normalizeText(row.status) !== normalizeText(state.filterStatus)) return false;
    }

    return true;
  });
}

/* =========================
 * Panel diff merge
 * ========================= */
function rowSignature(r) {
  if (!r) return "";
  return [
    r.masterId ?? "",
    r.index ?? "",
    r.sort ?? "",
    r.status ?? "",
    r.appointment ?? "",
    r.remaining ?? "",
    r.colorIndex ?? "",
    r.colorMaster ?? "",
    r.colorStatus ?? "",
    r.bgIndex ?? "",
    r.bgMaster ?? "",
    r.bgStatus ?? "",
    r.bgAppointment ?? "",
    // ✅ timestamp 變更也視為資料更新（避免「內容相同但快照有更新」被當成沒變）
    r.timestamp ?? r.sourceTs ?? r.updatedAt ?? "",
  ].join("|");
}

function parseTimestampMs_(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function fmtHm_(d) {
  try {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

/**
 * 用最近一次成功快照快速顯示（不阻塞 UI）。
 * - 只影響前端顯示；不會跳過後續的正式同步
 */
export function hydrateStatusFromCache({ maxAgeMs } = {}) {
  const snap = getCachedStatusSnapshot({ maxAgeMs });
  if (!snap) return false;

  const bodyRows = Array.isArray(snap.bodyRows) ? snap.bodyRows : [];
  const footRows = Array.isArray(snap.footRows) ? snap.footRows : [];

  const bodyDiff = diffMergePanelRows(state.rawData.body, bodyRows);
  const footDiff = diffMergePanelRows(state.rawData.foot, footRows);

  if (bodyDiff.changed) state.rawData.body = bodyDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));
  if (footDiff.changed) state.rawData.foot = footDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));

  if (bodyDiff.statusChanged || footDiff.statusChanged) rebuildStatusFilterOptions();
  rebuildMasterFilterOptions();

  // UI hints: cached data
  try {
    if (dom.connectionStatusEl) {
      if (!state.scheduleUiEnabled) {
        dom.connectionStatusEl.textContent = "排班表未開通（僅顯示我的狀態）";
      } else if (snap.source === "edge" && typeof snap.edgeIdx === "number") {
        dom.connectionStatusEl.textContent = `快取（分流 ${snap.edgeIdx + 1}）`;
      } else {
        dom.connectionStatusEl.textContent = "快取（主站）";
      }
    }
  } catch {}

  try {
    if (dom.lastUpdateEl) {
      const t = new Date(Number(snap.t) || Date.now());
      dom.lastUpdateEl.textContent = "快取：" + fmtHm_(t);
    }
  } catch {}

  // store cached fetch timestamp for stale checks (best-effort)
  try {
    if (!state.dataHealth) state.dataHealth = {};
    const ms = parseTimestampMs_(snap.dataTimestamp);
    state.dataHealth.fetchDataTimestampMs = Number.isFinite(ms) ? ms : null;
  } catch {}

  if (state.scheduleUiEnabled) {
    try {
      renderIncremental(state.activePanel);
    } catch {}
  }

  // keep my status in sync with current rawData
  try {
    updateMyMasterStatusUI();
  } catch {}

  return true;
}

function computeLatestDataTimestampMs_() {
  let maxMs = null;
  ["body", "foot"].forEach((panel) => {
    (state.rawData[panel] || []).forEach((r) => {
      const ms = parseTimestampMs_(r && (r.timestamp ?? r.sourceTs ?? r.updatedAt));
      if (ms === null) return;
      maxMs = maxMs === null ? ms : Math.max(maxMs, ms);
    });
  });
  return maxMs;
}

function applyStaleSystemGate_() {
  const maxAge = Number(config.STALE_DATA_MAX_AGE_MS);
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    // disabled
    if (state.dataHealth && state.dataHealth.stale) {
      state.dataHealth.stale = false;
      state.dataHealth.staleSinceMs = null;
      hideGate();
    }
    return;
  }

  // combine row timestamps with any server-provided fetch timestamp
  let latestMs = computeLatestDataTimestampMs_();
  try {
    const fetchMs = Number(state.dataHealth && state.dataHealth.fetchDataTimestampMs);
    if (Number.isFinite(fetchMs)) {
      if (latestMs === null || fetchMs > latestMs) latestMs = fetchMs;
    }
  } catch (e) {}

  state.dataHealth.lastDataTimestampMs = latestMs;

  // 沒有可解析的 timestamp：不做「過久未更新」判斷（避免誤殺）
  if (latestMs === null) {
    if (state.dataHealth && state.dataHealth.stale) {
      state.dataHealth.stale = false;
      state.dataHealth.staleSinceMs = null;
      hideGate();
    }
    return;
  }

  const isStale = Date.now() - latestMs > maxAge;

  if (isStale && !state.dataHealth.stale) {
    state.dataHealth.stale = true;
    state.dataHealth.staleSinceMs = Date.now();
    showGate("總系統異常 無法使用功能", true);
    if (dom.connectionStatusEl) dom.connectionStatusEl.textContent = "異常";
    try {
      // send event to GAS (via config.USAGE_LOG_URL) for monitoring/alerting
      const lastTs = Number(state.dataHealth.lastDataTimestampMs || latestMs) || null;
      const payload = {
        lastDataTimestampMs: lastTs,
        lastDataIso: lastTs ? new Date(lastTs).toISOString() : "",
      };
      logUsageEvent({ event: "system_stale", detail: JSON.stringify(payload), noThrottle: true, eventCn: "系統資料過期" }).catch(() => {});
    } catch (e) {}
    return;
  }

  if (!isStale && state.dataHealth.stale) {
    state.dataHealth.stale = false;
    state.dataHealth.staleSinceMs = null;
    hideGate();
    try {
      // send recovery event to GAS for monitoring
      const lastTs = Number(state.dataHealth.lastDataTimestampMs || latestMs) || null;
      const payload = {
        lastDataTimestampMs: lastTs,
        lastDataIso: lastTs ? new Date(lastTs).toISOString() : "",
      };
      logUsageEvent({ event: "system_recovered", detail: JSON.stringify(payload), noThrottle: true, eventCn: "系統資料恢復" }).catch(() => {});
    } catch (e) {}
  }
}

function buildStatusSet(rows) {
  const s = new Set();
  (rows || []).forEach((r) => {
    const t = normalizeText(r && r.status);
    if (t) s.add(t);
  });
  return s;
}

function setEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function diffMergePanelRows(prevRows, incomingRows) {
  const prev = Array.isArray(prevRows) ? prevRows : [];
  const nextIn = Array.isArray(incomingRows) ? incomingRows : [];

  const prevMap = new Map();
  prev.forEach((r) => {
    const id = String((r && r.masterId) || "").trim();
    if (id) prevMap.set(id, r);
  });

  let changed = false;
  const nextRows = [];

  for (const nr of nextIn) {
    const id = String((nr && nr.masterId) || "").trim();
    if (!id) continue;

    const old = prevMap.get(id);
    if (!old) {
      nextRows.push({ ...nr });
      changed = true;
      continue;
    }

    const oldSig = rowSignature(old);
    const newSig = rowSignature(nr);

    if (oldSig !== newSig) {
      Object.assign(old, nr);
      changed = true;
    }

    nextRows.push(old);
    prevMap.delete(id);
  }

  if (prevMap.size > 0) changed = true;

  const prevStatus = buildStatusSet(prev);
  const nextStatus = buildStatusSet(nextRows);
  const statusChanged = !setEquals(prevStatus, nextStatus);

  return { changed, statusChanged, nextRows };
}

/* =========================
 * 表頭顏色：吃 GAS token
 * ========================= */
export function applyTableHeaderColorsFromRows(displayRows) {
  try {
    const table = dom.tbodyRowsEl ? dom.tbodyRowsEl.closest("table") : null;
    if (!table) return;

    const ths = table.querySelectorAll("thead th");
    if (!ths || ths.length < 5) return;

    const first = Array.isArray(displayRows) && displayRows.length ? displayRows[0] : null;

    if (!first) {
      ths.forEach((th) => {
        th.style.color = "";
        th.removeAttribute("data-colortoken");
      });
      return;
    }

    const tokens = [
      first.colorIndex || "",
      first.colorMaster || "",
      first.colorStatus || "",
      first.colorAppointment || "",
      first.colorRemaining || "",
    ];

    for (let i = 0; i < 5; i++) {
      const th = ths[i];
      const tk = tokens[i] || "";
      th.setAttribute("data-colortoken", tk);
      applyTextColorFromToken(th, tk);
    }
  } catch (e) {}
}

/**
 * 重新套用表頭顏色（從 th[data-colortoken] 取回 token）。
 * - 用在主題切換後：避免 token 顏色在不同 theme 下需要重算
 */
export function reapplyTableHeaderColorsFromDataset() {
  try {
    const table = dom.tbodyRowsEl ? dom.tbodyRowsEl.closest("table") : null;
    if (!table) return;
    const ths = table.querySelectorAll("thead th[data-colortoken]");
    ths.forEach((th) => {
      const tk = th.getAttribute("data-colortoken") || "";
      applyTextColorFromToken(th, tk);
    });
  } catch (e) {}
}

/* =========================
 * Incremental render
 * ========================= */
const rowDomMapByPanel = { body: new Map(), foot: new Map() };

function buildRowKey(row) {
  return String((row && row.masterId) || "").trim();
}

function ensureRowDom(panel, row) {
  const key = buildRowKey(row);
  if (!key) return null;

  const map = rowDomMapByPanel[panel];
  let tr = map.get(key);
  if (tr) return tr;

  tr = document.createElement("tr");

  const tdOrder = document.createElement("td");
  tdOrder.className = "cell-order";
  tdOrder.setAttribute("data-label", "順序");

  const tdMaster = document.createElement("td");
  tdMaster.className = "cell-master";
  tdMaster.setAttribute("data-label", "師傅");

  const tdStatus = document.createElement("td");
  tdStatus.setAttribute("data-label", "狀態");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-pill";
  tdStatus.appendChild(statusSpan);

  const tdAppointment = document.createElement("td");
  tdAppointment.className = "cell-appointment";
  tdAppointment.setAttribute("data-label", "預約內容");
  const apptBlock = document.createElement("div");
  apptBlock.className = "appt-block";
  tdAppointment.appendChild(apptBlock);

  const tdRemaining = document.createElement("td");
  tdRemaining.setAttribute("data-label", "剩餘時間");
  const timeSpan = document.createElement("span");
  timeSpan.className = "time-badge";
  tdRemaining.appendChild(timeSpan);

  tr.appendChild(tdOrder);
  tr.appendChild(tdMaster);
  tr.appendChild(tdStatus);
  tr.appendChild(tdAppointment);
  tr.appendChild(tdRemaining);

  // Cache refs on the DOM node to avoid repeated query/creation
  tr.__ui = { tdOrder, tdMaster, tdStatus, statusSpan, tdAppointment, apptBlock, tdRemaining, timeSpan };
  tr.__sig = "";

  map.set(key, tr);
  return tr;
}

/*
 * 順序欄位：只允許 bgIndex=bg-CCBCBCB 才上底色
 */
const ORDER_HL_BG_TOKEN = "bg-CCBCBCB";
function isOrderIndexHighlight(bgIndexToken) {
  return String(bgIndexToken || "").trim() === ORDER_HL_BG_TOKEN;
}

function applyOrderIndexHighlight(tdOrder, bgToken) {
  if (!tdOrder) return;

  const h = normalizeHex6(bgToken);
  if (!h) return;

  const aBg = isLightTheme() ? 0.36 : 0.42;
  const bgRgba = getRgbaString(h, aBg);
  if (bgRgba) tdOrder.style.backgroundColor = bgRgba;

  const aStripe = 0.92;
  const stripeRgba = getRgbaString(h, aStripe);
  if (stripeRgba) tdOrder.style.borderLeft = `6px solid ${stripeRgba}`;

  const aBd = isLightTheme() ? 0.60 : 0.62;
  const bdRgba = getRgbaString(h, aBd);
  if (bdRgba) tdOrder.style.outline = `1px solid ${bdRgba}`;
  tdOrder.style.outlineOffset = "-2px";

  tdOrder.style.boxShadow = isLightTheme()
    ? "inset 0 0 0 999px rgba(255,255,255,0.14), 0 1px 10px rgba(0,0,0,0.08)"
    : "inset 0 0 0 999px rgba(0,0,0,0.10), 0 0 0 1px rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.35)";

  tdOrder.style.fontWeight = "900";
}

function extractBgColorFromColorMaster(colorMaster) {
  const tokens = String(colorMaster || "").split(/\s+/).filter(Boolean);

  let hex = null;
  for (const tk of tokens) {
    if (!tk.toLowerCase().startsWith("bg-")) continue;
    const h = normalizeHex6(tk);
    if (h) {
      hex = h;
      break;
    }
  }

  if (!hex) return null;

  let opacity = null;
  for (const tk of tokens) {
    const o = parseOpacityToken(tk);
    if (o != null) {
      opacity = o;
      break;
    }
  }

  return { hex, opacity };
}

function applyAppointmentBgFromColorMaster(tdAppointment, colorMaster) {
  if (!tdAppointment) return;
  tdAppointment.style.backgroundColor = "";

  const bg = extractBgColorFromColorMaster(colorMaster);
  if (!bg) return;

  const baseAlpha = isLightTheme() ? 0.14 : 0.22;
  const alpha = Math.max(0.06, Math.min(0.40, bg.opacity == null ? baseAlpha : bg.opacity));

  const rgba = getRgbaString(bg.hex, alpha);
  if (rgba) tdAppointment.style.backgroundColor = rgba;
}

function patchRowDom(tr, row, orderText) {
  const ui = tr.__ui;
  const tdOrder = ui ? ui.tdOrder : tr.children[0];
  const tdMaster = ui ? ui.tdMaster : tr.children[1];
  const tdStatus = ui ? ui.tdStatus : tr.children[2];
  const statusSpan = ui ? ui.statusSpan : null;
  const tdAppointment = ui ? ui.tdAppointment : tr.children[3];
  const apptBlock = ui ? ui.apptBlock : null;
  const tdRemaining = ui ? ui.tdRemaining : tr.children[4];
  const timeSpan = ui ? ui.timeSpan : null;

  tdOrder.textContent = orderText;
  tdOrder.style.backgroundColor = "";
  tdOrder.style.borderLeft = "";
  tdOrder.style.outline = "";
  tdOrder.style.outlineOffset = "";
  tdOrder.style.boxShadow = "";

  // color is applied by applyTextColorFromTokenStrong (inline color only);
  // font-weight and text-shadow are provided by CSS class to avoid frequent
  // inline changes that cause layout/repaint thrash.
  applyTextColorFromTokenStrong(tdOrder, row.colorIndex);

  const isOrderHl = isOrderIndexHighlight(row.bgIndex);
  tdOrder.classList.toggle("cell-order-highlight", isOrderHl);
  if (isOrderHl) applyOrderIndexHighlight(tdOrder, row.bgIndex);

  tdMaster.textContent = row.masterId || "";
  tdMaster.style.color = "";
  applyTextColorFromToken(tdMaster, row.colorMaster);
  applyAppointmentBgFromColorMaster(tdMaster, row.colorMaster);

  const pill = statusSpan || (() => {
    tdStatus.textContent = "";
    const el = document.createElement("span");
    el.className = "status-pill";
    tdStatus.appendChild(el);
    if (ui) ui.statusSpan = el;
    return el;
  })();
  pill.className = "status-pill " + (row.statusClass || "");
  pill.textContent = row.status || "";
  applyPillFromTokens(pill, row.bgStatus, row.colorStatus);

  applyAppointmentBgFromColorMaster(tdAppointment, row.colorMaster);
  const ab = apptBlock || (() => {
    tdAppointment.textContent = "";
    const el = document.createElement("div");
    el.className = "appt-block";
    tdAppointment.appendChild(el);
    if (ui) ui.apptBlock = el;
    return el;
  })();
  ab.textContent = row.appointment || "";
  ab.style.color = "";
  applyTextColorFromToken(ab, row.colorAppointment);

  const tb = timeSpan || (() => {
    tdRemaining.textContent = "";
    const el = document.createElement("span");
    el.className = "time-badge";
    tdRemaining.appendChild(el);
    if (ui) ui.timeSpan = el;
    return el;
  })();
  tb.className = "time-badge";
  tb.textContent = row.remainingDisplay || "";
  applyTextColorFromToken(tb, row.colorRemaining);
}

function getThemeKey() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function buildRenderSignature(row, orderText) {
  if (!row) return getThemeKey() + "|" + String(orderText || "");
  return (
    getThemeKey() +
    "|" +
    String(orderText || "") +
    "|" +
    [
      row.masterId || "",
      row.status || "",
      row.appointment || "",
      row.remainingDisplay || "",
      row.statusClass || "",

      row.colorIndex || "",
      row.colorMaster || "",
      row.colorStatus || "",
      row.colorAppointment || "",
      row.colorRemaining || "",

      row.bgIndex || "",
      row.bgMaster || "",
      row.bgStatus || "",
    ].join("|")
  );
}

export function renderIncremental(panel) {
  if (!dom.tbodyRowsEl) return;

  // 排班表未開通：不渲染面板
  if (!state.scheduleUiEnabled) return;

  const list = panel === "body" ? state.rawData.body : state.rawData.foot;
  const filtered = applyFilters(list);

  const isAll = state.filterStatus === "all";
  const isShift = String(state.filterStatus || "").includes("排班");
  const useDisplayOrder = isAll || isShift;

  let finalRows;
  if (useDisplayOrder) {
    finalRows = filtered.slice().sort((a, b) => {
      const na = Number(a.sort ?? a.index);
      const nb = Number(b.sort ?? b.index);
      const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
      const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;
      if (aKey !== bKey) return aKey - bKey;
      return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
    });
  } else {
    finalRows = filtered.slice().sort((a, b) => {
      const na = Number(a.sort);
      const nb = Number(b.sort);
      const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
      const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;
      if (aKey !== bKey) return aKey - bKey;
      return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
    });
  }

  const RENDER_SLOW_MS = 60; // threshold to warn about slow renders
  const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  const displayRows = mapRowsToDisplay(finalRows);

  if (dom.emptyStateEl) dom.emptyStateEl.style.display = displayRows.length ? "none" : "block";
  if (dom.panelTitleEl) dom.panelTitleEl.textContent = panel === "body" ? "身體面板" : "腳底面板";

  applyTableHeaderColorsFromRows(displayRows);

  const frag = document.createDocumentFragment();

  displayRows.forEach((row, idx) => {
    const showGasSortInOrderCol = !useDisplayOrder;
    const sortNum = Number(row.sort);
    const orderText = showGasSortInOrderCol && !Number.isNaN(sortNum) ? String(sortNum) : String(idx + 1);

    const tr = ensureRowDom(panel, row);
    if (!tr) return;

    const sig = buildRenderSignature(row, orderText);
    if (tr.__sig !== sig) {
      patchRowDom(tr, row, orderText);
      tr.__sig = sig;
    }
    frag.appendChild(tr);
  });

  // 清理不再需要的 row DOM，避免 `rowDomMapByPanel` 隨著加入/移除累積記憶體
  try {
    const map = rowDomMapByPanel[panel];
    const keepKeys = new Set(displayRows.map((r) => buildRowKey(r)));
    for (const [k, tr] of Array.from(map.entries())) {
      if (!keepKeys.has(k)) {
        map.delete(k);
        try {
          if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
        } catch (e) {}
      }
    }
  } catch (e) {}

  dom.tbodyRowsEl.replaceChildren(frag);

  try {
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const dt = Math.round(t1 - t0);
    if (dt > RENDER_SLOW_MS) {
      console.warn(`[Perf] renderIncremental(${panel}) slow: ${dt}ms, rows=${displayRows.length}`);
    } else {
      console.debug && console.debug(`[Perf] renderIncremental ${dt}ms`);
    }
  } catch (e) {}
}

/* =========================
 * refresh: no overlap + empty snapshot guard
 * ========================= */
const EMPTY_ACCEPT_AFTER_N = 2;

function decideIncomingRows(panel, incomingRows, prevRows, isManual) {
  const inc = Array.isArray(incomingRows) ? incomingRows : [];
  const prev = Array.isArray(prevRows) ? prevRows : [];

  if (isManual) {
    state.emptyStreak[panel] = 0;
    return { rows: inc, accepted: true };
  }
  if (inc.length > 0) {
    state.emptyStreak[panel] = 0;
    return { rows: inc, accepted: true };
  }
  if (prev.length === 0) {
    state.emptyStreak[panel] = 0;
    return { rows: inc, accepted: true };
  }

  state.emptyStreak[panel] = (state.emptyStreak[panel] || 0) + 1;
  if (state.emptyStreak[panel] >= EMPTY_ACCEPT_AFTER_N) {
    state.emptyStreak[panel] = 0;
    return { rows: inc, accepted: true };
  }

  return { rows: prev, accepted: false };
}

export async function refreshStatus({ isManual } = { isManual: false }) {
  if (document.hidden && !config.POLL_ALLOW_BACKGROUND) return;
  if (state.refreshInFlight) return;

  state.refreshInFlight = true;

  if (isManual && dom.errorStateEl) dom.errorStateEl.style.display = "none";

  try {
    const REFRESH_SLOW_MS = 400; // threshold to warn about slow refresh
    const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const { source, edgeIdx, bodyRows, footRows, dataTimestamp } = await fetchStatusAll();
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const dtFetch = Math.round(t1 - t0);
    if (dtFetch > REFRESH_SLOW_MS) console.warn(`[Perf] fetchStatusAll slow: ${dtFetch}ms`);

    const bodyDecision = decideIncomingRows("body", bodyRows, state.rawData.body, isManual);
    const footDecision = decideIncomingRows("foot", footRows, state.rawData.foot, isManual);

    const bodyDiff = diffMergePanelRows(state.rawData.body, bodyDecision.rows);
    const footDiff = diffMergePanelRows(state.rawData.foot, footDecision.rows);

    // capture previous master set for comparison
    const prevMasterSet = new Set();
    ["body", "foot"].forEach((type) => {
      (state.rawData[type] || []).forEach((r) => {
        const m = normalizeText(r.masterId);
        if (m) prevMasterSet.add(m);
      });
    });

    if (bodyDiff.changed) state.rawData.body = bodyDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));
    if (footDiff.changed) state.rawData.foot = footDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));

    if (bodyDiff.statusChanged || footDiff.statusChanged) rebuildStatusFilterOptions();

    // rebuild master options only when master set changed
    const nextMasterSet = new Set();
    ["body", "foot"].forEach((type) => {
      (state.rawData[type] || []).forEach((r) => {
        const m = normalizeText(r.masterId);
        if (m) nextMasterSet.add(m);
      });
    });
    if (!setEquals(prevMasterSet, nextMasterSet)) rebuildMasterFilterOptions();

    const anyChanged = bodyDiff.changed || footDiff.changed;
    const activeChanged = state.activePanel === "body" ? bodyDiff.changed : footDiff.changed;

    if (dom.connectionStatusEl) {
      if (!state.scheduleUiEnabled) {
        dom.connectionStatusEl.textContent = "排班表未開通（僅顯示我的狀態）";
      } else if (source === "edge" && typeof edgeIdx === "number") {
        dom.connectionStatusEl.textContent = `已連線（分流 ${edgeIdx + 1}）`;
      } else {
        dom.connectionStatusEl.textContent = "已連線（主站）";
      }
    }

    if (anyChanged && dom.lastUpdateEl) {
      const now = new Date();
      dom.lastUpdateEl.textContent =
        "更新：" + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    }

    if (state.scheduleUiEnabled) {
      if (activeChanged) renderIncremental(state.activePanel);
      else reapplyTableHeaderColorsFromDataset();
    }

    // ✅ 資料過久未更新：顯示 Gate（並阻止操作）；恢復後自動解除
    // store server-provided timestamp (if any) so stale check can consider it
    try {
      if (!state.dataHealth) state.dataHealth = {};
      const ms = parseTimestampMs_(dataTimestamp);
      state.dataHealth.fetchDataTimestampMs = Number.isFinite(ms) ? ms : null;
    } catch (e) {}

    applyStaleSystemGate_();

    // 永遠更新我的狀態（schedule=否 也要）
    updateMyMasterStatusUI();
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (dom.connectionStatusEl) dom.connectionStatusEl.textContent = "異常";
    if (dom.errorStateEl && state.scheduleUiEnabled) dom.errorStateEl.style.display = "block";
    throw err;
  } finally {
    state.refreshInFlight = false;
  }
}

/* =========================
 * 面板切換（tabs）
 * ========================= */
export function setActivePanel(panel) {
  // 排班表未開通：不允許切換
  if (!state.scheduleUiEnabled) return;

  state.activePanel = panel;

  if (dom.tabBodyBtn && dom.tabFootBtn) {
    if (panel === "body") {
      dom.tabBodyBtn.classList.add("tab-active");
      dom.tabFootBtn.classList.remove("tab-active");
    } else {
      dom.tabFootBtn.classList.add("tab-active");
      dom.tabBodyBtn.classList.remove("tab-active");
    }
  }

  renderIncremental(state.activePanel);
  updateMyMasterStatusUI();
}
