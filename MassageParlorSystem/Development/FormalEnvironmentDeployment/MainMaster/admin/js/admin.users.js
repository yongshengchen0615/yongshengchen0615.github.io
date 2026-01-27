/* ================================
 * Admin - Users/技師資料管理（不嵌入、不外連）
 * - 直接使用 Users API（API_BASE_URL）
 * - 提供：查詢/篩選/勾選/批次套用/批次刪除/儲存全部
 * ================================ */

/** @type {any[]} */
let uAll = [];
/** @type {any[]} */
let uFiltered = [];

// 快速索引：避免大量互動時重複 uAll.find O(n)
const uById = new Map();

const uSelectedIds = new Set();
const uOriginalMap = new Map();
const uDirtyMap = new Map();

let uSavingAll = false;

// KPI 統計快取：避免搜尋輸入時重複 O(n) 計算
let uKpiDirty = true;
let uKpiRaf = 0;

function uInvalidateKpi_() {
  uKpiDirty = true;
  if (uKpiRaf) return;
  uKpiRaf = requestAnimationFrame(() => {
    uKpiRaf = 0;
    if (!uKpiDirty) return;
    uUpdateKpi_();
    uKpiDirty = false;
  });
}

const U_VIEW_ENUM = ["all", "usage", "master", "features"];
let uCurrentView = localStorage.getItem("users_view") || "usage";

let pushingNow = false;

function uSetTbodyMessage_(msg) {
  const tbody = document.getElementById("uTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="16">${escapeHtml(msg || "-")}</td></tr>`;
}

function uNormalizeYesNo_(v) {
  const s = String(v ?? "").trim();
  return s === "是" ? "是" : "否";
}

function uSnapshot_(u) {
  return JSON.stringify({
    userId: String(u.userId || ""),
    audit: normalizeAudit_(u.audit),
    startDate: String(u.startDate || ""),
    usageDays: String(u.usageDays || ""),
    masterCode: String(u.masterCode || ""),
    pushEnabled: uNormalizeYesNo_(u.pushEnabled || "否"),
    personalStatusEnabled: uNormalizeYesNo_(u.personalStatusEnabled || "否"),
    scheduleEnabled: uNormalizeYesNo_(u.scheduleEnabled || "否"),
    performanceEnabled: uNormalizeYesNo_(u.performanceEnabled || "否"),
  });
}

function uMarkDirty_(userId, u) {
  const orig = uOriginalMap.get(userId) || "";
  const now = uSnapshot_(u);
  if (orig !== now) uDirtyMap.set(userId, true);
  else uDirtyMap.delete(userId);
}

function uSetFooter_(text) {
  const el = document.getElementById("uFooterStatus");
  if (el) el.textContent = String(text || "-");
}

function uSetText_(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text ?? "-");
}

function uUpdateKpi_() {
  const total = uAll.length;
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let disabled = 0;
  let maintenance = 0;

  for (const u of uAll) {
    const audit = normalizeAudit_(u.audit);
    if (audit === "通過") approved += 1;
    else if (audit === "待審核") pending += 1;
    else if (audit === "拒絕") rejected += 1;
    else if (audit === "停用") disabled += 1;
    else if (audit === "系統維護") maintenance += 1;
  }

  uSetText_("uKpiTotal", total || 0);
  uSetText_("uKpiApproved", approved);
  uSetText_("uKpiPending", pending);
  uSetText_("uKpiRejected", rejected);
  uSetText_("uKpiDisabled", disabled);
  uSetText_("uKpiMaintenance", maintenance);
}

function uRefreshSaveBtn_() {
  const btn = document.getElementById("uSaveAllBtn");
  if (!btn) return;
  const n = uDirtyMap.size;
  btn.disabled = uSavingAll || n === 0;
  btn.textContent = uSavingAll ? "儲存中..." : n ? `儲存 Users 變更（${n}）` : "儲存 Users 變更";
}

