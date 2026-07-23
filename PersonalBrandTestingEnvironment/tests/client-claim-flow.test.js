const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "client", "script.js"),
  "utf8"
);

function extractFunction(name) {
  const marker = `  function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("\n  function ", start + marker.length);
  return source.slice(start + 2, end === -1 ? source.length : end);
}

function createHarness(href, { rejectStorage = false } = {}) {
  const values = new Map();
  let requestSequence = 0;
  const pageUrl = new URL(href);
  const window = {
    location: {
      href: pageUrl.toString(),
      origin: pageUrl.origin,
    },
    history: {
      state: null,
      replacedUrl: "",
      replaceState(state, _title, url) {
        this.state = state;
        this.replacedUrl = String(url);
      },
    },
    sessionStorage: {
      getItem(key) {
        if (rejectStorage) throw new Error("storage unavailable");
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        if (rejectStorage) throw new Error("storage unavailable");
        values.set(String(key), String(value));
      },
      removeItem(key) {
        if (rejectStorage) throw new Error("storage unavailable");
        values.delete(String(key));
      },
    },
    MemberApi: {
      createRequestId() {
        requestSequence += 1;
        return `request-redemption-${requestSequence}`;
      },
    },
  };
  const functionNames = [
    "capturePendingPointClaim",
    "getPointClaimStorageKey",
    "getPointRedemptionRequestStorageKey",
    "clearStoredPointClaim",
    "clearPendingPointClaim",
    "clearPendingPointRedemptionRequest",
    "ensurePendingPointRedemptionRequestId",
    "getStoredPointClaim",
    "getCleanPageUrl",
  ];
  const moduleSource = `
    (function () {
      var CONFIG = { LIFF_ID: "2010787602-kaiSm2eq" };
      var POINT_CLAIM_STORAGE_PREFIX = "persona-member-point-claim:";
      var POINT_REDEMPTION_REQUEST_STORAGE_PREFIX = "persona-member-point-redemption-request:";
      var pendingPointClaim = "";
      var pendingPointClaimError = "";
      var pendingPointRedemptionRequestId = "";
      var isPointClaimPersisted = false;
      ${functionNames.map(extractFunction).join("\n")}
      return {
        capture: capturePendingPointClaim,
        cleanUrl: getCleanPageUrl,
        clear: clearPendingPointClaim,
        ensureRequestId: ensurePendingPointRedemptionRequestId,
        state: function () {
          return {
            claim: pendingPointClaim,
            error: pendingPointClaimError,
            persisted: isPointClaimPersisted
          };
        }
      };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, { window, URL });
  return { api, values, window };
}

test("direct QR claim is captured after init state and removed from browser history", () => {
  const claim = "A".repeat(43);
  const harness = createHarness(
    `https://example.github.io/client/?claim=${claim}&from=poster#member`
  );

  harness.api.capture();

  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.api.state())),
    { claim, error: "", persisted: true }
  );
  assert.equal([...harness.values.values()][0], claim);
  const replaced = new URL(harness.window.history.replacedUrl);
  assert.equal(replaced.searchParams.has("claim"), false);
  assert.equal(replaced.searchParams.get("from"), "poster");
  assert.equal(replaced.hash, "#member");
  assert.equal(harness.api.cleanUrl(), "https://example.github.io/client/");
});

test("LIFF liff.state claim is captured while unrelated state parameters survive", () => {
  const claim = "B".repeat(43);
  const liffState = encodeURIComponent(`?claim=${claim}&campaign=summer`);
  const harness = createHarness(
    `https://example.github.io/client/?liff.state=${liffState}`
  );

  harness.api.capture();

  assert.equal(harness.api.state().claim, claim);
  const replaced = new URL(harness.window.history.replacedUrl);
  const cleanedState = new URL(
    replaced.searchParams.get("liff.state"),
    replaced.origin
  );
  assert.equal(cleanedState.searchParams.has("claim"), false);
  assert.equal(cleanedState.searchParams.get("campaign"), "summer");
});

test("validated claim survives an external login redirect when storage is unavailable", () => {
  const claim = "C".repeat(43);
  const harness = createHarness(
    `https://example.github.io/client/?claim=${claim}`,
    { rejectStorage: true }
  );

  harness.api.capture();

  assert.equal(harness.api.state().claim, claim);
  assert.equal(harness.api.state().persisted, false);
  assert.equal(
    new URL(harness.api.cleanUrl()).searchParams.get("claim"),
    claim
  );

  harness.api.clear();
  assert.equal(new URL(harness.api.cleanUrl()).searchParams.has("claim"), false);
});

test("malformed claim is cleared without entering storage or a redirect URL", () => {
  const harness = createHarness(
    "https://example.github.io/client/?claim=not-valid"
  );

  harness.api.capture();

  assert.equal(harness.api.state().claim, "");
  assert.match(harness.api.state().error, /格式不正確/);
  assert.equal(harness.values.size, 0);
  assert.equal(new URL(harness.api.cleanUrl()).searchParams.has("claim"), false);
});

test("one redemption attempt reuses its request ID until the claim is cleared", () => {
  const claim = "D".repeat(43);
  const harness = createHarness(
    `https://example.github.io/client/?claim=${claim}`
  );

  harness.api.capture();
  const first = harness.api.ensureRequestId();
  const retry = harness.api.ensureRequestId();
  assert.equal(retry, first);

  harness.api.clear();
  const nextScan = harness.api.ensureRequestId();
  assert.notEqual(nextScan, first);
});
