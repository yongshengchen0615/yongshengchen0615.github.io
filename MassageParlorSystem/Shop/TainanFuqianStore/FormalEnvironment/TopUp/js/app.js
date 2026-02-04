import { loadConfigJson, config } from "./modules/config.js";
import { dom } from "./modules/dom.js";
import { initTheme } from "./modules/theme.js";
import { showGate, hideGate, showTopLoading, hideTopLoading, setBadge, setLastUpdate, toast } from "./modules/ui.js";
import { initAuthAndGuard } from "./modules/auth.js";
import { apiPost } from "./modules/api.js";
import { state } from "./modules/state.js";
import { debounce } from "./modules/core.js";

const CACHE_STALE_MS = 25_000;

function bindEventsOnce() {
  if (state._eventsBound) return;
  state._eventsBound = true;

  const reload = () => loadSerials({ showLoading: true, force: true });

  dom.themeToggleBtn?.addEventListener("click", () => {
    // theme.js handles it
  });

  dom.reloadBtn?.addEventListener("click", reload);

  const filterChanged = debounce(() => {
    applyClientFiltersAndRender_(Date.now());
    maybeRefreshSerialsInBackground_();
  }, 120);
  dom.searchInput?.addEventListener("input", filterChanged);

  const onStatusSelectChanged = (ev) => {
    const target = ev?.target;
    const v = String(target?.value || "all");
    if (dom.listStatusSelect && dom.listStatusSelect !== target) dom.listStatusSelect.value = v;
    filterChanged();
  };

  dom.listStatusSelect?.addEventListener("change", onStatusSelectChanged);
  dom.noteSelect?.addEventListener("change", () => {
    applyClientFiltersAndRender_(Date.now());
    maybeRefreshSerialsInBackground_();
  });

  dom.genBtn?.addEventListener("click", async () => {
    try {
      const amount = Number(dom.genAmount?.value || 0);
      const count = Number(dom.genCount?.value || 0);
      const note = String(dom.genNote?.value || "").trim();

      // 功能開通設定（預設 true，以維持既有使用習慣；若 UI 元件不存在則回落到 true）
      const pushEnabled = dom.genPushEnabled ? !!dom.genPushEnabled.checked : true;
      const personalStatusEnabled = dom.genPersonalStatusEnabled ? !!dom.genPersonalStatusEnabled.checked : true;
      const scheduleEnabled = dom.genScheduleEnabled ? !!dom.genScheduleEnabled.checked : true;
      const performanceEnabled = dom.genPerformanceEnabled ? !!dom.genPerformanceEnabled.checked : true;

      if (!Number.isFinite(amount) || amount < 0) throw new Error("面額不正確");
      if (!Number.isFinite(count) || count <= 0 || count > 500) throw new Error("數量需在 1~500");

      showTopLoading("產生序號中…");
      const ret = await apiPost({
        mode: "serials_generate",
        amount,
        count,
        note,
        pushEnabled,
        personalStatusEnabled,
        scheduleEnabled,
        performanceEnabled,
        actor: state.me,
      });
      if (!ret.ok) throw new Error(ret.error || "generate failed");

      const list = Array.isArray(ret.serials) ? ret.serials : [];
      const text = list.map((s) => s.serial).filter(Boolean).join("\n");

      // genOutput textarea 已移除：改成複製到剪貼簿（best-effort）
      if (dom.genOutput) dom.genOutput.value = text;

      let copied = false;
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch (_) {
          copied = false;
        }
      }

      toast(copied ? `已產生 ${list.length} 筆（已複製）` : `已產生 ${list.length} 筆`, "ok");
      await loadSerials({ showLoading: true, force: true });
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.selectAll?.addEventListener("change", () => {
    const checked = !!dom.selectAll.checked;
    const serials = Array.isArray(state._visibleSelectableSerials) ? state._visibleSelectableSerials : [];
    if (checked) {
      for (const s of serials) state.selectedSerials.add(String(s));
    } else {
      for (const s of serials) state.selectedSerials.delete(String(s));
    }
    syncBatchUi_();
    // rerender checkboxes to reflect state
    syncRowCheckboxes_();
  });

  dom.batchVoidBtn?.addEventListener("click", async () => {
    const serials = getSelectedVisibleActiveSerials_();
    if (!serials.length) return;

    const ok = confirm(`確定批次作廢？\n\n筆數：${serials.length}`);
    if (!ok) return;

    const note = prompt("作廢原因（建議填寫）", "") ?? "";

    try {
      let okCount = 0;
      const failed = [];

      for (let i = 0; i < serials.length; i++) {
        const serial = serials[i];
        showTopLoading(`作廢中… (${i + 1}/${serials.length})`);
        const ret = await apiPost({ mode: "serials_void", serial, note: String(note || "").trim(), actor: state.me });
        if (ret?.ok) {
          okCount++;
        } else {
          failed.push({ serial, error: ret?.error || "void failed" });
        }
      }

      if (failed.length) {
        console.warn("batch void failed", failed);
        toast(`已作廢 ${okCount} 筆；失敗 ${failed.length} 筆`, "err");
      } else {
        toast(`已作廢 ${okCount} 筆`, "ok");
      }

      state.selectedSerials.clear();
      syncBatchUi_();
      await loadSerials({ showLoading: true, force: true });
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.batchDeleteBtn?.addEventListener("click", async () => {
    const serials = getSelectedVisibleSelectableSerials_();
    if (!serials.length) return;

    const ok = confirm(`確定批次刪除？\n\n筆數：${serials.length}\n\n⚠ 刪除後無法復原`);
    if (!ok) return;

    const note = prompt("刪除原因（建議填寫）", "") ?? "";

    try {
      showTopLoading("刪除中…");

      // Prefer batch endpoint (faster). Fallback to per-item loop if unsupported.
      const ret = await apiPost({ mode: "serials_delete_batch", serials, note: String(note || "").trim(), actor: state.me });
      if (!ret?.ok) {
        // fallback
        let okCount = 0;
        const failed = [];
        for (let i = 0; i < serials.length; i++) {
          const serial = serials[i];
          showTopLoading(`刪除中… (${i + 1}/${serials.length})`);
          const r = await apiPost({ mode: "serials_delete", serial, note: String(note || "").trim(), actor: state.me });
          if (r?.ok) okCount++;
          else failed.push({ serial, error: r?.error || "delete failed" });
        }
        if (failed.length) {
          console.warn("batch delete failed", failed);
          toast(`已刪除 ${okCount} 筆；失敗 ${failed.length} 筆`, "err");
        } else {
          toast(`已刪除 ${okCount} 筆`, "ok");
        }
      } else {
        const deleted = Array.isArray(ret.deleted) ? ret.deleted.length : 0;
        const failed = Array.isArray(ret.failed) ? ret.failed.length : 0;
        if (failed) toast(`已刪除 ${deleted} 筆；失敗 ${failed} 筆`, "err");
        else toast(`已刪除 ${deleted} 筆`, "ok");
      }

      state.selectedSerials.clear();
      syncBatchUi_();
      await loadSerials({ showLoading: true, force: true });
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.tbodyRows?.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const serial = btn.getAttribute("data-serial");
    if (!action || !serial) return;

    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(serial);
        toast("已複製", "ok");
        return;
      }

      if (action === "void") {
        const ok = confirm(`確定作廢？\n\n序號：${serial}`);
        if (!ok) return;
        const note = prompt("作廢原因（建議填寫）", "") ?? "";
        showTopLoading("作廢中…");
        const ret = await apiPost({ mode: "serials_void", serial, note: String(note || "").trim(), actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "void failed");
        toast("已作廢", "ok");
        await loadSerials({ showLoading: true, force: true });
        return;
      }

      if (action === "delete") {
        const ok = confirm(`確定刪除？\n\n序號：${serial}\n\n⚠ 刪除後無法復原`);
        if (!ok) return;
        const note = prompt("刪除原因（建議填寫）", "") ?? "";
        showTopLoading("刪除中…");
        const ret = await apiPost({ mode: "serials_delete", serial, note: String(note || "").trim(), actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "delete failed");
        state.selectedSerials.delete(String(serial));
        syncBatchUi_();
        toast("已刪除", "ok");
        await loadSerials({ showLoading: true, force: true });
        return;
      }

      if (action === "reactivate") {
        const ok = confirm(`確定恢復為可用？\n\n序號：${serial}`);
        if (!ok) return;
        showTopLoading("恢復中…");
        const ret = await apiPost({ mode: "serials_reactivate", serial, actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "reactivate failed");
        toast("已恢復", "ok");
        await loadSerials({ showLoading: true, force: true });
        return;
      }
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.tbodyRows?.addEventListener("change", (ev) => {
    const cb = ev.target?.closest?.("input.row-select[data-serial]");
    if (!cb) return;
    const serial = cb.getAttribute("data-serial");
    if (!serial) return;

    if (cb.checked) state.selectedSerials.add(serial);
    else state.selectedSerials.delete(serial);

    syncBatchUi_();
  });
}

function getFilters_() {
  // UI filters（僅用於前端快取過濾）
  const q = String(dom.searchInput?.value || "").trim();
  const status = String(dom.listStatusSelect?.value || "all");
  const note = String(dom.noteSelect?.value || "all");
  return { q, status, note };
}

function getServerFetchFilters_() {
  // 以「全部」作為快取母資料，避免切狀態/搜尋就重新打 API。
  // 若未來需要伺服器端搜尋/狀態篩選，再另外提供「強制伺服器篩選」模式。
  return { q: "", status: "all", amount: null };
}

function maybeRefreshSerialsInBackground_() {
  if (state._refreshing) return;
  const fetchedAt = Number(state.cache?.fetchedAtMs) || 0;
  const hasCache = Array.isArray(state.cache?.rows) && state.cache.rows.length > 0;
  if (!hasCache) return;
  if (Date.now() - fetchedAt < CACHE_STALE_MS) return;

  // 背景更新：不顯示 loadingState，成功後用同一份 UI filters 重新渲染
  loadSerials({ showLoading: false, force: false }).catch((e) => {
    // silent background refresh failure
    console.warn("background refresh failed", e);
  });
}

async function loadSerials(opts) {
  const showLoading = opts?.showLoading !== false;
  const force = opts?.force === true;

  // 若已有快取且非強制，先用快取即時渲染（避免 UI 閃爍）
  const hasCache = Array.isArray(state.cache?.rows) && state.cache.rows.length > 0;
  if (hasCache && !force) {
    state._lastRows = state.cache.rows;
    updateNoteOptions_(state._lastRows);
    applyClientFiltersAndRender_(state.cache.nowMs || Date.now());
  }

  if (showLoading) {
    dom.emptyState.style.display = "none";
    dom.errorState.style.display = "none";
    dom.loadingState.style.display = "flex";
  } else {
    dom.errorState.style.display = "none";
  }

  try {
    const seq = ++state._refreshSeq;
    state._refreshing = true;

    const ret = await apiPost({
      mode: "serials_list",
      filters: getServerFetchFilters_(),
      limit: Math.max(1, config.LIST_LIMIT || 300),
      actor: state.me,
    });
    if (!ret.ok) throw new Error(ret.error || "list failed");

    // 若期間又發起了新一輪刷新，忽略舊結果
    if (seq !== state._refreshSeq) return;

    const rows = Array.isArray(ret.serials) ? ret.serials : [];
    state._lastRows = rows;
    state.cache.rows = rows;
    state.cache.nowMs = Number(ret.now || Date.now());
    state.cache.fetchedAtMs = Date.now();

    updateNoteOptions_(rows);
    applyClientFiltersAndRender_(state.cache.nowMs);

    if (showLoading) dom.loadingState.style.display = "none";
  } catch (e) {
    console.error(e);
    if (showLoading) {
      dom.loadingState.style.display = "none";
      dom.errorState.style.display = "block";
      toast("讀取序號失敗", "err");
    }
  } finally {
    state._refreshing = false;
  }
}

function normalizeNote_(note) {
  return String(note ?? "").trim();
}

function updateNoteOptions_(rows) {
  if (!dom.noteSelect) return;

  const prev = String(dom.noteSelect.value || "all");
  const counts = new Map();
  let emptyCount = 0;

  for (const r of rows || []) {
    const note = normalizeNote_(r?.note);
    if (!note) {
      emptyCount++;
      continue;
    }
    counts.set(note, (counts.get(note) || 0) + 1);
  }

  const items = Array.from(counts.entries())
    .map(([note, count]) => ({ note, count }))
    .sort((a, b) => (b.count - a.count) || a.note.localeCompare(b.note, "zh-Hant"));

  // rebuild options
  dom.noteSelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "全部";
  dom.noteSelect.appendChild(optAll);

  if (emptyCount > 0) {
    const optEmpty = document.createElement("option");
    optEmpty.value = "__EMPTY__";
    optEmpty.textContent = `（空白） (${emptyCount})`;
    dom.noteSelect.appendChild(optEmpty);
  }

  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it.note;
    opt.textContent = `${it.note} (${it.count})`;
    dom.noteSelect.appendChild(opt);
  }

  // restore selection if still exists; otherwise reset to all
  const canKeep = Array.from(dom.noteSelect.options).some((o) => o.value === prev);
  dom.noteSelect.value = canKeep ? prev : "all";
}

function getClientFilteredRows_(rows) {
  const { q, status, note } = getFilters_();

  let out = Array.isArray(rows) ? rows : [];

  // 狀態（active/used/void）
  if (status && status !== "all") {
    out = out.filter((r) => String(r?.status || "") === status);
  }

  // 備註（下拉）
  if (note && note !== "all") {
    if (note === "__EMPTY__") out = out.filter((r) => !normalizeNote_(r?.note));
    else out = out.filter((r) => normalizeNote_(r?.note) === note);
  }

  // 搜尋（前端部分比對：序號/備註/核銷備註/面額）
  const needle = String(q || "").trim().toLowerCase();
  if (needle) {
    out = out.filter((r) => {
      const serial = String(r?.serial || "").toLowerCase();
      const noteText = String(r?.note || "").toLowerCase();
      const usedNote = String(r?.usedNote || "").toLowerCase();
      const amount = String(r?.amount ?? "").toLowerCase();
      return serial.includes(needle) || noteText.includes(needle) || usedNote.includes(needle) || amount.includes(needle);
    });
  }

  return out;
}

function applyClientFiltersAndRender_(nowMs) {
  const baseRows = Array.isArray(state._lastRows) ? state._lastRows : [];
  const shownRows = getClientFilteredRows_(baseRows);

  renderRows_(shownRows);

  // 更新可視序號（供全選/批次刪除）與可視 active（供批次作廢）
  state._visibleSelectableSerials = shownRows.map((r) => String(r.serial || "")).filter(Boolean);
  state._visibleActiveSerials = shownRows
    .filter((r) => String(r.status || "") === "active")
    .map((r) => String(r.serial || ""))
    .filter(Boolean);

  // 清掉已不存在於當前可見範圍的選取（避免跨篩選誤操作）
  const visibleSet = new Set(state._visibleSelectableSerials);
  for (const s of Array.from(state.selectedSerials)) {
    if (!visibleSet.has(String(s))) state.selectedSerials.delete(String(s));
  }
  syncBatchUi_();

  setLastUpdate(nowMs || Date.now());
  setBadge(dom.summaryBadge, `共 ${shownRows.length} 筆`);

  dom.emptyState.style.display = shownRows.length ? "none" : "block";
}

function escapeHtml_(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTs_(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    const d = new Date(n);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return "—";
  }
}

function renderRows_(rows) {
  if (!dom.tbodyRows) return;

  const getBoolOrNull_ = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (v === true || v === 1 || v === "1") return true;
    if (v === false || v === 0 || v === "0") return false;
    const s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (s === "true" || s === "y" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "n" || s === "no" || s === "off") return false;
    return null;
  };

  const resolveFeatureFlags_ = (row) => {
    const src = row?.features && typeof row.features === "object" ? row.features : row;
    return {
      pushEnabled: getBoolOrNull_(src?.pushEnabled),
      personalStatusEnabled: getBoolOrNull_(src?.personalStatusEnabled),
      scheduleEnabled: getBoolOrNull_(src?.scheduleEnabled),
      performanceEnabled: getBoolOrNull_(src?.performanceEnabled),
    };
  };

  const renderFeatBadges_ = (flags) => {
    const items = [
      { key: "pushEnabled", label: "推播" },
      { key: "personalStatusEnabled", label: "個人" },
      { key: "scheduleEnabled", label: "排班" },
      { key: "performanceEnabled", label: "業績" },
    ];

    const html = items
      .map((it) => {
        const v = flags[it.key];
        if (v === null) return `<span class="feat feat-unknown">${escapeHtml_(it.label)}：—</span>`;
        return v
          ? `<span class="feat feat-on">${escapeHtml_(it.label)}：開</span>`
          : `<span class="feat feat-off">${escapeHtml_(it.label)}：關</span>`;
      })
      .join(" ");

    return `<div class="feat-badges">${html}</div>`;
  };

  const html = rows
    .map((r) => {
      const serial = String(r.serial || "");
      const amount = r.amount ?? "";
      const status = String(r.status || "");
      const note = String(r.note || "");
      const usedNote = String(r.usedNote || "");

      const flags = resolveFeatureFlags_(r);

      const createdAt = fmtTs_(r.createdAtMs);
      const usedAt = fmtTs_(r.usedAtMs);

      const chip =
        status === "active"
          ? '<span class="chip chip-active">可用</span>'
          : status === "used"
          ? '<span class="chip chip-used">已核銷</span>'
          : '<span class="chip chip-void">已作廢</span>';

      const actions =
        status === "active"
          ? `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-danger" data-action="void" data-serial="${escapeHtml_(serial)}" type="button">作廢</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-serial="${escapeHtml_(serial)}" type="button">刪除</button>
          `
          : status === "void"
          ? `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-primary" data-action="reactivate" data-serial="${escapeHtml_(serial)}" type="button">恢復</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-serial="${escapeHtml_(serial)}" type="button">刪除</button>
          `
          : `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-serial="${escapeHtml_(serial)}" type="button">刪除</button>
          `;

      const isChecked = state.selectedSerials?.has?.(serial);

      return `
        <tr>
          <td class="select-cell" data-label="選取">
            <input class="row-select" type="checkbox" data-serial="${escapeHtml_(serial)}" ${serial ? "" : "disabled"} ${isChecked ? "checked" : ""} aria-label="選取序號" />
          </td>
          <td class="mono" data-label="序號">${escapeHtml_(serial)}</td>
          <td data-label="面額">${escapeHtml_(amount)}</td>
          <td class="td-features" data-label="功能">${renderFeatBadges_(flags)}</td>
          <td data-label="狀態">${chip}</td>
          <td data-label="建立時間">${escapeHtml_(createdAt)}</td>
          <td data-label="核銷時間">${escapeHtml_(usedAt)}</td>
          <td class="td-note" data-label="核銷備註"><div class="cell-value cell-note">${escapeHtml_(usedNote || "")}</div></td>
          <td class="td-note" data-label="備註"><div class="cell-value cell-note">${escapeHtml_(note || "")}</div></td>
          <td data-label="操作"><div class="row-actions">${actions}</div></td>
        </tr>
      `;
    })
    .join("");

  dom.tbodyRows.innerHTML = html || "";
}

function getSelectedVisibleSelectableSerials_() {
  const visible = Array.isArray(state._visibleSelectableSerials) ? state._visibleSelectableSerials : [];
  const picked = [];
  for (const s of visible) {
    if (state.selectedSerials.has(String(s))) picked.push(String(s));
  }
  return picked;
}

function getSelectedVisibleActiveSerials_() {
  const visible = Array.isArray(state._visibleActiveSerials) ? state._visibleActiveSerials : [];
  const picked = [];
  for (const s of visible) {
    if (state.selectedSerials.has(String(s))) picked.push(String(s));
  }
  return picked;
}

function syncRowCheckboxes_() {
  if (!dom.tbodyRows) return;
  const inputs = dom.tbodyRows.querySelectorAll('input.row-select[data-serial]');
  for (const el of inputs) {
    const serial = el.getAttribute('data-serial');
    if (!serial) continue;
    if (el.disabled) {
      el.checked = false;
      continue;
    }
    el.checked = state.selectedSerials.has(String(serial));
  }
}

function syncBatchUi_() {
  const selected = getSelectedVisibleSelectableSerials_();
  const selectedActive = getSelectedVisibleActiveSerials_();
  const total = Array.isArray(state._visibleSelectableSerials) ? state._visibleSelectableSerials.length : 0;

  if (dom.selectedCount) dom.selectedCount.textContent = `已選 ${selected.length}`;
  if (dom.batchVoidBtn) dom.batchVoidBtn.disabled = selectedActive.length === 0;
  if (dom.batchDeleteBtn) dom.batchDeleteBtn.disabled = selected.length === 0;

  if (dom.selectAll) {
    dom.selectAll.indeterminate = selected.length > 0 && selected.length < total;
    dom.selectAll.checked = total > 0 && selected.length === total;
    dom.selectAll.disabled = total === 0;
  }
}

async function boot() {
  initTheme();
  showGate("初始化中…");

  try {
    await loadConfigJson();

    if (dom.pageTitle) dom.pageTitle.textContent = String(config.PAGE_TITLE || "儲值序號後台");
    if (dom.subtitle) dom.subtitle.textContent = String(config.PAGE_SUBTITLE || "");

    bindEventsOnce();

    const authRes = await initAuthAndGuard();
    if (!authRes?.ok) return;

    hideGate();
    dom.appRoot?.classList.remove("app-hidden");

    await loadSerials();
  } catch (e) {
    console.error(e);
    showGate("⚠ 初始化失敗\n" + String(e.message || e), true);
  }
}

window.addEventListener("load", () => {
  boot().catch((e) => {
    console.error(e);
    showGate("⚠ 初始化失敗\n" + String(e.message || e), true);
  });
});
