import { buildBookingFlexMessage, deliver } from './delivery.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectComponents(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const collected: Array<Record<string, unknown>> = [record];
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) collected.push(...collectComponents(item));
    } else if (child && typeof child === 'object') {
      collected.push(...collectComponents(child));
    }
  }
  return collected;
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
    '預約人數：2 位',
    '會員備註：希望加強肩頸',
    '管理端說明：已安排安靜區域',
    '',
    '第一位預約',
    '預約項目：腳底40',
    '預約技師：10',
    '',
    '第二位預約',
    '預約項目：肩頸30、頭部20',
    '預約技師：現場安排',
  ].join('\n'),
  channel: 'member',
  attempt_count: 1,
};

Deno.test('booking notification builds a structured mobile-friendly Flex Message', () => {
  const message = buildBookingFlexMessage(sampleJob);
  assert(message.type === 'flex', 'notification must be a Flex Message');
  assert(message.altText.includes('預約確認'), 'altText must describe the booking event');
  assert(message.altText.includes('2026/09/15'), 'altText must include the booking date');

  const body = message.contents.body as Record<string, unknown>;
  const cards = body.contents as Array<Record<string, unknown>>;
  assert(Array.isArray(cards) && cards.length === 3, 'schedule, details and services should render as separate cards');
  assert(cards.every((item) => item.type === 'box'), 'body sections should render as boxes');
  assert(cards.every((item) => item.cornerRadius === '12px'), 'body cards should use consistent rounded corners');

  const components = collectComponents(message.contents);
  assert(components.some((item) => item.text === '預約時間'), 'Flex body must highlight the booking schedule');
  assert(components.some((item) => item.text === '2026/09/15' && item.size === 'lg'), 'date should receive strong visual emphasis');
  assert(components.some((item) => item.text === '王小姐'), 'Flex body must include the booking contact');
  assert(components.some((item) => item.text === '希望加強肩頸'), 'Flex body must include the member note');
  assert(components.some((item) => item.text === '已安排安靜區域'), 'Flex body must include the admin note');
  assert(components.some((item) => item.text === '10:00–11:00（台北時間）'), 'Flex body must include the booking time');
  assert(components.some((item) => item.text === '第一位預約'), 'Flex body must identify the first participant');
  assert(components.some((item) => item.text === '第二位預約'), 'Flex body must identify the second participant');
  assert(components.some((item) => item.text === '腳底40'), 'Flex body must include the first participant services');
  assert(components.some((item) => item.text === '肩頸30、頭部20'), 'Flex body must keep participant services grouped');
  assert(components.some((item) => item.text === '10'), 'Flex body must include the selected technician');
  assert(components.some((item) => item.text === '現場安排'), 'Flex body must support on-site technician assignment');
  assert(components.some((item) => item.text === 'Lumen Club 預約系統'), 'Flex footer must identify the booking system');
});

Deno.test('legacy aggregate service notification remains compatible', () => {
  const message = buildBookingFlexMessage({
    ...sampleJob,
    message_text: [
      '【預約】',
      '預約人：王小姐',
      '日期：2026/09/15',
      '時段：10:00–11:00（台北時間）',
      '電話：0912345678',
      '預約項目：',
      '腳底40',
    ].join('\n'),
  });
  assert(JSON.stringify(message.contents).includes('腳底40'), 'legacy queued service details must still render');
});

