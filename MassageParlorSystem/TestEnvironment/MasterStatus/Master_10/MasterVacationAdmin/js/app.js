import { loadConfig, config } from "./modules/config.js";
import {
  listDateTypes,
  applyHolidayBatch,
  listReviewRequests,
  approveReviewRequest,
  denyReviewRequest,
  deleteReviewRequest,
  updateReviewRequestStatus,
  verifyAdminPassphrase,
  changeAdminPassphrase,
} from "./modules/api.js";
import { escapeHtml, ymd, uniqSorted } from "./modules/core.js";
import { initLiffLoginAndCheckAccess } from "./modules/lineAuth.js";

const els = {
  pageTitle: document.getElementById("pageTitle"),
  themeToggle: document.getElementById("themeToggle"),

  protectedHeader: document.getElementById("protectedHeader"),
  protectedContent: document.getElementById("protectedContent"),

  authCard: document.getElementById("authCard"),
  authForm: document.getElementById("authForm"),
  authPassphrase: document.getElementById("authPassphrase"),
  authLoginBtn: document.getElementById("authLoginBtn"),
  authMsg: document.getElementById("authMsg"),

  openChangePassBtn: document.getElementById("openChangePassBtn"),
  changePassCard: document.getElementById("changePassCard"),
  changePassForm: document.getElementById("changePassForm"),
  oldPassphrase: document.getElementById("oldPassphrase"),
  newPassphrase: document.getElementById("newPassphrase"),
  newPassphrase2: document.getElementById("newPassphrase2"),
  changePassBtn: document.getElementById("changePassBtn"),
  changePassCancelBtn: document.getElementById("changePassCancelBtn"),

  holidayInput: document.getElementById("holidayInput"),
  addBtn: document.getElementById("addBtn"),
  saveBtn: document.getElementById("saveBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  msg: document.getElementById("msg"),
  countMsg: document.getElementById("countMsg"),
  list: document.getElementById("list"),
  error: document.getElementById("error"),

  reviewCard: document.getElementById("reviewCard"),
  reviewPassphrase: document.getElementById("reviewPassphrase"),
  reviewStatus: document.getElementById("reviewStatus"),
  reviewReloadBtn: document.getElementById("reviewReloadBtn"),
  reviewMsg: document.getElementById("reviewMsg"),
  reviewList: document.getElementById("reviewList"),
  reviewError: document.getElementById("reviewError"),
  reviewForm: document.getElementById("reviewForm"),
};

function getTheme_() {
  const saved = String(localStorage.getItem("theme") || "").trim();
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

function applyTheme_(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
  if (els.themeToggle) els.themeToggle.textContent = t === "dark" ? "亮色" : "暗色";
}

function initTheme_() {
  applyTheme_(getTheme_());
  els.themeToggle?.addEventListener("click", () => {
    const cur = String(document.documentElement.getAttribute("data-theme") || "dark");
    applyTheme_(cur === "dark" ? "light" : "dark");
  });
}

const state = {
  loaded: [], // [{Type, Date}]
  pendingAdd: [], // [{type:"holiday", date:"YYYY-MM-DD"}]
  pendingDel: [], // same
  saving: false,
  authed: false,
  passphrase: "",
  accessAllowed: false,
};

function setAuthMsg_(t) {
  if (!els.authMsg) return;
  els.authMsg.textContent = String(t || "—");
}

function showProtected_(show) {
  const on = Boolean(show);
  if (els.protectedHeader) els.protectedHeader.style.display = on ? "" : "none";
  if (els.protectedContent) els.protectedContent.style.display = on ? "" : "none";
}

function showChangePassBlock_(show) {
  if (!els.changePassCard) return;
  els.changePassCard.style.display = show ? "" : "none";
}

function setAuthed_(authed, passphrase) {
  state.authed = Boolean(authed);
  state.passphrase = state.authed ? String(passphrase || "") : "";

  // Gate visibility before anything else.
  showProtected_(state.authed);

  // Hide login panel after successful login.
  if (els.authCard) els.authCard.style.display = state.authed ? "none" : "";

  // Gate all operations.
  setUiEnabled(state.authed && !state.saving);

  // Keep review passphrase in sync for existing review actions.
  if (els.reviewPassphrase) {
    els.reviewPassphrase.value = state.passphrase;
    els.reviewPassphrase.disabled = true;

    const wrap = els.reviewPassphrase.closest(".field");
    if (wrap) wrap.style.display = "none";
  }

  if (!state.authed) {
    showChangePassBlock_(false);
  }
}

async function tryVerifyPassphrase_(passphrase) {
  const p = String(passphrase || "");
  if (!p) return false;
  const res = await verifyAdminPassphrase({ passphrase: p });
  if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "VERIFY_FAILED");
  return true;
}

function setText(el, t) {
  if (!el) return;
  el.textContent = t;
}
function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function setUiEnabled(enabled) {
  const dis = !enabled;
  els.holidayInput && (els.holidayInput.disabled = dis);
  els.addBtn && (els.addBtn.disabled = dis);
  els.saveBtn && (els.saveBtn.disabled = dis);
  els.reloadBtn && (els.reloadBtn.disabled = dis);

  if (els.reviewStatus) els.reviewStatus.disabled = dis;
  if (els.reviewReloadBtn) els.reviewReloadBtn.disabled = dis;
}

function buildGuestLink_(token) {
  const liffId = String(config.LIFF_ID || "").trim();
  const liffBase = liffId ? `https://liff.line.me/${encodeURIComponent(liffId)}` : "";
  const base = liffBase || String(config.PUBLIC_DASHBOARD_URL || "").trim();
  if (!base) return "";
  // Prevent common misconfig: pointing dashboard URL to backend webapps.
  if (base === String(config.AUTH_ENDPOINT || "").trim()) return "";
  if (base === String(config.DATE_DB_ENDPOINT || "").trim()) return "";
  const url = new URL(base);
  url.searchParams.set("token", String(token || ""));
  return url.toString();
}

function setReviewMsg(t) {
  if (!els.reviewMsg) return;
  els.reviewMsg.textContent = t;
}

function showReviewError(e) {
  if (!els.reviewError) return;
  els.reviewError.style.display = "";
  els.reviewError.textContent = String(e);
}

function hideReviewError() {
  if (!els.reviewError) return;
  els.reviewError.style.display = "none";
  els.reviewError.textContent = "";
}

function renderReviewList(rows, passphrase) {
  hideReviewError();
  if (!els.reviewList) return;

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    els.reviewList.textContent = "（無）";
    return;
  }

  const table = document.createElement("table");
  table.className = "table table-wide";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:120px;">申請碼</th>
        <th style="width:160px;">客人</th>
        <th>備註</th>
        <th style="width:180px;">狀態</th>
        <th style="width:240px;">看板連結</th>
        <th style="width:140px;">更新</th>
        <th style="width:160px;">刪除</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  list.forEach((r) => {
    const requestId = String(r?.requestId || "");
    const guestName = String(r?.guestName || "");
    const guestNote = String(r?.guestNote || "");
    const status = String(r?.status || "");
    const approvedLink = String(r?.approvedLink || "").trim();
    const token = String(r?.token || "").trim();
    const link = approvedLink || (token ? buildGuestLink_(token) : "");

    const safeStatus = status || "pending";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(requestId)}</td>
      <td>${escapeHtml(guestName)}</td>
      <td>${escapeHtml(guestNote || "—")}</td>
      <td>
        <select class="input" data-act="setStatus" data-id="${escapeHtml(requestId)}" style="height:34px;">
          <option value="pending" ${safeStatus === "pending" ? "selected" : ""}>待審核</option>
          <option value="approved" ${safeStatus === "approved" ? "selected" : ""}>通過</option>
          <option value="denied" ${safeStatus === "denied" ? "selected" : ""}>拒絕</option>
          <option value="disabled" ${safeStatus === "disabled" ? "selected" : ""}>停用</option>
          <option value="maintenance" ${safeStatus === "maintenance" ? "selected" : ""}>系統維護</option>
        </select>
      </td>
      <td>
        ${link ? `<div class="row" style="gap:8px;"><input class="input" type="text" readonly value="${escapeHtml(link)}" /><button class="btn btn-ghost" type="button" data-act="copyLink" data-id="${escapeHtml(requestId)}">複製</button></div>` : "—"}
      </td>
      <td>
        <button class="btn btn-primary" type="button" data-act="updateStatus" data-id="${escapeHtml(requestId)}">更新</button>
      </td>
      <td>
        <button class="btn btn-danger" type="button" data-act="delete" data-id="${escapeHtml(requestId)}">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  els.reviewList.innerHTML = "";
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.appendChild(table);
  els.reviewList.appendChild(scroller);

  els.reviewList.querySelectorAll("[data-act=updateStatus]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = String(btn.getAttribute("data-id") || "");
      if (!requestId) return;

      const sel = els.reviewList.querySelector(`[data-act=setStatus][data-id="${CSS.escape(requestId)}"]`);
      const nextStatus = String(sel && sel.value ? sel.value : "").trim() || "pending";

      if (!confirm(`確定將申請 ${requestId} 的狀態改為：${nextStatus}？\n\n（非通過狀態將撤銷已授權裝置，且舊連結可能失效）`)) return;

      const masterId = String(config.MASTER_ID || "").trim();

      try {
        setUiEnabled(false);
        setReviewMsg("更新中…");

        // Prefer LIFF URL when configured.
        const liffId = String(config.LIFF_ID || "").trim();
        const liffBase = liffId ? `https://liff.line.me/${encodeURIComponent(liffId)}` : "";
        const dashboardUrl = String(liffBase || config.PUBLIC_DASHBOARD_URL || "").trim();
        const res = await updateReviewRequestStatus({ masterId, passphrase, requestId, status: nextStatus, dashboardUrl });
        if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "update failed");

        const approvedLink = String(res.approvedLink || "").trim();
        if (approvedLink) {
          await navigator.clipboard.writeText(approvedLink).catch(() => {});
          alert("已更新狀態，授權連結已產生（並嘗試複製到剪貼簿）。\n\n" + approvedLink);
        }

        await reloadReview();
      } catch (e) {
        console.error(e);
        showReviewError(e);
        setReviewMsg("更新失敗");
        alert("更新失敗：" + String(e));
      } finally {
        setUiEnabled(!state.saving);
      }
    });
  });

  els.reviewList.querySelectorAll("[data-act=copyLink]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = String(btn.getAttribute("data-id") || "");
      if (!requestId) return;
      const r = (Array.isArray(list) ? list : []).find((x) => String(x?.requestId || "") === requestId);
      const approvedLink = String(r?.approvedLink || "").trim();
      const token = String(r?.token || "").trim();
      const link = approvedLink || (token ? buildGuestLink_(token) : "");
      if (!link) return;
      await navigator.clipboard.writeText(link).catch(() => {});
      alert("已複製授權連結\n\n" + link);
    });
  });

  els.reviewList.querySelectorAll("[data-act=delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = String(btn.getAttribute("data-id") || "");
      if (!requestId) return;
      if (!confirm(`確定刪除這筆客人資料（${requestId}）？\n\n已授權的裝置將會被撤銷，且未使用的連結也會失效。`)) return;

      const masterId = String(config.MASTER_ID || "").trim();
      try {
        setUiEnabled(false);
        setReviewMsg("刪除/撤銷中…");

        const res = await deleteReviewRequest({ masterId, passphrase, requestId });
        if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "delete failed");

        await reloadReview();
      } catch (e) {
        console.error(e);
        showReviewError(e);
        setReviewMsg("刪除失敗");
        alert("刪除失敗：" + String(e));
      } finally {
        setUiEnabled(!state.saving);
      }
    });
  });
}

