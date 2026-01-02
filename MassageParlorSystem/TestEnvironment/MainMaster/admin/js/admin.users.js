/* ================================
 * Admin - Users/技師資料管理（不嵌入、不外連）
 * - 直接使用 Users API（API_BASE_URL）
 * - 提供：查詢/篩選/勾選/批次套用/批次刪除/儲存全部
 * ================================ */

/** @type {any[]} */
let uAll = [];
/** @type {any[]} */
let uFiltered = [];

const uSelectedIds = new Set();
const uOriginalMap = new Map();
const uDirtyMap = new Map();

let uSavingAll = false;

function uSetTbodyMessage_(msg) {
  const tbody = document.getElementById("uTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="13">${escapeHtml(msg || "-")}</td></tr>`;
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
    "uBulkUsageDays",
    "uBulkApply",
    "uBulkDelete",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });

  document.querySelectorAll(".u-chip").forEach((el) => (el.disabled = locked));
  document.getElementById("uTbody")?.querySelectorAll("input, select, button").forEach((el) => (el.disabled = locked));
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

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dirtyText = uDirtyMap.size ? `，未儲存 ${uDirtyMap.size} 筆` : "";
  const searchHint = keywordRaw ? "（搜尋中）" : "";
  uSetFooter_(`最後更新：${hh}:${mm}:${ss}，目前顯示 ${uFiltered.length} 筆${searchHint}${dirtyText}`);
}

function uAuditOption_(value, current) {
  const sel = value === current ? "selected" : "";
  return `<option value="${value}" ${sel}>${value}</option>`;
}

function uRender_() {
  const tbody = document.getElementById("uTbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!uFiltered.length) {
    tbody.innerHTML = `<tr><td colspan="13">無資料</td></tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  uFiltered.forEach((u, i) => {
    const userId = String(u.userId || "");
    const audit = normalizeAudit_(u.audit);

    const pushEnabled = uNormalizeYesNo_(u.pushEnabled || "否");
    const personalStatusEnabled = uNormalizeYesNo_(u.personalStatusEnabled || "否");
    const scheduleEnabled = uNormalizeYesNo_(u.scheduleEnabled || "否");

    const isDirty = uDirtyMap.has(userId);
    const pushDisabled = audit !== "通過" ? "disabled" : "";

    const tr = document.createElement("tr");
    tr.dataset.userid = userId;
    if (isDirty) tr.classList.add("dirty");

    tr.innerHTML = `
      <td class="sticky-col col-check" data-label="選取">
        <input class="u-row-check" type="checkbox" ${uSelectedIds.has(userId) ? "checked" : ""} aria-label="選取此列">
      </td>
      <td data-label="#">${i + 1}</td>
      <td data-label="userId"><span style="font-family:var(--mono)">${escapeHtml(userId)}</span></td>
      <td data-label="顯示名稱">${escapeHtml(u.displayName || "")}</td>
      <td data-label="建立時間"><span style="font-family:var(--mono)">${escapeHtml(u.createdAt || "")}</span></td>

      <td data-label="開始使用">
        <input type="date" data-field="startDate" value="${escapeHtml(u.startDate || "")}">
      </td>
      <td data-label="期限(天)">
        <input type="number" min="1" data-field="usageDays" value="${escapeHtml(u.usageDays || "")}">
      </td>

      <td data-label="審核狀態">
        <select data-field="audit" class="select" aria-label="審核狀態">
          ${AUDIT_ENUM.map((v) => uAuditOption_(v, audit)).join("")}
        </select>
      </td>

      <td data-label="師傅編號">
        <input type="text" data-field="masterCode" placeholder="師傅編號" value="${escapeHtml(u.masterCode || "")}">
      </td>

      <td data-label="是否推播">
        <select data-field="pushEnabled" class="select" aria-label="是否推播" ${pushDisabled}>
          <option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="個人狀態開通">
        <select data-field="personalStatusEnabled" class="select" aria-label="個人狀態開通">
          <option value="否" ${personalStatusEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${personalStatusEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="排班表開通">
        <select data-field="scheduleEnabled" class="select" aria-label="排班表開通">
          <option value="否" ${scheduleEnabled === "否" ? "selected" : ""}>否</option>
          <option value="是" ${scheduleEnabled === "是" ? "selected" : ""}>是</option>
        </select>
      </td>

      <td data-label="操作">
        <div class="actions">
          ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : ``}
          <button class="btn danger u-btn-del" type="button">刪除</button>
        </div>
      </td>
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

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
    }));

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
  return uAll.find((x) => String(x.userId || "") === String(userId || ""));
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
  let usageDaysRaw = String(document.getElementById("uBulkUsageDays")?.value || "").trim();

  const usageDays = usageDaysRaw ? Number(usageDaysRaw) : null;
  if (usageDaysRaw && (!Number.isFinite(usageDays) || usageDays <= 0)) {
    toast("批次期限(天) 請輸入大於 0 的數字", "err");
    return;
  }

  if (!audit && !pushEnabled && !personalStatusEnabled && !scheduleEnabled && !usageDaysRaw) {
    toast("請先選擇要套用的批次欄位", "err");
    return;
  }

  const ids = Array.from(uSelectedIds);
  if (!ids.length) return;

  ids.forEach((id) => {
    const u = uGetById_(id);
    if (!u) return;

    if (audit) u.audit = normalizeAudit_(audit);
    if (usageDaysRaw) u.usageDays = String(usageDays);
    if (personalStatusEnabled) u.personalStatusEnabled = personalStatusEnabled;
    if (scheduleEnabled) u.scheduleEnabled = scheduleEnabled;

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
    uRender_();
    uSyncCheckAll_();
    uUpdateBulkBar_();
  });

  document.getElementById("uBulkClear")?.addEventListener("click", () => {
    if (uSavingAll) return;
    uSelectedIds.clear();
    uRender_();
    uSyncCheckAll_();
    uUpdateBulkBar_();
  });

  document.getElementById("uBulkApply")?.addEventListener("click", () => uBulkApply_());
  document.getElementById("uBulkDelete")?.addEventListener("click", () => uBulkDelete_());

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
      if (normalizeAudit_(u.audit) !== "通過") u.pushEnabled = "否";
    } else if (field === "usageDays") {
      u.usageDays = v.trim();
    } else if (field === "pushEnabled") {
      u.pushEnabled = uNormalizeYesNo_(v);
    } else if (field === "personalStatusEnabled") {
      u.personalStatusEnabled = uNormalizeYesNo_(v);
    } else if (field === "scheduleEnabled") {
      u.scheduleEnabled = uNormalizeYesNo_(v);
    } else if (field === "startDate") {
      u.startDate = v;
    } else if (field === "masterCode") {
      u.masterCode = v;
    }

    uMarkDirty_(id, u);
    uUpdateRowDirtyUI_(row, id);

    // audit 變更會影響 push select disabled / 值，簡單重繪
    if (field === "audit") uApplyFilters_();
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
  uBind_();
  uRefreshSaveBtn_();
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
