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

function createHarness(sendMessages) {
  const window = {
    liff: {
      sendMessages,
    },
  };
  const moduleSource = `
    (function () {
      ${extractFunction("sendNewMemberJoinMessage")}
      ${extractFunction("sendOfficialAccountMessage")}
      ${extractFunction("cleanDisplayText")}
      return {
        sendNewMemberJoinMessage: sendNewMemberJoinMessage
      };
    })()
  `;

  return vm.runInNewContext(moduleSource, { window });
}

test("a newly created member sends one bounded join message", async () => {
  const messages = [];
  const api = createHarness((payload) => {
    messages.push(payload);
    return Promise.resolve();
  });

  const result = await api.sendNewMemberJoinMessage(
    { inClient: true, isOneToOneChat: true },
    {
      memberId: "MBR-00001234",
      displayName: "測試會員",
      phone: "0912345678",
      birthday: "1990-01-01",
      lineUserId: "U-secret",
    },
    true
  );

  assert.equal(result.sent, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(messages[0])),
    [
      {
        type: "text",
        text:
          "新會員加入通知\n我已完成會員註冊\n會員編號：MBR-00001234\n" +
          "會員名稱：測試會員",
      },
    ]
  );
  assert.doesNotMatch(messages[0][0].text, /0912345678|1990-01-01|U-secret/);
});

test("existing members and unavailable chat contexts do not send a join message", async () => {
  let sendCount = 0;
  const api = createHarness(() => {
    sendCount += 1;
    return Promise.resolve();
  });
  const member = { memberId: "MBR-00001234", displayName: "測試會員" };

  const existing = await api.sendNewMemberJoinMessage(
    { inClient: true, isOneToOneChat: true },
    member,
    false
  );
  const external = await api.sendNewMemberJoinMessage(
    { inClient: false, isOneToOneChat: false },
    member,
    true
  );

  assert.equal(existing.reason, "not_new_member");
  assert.equal(external.reason, "unavailable");
  assert.equal(sendCount, 0);
});

test("join message delivery failure never rejects member creation", async () => {
  const api = createHarness(() => Promise.reject(new Error("LINE unavailable")));

  const result = await api.sendNewMemberJoinMessage(
    { inClient: true, isOneToOneChat: true },
    { memberId: "MBR-00001234", displayName: "測試會員" },
    true
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { sent: false, reason: "send_failed" }
  );
});
