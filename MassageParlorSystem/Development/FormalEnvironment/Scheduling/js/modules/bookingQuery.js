/**
 * bookingQuery.js
 *
 * 預約查詢：呼叫 AUTH GAS（mode=bookingQuery_v1）取得 booking/detail 資料並渲染表格。
 */

import { config } from "./config.js";
import { dom } from "./dom.js";
import { state } from "./state.js";
import { logUsageEvent } from "./usageLog.js";

const HEADER_ZH = {
  bookingTime: "預約時間",
  bookingDetailId: "預約明細ID",
  id: "ID",
  bookingId: "預約單ID",
  storeId: "店ID",
  serviceName: "服務項目",
  period: "節數",
  time: "分鐘",
  remarks: "備註",
  techNo: "師傅編號",
  masterCode: "師傅編號",
  techno: "師傅編號",
  customerName: "客人姓名",
  customerPhone: "客人電話",
  roomName: "包廂",
  status: "狀態",
  createdAt: "建立時間",
  updatedAt: "更新時間",
};

const CORE_KEYS = [
  "bookingTime",
  "serviceName",
  "customerName",
  "roomName",
  "status",
  "period",
  "time",
  "remarks",
  "bookingId",
  "bookingDetailId",
];

function normalizeYesNo(v) {
  return String(v || "").trim() === "是" ? "是" : "否";
}

function formatBookingTimeNoSeconds(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?$/);
  if (m) return `${m[1]} ${m[2]}`;
  return s;
}

function setStatus_(text, tone) {
  if (!dom.bookingStatusEl) return;
  dom.bookingStatusEl.textContent = String(text || "");
  dom.bookingStatusEl.className = "badge" + (tone ? ` badge-${tone}` : "");
}

function setMeta_(text) {
  if (!dom.bookingMetaEl) return;
  dom.bookingMetaEl.textContent = String(text || "");
}

function clearTable_() {
  if (dom.bookingHeadRowEl) dom.bookingHeadRowEl.innerHTML = "";
  if (dom.bookingRowsEl) dom.bookingRowsEl.innerHTML = "";
}

