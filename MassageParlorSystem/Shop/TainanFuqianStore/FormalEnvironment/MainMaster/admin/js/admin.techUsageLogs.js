/* ================================
 * Admin - 技師使用紀錄（usage_log）
 * - 顯示欄位：serverTime / eventCn / userId / name / detail
 * - 透過 TECH_USAGE_LOG_URL 呼叫 GAS（GET）：mode=list
 * ================================ */

/** @type {{serverTime:string, eventCn?:string, userId:string, name:string, detail:string, parsedDetail?:object}[]} */
let techUsageLogs_ = [];

/** @type {{serverTime:string, eventCn?:string, userId:string, name:string, detail:string, parsedDetail?:object}[]} */
let techUsageLogsAll_ = [];

let techUsageLogsLoading_ = false;

// Chart instance for tech usage analytics
let techUsageChart = null;
let techUsageChartObserver = null;

// Module-level DOM cache to avoid repeated queries
let techLogsCanvasEl = null;
let techLogsMetricSelectEl = null;
let techLogsNameSelectEl = null;
let techLogsGranularitySelectEl = null;
let techLogsEventSelectEl = null;
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
  techLogsGranularitySelectEl = document.getElementById('techLogsGranularitySelect');
  techLogsEventSelectEl = document.getElementById('techLogsEventSelect');
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
  techLogsTbodyEl.innerHTML = `<tr><td colspan="6">${escapeHtml(msg || "-")}</td></tr>`;
}

function normalizeTechUsageRow_(r) {
  // 允許多種回傳格式
  const serverTime = String(r?.serverTime ?? r?.ts ?? r?.time ?? "");
  const userId = String(r?.userId ?? r?.lineUserId ?? "");
  const name = String(r?.name ?? r?.displayName ?? "");
  const eventCn = String(r?.eventCn ?? r?.event_cn ?? r?.event ?? "");
  const detailRaw = r?.detail ?? "";
  const detail = String(detailRaw);
  // 嘗試解析 detail 為 JSON，方便前端顯示結構化內容
  let parsedDetail = null;
  try {
    if (detail && typeof detail === 'string' && detail.trim().startsWith('{')) {
      parsedDetail = JSON.parse(detail);
    } else if (detailRaw && typeof detailRaw === 'object') {
      parsedDetail = detailRaw;
    }
  } catch (e) {
    parsedDetail = null;
  }
  return { serverTime, userId, name, eventCn, detail, parsedDetail };
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
  function formatForFooter(s) {
    const str = String(s || '').trim();
    if (!str) return '';
    const d = parseDateSafe(str);
    if (d) {
      const hasTime = /[T\s]\d{1,2}:\d{2}/.test(str);
      const Y = d.getFullYear();
      const M = pad2_(d.getMonth() + 1);
      const D = pad2_(d.getDate());
      const h = pad2_(d.getHours());
      const m = pad2_(d.getMinutes());
      const sec = pad2_(d.getSeconds());
      return hasTime ? `${Y}-${M}-${D} ${h}:${m}:${sec}` : `${Y}-${M}-${D}`;
    }
    return str.replace('T', ' ');
  }

  const fs = formatForFooter(start);
  const fe = formatForFooter(end);
  if (fs && fe) return fs === fe ? fs : `${fs} ~ ${fe}`;
  if (fs) return `>= ${fs}`;
  if (fe) return `<= ${fe}`;
  return "";
}

function applyTechUsageLogsDateFilter_() {
  const { start, end } = techLogsGetSelectedRange_();
  // 也看到 UI 的名稱選單，若有選擇名稱則一併過濾
  const nameFilter = techLogsNameSelectEl ? String(techLogsNameSelectEl.value || '') : (document.getElementById('techLogsNameSelect') ? String(document.getElementById('techLogsNameSelect').value || '') : '');
  const eventFilter = techLogsEventSelectEl ? String(techLogsEventSelectEl.value || '') : (document.getElementById('techLogsEventSelect') ? String(document.getElementById('techLogsEventSelect').value || '') : '');

  if (!start && !end && !nameFilter) {
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
    if (nameFilter && String(r.name || '') !== nameFilter) return false;
    if (eventFilter && String((r.eventCn || r.event || '') || '') !== eventFilter) return false;
    return true;
  });
}

