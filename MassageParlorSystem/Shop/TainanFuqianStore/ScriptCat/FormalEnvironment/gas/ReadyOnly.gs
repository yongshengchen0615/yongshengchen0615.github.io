/**
 * GAS Web App - Ready Event Receiver + LINE Push
 * ✅ 技師對應單推版 + ReadyLog 自動修剪 + 台北時間 timestamp
 * ✅ 429 / 5xx 自動重試：入 ReadyQueue + 指數退避（含 nextAt / retryCount）
 * ✅ 技師編號規格化：08 / 8 / "08號" 都視為同一個 techNo（避免 NO_TARGET）
 * ✅ ReadyLog 新增推播時間紀錄：pushStartAt / pushEndAt / pushDurationMs
 *
 * ✅【新增】Dedup Bypass（測試專用）：
 * - 正式：維持 dedup（Cache 5s）
 * - 測試：payload.source in ["test_plan","stress"] 時，跳過 dedup → 同一 userId 連發也會每次推
 * - 也支援 payload.forcePush=true 強制跳過 dedup（可選）
 *
 * ✅【本覆蓋版修正重點】(你要解的 ReadyQueue 偶發 masterId 變空)
 * 1) 修正 CONFIG 欄位命名：READY_HEADERS（避免 ReadyLog 寫入直接壞）
 * 2) ReadyQueue 讀取改成「表頭 Header Map」：不怕你插欄/移欄/順序變動（根治偶發讀錯欄位）
 * 3) Queue Processor 全段加鎖：避免 trigger 重入造成重複推/狀態覆蓋
 * 4) masterId/panel 必填驗證：空就不推、寫 log/queue 也會標 BAD_PAYLOAD（避免 techNo=(norm=)）
 *
 * ⚠️ Security:
 * - DO NOT hardcode LINE token in code.
 * - Put it in Script Properties: LINE_CHANNEL_ACCESS_TOKEN
 */

/* ===========================
 * Feature flags & Quick rollback
 * ===========================
 * This file exposes several runtime toggles in `CONFIG` (top of file).
 * Quick operations (via HTTP GET to your deployed Web App):
 * - Evaluate protect mode:  /exec?mode=eval_protect
 * - Force enable protect:  /exec?mode=protect_on&reason=manual
 * - Force disable protect: /exec?mode=protect_off
 *
 * Quick rollback steps (if new behavior causes issues):
 * 1) Disable Protect auto mode: set `CONFIG.PROTECT.ENABLED = false` and redeploy,
 *    or call /exec?mode=protect_off to turn off active protect flag.
 * 2) Turn off fetchAll parallel mode: set `CONFIG.MULTICAST_USE_FETCHALL = false` and redeploy.
 * 3) Restore push limits: set `CONFIG.MAX_PUSHES_PER_MINUTE` to a high value (e.g. 10000) and redeploy.
 * 4) If immediate rollback needed, edit this script to revert CONFIG values and redeploy previous version.
 *
 * Notes:
 * - Protect mode will also write a `PROTECT_ON` / `PROTECT_OFF` entry into ReadyLog for auditing.
 * - Prefer changing Script Properties or CONFIG flags and performing a small-scale test before full traffic.
 */

/* ===========================
 * CONFIG
 * =========================== */
const CONFIG = {
  SPREADSHEET_ID: "163TfHRLg-kZJ0CbwnDpmcFNvp30NBeUJULkW6WH5-og",
  SHEET_READY_LOG: "ReadyLog",
  SHEET_USERS: "Users",
  SHEET_QUEUE: "ReadyQueue",

  LOCK_WAIT_MS: 15000,

  // ✅ ReadyLog 表頭（含推播時間紀錄）【修正：統一使用 READY_HEADERS】
  READY_HEADERS: [
    "timestamp",
    "panel",
    "masterId",
    "status",
    "index",
    "appointment",
    "remaining",
    "bgStatus",
    "colorStatus",
    "pushCode",
    "pushResp",
    "pushedCount",
    "targetCount",
    "pushStartAt",
    "pushEndAt",
    "pushDurationMs",
  ],

  USERS_COL: {
    userId: 1,
    name: 2,
    auditStatus: 3,
    startDate: 5,
    durationDays: 6,
    techNo: 7,
    isMaster: 8,
    pushEnabled: 9,
  },

  // ✅ 正式 dedup 視窗（秒）
  READY_DEDUP_SEC: 5,

  // ✅【新增】測試 Dedup Bypass 規則
  DEDUP_BYPASS: {
    ENABLED: true,
    SOURCES: ["test_plan", "stress"],
    ALLOW_FORCE_PUSH: true,
    // When false (default), bypass is ignored in production environment
    ALLOW_IN_PROD: false,
  },

  LINE_TOKEN_PROP_KEY: "LINE_CHANNEL_ACCESS_TOKEN",
  LINE_PUSH_ENABLED: true,

  MESSAGE_TEMPLATE: "{masterId}號技師｜{panel} 已準備（{timeHHmm}）{appointmentPart}",
  TEST_PUSH_TEMPLATE: "【測試推播】{timeHHmm}｜推播系統正常",

  MAX_PUSH_TARGETS: 200,
  MULTICAST_BATCH_SIZE: 450,

  // ✅ ReadyQueue 表頭（固定語意，但讀取已改 header map → 不怕順序變）
  QUEUE_HEADERS: [
    "timestamp",
    "panel",
    "masterId",
    "index",
    "appointment",
    "remaining",
    "bgStatus",
    "colorStatus",
    "retryCount",
    "nextAt",
    "qStatus",
    "lastCode",
    "lastResp",
    "updatedAt",
    "createdAt",
  ],
  QUEUE_BATCH_SIZE: 50,

  RETRY_MAX: 6,
  RETRY_BASE_DELAY_SEC: 10,
  RETRY_MAX_DELAY_SEC: 600,
  RETRY_JITTER_SEC: 10,

  READYLOG_KEEP_ROWS: 2000,
  READYLOG_TRIM_BATCH: 200,

  // ✅ Burst（1 分鐘觸發器內，用 sleep 做秒級補推）
  QUEUE_BURST: {
    ENABLED: true,
    RUN_WINDOW_MS: 45000,
    STEP_MS: 500,
  },

  // ✅【新增】Queue Processor 鎖（避免重入）
  QUEUE_PROCESSOR_LOCK_WAIT_MS: 2000,
  // ✅ multicast gap (ms) between batches to smooth outgoing requests
  MULTICAST_BATCH_SEND_GAP_MS: 150,
  // ✅ techIndex cache TTL (seconds) to reduce Spreadsheet I/O
  TECHINDEX_CACHE_TTL_SEC: 30,
  // ✅ max pushes per minute (global protective gate)
  MAX_PUSHES_PER_MINUTE: 300,
  // Protect mode configuration: auto-engage when 429s or push ratio high
  PROTECT: {
    ENABLED: true,
    TRIGGER_429: 5,
    TRIGGER_PUSH_RATIO: 0.8,
    DURATION_SEC: 300,
    GAP_MULTIPLIER: 3,
    REDUCED_MAX_PUSH_PER_MINUTE: 100,
  },
  // Environment: 'prod' or 'dev' - in prod we block test bypass by default
  ENVIRONMENT: "prod",
};

