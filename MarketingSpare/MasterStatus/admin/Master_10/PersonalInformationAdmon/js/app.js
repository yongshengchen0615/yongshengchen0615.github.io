// js/app.js

// ===== DOM refs =====
const bookingForm = document.getElementById("bookingForm");
const breakPeriodList = document.getElementById("breakPeriodList");

const addServiceBtn = document.getElementById("addServiceBtn");
const servicesMsg = document.getElementById("servicesMsg");
const servicesRefreshBtn = document.getElementById("servicesRefresh");

const weeklyRefreshBtn = document.getElementById("weeklyRefresh");
const weeklyMsg = document.getElementById("weeklyMsg");

const datesRefreshBtn = document.getElementById("datesRefresh");
const datesMsg = document.getElementById("datesMsg");

// ===== Overlay =====
function showOverlay(text) {
  const ov = document.getElementById("overlay");
  const tx = document.getElementById("overlayText");
  if (tx && text) tx.textContent = text;
  else if (tx) tx.textContent = "載入資料中...";
  ov?.classList.add("show");
  ov?.setAttribute("aria-hidden", "false");
}
function hideOverlay() {
  const ov = document.getElementById("overlay");
  ov?.classList.remove("show");
  ov?.setAttribute("aria-hidden", "true");
}
window.showOverlay = showOverlay;
window.hideOverlay = hideOverlay;

// ===== Theme =====
(function themeInit() {
  const key = "admin.theme";
  const saved = localStorage.getItem(key) || "light";
  document.body.dataset.theme = saved;

  const toggle = document.getElementById("themeToggle");
  if (toggle) toggle.checked = saved === "dark";
  if (toggle)
    toggle.addEventListener("change", () => {
      const v = toggle.checked ? "dark" : "light";
      document.body.dataset.theme = v;
      localStorage.setItem(key, v);
    });
})();

