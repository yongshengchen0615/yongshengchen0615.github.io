export type Job = { id: string; recipient: string; message_text: string; channel: string; attempt_count: number };
export type Delivery = { accepted: boolean; retryable: boolean; status: number | null; lineRequestId: string };

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
    const response = await send('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Line-Retry-Key': job.id },
      body: JSON.stringify({ to: job.recipient, messages: [{ type: 'text', text: job.message_text }] }),
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