function renderTable_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  clearTable_();

  if (!dom.bookingHeadRowEl || !dom.bookingRowsEl) return;

  if (!list.length) {
    dom.bookingRowsEl.innerHTML = `<tr><td colspan="8" style="color:var(--text-sub);">查無資料</td></tr>`;
    return;
  }

  // union keys (limit)
  const keySet = new Set();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    Object.keys(r).forEach((k) => k && keySet.add(k));
  }

  const presentCore = CORE_KEYS.filter((k) => keySet.has(k));
  const rest = [...keySet].filter((k) => !presentCore.includes(k)).sort((a, b) => String(a).localeCompare(String(b)));

  // UI 欄位過多會很難看：最多顯示 12 欄
  const keys = [...presentCore, ...rest].slice(0, 12);

  dom.bookingHeadRowEl.innerHTML = keys.map((k) => `<th>${HEADER_ZH[k] || k}</th>`).join("");

  const MAX_RENDER = 2000;
  const slice = list.slice(0, MAX_RENDER);

  dom.bookingRowsEl.innerHTML = slice
    .map((r) => {
      const tds = keys
        .map((k) => {
          let v = r ? r[k] : "";
          if (k === "bookingTime") v = formatBookingTimeNoSeconds(v);
          if (v === null || v === undefined) v = "";
          if (typeof v === "object") {
            try {
              v = JSON.stringify(v);
            } catch {
              v = String(v);
            }
          }
          return `<td>${String(v)}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  if (list.length > MAX_RENDER) {
    setMeta_(`顯示前 ${MAX_RENDER} 筆（共 ${list.length} 筆）`);
  }
}

async function postBookingQuery_({ userId, from, to }) {
  const payload = { mode: "bookingQuery_v1", userId, from, to };

  // ✅ Auth 只做開通/認證；查詢預約直接打 BOOKING_API_URL。
  // 若 Auth check 有回 storeId，優先帶 storeId；否則退回帶 techNo（師傅編號）讓後端推導 storeId。
  const storeId = String((state.user && state.user.storeId) || state.storeId || "").trim();
  const techNo = String((state.myMaster && state.myMaster.techNo) || "").trim();
  if (storeId) {
    payload.storeId = storeId;
    payload.bypassAccess = true;
  } else if (techNo) {
    payload.techNo = techNo;
    payload.bypassAccess = true;
  }

  const url = String(config.BOOKING_API_URL || "").trim();
  if (!url) throw new Error("BOOKING_API_URL_MISSING");

  const resp = await fetch(url, {
    method: "POST",
    // ✅ 不設 application/json，避免瀏覽器送 OPTIONS preflight（GAS 通常不回 CORS header）
    // 直接用 text/plain 送 JSON 字串；後端 doPost 有支援 raw 以 '{' 開頭的 JSON。
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error("BOOKING_HTTP_" + resp.status);
  return await resp.json();
}

function pickUserId_() {
  return String((state.user && state.user.userId) || state.userId || "").trim();
}

function todayKey_() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function ensureDefaultDates_() {
  const t = todayKey_();
  if (dom.bookingDateStartInput && !dom.bookingDateStartInput.value) dom.bookingDateStartInput.value = t;
  if (dom.bookingDateEndInput && !dom.bookingDateEndInput.value) dom.bookingDateEndInput.value = t;
}

export function initBookingUi() {
  if (!dom.bookingCardEl) return;

  ensureDefaultDates_();

  if (dom.bookingSearchBtn) {
    dom.bookingSearchBtn.addEventListener("click", async () => {
      await runBookingQueryOnce({ reason: "click" });
    });
  }
}

export function onShowBooking() {
  // 顯示時補日期預設
  ensureDefaultDates_();
}

export async function runBookingQueryOnce({ reason }) {
  const bookingOk = normalizeYesNo(state.feature && state.feature.bookingEnabled) === "是";
  if (!bookingOk) {
    setStatus_("預約查詢未開通", "warn");
    return;
  }

  if (!String(config.BOOKING_API_URL || "").trim()) {
    setStatus_("尚未設定 BOOKING_API_URL", "warn");
    setMeta_("請在 config.json 設定 BOOKING_API_URL（指向預約查詢 GAS Web App）。");
    return;
  }

  const userId = pickUserId_();
  const from = String((dom.bookingDateStartInput && dom.bookingDateStartInput.value) || "").trim();
  const to = String((dom.bookingDateEndInput && dom.bookingDateEndInput.value) || from || "").trim();

  if (!userId) {
    setStatus_("缺少 userId", "warn");
    return;
  }
  if (!from) {
    setStatus_("請選擇開始日期", "warn");
    return;
  }

  setStatus_("查詢中…", "");
  setMeta_("");
  clearTable_();

  try {
    const t0 = Date.now();
    const res = await postBookingQuery_({ userId, from, to });

    if (!res || res.ok !== true) {
      const err = (res && (res.error || res.message)) || "UNKNOWN";
      setStatus_("查詢失敗：" + err, "err");
      return;
    }

    const rows = Array.isArray(res.rows) ? res.rows : [];
    const total = typeof res.rowsCountTotal === "number" ? res.rowsCountTotal : rows.length;
    const ms = Date.now() - t0;

    setStatus_(`完成（${total} 筆）`, "ok");
    setMeta_(`${from} ~ ${to}`);
    renderTable_(rows);

    try {
      logUsageEvent({
        event: "booking_query",
        detail: JSON.stringify({ from, to, rowsCount: rows.length, cached: !!res.cached, reason: reason || "" }),
        eventCn: "預約查詢",
        noThrottle: true,
      });
    } catch {}
    // 發送前端事件，供同頁或外部 embedder 監聽（例如監控或整合）
    try {
      const evDetail = { from, to, rowsCount: rows.length, cached: !!res.cached, reason: reason || "" };
      try {
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("booking:queried", { detail: evDetail }));
        } else if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
          document.dispatchEvent(new CustomEvent("booking:queried", { detail: evDetail }));
        }
      } catch {}
    } catch {}
  } catch (e) {
    setStatus_("查詢失敗", "err");
    setMeta_(String(e && e.message ? e.message : e));
  }
}