// ===== Break Period UI =====
function addBreakRow(start = "", end = "") {
  const row = document.createElement("div");
  row.setAttribute("data-break-item", "1");
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.margin = "6px 0";
  row.innerHTML = `
    <input data-break-start type="time" value="${start}" />
    <input data-break-end type="time" value="${end}" />
    <button type="button">刪除</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  breakPeriodList.appendChild(row);
}
window.addBreakPeriod = function () {
  addBreakRow();
};

// ===== Add Date (pending only) =====
window.addDate = async function (type) {
  try {
    const map = {
      holiday: "holidayInput",
      blockedDay: "blockedDayInput",
      eventDay: "eventDayInput",
      halfDay: "halfDayInput",
    };
    const id = map[type];
    if (!id) return alert("未知類型");

    const date = document.getElementById(id).value;
    if (!date) return alert("請選擇日期");

    Pending.datetypesAdd.push({ type, date });
    alert("已暫存新增 " + type + "：" + date);
    try {
      renderDateTypes();
    } catch {}
  } catch (err) {
    alert("操作失敗：" + String(err));
  }
};

// ===== Render Weekly Off =====
async function renderWeeklyOff() {
  try {
    const res = await apiGet({ entity: "config", action: "list" });
    if (!res.ok) {
      weeklyMsg.textContent = res.error || "載入失敗";
      weeklyMsg.className = "small error";
      return;
    }
    const offs = (() => {
      try {
        return JSON.parse(res.data.weeklyOff || "[]");
      } catch {
        return [];
      }
    })();
    const boxes = Array.from(
      document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')
    );
    boxes.forEach((cb) => (cb.checked = offs.includes(cb.value)));
    weeklyMsg.textContent = `目前設定：${offs.join(", ") || "（無）"}`;
    weeklyMsg.className = "small success";
  } catch (err) {
    weeklyMsg.textContent = String(err);
    weeklyMsg.className = "small error";
  }
}
weeklyRefreshBtn?.addEventListener("click", renderWeeklyOff);

// ===== Services =====
async function renderServices() {
  try {
    let data = Array.isArray(LocalState.services)
      ? LocalState.services.map((s) => ({ ...s }))
      : [];

    const delSet = new Set(Pending.servicesDel.map((x) => String(x.key)));
    data = data.filter((s) => !delSet.has(String(s.ServiceName)));

    const updMap = new Map(
      Pending.servicesUpdate.map((u) => [
        String(u.key),
        { ...u.data, ServiceName: String(u.data?.ServiceName || u.key) },
      ])
    );
    data = data.map((s) =>
      updMap.has(String(s.ServiceName)) ? { ...s, ...updMap.get(String(s.ServiceName)) } : s
    );

    Pending.servicesAdd.forEach((a) => data.unshift({ ...a }));

    servicesMsg.textContent = `共 ${data.length} 筆（包含暫存變更）`;
    servicesMsg.className = "small success";

    const container = document.getElementById("serviceList");
    container.innerHTML = "";

    const main = data.filter((d) => String(d.IsAddon).toUpperCase() !== "TRUE");
    const addon = data.filter((d) => String(d.IsAddon).toUpperCase() === "TRUE");

    const section = (title, items) => {
      const wrap = document.createElement("div");
      wrap.style.marginTop = "8px";

      const h = document.createElement("h3");
      h.textContent = title;
      h.className = "section-title";
      wrap.appendChild(h);

      const table = document.createElement("table");
      table.className = "table table-striped table-sm";
      table.innerHTML = `<thead><tr>
        <th style="text-align:left;">服務名稱</th>
        <th>分鐘</th>
        <th>價格</th>
        <th>分類</th>
        <th>操作</th>
      </tr></thead><tbody></tbody>`;
      const tbody = table.querySelector("tbody");

      items.forEach((it) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${it.ServiceName}</td>
          <td>${it.TimeMinutes}</td>
          <td>$${it.Price}</td>
          <td>${it.Type}</td>
          <td>
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-primary soft" data-act="edit">修改</button>
              <button type="button" class="btn btn-outline-danger soft" data-act="del">刪除</button>
            </div>
          </td>`;

        tr.querySelector('[data-act="del"]').addEventListener("click", (e) => {
          e.preventDefault();
          if (!confirm(`確定刪除：${it.ServiceName}？`)) return;
          Pending.servicesDel.push({ key: it.ServiceName });
          renderServices();
        });

        tr.querySelector('[data-act="edit"]').addEventListener("click", (e) => {
          e.preventDefault();
          const name = prompt("服務名稱", it.ServiceName) || it.ServiceName;
          const minutes = Number(prompt("分鐘", it.TimeMinutes) || it.TimeMinutes);
          const price = Number(prompt("價格", it.Price) || it.Price);
          const type = prompt("分類", it.Type) || it.Type;

          Pending.servicesUpdate.push({
            key: it.ServiceName,
            data: {
              ServiceName: name,
              TimeMinutes: minutes,
              Price: price,
              Type: type,
              IsAddon:
                String(it.IsAddon).toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
            },
          });
          alert("服務已暫存修改");
          renderServices();
        });

        tbody.appendChild(tr);
      });

      wrap.appendChild(table);
      return wrap;
    };

    container.appendChild(section("主服務", main));
    container.appendChild(section("加購服務", addon));
  } catch (err) {
    servicesMsg.textContent = String(err);
    servicesMsg.className = "small error";
  }
}
servicesRefreshBtn?.addEventListener("click", renderServices);

