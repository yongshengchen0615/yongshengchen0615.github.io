// serviceData.js - 改為由 Google Apps Script 讀取遠端資料

// 以 let 匯出，允許在初始化後填入遠端資料
export let mainServices = {};
export let addonServices = {};

// 從 Google Apps Script Web App 端點讀取服務資料
// 端點需回傳 JSON，格式例如：
// {
//   "mainServices": { "服務名稱": {"time": 70, "price": 1100, "type": "分類"}, ... },
//   "addonServices": { "加購名稱": {"time": 20, "price": 450, "type": "加購服務"}, ... }
// }
export async function loadServiceData(endpointUrl) {
    const base = endpointUrl || window.GAS_BASE_URL;
    if (!base) throw new Error("缺少 GAS Base URL 設定 (window.GAS_BASE_URL)");
    const url = `${base}?entity=services&action=list`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`載入服務資料失敗: ${res.status}`);
    let data = await res.json();
    // 支援 Apps Script 包裝格式 { ok: true, data: {...} }
    if (data && data.ok === true && data.data) data = data.data;

    // 從 GAS 讀回的是列資料陣列（每列為物件），需轉為 main/addon 兩個 map
    if (!Array.isArray(data)) throw new Error("服務資料格式錯誤（預期為陣列）");
    const mainMap = {};
    const addonMap = {};
    data.forEach(row => {
        const name = String(row.ServiceName || '').trim();
        if (!name) return;
        const time = Number(row.TimeMinutes || row.time || 0);
        const price = Number(row.Price || row.price || 0);
        const type = row.Type || row.type || '';
        const isAddon = String(row.IsAddon || row.isAddon || '').toLowerCase();
        const entry = { time, price, type };
        if (isAddon === 'true' || isAddon === '1') {
            addonMap[name] = entry;
        } else {
            mainMap[name] = entry;
        }
    });

    mainServices = mainMap;
    addonServices = addonMap;
    return { mainServices, addonServices };
}
