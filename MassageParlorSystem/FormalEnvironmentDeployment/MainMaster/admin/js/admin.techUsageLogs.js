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

// Module-level DOM cache to avoid repeated queries
let techLogsCanvasEl = null;
let techLogsMetricSelectEl = null;
let techLogsNameSelectEl = null;
let techLogsStartDateEl = null;
let techLogsEndDateEl = null;
let techLogsStartTimeEl = null;
let techLogsEndTimeEl = null;
let techLogsTbodyEl = null;
let techLogsFooterEl = null;

function cacheTechDom_() {
  if (techLogsCanvasEl) return;
  techLogsCanvasEl = document.getElementById("techUsageChartCanvas");
  techLogsMetricSelectEl = document.getElementById('techLogsMetricSelect');
  techLogsNameSelectEl = document.getElementById('techLogsNameSelect');
  techLogsStartDateEl = document.getElementById('techLogsStartDateInput');
  techLogsEndDateEl = document.getElementById('techLogsEndDateInput');
  techLogsStartTimeEl = document.getElementById('techLogsStartTimeInput');
  techLogsEndTimeEl = document.getElementById('techLogsEndTimeInput');
  techLogsTbodyEl = document.getElementById('techLogsTbody');
  techLogsFooterEl = document.getElementById('techLogsFooterStatus');
}


function techLogsSetFooter_(text) {
  cacheTechDom_();
  if (techLogsFooterEl) techLogsFooterEl.textContent = String(text || "-");
}

