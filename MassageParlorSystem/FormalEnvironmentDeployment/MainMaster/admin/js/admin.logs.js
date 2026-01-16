/* ================================
 * Admin - 管理員紀錄（UsageLog）
 * - 顯示欄位：ts / actorUserId / actorDisplayName
 * - 透過 USAGE_LOG_API_URL 呼叫 GAS：listUsageLog
 * ================================ */

/** @type {{ts:string, actorUserId:string, actorDisplayName:string}[]} */
let adminLogs_ = [];

/** @type {{ts:string, actorUserId:string, actorDisplayName:string}[]} */
let adminLogsAll_ = [];

let adminLogsLoading_ = false;

// Chart instance for admin logs analytics
let adminLogsChart = null;

// Module-level DOM cache
let adminLogsCanvasEl = null;
let logsMetricSelectEl = null;
let logsNameSelectEl = null;
let logsStartDateEl = null;
let logsEndDateEl = null;
let logsStartTimeEl = null;
let logsEndTimeEl = null;
let logsTbodyEl = null;
let logsFooterEl = null;

function cacheLogsDom_() {
  if (adminLogsCanvasEl) return;
  adminLogsCanvasEl = document.getElementById('adminLogsChartCanvas');
  logsMetricSelectEl = document.getElementById('logsMetricSelect');
  logsNameSelectEl = document.getElementById('logsNameSelect');
  logsStartDateEl = document.getElementById('logsStartDateInput');
  logsEndDateEl = document.getElementById('logsEndDateInput');
  logsStartTimeEl = document.getElementById('logsStartTimeInput');
  logsEndTimeEl = document.getElementById('logsEndTimeInput');
  logsTbodyEl = document.getElementById('logsTbody');
  logsFooterEl = document.getElementById('logsFooterStatus');
}

function logsSetFooter_(text) {
  cacheLogsDom_();
  if (logsFooterEl) logsFooterEl.textContent = String(text || "-");
}

function logsSetTbodyMessage_(msg) {
  cacheLogsDom_();
  if (!logsTbodyEl) return;
  logsTbodyEl.innerHTML = `<tr><td colspan="4">${escapeHtml(msg || "-")}</td></tr>`;
}

function normalizeLogRow_(r) {
  const ts = String(r?.ts ?? "");
  const actorUserId = String(r?.actorUserId ?? r?.userId ?? "");
  const actorDisplayName = String(r?.actorDisplayName ?? r?.displayName ?? "");
  return { ts, actorUserId, actorDisplayName };
}

function pad2_(n) {
  return String(n).padStart(2, "0");
}

