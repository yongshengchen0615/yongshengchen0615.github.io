import { loadConfig, config } from "./modules/config.js";
import {
  listDateTypes,
  applyHolidayBatch,
  listReviewRequests,
  approveReviewRequest,
  denyReviewRequest,
  deleteReviewRequest,
} from "./modules/api.js";
import { escapeHtml, ymd, uniqSorted } from "./modules/core.js";

const els = {
  pageTitle: document.getElementById("pageTitle"),
  themeToggle: document.getElementById("themeToggle"),
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
};

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

  if (els.reviewPassphrase) els.reviewPassphrase.disabled = dis;
  if (els.reviewStatus) els.reviewStatus.disabled = dis;
  if (els.reviewReloadBtn) els.reviewReloadBtn.disabled = dis;
}

function buildGuestLink_(token) {
  const base = String(config.PUBLIC_DASHBOARD_URL || "").trim();
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
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:120px;">申請碼</th>
        <th style="width:160px;">客人</th>
        <th>備註</th>
        <th style="width:100px;">狀態</th>
        <th style="width:240px;">看板連結</th>
        <th style="width:220px;">操作</th>
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

    const canApprove = status === "pending";
    const canDeny = status === "pending";
    const canDelete = status === "approved";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(requestId)}</td>
      <td>${escapeHtml(guestName)}</td>
      <td>${escapeHtml(guestNote || "—")}</td>
      <td>${escapeHtml(status)}</td>
      <td>
        ${link ? `<div class="row" style="gap:8px;"><input class="input" type="text" readonly value="${escapeHtml(link)}" /><button class="btn btn-ghost" type="button" data-act="copyLink" data-id="${escapeHtml(requestId)}">複製</button></div>` : "—"}
      </td>
      <td>
        ${canApprove ? `<button class="btn btn-primary" type="button" data-act="approve" data-id="${escapeHtml(requestId)}">通過</button>` : ""}
        ${canDeny ? `<button class="btn btn-danger" type="button" data-act="deny" data-id="${escapeHtml(requestId)}">拒絕</button>` : ""}
        ${canDelete ? `<button class="btn btn-danger" type="button" data-act="delete" data-id="${escapeHtml(requestId)}">刪除/禁止</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });

  els.reviewList.innerHTML = "";
  els.reviewList.appendChild(table);

  els.reviewList.querySelectorAll("[data-act=approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = String(btn.getAttribute("data-id") || "");
      if (!requestId) return;

      const masterId = String(config.MASTER_ID || "").trim();

      try {
        setUiEnabled(false);
        setReviewMsg("通過中…");

        const dashboardUrl = String(config.PUBLIC_DASHBOARD_URL || "").trim();
        if (dashboardUrl && dashboardUrl === String(config.DATE_DB_ENDPOINT || "").trim()) {
          throw new Error("設定錯誤：PUBLIC_DASHBOARD_URL 不能填 DateDB WebApp 的 /exec（會看到 JSON）");
        }
        if (dashboardUrl && dashboardUrl === String(config.AUTH_ENDPOINT || "").trim()) {
          throw new Error("設定錯誤：PUBLIC_DASHBOARD_URL 不能填 Auth WebApp 的 /exec");
        }
        const res = await approveReviewRequest({ masterId, passphrase, requestId, dashboardUrl });
        if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "approve failed");

        const approvedLink = String(res.approvedLink || "").trim();
        const token = String(res.token || "").trim();
        const link = approvedLink || buildGuestLink_(token);
        if (link) {
          await navigator.clipboard.writeText(link).catch(() => {});
          alert("已通過，授權連結已產生（並嘗試複製到剪貼簿）。\n\n" + link);
        } else {
          alert(
            "已通過，但尚未設定 PUBLIC_DASHBOARD_URL，所以無法自動組合連結。\n\n" +
              "請先在 config.json 填入 MasterPublicStatus 的網址。\n\n" +
              "Token：" + token
          );
        }

        await reloadReview();
      } catch (e) {
        console.error(e);
        showReviewError(e);
        setReviewMsg("通過失敗");
        alert("通過失敗：" + String(e));
      } finally {
        setUiEnabled(!state.saving);
      }
    });
  });

  els.reviewList.querySelectorAll("[data-act=deny]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = String(btn.getAttribute("data-id") || "");
      if (!requestId) return;
      if (!confirm(`確定拒絕申請：${requestId}？`)) return;

      const masterId = String(config.MASTER_ID || "").trim();
      try {
        setUiEnabled(false);
        setReviewMsg("拒絕中…");

        const res = await denyReviewRequest({ masterId, passphrase, requestId });
        if (!res || res.ok !== true) throw new Error(res?.error || res?.err || "deny failed");

        await reloadReview();
      } catch (e) {
        console.error(e);
        showReviewError(e);
        setReviewMsg("拒絕失敗");
        alert("拒絕失敗：" + String(e));
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
      if (!confirm(`確定刪除並禁止此客人（${requestId}）繼續觀看？\n\n已授權的裝置將會被撤銷，下次重新整理就會被擋下。`)) return;

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
  const passphrase = String(els.reviewPassphrase?.value || "");
  const status = String(els.reviewStatus?.value || "pending");

  if (!passphrase) {
    setReviewMsg("請輸入管理密碼後再載入清單");
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

  initTheme_();

  els.addBtn?.addEventListener("click", addHoliday);
  els.saveBtn?.addEventListener("click", save);
  els.reloadBtn?.addEventListener("click", reload);

  // Review requests panel (optional)
  if (els.reviewCard && config.MASTER_ID) {
    els.reviewCard.style.display = "";
    setReviewMsg("請輸入管理密碼後載入清單");
    els.reviewReloadBtn?.addEventListener("click", reloadReview);
    els.reviewStatus?.addEventListener("change", () => reloadReview());

    els.reviewForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      reloadReview();
    });
  }

  await reload();
}

main().catch((e) => {
  console.error(e);
  show(els.error, true);
  els.error.textContent = String(e);
  setUiEnabled(false);
  setText(els.msg, "初始化失敗");
});
