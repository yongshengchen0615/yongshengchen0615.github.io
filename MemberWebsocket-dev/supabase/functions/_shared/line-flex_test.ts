import { buildLineFlexNotice } from "./line-flex.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("buildLineFlexNotice creates a valid flex bubble with useful alt text", () => {
  const message = buildLineFlexNotice(
    "王小明，您好：\n\n【本次點數】\n・集點卡 +3 點\n\n【目前會員狀態】\n・會員等級：銀級會員",
    { title: "會員權益通知", eyebrow: "MEMBER BENEFITS" },
  );

  assert(message.type === "flex", "message type should be flex");
  assert(message.altText.includes("王小明"), "altText should preserve recipient context");
  assert(message.altText.includes("本次點數"), "altText should summarize the notice");
  assert(message.altText.length <= 500, "altText should stay within the conservative limit");
  assert(message.contents.type === "bubble", "contents should be a Flex bubble");

  const body = message.contents.body as Record<string, unknown>;
  const contents = body.contents as Array<Record<string, unknown>>;
  assert(Array.isArray(contents) && contents.length > 0, "bubble body should contain components");
  assert(contents.some((item) => item.text === "本次點數"), "section heading should be preserved");
  assert(contents.some((item) => item.text === "目前會員狀態"), "multiple sections should be preserved");
});

Deno.test("buildLineFlexNotice falls back safely and chunks long text", () => {
  const fallback = buildLineFlexNotice("");
  assert(fallback.type === "flex", "empty input should still produce a flex message");
  assert(fallback.altText.length > 0, "empty input should receive fallback altText");

  const longMessage = buildLineFlexNotice("A".repeat(5000), { accent: "not-a-color" });
  const body = longMessage.contents.body as Record<string, unknown>;
  const bodyContents = body.contents as Array<Record<string, unknown>>;
  const textComponents = bodyContents.filter((item) => item.type === "text");
  assert(textComponents.length >= 3, "long text should be split into safe component sizes");
  assert(textComponents.every((item) => String(item.text || "").length <= 1900), "component text should stay under the configured limit");

  const header = longMessage.contents.header as Record<string, unknown>;
  assert(header.backgroundColor === "#315D50", "invalid accent should fall back to the default color");
});
