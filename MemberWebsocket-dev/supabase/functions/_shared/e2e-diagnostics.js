const DIAGNOSTIC_VERSION = 2;

function asText(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeStringify(value, max = 12000) {
  try {
    return JSON.stringify(value ?? {}).slice(0, max);
  } catch {
    return "";
  }
}

function findField(value, keys, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 24)) {
      const found = findField(item, keys, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (keys.has(String(key).toLowerCase()) && item != null) return item;
  }
  for (const item of Object.values(value).slice(0, 80)) {
    const found = findField(item, keys, depth + 1);
    if (found != null) return found;
  }
  return null;
}

function firstHttpStatus(actual, trace) {
  const keys = new Set(["httpstatus", "http_status", "statuscode", "status_code"]);
  for (const source of [actual, trace]) {
    const raw = findField(source, keys);
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  const generic = findField(actual, new Set(["status"]));
  const value = Number(generic);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function firstSourceCode(actual, trace) {
  const raw = findField(
    { actual, trace },
    new Set(["errorcode", "error_code", "downstreamcode", "downstream_code", "code"]),
  );
  return asText(raw, 120).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120);
}

function firstPath(trace) {
  const timings = Array.isArray(trace?.apiTimings) ? trace.apiTimings : [];
  const requests = Array.isArray(trace?.networkRequests) ? trace.networkRequests : [];
  const candidate = [...requests, ...timings].find((item) => item && typeof item === "object" && item.path);
  const path = asText(candidate?.path, 240);
  return path.startsWith("/") ? path : "";
}

function fnv1a(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function includesAny(haystack, patterns) {
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function diagnoseE2EFailure(input = {}) {
  const caseKey = asText(input.caseKey, 100) || "UNKNOWN_CASE";
  const domain = asText(input.domain, 120);
  const message = asText(input.message, 1600);
  const actual = input.actual && typeof input.actual === "object" ? input.actual : {};
  const trace = input.trace && typeof input.trace === "object" ? input.trace : {};
  const sourceCode = firstSourceCode(actual, trace);
  const httpStatus = firstHttpStatus(actual, trace);
  const path = firstPath(trace);
  const signal = [
    message,
    sourceCode,
    safeStringify(actual),
    safeStringify(trace?.error),
    safeStringify(trace?.events),
  ].join(" ").toLowerCase();

  let category = "assertion";
  let code = "E2E_ASSERTION";
  let layer = "test-assertion";
  let retryable = false;

  if (
    httpStatus === 429
    || includesAny(signal, ["rate_limit", "rate-limited", "rate limited", "too many requests", "429", "過於密集", "稍後再試"])
  ) {
    category = "rate-limit";
    code = "E2E_RATE_LIMIT";
    layer = "edge-function";
    retryable = true;
  } else if (
    includesAny(signal, ["timeout", "timed out", "time out", "逾時", "超時", "允許時間", "deadline exceeded"])
  ) {
    category = "timeout";
    code = "E2E_TIMEOUT";
    layer = "orchestration";
    retryable = true;
  } else if (
    httpStatus === 403
    || includesAny(signal, ["forbidden", "permission denied", "authorization", "權限不足", "無權限", "不允許"])
  ) {
    category = "authorization";
    code = "E2E_AUTHORIZATION";
    layer = "authorization";
  } else if (
    httpStatus === 401
    || includesAny(signal, [
      "unauthenticated", "authentication", "invalid token", "expired token", "session expired",
      "登入資訊", "登入失效", "重新登入", "session 尚未", "session required",
    ])
  ) {
    category = "authentication";
    code = "E2E_AUTHENTICATION";
    layer = "authentication";
  } else if (
    includesAny(signal, ["realtime", "websocket", "channel error", "subscribe", "subscription", "即時同步", "同步逾時"])
  ) {
    category = "realtime";
    code = "E2E_REALTIME";
    layer = "realtime";
    retryable = true;
  } else if (
    includesAny(signal, ["failed to fetch", "networkerror", "network error", "offline", "connection reset", "connection refused", "網路"])
  ) {
    category = "network";
    code = "E2E_NETWORK";
    layer = "browser-network";
    retryable = true;
  } else if (
    (httpStatus != null && httpStatus >= 500)
    || includesAny(signal, ["service unavailable", "database", "資料庫暫時", "服務暫時", "internal server error"])
  ) {
    category = "backend";
    code = "E2E_BACKEND";
    layer = "backend";
    retryable = true;
  } else if (
    includesAny(signal, ["window.error", "unhandledrejection", "typeerror", "referenceerror", "syntaxerror"])
  ) {
    category = "client-error";
    code = "E2E_CLIENT_ERROR";
    layer = "browser";
  }

  const fingerprintBasis = [
    category,
    caseKey,
    domain,
    sourceCode || "-",
    httpStatus == null ? "-" : String(httpStatus),
    path || "-",
  ].join("|");

  return {
    version: DIAGNOSTIC_VERSION,
    code,
    category,
    layer,
    retryable,
    fingerprint: "E2E-" + fnv1a(fingerprintBasis),
    signal: {
      caseKey,
      sourceCode: sourceCode || null,
      httpStatus,
      path: path || null,
    },
  };
}

export function attachE2EDiagnosis(trace, diagnosis) {
  const base = trace && typeof trace === "object" && !Array.isArray(trace) ? trace : {};
  return {
    ...base,
    artifactVersion: Math.max(DIAGNOSTIC_VERSION, Number(base.artifactVersion || 0)),
    diagnosis,
  };
}

export function summarizeE2EFailureDiagnoses(items = []) {
  const byCategory = {};
  const byCode = {};
  const fingerprints = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const category = asText(item.category, 60) || "unknown";
    const code = asText(item.code, 80) || "E2E_UNKNOWN";
    const fingerprint = asText(item.fingerprint, 80);
    byCategory[category] = Number(byCategory[category] || 0) + 1;
    byCode[code] = Number(byCode[code] || 0) + 1;
    if (fingerprint) fingerprints[fingerprint] = Number(fingerprints[fingerprint] || 0) + 1;
  }
  return {
    version: DIAGNOSTIC_VERSION,
    total: Object.values(byCategory).reduce((sum, value) => sum + Number(value || 0), 0),
    byCategory,
    byCode,
    fingerprints,
  };
}