/**
 * 盡量把各種 ts 字串轉成 YYYY-MM-DD（以本機時區為準）。
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
  // （直接抓日期部分，避免不同瀏覽器對字串 Date 解析差異）
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;

  // 常見：2026-01-08T... 或 2026-01-08 12:34:56
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // 常見：2026/01/08 ...
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
}

// delegate to shared parser in utils for better performance/consistency
function parseDateSafeLogs(s) {
  if (typeof parseDateFlexible === 'function') return parseDateFlexible(s);
  // fallback
  const d = new Date(String(s || ''));
  return Number.isFinite(d.getTime()) ? d : null;
}

function logsGetSelectedRange_() {
  cacheLogsDom_();
  const startDate = String(logsStartDateEl?.value || "").trim();
  const endDate = String(logsEndDateEl?.value || "").trim();
  const startTime = String(logsStartTimeEl?.value || "").trim();
  const endTime = String(logsEndTimeEl?.value || "").trim();

  let start = startDate;
  let end = endDate;

  if (startDate && startTime) start = `${startDate}T${startTime}:00`;
  if (endDate && endTime) end = `${endDate}T${endTime}:59`;

  // 若使用者反向選擇，直接交換（並同步回 UI）
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s > e) {
      const tmp = start;
      start = end;
      end = tmp;
      if (logsStartDateEl) logsStartDateEl.value = startDate || "";
      if (logsEndDateEl) logsEndDateEl.value = endDate || "";
      if (logsStartTimeEl) logsStartTimeEl.value = startTime || "";
      if (logsEndTimeEl) logsEndTimeEl.value = endTime || "";
    }
  }

  return { start, end };
}

function logsBuildRangeLabel_(start, end) {
  if (start && end) return start === end ? start : `${start} ~ ${end}`;
  if (start) return `>= ${start}`;
  if (end) return `<= ${end}`;
  return "";
}

function applyAdminLogsDateFilter_() {
  const { start, end } = logsGetSelectedRange_();

  if (!start && !end) {
    adminLogs_ = adminLogsAll_.slice();
    return;
  }

  const sDt = start ? new Date(start) : null;
  const eDt = end ? new Date(end) : null;

  adminLogs_ = adminLogsAll_.filter((r) => {
    const d = parseDateSafeLogs(r.ts);
    if (!d) return false;
    if (sDt && d < sDt) return false;
    if (eDt && d > eDt) return false;
    return true;
  });
}

function renderAdminLogs_() {
  cacheLogsDom_();
  if (!logsTbodyEl) return;

  if (!adminLogs_.length) {
    logsTbodyEl.innerHTML = `<tr><td colspan="4">無資料</td></tr>`;
    return;
  }

  logsTbodyEl.innerHTML = adminLogs_
    .map((r, i) => {
      return `
        <tr>
          <td data-label="#">${i + 1}</td>
          <td data-label="ts"><span style="font-family:var(--mono)">${escapeHtml(r.ts)}</span></td>
          <td data-label="actorUserId"><span style="font-family:var(--mono)">${escapeHtml(r.actorUserId)}</span></td>
          <td data-label="actorDisplayName">${escapeHtml(r.actorDisplayName)}</td>
        </tr>
      `;
    })
    .join("");
}

/* ================================
 * Admin Logs Chart (aggregation + Chart.js)
 * ================================ */

