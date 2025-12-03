// bookingConfig.js - 改為由 Google Apps Script 讀取遠端設定

// 以 let 匯出，允許初始化後填入遠端設定
export let bookingConfig = {};

// 從 Google Apps Script Web App 端點讀取設定
// 端點需回傳 JSON，格式例如：
// {
//   "startTime": "9:00",
//   "endTime": "21:00",
//   "bufferMinutes": 60,
//   "maxBookingDays": 14,
//   "breakPeriods": [{"start":"12:00","end":"13:00"}],
//   "dateTypes": {
//       "holiday": [...],
//       "weeklyOff": [0,6],
//       "blockedDay": [...],
//       "eventDay": [...],
//       "halfDay": [...]
//   }
// }
export async function loadBookingConfig(endpointUrl) {
    const url = endpointUrl || (window.GAS_CONFIG_ENDPOINT || window.GAS_BASE_URL);
    if (!url) throw new Error("缺少 GAS 設定端點設定 (window.GAS_CONFIG_ENDPOINT 或 window.GAS_BASE_URL)");

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`載入預約設定失敗: ${res.status}`);
    let data = await res.json();
    // 支援 Apps Script 包裝格式 { ok: true, data: {...} }
    if (data && data.ok === true && data.data) data = data.data;

    if (!data || typeof data !== "object") throw new Error("預約設定資料格式錯誤");
    // 暫存原始資料供除錯
    window.__RAW_CFG = data;
    console.log("[cfg raw]", data);
    // 前端正規化：將 dateTypes 的日期統一為 YYYY-MM-DD 字串
    bookingConfig = normalizeBookingConfig(data);
    console.log("[cfg normalized]", bookingConfig);
    return bookingConfig;
}

function normalizeBookingConfig(cfg) {
    const out = { ...cfg };
    const dt = cfg.dateTypes || {};
    function padHHmm(s) {
        // 寬鬆解析：支援字串、數字、Date；輸出標準 HH:mm
        if (s == null) return undefined;
        if (s instanceof Date) {
            const h = String(s.getHours()).padStart(2, "0");
            const m = String(s.getMinutes()).padStart(2, "0");
            return `${h}:${m}`;
        }
        if (typeof s === "number") {
            // 視為分鐘數或整點小時（優先解讀為分鐘數）
            const mins = Number(s);
            if (!isNaN(mins)) {
                const h = String(Math.floor(mins / 60)).padStart(2, "0");
                const m = String(mins % 60).padStart(2, "0");
                return `${h}:${m}`;
            }
        }
        let str = String(s).trim();
        // 若是 ISO 日期時間字串（含 'T'），嘗試用 Date 解析取 HH:mm
        if (str.includes('T')) {
            const d = new Date(str);
            if (!isNaN(d)) {
                const h = String(d.getHours()).padStart(2, "0");
                const m = String(d.getMinutes()).padStart(2, "0");
                return `${h}:${m}`;
            }
        }
        // 支援 "H:m" / "HH:mm"
        const parts = str.split(":");
        if (parts.length !== 2) return str; // 交由後續檢查
        const h = String(parts[0]).padStart(2, "0");
        const m = String(parts[1]).padStart(2, "0");
        return `${h}:${m}`;
    }
    function normalizeDateStr(s) {
        if (s == null) return s;
        // 嘗試用 Date 解析，成功則轉 YYYY-MM-DD；失敗則回傳原字串去空白
        const d = new Date(s);
        if (!isNaN(d)) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
        }
        return String(s).trim();
    }

    const norm = {
        holiday: Array.isArray(dt.holiday) ? dt.holiday.map(normalizeDateStr) : [],
        blockedDay: Array.isArray(dt.blockedDay) ? dt.blockedDay.map(normalizeDateStr) : [],
        eventDay: Array.isArray(dt.eventDay) ? dt.eventDay.map(normalizeDateStr) : [],
        halfDay: Array.isArray(dt.halfDay) ? dt.halfDay.map(normalizeDateStr) : [],
        weeklyOff: Array.isArray(dt.weeklyOff) ? dt.weeklyOff.map(n => Number(n)).filter(n => !isNaN(n)) : [],
    };
    out.dateTypes = norm;
    // breakPeriods 標準化（支援字串、數字、Date）
    if (Array.isArray(out.breakPeriods)) {
        out.breakPeriods = out.breakPeriods
            .map(p => {
                const start = padHHmm(p.start);
                const end = padHHmm(p.end);
                return { start: String(start || "").trim(), end: String(end || "").trim() };
            })
            .filter(p => /^\d{1,2}:\d{2}$/.test(p.start) && /^\d{1,2}:\d{2}$/.test(p.end));
    } else {
        out.breakPeriods = [];
    }
    // 其他欄位安全預設
    out.startTime = padHHmm(out.startTime || "09:00");
    out.endTime = padHHmm(out.endTime || "21:00");
    out.bufferMinutes = Number(out.bufferMinutes ?? 60);
    out.maxBookingDays = Number(out.maxBookingDays ?? 14);
    return out;
}