function renderTechUsageLogs_() {
  cacheTechDom_();
  if (!techLogsTbodyEl) return;

  if (!techUsageLogs_.length) {
    techLogsTbodyEl.innerHTML = `<tr><td colspan="6">無資料</td></tr>`;
    return;
  }

  techLogsTbodyEl.innerHTML = techUsageLogs_
    .map((r, i) => {
      const detailHtml = (r && r.parsedDetail)
        ? `<pre class="tech-log-json" style="white-space:pre-wrap;max-width:36rem;overflow:auto;margin:0">${escapeHtml(JSON.stringify(r.parsedDetail, null, 2))}</pre>`
        : `<span style="white-space:pre-wrap;max-width:36rem;display:inline-block">${escapeHtml(r.detail)}</span>`;
      // format serverTime to YYYY-MM-DD HH:MM:SS (if time present) or YYYY-MM-DD
      let serverTimeDisplay = String(r.serverTime || '');
      try {
        const d = parseDateSafe(r.serverTime);
        if (d) {
          const Y = d.getFullYear();
          const M = pad2_(d.getMonth() + 1);
          const D = pad2_(d.getDate());
          const h = pad2_(d.getHours());
          const m = pad2_(d.getMinutes());
          const s = pad2_(d.getSeconds());
          const hasTime = /[T\s]\d{1,2}:\d{2}/.test(String(r.serverTime));
          serverTimeDisplay = hasTime ? `${Y}-${M}-${D} ${h}:${m}:${s}` : `${Y}-${M}-${D}`;
        }
      } catch (_) {}

      return `
        <tr>
          <td data-label="#">${i + 1}</td>
          <td data-label="serverTime"><span style="font-family:var(--mono)">${escapeHtml(serverTimeDisplay)}</span></td>
          <td data-label="eventCn">${escapeHtml(r.eventCn || '')}</td>
          <td data-label="userId"><span style="font-family:var(--mono)">${escapeHtml(r.userId)}</span></td>
          <td data-label="name">${escapeHtml(r.name)}</td>
          <td data-label="detail">${detailHtml}</td>
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

function buildTechChartAggregation_(granularity = "day", metric = "count", start = "", end = "", nameFilter = "", eventFilter = "") {
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
    // filter by event type when requested
    if (eventFilter && String((r.eventCn || r.event || '') || '') !== String(eventFilter)) continue;

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
  if (!techLogsCanvasEl || typeof echarts === "undefined") return;
  try { if (techUsageChart && typeof techUsageChart.dispose === 'function') techUsageChart.dispose(); } catch (_) {}
  try {
    techUsageChart = echarts.init(techLogsCanvasEl, null, { renderer: 'canvas', devicePixelRatio: window.devicePixelRatio || 1 });
  } catch (e) {
    console.warn('echarts init failed', e);
    techUsageChart = null;
    return;
  }
  const baseOption = {
    color: ['#06b6d4'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params;
      if (!p) return '';
      // safely extract timestamp and value from various shapes
      let ts = null;
      let val = null;
      if (p.data && Array.isArray(p.data)) {
        ts = p.data[0];
        val = p.data[1];
      } else if (p.value && Array.isArray(p.value)) {
        ts = p.value[0];
        val = p.value[1];
      } else if (p.data != null) {
        val = p.data;
      } else if (p.value != null) {
        val = p.value;
      }
      let label = p.name || '';
      if (ts != null) {
        const d = new Date(ts);
        if (!Number.isNaN(d.getTime())) {
          label = `${d.getFullYear()}-${pad2_(d.getMonth()+1)}-${pad2_(d.getDate())}` + (d.getHours() || d.getMinutes() ? ` ${pad2_(d.getHours())}:${pad2_(d.getMinutes())}` : '');
        }
      }
      const seriesName = p.seriesName || '';
      return `${label}${seriesName ? '<br/>' + seriesName + ': ' : ''}${val != null ? val : '-'}`;
    } },
    legend: { data: [] },
    grid: { left: '8%', right: '6%', bottom: '14%' },
    xAxis: { type: 'time', boundaryGap: false, axisLabel: { formatter: null, rotate: 0, interval: 'auto' } },
    yAxis: { type: 'value', min: 0 },
    series: [{ name: '事件數', type: 'line', smooth: true, showSymbol: false, itemStyle: { color: '#06b6d4' }, areaStyle: { color: 'rgba(6,182,212,0.12)' }, data: [], sampling: 'lttb', large: false }],
    dataZoom: []
  };
  techUsageChart.setOption(baseOption);
  // resize handling: prefer ResizeObserver for container changes
  try {
    if (techUsageChartObserver && typeof techUsageChartObserver.disconnect === 'function') techUsageChartObserver.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      techUsageChartObserver = new ResizeObserver(() => techUsageChart && techUsageChart.resize());
      techUsageChartObserver.observe(techLogsCanvasEl);
    } else {
      window.addEventListener('resize', () => techUsageChart && techUsageChart.resize());
    }
  } catch (_) {}
}

function renderTechUsageChart_() {
  cacheTechDom_();
  if (!techLogsCanvasEl) return;
  if (!techUsageChart) initTechUsageChart_();
  if (!techUsageChart) return;

  const { start, end } = techLogsGetSelectedRange_();
  // 粒度可由 UI 指定（auto/ hour/ day/ week/ month）
  const granFromUI = techLogsGranularitySelectEl ? String(techLogsGranularitySelectEl.value || 'auto') : 'auto';
  let gran = 'day';
  if (granFromUI && granFromUI !== 'auto') {
    gran = granFromUI;
  } else {
    if ((String(start).includes("T") || String(end).includes("T")) && String(start || end).trim() !== "") gran = "hour";
    else gran = 'day';
  }
  const metricFromUI = techLogsMetricSelectEl ? String(techLogsMetricSelectEl.value || 'count') : 'count';
  const nameFromUI = techLogsNameSelectEl ? String(techLogsNameSelectEl.value || '') : '';
  const eventFromUI = techLogsEventSelectEl ? String(techLogsEventSelectEl.value || '') : '';
  let agg = buildTechChartAggregation_(gran, metricFromUI, start, end, nameFromUI, eventFromUI);

  if (agg.labels.length > 60 && gran === "hour") {
    gran = "day";
    agg = buildTechChartAggregation_(gran, metricFromUI, start, end, nameFromUI, eventFromUI);
  }
  if (agg.labels.length > 365 && gran !== "month") {
    gran = "month";
    agg = buildTechChartAggregation_(gran, metricFromUI, start, end, nameFromUI, eventFromUI);
  }

  // build series data as [ [timestamp, value], ... ]
  const seriesData = agg.labels.map((lbl, i) => {
    let x = lbl;
    if (/^\d{4}-\d{2}-\d{2}$/.test(lbl)) x = `${lbl}T00:00:00`;
    if (/^\d{4}-\d{2}$/.test(lbl)) x = `${lbl}-01T00:00:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(lbl)) x = lbl.replace(' ', 'T') + ':00';
    const d = parseDateSafe(x) || parseDateSafe(lbl);
    const ms = d ? d.getTime() : null;
    return [ ms !== null ? ms : String(x), agg.data[i] ];
  });

  try {
    const canvasEl = document.getElementById('techUsageChartCanvas');
    if (canvasEl && Array.isArray(agg.labels)) {
      const minW = Math.max(600, agg.labels.length * 40);
      canvasEl.style.minWidth = `${minW}px`;
    }
  } catch (e) { /* ignore */ }

  // update option with responsiveness helpers
  const seriesName = metricFromUI === 'unique' ? '不同使用者數' : '事件數';
  const maxVisible = 120;
  const total = seriesData.length;
  const dataZoom = [];
  if (total > maxVisible) {
    const startPct = Math.max(0, ((total - maxVisible) / total) * 100);
    dataZoom.push({ type: 'slider', start: startPct, end: 100, handleSize: 8 });
    // enable wheel/inside zoom for touch/desktop
    dataZoom.push({ type: 'inside', start: startPct, end: 100 });
  }

  const useLarge = total > 800;
  const sampling = total > 300 ? 'lttb' : false;

  // compute responsive label settings
  const containerWidth = (techLogsCanvasEl && techLogsCanvasEl.clientWidth) ? techLogsCanvasEl.clientWidth : (window.innerWidth || 360);
  const approxTickWidth = 60; // px per tick heuristic
  const maxTicks = Math.max(4, Math.floor(containerWidth / approxTickWidth));
  const step = Math.max(1, Math.ceil(total / maxTicks));
  const axisInterval = Math.max(0, step - 1);
  const rotate = total > maxTicks ? 45 : 0;
  const fontSize = Math.max(9, Math.min(14, Math.round(containerWidth / 80)));

  const axisFormatter = (val) => {
    const d = new Date(val);
    if (gran === 'hour') return `${pad2_(d.getMonth()+1)}-${pad2_(d.getDate())} ${pad2_(d.getHours())}:00`;
    if (gran === 'month') return `${d.getFullYear()}-${pad2_(d.getMonth()+1)}`;
    // day
    return `${pad2_(d.getMonth()+1)}-${pad2_(d.getDate())}`;
  };

  const option = {
    legend: { data: [seriesName] },
    xAxis: { type: 'time', axisLabel: { formatter: axisFormatter, rotate: rotate, interval: axisInterval, showMinLabel: true, showMaxLabel: true, fontSize: fontSize } },
    series: [{ name: seriesName, type: 'line', smooth: true, showSymbol: false, itemStyle: { color: '#06b6d4' }, areaStyle: { color: 'rgba(6,182,212,0.12)' }, data: seriesData, large: useLarge, sampling: sampling }],
    dataZoom: dataZoom
  };
  try { techUsageChart.setOption(option, { notMerge: false }); } catch (e) { console.warn('echarts setOption failed', e); }
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
    // 支援兩種分頁風格：
    // 1) token-based: 回傳 nextPageToken
    // 2) offset-based: 回傳 nextOffset（此 repo 的 GAS 使用 nextOffset）
    // 我們每次以固定 limit 分頁抓取，直到沒有 nextPageToken / nextOffset
    let allRowsRaw = [];
    let pageToken = null;
    let offset = 0;
    const perPage = 2000; // 每頁上限，可調整

    while (true) {
      const q = { mode: "list", limit: perPage };
      if (pageToken) q.pageToken = pageToken;
      else if (offset) q.offset = offset;

      const ret = await techUsageLogGet_(q);
      if (!ret || ret.ok === false) {
        if (!allRowsRaw.length) throw new Error(ret?.error || "list failed");
        break;
      }

      let rows = [];
      if (Array.isArray(ret.rows)) rows = ret.rows;
      else if (Array.isArray(ret.logs)) rows = ret.logs;
      else if (Array.isArray(ret.values)) {
        // values correspond to HEADERS: serverTime,event,eventCn,userId,name,clientTs,clientIso,tz,href,detail
        rows = ret.values.map((v) => ({
          serverTime: v?.[0],
          event: v?.[1],
          eventCn: v?.[2],
          userId: v?.[3],
          name: v?.[4],
          clientTs: v?.[5],
          clientIso: v?.[6],
          tz: v?.[7],
          href: v?.[8],
          detail: v?.[9],
        }));
      }

      if (rows.length) allRowsRaw.push(...rows);

      // token-based pagination
      if (ret.nextPageToken) {
        pageToken = String(ret.nextPageToken);
        continue;
      }

      // offset-based pagination (nextOffset 表示已回傳的筆數)
      if (ret.nextOffset !== undefined && ret.nextOffset !== null) {
        const no = Number(ret.nextOffset);
        if (!Number.isNaN(no) && no > offset) {
          offset = no;
          pageToken = null;
          continue;
        }
      }

      // 若兩者皆無，結束
      break;
    }

    techUsageLogsAll_ = allRowsRaw
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

    // populate event type select and technician name select
    (function populateTechEventAndNameSelect() {
      const evtSel = document.getElementById('techLogsEventSelect');
      if (evtSel) {
        // 統計每個事件類型的次數，並依次數降冪排序（同數則依名稱升冪）
        const eventCounts = techUsageLogsAll_.reduce((m, r) => {
          const ev = String(r.eventCn || r.event || '').trim();
          if (!ev) return m;
          m[ev] = (m[ev] || 0) + 1;
          return m;
        }, {});
        const eventsArr = Object.keys(eventCounts).map(k => ({ name: k, count: eventCounts[k] }));
        eventsArr.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
        const curEvt = String(evtSel.value || '');
        evtSel.innerHTML = '<option value="">全部</option>' + eventsArr.map(e => `<option value="${escapeHtml(e.name)}">(${escapeHtml(String(e.count))}) ${escapeHtml(e.name)}</option>`).join('');
        if (curEvt) evtSel.value = curEvt;
      }

      const nameSel = document.getElementById('techLogsNameSelect');
      if (!nameSel) return;
      const selectedEvent = evtSel ? String(evtSel.value || '') : '';
      const filtered = selectedEvent ? techUsageLogsAll_.filter(r => String((r.eventCn || r.event || '') || '') === selectedEvent) : techUsageLogsAll_;
      // 統計每位技師的事件數，並依事件數降冪排序（同數則依名稱升冪）
      const counts = filtered.reduce((m, r) => {
        const nm = String(r.name || '').trim();
        if (!nm) return m;
        m[nm] = (m[nm] || 0) + 1;
        return m;
      }, {});
      const nameArr = Object.keys(counts).map(n => ({ name: n, count: counts[n] }));
      nameArr.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
      const cur = String(nameSel.value || '');
      nameSel.innerHTML = '<option value="">全部</option>' + nameArr.map(o => `<option value="${escapeHtml(o.name)}">(${escapeHtml(o.count)}) ${escapeHtml(o.name)}</option>`).join('');
      if (cur) nameSel.value = cur;
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
    // notify that tech usage logs rendered (dispatch on next rAF to ensure repaint/chart init)
    try {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          try {
            window.dispatchEvent(new CustomEvent('admin:rendered', { detail: 'techUsageLogs' }));
          } catch (e) {}
        });
      } else {
        try {
          window.dispatchEvent(new CustomEvent('admin:rendered', { detail: 'techUsageLogs' }));
        } catch (e) {}
      }
    } catch (e) {}
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
    const stTime = document.getElementById("techLogsStartTimeInput");
    const enTime = document.getElementById("techLogsEndTimeInput");
    if (stTime) stTime.value = "";
    if (enTime) enTime.value = "";
    const nameSel = document.getElementById('techLogsNameSelect');
    if (nameSel) nameSel.value = '';
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
  // 當使用者選擇名稱時，同步套用到表格過濾
  document.getElementById('techLogsNameSelect')?.addEventListener('change', onRangeChange);
  document.getElementById('techLogsEventSelect')?.addEventListener('change', () => {
    // when event type changes, repopulate name select to match event, then apply filter
    const evtSel = document.getElementById('techLogsEventSelect');
    const nameSel = document.getElementById('techLogsNameSelect');
    if (nameSel) {
      const selectedEvent = evtSel ? String(evtSel.value || '') : '';
      const filtered = selectedEvent ? techUsageLogsAll_.filter(r => String((r.eventCn || r.event || '') || '') === selectedEvent) : techUsageLogsAll_;
      const counts = filtered.reduce((m, r) => {
        const nm = String(r.name || '').trim();
        if (!nm) return m;
        m[nm] = (m[nm] || 0) + 1;
        return m;
      }, {});
      const nameArr = Object.keys(counts).map(n => ({ name: n, count: counts[n] }));
      nameArr.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
      const cur = String(nameSel.value || '');
      nameSel.innerHTML = '<option value="">全部</option>' + nameArr.map(o => `<option value="${escapeHtml(o.name)}">(${escapeHtml(o.count)}) ${escapeHtml(o.name)}</option>`).join('');
      if (cur) nameSel.value = cur;
    }
    onRangeChange();
  });
  
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
  document.getElementById("techLogsEventSelect")?.addEventListener("change", debouncedRenderTechChart);
  document.getElementById("techLogsGranularitySelect")?.addEventListener("change", debouncedRenderTechChart);
}
