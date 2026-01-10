import { loadConfig, config } from "./modules/config.js";
import { listDateTypes, applyHolidayBatch } from "./modules/api.js";
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

  await reload();
}

main().catch((e) => {
  console.error(e);
  show(els.error, true);
  els.error.textContent = String(e);
  setUiEnabled(false);
  setText(els.msg, "初始化失敗");
});