async function reloadReview() {
  const masterId = String(config.MASTER_ID || "").trim();
  const passphrase = String(state.passphrase || "");
  const status = String(els.reviewStatus?.value || "pending");

  if (!passphrase) {
    setReviewMsg("請先登入管理密碼");
    return;
  }

  try {
    hideReviewError();
    setReviewMsg("載入中…");
    const res = await listReviewRequests({ masterId, passphrase, status });
    if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "list failed");

    const rows = Array.isArray(res.rows) ? res.rows : [];
    renderReviewList(rows, passphrase);
    setReviewMsg(`已更新（${rows.length} 筆）`);
  } catch (e) {
    console.error(e);
    showReviewError(e);
    setReviewMsg("載入失敗");
  }
}

function getHolidayListMerged() {
  const base = (Array.isArray(state.loaded) ? state.loaded : [])
    .map((r) => ({ Type: r.Type || r.DateType || "", Date: String(r.Date || "") }))
    .filter((r) => String(r.Type) === "holiday")
    .map((r) => String(r.Date));

  const delSet = new Set(state.pendingDel.map((x) => String(x.date)));
  let merged = base.filter((d) => !delSet.has(String(d)));

  for (const a of state.pendingAdd) merged.unshift(String(a.date));

  merged = uniqSorted(merged);
  return merged;
}