/* ===========================
 * Entry
 * =========================== */

function doGet(e) {
  try {
    const mode = (e && e.parameter && e.parameter.mode) || "ping";
    if (mode === "ping") return jsonResponse_({ ok: true, mode, ts: new Date().toISOString() });
    if (mode === "queue_stats") return jsonResponse_({ ok: true, mode, ...getQueueStats_() });
      if (mode === "eval_protect") {
        const res = evaluateProtectMode_();
        return jsonResponse_({ ok: true, mode, ...res });
      }

    // /exec?mode=test_push_all
    // /exec?mode=test_push_all&text=自訂文案
    // /exec?mode=test_push_all&techNo=10
    if (mode === "test_push_all") {
      const res = testPushAllUsers_(e && e.parameter ? e.parameter : {});
      return jsonResponse_({ ok: true, mode, ...res });
    }

    // /exec?mode=install_trigger
    if (mode === "install_trigger") {
      const res = installQueueTrigger_();
      return jsonResponse_({ ok: true, mode, ...res });
    }

    return jsonResponse_({ ok: false, error: "Unknown mode", mode });
  } catch (err) {
    return jsonResponse_({ ok: false, error: errToString_(err) });
  }
}

function doPost(e) {
  try {
    const payload = parseJsonPayload_(e);
    if (payload.mode !== "ready_event_v1") return jsonResponse_({ ok: false, error: "Unknown mode" });

    const res = handleReadyEventV1_WithFallback_(payload);
    return jsonResponse_({ ok: true, mode: "ready_event_v1", ...res });
  } catch (err) {
    return jsonResponse_({ ok: false, error: errToString_(err) });
  }
}

/* ===========================
 * Dedup bypass helper
 * =========================== */

function isDedupBypassed_(payload) {
  try {
    if (!CONFIG.DEDUP_BYPASS || !CONFIG.DEDUP_BYPASS.ENABLED) return false;

    // In production, bypass is disabled unless explicitly allowed
    if (String((CONFIG.ENVIRONMENT || "")).toLowerCase() === "prod" && !CONFIG.DEDUP_BYPASS.ALLOW_IN_PROD) return false;

    // 1) forcePush=true → bypass
    if (CONFIG.DEDUP_BYPASS.ALLOW_FORCE_PUSH && payload && payload.forcePush === true) return true;

    // 2) source in allowlist → bypass
    const src = String((payload && payload.source) || "").trim();
    if (!src) return false;

    const allow = CONFIG.DEDUP_BYPASS.SOURCES || [];
    return allow.indexOf(src) >= 0;
  } catch (e) {
    return false;
  }
}

/* ===========================
 * Payload validation (NEW)
 * =========================== */

function validateReadyPayload_(payload) {
  const panel = String(payload && payload.panel ? payload.panel : "").trim();
  const masterId = String(payload && payload.masterId ? payload.masterId : "").trim();

  const errors = [];
  if (!panel) errors.push("panel_required");
  if (!masterId) errors.push("masterId_required");

  return { ok: errors.length === 0, panel, masterId, errors };
}

/* ===========================
 * Ready Event (lock + fallback queue)
 * =========================== */

function handleReadyEventV1_WithFallback_(payload) {
  // ✅ 必填驗證：避免空 masterId 進 queue / 造成 techNo=(norm=)
  const v = validateReadyPayload_(payload);
  if (!v.ok) {
    const ts = formatTsTaipei_(payload && payload.timestamp);

    appendReadyLog_(
      makeReadyLogRow_(payload || {}, {
        ts,
        panel: v.panel || String((payload && payload.panel) || ""),
        masterId: v.masterId || String((payload && payload.masterId) || ""),
        pushCode: "BAD_PAYLOAD",
        pushResp: `Missing required: ${v.errors.join(",")}`,
        pushedCount: 0,
        targetCount: 0,
      })
    );

    return {
      timestamp: ts,
      logged: true,
      pushed: 0,
      targetCount: 0,
      lastCode: "BAD_PAYLOAD",
      reason: v.errors,
    };
  }

  const lock = LockService.getScriptLock();
  const got = lock.tryLock(CONFIG.LOCK_WAIT_MS);

  if (!got) {
    enqueue_(payload, { retryCount: 0, reason: "LOCK_TIMEOUT" });
    return {
      timestamp: formatTsTaipei_(payload.timestamp),
      logged: false,
      pushed: 0,
      targetCount: 0,
      lastCode: "ENQUEUED",
      reason: "LOCK_TIMEOUT_ENQUEUED",
    };
  }

  try {
    return handleReadyEventV1_PushNow_(payload);
  } finally {
    lock.releaseLock();
  }
}


function handleReadyEventV1_PushNow_(payload) {
  const ts = formatTsTaipei_(payload.timestamp);
  const panel = String(payload.panel || "").trim();
  const masterId = String(payload.masterId || "").trim();

  // If protect mode is on, do not perform immediate push; enqueue for controlled processing
  try {
    if (isProtectModeOn_()) {
      enqueue_(payload, { retryCount: 0, reason: "PROTECT_MODE" });
      return { timestamp: ts, logged: false, pushed: 0, targetCount: 0, lastCode: "ENQUEUED_PROTECT", reason: "PROTECT_MODE" };
    }
  } catch (e) {}

  // server-side dedup（正式保留；測試可 bypass）
  const bypass = isDedupBypassed_(payload);
  const cache = CacheService.getScriptCache();
  const dedupKey = `ready::${panel}::${masterId}`;

  if (!bypass) {
    if (cache.get(dedupKey)) {
      appendReadyLog_(
        makeReadyLogRow_(payload, {
          ts,
          panel,
          masterId,
          pushCode: "DEDUP",
          pushResp: `Dedup within ${CONFIG.READY_DEDUP_SEC}s`,
          pushedCount: 0,
          targetCount: 0,
        })
      );
      return { timestamp: ts, dedup: true, pushed: 0, targetCount: 0, reason: "DEDUP" };
    }
    cache.put(dedupKey, "1", CONFIG.READY_DEDUP_SEC);
  }

  const techIndex = buildTechIndex_();
  const allowed = getAllowedTargetsForTech_(techIndex, masterId).slice(0, CONFIG.MAX_PUSH_TARGETS);

  let pushedCount = 0;
  let lastCode = "SKIP";
  let lastResp = "";
  let enqueuedForRetry = false;
  let pushRes = null;

  if (!CONFIG.LINE_PUSH_ENABLED) {
    lastCode = "SKIP";
    lastResp = "LINE_PUSH_ENABLED=false";
  } else if (!allowed.length) {
    lastCode = "NO_TARGET";
    lastResp = `No allowed targets for techNo=${masterId} (norm=${normTechNo_(masterId)})`;
  } else {
    const msg = buildReadyMessage_(payload, { ts, panel, masterId });
    // Rate gate: if global per-minute quota reached, enqueue instead of immediate push
    const estimatedPushes = Math.ceil(allowed.length / Math.max(1, CONFIG.MULTICAST_BATCH_SIZE || 450));
    if (!isPushAllowedNow_(estimatedPushes)) {
      enqueue_(payload, { retryCount: 0, reason: "RATE_LIMIT_LOCAL" });
      return {
        timestamp: ts,
        logged: false,
        pushed: 0,
        targetCount: allowed.length,
        lastCode: "ENQUEUED_RATE_LIMIT",
        reason: "RATE_LIMIT_ENQUEUED",
      };
    }

    pushRes = pushLineMulticastBatchedDetailed_(allowed.map((t) => t.userId), msg);
    pushedCount = pushRes.okCount;
    if (pushedCount > 0) {
      try {
        incrPushCount_(pushedCount);
      } catch (e) {}
    }
    lastCode = String(pushRes.lastCode || "");
    lastResp = String(pushRes.lastResp || "");

    if (shouldRetryCode_(lastCode)) {
      const meta = { retryCount: 0, reason: `PUSH_FAIL_${lastCode}`, lastCode, lastResp };
      if (pushRes && pushRes.lastRetryAfterSec) meta.retryAfterSec = pushRes.lastRetryAfterSec;
      enqueue_(payload, meta);
      enqueuedForRetry = true;
    }
  }

  appendReadyLog_(
    makeReadyLogRow_(payload, {
      ts,
      panel,
      masterId,
      pushCode: enqueuedForRetry ? `${lastCode}_ENQ` : lastCode,
      pushResp: truncate_(
        (bypass ? "[DEDUP_BYPASS] " : "") + (enqueuedForRetry ? `${lastResp} | queued_for_retry` : lastResp),
        45000
      ),
      pushedCount,
      targetCount: allowed.length,

      pushStartAt: pushRes && pushRes.pushStartAt ? pushRes.pushStartAt : "",
      pushEndAt: pushRes && pushRes.pushEndAt ? pushRes.pushEndAt : "",
      pushDurationMs: pushRes && pushRes.pushDurationMs !== undefined ? pushRes.pushDurationMs : "",
    })
  );

  return {
    timestamp: ts,
    logged: true,
    pushed: pushedCount,
    targetCount: allowed.length,
    lastCode,
    queued: enqueuedForRetry,
    dedupBypassed: bypass,
  };
}