function buildAdminChartAggregation_(granularity = "day", metric = "count", start = "", end = "", nameFilter = "") {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const buckets = new Map();
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  let processed = 0;
  let skipped = 0;


  for (const r of adminLogsAll_) {
      const d = parseDateSafeLogs(r.ts);
    if (!d) {
      skipped += 1;
      continue;
    }
    processed += 1;

    // filter by selected date range when provided
    if (startDate && d < startDate) continue;
    if (endDate && d > endDate) continue;

    // filter by actor display name when requested
    if (nameFilter && String(r.actorDisplayName || "") !== String(nameFilter)) continue;

    let key;
    if (granularity === "hour") {
      key = `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())} ${pad2_(d.getHours())}:00`;
    } else if (granularity === "month") {
      key = `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}`;
    } else if (granularity === "week") {
      // reuse techUsage's weekKey if available
      if (typeof weekKey === "function") key = weekKey(d);
      else key = `${d.getFullYear()}-W?`;
    } else {
      key = `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
    }

    if (!buckets.has(key)) buckets.set(key, { count: 0, users: new Set() });
    const entry = buckets.get(key);
    entry.count += 1;
    if (r.actorUserId) entry.users.add(String(r.actorUserId));
  }

  const keys = Array.from(buckets.keys()).sort();
  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  console.debug("buildAdminChartAggregation summary:", { granularity, metric, start, end, nameFilter, processed, skipped, bucketCount: keys.length, sampleKeys: keys.slice(0,5), durationMs: Math.round(t1 - t0) });
  const labels = keys;
  const data = keys.map((k) => (metric === "unique" ? buckets.get(k).users.size : buckets.get(k).count));
  return { labels, data };
}

function initAdminLogsChart_() {
  const canvas = document.getElementById("adminLogsChartCanvas");
  if (!canvas || typeof Chart === "undefined") return;
  const ctx = canvas.getContext("2d");
  if (adminLogsChart) {
    try { adminLogsChart.destroy(); } catch (_) {}
  }
  adminLogsChart = new Chart(ctx, {
    type: "line",
    data: { datasets: [{ label: "事件數", data: [], fill: true, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.12)" }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day', displayFormats: { hour: 'yyyy-MM-dd HH:mm', day: 'yyyy-MM-dd', month: 'yyyy-MM' } },
          ticks: { autoSkip: true, maxRotation: 0 }
        },
        y: { beginAtZero: true }
      },
      plugins: { legend: { display: true } }
    },
  });
}

function renderAdminLogsChart_() {
  const canvas = document.getElementById("adminLogsChartCanvas");
  if (!canvas) return;
  if (!adminLogsChart) initAdminLogsChart_();
  if (!adminLogsChart) return;

  const { start, end } = logsGetSelectedRange_();
  let gran = "day";
  if ((String(start).includes("T") || String(end).includes("T")) && String(start || end).trim() !== "") gran = "hour";
  const metric = "count";
  const metricSelect = document.getElementById('logsMetricSelect');
  const metricFromUI = metricSelect ? String(metricSelect.value || 'count') : 'count';
  const nameSelect = document.getElementById('logsNameSelect');
  const nameFromUI = nameSelect ? String(nameSelect.value || '') : '';
  const agg = buildAdminChartAggregation_(gran, metricFromUI, start, end, nameFromUI);

  console.debug("adminLogsChart aggregation:", { gran, metric: metricFromUI, nameFilter: nameFromUI, start, end, labels: agg.labels, data: agg.data, totalRows: adminLogsAll_.length });

  // 若 hourly 分桶過多，回退到日或月分桶
  if (agg.labels.length > 60 && gran === "hour") {
    console.warn("adminLogsChart: too many hourly buckets, falling back to day granularity");
    gran = "day";
    const agg2 = buildAdminChartAggregation_(gran, metricFromUI, start, end, nameFromUI);
    console.debug("adminLogsChart fallback aggregation:", { gran, labels: agg2.labels.length });
    agg.labels = agg2.labels;
    agg.data = agg2.data;
  }
  if (agg.labels.length > 365 && gran !== "month") {
    console.warn("adminLogsChart: too many daily buckets, falling back to month granularity");
    gran = "month";
    const agg2 = buildAdminChartAggregation_(gran, metricFromUI, start, end, nameFromUI);
    agg.labels = agg2.labels;
    agg.data = agg2.data;
  }

  // convert labels/data to {x,y} points using numeric timestamp (ms) for performance
  const points = agg.labels.map((lbl, i) => {
    let x = lbl;
    if (/^\d{4}-\d{2}-\d{2}$/.test(lbl)) x = `${lbl}T00:00:00`;
    if (/^\d{4}-\d{2}$/.test(lbl)) x = `${lbl}-01T00:00:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(lbl)) x = lbl.replace(' ', 'T') + ':00';
    const d = parseDateSafeLogs(x) || parseDateSafeLogs(lbl);
    const ms = d ? d.getTime() : null;
    return { x: ms !== null ? ms : String(x), y: agg.data[i] };
  });

  // only update when changed
  const old = adminLogsChart.data.datasets[0].data || [];
  let same = false;
  if (old.length === points.length) {
    same = old.every((o, idx) => {
      const p = points[idx];
      return (o.x === p.x || String(o.x) === String(p.x)) && Number(o.y) === Number(p.y);
    });
  }
  if (!same) {
    adminLogsChart.data.datasets[0].data = points;
    adminLogsChart.data.datasets[0].label = metricFromUI === "unique" ? "不同管理員數" : "事件數";
    adminLogsChart.update();
  }
}