function uSetLock_(locked) {
  const ids = [
    "uReloadBtn",
    "uSaveAllBtn",
    "uSearchInput",
    "uClearSearchBtn",
    "uCheckAll",
    "uBulkClear",
    "uBulkAudit",
    "uBulkPush",
    "uBulkPersonalStatus",
    "uBulkScheduleEnabled",
    "uBulkPerformanceEnabled",
    "uBulkUsageDays",
    "uBulkStartDate",
    "uBulkApply",
    "uBulkDelete",

    // push panel (client-compatible ids)
    "pushTarget",
    "pushSingleUserId",
    "pushIncludeName",
    "pushMessage",
    "pushSendBtn",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });

  document.querySelectorAll(".u-chip").forEach((el) => (el.disabled = locked));
  document.querySelectorAll("#viewTabs .viewtab").forEach((el) => (el.disabled = locked));
  document.getElementById("uTbody")?.querySelectorAll("input, select, button").forEach((el) => (el.disabled = locked));

  pushSetEnabled_(!locked);
}

function uUsersSection_() {
  return document.querySelector('section[aria-label="Users/技師資料管理"]');
}

function uEnsureViewTabs_() {
  const sec = uUsersSection_();
  const head = sec?.querySelector(".panel-head");
  if (!head) return;
  if (document.getElementById("viewTabs")) return;

  const wrap = document.createElement("div");
  wrap.className = "viewtabs";
  wrap.id = "viewTabs";
  wrap.innerHTML = `
    <button class="viewtab" data-view="all" type="button">全部欄位</button>
    <button class="viewtab" data-view="usage" type="button">使用/審核</button>
    <button class="viewtab" data-view="master" type="button">師傅資訊</button>
    <button class="viewtab" data-view="features" type="button">功能開通</button>
  `;
  head.appendChild(wrap);

  wrap.addEventListener("click", (e) => {
    if (uSavingAll) return;
    const btn = e.target instanceof Element ? e.target.closest("button.viewtab") : null;
    if (!btn) return;
    const v = btn.dataset.view;
    if (!U_VIEW_ENUM.includes(v)) return;
    uCurrentView = v;
    localStorage.setItem("users_view", uCurrentView);
    uApplyView_();
  });

  if (!U_VIEW_ENUM.includes(uCurrentView)) uCurrentView = "usage";
  uApplyView_();
}

function uApplyView_() {
  document.querySelectorAll("#viewTabs .viewtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === uCurrentView);
    b.disabled = uSavingAll;
  });

  const table = document.getElementById("uUsersTable");
  if (table) table.setAttribute("data-view", uCurrentView);
}

function ensurePushPanel_() {
  const sec = uUsersSection_();
  const panelHead = sec?.querySelector(".panel-head");
  if (!panelHead) return;
  if (document.getElementById("pushPanel")) return;

  const wrap = document.createElement("div");
  wrap.id = "pushPanel";
  wrap.style.flex = "0 0 100%";
  wrap.style.width = "100%";
  wrap.style.marginTop = "10px";

  wrap.innerHTML = `
    <div class="pushbar">
      <div class="pushbar-left">
        <span class="bulk-pill" style="border-color:rgba(147,51,234,.35); background:rgba(147,51,234,.12); color:rgb(167,139,250);">
          推播
        </span>

        <div class="bulk-group">
          <label class="bulk-label" for="pushTarget">對象</label>
          <select id="pushTarget" class="select">
            <option value="selected">選取的（勾選）</option>
            <option value="filtered">目前篩選結果</option>
            <option value="all">全部</option>
            <option value="single">單一 userId</option>
          </select>
        </div>

        <div class="bulk-group" id="pushSingleWrap" style="display:none;">
          <label class="bulk-label" for="pushSingleUserId">userId</label>
          <input id="pushSingleUserId" class="select push-single" type="text" placeholder="貼上 userId（LINE userId）" />
        </div>

        <div class="bulk-group">
          <label class="bulk-label" style="user-select:none;">displayName 前綴</label>
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text); user-select:none;">
            <input id="pushIncludeName" type="checkbox" />
            加上 displayName
          </label>
        </div>
      </div>

      <div class="pushbar-right">
        <div class="bulk-group" style="flex:1; width:100%;">
          <input id="pushMessage" class="select push-message" type="text" placeholder="輸入要推播的訊息…" />
        </div>
        <button id="pushSendBtn" class="btn primary" type="button">送出推播</button>
      </div>
    </div>
  `;

  panelHead.appendChild(wrap);

  const targetSel = document.getElementById("pushTarget");
  const singleWrap = document.getElementById("pushSingleWrap");

  targetSel?.addEventListener("change", () => {
    const v = targetSel.value;
    if (singleWrap) singleWrap.style.display = v === "single" ? "" : "none";
  });

  document.getElementById("pushSendBtn")?.addEventListener("click", async () => {
    if (uSavingAll || pushingNow) return;
    await pushSend_();
  });

  pushSetEnabled_(!uSavingAll);
}