/* ===========================
 * ReadyQueue (reliable retry)
 * =========================== */

function enqueue_(payload, meta) {
  const sh = getOrCreateSheet_(CONFIG.SHEET_QUEUE);
  ensureHeader_(sh, CONFIG.QUEUE_HEADERS);

  const now = new Date();
  const retryCount = Math.max(0, Number((meta && meta.retryCount) ?? 0));
  // Support server-provided Retry-After (seconds) to respect upstream throttling
  const retryAfterSec = meta && meta.retryAfterSec ? Number(meta.retryAfterSec) : 0;
  const nextAt = retryAfterSec && isFinite(retryAfterSec) && retryAfterSec > 0
    ? formatTsTaipei_(new Date(Date.now() + retryAfterSec * 1000))
    : computeNextAtTaipei_(retryCount);
  const reasonCode = String((meta && meta.lastCode) || "");
  const reasonResp = String((meta && meta.lastResp) || "");

  sh.appendRow([
    formatTsTaipei_(payload.timestamp),
    String(payload.panel || ""),
    String(payload.masterId || ""),
    payload.index ?? "",
    payload.appointment ?? "",
    payload.remaining ?? "",
    payload.bgStatus ?? "",
    payload.colorStatus ?? "",
    retryCount,
    nextAt,
    "PENDING",
    reasonCode,
    truncate_(reasonResp, 2000),
    formatTsTaipei_(now),
    formatTsTaipei_(now),
  ]);
}

/**
 * ✅ Trigger 建議掛這個（burst）
 */
function processReadyQueueBurst_() {
  if (!CONFIG.QUEUE_BURST || !CONFIG.QUEUE_BURST.ENABLED) return processReadyQueue_();

  const runWindow = Math.max(5000, Number(CONFIG.QUEUE_BURST.RUN_WINDOW_MS || 45000));
  const step = Math.max(1000, Number(CONFIG.QUEUE_BURST.STEP_MS || 10000));

  const start = Date.now();
  while (Date.now() - start < runWindow) {
    processReadyQueue_();
    Utilities.sleep(step);
  }
}

function processReadyQueue() {
  return processReadyQueueBurst_();
}

/**
 * ✅【修正】Queue Processor 全段加鎖（避免重入造成重複推/狀態互蓋）
 */
function processReadyQueue_() {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(CONFIG.QUEUE_PROCESSOR_LOCK_WAIT_MS || 2000);
  if (!got) return;

  try {
    const sh = getOrCreateSheet_(CONFIG.SHEET_QUEUE);
    ensureHeader_(sh, CONFIG.QUEUE_HEADERS);

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    // ✅ Header Map：用 ReadyQueue 第 1 列的實際表頭建立欄位索引（不怕插欄/移欄）
    const headerMap = buildHeaderMap_(sh, CONFIG.QUEUE_HEADERS);

    const scanRows = Math.min(1000, lastRow - 1);
    const lastCol = Math.max(sh.getLastColumn(), CONFIG.QUEUE_HEADERS.length);
    const values = sh.getRange(2, 1, scanRows, lastCol).getValues();

    const now = new Date();
    const nowTs = now.getTime();

    const techIndex = buildTechIndex_();

    const dueIdx = [];
    for (let i = 0; i < values.length; i++) {
      const row = values[i];

      const qStatus = String(getByHeader_(row, headerMap, "qStatus") || "").trim() || "PENDING";
      const retryCount = Number(getByHeader_(row, headerMap, "retryCount")) || 0;
      const nextAtStr = String(getByHeader_(row, headerMap, "nextAt") || "").trim();

      if (qStatus !== "PENDING" && qStatus !== "RETRY") continue;
      if (retryCount > CONFIG.RETRY_MAX) continue;

      const nextAt = nextAtStr ? parseDateLoose_(nextAtStr) : null;
      const nextAtMs = nextAt ? nextAt.getTime() : 0;

      if (!nextAt || nextAtMs <= nowTs) {
        dueIdx.push(i);
        if (dueIdx.length >= CONFIG.QUEUE_BATCH_SIZE) break;
      }
    }

    if (!dueIdx.length) return;

    dueIdx.forEach((i) => {
      const row = values[i];

      const payload = {
        mode: "ready_event_v1",
        timestamp: getByHeader_(row, headerMap, "timestamp"),
        panel: getByHeader_(row, headerMap, "panel"),
        masterId: getByHeader_(row, headerMap, "masterId"),
        status: "準備",
        index: getByHeader_(row, headerMap, "index"),
        appointment: getByHeader_(row, headerMap, "appointment"),
        remaining: getByHeader_(row, headerMap, "remaining"),
        bgStatus: getByHeader_(row, headerMap, "bgStatus"),
        colorStatus: getByHeader_(row, headerMap, "colorStatus"),
      };

      const rowNumberInSheet = 2 + i;
      processOneQueueRow_(sh, rowNumberInSheet, row, payload, techIndex, headerMap);
    });

    compactQueueBestEffort_(sh);
  } finally {
    lock.releaseLock();
  }
}

