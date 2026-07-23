const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGas(relativePath) {
  const context = {
    console: { error() {} },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest(_algorithm, value) {
        return Array.from(
          crypto.createHash("sha256").update(String(value)).digest(),
          (byte) => (byte > 127 ? byte - 256 : byte)
        );
      },
      computeHmacSha256Signature(value, secret) {
        return Array.from(
          crypto.createHmac("sha256", String(secret)).update(String(value)).digest(),
          (byte) => (byte > 127 ? byte - 256 : byte)
        );
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(
          Array.from(bytes, (byte) => (Number(byte) + 256) % 256)
        )
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8"),
    context,
    { filename: relativePath }
  );
  return context;
}

test("administrator-issued claim and campaign row are accepted by the member GAS contract", () => {
  const admin = loadGas("gas/admin/Code.gs");
  const client = loadGas("gas/client/Code.gs");

  assert.deepEqual(
    Array.from(admin.POINT_TYPE_HEADERS),
    Array.from(client.POINT_TYPE_HEADERS)
  );
  assert.deepEqual(
    Array.from(admin.POINT_CAMPAIGN_HEADERS),
    Array.from(client.POINT_CAMPAIGN_HEADERS)
  );
  assert.deepEqual(
    Array.from(admin.POINT_REDEMPTION_HEADERS),
    Array.from(client.POINT_REDEMPTION_HEADERS)
  );

  const campaignId = "PCG-ABCDEF1234";
  const pointTypeId = "PTY-ABCDEF1234";
  const requestId = "request-contract-campaign";
  const secret = "s".repeat(64);
  const claim = admin.createCampaignClaim_(campaignId, requestId, secret);
  const expiresAt = new Date(
    Math.floor((Date.now() + 86400000) / 1000) * 1000
  );
  const row = [
    campaignId,
    pointTypeId,
    admin.pointLabel_(3),
    3,
    admin.sha256Hex_(claim),
    "active",
    expiresAt,
    new Date(),
    `U${"a".repeat(32)}`,
    requestId,
    "limited",
    "once_per_member",
  ];
  const sheet = {
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [row.slice()] }),
  };

  assert.match(claim, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    admin.buildPointClaimUrl_(admin.DEFAULT_MEMBER_LIFF_URL, claim),
    `${admin.DEFAULT_MEMBER_LIFF_URL}?claim=${claim}`
  );

  const parsed = client.findPointCampaignByClaim_(sheet, claim);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    campaignId,
    pointTypeId,
    label: "3 點",
    points: 3,
    status: "active",
    expiresAt: expiresAt.toISOString(),
    expiresAtTime: expiresAt.getTime(),
    expiryMode: "limited",
    redemptionMode: "once_per_member",
  });
  client.assertPointCampaignAvailable_(parsed, new Date());
});

test("unlimited repeatable campaign snapshots are accepted without an expiry", () => {
  const admin = loadGas("gas/admin/Code.gs");
  const client = loadGas("gas/client/Code.gs");
  const requestId = "request-contract-permanent";
  const claim = admin.createCampaignClaim_(
    "PCG-PERMANENT1",
    requestId,
    "s".repeat(64)
  );
  const row = [
    "PCG-PERMANENT1",
    "PTY-PERMANENT1",
    "2 點",
    2,
    admin.sha256Hex_(claim),
    "active",
    "",
    new Date(),
    `U${"a".repeat(32)}`,
    requestId,
    "unlimited",
    "repeatable",
  ];
  const sheet = {
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [row.slice()] }),
  };

  const parsed = client.findPointCampaignByClaim_(sheet, claim);
  assert.equal(parsed.expiryMode, "unlimited");
  assert.equal(parsed.redemptionMode, "repeatable");
  assert.equal(parsed.expiresAt, "");
  assert.equal(parsed.expiresAtTime, 0);
  client.assertPointCampaignAvailable_(
    parsed,
    new Date("2099-01-01T00:00:00.000Z")
  );
});

test("single-member campaign snapshots are accepted with a limited expiry", () => {
  const admin = loadGas("gas/admin/Code.gs");
  const client = loadGas("gas/client/Code.gs");
  const requestId = "request-contract-single-member";
  const claim = admin.createCampaignClaim_(
    "PCG-SINGLE0001",
    requestId,
    "s".repeat(64)
  );
  const expiresAt = new Date(
    Math.floor((Date.now() + 86400000) / 1000) * 1000
  );
  const row = [
    "PCG-SINGLE0001",
    "PTY-SINGLE0001",
    "4 點",
    4,
    admin.sha256Hex_(claim),
    "active",
    expiresAt,
    new Date(),
    `U${"a".repeat(32)}`,
    requestId,
    "limited",
    "single_member",
  ];
  const sheet = {
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [row.slice()] }),
  };

  const parsed = client.findPointCampaignByClaim_(sheet, claim);
  assert.equal(parsed.redemptionMode, "single_member");
  assert.equal(parsed.expiryMode, "limited");
  client.assertPointCampaignAvailable_(parsed, new Date());
});
