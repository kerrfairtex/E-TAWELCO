-- Targeted payment hardening. Not applied by this change.
-- profiles: authenticated holds SELECT only (verified live); writes go through the service-role API.

BEGIN;

-- Restrict direct access to payment records. Existing RLS policies are left unchanged.
REVOKE ALL ON TABLE public.payments, public.payment_attempts, public.payment_events, public.refunds FROM anon, authenticated;
GRANT SELECT ON TABLE public.payments, public.payment_attempts, public.refunds TO authenticated;
-- No grants on payment_events.

-- Prevent concurrent checkout attempts for the same bill while allowing retries after failure.
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_pending_per_bill_idx
  ON public.payment_attempts (bill_id)
  WHERE status = 'pending';

-- Add without validating existing data. The separate validation step is documented below.
ALTER TABLE public.bills
  ADD CONSTRAINT bills_amount_matches_centavos_chk
  CHECK (round(amount * 100) = amount_centavos) NOT VALID;

-- Before validating the constraint, inspect all existing violations:
-- SELECT id, account_no, period, amount, amount_centavos
-- FROM public.bills
-- WHERE round(amount * 100) IS DISTINCT FROM amount_centavos;
-- Once the query returns zero rows, run separately:
-- ALTER TABLE public.bills VALIDATE CONSTRAINT bills_amount_matches_centavos_chk;

ALTER TABLE public.payment_events
  ADD COLUMN result text;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS raw_event_id text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PHP',
  ADD COLUMN IF NOT EXISTS livemode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt_id bigint;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_attempt_id_fkey
  FOREIGN KEY (attempt_id)
  REFERENCES public.payment_attempts(id)
  ON DELETE RESTRICT;

-- Append-only audit log: reject row mutations and TRUNCATE.
CREATE OR REPLACE FUNCTION public.audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'public.audit_log is append-only (% is not allowed)', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_append_only_guard
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION public.audit_log_reject_mutation();

-- Preserve the existing RPC signature and return type.
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
  v_payment_id bigint;
  v_result text;
BEGIN
  INSERT INTO public.payment_events (provider_event_id, type, raw_payload, livemode, result)
  VALUES (p_event_id, p_event_type, p_payload, COALESCE(p_livemode, false), 'received')
  ON CONFLICT (provider_event_id) DO NOTHING;

  SELECT * INTO v_event
  FROM public.payment_events
  WHERE provider_event_id = p_event_id
  FOR UPDATE;

  -- A processed event is a no-op: preserve its original recorded result.
  IF v_event.processed_at IS NOT NULL THEN
    RETURN 'duplicate';
  END IF;

  SELECT * INTO v_attempt
  FROM public.payment_attempts
  WHERE provider_checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.payment_events
       SET result = 'unknown_session', processed_at = NULL
     WHERE id = v_event.id;
    RETURN 'unknown_session';
  END IF;

  SELECT * INTO v_bill
  FROM public.bills
  WHERE id = v_attempt.bill_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.payments WHERE provider_payment_id = p_payment_id
  ) THEN
    v_result := 'duplicate';
  ELSIF v_bill.status = 'paid'
     OR EXISTS (
       SELECT 1 FROM public.payments
       WHERE bill_id = v_bill.id AND status = 'paid'
     ) THEN
    v_result := 'second_payment_for_bill';
  ELSIF v_bill.status NOT IN ('unpaid', 'overdue', 'pending', 'failed', 'expired') THEN
    v_result := 'bill_not_payable';
  ELSIF p_amount_centavos <> v_attempt.amount_centavos
     OR p_amount_centavos <> v_bill.amount_centavos THEN
    v_result := 'amount_mismatch';
  ELSE
    INSERT INTO public.payments (
      bill_id,
      provider_payment_id,
      amount_centavos,
      method,
      status,
      paid_at,
      account_id,
      currency,
      raw_event_id,
      livemode,
      attempt_id
    )
    VALUES (
      v_bill.id,
      p_payment_id,
        p_amount_centavos,

      COALESCE(p_method, 'unknown'),
      'paid',
      COALESCE(p_paid_at, now()),
      v_attempt.user_id,
      'PHP',
      p_event_id,
      COALESCE(p_livemode, false),
      v_attempt.id
    )
    RETURNING id INTO v_payment_id;

    UPDATE public.payment_attempts
       SET status = 'paid', updated_at = now()
     WHERE id = v_attempt.id;

    UPDATE public.payment_attempts
       SET status = 'cancelled', updated_at = now()
     WHERE bill_id = v_bill.id
       AND status = 'pending'
       AND id <> v_attempt.id;

    UPDATE public.bills
       SET status = 'paid',
           paid_at = COALESCE(p_paid_at, now()),
           paid_channel = p_channel,
           payment_ref = p_payment_id,
           updated_at = now()
     WHERE id = v_bill.id;

    INSERT INTO public.audit_log (
      actor_id, actor_email, action, entity, entity_id, details
    ) VALUES (
      v_attempt.user_id,
      NULL,
      'payment.paid',
      'bills',
      v_bill.id::text,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'amount_centavos', p_amount_centavos,
        'attempt_id', v_attempt.id,
        'source', 'paymongo_webhook'
      )
    );

    v_result := 'paid';
  END IF;

  UPDATE public.payment_events
     SET result = v_result,
         processed_at = now()
   WHERE id = v_event.id;

  IF v_result IN ('amount_mismatch', 'second_payment_for_bill', 'bill_not_payable') THEN
    INSERT INTO public.audit_log (
      actor_id, actor_email, action, entity, entity_id, details
    ) VALUES (
      v_attempt.user_id,
      NULL,
      'payment.exception',
      'bills',
      v_bill.id::text,
      jsonb_build_object(
        'result', v_result,
        'payment_id', p_payment_id,
        'amount_centavos', p_amount_centavos,
        'attempt_id', v_attempt.id,
        'source', 'paymongo_webhook'
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_checkout_paid(text, text, boolean, jsonb, text, text, bigint, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_paid(text, text, boolean, jsonb, text, text, bigint, text, timestamptz, text)
  TO service_role;

COMMIT;
