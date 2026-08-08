const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "shared", "gas-api.js"),
  "utf8"
);

test("public config load preconnects the validated GAS origin without requesting GAS", async () => {
  const appendedLinks = [];
  const fetchUrls = [];
  const document = {
    baseURI: "https://example.test/client/",
    head: {
      appendChild(element) {
        appendedLinks.push({
          rel: element.rel,
          href: element.href,
          crossOrigin: element.crossOrigin,
        });
      },
    },
    body: { appendChild() {} },
    createElement(tagName) {
      if (tagName === "link") {
        return { rel: "", href: "", crossOrigin: "" };
      }
      return {
        appendChild() {},
        remove() {},
        submit() {},
      };
    },
    querySelector() {
      return null;
    },
  };
  const window = {
    location: { origin: "https://example.test" },
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(9);
        return bytes;
      },
    },
    fetch(url) {
      fetchUrls.push(String(url));
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(
            JSON.stringify({
              LIFF_ID: "2010787602-kaiSm2eq",
              GAS_WEB_APP_URL:
                "https://script.google.com/macros/s/example-deployment/exec",
              BRAND_NAME: "PERSONA",
            })
          );
        },
      });
    },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    AbortController,
    Promise,
    TypeError,
    URL,
    Uint8Array,
    document,
    setTimeout,
    clearTimeout,
    window,
  });
  vm.runInContext(source, context, { filename: "shared/gas-api.js" });

  await window.MemberApi.loadConfig("config.json", [
    "LIFF_ID",
    "GAS_WEB_APP_URL",
    "BRAND_NAME",
  ]);

  assert.deepEqual(fetchUrls, ["https://example.test/client/config.json"]);
  assert.deepEqual(appendedLinks, [
    {
      rel: "preconnect",
      href: "https://script.google.com",
      crossOrigin: "anonymous",
    },
  ]);
});

test("config loading does not preconnect an invalid GAS endpoint", async () => {
  const appendedLinks = [];
  const document = {
    baseURI: "https://example.test/client/",
    head: {
      appendChild(element) {
        appendedLinks.push(element.href);
      },
    },
    body: { appendChild() {} },
    createElement(tagName) {
      if (tagName === "link") return { rel: "", href: "", crossOrigin: "" };
      return { appendChild() {}, remove() {}, submit() {} };
    },
    querySelector() {
      return null;
    },
  };
  const window = {
    location: { origin: "https://example.test" },
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(4);
        return bytes;
      },
    },
    fetch() {
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(
            JSON.stringify({ GAS_WEB_APP_URL: "https://evil.example/exec" })
          );
        },
      });
    },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    AbortController,
    Promise,
    TypeError,
    URL,
    Uint8Array,
    document,
    setTimeout,
    clearTimeout,
    window,
  });
  vm.runInContext(source, context, { filename: "shared/gas-api.js" });

  await window.MemberApi.loadConfig("config.json", ["GAS_WEB_APP_URL"]);

  assert.deepEqual(appendedLinks, []);
});