function processOneQueueRow_(sh, rowNumber, row, payload, techIndex, headerMap) {
  const ts = formatTsTaipei_(payload.timestamp);
  const panel = String(payload.panel || "").trim();
  const masterId = String(payload.masterId || "").trim();

  // ✅ queue payload 必填驗證（避免 masterId 空導致 NO_TARGET techNo=(norm=)）
  if (!panel || !masterId) {
    appendReadyLog_(
      makeReadyLogRow_(payload, {
        ts,
        panel: panel || String(payload.panel || ""),
        masterId: masterId || String(payload.masterId || ""),
        pushCode: "BAD_PAYLOAD",
        pushResp: `Queue row missing required: ${!panel ? "panel " : ""}${!masterId ? "masterId" : ""}`.trim(),
        pushedCount: 0,
        targetCount: 0,
      })
    );
    updateQueueRowByMap_(sh, rowNumber, headerMap, {
      qStatus: "DONE",
      lastCode: "BAD_PAYLOAD",
      lastResp: "Missing panel/masterId (queue)",
      updatedAt: formatTsTaipei_(new Date()),
    });
    return;
  }

  const retryCount = Number(getByHeader_(row, headerMap, "retryCount")) || 0;

  // server-side dedup（queue 也維持；測試可 bypass）
  const bypass = isDedupBypassed_(payload);
  const cache = CacheService.getScriptCache();
  const dedupKey = `ready::${panel}::${masterId}`;

  if (!bypass) {
    if (cache.get(dedupKey)) {
      appendReadyLog_(
        makeReadyLogRow_(payload, {
          ts,
          panel,
          masterId,
          pushCode: "DEDUP",
          pushResp: `Dedup within ${CONFIG.READY_DEDUP_SEC}s (queue)`,
          pushedCount: 0,
          targetCount: 0,
        })
      );
      updateQueueRowByMap_(sh, rowNumber, headerMap, {
        qStatus: "DONE",
        lastCode: "DEDUP",
        lastResp: "Dedup (queue)",
        updatedAt: formatTsTaipei_(new Date()),
      });
      return;
    }
    cache.put(dedupKey, "1", CONFIG.READY_DEDUP_SEC);
  }

  const allowedTargets = getAllowedTargetsForTech_(techIndex, masterId).slice(0, CONFIG.MAX_PUSH_TARGETS);

  let pushedCount = 0;
  let lastCode = "SKIP";
  let lastResp = "";
  let finalStatus = "DONE";
  let nextAt = "";
  let pushRes = null;

  if (!CONFIG.LINE_PUSH_ENABLED) {
    lastCode = "SKIP";
    lastResp = "LINE_PUSH_ENABLED=false";
    finalStatus = "DONE";
  } else if (!allowedTargets.length) {
    lastCode = "NO_TARGET";
    lastResp = `No allowed targets for techNo=${masterId} (norm=${normTechNo_(masterId)})`;
    finalStatus = "DONE";
  } else {
    const msg = buildReadyMessage_(payload, { ts, panel, masterId });
    // Rate gate: if global per-minute quota reached, delay this queue row
    const estimatedPushes = Math.ceil(allowedTargets.length / Math.max(1, CONFIG.MULTICAST_BATCH_SIZE || 450));
    if (!isPushAllowedNow_(estimatedPushes)) {
      // schedule next retry with backoff
      const nextRetry = retryCount + 1;
      if (nextRetry > CONFIG.RETRY_MAX) {
        finalStatus = "DEAD";
        nextAt = "";
        lastCode = "RATE_LIMIT_DROP";
        lastResp = "Rate limit exceeded, giving up";
      } else {
        finalStatus = "RETRY";
        nextAt = computeNextAtTaipei_(nextRetry);
        lastCode = "RATE_LIMIT_LOCAL";
        lastResp = "Exceeded max pushes per minute, delayed";
      }
    } else {
      pushRes = pushLineMulticastBatchedDetailed_(allowedTargets.map((t) => t.userId), msg);
      pushedCount = pushRes.okCount;
      if (pushedCount > 0) {
        try {
          incrPushCount_(pushedCount);
        } catch (e) {}
      }

      lastCode = String(pushRes.lastCode || "");
      lastResp = String(pushRes.lastResp || "");

      if (shouldRetryCode_(lastCode)) {
        const nextRetry = retryCount + 1;
        if (nextRetry > CONFIG.RETRY_MAX) {
          finalStatus = "DEAD";
          nextAt = "";
        } else {
          finalStatus = "RETRY";
          if (pushRes && pushRes.lastRetryAfterSec) {
            nextAt = formatTsTaipei_(new Date(Date.now() + Number(pushRes.lastRetryAfterSec) * 1000));
          } else {
            nextAt = computeNextAtTaipei_(nextRetry);
          }
        }
      } else {
        finalStatus = "DONE";
        nextAt = "";
      }
    }
    lastCode = String(pushRes.lastCode || "");
    lastResp = String(pushRes.lastResp || "");

    if (shouldRetryCode_(lastCode)) {
      const nextRetry = retryCount + 1;
      if (nextRetry > CONFIG.RETRY_MAX) {
        finalStatus = "DEAD";
        nextAt = "";
      } else {
        finalStatus = "RETRY";
        if (pushRes && pushRes.lastRetryAfterSec) {
          nextAt = formatTsTaipei_(new Date(Date.now() + Number(pushRes.lastRetryAfterSec) * 1000));
        } else {
          nextAt = computeNextAtTaipei_(nextRetry);
        }
      }
    } else {
      finalStatus = "DONE";
      nextAt = "";
    }
  }

  appendReadyLog_(
    makeReadyLogRow_(payload, {
      ts,
      panel,
      masterId,
      pushCode: finalStatus === "RETRY" ? `${lastCode}_RETRY` : lastCode,
      pushResp: truncate_((bypass ? "[DEDUP_BYPASS] " : "") + lastResp, 45000),
      pushedCount,
      targetCount: allowedTargets.length,

      pushStartAt: pushRes && pushRes.pushStartAt ? pushRes.pushStartAt : "",
      pushEndAt: pushRes && pushRes.pushEndAt ? pushRes.pushEndAt : "",
      pushDurationMs: pushRes && pushRes.pushDurationMs !== undefined ? pushRes.pushDurationMs : "",
    })
  );

  updateQueueRowByMap_(sh, rowNumber, headerMap, {
    retryCount: shouldRetryCode_(lastCode) ? retryCount + 1 : retryCount,
    nextAt,
    qStatus: finalStatus,
    lastCode,
    lastResp: truncate_(lastResp, 2000),
    updatedAt: formatTsTaipei_(new Date()),
  });
}

/**
 * ✅【修正】用 Header Map 更新 Queue（不依賴固定欄位順序）
 */
function updateQueueRowByMap_(sh, rowNumber, headerMap, patch) {
  const setOne = (name, val) => {
    const col = headerMap[name];
    if (!col) return;
    sh.getRange(rowNumber, col).setValue(val);
  };

  if (patch.retryCount !== undefined) setOne("retryCount", patch.retryCount);
  if (patch.nextAt !== undefined) setOne("nextAt", patch.nextAt);
  if (patch.qStatus !== undefined) setOne("qStatus", patch.qStatus);
  if (patch.lastCode !== undefined) setOne("lastCode", patch.lastCode);
  if (patch.lastResp !== undefined) setOne("lastResp", patch.lastResp);
  if (patch.updatedAt !== undefined) setOne("updatedAt", patch.updatedAt);
}