function techLogsSetTbodyMessage_(msg) {
  cacheTechDom_();
  if (!techLogsTbodyEl) return;
  techLogsTbodyEl.innerHTML = `<tr><td colspan="5">${escapeHtml(msg || "-")}</td></tr>`;
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
  cacheTechDom_();
  const startDate = String(techLogsStartDateEl?.value || "").trim();
  const endDate = String(techLogsEndDateEl?.value || "").trim();
  const startTime = String(techLogsStartTimeEl?.value || "").trim();
  const endTime = String(techLogsEndTimeEl?.value || "").trim();

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
      if (techLogsStartDateEl) techLogsStartDateEl.value = startDate || "";
      if (techLogsEndDateEl) techLogsEndDateEl.value = endDate || "";
      if (techLogsStartTimeEl) techLogsStartTimeEl.value = startTime || "";
      if (techLogsEndTimeEl) techLogsEndTimeEl.value = endTime || "";
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
  cacheTechDom_();
  if (!techLogsTbodyEl) return;

  if (!techUsageLogs_.length) {
    techLogsTbodyEl.innerHTML = `<tr><td colspan="5">無資料</td></tr>`;
    return;
  }

  techLogsTbodyEl.innerHTML = techUsageLogs_
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
  if (typeof parseDateFlexible === 'function') return parseDateFlexible(s);
  const d = new Date(String(s || ''));
  return Number.isFinite(d.getTime()) ? d : null;
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

function buildTechChartAggregation_(granularity = "day", metric = "count", start = "", end = "", nameFilter = "") {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const buckets = new Map();
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  let processed = 0;
  let skipped = 0;

  // 嘗試從多個欄位或 row 內容擷取可解析的日期
  function extractDateFromRow(r) {
    // 優先使用常見欄位
    const cand = [r?.serverTime, r?.ts, r?.time, r?.clientTs, r?.createdAt, r?.date];
    for (const v of cand) {
      const d = parseDateSafe(v);
      if (d) return d;
    }

    // 嘗試從 detail / name / 其他字串中抓 YYYY-MM-DD 或 YYYY/MM/DD
    const text = String(JSON.stringify(r || {}));
    const m1 = text.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
    if (m1) {
      const d = parseDateSafe(m1[1].replace(/\//g, "-"));
      if (d) return d;
    }

    // 嘗試抓 epoch（10 或 13 位數）
    const m2 = text.match(/\b(\d{10,13})\b/);
    if (m2) {
      const n = Number(m2[1]);
      const ms = m2[1].length === 10 ? n * 1000 : n;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  for (const r of techUsageLogsAll_) {
    const d = extractDateFromRow(r);
    if (!d) {
      skipped += 1;
      continue;
    }
    processed += 1;
    if (startDate && d < startDate) continue;
    if (endDate && d > endDate) continue;

    // filter by technician name when requested
    if (nameFilter && String(r.name || '') !== String(nameFilter)) continue;

    let key;
    if (granularity === "week") key = weekKey(d);
    else if (granularity === "month") key = monthKey(d);
    else if (granularity === "hour") {
      key = `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())} ${pad2_(d.getHours())}:00`;
    } else {
      key = `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
    }

    if (!buckets.has(key)) buckets.set(key, { count: 0, users: new Set() });
    const entry = buckets.get(key);
    entry.count += 1;
    if (r.userId) entry.users.add(String(r.userId));
  }

  // convert to sorted arrays
  const keys = Array.from(buckets.keys()).sort();
  // DEBUG: aggregation summary
  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  console.debug("buildTechChartAggregation summary:", { granularity, metric, start, end, nameFilter, processed, skipped, bucketCount: keys.length, sampleKeys: keys.slice(0,5), durationMs: Math.round(t1 - t0) });
  const labels = keys;
  const data = keys.map((k) => (metric === "unique" ? buckets.get(k).users.size : buckets.get(k).count));
  return { labels, data };
}

function initTechUsageChart_() {
  cacheTechDom_();
  if (!techLogsCanvasEl || typeof Chart === "undefined") return;
  const ctx = techLogsCanvasEl.getContext("2d");
  // reuse existing instance when possible
  if (techUsageChart && techUsageChart.ctx === ctx) {
    // keep existing chart
  } else {
    try { if (techUsageChart) techUsageChart.destroy(); } catch (_) {}
  }
  techUsageChart = new Chart(ctx, {
    type: "line",
    data: { datasets: [{ label: "事件數", data: [], fill: true, borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.12)" }] },
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

function renderTechUsageChart_() {
  cacheTechDom_();
  if (!techLogsCanvasEl) return;
  if (!techUsageChart) initTechUsageChart_();
  if (!techUsageChart) return;

  // 自動決定分桶：若使用者提供時間（T），改為小時分桶以呈現時間範圍
  const { start, end } = techLogsGetSelectedRange_();
  let gran = "day";
  // 若 start 或 end 包含時間部分（ISO 'T'）或使用者填了 time inputs，使用 hour
  if ((String(start).includes("T") || String(end).includes("T")) && String(start || end).trim() !== "") {
    gran = "hour";
  }
  const metric = "count";
  const metricFromUI = techLogsMetricSelectEl ? String(techLogsMetricSelectEl.value || 'count') : 'count';
  const nameFromUI = techLogsNameSelectEl ? String(techLogsNameSelectEl.value || '') : '';
  const agg = buildTechChartAggregation_(gran, metricFromUI, start, end, nameFromUI);

  // DEBUG: 輸出聚合結果以便排查 labels/data 為何為空
  console.debug("techUsageChart aggregation:", { gran, metric: metricFromUI, nameFilter: nameFromUI, start, end, labels: agg.labels, data: agg.data, totalRows: techUsageLogsAll_.length });

    // 若 hourly 分桶過多，回退到日或月分桶以避免過密的 x axis
    if (agg.labels.length > 60 && gran === "hour") {
      console.warn("techUsageChart: too many hourly buckets, falling back to day granularity");
      gran = "day";
      const agg2 = buildTechChartAggregation_(gran, metricFromUI, start, end, nameFromUI);
      console.debug("techUsageChart fallback aggregation:", { gran, labels: agg2.labels.length });
      agg.labels = agg2.labels;
      agg.data = agg2.data;
    }
    if (agg.labels.length > 365 && gran !== "month") {
      console.warn("techUsageChart: too many daily buckets, falling back to month granularity");
      gran = "month";
      const agg2 = buildTechChartAggregation_(gran, metricFromUI, start, end, nameFromUI);
      agg.labels = agg2.labels;
      agg.data = agg2.data;
    }

    // convert labels/data to {x,y} points using numeric timestamp (ms)
    const points = agg.labels.map((lbl, i) => {
      let x = lbl;
      if (/^\d{4}-\d{2}-\d{2}$/.test(lbl)) x = `${lbl}T00:00:00`;
      if (/^\d{4}-\d{2}$/.test(lbl)) x = `${lbl}-01T00:00:00`;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(lbl)) x = lbl.replace(' ', 'T') + ':00';
      const d = parseDateSafe(x) || parseDateSafe(lbl);
      const ms = d ? d.getTime() : null;
      return { x: ms !== null ? ms : String(x), y: agg.data[i] };
    });
    // only update chart when points changed
    const old = techUsageChart.data.datasets[0].data || [];
    let same = false;
    if (old.length === points.length) {
      same = old.every((o, idx) => {
        const p = points[idx];
        return (o.x === p.x || String(o.x) === String(p.x)) && Number(o.y) === Number(p.y);
      });
    }
    if (!same) {
      techUsageChart.data.datasets[0].data = points;
      techUsageChart.data.datasets[0].label = metricFromUI === "unique" ? "不同使用者數" : "事件數";
      techUsageChart.update();
    }
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
    // set default range inputs to earliest and latest timestamps (include time if available)
    (function setDefaultRange() {
      let minD = null;
      let maxD = null;
      function extractDateFromRowText(r) {
        const text = String(JSON.stringify(r || {}));
        const m1 = text.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(:\d{2})?)?)/);
        if (m1) {
          const dd = parseDateSafe(m1[1].replace(/\//g, '-'));
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

      for (const r of techUsageLogsAll_) {
        let d = parseDateSafe(r.serverTime);
        if (!d) d = extractDateFromRowText(r);
        if (!d) continue;
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
      }

      console.debug('techUsage setDefaultRange rows=', techUsageLogsAll_.length, 'minD=', minD, 'maxD=', maxD);
      const startEl = document.getElementById("techLogsStartDateInput");
      const endEl = document.getElementById("techLogsEndDateInput");
      const startTimeEl = document.getElementById("techLogsStartTimeInput");
      const endTimeEl = document.getElementById("techLogsEndTimeInput");
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

    // timing: measure parsing/processing time
    try {
      const tAfter = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      console.debug('loadTechUsageLogs: rows=', techUsageLogsAll_.length, 'processedTimeStamp=', tAfter);
    } catch (_) {}

    // populate technician name select
    (function populateTechNameSelect() {
      const sel = document.getElementById('techLogsNameSelect');
      if (!sel) return;
      const names = Array.from(new Set(techUsageLogsAll_.map((r) => String(r.name || '').trim()).filter(Boolean))).sort();
      const cur = String(sel.value || '');
      sel.innerHTML = '<option value="">全部</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
      if (cur) sel.value = cur;
    })();

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
  // debounce chart render to avoid frequent heavy recomputations
  const debouncedRenderTechChart = debounce(() => renderTechUsageChart_(), 200);
  document.getElementById("techLogsStartDateInput")?.addEventListener("change", debouncedRenderTechChart);
  document.getElementById("techLogsEndDateInput")?.addEventListener("change", debouncedRenderTechChart);
  document.getElementById("techLogsStartTimeInput")?.addEventListener("change", debouncedRenderTechChart);
  document.getElementById("techLogsEndTimeInput")?.addEventListener("change", debouncedRenderTechChart);
  document.getElementById("techLogsMetricSelect")?.addEventListener("change", debouncedRenderTechChart);
  document.getElementById("techLogsNameSelect")?.addEventListener("change", debouncedRenderTechChart);
}
