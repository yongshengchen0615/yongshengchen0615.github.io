/**
 * myMasterStatus.js
 *
 * 「我的狀態」區塊：
 * - 判斷是否師傅、師傅編號 techNo
 * - 從身體/腳底 rawData 找到自己的 row
 * - 顯示身體/腳底狀態、剩餘、（若排班）順位
 * - 套用 GAS 顏色 token（狀態 pill 與左側色條）
 */

import { dom } from "./dom.js";
import { state } from "./state.js";
import {
  normalizeText,
  escapeHtml,
  applyPillFromTokens,
  tokenToStripe,
} from "./core.js";
import { showNotMasterHint } from "./scheduleUi.js";

function pickAny(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

/** 判斷是否師傅（支援多種欄位命名） */
export function parseIsMaster(data) {
  const v = pickAny(data, ["isMaster", "是否師傅", "isTech", "isTechnician", "tech", "master"]);
  if (v === true) return true;
  const s = String(v ?? "").trim();
  if (s === "是") return true;
  if (s === "true" || s === "1" || s.toLowerCase() === "yes" || s.toLowerCase() === "y") return true;
  return false;
}

/** 把師傅編號統一成兩位數字字串，例如 7 -> "07" */
export function normalizeTechNo(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (Number.isNaN(n)) return "";
  return String(n).padStart(2, "0");
}

/** 支援 GAS 回傳 masterCode 等欄位 */
export function parseTechNo(data) {
  const v = pickAny(data, [
    "techNo",
    "師傅編號",
    "masterCode",
    "masterId",
    "masterNo",
    "tech",
    "師傅",
    "技師編號",
  ]);
  return normalizeTechNo(v);
}

function findRowByTechNo(rows, techNo) {
  const t = normalizeTechNo(techNo);
  if (!t) return null;
  const list = Array.isArray(rows) ? rows : [];
  for (const r of list) {
    const mid = normalizeTechNo(r && r.masterId);
    if (mid && mid === t) return r;
  }
  return null;
}

/* =========================
 * Shift rank（排班順位：即使不是排班也顯示「若排班」）
 * ========================= */
function isShiftStatus(statusText) {
  const s = normalizeText(statusText || "");
  return s.includes("排班");
}

function sortRowsForDisplay(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];

  const isAll = state.filterStatus === "all";
  const isShift = String(state.filterStatus || "").includes("排班");
  const useDisplayOrder = isAll || isShift;

  if (useDisplayOrder) {
    return list.sort((a, b) => {
      const na = Number(a.sort ?? a.index);
      const nb = Number(b.sort ?? b.index);
      const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
      const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;
      if (aKey !== bKey) return aKey - bKey;
      return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
    });
  }

  return list.sort((a, b) => {
    const na = Number(a.sort);
    const nb = Number(b.sort);
    const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
    const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;
    if (aKey !== bKey) return aKey - bKey;
    return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
  });
}

function getShiftRank(panelRows, techNo) {
  const t = normalizeTechNo(techNo);
  if (!t) return null;

  const sortedAll = sortRowsForDisplay(panelRows || []);
  if (!sortedAll.length) return null;

  let myPos = -1;
  let myRow = null;
  for (let i = 0; i < sortedAll.length; i++) {
    const r = sortedAll[i];
    const mid = normalizeTechNo(r && r.masterId);
    if (mid && mid === t) {
      myPos = i;
      myRow = r;
      break;
    }
  }
  if (myPos < 0) return null;

  const shiftPositions = [];
  for (let i = 0; i < sortedAll.length; i++) {
    const r = sortedAll[i];
    if (isShiftStatus(r && r.status)) shiftPositions.push(i);
  }

  const shiftCount = shiftPositions.length;
  const meIsShiftNow = myRow && isShiftStatus(myRow.status);

  const beforeMe = shiftPositions.filter((p) => p < myPos).length;
  const rank = beforeMe + 1;

  const total = shiftCount + (meIsShiftNow ? 0 : 1);

  return { rank, total, meIsShiftNow };
}

/* =========================
 * 我的狀態：badge 規則 + 版面渲染
 * ========================= */
function parseRemainingNumber(row) {
  if (!row) return null;
  const v = row.remaining === 0 || row.remaining ? row.remaining : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
}

function classifyMyStatusClass(statusText, remainingNum) {
  const s = normalizeText(statusText || "");
  const n = typeof remainingNum === "number" ? remainingNum : Number.NaN;

  if (s.includes("排班")) return "status-shift";
  if (s.includes("工作")) return "status-busy";
  if (s.includes("預約")) return "status-booked";
  if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return "status-free";
  if (!Number.isNaN(n) && n < 0) return "status-busy";
  return "status-other";
}

function remBadgeClass(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  if (n < 0) return "is-expired";
  if (n <= 3) return "is-warn";
  return "";
}