function compactQueueBestEffort_(sh) {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(500);
  if (!got) return;

  try {
    const lastRow = sh.getLastRow();
    if (lastRow < 50) return;

    // Header Map to safely read qStatus even if columns moved
    const headerMap = buildHeaderMap_(sh, CONFIG.QUEUE_HEADERS);

    const scan = Math.min(500, lastRow - 1);
    const lastCol = Math.max(sh.getLastColumn(), CONFIG.QUEUE_HEADERS.length);
    const vals = sh.getRange(2, 1, scan, lastCol).getValues();

    const toDelete = [];
    for (let i = 0; i < vals.length; i++) {
      const qStatus = String(getByHeader_(vals[i], headerMap, "qStatus") || "").trim();
      if (qStatus === "DONE" || qStatus === "DEAD") toDelete.push(2 + i);
      if (toDelete.length >= 50) break;
    }

    for (let k = toDelete.length - 1; k >= 0; k--) {
      sh.deleteRow(toDelete[k]);
    }
  } finally {
    lock.releaseLock();
  }
}

function getQueueStats_() {
  const sh = getOrCreateSheet_(CONFIG.SHEET_QUEUE);
  ensureHeader_(sh, CONFIG.QUEUE_HEADERS);
  const lastRow = sh.getLastRow();
  const queueRows = Math.max(0, lastRow - 1);

  // Also collect recent ReadyLog metrics for monitoring
  const metrics = { recentWindowMin: 5, recentPushes: 0, recent429: 0, recent5xx: 0, avgPushDurationMs: 0 };
  try {
    const shLog = getOrCreateSheet_(CONFIG.SHEET_READY_LOG);
    ensureHeader_(shLog, CONFIG.READY_HEADERS);
    const lastRowLog = shLog.getLastRow();
    const dataRows = Math.max(0, lastRowLog - 1);
    if (dataRows > 0) {
      const scan = Math.min(1000, dataRows);
      const lastCol = Math.max(shLog.getLastColumn(), CONFIG.READY_HEADERS.length);
      const vals = shLog.getRange(lastRowLog - scan + 1, 1, scan, lastCol).getDisplayValues();

      const now = Date.now();
      const windowMs = Math.max(1, Number(metrics.recentWindowMin || 5)) * 60 * 1000;

      let durSum = 0;
      let durCount = 0;

      for (let i = 0; i < vals.length; i++) {
        const row = vals[i];
        const tsStr = String(row[0] || "").trim();
        const pushCode = String(row[9] || "").trim();
        const pushResp = String(row[10] || "").trim();
        const pushDuration = Number(row[15] || 0);
        const pushStartAt = String(row[13] || "").trim();

        // parse timestamp or pushStartAt for recency
        let t = null;
        if (pushStartAt) t = parseDateLoose_(pushStartAt);
        if (!t && tsStr) t = parseDateLoose_(tsStr);
        if (!t) continue;
        const tMs = t.getTime();
        if (now - tMs <= windowMs) {
          // count as recent
          metrics.recentPushes += pushCode && pushCode !== "" ? 1 : 0;
          // check codes
          if (/^429/.test(pushCode) || /429/.test(pushResp)) metrics.recent429++;
          if (/^5\d\d/.test(pushCode) || /"status"\s*:\s*5\d\d/.test(pushResp)) metrics.recent5xx++;
          if (pushDuration && !isNaN(pushDuration) && pushDuration > 0) {
            durSum += Number(pushDuration);
            durCount++;
          }
        }
      }

      metrics.avgPushDurationMs = durCount ? Math.round(durSum / durCount) : 0;
    }
  } catch (e) {
    // ignore metrics errors
  }

  return Object.assign({ queueRows }, metrics);
}

/* ===========================
 * Queue Header Map helpers (NEW)
 * =========================== */

/**
 * 讀取第 1 列表頭，建立 name -> colIndex(1-based)
 * - 會把 header 做 trim()
 * - 會優先用「實際表頭位置」；缺的欄位 fallback 到「預期順序」
 */
function buildHeaderMap_(sh, expectedHeaders) {
  const lastCol = Math.max(sh.getLastColumn(), expectedHeaders.length);
  const row1 = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] || [];

  const map = Object.create(null);

  // 1) 依實際表頭建立
  for (let c = 0; c < row1.length; c++) {
    const name = String(row1[c] || "").trim();
    if (!name) continue;
    if (!map[name]) map[name] = c + 1;
  }

  // 2) 對 expectedHeaders 若找不到，就按 expected 順序補一個 fallback col（避免空 map）
  for (let i = 0; i < expectedHeaders.length; i++) {
    const h = expectedHeaders[i];
    if (!map[h]) map[h] = i + 1;
  }

  return map;
}

function getByHeader_(rowArray, headerMap, name) {
  const col = headerMap[name];
  if (!col) return "";
  return rowArray[col - 1];
}

/* ===========================
 * Message builder
 * =========================== */

function buildReadyMessage_(payload, ctx) {
  const panelRaw = ctx.panel;
  const masterId = ctx.masterId;

  const panelText = panelRaw === "body" ? "身體" : panelRaw === "foot" ? "腳底" : panelRaw || "未知";
  const timeHHmm = formatHHmmTaipei_(payload.timestamp);

  const ap = String(payload.appointment ?? "").trim();
  const appointmentPart = ap ? `｜預約 ${ap}` : "";

  return renderMessage_(CONFIG.MESSAGE_TEMPLATE, {
    masterId,
    panel: panelText,
    timeHHmm,
    appointmentPart,
  });
}

/* ===========================
 * Test push
 * =========================== */

function testPushAllUsers_(params) {
  const timeHHmm = Utilities.formatDate(new Date(), "Asia/Taipei", "HH:mm");
  const customText = String((params && params.text) || "").trim();
  const techNo = String((params && params.techNo) || "").trim();

  const text = customText
    ? customText
    : renderMessage_(CONFIG.TEST_PUSH_TEMPLATE || "【測試推播】{timeHHmm}｜推播系統正常", { timeHHmm });

  if (!CONFIG.LINE_PUSH_ENABLED) {
    return { pushed: 0, targetCount: 0, lastCode: "SKIP", lastResp: "LINE_PUSH_ENABLED=false", text };
  }

  const techIndex = buildTechIndex_();
  const targets = techNo ? getAllowedTargetsForTech_(techIndex, techNo) : getAllAllowedTargets_(techIndex);
  const allowed = targets.slice(0, CONFIG.MAX_PUSH_TARGETS);

  if (!allowed.length) {
    return {
      pushed: 0,
      targetCount: 0,
      lastCode: "NO_TARGET",
      lastResp: techNo ? `No allowed targets for techNo=${techNo} (norm=${normTechNo_(techNo)})` : "No allowed targets",
      text,
      techNo,
    };
  }

  const pushRes = pushLineMulticastBatchedDetailed_(allowed.map((t) => t.userId), text);
  return {
    pushed: pushRes.okCount || 0,
    targetCount: allowed.length,
    lastCode: String(pushRes.lastCode || ""),
    lastResp: String(pushRes.lastResp || ""),
    text,
    techNo: techNo || "",
    pushStartAt: pushRes.pushStartAt || "",
    pushEndAt: pushRes.pushEndAt || "",
    pushDurationMs: pushRes.pushDurationMs !== undefined ? pushRes.pushDurationMs : "",
  };
}

