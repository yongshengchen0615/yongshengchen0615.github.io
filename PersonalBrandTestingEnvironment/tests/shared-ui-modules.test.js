const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadBrowserModule(relativePath, globals = {}) {
  const window = {};
  const context = vm.createContext({
    URLSearchParams,
    window,
    ...globals,
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    context,
    { filename: relativePath }
  );
  return window;
}

function createCanvasRecorder() {
  const operations = [];
  const context = {
    beginPath() {
      operations.push(["beginPath"]);
    },
    moveTo(x, y) {
      operations.push(["moveTo", x, y]);
    },
    arc(x, y, radius, start, end) {
      operations.push(["arc", x, y, radius, start, end]);
    },
    closePath() {
      operations.push(["closePath"]);
    },
    fill() {
      operations.push(["fill", this.fillStyle]);
    },
    stroke() {
      operations.push(["stroke", this.strokeStyle, this.lineWidth]);
    },
    save() {
      operations.push(["save"]);
    },
    translate(x, y) {
      operations.push(["translate", x, y]);
    },
    rotate(value) {
      operations.push(["rotate", value]);
    },
    fillText(label, x, y) {
      operations.push(["fillText", label, x, y, this.fillStyle, this.font]);
    },
    restore() {
      operations.push(["restore"]);
    },
    clearRect(x, y, width, height) {
      operations.push(["clearRect", x, y, width, height]);
    },
  };
  return {
    canvas: {
      width: 0,
      height: 0,
      getContext(kind) {
        assert.equal(kind, "2d");
        return context;
      },
    },
    operations,
  };
}

test("shared GAS requests use the bridge immediately for a published cross-origin web app", async () => {
  let messageListener = null;
  let fetchCalls = 0;
  let submittedForms = 0;
  const document = {
    baseURI: "https://example.test/client/",
    body: {
      appendChild() {},
    },
    createElement(tagName) {
      const element = {
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
        remove() {},
      };
      if (tagName === "form") {
        element.submit = function () {
          submittedForms += 1;
          const fields = Object.fromEntries(
            this.children.map((child) => [child.name, child.value])
          );
          queueMicrotask(() => {
            messageListener({
              origin: "https://script.google.com",
              data: {
                type: "MEMBER_GAS_RESPONSE",
                requestId: fields.requestId,
                requestSecret: fields.requestSecret,
                result: { ok: true, requestId: fields.requestId },
              },
            });
          });
        };
      }
      return element;
    },
  };
  const window = {
    location: { origin: "https://example.test" },
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(7);
        return bytes;
      },
    },
    fetch() {
      fetchCalls += 1;
      return Promise.reject(new TypeError("CORS"));
    },
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    removeEventListener(type, listener) {
      if (type === "message" && messageListener === listener) {
        messageListener = null;
      }
    },
  };
  const context = vm.createContext({
    AbortController,
    Promise,
    URL,
    Uint8Array,
    clearTimeout,
    document,
    queueMicrotask,
    setTimeout,
    window,
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "shared/gas-api.js"), "utf8"),
    context,
    { filename: "shared/gas-api.js" }
  );

  const result = await window.MemberApi.sendRequest({
    gasUrl: "https://script.google.com/macros/s/example/exec",
    action: "health",
    requestId: "req-1234567890",
  });

  assert.equal(result.ok, true);
  assert.equal(result.requestId, "req-1234567890");
  assert.equal(fetchCalls, 0);
  assert.equal(submittedForms, 1);
});

test("shared LIFF runtime normalizes context and validates public configuration", () => {
  const window = loadBrowserModule("shared/liff-runtime.js");
  const runtime = window.LiffRuntime;
  const liff = {
    getContext() {
      return {
        type: " utou ",
        viewType: "full",
      };
    },
    getOS() {
      return "ios";
    },
    getAppLanguage() {
      return "zh-TW";
    },
    isInClient() {
      return true;
    },
  };
  const memberApi = {
    isValidGasUrl(value) {
      return value === "https://script.google.com/macros/s/example/exec";
    },
  };

  assert.equal(Object.isFrozen(runtime), true);
  assert.deepEqual(
    { ...runtime.getContext(liff, { language: "en", platform: "web" }) },
    {
      type: "utou",
      viewType: "full",
      os: "ios",
      language: "zh-TW",
      inClient: true,
    }
  );
  assert.equal(
    runtime.hasCompleteConfig(
      {
        LIFF_ID: "2010787602-kaiSm2eq",
        GAS_WEB_APP_URL: "https://script.google.com/macros/s/example/exec",
      },
      memberApi
    ),
    true
  );
  assert.equal(
    runtime.hasCompleteConfig(
      {
        LIFF_ID: "YOUR_LIFF_ID",
        GAS_WEB_APP_URL: "https://script.google.com/macros/s/example/exec",
      },
      memberApi
    ),
    false
  );
  assert.equal(runtime.hasDemoQuery("?claim=test&demo=1"), true);
  assert.equal(runtime.hasDemoQuery("?demo=0"), false);
});

test("shared LIFF runtime falls back to bounded browser context", () => {
  const window = loadBrowserModule("shared/liff-runtime.js");
  const context = window.LiffRuntime.getContext(
    {},
    {
      platform: "x".repeat(80),
      language: " zh-Hant-TW ",
    }
  );

  assert.equal(context.os, "x".repeat(40));
  assert.equal(context.language, "zh-Hant-TW");
  assert.equal("type" in context, false);
  assert.equal("inClient" in context, false);
});

test("shared lottery wheel renders bounded labels and accessible text colors", () => {
  const window = loadBrowserModule("shared/lottery-wheel.js");
  const renderer = window.LotteryWheel;
  const { canvas, operations } = createCanvasRecorder();

  assert.equal(Object.isFrozen(renderer), true);
  assert.equal(renderer.textColor("#000000"), "#FFFFFF");
  assert.equal(renderer.textColor("#FFFFFF"), "#0B3C2C");
  assert.equal(renderer.textColor("invalid"), "#0B3C2C");
  assert.equal(
    renderer.draw(
      canvas,
      [
        { label: "ABCDEFGHIJKLMN", color: "#000000" },
        { label: "", color: "invalid" },
      ],
      { separatorColor: "rgba(1, 2, 3, 0.5)" }
    ),
    true
  );

  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 720);
  assert.deepEqual(operations[0], ["clearRect", 0, 0, 720, 720]);
  assert.deepEqual(
    operations.filter((operation) => operation[0] === "fill").map((operation) => operation[1]),
    ["#000000", "#D9D6CC"]
  );
  assert.deepEqual(
    operations
      .filter((operation) => operation[0] === "fillText")
      .map((operation) => operation.slice(1, 2)),
    [["ABCDEFGHIJ"], ["未命名"]]
  );
  assert.equal(
    operations.filter(
      (operation) =>
        operation[0] === "stroke" &&
        operation[1] === "rgba(1, 2, 3, 0.5)" &&
        operation[2] === 5
    ).length,
    2
  );
  assert.deepEqual(operations.at(-1), ["stroke", "#0B3C2C", 10]);
});

test("shared lottery wheel fails safely without a usable canvas", () => {
  const window = loadBrowserModule("shared/lottery-wheel.js");

  assert.equal(window.LotteryWheel.draw(null, []), false);
  assert.equal(window.LotteryWheel.draw({}, []), false);
  assert.equal(
    window.LotteryWheel.draw(
      {
        getContext() {
          return null;
        },
      },
      []
    ),
    false
  );
});
