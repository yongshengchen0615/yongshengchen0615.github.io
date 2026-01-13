import { config, loadConfig } from "./modules/config.js";
import { fetchSheetAll, listHolidays } from "./modules/api.js";
import { normalizeTechNo } from "./modules/core.js";
import { ensureAuthorizedOrShowGate, submitReviewRequest, getMasterOpenStatus } from "./modules/auth.js";
import { initLiffIfConfigured } from "./modules/liff.js";

const els = {
  techNoInput: document.getElementById("techNoInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusHint: document.getElementById("statusHint"),
  themeToggle: document.getElementById("themeToggle"),

  authGate: document.getElementById("authGate"),
  authGateMsg: document.getElementById("authGateMsg"),
  authRequestBlock: document.getElementById("authRequestBlock"),
  reqGuestName: document.getElementById("reqGuestName"),
  reqGuestNote: document.getElementById("reqGuestNote"),
  reqSubmit: document.getElementById("reqSubmit"),
  reqResult: document.getElementById("reqResult"),

  lastUpdate: document.getElementById("lastUpdate"),
  statusMeta: document.getElementById("statusMeta"),
  statusError: document.getElementById("statusError"),

  bodyStatus: document.getElementById("bodyStatus"),
  bodyRem: document.getElementById("bodyRem"),
  bodyAppt: document.getElementById("bodyAppt"),
  footStatus: document.getElementById("footStatus"),
  footRem: document.getElementById("footRem"),
  footAppt: document.getElementById("footAppt"),

  vacationMeta: document.getElementById("vacationMeta"),
  calPrev: document.getElementById("calPrev"),
  calNext: document.getElementById("calNext"),
  calMonthLabel: document.getElementById("calMonthLabel"),
  calGrid: document.getElementById("calGrid"),
  vacationError: document.getElementById("vacationError"),
};

function setAuthReqResult(t) {
  if (!els.reqResult) return;
  els.reqResult.textContent = t;
}

async function submitAuthRequest_() {
  const name = String(els.reqGuestName?.value || "").trim();
  const note = String(els.reqGuestNote?.value || "").trim();
  if (!name) {
    alert("請輸入姓名/稱呼");
    return;
  }

  // Fail-closed: if master is not approved/enabled, do not allow submitting requests.
  try {
    const st = await getMasterOpenStatus({ authEndpoint: config.AUTH_ENDPOINT, masterId: config.TARGET_TECH_NO });
    if (!st.approved || !st.enabled) {
      showAuthRequestBlock(false);
      setAuthReqResult("—");
      setGateMessage(!st.approved ? "目前師傅尚未通過審核，看板暫不可使用。" : "目前師傅尚未開通個人狀態，看板暫不可使用。");
      return;
    }
  } catch (e) {
    // If status cannot be determined, close the panel (fail-closed).
    console.warn("[Auth] open_status check failed", e);
    showAuthRequestBlock(false);
    setAuthReqResult("—");
    setGateMessage("目前暫不開放申請，請稍後再試。");
    return;
  }

  try {
    if (els.reqSubmit) els.reqSubmit.disabled = true;
    setAuthReqResult("送出中…");

    const res = await submitReviewRequest({
      authEndpoint: config.AUTH_ENDPOINT,
      masterId: config.TARGET_TECH_NO,
      guestName: name,
      guestNote: note,
    });

    const requestId = String(res.requestId || "").trim();
    if (!requestId) throw new Error("missing requestId");

    setAuthReqResult(`已送出申請，申請碼：${requestId}（請提供給師傅審核）`);
  } catch (e) {
    console.error(e);
    setAuthReqResult("送出失敗：" + String(e));
  } finally {
    if (els.reqSubmit) els.reqSubmit.disabled = false;
  }
}

function getTheme_() {
  const saved = String(localStorage.getItem("theme") || "").trim();
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

function applyTheme_(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
  if (els.themeToggle) els.themeToggle.textContent = t === "dark" ? "亮色" : "暗色";
}

function initTheme_() {
  applyTheme_(getTheme_());
  els.themeToggle?.addEventListener("click", () => {
    const cur = String(document.documentElement.getAttribute("data-theme") || "dark");
    applyTheme_(cur === "dark" ? "light" : "dark");
  });
}

const vacationState = {
  holidaysSet: new Set(), // YYYY-MM-DD
  viewYear: null,
  viewMonth0: null, // 0-11
};

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function showEl(el, show) {
  if (!el) return;
  el.style.display = show ? "" : "none";
}

function setGateMessage(text) {
  if (els.authGateMsg) els.authGateMsg.textContent = String(text || "—");
}

function showAuthRequestBlock(show) {
  if (!els.authRequestBlock) return;
  els.authRequestBlock.style.display = show ? "" : "none";
}

function setVacationMonth(year, month0) {
  vacationState.viewYear = year;
  vacationState.viewMonth0 = month0;
  renderVacationCalendar();
}

function shiftVacationMonth(delta) {
  const y = typeof vacationState.viewYear === "number" ? vacationState.viewYear : new Date().getFullYear();
  const m0 = typeof vacationState.viewMonth0 === "number" ? vacationState.viewMonth0 : new Date().getMonth();
  const d = new Date(y, m0 + delta, 1);
  setVacationMonth(d.getFullYear(), d.getMonth());
}

function renderVacationCalendar() {
  if (!els.calGrid || !els.calMonthLabel) return;

  const y = typeof vacationState.viewYear === "number" ? vacationState.viewYear : new Date().getFullYear();
  const m0 = typeof vacationState.viewMonth0 === "number" ? vacationState.viewMonth0 : new Date().getMonth();

  els.calMonthLabel.textContent = `${y}-${String(m0 + 1).padStart(2, "0")}`;
  els.calGrid.innerHTML = "";

  const first = new Date(y, m0, 1);
  const firstDow = first.getDay(); // 0=Sun
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();

  // 固定 6 週（42格），排版穩定
  const totalCells = 42;
  for (let cell = 0; cell < totalCells; cell++) {
    const dayNum = cell - firstDow + 1;
    const isInMonth = dayNum >= 1 && dayNum <= daysInMonth;

    const div = document.createElement("div");
    div.className = "cal-cell" + (isInMonth ? "" : " is-empty");
    div.setAttribute("role", "gridcell");

    if (isInMonth) {
      const mm = String(m0 + 1).padStart(2, "0");
      const dd = String(dayNum).padStart(2, "0");
      const key = `${y}-${mm}-${dd}`;

      const isHoliday = vacationState.holidaysSet.has(key);
      if (isHoliday) div.classList.add("is-holiday");

      const dayEl = document.createElement("div");
      dayEl.className = "cal-day";
      dayEl.textContent = String(dayNum);
      div.appendChild(dayEl);

      if (isHoliday) {
        const badge = document.createElement("div");
        badge.className = "cal-badge";
        badge.textContent = "休";
        div.appendChild(badge);
        div.title = key;
      }
    }

    els.calGrid.appendChild(div);
  }
}

function formatYmdForHumans(ymd) {
  const s = String(ymd || "").trim();
  // 需求：以 YYYY-MM-DD 顯示（例如 2026-01-13）
  {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // 兼容：GAS/Spreadsheet 有時會回傳 Date.toString() 類型字串
  // 例如："Fri Jan 09 2026 00:00:00 GMT+0800 (台北標準時間)"
  try {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      const y = String(dt.getFullYear());
      const mo = String(dt.getMonth() + 1).padStart(2, "0");
      const da = String(dt.getDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    }
  } catch {}

  return s || "—";
}

function setBusyHint(text) {
  setText(els.statusHint, text || "—");
}

function pickAny(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function parseRemaining(row) {
  const v = pickAny(row || {}, ["remaining", "剩餘", "remain"]);
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function parseAppointment(row) {
  const v = pickAny(row || {}, ["appointment", "預約", "booking", "appt", "bookingContent"]);
  return String(v ?? "").trim();
}

function formatRowLine(row) {
  if (!row) return { status: "—", rem: "—", appt: "—" };
  const status = String(pickAny(row, ["status", "狀態"]) || "—").trim() || "—";
  const remN = parseRemaining(row);
  const rem = remN === null ? "—" : `剩餘：${remN}`;
  const apptRaw = parseAppointment(row);
  const appt = apptRaw ? `預約：${apptRaw}` : "預約：—";
  return { status, rem, appt };
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

async function runQuery() {
  const t = normalizeTechNo(config.TARGET_TECH_NO);
  if (!t) throw new Error("CONFIG_TARGET_TECH_NO_MISSING");

  if (els.techNoInput) els.techNoInput.value = t;

  showEl(els.statusError, false);
  showEl(els.vacationError, false);

  setBusyHint("讀取中…");
  setText(els.lastUpdate, "讀取中…");
  setText(els.statusMeta, `師傅編號：${t}`);
  setText(els.vacationMeta, `師傅編號：${t}`);

  // 1) 狀態（即時）
  try {
    const startedAt = Date.now();
    const data = await fetchSheetAll();
    const ms = Date.now() - startedAt;

    const bodyRow = findRowByTechNo(data.bodyRows, t);
    const footRow = findRowByTechNo(data.footRows, t);

    const b = formatRowLine(bodyRow);
    const f = formatRowLine(footRow);

    setText(els.bodyStatus, b.status);
    setText(els.bodyRem, b.rem);
    setText(els.bodyAppt, b.appt);

    setText(els.footStatus, f.status);
    setText(els.footRem, f.rem);
    setText(els.footAppt, f.appt);

    setText(els.lastUpdate, `已更新（${data.source}，${ms}ms）`);
    setText(els.statusMeta, `師傅編號：${t}（來源：${data.source}）`);
  } catch (e) {
    console.error("[Status] fetch failed", e);
    showEl(els.statusError, true);
    setText(els.lastUpdate, "更新失敗");
  }

  // 2) 休假日（讀取）
  try {
    const holidays = await listHolidays();
    vacationState.holidaysSet = new Set((Array.isArray(holidays) ? holidays : []).map((d) => formatYmdForHumans(d)).filter(Boolean));

    // 初始化月曆月份
    if (typeof vacationState.viewYear !== "number" || typeof vacationState.viewMonth0 !== "number") {
      const now = new Date();
      vacationState.viewYear = now.getFullYear();
      vacationState.viewMonth0 = now.getMonth();
    }
    renderVacationCalendar();

    setText(els.vacationMeta, `師傅編號：${t}`);
  } catch (e) {
    console.error("[Vacation] fetch failed", e);
    showEl(els.vacationError, true);
    els.vacationError.textContent = String(e);
    vacationState.holidaysSet = new Set();
    renderVacationCalendar();
  }

  setBusyHint("完成");
}

async function main() {
  setBusyHint("載入設定…");
  await loadConfig();

  // Optional: LIFF init (does NOT replace existing auth flow).
  try {
    const info = await initLiffIfConfigured({ liffId: config.LIFF_ID, autoLogin: config.LIFF_AUTO_LOGIN });
    if (config.LIFF_PREFILL_GUEST_NAME && els.reqGuestName && !String(els.reqGuestName.value || "").trim()) {
      const dn = String(info && info.displayName ? info.displayName : "").trim();
      if (dn) els.reqGuestName.value = dn;
    }
  } catch (e) {
    console.warn("[LIFF] init ignored", e);
  }

  const authed = await ensureAuthorizedOrShowGate({
    masterId: config.TARGET_TECH_NO,
    authEndpoint: config.AUTH_ENDPOINT,
    gateEl: els.authGate,
    gateMsgEl: els.authGateMsg,
  });
  if (!authed) {
    // Hide secured content when not authorized.
    document.querySelectorAll('[data-secured="1"]').forEach((el) => {
      el.style.display = "none";
    });

    // Default: closed (fail-closed).
    showAuthRequestBlock(false);
    setAuthReqResult("—");

    // Only show the request panel when master is approved + enabled.
    try {
      const st = await getMasterOpenStatus({ authEndpoint: config.AUTH_ENDPOINT, masterId: config.TARGET_TECH_NO });
      if (!st.approved || !st.enabled) {
        setGateMessage(!st.approved ? "目前師傅尚未通過審核，看板暫不可使用。" : "目前師傅尚未開通個人狀態，看板暫不可使用。");
        return;
      }

      showAuthRequestBlock(true);
      els.reqSubmit?.addEventListener("click", submitAuthRequest_);
    } catch (e) {
      console.warn("[Auth] open_status failed", e);
      setGateMessage("目前暫不開放申請，請稍後再試。");
      return;
    }

    return;
  }

  initTheme_();

  if (els.techNoInput) els.techNoInput.value = config.TARGET_TECH_NO;
  els.refreshBtn?.addEventListener("click", () => runQuery());

  els.calPrev?.addEventListener("click", () => shiftVacationMonth(-1));
  els.calNext?.addEventListener("click", () => shiftVacationMonth(1));

  await runQuery();
}

main().catch((e) => {
  console.error("[Boot] failed", e);
  setBusyHint("初始化失敗");
  alert("初始化失敗：" + String(e));
});
