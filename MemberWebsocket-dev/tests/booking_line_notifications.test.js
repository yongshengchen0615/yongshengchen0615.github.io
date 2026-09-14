const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deliver, secureEqual } = require('../supabase/functions/booking-line-notifications/delivery.ts');
const job = { id: 'f01c4b00-e8d4-4a46-8512-59907f42d3a2', recipient: 'U'+'1'.repeat(32), message_text: '預約已確認', channel: 'member', attempt_count: 1 };

test('push uses stored recipient, snapshot and stable retry UUID on every attempt', async () => {
  const calls = [];
  const send = async (url, options) => { calls.push({url, ...options}); return new Response('{}', {status: 200}); };
  await deliver(job, 'member-test-token', send);
  await deliver({...job, attempt_count: 2}, 'member-test-token', send);
  assert.equal(calls[0].url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(calls[0].headers.Authorization, 'Bearer member-test-token');
  assert.equal(calls[0].headers['X-Line-Retry-Key'], job.id);
  assert.equal(calls[1].headers['X-Line-Retry-Key'], job.id);
  assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(JSON.parse(calls[0].body), {to: job.recipient, messages: [{type:'text', text:job.message_text}]});
});
test('LINE statuses distinguish accepted retries, transient failures and permanent failures', async () => {
  for (const [status, headers, accepted, retryable] of [
    [200, {}, true, false], [409, {'x-line-accepted-request-id':'original'}, true, false],
    [409, {}, false, false], [400, {}, false, false], [401, {}, false, false],
    [429, {}, false, true], [500, {}, false, true], [503, {}, false, true],
  ]) {
    const result = await deliver(job, 'test', async () => new Response('{}', {status,headers}));
    assert.equal(result.accepted, accepted, String(status));
    assert.equal(result.retryable, retryable, String(status));
  }
});
test('network and missing-token errors remain retryable and do not expose secrets', async () => {
  const result = await deliver(job, 'secret', async () => {throw new Error('secret');});
  assert.deepEqual(result, {accepted:false,retryable:true,status:null,lineRequestId:''});
  await deliver(job, '', async () => {assert.fail('No network request without token');});
});
test('dispatch secret comparison rejects incorrect and different-length secrets', () => {
  assert.equal(secureEqual('abc', 'abc'), true);
  for (const candidate of ['', 'ab', 'abcd', 'abd']) assert.equal(secureEqual('abc', candidate), false);
});
