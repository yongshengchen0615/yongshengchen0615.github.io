import { buildBookingFlexMessage, deliver } from './delivery.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sampleJob = {
  id: '11111111-1111-4111-8111-111111111111',
  recipient: `U${'a'.repeat(32)}`,
  message_text: [
    '【預約確認】',
    '預約人：王小姐',
    '日期：2026/09/15',
    '時段：10:00–11:00（台北時間）',
    '電話：0912345678',
    '預約項目：',
    '腳底40（40分鐘）',
  ].join('\n'),
  channel: 'member',
  attempt_count: 1,
};

Deno.test('booking notification builds a structured Flex Message', () => {
  const message = buildBookingFlexMessage(sampleJob);
  assert(message.type === 'flex', 'notification must be a Flex Message');
  assert(message.altText.includes('預約確認'), 'altText must describe the booking event');
  assert(message.altText.includes('2026/09/15'), 'altText must include the booking date');

  const payload = JSON.stringify(message.contents);
  assert(payload.includes('王小姐'), 'Flex body must include the booking contact');
  assert(payload.includes('10:00–11:00（台北時間）'), 'Flex body must include the booking time');
  assert(payload.includes('腳底40（40分鐘）'), 'Flex body must include booking services');
  assert(payload.includes('Lumen Club 預約系統'), 'Flex footer must identify the booking system');
});

Deno.test('legacy or unexpected booking text still uses a Flex fallback', () => {
  const message = buildBookingFlexMessage({
    ...sampleJob,
    message_text: '預約狀態已更新，請查看最新資料。',
  });
  assert(message.type === 'flex', 'fallback notification must remain a Flex Message');
  assert(JSON.stringify(message.contents).includes('預約狀態已更新'), 'fallback must preserve the original information');
});

Deno.test('delivery preserves LINE retry idempotency while sending Flex', async () => {
  let requestBodyText = '';
  let retryKey = '';

  const send = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBodyText = String(init?.body || '{}');
    retryKey = new Headers(init?.headers).get('X-Line-Retry-Key') || '';
    return new Response('', { status: 200, headers: { 'x-line-request-id': 'req-123' } });
  }) as typeof fetch;

  const result = await deliver(sampleJob, 'test-channel-access-token', send);
  const requestBody = JSON.parse(requestBodyText) as { messages?: Array<Record<string, unknown>> };
  const messages = requestBody.messages;

  assert(result.accepted === true, 'successful LINE response must be accepted');
  assert(result.lineRequestId === 'req-123', 'LINE request id must be retained');
  assert(retryKey === sampleJob.id, 'outbox UUID must remain the LINE retry key');
  assert(Array.isArray(messages) && messages[0]?.type === 'flex', 'push payload must contain a Flex Message');
});