/* ===========================
 * Users / TechIndex
 * =========================== */

function buildTechIndex_() {
  // Try cache first to reduce Spreadsheet I/O
  try {
    const cache = CacheService.getScriptCache();
    const ttl = Math.max(0, Number(CONFIG.TECHINDEX_CACHE_TTL_SEC || 30));
    const cacheKey = "techIndex_v1";
    if (ttl > 0) {
      const raw = cache.get(cacheKey);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch (e) {
          // fallthrough to rebuild
        }
      }
    }

    const targets = getPushTargets_();
    const allowedBase = targets.filter((t) => t.pushEnabled && t.auditOk && !t.expired && t.isMaster);

    const map = Object.create(null);
    allowedBase.forEach((t) => {
      const k = normTechNo_(t.techNo);
      if (!k) return;
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });

    const result = { allAllowed: allowedBase, byTechNo: map };

    if (ttl > 0) {
      try {
        cache.put(cacheKey, JSON.stringify(result), ttl);
      } catch (e) {
        // ignore cache put errors
      }
    }

    return result;
  } catch (e) {
    // Fallback: build without cache on any unexpected error
    const targets = getPushTargets_();
    const allowedBase = targets.filter((t) => t.pushEnabled && t.auditOk && !t.expired && t.isMaster);

    const map = Object.create(null);
    allowedBase.forEach((t) => {
      const k = normTechNo_(t.techNo);
      if (!k) return;
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });

    return { allAllowed: allowedBase, byTechNo: map };
  }
}

function getAllowedTargetsForTech_(techIndex, masterId) {
  if (!techIndex || !techIndex.byTechNo) return [];
  const k = normTechNo_(masterId);
  if (!k) return [];
  return (techIndex.byTechNo[k] || []).filter((x) => !!x.userId);
}

function getAllAllowedTargets_(techIndex) {
  if (!techIndex || !techIndex.allAllowed) return [];
  return techIndex.allAllowed.filter((x) => !!x.userId);
}

function getPushTargets_() {
  const sh = getOrCreateSheet_(CONFIG.SHEET_USERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const c = CONFIG.USERS_COL;
  const lastCol = Math.max(
    c.userId,
    c.name,
    c.auditStatus,
    c.startDate,
    c.durationDays,
    c.techNo || 0,
    c.isMaster || 0,
    c.pushEnabled
  );

  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  return values
    .map((r, idx) => {
      const userId = String(r[c.userId - 1] || "").trim();
      const name = String(r[c.name - 1] || "").trim();

      const audit = String(r[c.auditStatus - 1] || "").trim();
      const auditOk = audit === "通過";

      const pushEnabled = String(r[c.pushEnabled - 1] || "").trim() === "是";

      const startDateStr = String(r[c.startDate - 1] || "").trim();
      const durationStr = String(r[c.durationDays - 1] || "").trim();
      const expired = isExpired_(startDateStr, durationStr);

      const techNo = c.techNo ? String(r[c.techNo - 1] || "").trim() : "";
      const isMaster = c.isMaster ? String(r[c.isMaster - 1] || "").trim() === "是" : true;

      return { row: idx + 2, userId, name, audit, auditOk, pushEnabled, expired, techNo, isMaster };
    })
    .filter((x) => !!x.userId);
}

function isExpired_(startDateStr, durationStr) {
  if (!startDateStr) return false;
  const start = parseDateLoose_(startDateStr);
  if (!start) return false;

  const now = new Date();
  const d = String(durationStr || "").trim();

  if (/^\d+$/.test(d)) {
    const days = parseInt(d, 10);
    if (!isFinite(days) || days <= 0) return false;
    const expire = new Date(start.getTime() + days * 86400000);
    return now.getTime() > expire.getTime();
  }

  const asDate = parseDateLoose_(d);
  if (asDate) return now.getTime() > asDate.getTime();
  return false;
}

function parseDateLoose_(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d+$/.test(str)) return null;

  const t = new Date(str);
  if (!isNaN(t.getTime())) return t;

  const m = str.match(
    /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
  );
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mm = m[5] ? parseInt(m[5], 10) : 0;
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const dt = new Date(y, mo, d, hh, mm, ss);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

/* ===========================
 * ReadyLog (+ auto trim)
 * =========================== */

function appendReadyLog_(rowObj) {
  const sh = getOrCreateSheet_(CONFIG.SHEET_READY_LOG);
  ensureHeader_(sh, CONFIG.READY_HEADERS);

  const values = CONFIG.READY_HEADERS.map((h) => (rowObj && rowObj[h] !== undefined ? rowObj[h] : ""));
  sh.appendRow(values);

  trimReadyLog_();
}

function trimReadyLog_() {
  const keep = Math.max(1000, Number(CONFIG.READYLOG_KEEP_ROWS || 2000));
  const batch = Math.max(100, Number(CONFIG.READYLOG_TRIM_BATCH || 200));

  const lock = LockService.getScriptLock();
  const got = lock.tryLock(2000);
  if (!got) return;

  try {
    const sh = getOrCreateSheet_(CONFIG.SHEET_READY_LOG);
    ensureHeader_(sh, CONFIG.READY_HEADERS);

    const lastRow = sh.getLastRow();
    const dataRows = Math.max(0, lastRow - 1);
    if (dataRows <= keep) return;

    const needDelete = dataRows - keep;
    const del = Math.min(needDelete, batch);
    sh.deleteRows(2, del);
  } finally {
    lock.releaseLock();
  }
}

function makeReadyLogRow_(payload, extra) {
  return {
    timestamp: extra.ts,
    panel: extra.panel,
    masterId: extra.masterId,
    status: payload && payload.status ? payload.status : "準備",
    index: payload && payload.index !== undefined ? payload.index : "",
    appointment: payload && payload.appointment !== undefined ? payload.appointment : "",
    remaining: payload && payload.remaining !== undefined ? payload.remaining : "",
    bgStatus: payload && payload.bgStatus !== undefined ? payload.bgStatus : "",
    colorStatus: payload && payload.colorStatus !== undefined ? payload.colorStatus : "",
    pushCode: extra.pushCode ?? "",
    pushResp: extra.pushResp ?? "",
    pushedCount: extra.pushedCount ?? 0,
    targetCount: extra.targetCount ?? 0,
    pushStartAt: extra.pushStartAt ?? "",
    pushEndAt: extra.pushEndAt ?? "",
    pushDurationMs: extra.pushDurationMs ?? "",
  };
}

/* ===========================
 * LINE multicast batching (with timing)
 * =========================== */

function getLineToken_() {
  const props = PropertiesService.getScriptProperties();
  return String(props.getProperty(CONFIG.LINE_TOKEN_PROP_KEY) || "").trim();
}

function pushLineMulticastBatchedDetailed_(userIds, text) {
  const token = getLineToken_();
  const start = new Date();

  if (!token) {
    const end = new Date();
    return {
      okCount: 0,
      lastCode: "NO_TOKEN",
      lastResp: `Missing ScriptProperty: ${CONFIG.LINE_TOKEN_PROP_KEY}`,
      pushStartAt: formatTsTaipei_(start),
      pushEndAt: formatTsTaipei_(end),
      pushDurationMs: end.getTime() - start.getTime(),
    };
  }
  if (!userIds || userIds.length === 0) {
    const end = new Date();
    return {
      okCount: 0,
      lastCode: "NO_TARGET",
      lastResp: "Empty userIds",
      pushStartAt: formatTsTaipei_(start),
      pushEndAt: formatTsTaipei_(end),
      pushDurationMs: end.getTime() - start.getTime(),
    };
  }

  const batchSize = Math.max(1, Math.min(CONFIG.MULTICAST_BATCH_SIZE || 450, 500));
  let okCount = 0;
  let lastCode = "";
  let lastResp = "";
  let lastRetryAfterSec = null;
  // Build chunks
  const chunks = [];
  for (let i = 0; i < userIds.length; i += batchSize) chunks.push(userIds.slice(i, i + batchSize));

  const useFetchAll = !!CONFIG.MULTICAST_USE_FETCHALL;
  const maxParallel = Math.max(1, Math.min(20, Number(CONFIG.MULTICAST_FETCHALL_MAX_PARALLEL || 8)));

  if (useFetchAll && chunks.length > 1) {
    // Send in groups of up to maxParallel using fetchAll
    for (let g = 0; g < chunks.length; g += maxParallel) {
      const group = chunks.slice(g, g + maxParallel);
      const requests = group.map((chunk) => ({
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify({ to: chunk, messages: [{ type: "text", text }] }),
        muteHttpExceptions: true,
        url: "https://api.line.me/v2/bot/message/multicast",
      }));

      const resps = UrlFetchApp.fetchAll(requests);
      for (let k = 0; k < resps.length; k++) {
        const resp = resps[k];
        const code = resp.getResponseCode();
        const body = resp.getContentText();
        lastCode = String(code);
        lastResp = body;
        // parse Retry-After header
        try {
          const hdrs = resp.getAllHeaders ? resp.getAllHeaders() : resp.getHeaders ? resp.getHeaders() : {};
          const ra = hdrs && (hdrs["Retry-After"] || hdrs["retry-after"] || hdrs["Retry-after"]);
          if (ra) {
            const raNum = parseInt(String(ra).trim(), 10);
            if (isFinite(raNum)) lastRetryAfterSec = raNum;
          }
        } catch (e) {}

        if (code >= 200 && code < 300) okCount += group[k].length;
        if (shouldRetryCode_(lastCode)) break;
      }

      // gap between groups
      try {
        const gapMs = Math.max(0, Number(CONFIG.MULTICAST_BATCH_SEND_GAP_MS || 0));
        if (gapMs && g + maxParallel < chunks.length) Utilities.sleep(gapMs);
      } catch (e) {}
      if (shouldRetryCode_(lastCode)) break;
    }
  } else {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const payload = { to: chunk, messages: [{ type: "text", text }] };
      const resp = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/multicast", {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      const code = resp.getResponseCode();
      const body = resp.getContentText();

      lastCode = String(code);
      lastResp = body;

      try {
        const hdrs = resp.getAllHeaders ? resp.getAllHeaders() : resp.getHeaders ? resp.getHeaders() : {};
        const ra = hdrs && (hdrs["Retry-After"] || hdrs["retry-after"] || hdrs["Retry-after"]);
        if (ra) {
          const raNum = parseInt(String(ra).trim(), 10);
          if (isFinite(raNum)) lastRetryAfterSec = raNum;
        }
      } catch (e) {}

      if (code >= 200 && code < 300) okCount += chunk.length;
      if (shouldRetryCode_(lastCode)) break;

      try {
        const gapMs = Math.max(0, Number(CONFIG.MULTICAST_BATCH_SEND_GAP_MS || 0));
        if (gapMs && i + 1 < chunks.length) Utilities.sleep(gapMs);
      } catch (e) {}
    }
  }

  const end = new Date();
  return {
    okCount,
    lastCode,
      lastResp,
      lastRetryAfterSec,
    pushStartAt: formatTsTaipei_(start),
    pushEndAt: formatTsTaipei_(end),
    pushDurationMs: end.getTime() - start.getTime(),
  };
}

