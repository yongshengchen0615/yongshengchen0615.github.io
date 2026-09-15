export type Job = {
  id: string;
  recipient: string;
  message_text: string;
  channel: string;
  attempt_count: number;
  booking_id?: string;
  event_key?: string;
};
export type Delivery = { accepted: boolean; retryable: boolean; status: number | null; lineRequestId: string };

type ParsedBookingMessage = {
  title: string;
  fields: Array<{ label: string; value: string }>;
  services: string[];
  fallbackText: string;
};

type FlexText = Record<string, unknown>;
type LineFlexMessage = {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
};

const TITLE_STYLES: Record<string, { color: string; eyebrow: string }> = {
  '預約': { color: '#DF6B4D', eyebrow: 'NEW BOOKING' },
  '修改預約': { color: '#C56E32', eyebrow: 'BOOKING UPDATED' },
  '取消預約申請': { color: '#9A711F', eyebrow: 'CANCELLATION REQUEST' },
  '預約確認': { color: '#2F8F61', eyebrow: 'BOOKING CONFIRMED' },
  '完成服務': { color: '#286553', eyebrow: 'SERVICE COMPLETED' },
  '預約未通過': { color: '#B35A50', eyebrow: 'BOOKING DECLINED' },
  '預約取消': { color: '#68756F', eyebrow: 'BOOKING CANCELLED' },
  '取消申請未通過': { color: '#A85C50', eyebrow: 'CANCELLATION DECLINED' },
};

const MAX_COMPONENT_TEXT = 1900;
const MAX_ALT_TEXT = 500;

function truncate(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

function parseBookingMessage(message: string): ParsedBookingMessage {
  const fallbackText = truncate(message, MAX_COMPONENT_TEXT) || '預約狀態已更新，請至預約頁查看最新資訊。';
  const lines = String(message || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  let title = '預約通知';
  let index = 0;
  const first = lines[0] || '';
  const titleMatch = first.match(/^【([^】]{1,40})】$/);
  if (titleMatch) {
    title = truncate(titleMatch[1], 40);
    index = 1;
  }

  const fields: Array<{ label: string; value: string }> = [];
  const services: string[] = [];
  let readingServices = false;

  for (; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;

    if (readingServices) {
      services.push(truncate(line, 180));
      continue;
    }

    const separator = line.indexOf('：');
    if (separator > 0) {
      const label = truncate(line.slice(0, separator), 30);
      const value = truncate(line.slice(separator + 1), 500);
      if (label === '預約項目') {
        readingServices = true;
        if (value) services.push(truncate(value, 180));
      } else if (value) {
        fields.push({ label, value });
      }
      continue;
    }

    // Preserve unexpected legacy/future text rather than dropping information.
    fields.push({ label: '說明', value: truncate(line, 500) });
  }

  return { title, fields, services, fallbackText };
}

function fieldRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    alignItems: 'flex-start',
    contents: [
      {
        type: 'text',
        text: truncate(label, 30),
        size: 'sm',
        color: '#7B8781',
        flex: 0,
        width: '74px',
        wrap: true,
      },
      {
        type: 'text',
        text: truncate(value, 500),
        size: 'sm',
        color: '#17352E',
        flex: 1,
        wrap: true,
      },
    ],
  };
}

function makeAltText(parsed: ParsedBookingMessage): string {
  const date = parsed.fields.find((field) => field.label === '日期')?.value || '';
  const time = parsed.fields.find((field) => field.label === '時段')?.value || '';
  const service = parsed.services[0] || '';
  const summary = [parsed.title, date, time, service].filter(Boolean).join('｜');
  return truncate(summary || parsed.fallbackText, MAX_ALT_TEXT);
}

export function buildBookingFlexMessage(job: Job): LineFlexMessage {
  const parsed = parseBookingMessage(job.message_text);
  const style = TITLE_STYLES[parsed.title] || { color: '#315D50', eyebrow: 'BOOKING NOTICE' };
  const channelLabel = job.channel === 'admin' ? '管理端預約通知' : '會員預約通知';
  const bodyContents: Array<Record<string, unknown>> = [];

  if (parsed.fields.length) {
    bodyContents.push(...parsed.fields.map((field) => fieldRow(field.label, field.value)));
  }

  if (parsed.services.length) {
    if (bodyContents.length) {
      bodyContents.push({ type: 'separator', margin: 'lg', color: '#E3EAE6' });
    }
    bodyContents.push(
      {
        type: 'text',
        text: '預約項目',
        size: 'xs',
        weight: 'bold',
        color: '#7B8781',
        margin: bodyContents.length ? 'lg' : 'none',
      },
      {
        type: 'text',
        text: truncate(parsed.services.map((service) => `• ${service}`).join('\n'), MAX_COMPONENT_TEXT),
        size: 'sm',
        color: '#17352E',
        wrap: true,
        margin: 'sm',
      },
    );
  }

  if (!bodyContents.length) {
    bodyContents.push({
      type: 'text',
      text: parsed.fallbackText,
      size: 'sm',
      color: '#17352E',
      wrap: true,
    });
  }

  const headerContents: FlexText[] = [
    {
      type: 'text',
      text: style.eyebrow,
      size: 'xxs',
      weight: 'bold',
      color: '#FFFFFFCC',
    },
    {
      type: 'text',
      text: parsed.title,
      size: 'xl',
      weight: 'bold',
      color: '#FFFFFF',
      wrap: true,
      margin: 'sm',
    },
    {
      type: 'text',
      text: channelLabel,
      size: 'xs',
      color: '#FFFFFFDD',
      margin: 'sm',
    },
  ];

  return {
    type: 'flex',
    altText: makeAltText(parsed),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: style.color,
        paddingAll: '20px',
        contents: headerContents,
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        backgroundColor: '#F6F8F7',
        contents: [
          {
            type: 'text',
            text: 'Lumen Club 預約系統',
            size: 'xxs',
            color: '#87928D',
            align: 'center',
          },
        ],
      },
    },
  };
}

export function secureEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ (b[i] || 0);
  return difference === 0;
}

export async function deliver(job: Job, token: string, send: typeof fetch = fetch): Promise<Delivery> {
  if (!token) return { accepted: false, retryable: true, status: null, lineRequestId: '' };
  try {
    const message = buildBookingFlexMessage(job);
    const response = await send('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Line-Retry-Key': job.id },
      body: JSON.stringify({ to: job.recipient, messages: [message] }),
      signal: AbortSignal.timeout(10000),
    });
    const acceptedId = response.headers.get('x-line-accepted-request-id') || '';
    return {
      accepted: response.ok || (response.status === 409 && !!acceptedId),
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
      lineRequestId: acceptedId || response.headers.get('x-line-request-id') || '',
    };
  } catch {
    return { accepted: false, retryable: true, status: null, lineRequestId: '' };
  }
}