function setDisabledByIds_(ids, disabled) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function pushSetEnabled_(enabled) {
  const lock = !enabled || pushingNow;
  setDisabledByIds_(["pushTarget", "pushSingleUserId", "pushIncludeName", "pushMessage", "pushSendBtn"], lock);

  const btn = document.getElementById("pushSendBtn");
  if (btn) btn.textContent = pushingNow ? "推播中…" : "送出推播";
}

function buildPushTargetIds_(target) {
  if (target === "single") {
    const uid = String(document.getElementById("pushSingleUserId")?.value || "").trim();
    return uid ? [uid] : [];
  }
  if (target === "selected") return Array.from(uSelectedIds);
  if (target === "filtered") return uFiltered.map((u) => String(u.userId || "")).filter(Boolean);
  if (target === "all") return uAll.map((u) => String(u.userId || "")).filter(Boolean);
  return [];
}

async function pushMessageBatch_(userIds, message, includeDisplayName) {
  if (!API_BASE_URL) throw new Error("API_BASE_URL not initialized");

  const res = await fetch(API_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      mode: "pushMessage",
      userIds,
      message,
      includeDisplayName: includeDisplayName ? "是" : "否",
    }),
  });

  return await res.json().catch(() => ({}));
}

async function pushSend_() {
  const target = String(document.getElementById("pushTarget")?.value || "selected");
  const includeDisplayName = !!document.getElementById("pushIncludeName")?.checked;
  const message = String(document.getElementById("pushMessage")?.value || "").trim();

  if (!message) {
    toast("請輸入推播內容", "err");
    return;
  }

  const userIds = buildPushTargetIds_(target);
  if (!userIds.length) {
    toast(target === "selected" ? "請先勾選要推播的使用者" : "找不到推播對象", "err");
    return;
  }

  const n = userIds.length;
  const warn = includeDisplayName ? "⚠️ 勾選 displayName 前綴：後端可能需要逐人處理（較慢）。\n\n" : "";
  if (target === "all" || target === "filtered" || n > 30) {
    const ok = confirm(`即將推播給 ${n} 位使用者。\n\n${warn}確定要送出嗎？`);
    if (!ok) return;
  }

  pushingNow = true;
  pushSetEnabled_(false);

  try {
    const ret = await pushMessageBatch_(userIds, message, includeDisplayName);
    const okCount = Number(ret?.okCount || 0);
    const failCount = Number(ret?.failCount || 0);

    if (failCount === 0) toast(`推播完成：成功 ${okCount} 筆`, "ok");
    else toast(`推播完成：成功 ${okCount} / 失敗 ${failCount}`, "err");

    if (ret?.fail?.length) console.warn("push fail:", ret.fail);
  } catch (e) {
    console.error("pushSend error:", e);
    toast("推播失敗（請看 console）", "err");
  } finally {
    pushingNow = false;
    pushSetEnabled_(!uSavingAll);
  }
}

function uGetExpiryInfo_(u) {
  if (!u.startDate || !u.usageDays) return { cls: "unset", text: "未設定" };

  const start = new Date(String(u.startDate) + "T00:00:00");
  if (isNaN(start.getTime())) return { cls: "unset", text: "未設定" };

  const usage = Number(u.usageDays);
  if (!Number.isFinite(usage) || usage <= 0) return { cls: "unset", text: "未設定" };

  const last = new Date(start.getTime() + (usage - 1) * 86400000);
  last.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = Math.floor((last - today) / 86400000);

  if (diff < 0) return { cls: "expired", text: `已過期（超 ${Math.abs(diff)} 天）` };
  return { cls: "active", text: `使用中（剩 ${diff} 天）` };
}

function uUpdateBulkBar_() {
  const bar = document.getElementById("uBulkBar");
  const count = document.getElementById("uBulkCount");
  if (!bar || !count) return;

  const n = uSelectedIds.size;
  bar.hidden = n === 0;
  count.textContent = `已選取 ${n} 筆`;
}

function uSyncCheckAll_() {
  const checkAll = document.getElementById("uCheckAll");
  if (!checkAll) return;

  const total = uFiltered.length;
  const sel = uFiltered.filter((x) => uSelectedIds.has(String(x.userId || ""))).length;

  checkAll.checked = total > 0 && sel === total;
  checkAll.indeterminate = sel > 0 && sel < total;
}