// Add service inline form
addServiceBtn?.addEventListener("click", async () => {
  try {
    const defaultIsAddon =
      document.getElementById("serviceTypeSelect").value === "addon";
    const container = document.getElementById("serviceList");

    const formRow = document.createElement("div");
    formRow.className = "card p-2 service-form";
    formRow.style.display = "grid";
    formRow.style.gridTemplateColumns = "2fr 1fr 1fr 1fr 1fr auto";
    formRow.style.gap = "8px";
    formRow.style.margin = "8px 0";

    formRow.innerHTML = `
      <input class="form-control" type="text" placeholder="服務名稱（必填）" />
      <input class="form-control" type="number" placeholder="分鐘（必填）" />
      <input class="form-control" type="number" placeholder="價格（必填）" />
      <input class="form-control" type="text" placeholder="分類（例：全身按摩）" ${
        defaultIsAddon ? 'value="加購服務"' : ""
      } />
      <select class="form-select">
        <option value="main" ${defaultIsAddon ? "" : "selected"}>主服務</option>
        <option value="addon" ${defaultIsAddon ? "selected" : ""}>加購服務</option>
      </select>
      <div class="btn-group">
        <button type="button" class="btn btn-success soft">儲存</button>
        <button type="button" class="btn btn-outline-secondary soft">取消</button>
      </div>
    `;

    const [nameEl, minEl, priceEl, typeEl, kindEl] = formRow.querySelectorAll(
      "input,select"
    );
    const [saveBtn, cancelBtn] = formRow.querySelectorAll("button");

    container.appendChild(formRow);
    try {
      formRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {}

    cancelBtn.addEventListener("click", () => formRow.remove());
    saveBtn.addEventListener("click", async () => {
      const ServiceName = nameEl.value.trim();
      const TimeMinutes = Number(minEl.value || "0");
      const Price = Number(priceEl.value || "0");
      const Type = typeEl.value.trim();
      const IsAddon = kindEl.value === "addon" ? "TRUE" : "FALSE";

      if (!ServiceName) return alert("請輸入服務名稱");
      if (!TimeMinutes || TimeMinutes <= 0) return alert("請輸入有效的分鐘");
      if (Price < 0) return alert("價格不可為負數");

      Pending.servicesAdd.push({ ServiceName, TimeMinutes, Price, Type, IsAddon });
      alert("服務已暫存新增");
      renderServices();
      formRow.remove();
    });
  } catch (err) {
    alert("操作失敗：" + String(err));
  }
});

// ===== DateTypes =====
async function renderDateTypes() {
  try {
    let data = Array.isArray(LocalState.datetypes)
      ? LocalState.datetypes.map((r) => ({
          Type: r.Type || r.DateType,
          DateType: r.DateType || r.Type,
          Date: r.Date,
        }))
      : [];

    const delKeys = new Set(Pending.datetypesDel.map((x) => `${x.type}|${String(x.date)}`));
    data = data.filter((r) => !delKeys.has(`${r.Type}|${String(r.Date)}`));

    Pending.datetypesAdd.forEach((a) => data.unshift({ Type: a.type, DateType: a.type, Date: a.date }));

    datesMsg.textContent = `共 ${data.length} 筆`;
    datesMsg.className = "small success";

    const byType = (t) => data.filter((r) => r && (r.Type === t || r.DateType === t));

    const renderList = (id, items, type) => {
      const el = document.getElementById(id);
      el.innerHTML = "";
      if (!items.length) {
        el.textContent = "（無）";
        return;
      }
      const table = document.createElement("table");
      table.className = "table table-striped table-sm";
      table.innerHTML = `<thead><tr><th class="text-start">日期</th><th class="text-start">操作</th></tr></thead><tbody></tbody>`;
      const tbody = table.querySelector("tbody");

      items.forEach(({ Date }) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${Date}</td><td>
          <button type="button" class="btn btn-danger btn-sm soft" data-act="del">刪除</button>
        </td>`;
        tr.querySelector('[data-act="del"]').addEventListener("click", (e) => {
          e.preventDefault();
          if (!confirm(`確定刪除：${type} ${Date}？`)) return;
          Pending.datetypesDel.push({ type, date: String(Date) });
          renderDateTypes();
        });
        tbody.appendChild(tr);
      });

      el.appendChild(table);
    };

    renderList("holidayList", byType("holiday"), "holiday");
    renderList("blockedDayList", byType("blockedDay"), "blockedDay");
    renderList("eventDayList", byType("eventDay"), "eventDay");
    renderList("halfDayList", byType("halfDay"), "halfDay");
  } catch (err) {
    datesMsg.textContent = String(err);
    datesMsg.className = "small error";
  }
}
datesRefreshBtn?.addEventListener("click", renderDateTypes);

// ===== Form Submit (batch) =====
bookingForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    showOverlay("儲存中...");

    const startTime = document.getElementById("startTime").value;
    const endTime = document.getElementById("endTime").value;
    const bufferMinutes = document.getElementById("bufferMinutes").value;
    const maxBookingDays = document.getElementById("maxBookingDays").value;

    const breaks = Array.from(document.querySelectorAll("[data-break-item]"))
      .map((el) => ({
        start: el.querySelector("[data-break-start]").value,
        end: el.querySelector("[data-break-end]").value,
      }))
      .filter((b) => b.start && b.end);

    const weeklyChecked = Array.from(
      document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')
    )
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    Pending.config.startTime = startTime || "";
    Pending.config.endTime = endTime || "";
    Pending.config.bufferMinutes = String(bufferMinutes || "");
    Pending.config.maxBookingDays = String(maxBookingDays || "");
    Pending.config.breakPeriods = JSON.stringify(breaks);
    Pending.config.weeklyOff = JSON.stringify(weeklyChecked);

    const batchPayload = {
      entity: "batch",
      action: "apply",
      data: {
        config: Pending.config,
        datetypes: { add: Pending.datetypesAdd, del: Pending.datetypesDel },
        services: { add: Pending.servicesAdd, update: Pending.servicesUpdate, del: Pending.servicesDel },
      },
    };

    const batchRes = await apiPost(batchPayload);
    if (!batchRes || !batchRes.ok) {
      throw new Error(batchRes && batchRes.error ? batchRes.error : "批次儲存失敗");
    }

    // clear pending
    Pending.config = {};
    Pending.datetypesAdd = [];
    Pending.datetypesDel = [];
    Pending.servicesAdd = [];
    Pending.servicesUpdate = [];
    Pending.servicesDel = [];

    const r = batchRes.results || {};
    const msg = `儲存完成：Config(${(r.config?.updated || 0)} 更新/${(r.config?.created || 0)} 新增) Services(${(r.services?.updated || 0)} 更新/${(r.services?.created || 0)} 新增/${(r.services?.deleted || 0)} 刪除) DateTypes(${(r.datetypes?.created || 0)} 新增/${(r.datetypes?.deleted || 0)} 刪除)`;
    alert(msg);
  } catch (err) {
    alert("儲存設定失敗：" + String(err));
  } finally {
    hideOverlay();
  }
});

// ===== Preload (fetch once -> LocalState) =====
(async function preloadConfig() {
  try {
    if (!ENDPOINT) return;

    const res = await apiGet({ entity: "config", action: "list" });
    if (res.ok && res.data) {
      const cfg = res.data;
      const toHHMM = (val) => {
        if (!val) return "";
        if (/^\d{2}:\d{2}(:\d{2}(\.\d{3})?)?$/.test(val)) return val.slice(0, 5);
        try {
          const d = new Date(val);
          if (!isNaN(d.getTime())) {
            const hh = String(d.getHours()).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            return `${hh}:${mm}`;
          }
        } catch {}
        return "";
      };

      if (cfg.startTime) document.getElementById("startTime").value = toHHMM(cfg.startTime);
      if (cfg.endTime) document.getElementById("endTime").value = toHHMM(cfg.endTime);
      if (cfg.bufferMinutes) document.getElementById("bufferMinutes").value = Number(cfg.bufferMinutes);
      if (cfg.maxBookingDays) document.getElementById("maxBookingDays").value = Number(cfg.maxBookingDays);

      if (cfg.breakPeriods) {
        try {
          JSON.parse(cfg.breakPeriods).forEach((b) => addBreakRow(b.start, b.end));
        } catch {}
      }

      if (cfg.weeklyOff) {
        try {
          const offs = JSON.parse(cfg.weeklyOff);
          Array.from(document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')).forEach((cb) => {
            cb.checked = offs.includes(cb.value);
          });
        } catch {}
      }
    }

    try {
      const dtRes = await apiGet({ entity: "datetypes", action: "list" });
      if (dtRes.ok) LocalState.datetypes = Array.isArray(dtRes.data) ? dtRes.data : [];
    } catch {}

    try {
      const srvRes = await apiGet({ entity: "services", action: "list" });
      if (srvRes.ok) LocalState.services = Array.isArray(srvRes.data) ? srvRes.data : [];
    } catch {}

    renderWeeklyOff();
    renderDateTypes();
    renderServices();
  } catch {}
})();

// ===== Initial load overlay =====
(async function hookInitialLoad() {
  showOverlay("載入資料中...");
  const tasks = [];
  try {
    tasks.push((async () => { try { await renderWeeklyOff(); } catch {} })());
    tasks.push((async () => { try { await renderDateTypes(); } catch {} })());
    tasks.push((async () => { try { await renderServices(); } catch {} })());
  } finally {
    Promise.all(tasks).finally(() => hideOverlay());
  }
})();
