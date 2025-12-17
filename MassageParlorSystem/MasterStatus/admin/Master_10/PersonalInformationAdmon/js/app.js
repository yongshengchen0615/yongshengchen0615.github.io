// js/app.js

const bookingForm = document.getElementById("bookingForm");

const weeklyRefreshBtn = document.getElementById("weeklyRefresh");
const weeklyMsg = document.getElementById("weeklyMsg");

const holidaysRefreshBtn = document.getElementById("holidaysRefresh");
const holidaysMsg = document.getElementById("holidaysMsg");

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

// ===== Weekly Off =====
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

// ===== Holidays (Special Dates: holiday only) =====
window.addHoliday = function () {
  const date = document.getElementById("holidayInput").value;
  if (!date) return alert("請選擇日期");

  // 去重：避免同一天重複暫存
  const key = String(date);
  const alreadyAdded = Pending.holidaysAdd.some((x) => String(x.date) === key);
  if (alreadyAdded) return alert("這個假日已暫存");

  Pending.holidaysAdd.push({ type: "holiday", date: key });
  alert("已暫存新增 假日：" + key);

  try { renderHolidays(); } catch {}
};

async function renderHolidays() {
  try {
    let data = Array.isArray(LocalState.datetypes) ? LocalState.datetypes : [];

    // 正規化欄位
    data = data.map((r) => ({
      Type: r.Type || r.DateType,
      Date: String(r.Date || ""),
    }));

    // 只留下 holiday
    data = data.filter((r) => r.Type === "holiday");

    // 套用 Pending 刪除
    const delSet = new Set(Pending.holidaysDel.map((x) => String(x.date)));
    data = data.filter((r) => !delSet.has(String(r.Date)));

    // 套用 Pending 新增（放最前）
    Pending.holidaysAdd.forEach((a) => data.unshift({ Type: "holiday", Date: String(a.date) }));

    holidaysMsg.textContent = `共 ${data.length} 筆（包含暫存變更）`;
    holidaysMsg.className = "small success";

    const el = document.getElementById("holidayList");
    el.innerHTML = "";

    if (!data.length) {
      el.textContent = "（無）";
      return;
    }

    const table = document.createElement("table");
    table.className = "table table-striped table-sm";
    table.innerHTML =
      `<thead><tr><th class="text-start">日期</th><th class="text-start">操作</th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    data.forEach(({ Date }) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${Date}</td><td>
        <button type="button" class="btn btn-danger btn-sm soft" data-act="del">刪除</button>
      </td>`;

      tr.querySelector('[data-act="del"]').addEventListener("click", (e) => {
        e.preventDefault();
        if (!confirm(`確定刪除：假日 ${Date}？`)) return;

        // 如果它本來就是 Pending 新增的，就直接從 add 移除（不用再記 del）
        const idx = Pending.holidaysAdd.findIndex((x) => String(x.date) === String(Date));
        if (idx >= 0) {
          Pending.holidaysAdd.splice(idx, 1);
        } else {
          // 否則記錄刪除，等儲存時送出
          const exists = Pending.holidaysDel.some((x) => String(x.date) === String(Date));
          if (!exists) Pending.holidaysDel.push({ type: "holiday", date: String(Date) });
        }
        renderHolidays();
      });

      tbody.appendChild(tr);
    });

    el.appendChild(table);
  } catch (err) {
    holidaysMsg.textContent = String(err);
    holidaysMsg.className = "small error";
  }
}
holidaysRefreshBtn?.addEventListener("click", renderHolidays);

// ===== Form Submit (batch: config + holiday only) =====
bookingForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    showOverlay("儲存中...");

    const startTime = document.getElementById("startTime").value || "";
    const endTime = document.getElementById("endTime").value || "";
    const bufferMinutes = String(document.getElementById("bufferMinutes").value || "");
    const maxBookingDays = String(document.getElementById("maxBookingDays").value || "");

    const weeklyChecked = Array.from(
      document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')
    )
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    Pending.config = {
      startTime,
      endTime,
      bufferMinutes,
      maxBookingDays,
      weeklyOff: JSON.stringify(weeklyChecked),
    };

    const batchPayload = {
      entity: "batch",
      action: "apply",
      data: {
        config: Pending.config,
        datetypes: { add: Pending.holidaysAdd, del: Pending.holidaysDel },
      },
    };

    const batchRes = await apiPost(batchPayload);
    if (!batchRes || !batchRes.ok) {
      throw new Error(batchRes?.error || "批次儲存失敗");
    }

    // 清空 pending
    Pending.config = {};
    Pending.holidaysAdd = [];
    Pending.holidaysDel = [];

    alert("儲存完成");
  } catch (err) {
    alert("儲存設定失敗：" + String(err));
  } finally {
    hideOverlay();
  }
});

// ===== Preload =====
(async function preload() {
  showOverlay("載入資料中...");
  try {
    // config
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

      document.getElementById("startTime").value = toHHMM(cfg.startTime);
      document.getElementById("endTime").value = toHHMM(cfg.endTime);
      document.getElementById("bufferMinutes").value = cfg.bufferMinutes ? Number(cfg.bufferMinutes) : "";
      document.getElementById("maxBookingDays").value = cfg.maxBookingDays ? Number(cfg.maxBookingDays) : "";

      // weekly off
      try {
        const offs = JSON.parse(cfg.weeklyOff || "[]");
        Array.from(
          document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')
        ).forEach((cb) => (cb.checked = offs.includes(cb.value)));
      } catch {}
    }

    // holidays list (reuse datetypes/list，但只渲染 holiday)
    const dtRes = await apiGet({ entity: "datetypes", action: "list" });
    if (dtRes.ok) LocalState.datetypes = Array.isArray(dtRes.data) ? dtRes.data : [];

    await renderWeeklyOff();
    await renderHolidays();
  } catch (err) {
    // 這裡不阻斷 UI，只顯示在 messages
    weeklyMsg.textContent = weeklyMsg.textContent || String(err);
    weeklyMsg.className = "small error";
  } finally {
    hideOverlay();
  }
})();
