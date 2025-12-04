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
    const base = endpointUrl || window.GAS_BASE_URL;
    if (!base) throw new Error("缺少 GAS Base URL 設定 (window.GAS_BASE_URL)");

    // 依你提供的 GAS：Config 以 Key/Value 列形式回傳，DateTypes 另行回傳陣列
    const cfgUrl = `${base}?entity=config&action=list`;
    const dtUrl = `${base}?entity=datetypes&action=list`;

    const [cfgRes, dtRes] = await Promise.all([
        fetch(cfgUrl, { method: "GET" }),
        fetch(dtUrl, { method: "GET" })
    ]);
    if (!cfgRes.ok) throw new Error(`載入預約設定失敗: ${cfgRes.status}`);
    if (!dtRes.ok) throw new Error(`載入日期類型失敗: ${dtRes.status}`);

    let cfgData = await cfgRes.json();
    let dtData = await dtRes.json();
    if (cfgData && cfgData.ok === true && cfgData.data) cfgData = cfgData.data; // map: {Key:Value}
    if (dtData && dtData.ok === true && dtData.data) dtData = dtData.data;     // array of row objects

    // 組合為前端期望結構
    const combined = mapConfigAndDateTypes(cfgData, dtData);

    // 暫存原始資料供除錯
    window.__RAW_CFG = combined;
    // 正規化
    bookingConfig = normalizeBookingConfig(combined);
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

function mapConfigAndDateTypes(cfgMap, dtRows) {
    // cfgMap: 由 GAS 轉出 Key-Value 物件，例如 { startTime: "09:00", endTime: "21:00", ... }
    // dtRows: DateTypes 工作表的列陣列，每列包含至少 { Type, Date }
    const out = {};
    // 將常用配置鍵轉為預期欄位名稱（保留大小寫差異）
    const getKey = (k, def) => {
        const v = cfgMap?.[k];
        if (v == null) return def;
        // 嘗試將數字字串轉數字
        const num = Number(v);
        return isNaN(num) ? v : num;
    };

    out.startTime = getKey('startTime', '09:00');
    out.endTime = getKey('endTime', '21:00');
    out.bufferMinutes = getKey('bufferMinutes', 60);
    out.maxBookingDays = getKey('maxBookingDays', 14);

    // breakPeriods 可能用 JSON 字串存於 Value
    const rawBreak = cfgMap?.breakPeriods;
    try {
        if (typeof rawBreak === 'string') {
            out.breakPeriods = JSON.parse(rawBreak);
        } else if (Array.isArray(rawBreak)) {
            out.breakPeriods = rawBreak;
        }
    } catch (_) {
        out.breakPeriods = [];
    }
    if (!Array.isArray(out.breakPeriods)) out.breakPeriods = [];

    // 將 DateTypes rows 整理為各類型陣列
    const dateTypes = { holiday: [], blockedDay: [], eventDay: [], halfDay: [], weeklyOff: [] };
    (Array.isArray(dtRows) ? dtRows : []).forEach(r => {
        const t = String(r.Type || '').trim();
        const d = r.Date;
        if (!t) return;
        switch (t) {
            case 'holiday':
                dateTypes.holiday.push(d);
                break;
            case 'blockedDay':
                dateTypes.blockedDay.push(d);
                break;
            case 'eventDay':
                dateTypes.eventDay.push(d);
                break;
            case 'halfDay':
                dateTypes.halfDay.push(d);
                break;
            case 'weeklyOff':
                // Date 欄位可存星期數字或以 Value 在 config 提供；此處盡可能轉數字
                if (d !== undefined && d !== null && d !== '') {
                    const n = Number(d);
                    if (!isNaN(n)) dateTypes.weeklyOff.push(n);
                }
                break;
            default:
                // 其他未知 Type 略過
                break;
        }
    });
    out.dateTypes = dateTypes;
    return out;
}
