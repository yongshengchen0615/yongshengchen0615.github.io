import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { deliver, secureEqual } from './delivery.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const suppliedSecret = request.headers.get('x-dispatch-secret') || '';
  if (!suppliedSecret || suppliedSecret.length > 200) return json({ ok: false }, 401);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const config = await db.rpc('booking_notification_config');
    if (config.error) return json({ ok: false }, 503);
    const expectedSecret = config.data?.BOOKING_NOTIFICATION_DISPATCH_SECRET || '';
    if (!expectedSecret || !secureEqual(expectedSecret, suppliedSecret)) return json({ ok: false }, 401);
    // Never accept caller-provided recipient, message, channel or token.
    const claim = await db.rpc('claim_booking_notifications', { p_limit: 20 });
    if (claim.error) return json({ ok: false }, 503);
    const jobs = claim.data || [];
    let accepted = 0;
    let failed = 0;
    // Bounded parallel work finishes comfortably inside the two-minute claim lease.
    for (let offset = 0; offset < jobs.length; offset += 5) {
      await Promise.all(jobs.slice(offset, offset + 5).map(async (job: any) => {
        const token = job.channel === 'admin' ? config.data.LINE_BOOKING_ADMIN_CHANNEL_ACCESS_TOKEN : config.data.LINE_BOOKING_MEMBER_CHANNEL_ACCESS_TOKEN;
        const result = await deliver(job, token || '');
        const finish = await db.rpc('finish_booking_notification', {
          p_id: job.id, p_attempt: job.attempt_count, p_accepted: result.accepted,
          p_retryable: result.retryable, p_status: result.status, p_line_request_id: result.lineRequestId,
        });
        if (result.accepted && !finish.error && finish.data) accepted++;
        else failed++;
        // Failed finalization leaves a leased row for safe retry with the same LINE UUID.
      }));
    }
    return json({ ok: true, claimed: jobs.length, accepted, failed });
  } catch {
    return json({ ok: false }, 503);
  }
});
