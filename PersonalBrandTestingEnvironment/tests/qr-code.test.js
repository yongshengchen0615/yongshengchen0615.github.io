const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "shared", "qr-code.js"),
  "utf8"
);

function loadEncoder() {
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "shared/qr-code.js" });
  return context.globalThis.PersonaQr;
}

test("local QR encoder creates a deterministic Version 5 matrix for a LIFF claim URL", () => {
  const encoder = loadEncoder();
  const payload =
    "https://liff.line.me/2010787602-kaiSm2eq?claim=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
  const matrix = encoder.createMatrix(payload);

  assert.equal(matrix.length, 37);
  assert.equal(matrix.every((row) => row.length === 37), true);
  assert.equal(matrix.flat().every((value) => typeof value === "boolean"), true);
  assert.deepEqual(
    Array.from(matrix.slice(0, 7), (row) =>
      Array.from(row.slice(0, 7), Number).join("")
    ),
    [
      "1111111",
      "1000001",
      "1011101",
      "1011101",
      "1011101",
      "1000001",
      "1111111",
    ]
  );

  const bits = Array.from(matrix, (row) => Array.from(row, Number).join("")).join("");
  assert.equal(
    crypto.createHash("sha256").update(bits).digest("hex"),
    "a8ea489dddf4ce0c5b63bd5b69eac806fb46b69d1cd4eef4a5f26a050ece14d2"
  );
});

test("local QR encoder rejects content beyond its audited byte capacity", () => {
  const encoder = loadEncoder();
  assert.throws(
    () => encoder.createMatrix("x".repeat(107)),
    /QR 內容過長/
  );
});
