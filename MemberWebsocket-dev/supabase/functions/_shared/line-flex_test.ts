import { buildLineFlexNotice } from "./line-flex.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectComponents(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const collected: Array<Record<string, unknown>> = [record];
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) collected.push(...collectComponents(item));
    } else if (child && typeof child === "object") {
      collected.push(...collectComponents(child));
    }
  }
  return collected;
}

Deno.test("buildLineFlexNotice creates a structured card layout with useful alt text", () => {
  const message = buildLineFlexNotice(
    "王小明，您好：\n\n【本次點數】\n・集點卡 +3 點\n\n【目前會員狀態】\n・累積服務時間：320 分鐘\n・會員等級：銀級會員",
    { title: "會員權益通知", eyebrow: "MEMBER BENEFITS" },
  );

  assert(message.type === "flex", "message type should be flex");
  assert(message.altText.includes("王小明"), "altText should preserve recipient context");
  assert(message.altText.includes("本次點數"), "altText should summarize the notice");
  assert(message.altText.length <= 500, "altText should stay within the conservative limit");
  assert(message.contents.type === "bubble", "contents should be a Flex bubble");

  const body = message.contents.body as Record<string, unknown>;
  const contents = body.contents as Array<Record<string, unknown>>;
  assert(Array.isArray(contents) && contents.length === 3, "intro and sections should render as separate cards");
  assert(contents.every((item) => item.type === "box"), "top-level body items should be mobile-friendly cards");
  assert(contents.every((item) => item.cornerRadius === "12px"), "cards should use consistent rounded corners");

  const components = collectComponents(body);
  assert(components.some((item) => item.text === "本次點數"), "section heading should be preserved");
  assert(components.some((item) => item.text === "目前會員狀態"), "multiple sections should be preserved");
  assert(components.some((item) => item.text === "會員等級"), "key/value lines should expose the label separately");
  assert(components.some((item) => item.text === "銀級會員"), "key/value lines should preserve the value");
});

Deno.test("buildLineFlexNotice falls back safely and chunks long text", () => {
  const fallback = buildLineFlexNotice("");
  assert(fallback.type === "flex", "empty input should still produce a flex message");
  assert(fallback.altText.length > 0, "empty input should receive fallback altText");

  const longMessage = buildLineFlexNotice("A".repeat(5000), { accent: "not-a-color" });
  const body = longMessage.contents.body as Record<string, unknown>;
  const textComponents = collectComponents(body).filter((item) => item.type === "text");
  assert(textComponents.length >= 3, "long text should be split into safe component sizes");
  assert(textComponents.every((item) => String(item.text || "").length <= 1900), "component text should stay under the configured limit");

  const header = longMessage.contents.header as Record<string, unknown>;
  assert(header.backgroundColor === "#315D50", "invalid accent should fall back to the default color");
});
