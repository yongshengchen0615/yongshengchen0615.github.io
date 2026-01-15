/* ================================
 * Admin - 技師使用紀錄（usage_log）
 * - 顯示欄位：serverTime / userId / name / detail
 * - 透過 TECH_USAGE_LOG_URL 呼叫 GAS（GET）：mode=list
 * ================================ */

/** @type {{serverTime:string, userId:string, name:string, detail:string}[]} */
let techUsageLogs_ = [];

/** @type {{serverTime:string, userId:string, name:string, detail:string}[]} */
let techUsageLogsAll_ = [];

let techUsageLogsLoading_ = false;

// Chart instance for tech usage analytics
let techUsageChart = null;


function techLogsSetFooter_(text) {
  const el = document.getElementById("techLogsFooterStatus");
  if (el) el.textContent = String(text || "-");
}

function techLogsSetTbodyMessage_(msg) {
  const tbody = document.getElementById("techLogsTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(msg || "-")}</td></tr>`;
}

function normalizeTechUsageRow_(r) {
  // 允許多種回傳格式
  const serverTime = String(r?.serverTime ?? r?.ts ?? r?.time ?? "");
  const userId = String(r?.userId ?? r?.lineUserId ?? "");
  const name = String(r?.name ?? r?.displayName ?? "");
  const detail = String(r?.detail ?? "");
  return { serverTime, userId, name, detail };
}

function pad2_(n) {
  return String(n).padStart(2, "0");
}

/**
 * 盡量把各種時間字串轉成 YYYY-MM-DD（以本機時區為準）。
 * @param {string} ts
 */
function toDateKey_(ts) {
  const s = String(ts || "").trim();
  if (!s) return "";

  // epoch seconds (10) / milliseconds (13)
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length === 10 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
    }
  }

  // 支援：2026-1-8 / 2026/1/8 / 2026-01-08 ...
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
}

function techLogsGetSelectedRange_() {
  const startEl = document.getElementById("techLogsStartDateInput");
  const endEl = document.getElementById("techLogsEndDateInput");
  const startDate = String(startEl?.value || "").trim();
  const endDate = String(endEl?.value || "").trim();
  const startTime = String(document.getElementById("techLogsStartTimeInput")?.value || "").trim();
  const endTime = String(document.getElementById("techLogsEndTimeInput")?.value || "").trim();

  let start = startDate;
  let end = endDate;

  // combine date + time when provided
  if (startDate && startTime) start = `${startDate}T${startTime}:00`;
  if (endDate && endTime) end = `${endDate}T${endTime}:59`;

  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s > e) {
      const tmp = start;
      start = end;
      end = tmp;
      if (startEl) startEl.value = startDate || "";
      if (endEl) endEl.value = endDate || "";
      if (document.getElementById("techLogsStartTimeInput")) document.getElementById("techLogsStartTimeInput").value = startTime || "";
      if (document.getElementById("techLogsEndTimeInput")) document.getElementById("techLogsEndTimeInput").value = endTime || "";
    }
  }

  return { start, end };
}

function techLogsBuildRangeLabel_(start, end) {
  if (start && end) return start === end ? start : `${start} ~ ${end}`;
  if (start) return `>= ${start}`;
  if (end) return `<= ${end}`;
  return "";
}

function applyTechUsageLogsDateFilter_() {
  const { start, end } = techLogsGetSelectedRange_();
  if (!start && !end) {
    techUsageLogs_ = techUsageLogsAll_.slice();
    return;
  }

  const sDt = start ? new Date(start) : null;
  const eDt = end ? new Date(end) : null;

  techUsageLogs_ = techUsageLogsAll_.filter((r) => {
    const d = parseDateSafe(r.serverTime);
    if (!d) return false;
    if (sDt && d < sDt) return false;
    if (eDt && d > eDt) return false;
    return true;
  });
}