Deno.test('legacy or unexpected booking text still uses a Flex fallback card', () => {
  const message = buildBookingFlexMessage({
    ...sampleJob,
    message_text: '預約狀態已更新，請查看最新資料。',
  });
  assert(message.type === 'flex', 'fallback notification must remain a Flex Message');
  const body = message.contents.body as Record<string, unknown>;
  const cards = body.contents as Array<Record<string, unknown>>;
  assert(cards.length === 1 && cards[0].cornerRadius === '12px', 'fallback should use the same card presentation');
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


Deno.test('delivery marks 500 and 429 as retryable without changing the LINE retry key', async () => {
  const seenRetryKeys: string[] = [];
  const statuses = [500, 429];
  let call = 0;

  const send = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenRetryKeys.push(new Headers(init?.headers).get('X-Line-Retry-Key') || '');
    const status = statuses[call++] ?? 500;
    return new Response('', { status, headers: { 'x-line-request-id': 'req-' + status } });
  }) as typeof fetch;

  const first = await deliver(sampleJob, 'test-channel-access-token', send);
  const second = await deliver(sampleJob, 'test-channel-access-token', send);

  assert(first.accepted === false && first.retryable === true && first.status === 500,
    'HTTP 500 must remain retryable and unaccepted');
  assert(second.accepted === false && second.retryable === true && second.status === 429,
    'HTTP 429 must remain retryable and unaccepted');
  assert(seenRetryKeys.length === 2 && seenRetryKeys.every((value) => value === sampleJob.id),
    'every retry must reuse the same outbox UUID as X-Line-Retry-Key');
});

Deno.test('delivery can retry the same job after a transient failure and succeed exactly once', async () => {
  const seenRetryKeys: string[] = [];
  let attempt = 0;

  const send = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenRetryKeys.push(new Headers(init?.headers).get('X-Line-Retry-Key') || '');
    attempt += 1;
    return attempt === 1
      ? new Response('', { status: 503, headers: { 'x-line-request-id': 'req-failed' } })
      : new Response('', { status: 200, headers: { 'x-line-request-id': 'req-ok' } });
  }) as typeof fetch;

  const failed = await deliver(sampleJob, 'test-channel-access-token', send);
  const retried = await deliver(sampleJob, 'test-channel-access-token', send);

  assert(failed.accepted === false && failed.retryable === true && failed.status === 503,
    'transient failure must be eligible for retry');
  assert(retried.accepted === true && retried.retryable === false && retried.status === 200,
    'retry must be accepted when LINE recovers');
  assert(retried.lineRequestId === 'req-ok', 'successful retry must retain the final LINE request id');
  assert(seenRetryKeys.length === 2 && seenRetryKeys[0] === sampleJob.id && seenRetryKeys[1] === sampleJob.id,
    'failure and retry must use the identical LINE retry key');
});

Deno.test('LINE duplicate retry acknowledgement 409 is treated as accepted only with accepted request id', async () => {
  const accepted409 = (async () =>
    new Response('', {
      status: 409,
      headers: { 'x-line-accepted-request-id': 'accepted-original' },
    })) as typeof fetch;
  const plain409 = (async () =>
    new Response('', {
      status: 409,
      headers: { 'x-line-request-id': 'duplicate-without-acceptance' },
    })) as typeof fetch;

  const deduplicated = await deliver(sampleJob, 'test-channel-access-token', accepted409);
  const rejectedDuplicate = await deliver(sampleJob, 'test-channel-access-token', plain409);

  assert(deduplicated.accepted === true && deduplicated.retryable === false && deduplicated.status === 409,
    'LINE 409 with accepted-request-id must count as the original push having been accepted');
  assert(deduplicated.lineRequestId === 'accepted-original',
    'deduplicated retry must keep the accepted request id for audit');
  assert(rejectedDuplicate.accepted === false && rejectedDuplicate.retryable === false && rejectedDuplicate.status === 409,
    'plain 409 without accepted-request-id must not be reported as delivered');
});

Deno.test('transport exception stays retryable and never exposes the channel access token', async () => {
  const send = (async () => {
    throw new Error('simulated network failure');
  }) as typeof fetch;

  const result = await deliver(sampleJob, 'test-channel-access-token', send);

  assert(result.accepted === false && result.retryable === true && result.status === null,
    'network failure must be retryable without a fake HTTP status');
  assert(result.lineRequestId === '', 'network failure must not fabricate a LINE request id');
});
