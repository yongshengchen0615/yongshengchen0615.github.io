// js/api.js

const ENDPOINT =
  "https://script.google.com/macros/s/AKfycbyDLxx5tINOCerjzpH3_dhxBCDR_SGw-bLatqLpcLgbx01ds3UJ0nJPCy7rkDhimxYvVw/exec";

function getEndpoint() {
  if (!ENDPOINT || !/^https:\/\/script.google.com\/.+\/exec$/.test(ENDPOINT)) {
    throw new Error("請先在程式碼中設定正確的 ENDPOINT");
  }
  return ENDPOINT;
}

async function apiGet(params) {
  const ep = getEndpoint();
  const url = ep + "?" + new URLSearchParams(params).toString();
  const res = await fetch(url, { method: "GET" });
  return res.json();
}

async function apiPost(payload) {
  const ep = getEndpoint();
  // 不設置 Content-Type: application/json，避免 CORS 預檢
  const res = await fetch(ep, { method: "POST", body: JSON.stringify(payload) });
  return res.json();
}

// 本地狀態（只抓 holiday 用）
window.LocalState = {
  datetypes: [], // 仍沿用 datetypes/list，但只渲染 holiday
};

// 暫存所有變更，儲存時一次送出
window.Pending = {
  config: {},
  holidaysAdd: [],
  holidaysDel: [],
};

window.apiGet = apiGet;
window.apiPost = apiPost;
