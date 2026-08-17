const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadContract(relativePath, moduleName) {
  const window = {};
  window.window = window;
  const context = vm.createContext({ Error, Object, Promise, String, window });
  for (const sourcePath of ["shared/module-registry.js", relativePath]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, sourcePath), "utf8"),
      context,
      { filename: sourcePath }
    );
  }
  return window.PersonaModules.get(moduleName);
}

function loadGasActionInventory(relativePath, inventoryName) {
  const context = vm.createContext({ Object, String });
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
    context,
    { filename: relativePath }
  );
  return Array.from(context[inventoryName]);
}

test("member action contract owns the complete member command inventory", () => {
  const api = loadContract("client/member-api.js", "member.api");
  const expectedActions = [
    "upsertMember",
    "updateMemberProfile",
    "listPointHistory",
    "getLotteryConfig",
    "drawLottery",
    "previewPointCampaign",
    "redeemPointCampaign",
    "deleteMember",
  ];
  assert.deepEqual(Array.from(api.actions), expectedActions);
  assert.deepEqual(
    loadGasActionInventory("gas/client/Commands.gs", "MEMBER_ACTIONS"),
    expectedActions
  );
  assert.deepEqual(
    { ...api.createPayload("drawLottery", { lotteryTypeId: "LTY-ABCDEF1234", cardRoundKey: "key" }) },
    { lotteryTypeId: "LTY-ABCDEF1234", cardRoundKey: "key" }
  );
  assert.throws(
    () => api.createPayload("drawLottery", { targetMemberId: "MBR-ABCDEF1234" }),
    (error) => error.code === "INVALID_ACTION_FIELD"
  );
  assert.throws(
    () => api.createPayload("adminListMembers", {}),
    (error) => error.code === "UNSUPPORTED_ACTION"
  );
});

test("administrator action contract owns the complete administrator command inventory", () => {
  const api = loadContract("admin/admin-api.js", "admin.api");
  const expectedActions = [
    "adminListMembers",
    "adminSetMemberAccess",
    "adminListPointTypes",
    "adminListPointHistory",
    "adminCreatePointType",
    "adminDeletePointType",
    "adminCreatePointCampaign",
    "adminGetLotteryConfig",
    "adminSavePointCardSetting",
    "adminCreateLotteryType",
    "adminDeleteLotteryType",
    "adminSaveLotteryConfig",
    "adminListLotteryDraws",
  ];
  assert.deepEqual(Array.from(api.actions), expectedActions);
  assert.deepEqual(
    loadGasActionInventory("gas/admin/Commands.gs", "ADMIN_ACTIONS"),
    expectedActions
  );
  assert.deepEqual(
    {
      ...api.createPayload("adminSetMemberAccess", {
        targetMemberId: "MBR-ABCDEF1234",
        accessStatus: "denied",
        expectedAccessStatus: "approved",
        expectedAccessUpdatedAt: "2026-08-17T00:00:00.000Z",
      }),
    },
    {
      targetMemberId: "MBR-ABCDEF1234",
      accessStatus: "denied",
      expectedAccessStatus: "approved",
      expectedAccessUpdatedAt: "2026-08-17T00:00:00.000Z",
    }
  );
  assert.throws(
    () => api.createPayload("adminListMembers", { claim: "unexpected" }),
    (error) => error.code === "INVALID_ACTION_FIELD"
  );
  assert.throws(
    () => api.createPayload("upsertMember", {}),
    (error) => error.code === "UNSUPPORTED_ACTION"
  );
});
