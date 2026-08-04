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

test("member identity renders before the point-card summary finishes loading", async () => {
  const events = [];
  const member = {
    memberId: "MBR-ABCDEF1234",
    displayName: "測試會員",
    phone: "0912345678",
    birthday: "1990-01-01",
  };
  const cardSummary = {
    currentPoints: 3,
    targetPoints: 20,
    availableDraws: 0,
    rewardRules: [],
    availableRewards: [],
  };
  const moduleSource = `
    (function () {
      var bootVersion = 1;
      var currentIdToken = "";
      var pendingMemberSyncRequestId = "";
      var currentMemberWasCreated = false;
      var memberBackendSupportsProgressive = true;
      var window = {
        liff: {
          getIDToken: function () { return "header.payload.signature"; }
        },
        MemberApi: {
          createRequestId: function () { return "request-member-sync"; }
        }
      };
      function setConnection() {}
      function setLoadingCopy() {}
      function setView() {}
      function createClientError(code, message) { var error = new Error(message); error.code = code; return error; }
      function getLiffContext() { return {}; }
      function getMemberSyncAction() { return Promise.resolve("upsertMemberIdentity"); }
      function assertSuccessfulResponse(response) { if (!response.ok) throw new Error("failed"); }
      function enablePerformanceReporting() {}
      function clearInvalidTokenRecoveryGuard() {}
      function normalizeClientError(error) { return { code: error.code || "CONNECTION_ERROR", message: error.message }; }
      function showToast() {}
      function renderAccessState() {}
      function renderMember(value) { events.push("render-member:" + value.memberId); }
      function renderMemberCardSummary(value) { events.push("render-card:" + value.targetPoints); }
      function updateMemberPointBalance() {}
      function sendNewMemberJoinMessage() {}
      function getPointMessageContext() { return {}; }
      function isMemberProfileComplete() { return true; }
      function openProfileOnboarding() { events.push("onboarding"); }
      function redeemPendingPointCampaign() { return Promise.resolve(); }
      function openPendingMemberPanel() { events.push("open-panel"); }
      function sendGasRequest(action) {
        events.push("request:" + action);
        if (action === "upsertMemberIdentity") {
          return Promise.resolve({
            ok: true,
            data: {
              created: false,
              access: { allowed: true, status: "approved" },
              member: member,
              cardSummary: null
            }
          });
        }
        if (action === "getMemberCardSummary") {
          return Promise.resolve({
            ok: true,
            data: {
              access: { allowed: true, status: "approved" },
              pointBalance: 3,
              cardSummary: cardSummary
            }
          });
        }
        throw new Error("unexpected action " + action);
      }
      ${extractFunction("syncMember")}
      ${extractFunction("loadMemberCardSummary")}
      ${extractFunction("loadMemberCardSummarySafely")}
      return { syncMember: syncMember };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, {
    Promise,
    Error,
    events,
    member,
    cardSummary,
  });

  await api.syncMember(1);

  assert.deepEqual(events, [
    "request:upsertMemberIdentity",
    "render-member:MBR-ABCDEF1234",
    "request:getMemberCardSummary",
    "render-card:20",
    "open-panel",
  ]);
});

test("a legacy member backend uses the compatible login action instead of timing out", async () => {
  const actions = [];
  const member = {
    memberId: "MBR-LEGACY1234",
    displayName: "相容會員",
    phone: "0912345678",
    birthday: "1990-01-01",
    pointBalance: 8,
  };
  const cardSummary = {
    currentPoints: 8,
    targetPoints: 20,
    availableDraws: 0,
    rewardRules: [],
    availableRewards: [],
  };
  const moduleSource = `
    (function () {
      var bootVersion = 1;
      var currentIdToken = "";
      var pendingMemberSyncRequestId = "";
      var currentMemberWasCreated = false;
      var memberBackendSupportsProgressive = false;
      var window = {
        liff: { getIDToken: function () { return "header.payload.signature"; } },
        MemberApi: { createRequestId: function () { return "request-legacy-login"; } }
      };
      function setConnection() {}
      function setLoadingCopy() {}
      function setView() {}
      function createClientError(code, message) { var error = new Error(message); error.code = code; return error; }
      function getLiffContext() { return {}; }
      function getMemberSyncAction() { return Promise.resolve("upsertMember"); }
      function assertSuccessfulResponse(response) { if (!response.ok) throw new Error("failed"); }
      function enablePerformanceReporting() {}
      function clearInvalidTokenRecoveryGuard() {}
      function renderAccessState() {}
      function renderMember() { actions.push("render-member"); }
      function renderMemberCardSummary() { actions.push("render-card"); }
      function updateMemberPointBalance() {}
      function sendNewMemberJoinMessage() {}
      function getPointMessageContext() { return {}; }
      function isMemberProfileComplete() { return true; }
      function openProfileOnboarding() {}
      function redeemPendingPointCampaign() { actions.push("redeem-pending"); return Promise.resolve(); }
      function openPendingMemberPanel() { actions.push("open-panel"); }
      function normalizeClientError(error) { return { code: error.code || "CONNECTION_ERROR", message: error.message }; }
      function showToast() {}
      function sendGasRequest(action) {
        actions.push(action);
        if (action === "upsertMemberIdentity") {
          var error = new Error("backend still processing");
          error.code = "REQUEST_STATUS_UNKNOWN";
          return Promise.reject(error);
        }
        if (action !== "upsertMember") throw new Error("unexpected action " + action);
        return Promise.resolve({
          ok: true,
          data: {
            created: false,
            access: { allowed: true, status: "approved" },
            member: member,
            cardSummary: cardSummary
          }
        });
      }
      ${extractFunction("syncMember")}
      ${extractFunction("loadMemberCardSummary")}
      ${extractFunction("loadMemberCardSummarySafely")}
      return { syncMember: syncMember };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, {
    Promise,
    Error,
    actions,
    member,
    cardSummary,
  });

  await api.syncMember(1);

  assert.deepEqual(actions, [
    "upsertMember",
    "render-member",
    "render-card",
    "redeem-pending",
    "open-panel",
  ]);
});

test("member backend health capabilities select the compatible login contract", async () => {
  for (const scenario of [
    { capabilities: [], expectedAction: "upsertMember" },
    {
      capabilities: ["member_identity_v1", "member_card_summary_v1"],
      expectedAction: "upsertMemberIdentity",
    },
  ]) {
    const moduleSource = `
      (function () {
        var CONFIG = { GAS_WEB_APP_URL: "https://script.google.com/macros/s/deployment-id/exec" };
        var memberBackendCapabilitiesPromise = null;
        var memberBackendSupportsProgressive = null;
        var window = {
          MemberApi: { createRequestId: function () { return "request-health-check"; } },
          setTimeout: function () { return 1; },
          clearTimeout: function () {},
          fetch: function () {
            return Promise.resolve({
              ok: true,
              json: function () {
                return Promise.resolve({
                  ok: true,
                  data: {
                    service: "member-client-api",
                    capabilities: capabilities
                  }
                });
              }
            });
          }
        };
        function createClientError(code, message) { var error = new Error(message); error.code = code; return error; }
        ${extractFunction("warmMemberBackendCapabilities")}
        ${extractFunction("getMemberSyncAction")}
        return { getMemberSyncAction: getMemberSyncAction };
      })()
    `;
    const api = vm.runInNewContext(moduleSource, {
      Promise,
      Error,
      URL,
      AbortController,
      capabilities: scenario.capabilities,
    });

    assert.equal(await api.getMemberSyncAction(), scenario.expectedAction);
  }
});

test("member capability preflight times out safely without AbortController", async () => {
  const moduleSource = `
    (function () {
      var CONFIG = { GAS_WEB_APP_URL: "https://script.google.com/macros/s/deployment-id/exec" };
      var memberBackendCapabilitiesPromise = null;
      var memberBackendSupportsProgressive = null;
      var window = {
        MemberApi: { createRequestId: function () { return "request-health-timeout"; } },
        setTimeout: function (callback) { queueMicrotask(callback); return 1; },
        clearTimeout: function () {},
        fetch: function () { return new Promise(function () {}); }
      };
      function createClientError(code, message) { var error = new Error(message); error.code = code; return error; }
      ${extractFunction("warmMemberBackendCapabilities")}
      ${extractFunction("getMemberSyncAction")}
      return { getMemberSyncAction: getMemberSyncAction };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, {
    Promise,
    Error,
    URL,
    queueMicrotask,
  });
  const action = await Promise.race([
    api.getMemberSyncAction(),
    new Promise((resolve) => setTimeout(() => resolve("preflight-stalled"), 25)),
  ]);

  assert.equal(action, "upsertMember");
});

test("a point-card read failure keeps the authenticated member visible", async () => {
  const events = [];
  const member = {
    memberId: "MBR-PARTIAL123",
    displayName: "已登入會員",
    phone: "0912345678",
    birthday: "1990-01-01",
  };
  const moduleSource = `
    (function () {
      var bootVersion = 1;
      var currentIdToken = "";
      var pendingMemberSyncRequestId = "";
      var currentMemberWasCreated = false;
      var memberBackendSupportsProgressive = true;
      var window = {
        liff: { getIDToken: function () { return "header.payload.signature"; } },
        MemberApi: { createRequestId: function () { return "request-partial-login"; } }
      };
      function setConnection(label) { events.push("connection:" + label); }
      function setLoadingCopy() {}
      function setView() {}
      function createClientError(code, message) { var error = new Error(message); error.code = code; return error; }
      function getLiffContext() { return {}; }
      function getMemberSyncAction() { return Promise.resolve("upsertMemberIdentity"); }
      function assertSuccessfulResponse(response) { if (!response.ok) throw new Error("failed"); }
      function enablePerformanceReporting() {}
      function clearInvalidTokenRecoveryGuard() {}
      function renderAccessState() {}
      function renderMember(value) { events.push("render-member:" + value.memberId); }
      function renderMemberCardSummary() { events.push("render-card"); }
      function updateMemberPointBalance() {}
      function sendNewMemberJoinMessage() {}
      function getPointMessageContext() { return {}; }
      function isMemberProfileComplete() { return true; }
      function openProfileOnboarding() {}
      function redeemPendingPointCampaign() { events.push("redeem-pending"); return Promise.resolve(); }
      function openPendingMemberPanel() { events.push("open-panel"); }
      function normalizeClientError(error) { return { code: error.code || "CONNECTION_ERROR", message: error.message }; }
      function showToast(message, tone) { events.push("toast:" + tone + ":" + message); }
      function sendGasRequest(action) {
        if (action === "upsertMemberIdentity") {
          return Promise.resolve({
            ok: true,
            data: {
              created: false,
              access: { allowed: true, status: "approved" },
              member: member
            }
          });
        }
        var error = new Error("card offline");
        error.code = "BACKEND_TIMEOUT";
        return Promise.reject(error);
      }
      ${extractFunction("syncMember")}
      ${extractFunction("loadMemberCardSummary")}
      ${extractFunction("loadMemberCardSummarySafely")}
      return { syncMember: syncMember };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, { Promise, Error, events, member });

  await api.syncMember(1);

  assert.deepEqual(events, [
    "connection:驗證會員身分",
    "render-member:MBR-PARTIAL123",
    "connection:會員已登入，點數卡待同步",
    "toast:error:會員資料已載入，但點數卡暫時無法同步；重新開啟頁面即可再試。",
    "redeem-pending",
    "open-panel",
  ]);
});

test("an unknown member sync result retries with the original request id", async () => {
  const requestIds = [];
  const member = {
    memberId: "MBR-RETRY1234",
    displayName: "重試會員",
    phone: "0912345678",
    birthday: "1990-01-01",
  };
  const cardSummary = {
    currentPoints: 1,
    targetPoints: 10,
    availableDraws: 0,
    rewardRules: [],
    availableRewards: [],
  };
  const moduleSource = `
    (function () {
      var bootVersion = 1;
      var currentIdToken = "";
      var currentMember = null;
      var pendingMemberSyncRequestId = "";
      var currentMemberWasCreated = false;
      var memberBackendSupportsProgressive = true;
      var window = {
        liff: { getIDToken: function () { return "header.payload.signature"; } },
        MemberApi: {
          createRequestId: function () { return "request-" + (syncAttempts + 1); }
        }
      };
      function setConnection() {}
      function setLoadingCopy() {}
      function setView() {}
      function createClientError(code, message) { var error = new Error(message); error.code = code; return error; }
      function getLiffContext() { return {}; }
      function getMemberSyncAction() { return Promise.resolve("upsertMemberIdentity"); }
      function assertSuccessfulResponse(response) { if (!response.ok) throw new Error("failed"); }
      function enablePerformanceReporting() {}
      function clearInvalidTokenRecoveryGuard() {}
      function normalizeClientError(error) { return { code: error.code || "CONNECTION_ERROR", message: error.message }; }
      function showToast() {}
      function renderAccessState() {}
      function renderMember(value) { currentMember = value; }
      function renderMemberCardSummary() {}
      function updateMemberPointBalance() {}
      function sendNewMemberJoinMessage() {}
      function getPointMessageContext() { return {}; }
      function isMemberProfileComplete() { return true; }
      function openProfileOnboarding() {}
      function redeemPendingPointCampaign() { return Promise.resolve(); }
      function openPendingMemberPanel() {}
      function sendGasRequest(action, token, context, fields, requestId) {
        if (action === "upsertMemberIdentity") {
          requestIds.push(requestId);
          syncAttempts += 1;
          if (syncAttempts === 1) {
            var error = new Error("result unknown");
            error.code = "REQUEST_STATUS_UNKNOWN";
            return Promise.reject(error);
          }
          return Promise.resolve({
            ok: true,
            data: {
              created: false,
              access: { allowed: true, status: "approved" },
              member: member
            }
          });
        }
        return Promise.resolve({
          ok: true,
          data: {
            access: { allowed: true, status: "approved" },
            pointBalance: 1,
            cardSummary: cardSummary
          }
        });
      }
      ${extractFunction("syncMember")}
      ${extractFunction("loadMemberCardSummary")}
      ${extractFunction("loadMemberCardSummarySafely")}
      return { syncMember: syncMember };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, {
    Promise,
    Error,
    requestIds,
    member,
    cardSummary,
    syncAttempts: 0,
  });

  await assert.rejects(api.syncMember(1), { code: "REQUEST_STATUS_UNKNOWN" });
  await api.syncMember(1);

  assert.deepEqual(requestIds, ["request-1", "request-1"]);
});

test("the connection retry resumes an unknown member sync without rebooting LIFF", async () => {
  const events = [];
  const moduleSource = `
    (function () {
      var bootVersion = 4;
      var currentIdToken = "header.payload.signature";
      var pendingMemberSyncRequestId = "request-member-sync";
      var window = { liff: { isLoggedIn: function () { return true; } } };
      function syncMember(version) { events.push("sync:" + version); return Promise.resolve(); }
      function start() { events.push("start"); return Promise.resolve(); }
      function handleClientError() { events.push("error"); }
      ${extractFunction("retryMemberConnection")}
      return { retryMemberConnection: retryMemberConnection };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, { Promise, events });

  await api.retryMemberConnection();

  assert.deepEqual(events, ["sync:4"]);
});

test("member request progress exposes meaningful connection stages", () => {
  const events = [];
  const moduleSource = `
    (function () {
      function setConnection(label, tone) { events.push(label + ":" + tone); }
      function setLoadingCopy(title, message) { events.push(title + ":" + message); }
      ${extractFunction("handleRequestProgress")}
      return { handleRequestProgress: handleRequestProgress };
    })()
  `;
  const api = vm.runInNewContext(moduleSource, { events });

  api.handleRequestProgress({
    action: "upsertMemberIdentity",
    phase: "connecting",
    transport: "bridge",
  });
  api.handleRequestProgress({
    action: "getMemberCardSummary",
    phase: "fallback",
    transport: "bridge",
  });

  assert.deepEqual(events, [
    "正在核對會員資料:loading",
    "正在安全同步會員:第一次連線最長可能需要約 45 秒，完成後會立即顯示會員資料。",
    "切換連線方式:loading",
  ]);
});