function uApplyFilters_() {
  const keywordRaw = String(document.getElementById("uSearchInput")?.value || "")
    .trim()
    .toLowerCase();

  const searchBox = document.getElementById("uSearchInput")?.closest(".search-box");
  if (searchBox) searchBox.classList.toggle("is-searching", !!keywordRaw);

  const active = document.querySelector(".u-chip.active");
  const filter = active ? String(active.dataset.filter || "ALL") : "ALL";

  uFiltered = uAll.filter((u) => {
    const audit = normalizeAudit_(u.audit);
    if (filter !== "ALL" && audit !== filter) return false;

    if (keywordRaw) {
      const hay = `${u.userId} ${u.displayName || ""} ${u.masterCode || ""}`.toLowerCase();
      if (!hay.includes(keywordRaw)) return false;
    }
    return true;
  });

  uRender_();
  uSyncCheckAll_();
  uUpdateBulkBar_();
  uRefreshSaveBtn_();
  uInvalidateKpi_();
}

function uAuditOption_(value, current) {
  const sel = value === current ? "selected" : "";
  return `<option value="${value}" ${sel}>${value}</option>`;
}

function uAuditClass_(audit) {
  switch (normalizeAudit_(audit)) {
    case "通過":
      return "approved";
    case "待審核":
      return "pending";
    case "拒絕":
      return "rejected";
    case "停用":
      return "disabled";
    case "系統維護":
      return "maintenance";
    default:
      return "other";
  }
}