async function loadAdminLogs_() {
  if (adminLogsLoading_) return;

  if (!USAGE_LOG_API_URL) {
    logsSetFooter_("尚未設定 USAGE_LOG_API_URL");
    logsSetTbodyMessage_("請在 config.json 設定 USAGE_LOG_API_URL");
    return;
  }

  adminLogsLoading_ = true;
  try {
    logsSetFooter_("載入中...");
    logsSetTbodyMessage_("載入中...");

    const ret = await usageLogPost_({ mode: "listUsageLog", limit: 200 });
    if (!ret || ret.ok !== true) throw new Error(ret?.error || "listUsageLog failed");

    // 支援兩種格式：
    // 1) rows: [{ts, actorUserId, actorDisplayName}, ...]
    // 2) logs: 同上
    // 3) values: [[ts, actorUserId, actorDisplayName], ...]
    let rows = [];
    if (Array.isArray(ret.rows)) rows = ret.rows;
    else if (Array.isArray(ret.logs)) rows = ret.logs;
    else if (Array.isArray(ret.values)) {
      rows = ret.values.map((v) => ({ ts: v?.[0], actorUserId: v?.[1], actorDisplayName: v?.[2] }));
    }

    adminLogsAll_ = rows.map(normalizeLogRow_).filter((r) => r.ts || r.actorUserId || r.actorDisplayName);

    // set default range inputs to earliest and latest timestamps (include time if available)
    (function setDefaultRange() {
      let minD = null;
      let maxD = null;
      function extractDateFromRowText(r) {
        const text = String(JSON.stringify(r || {}));
        const m1 = text.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(:\d{2})?)?)/);
        if (m1) {
          const dd = parseDateSafeLogs(m1[1].replace(/\//g, '-'));
          if (dd) return dd;
        }
        const m2 = text.match(/\b(\d{10,13})\b/);
        if (m2) {
          const n = Number(m2[1]);
          const ms = m2[1].length === 10 ? n * 1000 : n;
          const dd = new Date(ms);
          if (!Number.isNaN(dd.getTime())) return dd;
        }
        return null;
      }

      for (const r of adminLogsAll_) {
        let d = parseDateSafeLogs(r.ts);
        if (!d) d = extractDateFromRowText(r);
        if (!d) continue;
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
      }

      console.debug('adminLogs setDefaultRange rows=', adminLogsAll_.length, 'minD=', minD, 'maxD=', maxD);
      const startEl = document.getElementById("logsStartDateInput");
      const endEl = document.getElementById("logsEndDateInput");
      const startTimeEl = document.getElementById("logsStartTimeInput");
      const endTimeEl = document.getElementById("logsEndTimeInput");
      if (minD) {
        if (startEl) startEl.value = `${minD.getFullYear()}-${pad2_(minD.getMonth() + 1)}-${pad2_(minD.getDate())}`;
        if (startTimeEl) startTimeEl.value = `${pad2_(minD.getHours())}:${pad2_(minD.getMinutes())}`;
      } else {
        if (startEl) startEl.value = "";
        if (startTimeEl) startTimeEl.value = "";
      }
      if (maxD) {
        if (endEl) endEl.value = `${maxD.getFullYear()}-${pad2_(maxD.getMonth() + 1)}-${pad2_(maxD.getDate())}`;
        if (endTimeEl) endTimeEl.value = `${pad2_(maxD.getHours())}:${pad2_(maxD.getMinutes())}`;
      } else {
        if (endEl) endEl.value = "";
        if (endTimeEl) endTimeEl.value = "";
      }
    })();

    // populate name select (管理員名稱)
    (function populateNameSelect() {
      cacheLogsDom_();
      const sel = logsNameSelectEl || document.getElementById('logsNameSelect');
      if (!sel) return;
      const names = Array.from(new Set(adminLogsAll_.map((r) => String(r.actorDisplayName || '').trim()).filter(Boolean))).sort();
      // keep existing selection if any
      const cur = String(sel.value || '');
      sel.innerHTML = '<option value="">全部</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
      if (cur) sel.value = cur;
      // update count badge if present
      const cnt = document.getElementById('logsNameCount');
      if (cnt) cnt.textContent = String(names.length || 0);
    })();

    // apply filter and render with defaults
    applyAdminLogsDateFilter_();
    renderAdminLogs_();
    // 初次載入後也一併繪製圖表（techUsage 有此行，admin 端先前遺漏）
    try { renderAdminLogsChart_(); } catch (e) { console.warn('renderAdminLogsChart failed', e); }

    // timing: simple log
    try {
      const tAfter = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      console.debug('loadAdminLogs: rows=', adminLogsAll_.length, 'processedTimeStamp=', tAfter);
    } catch (_) {}

    const { start, end } = logsGetSelectedRange_();
    const rangeLabel = logsBuildRangeLabel_(start, end);
    logsSetFooter_(
      rangeLabel
        ? `共 ${adminLogs_.length} 筆（${rangeLabel}）/ 總 ${adminLogsAll_.length} 筆`
        : `共 ${adminLogs_.length} 筆`
    );
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    logsSetFooter_("讀取失敗");
    logsSetTbodyMessage_(
      msg.includes("unsupported mode")
        ? "此 USAGE_LOG_API_URL 的 GAS 尚未支援 listUsageLog（請更新 GAS 程式並重新部署 Web App）"
        : msg
    );
    toast("讀取管理員紀錄失敗", "err");
  } finally {
    adminLogsLoading_ = false;
  }
}

