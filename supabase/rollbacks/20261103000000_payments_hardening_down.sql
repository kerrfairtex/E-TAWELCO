-- Rollback for 20261103000000_payments_hardening.sql.
-- Run manually only after reviewing the effects on staging.

BEGIN;

-- Restore the requested authenticated read grants. Existing RLS policies are untouched.
GRANT SELECT ON TABLE public.payments, public.payment_attempts, public.refunds TO authenticated;

DROP TRIGGER IF EXISTS audit_log_append_only_guard ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_reject_mutation();

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_attempt_id_fkey;

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS attempt_id,
  DROP COLUMN IF EXISTS livemode;

ALTER TABLE public.payment_events
  DROP COLUMN IF EXISTS result;

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_amount_matches_centavos_chk;

-- Restore the original function body/signature from
-- supabase/migrations/20261102000000_apply_checkout_paid.sql.
CREATE OR REPLACE FUNCTION public.apply_checkout_paid(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_payload jsonb,
  p_checkout_session_id text,
  p_payment_id text,
  p_amount_centavos bigint,
  p_method text,
  p_paid_at timestamptz,
  p_channel text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.payment_events%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_bill public.bills%rowtype;
  v_result text;
BEGIN
  INSERT INTO public.payment_events (provider_event_id, type, raw_payload, livemode)
  VALUES (p_event_id, p_event_type, p_payload, COALESCE(p_livemode, false))
  ON CONFLICT (provider_event_id) DO NOTHING;

  SELECT * INTO v_event
  FROM public.payment_events
  WHERE provider_event_id = p_event_id
  FOR UPDATE;

  IF v_event.processed_at IS NOT NULL THEN
    RETURN 'duplicate';
  END IF;

  SELECT * INTO v_attempt
  FROM public.payment_attempts
  WHERE provider_checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unknown_session';
  END IF;

  SELECT * INTO v_bill
  FROM public.bills
  WHERE id = v_attempt.bill_id
  FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.payments WHERE paymongo_reference = p_payment_id) THEN
    v_result := 'duplicate';
  ELSIF v_bill.status = 'paid'
     OR EXISTS (SELECT 1 FROM public.payments WHERE bill_id = v_bill.id AND status = 'paid') THEN
    v_result := 'second_payment_for_bill';
  ELSIF v_bill.status NOT IN ('unpaid', 'overdue', 'pending', 'failed', 'expired') THEN
    v_result := 'bill_not_payable';
  ELSIF p_amount_centavos <> v_attempt.amount_centavos
     OR p_amount_centavos <> v_bill.amount_centavos THEN
    v_result := 'amount_mismatch';
  ELSE
    INSERT INTO public.payments
      (bill_id, paymongo_reference, amount, method, status, paid_at, account_id, currency, raw_event_id)
    VALUES
      (v_bill.id, p_payment_id, (p_amount_centavos / 100.0)::numeric(12,2),
       COALESCE(p_method, 'unknown'), 'paid', COALESCE(p_paid_at, now()),
       v_attempt.user_id, 'PHP', p_event_id);

    UPDATE public.payment_attempts
       SET status = 'paid', updated_at = now()
     WHERE id = v_attempt.id;

    UPDATE public.payment_attempts
       SET status = 'cancelled', updated_at = now()
     WHERE bill_id = v_bill.id AND status = 'pending' AND id <> v_attempt.id;

    UPDATE public.bills
       SET status = 'paid',
           paid_at = COALESCE(p_paid_at, now()),
           paid_channel = p_channel,
           payment_ref = p_payment_id,
           updated_at = now()
     WHERE id = v_bill.id;

    v_result := 'paid';
  END IF;

  UPDATE public.payment_events SET processed_at = now() WHERE id = v_event.id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_checkout_paid(text, text, boolean, jsonb, text, text, bigint, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_paid(text, text, boolean, jsonb, text, text, bigint, text, timestamptz, text)
  TO service_role;

COMMIT;