function uRender_() {
  const tbody = document.getElementById("uTbody");
  if (!tbody) return;
  if (!uFiltered.length) {
    tbody.innerHTML = `<tr><td colspan="16">無資料</td></tr>`;
    return;
  }

  const rowsHtml = uFiltered
    .map((u, i) => {
      const userId = String(u.userId || "");
      const audit = normalizeAudit_(u.audit);

      const expiry = uGetExpiryInfo_(u);

      const pushEnabled = uNormalizeYesNo_(u.pushEnabled || "否");
      const personalStatusEnabled = uNormalizeYesNo_(u.personalStatusEnabled || "否");
      const scheduleEnabled = uNormalizeYesNo_(u.scheduleEnabled || "否");
      const performanceEnabled = uNormalizeYesNo_(u.performanceEnabled || "否");

      const isDirty = uDirtyMap.has(userId);
      const pushDisabled = audit !== "通過" ? "disabled" : "";

      return `
        <tr data-userid="${escapeHtml(userId)}" class="${isDirty ? "dirty" : ""}">
          <td class="sticky-col col-check" data-label="選取">
            <input class="u-row-check" type="checkbox" ${uSelectedIds.has(userId) ? "checked" : ""} aria-label="選取此列">
          </td>
          <td data-label="#">${i + 1}</td>
          <td data-label="userId"><span class="mono">${escapeHtml(userId)}</span></td>
          <td data-label="顯示名稱">${escapeHtml(u.displayName || "")}</td>
          <td data-label="建立時間"><span class="mono">${escapeHtml(u.createdAt || "")}</span></td>

          <td data-label="開始使用">
            <input type="date" data-field="startDate" value="${escapeHtml(u.startDate || "")}">
          </td>
          <td data-label="期限(天)">
            <input type="number" min="1" data-field="usageDays" value="${escapeHtml(u.usageDays || "")}">
          </td>

          <td data-label="使用狀態">
            <span class="expiry-pill ${expiry.cls}">${escapeHtml(expiry.text)}</span>
          </td>

          <td data-label="審核狀態">
            <select data-field="audit" aria-label="審核狀態">
              ${AUDIT_ENUM.map((v) => uAuditOption_(v, audit)).join("")}
            </select>
            <span class="audit-badge ${uAuditClass_(audit)}">${escapeHtml(audit)}</span>
          </td>

          <td data-label="師傅編號">
            <input type="text" data-field="masterCode" placeholder="師傅編號" value="${escapeHtml(u.masterCode || "")}">
          </td>

          <td data-label="是否師傅" class="u-is-master">${u.masterCode ? "是" : "否"}</td>

          <td data-label="是否推播">
            <select data-field="pushEnabled" aria-label="是否推播" ${pushDisabled}>
              <option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
              <option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
            </select>
          </td>

          <td data-label="個人狀態開通">
            <select data-field="personalStatusEnabled" aria-label="個人狀態開通">
              <option value="否" ${personalStatusEnabled === "否" ? "selected" : ""}>否</option>
              <option value="是" ${personalStatusEnabled === "是" ? "selected" : ""}>是</option>
            </select>
          </td>

          <td data-label="排班表開通">
            <select data-field="scheduleEnabled" aria-label="排班表開通">
              <option value="否" ${scheduleEnabled === "否" ? "selected" : ""}>否</option>
              <option value="是" ${scheduleEnabled === "是" ? "selected" : ""}>是</option>
            </select>
          </td>

          <td data-label="業績開通">
            <select data-field="performanceEnabled" aria-label="業績開通">
              <option value="否" ${performanceEnabled === "否" ? "selected" : ""}>否</option>
              <option value="是" ${performanceEnabled === "是" ? "selected" : ""}>是</option>
            </select>
          </td>

          <td data-label="操作">
            <div class="actions">
              ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : ``}
              <button class="btn danger u-btn-del" type="button">刪除</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = rowsHtml;
  if (uSavingAll) {
    tbody.querySelectorAll("input, select, button").forEach((el) => (el.disabled = true));
  }
}

async function uApiListUsers_() {
  if (!API_BASE_URL) throw new Error("API_BASE_URL not initialized");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);

  try {
    const res = await fetch(API_BASE_URL + "?mode=listUsers", { cache: "no-store", signal: ctrl.signal });
    return await res.json().catch(() => ({}));
  } finally {
    clearTimeout(t);
  }
}

async function uApiUpdateUsersBatch_(items) {
  const res = await fetch(API_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ mode: "updateUsersBatch", items }),
  });
  return await res.json().catch(() => ({}));
}

async function uApiDeleteUser_(userId) {
  const fd = new URLSearchParams();
  fd.append("mode", "deleteUser");
  fd.append("userId", String(userId || ""));
  const res = await fetch(API_BASE_URL, { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  return !!json.ok;
}

async function uLoadUsers_() {
  try {
    uSetLock_(true);
    uSetFooter_("載入中...");
    uSetTbodyMessage_("載入中...");

    const json = await uApiListUsers_();
    if (!json || !json.ok) throw new Error(json?.error || "listUsers not ok");

    uAll = (json.users || []).map((u) => ({
      ...u,
      audit: normalizeAudit_(u.audit),
      pushEnabled: uNormalizeYesNo_(u.pushEnabled || "否"),
      personalStatusEnabled: uNormalizeYesNo_(u.personalStatusEnabled || "否"),
      scheduleEnabled: uNormalizeYesNo_(u.scheduleEnabled || "否"),
      performanceEnabled: uNormalizeYesNo_(u.performanceEnabled || "否"),
    }));

    uById.clear();
    for (const u of uAll) uById.set(String(u.userId || ""), u);

    // 先更新 KPI（即使後續流程失敗也能看到人數）
    uInvalidateKpi_();

    uOriginalMap.clear();
    uDirtyMap.clear();
    uSelectedIds.clear();
    for (const u of uAll) uOriginalMap.set(String(u.userId || ""), uSnapshot_(u));

    uApplyFilters_();
    toast("Users 資料已更新", "ok");
  } catch (e) {
    console.error(e);
    toast("Users 讀取失敗", "err");
    const errMsg = e?.name === "AbortError" ? "Users 讀取逾時（15s）" : `Users 讀取失敗：${String(e?.message || e)}`;
    uSetFooter_(errMsg);
    uSetTbodyMessage_(errMsg);
  } finally {
    uSetLock_(false);
    uRefreshSaveBtn_();
  }
}

function uGetById_(userId) {
  const id = String(userId || "");
  if (!id) return undefined;
  return uById.get(id) || uAll.find((x) => String(x.userId || "") === id);
}

function uUpdateRowDirtyUI_(row, userId) {
  row?.classList.toggle("dirty", uDirtyMap.has(userId));
  uRefreshSaveBtn_();
}

async function uBulkApply_() {
  if (uSavingAll) return;

  let audit = String(document.getElementById("uBulkAudit")?.value || "").trim();
  let pushEnabled = String(document.getElementById("uBulkPush")?.value || "").trim();
  let personalStatusEnabled = String(document.getElementById("uBulkPersonalStatus")?.value || "").trim();
  let scheduleEnabled = String(document.getElementById("uBulkScheduleEnabled")?.value || "").trim();
  let performanceEnabled = String(document.getElementById("uBulkPerformanceEnabled")?.value || "").trim();
  let usageDaysRaw = String(document.getElementById("uBulkUsageDays")?.value || "").trim();
  let startDate = String(document.getElementById("uBulkStartDate")?.value || "").trim();

  const usageDays = usageDaysRaw ? Number(usageDaysRaw) : null;
  if (usageDaysRaw && (!Number.isFinite(usageDays) || usageDays <= 0)) {
    toast("批次期限(天) 請輸入大於 0 的數字", "err");
    return;
  }

  if (startDate) {
    const dt = new Date(startDate + "T00:00:00");
    if (isNaN(dt.getTime())) {
      toast("批次開始使用日期格式不正確", "err");
      return;
    }
  }

  if (!audit && !pushEnabled && !personalStatusEnabled && !scheduleEnabled && !performanceEnabled && !usageDaysRaw && !startDate) {
    toast("請先選擇要套用的批次欄位", "err");
    return;
  }

  const ids = Array.from(uSelectedIds);
  if (!ids.length) return;

  ids.forEach((id) => {
    const u = uGetById_(id);
    if (!u) return;

    if (audit) u.audit = normalizeAudit_(audit);
    if (startDate) u.startDate = startDate;
    if (usageDaysRaw) u.usageDays = String(usageDays);
    if (personalStatusEnabled) u.personalStatusEnabled = personalStatusEnabled;
    if (scheduleEnabled) u.scheduleEnabled = scheduleEnabled;
    if (performanceEnabled) u.performanceEnabled = performanceEnabled;

    // 審核非通過，推播強制關閉
    if (normalizeAudit_(u.audit) !== "通過") u.pushEnabled = "否";
    else if (pushEnabled) u.pushEnabled = pushEnabled;

    uMarkDirty_(id, u);
  });

  uApplyFilters_();
  toast("已套用到選取（尚未儲存）", "ok");
}

async function uBulkDelete_() {
  if (uSavingAll) return;

  const ids = Array.from(uSelectedIds);
  if (!ids.length) return;

  const okConfirm = confirm(`確定要批次刪除？\n\n共 ${ids.length} 筆。\n此操作不可復原。`);
  if (!okConfirm) return;

  const dirtySelected = ids.filter((id) => uDirtyMap.has(id)).length;
  if (dirtySelected) {
    const ok2 = confirm(`注意：選取中有 ${dirtySelected} 筆「未儲存」的更動。\n仍要繼續刪除嗎？`);
    if (!ok2) return;
  }

  uSetLock_(true);

  let okCount = 0;
  let failCount = 0;

  try {
    for (const id of ids) {
      const ok = await uApiDeleteUser_(id).catch(() => false);
      ok ? okCount++ : failCount++;
      await sleep_(80);
    }

    uSelectedIds.clear();

    toast(
      failCount === 0 ? `批次刪除完成：${okCount} 筆` : `批次刪除：成功 ${okCount} / 失敗 ${failCount}`,
      failCount ? "err" : "ok"
    );

    await uLoadUsers_();
  } finally {
    uSetLock_(false);
  }
}

async function uSaveAllDirty_() {
  const dirtyIds = Array.from(uDirtyMap.keys());
  if (!dirtyIds.length) return toast("目前沒有需要儲存的變更", "ok");

  uSavingAll = true;
  uSetLock_(true);
  uRefreshSaveBtn_();

  try {
    const items = dirtyIds
      .map((id) => uGetById_(id))
      .filter(Boolean)
      .map((u) => {
        const finalAudit = normalizeAudit_(u.audit);
        const finalPush = finalAudit !== "通過" ? "否" : uNormalizeYesNo_(u.pushEnabled || "否");
        return {
          userId: String(u.userId || ""),
          audit: finalAudit,
          startDate: String(u.startDate || ""),
          usageDays: String(u.usageDays || ""),
          masterCode: String(u.masterCode || ""),
          pushEnabled: finalPush,
          personalStatusEnabled: uNormalizeYesNo_(u.personalStatusEnabled || "否"),
          scheduleEnabled: uNormalizeYesNo_(u.scheduleEnabled || "否"),
          performanceEnabled: uNormalizeYesNo_(u.performanceEnabled || "否"),
        };
      });

    uSetFooter_(`儲存中：1/1（共 ${items.length} 筆）`);

    const ret = await uApiUpdateUsersBatch_(items).catch(() => ({}));

    const failedSet = new Set((ret.fail || []).map((x) => String(x.userId || "").trim()));

    items.forEach((it) => {
      const id = String(it.userId || "");
      if (!id || failedSet.has(id)) return;

      const u = uGetById_(id);
      if (!u) return;

      u.audit = it.audit;
      u.startDate = it.startDate;
      u.usageDays = it.usageDays;
      u.masterCode = it.masterCode;
      u.pushEnabled = it.audit !== "通過" ? "否" : it.pushEnabled;
      u.personalStatusEnabled = it.personalStatusEnabled;
      u.scheduleEnabled = it.scheduleEnabled;
      u.performanceEnabled = it.performanceEnabled;

      uOriginalMap.set(id, uSnapshot_(u));
      uDirtyMap.delete(id);
    });

    uApplyFilters_();

    if (ret && ret.failCount === 0) toast(`Users 全部儲存完成：${ret.okCount || 0} 筆`, "ok");
    else toast(`Users 儲存完成：成功 ${ret?.okCount || 0} / 失敗 ${ret?.failCount || 0}`, "err");
  } catch (e) {
    console.error(e);
    toast("Users 儲存失敗", "err");
  } finally {
    uSavingAll = false;
    uSetLock_(false);
    uRefreshSaveBtn_();
    uApplyFilters_();
  }
}

function uBind_() {
  // Search
  document.getElementById("uClearSearchBtn")?.addEventListener("click", () => {
    if (uSavingAll) return;
    const si = document.getElementById("uSearchInput");
    if (si) si.value = "";
    uApplyFilters_();
  });

  document.getElementById("uSearchInput")?.addEventListener(
    "input",
    debounce(() => {
      if (uSavingAll) return;
      uApplyFilters_();
    }, 180)
  );

  // Chips
  document.querySelectorAll(".u-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (uSavingAll) return;
      document.querySelectorAll(".u-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      uApplyFilters_();
    });
  });

  // Reload / Save
  document.getElementById("uReloadBtn")?.addEventListener("click", async () => {
    if (uSavingAll) return;
    await uLoadUsers_();
  });

  document.getElementById("uSaveAllBtn")?.addEventListener("click", async () => {
    if (uSavingAll) return;
    await uSaveAllDirty_();
  });

  // Bulk
  document.getElementById("uCheckAll")?.addEventListener("change", () => {
    if (uSavingAll) return;
    const checked = !!document.getElementById("uCheckAll")?.checked;
    uFiltered.forEach((u) => {
      const id = String(u.userId || "");
      if (!id) return;
      checked ? uSelectedIds.add(id) : uSelectedIds.delete(id);
    });
    // 只更新 checkbox，不需要整表重繪
    document.querySelectorAll("#uTbody .u-row-check").forEach((cb) => {
      if (cb instanceof HTMLInputElement) cb.checked = checked;
    });
    uSyncCheckAll_();
    uUpdateBulkBar_();
  });

  document.getElementById("uBulkClear")?.addEventListener("click", () => {
    if (uSavingAll) return;
    uSelectedIds.clear();
    // 只需要把目前顯示的勾選取消
    document.querySelectorAll("#uTbody .u-row-check").forEach((cb) => {
      if (cb instanceof HTMLInputElement) cb.checked = false;
    });
    uSyncCheckAll_();
    uUpdateBulkBar_();
  });

  document.getElementById("uBulkApply")?.addEventListener("click", () => uBulkApply_());
  document.getElementById("uBulkDelete")?.addEventListener("click", () => uBulkDelete_());

  // Date picker UX: some browsers/WebViews require explicit showPicker()
  document.getElementById("uBulkStartDate")?.addEventListener("click", (e) => {
    const el = e.currentTarget;
    if (el && typeof el.showPicker === "function") el.showPicker();
  });

  // Table delegation
  const tbody = document.getElementById("uTbody");
  if (!tbody) return;

  tbody.addEventListener("change", (e) => {
    if (uSavingAll) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.classList.contains("u-row-check")) {
      const row = t.closest("tr");
      const id = row?.dataset.userid;
      if (!id) return;
      t.checked ? uSelectedIds.add(id) : uSelectedIds.delete(id);
      uSyncCheckAll_();
      uUpdateBulkBar_();
      return;
    }

    const field = t.getAttribute("data-field");
    if (!field) return;

    const row = t.closest("tr");
    const id = row?.dataset.userid;
    if (!id) return;

    const u = uGetById_(id);
    if (!u) return;

    const v = String(t.value ?? "");

    if (field === "audit") {
      u.audit = normalizeAudit_(v);

      // 審核非通過：強制關閉推播（與 client 行為一致）
      const auditNow = normalizeAudit_(u.audit);
      const pushSel = row?.querySelector('select[data-field="pushEnabled"]');
      if (auditNow !== "通過") {
        u.pushEnabled = "否";
        if (pushSel) {
          pushSel.value = "否";
          pushSel.disabled = true;
        }
      } else {
        if (pushSel) pushSel.disabled = false;
      }

      // 更新 badge（不重繪整表）
      const badge = row?.querySelector(".audit-badge");
      if (badge) {
        badge.textContent = auditNow;
        badge.className = `audit-badge ${uAuditClass_(auditNow)}`;
      }

      // KPI 可能變動（用 rAF 合併更新）
      uInvalidateKpi_();
    } else if (field === "usageDays") {
      u.usageDays = v.trim();
      const exp = uGetExpiryInfo_(u);
      const pill = row?.querySelector(".expiry-pill");
      if (pill) {
        pill.className = `expiry-pill ${exp.cls}`;
        pill.textContent = exp.text;
      }
    } else if (field === "pushEnabled") {
      u.pushEnabled = uNormalizeYesNo_(v);
    } else if (field === "personalStatusEnabled") {
      u.personalStatusEnabled = uNormalizeYesNo_(v);
    } else if (field === "scheduleEnabled") {
      u.scheduleEnabled = uNormalizeYesNo_(v);
    } else if (field === "performanceEnabled") {
      u.performanceEnabled = uNormalizeYesNo_(v);
    } else if (field === "startDate") {
      u.startDate = v;
      const exp = uGetExpiryInfo_(u);
      const pill = row?.querySelector(".expiry-pill");
      if (pill) {
        pill.className = `expiry-pill ${exp.cls}`;
        pill.textContent = exp.text;
      }
    } else if (field === "masterCode") {
      u.masterCode = v;
      const isMasterCell = row?.querySelector(".u-is-master");
      if (isMasterCell) isMasterCell.textContent = u.masterCode ? "是" : "否";
    }

    uMarkDirty_(id, u);
    uUpdateRowDirtyUI_(row, id);
  });

  // Date picker UX: open picker on click when supported
  tbody.addEventListener("click", (e) => {
    if (uSavingAll) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t instanceof HTMLInputElement && t.type === "date") {
      if (typeof t.showPicker === "function") t.showPicker();
    }
  });

  tbody.addEventListener("click", async (e) => {
    if (uSavingAll) return;
    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (!btn) return;

    if (!btn.classList.contains("u-btn-del")) return;

    const row = btn.closest("tr");
    const id = row?.dataset.userid;
    if (!id) return;

    const u = uGetById_(id);
    const okConfirm = confirm(
      `確定要刪除使用者？\n\nuserId: ${id}\n顯示名稱: ${u?.displayName || ""}\n\n此操作不可復原。`
    );
    if (!okConfirm) return;

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "刪除中...";

    const ok = await uApiDeleteUser_(id).catch(() => false);

    btn.disabled = false;
    btn.textContent = oldText || "刪除";

    if (ok) {
      toast("刪除完成", "ok");
      uSelectedIds.delete(id);
      uAll = uAll.filter((x) => String(x.userId || "") !== id);
      uFiltered = uFiltered.filter((x) => String(x.userId || "") !== id);
      uById.delete(id);
      uOriginalMap.delete(id);
      uDirtyMap.delete(id);
      uApplyFilters_();
    } else {
      toast("刪除失敗", "err");
    }
  });
}

// 提供給入口檔呼叫
function initUsersPanel_() {
  uEnsureViewTabs_();
  ensurePushPanel_();
  uBind_();
  uRefreshSaveBtn_();
  // 先顯示 KPI（避免在等待驗證/載入時一直是 "-"）
  uInvalidateKpi_();
  uSetFooter_("Users：等待管理員驗證後載入");
  uSetTbodyMessage_("等待管理員驗證後載入...");
}

async function bootUsersPanel_() {
  if (!API_BASE_URL) {
    const msg = "Users：缺少 API_BASE_URL（請檢查 admin/config.json）";
    uSetFooter_(msg);
    uSetTbodyMessage_(msg);
    return;
  }
  await uLoadUsers_();
}
