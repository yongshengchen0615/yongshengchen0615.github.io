import { dom } from "./dom.js";
import { state } from "./state.js";
import {
  normalizeText,
  escapeHtml,
  applyPillFromTokens,
  tokenToStripe,
  applyTextColorFromToken,
} from "./core.js";
import { showNotMasterHint } from "./scheduleUi.js";

function pickAny(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

export function parseIsMaster(data) {
  const v = pickAny(data, ["isMaster", "是否師傅", "isTech", "isTechnician", "tech", "master"]);
  if (v === true) return true;
  const s = String(v ?? "").trim();
  if (s === "是") return true;
  if (s === "true" || s === "1" || s.toLowerCase() === "yes" || s.toLowerCase() === "y") return true;
  return false;
}

export function normalizeTechNo(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (Number.isNaN(n)) return "";
  return String(n).padStart(2, "0");
}

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

function parseAppointmentText(row) {
  const v = pickAny(row || {}, ["appointment", "預約", "booking", "appt", "bookingContent"]);
  return String(v ?? "").trim();
}

function parseAppointmentColor(row) {
  return pickAny(row || {}, ["colorAppointment", "colorAppt", "colorBooking"]);
}

function makeMyPanelRowHTML(label, row, shiftRankObj) {
  const statusText = row ? String(row.status || "").trim() || "—" : "—";
  const remNum = parseRemainingNumber(row);
  const remText = remNum === null ? "—" : String(remNum);
  const showRemaining = normalizeText(statusText) === "工作中";

  const stCls = "status-pill " + classifyMyStatusClass(statusText, remNum);
  const remCls = "myms-rem " + remBadgeClass(remNum);

  const hasRank = !!(shiftRankObj && typeof shiftRankObj.rank === "number");
  let rankText = "";
  let rankCls = "myms-rank";
  if (hasRank) {
    rankText = `入牌順位：${shiftRankObj.rank}`;
    if (shiftRankObj.rank <= 3) rankCls += " is-top3";
  }

  const apptRaw = parseAppointmentText(row);
  const hasAppt = !!apptRaw;
  const apptHtml = escapeHtml(apptRaw).replace(/\r?\n/g, "<br>");
  const apptColorToken = parseAppointmentColor(row);

  const bgStatus = row && row.bgStatus ? String(row.bgStatus) : "";
  const colorStatus = row && row.colorStatus ? String(row.colorStatus) : "";

  return `
    <div class="myms-row">
      <div class="myms-label">${escapeHtml(label)}</div>
      <div class="myms-right">
        <div class="myms-line myms-line1">
          <span class="${stCls}"
                data-bgstatus="${escapeHtml(bgStatus)}"
                data-colorstatus="${escapeHtml(colorStatus)}">
            ${escapeHtml(statusText)}
          </span>
          ${showRemaining ? `<span class="${remCls}">剩餘：${escapeHtml(String(remText))}</span>` : ""}
        </div>
        ${hasRank ? `
          <div class="myms-line myms-line2">
            <span class="${rankCls}">${escapeHtml(rankText)}</span>
          </div>
        ` : ""}
        ${hasAppt ? `
          <div class="myms-line myms-line-appt">
            <span class="myms-appt-badge">預約</span>
            <span class="myms-appt-text" data-colorappt="${escapeHtml(apptColorToken)}">${apptHtml}</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

export function updateMyMasterStatusUI() {
  if (!dom.myMasterStatusEl) return;

  // Admin schedule: allow selecting any master to view status.
  // Priority: dropdown -> state.statusViewer.techNo -> (fallback) filterMaster -> myMaster.techNo
  const selectedRaw =
    (dom.statusMasterSelect && dom.statusMasterSelect.value) ||
    (state.statusViewer && state.statusViewer.techNo) ||
    state.filterMaster ||
    (state.myMaster && state.myMaster.techNo) ||
    "";
  const targetTechNo = normalizeTechNo(selectedRaw);

  // In admin view we don't show the "not master" hint card.
  try { showNotMasterHint(false); } catch {}

  if (!targetTechNo) {
    dom.myMasterStatusEl.classList.remove("status-shift", "status-busy", "status-booked", "status-free", "status-other");
    dom.myMasterStatusEl.classList.add("status-other");
    dom.myMasterStatusEl.style.removeProperty("--myStripe");
    if (dom.myMasterStatusTextEl) dom.myMasterStatusTextEl.textContent = "請先選擇師傅編號";
    dom.myMasterStatusEl.style.display = "flex";
    return;
  }

  const bodyRow = findRowByTechNo(state.rawData.body, targetTechNo);
  const footRow = findRowByTechNo(state.rawData.foot, targetTechNo);

  const bodyShiftRank = getShiftRank(state.rawData.body, targetTechNo);
  const footShiftRank = getShiftRank(state.rawData.foot, targetTechNo);

  dom.myMasterStatusEl.classList.remove("status-shift", "status-busy", "status-booked", "status-free", "status-other");
  dom.myMasterStatusEl.classList.add("status-other");

  const host = dom.myMasterStatusTextEl || dom.myMasterStatusEl;

  host.innerHTML = `
    <div class="myms">
      <div class="myms-head">
        <div class="myms-tech">
          <span class="myms-tech-badge">師傅</span>
          <span> ${escapeHtml(targetTechNo)} </span>
        </div>
      </div>

      ${makeMyPanelRowHTML("身體", bodyRow, bodyShiftRank)}
      ${makeMyPanelRowHTML("腳底", footRow, footShiftRank)}
    </div>
  `;

  const pills = host.querySelectorAll('.status-pill[data-bgstatus], .status-pill[data-colorstatus]');
  pills.forEach((pill) => {
    const bg = pill.getAttribute("data-bgstatus") || "";
    const fg = pill.getAttribute("data-colorstatus") || "";
    applyPillFromTokens(pill, bg, fg);
  });

  const apptTexts = host.querySelectorAll('.myms-appt-text[data-colorappt]');
  apptTexts.forEach((el) => {
    const tk = el.getAttribute("data-colorappt") || "";
    applyTextColorFromToken(el, tk);
  });

  const dominant = pickDominantRow(bodyRow, footRow);
  if (dominant) {
    const stripe = tokenToStripe(dominant.bgStatus, dominant.colorStatus);
    if (stripe) dom.myMasterStatusEl.style.setProperty("--myStripe", stripe);
    else dom.myMasterStatusEl.style.removeProperty("--myStripe");

    // apply container semantic class for subtle background tuning
    try {
      const cls = classifyMyStatusClass(dominant.status, parseRemainingNumber(dominant));
      dom.myMasterStatusEl.classList.remove("status-shift", "status-busy", "status-booked", "status-free", "status-other");
      dom.myMasterStatusEl.classList.add(cls || "status-other");
    } catch {}
  } else {
    dom.myMasterStatusEl.style.removeProperty("--myStripe");
    dom.myMasterStatusEl.classList.remove("status-shift", "status-busy", "status-booked", "status-free", "status-other");
    dom.myMasterStatusEl.classList.add("status-other");
  }

  dom.myMasterStatusEl.style.display = "flex";
}