/* ===========================
 * Retry helpers
 * =========================== */

function shouldRetryCode_(code) {
  const c = String(code || "").trim();
  if (!c) return false;
  if (c === "429") return true;
  if (/^5\d\d$/.test(c)) return true;
  return false;
}

function computeNextAtTaipei_(retryCount, retryAfterSec) {
  // If upstream provided Retry-After (in seconds), honor it first
  const ra = retryAfterSec && isFinite(Number(retryAfterSec)) ? Number(retryAfterSec) : 0;
  if (ra && ra > 0) {
    const d = new Date(Date.now() + ra * 1000);
    return formatTsTaipei_(d);
  }

  const base = Math.max(1, Number(CONFIG.RETRY_BASE_DELAY_SEC || 10));
  const max = Math.max(base, Number(CONFIG.RETRY_MAX_DELAY_SEC || 600));
  const jitter = Math.max(0, Number(CONFIG.RETRY_JITTER_SEC || 0));

  const pow = Math.pow(2, Math.max(0, retryCount));
  let delay = base * pow;
  if (delay > max) delay = max;

  const j = jitter ? Math.floor(Math.random() * (jitter + 1)) : 0;
  const ms = (delay + j) * 1000;

  const d = new Date(Date.now() + ms);
  return formatTsTaipei_(d);
}

/* ===========================
 * TechNo normalization (08/8)
 * =========================== */

function normTechNo_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return s;
  const n = parseInt(digits, 10);
  if (!isFinite(n)) return "";
  return String(n);
}

/* ===========================
 * Common helpers
 * =========================== */

function formatTsTaipei_(input) {
  let d = null;

  if (input instanceof Date) {
    d = input;
  } else if (input !== undefined && input !== null && String(input).trim() !== "") {
    const tryDate = new Date(String(input));
    if (!isNaN(tryDate.getTime())) d = tryDate;
  }

  if (!d) d = new Date();
  return Utilities.formatDate(d, "Asia/Taipei", "yyyy/MM/dd HH:mm:ss");
}

function formatHHmmTaipei_(input) {
  let d = null;

  if (input instanceof Date) {
    d = input;
  } else if (input !== undefined && input !== null && String(input).trim() !== "") {
    const tryDate = new Date(String(input));
    if (!isNaN(tryDate.getTime())) d = tryDate;
  }

  if (!d) d = new Date();
  return Utilities.formatDate(d, "Asia/Taipei", "HH:mm");
}

function renderMessage_(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}

function ss_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/* ===========================
 * Push rate gate helpers
 * Uses CacheService simple per-minute counter key. Not strictly atomic but
 * reduces burst risk; acceptable for low-risk protection.
 * =========================== */
function _pushCountKeyForNow() {
  return "push_count_min_" + Math.floor(Date.now() / 60000);
}

