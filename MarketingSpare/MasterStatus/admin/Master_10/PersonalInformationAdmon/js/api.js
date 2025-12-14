// js/api.js

// 在此直接設定 Apps Script Web App URL（請修改為你的 /exec 連結）：
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
  // 不設置 Content-Type: application/json，避免 CORS 預檢；Apps Script 仍可讀取 postData.contents
  const res = await fetch(ep, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}

// 本地狀態（只在首次載入時從後端抓取一次）
window.LocalState = {
  datetypes: [],
  services: [],
};

// 暫存所有變更，儲存時一次送出
window.Pending = {
  config: {},
  datetypesAdd: [],
  datetypesDel: [],
  servicesAdd: [],
  servicesUpdate: [],
  servicesDel: [],
};

// 讓其他檔案可用（如果你習慣全域）
window.apiGet = apiGet;
window.apiPost = apiPost;
