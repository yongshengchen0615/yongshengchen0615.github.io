import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { buildBookingFlexMessage, deliver, secureEqual } from './delivery.ts';
import {
  isUsableEventClaim,
  isUsablePointCard,
  loadBookingConfirmationBenefits,
  taipeiDate,
} from './benefits.ts';

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

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    if (body && typeof body === 'object' && !Array.isArray(body) && body.action === 'preview-confirmation') {
      const requestedBookingId = String(body.bookingId || '').trim();
      if (requestedBookingId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBookingId)) {
        return json({ ok: false, error: { code: 'INVALID_BOOKING_ID' } }, 400);
      }

      const preview = await db.rpc('booking_notification_confirmation_preview_job', {
        p_booking_id: requestedBookingId || null,
      });
      if (preview.error) return json({ ok: false }, 503);
      const job = preview.data;
      if (!job?.id || !job?.booking_id) {
        return json({ ok: false, error: { code: 'PREVIEW_JOB_NOT_FOUND' } }, 404);
      }

      const benefits = await loadBookingConfirmationBenefits(db, job);
      const flex = buildBookingFlexMessage({ ...job, benefits });
      const bodyContents = Array.isArray((flex.contents?.body as any)?.contents)
        ? (flex.contents.body as any).contents
        : [];

      return json({
        ok: true,
        data: {
          productionMember: true,
          flexType: flex.type,
          altTextPresent: Boolean(flex.altText),
          entitlementSectionCount: Math.max(0, bodyContents.length - 3),
          pointTicketCount: benefits.pointTickets.length,
          eventTicketCount: benefits.eventTickets.length,
          tierActivityCount: benefits.tierActivities.length,
          tierLabel: benefits.tierLabel,
          emptyCategories: [
            benefits.pointTickets.length === 0 ? 'pointTickets' : '',
            benefits.eventTickets.length === 0 ? 'eventTickets' : '',
            benefits.tierActivities.length === 0 ? 'tierActivities' : '',
          ].filter(Boolean),
        },
      });
    }

    if (body && typeof body === 'object' && !Array.isArray(body) && body.action === 'self-test-confirmation') {
      const preview = await db.rpc('booking_notification_confirmation_preview_job', { p_booking_id: null });
      if (preview.error) return json({ ok: false }, 503);
      const job = preview.data;
      if (!job?.id || !job?.booking_id) {
        return json({ ok: false, error: { code: 'PREVIEW_JOB_NOT_FOUND' } }, 404);
      }

      const benefits = await loadBookingConfirmationBenefits(db, job);
      const realFlex = buildBookingFlexMessage({ ...job, benefits });
      const emptyFlex = buildBookingFlexMessage({
        ...job,
        benefits: { pointTickets: [], eventTickets: [], tierActivities: [], tierLabel: benefits.tierLabel },
      });
      const emptySerialized = JSON.stringify(emptyFlex);
      const emptyStateMatches = emptySerialized.match(/目前無可用項目/g)?.length || 0;
      const today = taipeiDate();
      const expiredPointExcluded = !isUsablePointCard(
        { status: 'active', expiry_mode: 'date', expires_on: '2000-01-01' },
        today,
      );
      const expiredEventExcluded = !isUsableEventClaim(
        {
          status: 'claimed',
          event_tickets: {
            status: 'active',
            deleted_at: null,
            starts_on: '1999-01-01',
            ends_on: '2000-01-01',
            allowed_tier_keys: ['general', 'silver', 'gold', 'platinum'],
          },
        },
        'silver',
        today,
      );

      const retryKeys: string[] = [];
      let sendAttempt = 0;
      const fakeSend = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        retryKeys.push(new Headers(init?.headers).get('X-Line-Retry-Key') || '');
        sendAttempt += 1;
        return sendAttempt === 1
          ? new Response('', { status: 500, headers: { 'x-line-request-id': 'self-test-failed' } })
          : new Response('', { status: 200, headers: { 'x-line-request-id': 'self-test-ok' } });
      }) as typeof fetch;

      const failed = await deliver({ ...job, benefits }, 'self-test-token', fakeSend);
      const retried = await deliver({ ...job, benefits }, 'self-test-token', fakeSend);
      const retryKeyStable = retryKeys.length === 2
        && retryKeys[0] === job.id
        && retryKeys[1] === job.id;

      return json({
        ok: true,
        data: {
          productionMember: true,
          productionPreview: {
            flexType: realFlex.type,
            altTextPresent: Boolean(realFlex.altText),
            pointTicketCount: benefits.pointTickets.length,
            eventTicketCount: benefits.eventTickets.length,
            tierActivityCount: benefits.tierActivities.length,
            tierLabel: benefits.tierLabel,
          },
          emptyEntitlements: {
            emptyStateSections: emptyStateMatches,
            passed: emptyStateMatches === 3,
          },
          expiredExclusion: {
            pointTicketPassed: expiredPointExcluded,
            eventTicketPassed: expiredEventExcluded,
            passed: expiredPointExcluded && expiredEventExcluded,
          },
          retrySemantics: {
            firstRetryable: failed.accepted === false && failed.retryable === true && failed.status === 500,
            retryAccepted: retried.accepted === true && retried.status === 200,
            retryKeyStable,
            passed:
              failed.accepted === false
              && failed.retryable === true
              && failed.status === 500
              && retried.accepted === true
              && retried.status === 200
              && retryKeyStable,
          },
        },
      });
    }

    // Never accept caller-provided recipient, message, channel or token for actual delivery.
    const claim = await db.rpc('claim_booking_notifications', { p_limit: 20 });
    if (claim.error) return json({ ok: false }, 503);
    const jobs = claim.data || [];
    let accepted = 0;
    let failed = 0;
    let skipped = 0;
    // Bounded parallel work finishes comfortably inside the two-minute claim lease.
    for (let offset = 0; offset < jobs.length; offset += 5) {
      await Promise.all(jobs.slice(offset, offset + 5).map(async (job: any) => {
        // Defense in depth: never allow a claimed legacy/manual outbox row to send LINE for a test member.
        const testGuard = await db.rpc('skip_booking_notification_for_test_member', {
          p_id: job.id,
          p_attempt: job.attempt_count,
        });
        if (testGuard.error) {
          failed++;
          return;
        }
        if (testGuard.data === true) {
          skipped++;
          return;
        }

        // Recheck current booking state and the actual start immediately before LINE delivery.
        const reminderGuard = await db.rpc('skip_invalid_booking_reminder', {
          p_id: job.id,
          p_attempt: job.attempt_count,
        });
        if (reminderGuard.error) {
          failed++;
          return;
        }
        if (reminderGuard.data === true) {
          skipped++;
          return;
        }

        const token = job.channel === 'admin' ? config.data.LINE_BOOKING_ADMIN_CHANNEL_ACCESS_TOKEN : config.data.LINE_BOOKING_MEMBER_CHANNEL_ACCESS_TOKEN;
        let deliveryJob = job;
        if (job.channel === 'member' && String(job.event_key || '').includes(':completed:') && job.booking_id) {
          const settlement = await db.from('booking_completion_settlements')
            .select('service_minutes,reward_details')
            .eq('booking_id', job.booking_id)
            .maybeSingle();
          if (!settlement.error && settlement.data) {
            const rewards = Array.isArray(settlement.data.reward_details) ? settlement.data.reward_details : [];
            const rewardText = rewards
              .map((item: any) => {
                const title = String(item?.pointCardTitle || '').trim();
                const points = Math.max(0, Number(item?.points || 0));
                return title && points > 0 ? `${title} +${points} 點` : '';
              })
              .filter(Boolean)
              .join('、');
            const suffix = [
              `完成服務時間：${Math.max(0, Number(settlement.data.service_minutes || 0))} 分鐘`,
              `獲得集點：${rewardText || '本次無符合自動集點規則'}`,
            ].join('\n');
            const base = String(job.message_text || '');
            const maxBaseLength = Math.max(0, 2200 - suffix.length - 1);
            deliveryJob = { ...job, message_text: `${base.slice(0, maxBaseLength)}\n${suffix}` };
          }
        }
        if (job.channel === 'member' && String(job.event_key || '').includes(':confirmed:') && job.booking_id) {
          try {
            const benefits = await loadBookingConfirmationBenefits(db, job);
            deliveryJob = { ...deliveryJob, benefits };
          } catch {
            // Booking is already committed. Keep the leased notification retryable instead of
            // sending a confirmation whose entitlement sections may be stale or incomplete.
            failed++;
            return;
          }
        }

        const result = await deliver(deliveryJob, token || '');
        const finish = await db.rpc('finish_booking_notification', {
          p_id: job.id, p_attempt: job.attempt_count, p_accepted: result.accepted,
          p_retryable: result.retryable, p_status: result.status, p_line_request_id: result.lineRequestId,
        });
        if (result.accepted && !finish.error && finish.data) accepted++;
        else failed++;
        // Failed finalization leaves a leased row for safe retry with the same LINE UUID.
      }));
    }
    return json({ ok: true, claimed: jobs.length, accepted, failed, skipped });
  } catch {
    return json({ ok: false }, 503);
  }
});