function renderTechUsageLogs_() {
  const tbody = document.getElementById("techLogsTbody");
  if (!tbody) return;

  if (!techUsageLogs_.length) {
    tbody.innerHTML = `<tr><td colspan="5">無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = techUsageLogs_
    .map((r, i) => {
      return `
        <tr>
          <td data-label="#">${i + 1}</td>
          <td data-label="serverTime"><span style="font-family:var(--mono)">${escapeHtml(r.serverTime)}</span></td>
          <td data-label="userId"><span style="font-family:var(--mono)">${escapeHtml(r.userId)}</span></td>
          <td data-label="name">${escapeHtml(r.name)}</td>
          <td data-label="detail">${escapeHtml(r.detail)}</td>
        </tr>
      `;
    })
    .join("");
}

/* ================================
 * Tech Usage Chart (aggregation + Chart.js)
 * ================================ */

function parseDateSafe(s) {
  const str = String(s || "").trim();
  if (!str) return null;
  // epoch seconds / ms
  if (/^\d{10,13}$/.test(str)) {
    const n = Number(str);
    const ms = str.length === 10 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function weekKey(d) {
  // ISO week number
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildTechChartAggregation_(granularity = "day", metric = "count", start = "", end = "") {
  const buckets = new Map();
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

  for (const r of techUsageLogsAll_) {
    const d = parseDateSafe(r.serverTime);
    if (!d) continue;
    if (startDate && d < startDate) continue;
    if (endDate && d > endDate) continue;

    let key;
    if (granularity === "week") key = weekKey(d);
    else if (granularity === "month") key = monthKey(d);
    else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (!buckets.has(key)) buckets.set(key, { count: 0, users: new Set() });
    const entry = buckets.get(key);
    entry.count += 1;
    if (r.userId) entry.users.add(String(r.userId));
  }

  // convert to sorted arrays
  const keys = Array.from(buckets.keys()).sort();
  const labels = keys;
  const data = keys.map((k) => (metric === "unique" ? buckets.get(k).users.size : buckets.get(k).count));
  return { labels, data };
}

function initTechUsageChart_() {
  const canvas = document.getElementById("techUsageChartCanvas");
  if (!canvas || typeof Chart === "undefined") return;
  const ctx = canvas.getContext("2d");
  if (techUsageChart) {
    try { techUsageChart.destroy(); } catch (_) {}
  }
  techUsageChart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [{ label: "事件數", data: [], fill: true, borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.12)" }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: true }, y: { beginAtZero: true } },
    },
  });
}

function renderTechUsageChart_() {
  const canvas = document.getElementById("techUsageChartCanvas");
  if (!canvas) return;

  if (!techUsageChart) initTechUsageChart_();
  if (!techUsageChart) return;

  // fixed defaults: daily event count, controlled by techLogsStartDateInput / techLogsEndDateInput
  const gran = "day";
  const metric = "count";
  const { start, end } = techLogsGetSelectedRange_();
  const agg = buildTechChartAggregation_(gran, metric, start, end);

  techUsageChart.data.labels = agg.labels;
  techUsageChart.data.datasets[0].data = agg.data;
  techUsageChart.data.datasets[0].label = metric === "unique" ? "不同使用者數" : "事件數";
  techUsageChart.update();
}


async function loadTechUsageLogs_() {
  if (techUsageLogsLoading_) return;

  if (!TECH_USAGE_LOG_URL) {
    techLogsSetFooter_("尚未設定 TECH_USAGE_LOG_URL");
    techLogsSetTbodyMessage_("請在 config.json 設定 TECH_USAGE_LOG_URL");
    return;
  }

  techUsageLogsLoading_ = true;
  try {
    techLogsSetFooter_("載入中...");
    techLogsSetTbodyMessage_("載入中...");

    // 需要 GAS 支援 mode=list 才能讀取
    const ret = await techUsageLogGet_({ mode: "list", limit: 200 });
    if (!ret || ret.ok !== true) throw new Error(ret?.error || "list failed");

    // 支援：rows: [{serverTime,userId,name,detail}]
    // 或 values: [[serverTime,event,userId,name,clientTs,tz,href,detail], ...]
    let rows = [];
    if (Array.isArray(ret.rows)) rows = ret.rows;
    else if (Array.isArray(ret.logs)) rows = ret.logs;
    else if (Array.isArray(ret.values)) {
      rows = ret.values.map((v) => ({ serverTime: v?.[0], userId: v?.[2], name: v?.[3], detail: v?.[7] }));
    }

    techUsageLogsAll_ = rows
      .map(normalizeTechUsageRow_)
      .filter((r) => r.serverTime || r.userId || r.name || r.detail);

    applyTechUsageLogsDateFilter_();

    renderTechUsageLogs_();
    // 更新圖表
    try { renderTechUsageChart_(); } catch (e) { console.warn('renderTechUsageChart failed', e); }
    const { start, end } = techLogsGetSelectedRange_();
    const rangeLabel = techLogsBuildRangeLabel_(start, end);
    techLogsSetFooter_(
      rangeLabel
        ? `共 ${techUsageLogs_.length} 筆（${rangeLabel}）/ 總 ${techUsageLogsAll_.length} 筆`
        : `共 ${techUsageLogs_.length} 筆`
    );
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    techLogsSetFooter_("讀取失敗");
    techLogsSetTbodyMessage_(
      msg.includes("unsupported mode")
        ? "此 TECH_USAGE_LOG_URL 的 GAS 尚未支援 mode=list（請在 GAS doGet 新增 list 回傳 JSON）"
        : msg
    );
    toast("讀取技師使用紀錄失敗", "err");
  } finally {
    techUsageLogsLoading_ = false;
  }
}

function bindTechUsageLogs_() {
  document.getElementById("techLogsReloadBtn")?.addEventListener("click", () => loadTechUsageLogs_());

  document.getElementById("techLogsShowAllBtn")?.addEventListener("click", () => {
    const startEl = document.getElementById("techLogsStartDateInput");
    const endEl = document.getElementById("techLogsEndDateInput");
    if (startEl) startEl.value = "";
    if (endEl) endEl.value = "";
    applyTechUsageLogsDateFilter_();
    renderTechUsageLogs_();
    techLogsSetFooter_(`共 ${techUsageLogs_.length} 筆`);
  });

  const onRangeChange = () => {
    applyTechUsageLogsDateFilter_();
    renderTechUsageLogs_();
    const { start, end } = techLogsGetSelectedRange_();
    const rangeLabel = techLogsBuildRangeLabel_(start, end);
    techLogsSetFooter_(
      rangeLabel
        ? `共 ${techUsageLogs_.length} 筆（${rangeLabel}）/ 總 ${techUsageLogsAll_.length} 筆`
        : `共 ${techUsageLogs_.length} 筆`
    );
  };

  document.getElementById("techLogsStartDateInput")?.addEventListener("change", onRangeChange);
  document.getElementById("techLogsEndDateInput")?.addEventListener("change", onRangeChange);
  document.getElementById("techLogsStartTimeInput")?.addEventListener("change", onRangeChange);
  document.getElementById("techLogsEndTimeInput")?.addEventListener("change", onRangeChange);
  
  // Initialize chart and re-render when date range changes
  initTechUsageChart_();
  document.getElementById("techLogsStartDateInput")?.addEventListener("change", () => renderTechUsageChart_());
  document.getElementById("techLogsEndDateInput")?.addEventListener("change", () => renderTechUsageChart_());
  document.getElementById("techLogsStartTimeInput")?.addEventListener("change", () => renderTechUsageChart_());
  document.getElementById("techLogsEndTimeInput")?.addEventListener("change", () => renderTechUsageChart_());
}