function bindAdminLogs_() {
  document.getElementById("logsReloadBtn")?.addEventListener("click", () => loadAdminLogs_());

  document.getElementById("logsShowAllBtn")?.addEventListener("click", () => {
    const startEl = document.getElementById("logsStartDateInput");
    const endEl = document.getElementById("logsEndDateInput");
    if (startEl) startEl.value = "";
    if (endEl) endEl.value = "";
    const stTime = document.getElementById("logsStartTimeInput");
    const enTime = document.getElementById("logsEndTimeInput");
    if (stTime) stTime.value = "";
    if (enTime) enTime.value = "";
    applyAdminLogsDateFilter_();
    renderAdminLogs_();
    logsSetFooter_(`共 ${adminLogs_.length} 筆`);
  });

  const onRangeChange = () => {
    applyAdminLogsDateFilter_();
    renderAdminLogs_();
    const { start, end } = logsGetSelectedRange_();
    const rangeLabel = logsBuildRangeLabel_(start, end);
    logsSetFooter_(
      rangeLabel
        ? `共 ${adminLogs_.length} 筆（${rangeLabel}）/ 總 ${adminLogsAll_.length} 筆`
        : `共 ${adminLogs_.length} 筆`
    );
  };

  document.getElementById("logsStartDateInput")?.addEventListener("change", onRangeChange);
  document.getElementById("logsEndDateInput")?.addEventListener("change", onRangeChange);
  document.getElementById("logsStartTimeInput")?.addEventListener("change", onRangeChange);
  document.getElementById("logsEndTimeInput")?.addEventListener("change", onRangeChange);

  // Initialize chart and re-render when date range changes
  initAdminLogsChart_();
  // debounce chart render to avoid frequent heavy recomputations
  const debouncedRenderAdminChart = debounce(() => renderAdminLogsChart_(), 200);
  document.getElementById("logsStartDateInput")?.addEventListener("change", debouncedRenderAdminChart);
  document.getElementById("logsEndDateInput")?.addEventListener("change", debouncedRenderAdminChart);
  document.getElementById("logsStartTimeInput")?.addEventListener("change", debouncedRenderAdminChart);
  document.getElementById("logsEndTimeInput")?.addEventListener("change", debouncedRenderAdminChart);
  document.getElementById("logsMetricSelect")?.addEventListener("change", debouncedRenderAdminChart);
  document.getElementById("logsNameSelect")?.addEventListener("change", debouncedRenderAdminChart);
}

/**
 * 追加一筆管理員紀錄（不阻擋主流程）。
 * - 只送：ts / actor
 */
async function appendAdminUsageLog_() {
  if (!USAGE_LOG_API_URL) return;
  if (!me?.userId) return;

  try {
    await usageLogPost_({
      mode: "appendUsageLog",
      ts: new Date().toISOString(),
      actor: { userId: me.userId, displayName: me.displayName },
    });
  } catch (e) {
    // 不阻擋主流程
    console.warn("appendUsageLog failed", e);
  }
}
