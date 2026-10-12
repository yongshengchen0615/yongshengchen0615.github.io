-- Receipt metadata and cleanup work are accessed only through authenticated
-- Edge Functions using service_role. Default table grants included TRUNCATE,
-- which is not governed by RLS. Remove all unnecessary public-role access.
revoke all privileges on table public.booking_receipts,
  public.booking_receipt_cleanup_queue from public, anon, authenticated;
