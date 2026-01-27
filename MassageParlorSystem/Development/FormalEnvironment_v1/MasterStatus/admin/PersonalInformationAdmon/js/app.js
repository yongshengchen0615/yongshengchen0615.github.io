// js/app.js

const LIFF_ID = "2008735934-MXQr4bQs";
const ADMIN_API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbxciJzh9cRdjdxqQ-iq_mx-bCsETzyasBBKkzGmibkVG_bc4pjASwrR0Kxmo037Xg7Z/exec";

const bookingForm = document.getElementById("bookingForm");
const weeklyRefreshBtn = document.getElementById("weeklyRefresh");
const weeklyMsg = document.getElementById("weeklyMsg");
const holidaysRefreshBtn = document.getElementById("holidaysRefresh");
const holidaysMsg = document.getElementById("holidaysMsg");

function showGate(msg) {
  const gate = document.getElementById("gate");
  if (!gate) return;
  gate.classList.remove("gate-hidden");
  gate.textContent = msg || "處理中…";
}
function hideGate() {
  const gate = document.getElementById("gate");
  if (!gate) return;
  gate.classList.add("gate-hidden");
}
function setUiEnabled(enabled) {
  if (bookingForm) {
    const controls = bookingForm.querySelectorAll("input, button, select, textarea");
    controls.forEach((el) => (el.disabled = !enabled));
  }
}

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

async function adminCheckByUserId(userId) {
  if (!ADMIN_API_BASE_URL || !/^https:\/\/script.google.com\/.+\/exec$/.test(ADMIN_API_BASE_URL)) {
    throw new Error("請先設定正確的 ADMIN_API_BASE_URL（Users 管理 GAS WebApp /exec）");
  }

  const url =
    ADMIN_API_BASE_URL +
    "?" +
    new URLSearchParams({
      mode: "check",
      userId: String(userId || "").trim(),
      _cors: "1",
    }).toString();

  const res = await fetch(url, { method: "GET" });
  return res.json();
}

/** ✅ 新增：取得 DateDB ENDPOINT（PersonalStatus 的 E 欄） */
async function fetchDateDbEndpointByUserId(userId) {
  const url =
    ADMIN_API_BASE_URL +
    "?" +
    new URLSearchParams({
      mode: "getDateDbEndpoint",
      userId: String(userId || "").trim(),
      _cors: "1",
    }).toString();

  const res = await fetch(url, { method: "GET" });
  const json = await res.json();

  if (!json || !json.ok || !json.endpoint) {
    throw new Error(json?.error || "無法取得 DateDB ENDPOINT");
  }
  return String(json.endpoint).trim();
}

async function runGate() {
  setUiEnabled(false);
  showGate("初始化 LINE 登入中…");

  if (!window.liff) throw new Error("LIFF SDK 未載入（請確認 index.html 已引入 LIFF SDK）");
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    showGate("導向 LINE 登入中…");
    liff.login();
    return { passed: false, redirected: true };
  }

  showGate("取得使用者資訊…");
  const profile = await liff.getProfile();
  const userId = String(profile?.userId || "").trim();
  if (!userId) throw new Error("無法取得 LINE userId");

  showGate("檢查審核與權限中…");
  const check = await adminCheckByUserId(userId);

  const audit = String(check?.audit || "").trim();
  const personalStatusEnabled = String(check?.personalStatusEnabled || "").trim() === "是" ? "是" : "否";

  const isApproved = audit === "通過";
  const isPersonalOn = personalStatusEnabled === "是";

  if (!audit) {
    showGate("無法使用本功能。\n\n原因：\n- 尚未註冊或資料不存在\n\n請聯絡管理員協助開通。");
    return { passed: false };
  }

  if (!isApproved || !isPersonalOn) {
    const reasons = [];
    if (!isApproved) reasons.push(`審核狀態：${audit}`);
    if (!isPersonalOn) reasons.push("個人狀態尚未開通");
    showGate(`無法使用本功能。\n\n原因：\n- ${reasons.join("\n- ")}\n\n請聯絡管理員協助開通。`);
    return { passed: false };
  }

  // ✅ 通過後：再向 GAS 拿 DateDB endpoint（同時會驗證未過期 + 排班表開通=是）
  showGate("讀取資料庫連結中…");
  const endpoint = await fetchDateDbEndpointByUserId(userId);

  window.RUNTIME_USER_ID = userId;
  window.RUNTIME_ENDPOINT = endpoint;

  hideGate();
  setUiEnabled(true);
  return { passed: true, userId, endpoint };
}

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

    const offSet = new Set(Array.isArray(offs) ? offs.map(String) : []);

    const boxes = Array.from(
      document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')
    );
    boxes.forEach((cb) => (cb.checked = offSet.has(String(cb.value))));

    weeklyMsg.textContent = `目前設定：${(Array.isArray(offs) ? offs : []).join(", ") || "（無）"}`;
    weeklyMsg.className = "small success";
  } catch (err) {
    weeklyMsg.textContent = String(err);
    weeklyMsg.className = "small error";
  }
}
weeklyRefreshBtn?.addEventListener("click", renderWeeklyOff);

window.addHoliday = function () {
  const date = document.getElementById("holidayInput").value;
  if (!date) return alert("請選擇日期");

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

    data = data.map((r) => ({
      Type: r.Type || r.DateType,
      Date: String(r.Date || ""),
    }));

    data = data.filter((r) => r.Type === "holiday");

    const delSet = new Set(Pending.holidaysDel.map((x) => String(x.date)));
    data = data.filter((r) => !delSet.has(String(r.Date)));

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

        const idx = Pending.holidaysAdd.findIndex((x) => String(x.date) === String(Date));
        if (idx >= 0) {
          Pending.holidaysAdd.splice(idx, 1);
        } else {
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

async function preload() {
  showOverlay("載入資料中...");
  try {
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

      try {
        const offs = JSON.parse(cfg.weeklyOff || "[]");
        const offSet = new Set(Array.isArray(offs) ? offs.map(String) : []);
        Array.from(
          document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')
        ).forEach((cb) => (cb.checked = offSet.has(String(cb.value))));
      } catch {}
    }

    const dtRes = await apiGet({ entity: "datetypes", action: "list" });
    if (dtRes.ok) LocalState.datetypes = Array.isArray(dtRes.data) ? dtRes.data : [];

    await renderWeeklyOff();
    await renderHolidays();
  } catch (err) {
    weeklyMsg.textContent = weeklyMsg.textContent || String(err);
    weeklyMsg.className = "small error";
  } finally {
    hideOverlay();
  }
}

(async function boot() {
  try {
    const gate = await runGate();
    if (gate.redirected) return;
    if (!gate.passed) return;
    await preload();
  } catch (err) {
    showGate("初始化失敗：\n" + String(err?.message || err));
    setUiEnabled(false);
  }
})();