function pickDominantRow(bodyRow, footRow) {
  const candidates = [bodyRow, footRow].filter(Boolean);
  if (!candidates.length) return null;

  const score = (r) => {
    const s = normalizeText(r.status || "");
    const n = parseRemainingNumber(r);
    if (s.includes("排班")) return 5;
    if (s.includes("工作") || (!Number.isNaN(n) && n < 0)) return 4;
    if (s.includes("預約")) return 3;
    if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return 2;
    return 1;
  };

  let best = candidates[0];
  for (const c of candidates) if (score(c) > score(best)) best = c;
  return best;
}

function makeMyPanelRowHTML(label, row, shiftRankObj) {
  const statusText = row ? String(row.status || "").trim() || "—" : "—";
  const remNum = parseRemainingNumber(row);
  const remText = remNum === null ? "—" : String(remNum);

  const stCls = "status-pill " + classifyMyStatusClass(statusText, remNum);
  const remCls = "myms-rem " + remBadgeClass(remNum);

  let rankText = "—";
  let rankCls = "myms-rank";
  if (shiftRankObj && typeof shiftRankObj.rank === "number") {
    const prefix = shiftRankObj.meIsShiftNow ? "排班" : "若排班";
    rankText = `${prefix}：第 ${shiftRankObj.rank} / ${shiftRankObj.total}`;
    if (shiftRankObj.rank <= 3) rankCls += " is-top3";
  }

  const bgStatus = row && row.bgStatus ? String(row.bgStatus) : "";
  const colorStatus = row && row.colorStatus ? String(row.colorStatus) : "";

  return `
    <div class="myms-row">
      <div class="myms-label">${escapeHtml(label)}</div>
      <div class="myms-right">
        <span class="${stCls}"
              data-bgstatus="${escapeHtml(bgStatus)}"
              data-colorstatus="${escapeHtml(colorStatus)}">
          ${escapeHtml(statusText)}
        </span>
        <span class="${remCls}">剩餘：${escapeHtml(String(remText))}</span>
        <span class="${rankCls}">${escapeHtml(rankText)}</span>
      </div>
    </div>
  `;
}

/**
 * 更新「我的狀態」區塊
 * - schedule=否 也要更新（用於只顯示我的狀態的模式）
 */
export function updateMyMasterStatusUI() {
  if (!dom.myMasterStatusEl) return;

  // 非師傅：schedule=否 顯示提示卡；否則隱藏提示
  if (!state.myMaster.isMaster || !state.myMaster.techNo) {
    if (!state.scheduleUiEnabled) showNotMasterHint(true);
    else showNotMasterHint(false);

    dom.myMasterStatusEl.style.display = "none";
    return;
  }

  // 師傅：不顯示提示卡
  showNotMasterHint(false);

  const bodyRow = findRowByTechNo(state.rawData.body, state.myMaster.techNo);
  const footRow = findRowByTechNo(state.rawData.foot, state.myMaster.techNo);

  const bodyShiftRank = getShiftRank(state.rawData.body, state.myMaster.techNo);
  const footShiftRank = getShiftRank(state.rawData.foot, state.myMaster.techNo);

  dom.myMasterStatusEl.classList.remove("status-shift", "status-busy", "status-booked", "status-free", "status-other");
  dom.myMasterStatusEl.classList.add("status-other");

  const host = dom.myMasterStatusTextEl || dom.myMasterStatusEl;

  host.innerHTML = `
    <div class="myms">
      <div class="myms-head">
        <div class="myms-tech">
          <span class="myms-tech-badge">師傅</span>
          <span> ${escapeHtml(state.myMaster.techNo)} </span>
        </div>
      </div>

      ${makeMyPanelRowHTML("身體", bodyRow, bodyShiftRank)}
      ${makeMyPanelRowHTML("腳底", footRow, footShiftRank)}
    </div>
  `;

  // 套用 token 顏色到 pill
  const pills = host.querySelectorAll('.status-pill[data-bgstatus], .status-pill[data-colorstatus]');
  pills.forEach((pill) => {
    const bg = pill.getAttribute("data-bgstatus") || "";
    const fg = pill.getAttribute("data-colorstatus") || "";
    applyPillFromTokens(pill, bg, fg);
  });

  // 左側色條（用 dominant row 的 token）
  const dominant = pickDominantRow(bodyRow, footRow);
  if (dominant) {
    const stripe = tokenToStripe(dominant.bgStatus, dominant.colorStatus);
    if (stripe) dom.myMasterStatusEl.style.setProperty("--myStripe", stripe);
    else dom.myMasterStatusEl.style.removeProperty("--myStripe");
  } else {
    dom.myMasterStatusEl.style.removeProperty("--myStripe");
  }

  dom.myMasterStatusEl.style.display = "flex";
}
