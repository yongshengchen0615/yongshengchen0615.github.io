export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

export type LineFlexNoticeOptions = {
  title?: string;
  eyebrow?: string;
  accent?: string;
  footer?: string;
};

type ParsedSection = {
  title: string;
  lines: string[];
};

const MAX_ALT_TEXT = 500;
const MAX_COMPONENT_TEXT = 1900;
const MAX_MESSAGE_TEXT = 5000;
const MAX_SECTIONS = 12;
const DEFAULT_ACCENT = "#315D50";

function truncate(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

function normalizeMessage(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  return truncate(text || "會員權益已更新，請至會員系統查看最新資訊。", MAX_MESSAGE_TEXT);
}

function safeAccent(value: unknown): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCENT;
}

function parseMessage(message: string): { intro: string[]; sections: ParsedSection[] } {
  const intro: string[] = [];
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const rawLine of message.split("\n")) {
    const line = rawLine.trimEnd();
    const heading = line.trim().match(/^【([^】]{1,40})】(?:\s*(.*))?$/);
    if (heading && sections.length < MAX_SECTIONS) {
      if (current) sections.push(current);
      current = { title: truncate(heading[1], 40), lines: [] };
      if (heading[2]) current.lines.push(truncate(heading[2], MAX_COMPONENT_TEXT));
      continue;
    }
    if (current) current.lines.push(line);
    else intro.push(line);
  }

  if (current) sections.push(current);
  return { intro, sections };
}

function compactLines(lines: string[]): string {
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitComponentText(value: string): string[] {
  const text = truncate(value, MAX_MESSAGE_TEXT);
  if (!text) return [];
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += MAX_COMPONENT_TEXT) {
    chunks.push(chars.slice(index, index + MAX_COMPONENT_TEXT).join(""));
  }
  return chunks;
}

function textComponents(value: string, color = "#17352E"): Array<Record<string, unknown>> {
  return splitComponentText(value).map((text, index) => ({
    type: "text",
    text,
    size: "sm",
    color,
    wrap: true,
    ...(index > 0 ? { margin: "sm" } : {}),
  }));
}

function makeAltText(message: string, title: string): string {
  const summary = message
    .replace(/[【】]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(summary || title, MAX_ALT_TEXT);
}

export function buildLineFlexNotice(messageText: unknown, options: LineFlexNoticeOptions = {}): LineFlexMessage {
  const message = normalizeMessage(messageText);
  const title = truncate(options.title || "會員通知", 60);
  const eyebrow = truncate(options.eyebrow || "LUMEN CLUB", 40);
  const footer = truncate(options.footer || "Lumen Club 會員系統", 80);
  const accent = safeAccent(options.accent);
  const parsed = parseMessage(message);
  const bodyContents: Array<Record<string, unknown>> = [];
  const intro = compactLines(parsed.intro);

  if (intro) bodyContents.push(...textComponents(intro));

  for (const section of parsed.sections) {
    if (bodyContents.length) bodyContents.push({ type: "separator", margin: "lg", color: "#E3EAE6" });
    bodyContents.push({
      type: "text",
      text: section.title,
      size: "sm",
      weight: "bold",
      color: accent,
      wrap: true,
      margin: bodyContents.length ? "lg" : "none",
    });
    const sectionText = compactLines(section.lines);
    if (sectionText) {
      bodyContents.push(...textComponents(sectionText).map((component, index) => ({
        ...component,
        margin: index === 0 ? "sm" : "xs",
      })));
    }
  }

  if (!bodyContents.length) bodyContents.push(...textComponents(message));

  return {
    type: "flex",
    altText: makeAltText(message, title),
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: accent,
        paddingAll: "20px",
        contents: [
          { type: "text", text: eyebrow, size: "xxs", weight: "bold", color: "#DDE9E5" },
          { type: "text", text: title, size: "xl", weight: "bold", color: "#FFFFFF", wrap: true, margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        backgroundColor: "#F6F8F7",
        contents: [
          { type: "text", text: footer, size: "xxs", color: "#87928D", align: "center" },
        ],
      },
    },
  };
}