function render() {
  show(els.error, false);

  const merged = getHolidayListMerged();
  const pendingCount = state.pendingAdd.length + state.pendingDel.length;

  setText(els.countMsg, `共 ${merged.length} 筆（暫存變更：${pendingCount}）`);

  if (!els.list) return;
  if (!merged.length) {
    els.list.textContent = "（無）";
    return;
  }

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:200px;">日期</th>
        <th style="width:120px;">操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  merged.forEach((date) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(date)}</td>
      <td><button class="btn btn-danger" type="button" data-act="del" data-date="${escapeHtml(date)}">刪除</button></td>
    `;
    tbody.appendChild(tr);
  });

  els.list.innerHTML = "";
  els.list.appendChild(table);

  els.list.querySelectorAll("[data-act=del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const date = String(btn.getAttribute("data-date") || "");
      if (!date) return;
      if (!confirm(`確定刪除假日：${date}？`)) return;

      // 如果是剛暫存新增的，就直接移除 add
      const idxAdd = state.pendingAdd.findIndex((x) => String(x.date) === date);
      if (idxAdd >= 0) {
        state.pendingAdd.splice(idxAdd, 1);
        render();
        return;
      }

      // 否則標記為暫存刪除
      const existsDel = state.pendingDel.some((x) => String(x.date) === date);
      if (!existsDel) state.pendingDel.push({ type: "holiday", date });
      render();
    });
  });
}

async function reload() {
  try {
    setUiEnabled(false);
    setText(els.msg, "載入中…");
    show(els.error, false);

    const res = await listDateTypes();
    if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "list failed");

    const data = Array.isArray(res.data) ? res.data : (Array.isArray(res.rows) ? res.rows : []);
    state.loaded = data;

    // 不清 pending（避免使用者重新整理就丟暫存）
    render();
    setText(els.msg, "已更新");
  } catch (e) {
    console.error(e);
    show(els.error, true);
    els.error.textContent = String(e);
    setText(els.msg, "載入失敗");
  } finally {
    setUiEnabled(!state.saving);
  }
}

function addHoliday() {
  const date = ymd(els.holidayInput?.value);
  if (!date) return alert("請選擇日期");

  // 已存在（含暫存）則不重複
  const merged = new Set(getHolidayListMerged().map(String));
  if (merged.has(date)) return alert("這個日期已存在");

  state.pendingAdd.unshift({ type: "holiday", date });
  els.holidayInput.value = "";
  setText(els.msg, `已暫存新增：${date}`);
  render();
}

async function save() {
  if (state.saving) return;
  const add = state.pendingAdd.map((x) => ({ type: "holiday", date: String(x.date) }));
  const del = state.pendingDel.map((x) => ({ type: "holiday", date: String(x.date) }));

  if (!add.length && !del.length) {
    alert("目前沒有暫存變更");
    return;
  }

  try {
    state.saving = true;
    setUiEnabled(false);
    setText(els.msg, "儲存中…");

    const res = await applyHolidayBatch({ add, del });
    if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "save failed");

    state.pendingAdd = [];
    state.pendingDel = [];

    await reload();
    alert("儲存完成");
  } catch (e) {
    console.error(e);
    alert("儲存失敗：" + String(e));
    setText(els.msg, "儲存失敗");
  } finally {
    state.saving = false;
    setUiEnabled(true);
  }
}

async function main() {
  await loadConfig();
  if (els.pageTitle) els.pageTitle.textContent = config.TITLE;
  document.title = config.TITLE;

  // Theme toggle exists inside protected content; safe to init anyway.
  initTheme_();

  // Default: require login first.
  setAuthed_(false, "");
  setAuthMsg_("LINE 登入驗證中…");
  setUiEnabled(false);

  // Prevent using admin passphrase form before LINE access gate passes.
  state.accessAllowed = false;
  if (els.authPassphrase) els.authPassphrase.disabled = true;
  if (els.authLoginBtn) els.authLoginBtn.disabled = true;

  // ✅ LIFF login + Users-sheet access gate (must pass before showing admin password login)
  try {
    const access = await initLiffLoginAndCheckAccess({ setStatusText: setAuthMsg_ });
    if (access && access.redirected) return;

    if (!access || access.ok !== true) throw new Error("ACCESS_CHECK_FAILED");

    if (!access.allowed) {
      const reason = String(access.reason || "你沒有權限進入此頁面。").trim();
      setAuthMsg_("無法進入：" + reason);
      if (els.authPassphrase) els.authPassphrase.disabled = true;
      if (els.authLoginBtn) els.authLoginBtn.disabled = true;
      return;
    }

    // Allowed → enable admin password form
    state.accessAllowed = true;
    if (els.authPassphrase) els.authPassphrase.disabled = false;
    if (els.authLoginBtn) els.authLoginBtn.disabled = false;
    setAuthMsg_("請輸入管理密碼");
  } catch (e) {
    console.error(e);
    const msg = String(e && e.message ? e.message : e);
    setAuthMsg_(msg === "LIFF_SDK_NOT_LOADED" ? "請在 LINE 內開啟（LIFF 未載入）" : "無法完成 LINE 登入驗證");
    if (els.authPassphrase) els.authPassphrase.disabled = true;
    if (els.authLoginBtn) els.authLoginBtn.disabled = true;
    return;
  }

  els.openChangePassBtn?.addEventListener("click", () => {
    if (!state.authed) return;
    const cur = String(els.changePassCard?.style.display || "none");
    const showNow = cur === "none";
    showChangePassBlock_(showNow);
    if (showNow) {
      // Do not prefill old password; require manual entry.
      if (els.oldPassphrase) els.oldPassphrase.value = "";
      if (els.newPassphrase) els.newPassphrase.value = "";
      if (els.newPassphrase2) els.newPassphrase2.value = "";
      els.oldPassphrase?.focus();
    }
  });
  els.changePassCancelBtn?.addEventListener("click", () => {
    showChangePassBlock_(false);
  });

  els.authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!state.accessAllowed) {
      setAuthMsg_("尚未通過 LINE 權限驗證，無法登入");
      return;
    }

    const p = String(els.authPassphrase?.value || "");
    if (!p) return alert("請輸入管理密碼");

    try {
      if (els.authLoginBtn) els.authLoginBtn.disabled = true;
      setAuthMsg_("驗證中…");
      await tryVerifyPassphrase_(p);
      setAuthed_(true, p);
      setAuthMsg_("已登入");

      // Load data after login.
      await reload();
      if (els.reviewCard && config.MASTER_ID) {
        await reloadReview();
      }
    } catch (err) {
      console.error(err);
      setAuthed_(false, "");
      setAuthMsg_("登入失敗：密碼不正確或服務暫時不可用");
      alert("登入失敗：" + String(err && err.message ? err.message : err));
    } finally {
      if (els.authLoginBtn) els.authLoginBtn.disabled = false;
    }
  });

  els.changePassForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldP = String(els.oldPassphrase?.value || "");
    const newP = String(els.newPassphrase?.value || "");
    const newP2 = String(els.newPassphrase2?.value || "");

    if (!oldP) return alert("請輸入舊密碼");
    if (!newP) return alert("請輸入新密碼");
    if (newP !== newP2) return alert("新密碼與確認不一致");

    try {
      if (els.changePassBtn) els.changePassBtn.disabled = true;
      setAuthMsg_("修改中…");
      const res = await changeAdminPassphrase({ oldPassphrase: oldP, newPassphrase: newP });
      if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "CHANGE_FAILED");

      // Update current session passphrase.
      if (els.authPassphrase) els.authPassphrase.value = newP;
      setAuthed_(true, newP);

      if (els.oldPassphrase) els.oldPassphrase.value = "";
      if (els.newPassphrase) els.newPassphrase.value = "";
      if (els.newPassphrase2) els.newPassphrase2.value = "";
      showChangePassBlock_(false);
      setAuthMsg_("已修改密碼");
      alert("已修改密碼");
    } catch (err) {
      console.error(err);
      setAuthMsg_("修改失敗");
      alert("修改失敗：" + String(err && err.message ? err.message : err));
    } finally {
      if (els.changePassBtn) els.changePassBtn.disabled = false;
    }
  });

  els.addBtn?.addEventListener("click", addHoliday);
  els.saveBtn?.addEventListener("click", save);
  els.reloadBtn?.addEventListener("click", reload);

  // Review requests panel (optional)
  if (els.reviewCard && config.MASTER_ID) {
    // Will be shown only after login (protectedContent is hidden by default)
    els.reviewCard.style.display = "";
    setReviewMsg("請先登入管理密碼");
    els.reviewReloadBtn?.addEventListener("click", reloadReview);
    els.reviewStatus?.addEventListener("change", () => reloadReview());

    els.reviewForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      reloadReview();
    });
  }
}

main().catch((e) => {
  console.error(e);
  show(els.error, true);
  els.error.textContent = String(e);
  setUiEnabled(false);
  setText(els.msg, "初始化失敗");
});
