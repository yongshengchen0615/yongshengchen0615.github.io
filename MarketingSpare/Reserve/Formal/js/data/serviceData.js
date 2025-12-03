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
    const url = endpointUrl || (window.GAS_SERVICE_ENDPOINT || window.GAS_BASE_URL);
    if (!url) throw new Error("缺少 GAS 服務資料端點設定 (window.GAS_SERVICE_ENDPOINT 或 window.GAS_BASE_URL)");

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`載入服務資料失敗: ${res.status}`);
    let data = await res.json();
    // 支援 Apps Script 包裝格式 { ok: true, data: {...} }
    if (data && data.ok === true && data.data) data = data.data;

    // 基本驗證
    if (!data || typeof data !== "object") throw new Error("服務資料格式錯誤");
    mainServices = data.mainServices || {};
    addonServices = data.addonServices || {};

    return { mainServices, addonServices };
}