function isPushAllowedNow_(delta) {
  try {
    let max = Math.max(0, Number(CONFIG.MAX_PUSHES_PER_MINUTE || 0));
    // If protect mode is on, prefer reduced max
    try {
      if (isProtectModeOn_()) {
        const reduced = Math.max(0, Number(CONFIG.PROTECT && CONFIG.PROTECT.REDUCED_MAX_PUSH_PER_MINUTE ? CONFIG.PROTECT.REDUCED_MAX_PUSH_PER_MINUTE : 0));
        if (reduced > 0) max = reduced;
      }
    } catch (e) {}
    if (max <= 0) return true;
    const cache = CacheService.getScriptCache();
    const key = _pushCountKeyForNow();
    const cur = Number(cache.get(key) || 0);
    return cur + Math.max(0, Number(delta || 0)) <= max;
  } catch (e) {
    return true;
  }
}

/* ===========================
 * Protect mode helpers
 * =========================== */
function _protectCacheKey() {
  return "protect_mode_v1";
}

function isProtectModeOn_() {
  try {
    const cache = CacheService.getScriptCache();
    return !!cache.get(_protectCacheKey());
  } catch (e) {
    return false;
  }
}

function enableProtectMode_(reason) {
  try {
    if (!CONFIG.PROTECT || !CONFIG.PROTECT.ENABLED) return false;
    const ttl = Math.max(1, Number(CONFIG.PROTECT.DURATION_SEC || 300));
    const cache = CacheService.getScriptCache();
    cache.put(_protectCacheKey(), String(reason || "protect"), ttl);

    // write a ReadyLog entry to indicate protect mode started
    appendReadyLog_({
      timestamp: formatTsTaipei_(new Date()),
      panel: "SYSTEM",
      masterId: "PROTECT",
      status: "PROTECT_ON",
      index: "",
      appointment: "",
      remaining: "",
      bgStatus: "",
      colorStatus: "",
      pushCode: "PROTECT_ON",
      pushResp: String(reason || "protect_mode"),
      pushedCount: 0,
      targetCount: 0,
      pushStartAt: "",
      pushEndAt: "",
      pushDurationMs: "",
    });
    Logger.log("PROTECT MODE ENABLED: %s", String(reason || "protect"));
    return true;
  } catch (e) {
    return false;
  }
}

function disableProtectMode_() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(_protectCacheKey());
    appendReadyLog_({
      timestamp: formatTsTaipei_(new Date()),
      panel: "SYSTEM",
      masterId: "PROTECT",
      status: "PROTECT_OFF",
      index: "",
      appointment: "",
      remaining: "",
      bgStatus: "",
      colorStatus: "",
      pushCode: "PROTECT_OFF",
      pushResp: "protect_mode_disabled",
      pushedCount: 0,
      targetCount: 0,
      pushStartAt: "",
      pushEndAt: "",
      pushDurationMs: "",
    });
    Logger.log("PROTECT MODE DISABLED");
    return true;
  } catch (e) {
    return false;
  }
}

function evaluateProtectMode_() {
  try {
    if (!CONFIG.PROTECT || !CONFIG.PROTECT.ENABLED) return { enabled: false };
    const stats = getQueueStats_();
    const recent429 = Number(stats.recent429 || 0);
    const recentPushes = Number(stats.recentPushes || 0);
    const max = Math.max(1, Number(CONFIG.MAX_PUSHES_PER_MINUTE || 1));
    const ratio = recentPushes / max;

    if (recent429 >= Number(CONFIG.PROTECT.TRIGGER_429 || 5) || ratio >= Number(CONFIG.PROTECT.TRIGGER_PUSH_RATIO || 0.8)) {
      const reason = `auto:${recent429}429_${Math.round(ratio * 100)}pct`;
      enableProtectMode_(reason);
      return { enabled: true, reason };
    }

    return { enabled: false };
  } catch (e) {
    return { enabled: false, error: errToString_(e) };
  }
}

function incrPushCount_(n) {
  try {
    const cache = CacheService.getScriptCache();
    const key = _pushCountKeyForNow();
    const cur = Number(cache.get(key) || 0);
    const next = cur + Math.max(0, Number(n || 0));
    // keep key TTL slightly longer than 60s to survive edge minute transitions
    cache.put(key, String(next), 70);
  } catch (e) {
    // ignore
  }
}

function getOrCreateSheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureHeader_(sh, headers) {
  const need = headers.length;
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, need).setValues([headers]);
    return;
  }
  const exist = sh.getRange(1, 1, 1, need).getDisplayValues()[0] || [];
  const same = headers.every((h, i) => String(exist[i] || "").trim() === h);
  if (!same) sh.getRange(1, 1, 1, need).setValues([headers]);
}

function parseJsonPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("NO_POST_DATA");
  return JSON.parse(e.postData.contents);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errToString_(err) {
  try {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err.message) return err.message;
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

function truncate_(s, maxLen) {
  s = String(s || "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...(truncated)";
}

/* ===========================
 * Trigger installer (optional)
 * =========================== */

function installQueueTrigger_() {
  const handler = "processReadyQueueBurst_";

  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach((t) => {
    if (t.getHandlerFunction && t.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
  return { installed: true, handler, removedOld: removed };
}

/* ===========================
 * Manual push test
 * =========================== */

function manualPushTest() {
  return manualPushTest_();
}

function manualPushTest_() {
  const tokenKey = CONFIG.LINE_TOKEN_PROP_KEY || "LINE_CHANNEL_ACCESS_TOKEN";
  const token = String(PropertiesService.getScriptProperties().getProperty(tokenKey) || "").trim();
  if (!token) throw new Error(`NO_TOKEN: Missing ScriptProperty ${tokenKey}`);

  const now = new Date();
  const timeHHmm = Utilities.formatDate(now, "Asia/Taipei", "HH:mm");
  const techNo = ""; // "10" or "08"

  const techIndex = buildTechIndex_();
  const allowed = (techNo ? getAllowedTargetsForTech_(techIndex, techNo) : getAllAllowedTargets_(techIndex)).slice(
    0,
    CONFIG.MAX_PUSH_TARGETS
  );

  if (!allowed.length) throw new Error(`NO_TARGET: No allowed targets (techNo=${techNo || "ALL"})`);

  const text = `【GAS手動測試】${timeHHmm}｜推播正常（共 ${allowed.length} 人）${techNo ? `｜技師 ${techNo}` : ""}`;
  const res = pushLineMulticastBatchedDetailed_(allowed.map((t) => t.userId), text);

  Logger.log("manualPushTest_ result: %s", JSON.stringify(res));

  appendReadyLog_({
    timestamp: formatTsTaipei_(now),
    panel: "TEST",
    masterId: techNo ? `MANUAL_${techNo}` : "MANUAL",
    status: "TEST",
    index: "",
    appointment: "",
    remaining: "",
    bgStatus: "",
    colorStatus: "",
    pushCode: String(res.lastCode || ""),
    pushResp: truncate_(String(res.lastResp || ""), 1000),
    pushedCount: Number(res.okCount || 0),
    targetCount: allowed.length,
    pushStartAt: res.pushStartAt || "",
    pushEndAt: res.pushEndAt || "",
    pushDurationMs: res.pushDurationMs !== undefined ? res.pushDurationMs : "",
  });

  return res;
}
