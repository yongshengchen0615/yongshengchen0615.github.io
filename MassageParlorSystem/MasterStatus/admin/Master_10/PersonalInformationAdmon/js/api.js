// js/api.js

function getEndpoint() {
  const ep = String(window.RUNTIME_ENDPOINT || "").trim();
  if (!ep || !/^https:\/\/script.google.com\/.+\/exec$/.test(ep)) {
    throw new Error("ENDPOINT 尚未初始化（Gate 通過後應由 getDateDbEndpoint 注入）");
  }
  return ep;
}

function getUserId() {
  return String(window.RUNTIME_USER_ID || "").trim();
}

async function apiGet(params) {
  const ep = getEndpoint();
  const userId = getUserId();

  const finalParams = { ...(params || {}) };
  if (userId) finalParams.userId = userId; // ✅可選：讓 DateDB 端做 ACL

  const url = ep + "?" + new URLSearchParams(finalParams).toString();
  const res = await fetch(url, { method: "GET" });
  return res.json();
}

async function apiPost(payload) {
  const ep = getEndpoint();
  const userId = getUserId();

  const finalPayload = { ...(payload || {}) };
  if (userId) finalPayload.userId = userId; // ✅可選：讓 DateDB 端做 ACL

  const res = await fetch(ep, { method: "POST", body: JSON.stringify(finalPayload) });
  return res.json();
}

window.LocalState = { datetypes: [] };
window.Pending = { config: {}, holidaysAdd: [], holidaysDel: [] };

window.apiGet = apiGet;
window.apiPost = apiPost;
