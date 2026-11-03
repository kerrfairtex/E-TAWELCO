-- Run against a disposable staging database as the migration owner.
-- All fixtures are transaction-scoped and rolled back at the end.
BEGIN;

DO $$
DECLARE
  v_member_a uuid := gen_random_uuid();
  v_member_b uuid := gen_random_uuid();
  v_area_id text;
  v_bill_paid bigint;
  v_bill_mismatch bigint;
  v_attempt_paid bigint;
  v_attempt_second bigint;
  v_attempt_mismatch bigint;
  v_result text;
  v_event_result text;
  v_paid_event_result text;
  v_paid_event_processed_at timestamptz;
  v_payment_count bigint;
  v_payment_b_id bigint;
  v_evt_paid text := 'evt-paid-' || gen_random_uuid()::text;
  v_evt_mismatch text := 'evt-mismatch-' || gen_random_uuid()::text;
  v_evt_unknown text := 'evt-unknown-' || gen_random_uuid()::text;
  v_payment_paid text := 'pay-paid-' || gen_random_uuid()::text;
  v_payment_mismatch text := 'pay-mismatch-' || gen_random_uuid()::text;
  v_account_a text := lpad((10000000000 + floor(random() * 8000000000)::bigint)::text, 11, '0');
  v_account_b text := lpad((10000000000 + floor(random() * 8000000000)::bigint)::text, 11, '0');
BEGIN
  SELECT id INTO v_area_id FROM public.service_areas ORDER BY id LIMIT 1;
  IF v_area_id IS NULL THEN
    RAISE EXCEPTION 'payments_hardening test requires at least one service_areas row';
  END IF;

  -- auth.users must exist because profiles.id references auth.users(id).
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, created_at, updated_at
  ) VALUES
    (v_member_a, 'authenticated', 'authenticated', v_member_a::text || '@payments-test.invalid', now(), now(), now()),
    (v_member_b, 'authenticated', 'authenticated', v_member_b::text || '@payments-test.invalid', now(), now(), now());

  -- A signup trigger may already have created profiles for these users.
  INSERT INTO public.profiles (id, full_name, email, account_no)
  VALUES
    (v_member_a, 'Payment test member A', v_member_a::text || '@payments-test.invalid', v_account_a),
    (v_member_b, 'Payment test member B', v_member_b::text || '@payments-test.invalid', v_account_b)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        account_no = EXCLUDED.account_no;

  INSERT INTO public.bills (account_no, account_name, period, kwh, amount, amount_centavos, due_date, status, area_id)
  VALUES (v_account_b, 'Payment test member B', to_char(current_date, 'YYYY-MM'), 10, 100.00, 10000, current_date + 7, 'unpaid', v_area_id)
  RETURNING id INTO v_bill_paid;

  INSERT INTO public.payment_attempts (bill_id, user_id, amount_centavos, currency, status, idempotency_key, provider_checkout_session_id, expires_at)
  VALUES (v_bill_paid, v_member_b, 10000, 'PHP', 'pending', 'test-paid-' || gen_random_uuid()::text, 'sess-paid-' || gen_random_uuid()::text, now() + interval '30 minutes')
  RETURNING id INTO v_attempt_paid;

  -- Paid outcome, followed by replay of the exact same event.
  SELECT public.apply_checkout_paid(
    v_evt_paid,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_paid),
    v_payment_paid, 10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'paid' THEN RAISE EXCEPTION 'paid flow expected paid, got %', v_result; END IF;

  SELECT result, processed_at INTO v_paid_event_result, v_paid_event_processed_at
  FROM public.payment_events
  WHERE provider_event_id = v_evt_paid;
  IF v_paid_event_result IS DISTINCT FROM 'paid' OR v_paid_event_processed_at IS NULL THEN
    RAISE EXCEPTION 'paid event result/processed_at incorrect: %, %', v_paid_event_result, v_paid_event_processed_at;
  END IF;

  SELECT id INTO v_payment_b_id
  FROM public.payments
  WHERE paymongo_reference = v_payment_paid;
  IF v_payment_b_id IS NULL THEN RAISE EXCEPTION 'paid fixture payment was not created'; END IF;

  SELECT public.apply_checkout_paid(
    v_evt_paid,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_paid),
    v_payment_paid, 10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'duplicate' THEN RAISE EXCEPTION 'replay expected duplicate, got %', v_result; END IF;
  SELECT result INTO v_event_result
  FROM public.payment_events
  WHERE provider_event_id = v_evt_paid;
  IF v_event_result IS DISTINCT FROM v_paid_event_result THEN
    RAISE EXCEPTION 'replay changed first event result from % to %', v_paid_event_result, v_event_result;
  END IF;

  -- A distinct checkout attempt against the already-paid bill must be rejected.
  INSERT INTO public.payment_attempts (bill_id, user_id, amount_centavos, currency, status, idempotency_key, provider_checkout_session_id, expires_at)
  VALUES (v_bill_paid, v_member_b, 10000, 'PHP', 'pending', 'test-second-' || gen_random_uuid()::text, 'sess-second-' || gen_random_uuid()::text, now() + interval '30 minutes')
  RETURNING id INTO v_attempt_second;
  SELECT public.apply_checkout_paid(
    'evt-second-' || gen_random_uuid()::text,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_second),
    'pay-second-' || gen_random_uuid()::text, 10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'second_payment_for_bill' THEN RAISE EXCEPTION 'second payment expected rejection, got %', v_result; END IF;

  -- Amount mismatch is recorded but never creates a payment or changes the bill status.
  INSERT INTO public.bills (account_no, account_name, period, kwh, amount, amount_centavos, due_date, status, area_id)
  VALUES (v_account_a, 'Payment test member A', to_char(current_date, 'YYYY-MM'), 10, 100.00, 10000, current_date + 7, 'unpaid', v_area_id)
  RETURNING id INTO v_bill_mismatch;
  INSERT INTO public.payment_attempts (bill_id, user_id, amount_centavos, currency, status, idempotency_key, provider_checkout_session_id, expires_at)
  VALUES (v_bill_mismatch, v_member_a, 10000, 'PHP', 'pending', 'test-mismatch-' || gen_random_uuid()::text, 'sess-mismatch-' || gen_random_uuid()::text, now() + interval '30 minutes')
  RETURNING id INTO v_attempt_mismatch;
  SELECT public.apply_checkout_paid(
    v_evt_mismatch,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_mismatch),
    v_payment_mismatch, 9999, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'amount_mismatch' THEN RAISE EXCEPTION 'amount mismatch expected amount_mismatch, got %', v_result; END IF;

  SELECT count(*) INTO v_payment_count
  FROM public.payments
  WHERE bill_id = v_bill_mismatch;
  IF v_payment_count <> 0 THEN RAISE EXCEPTION 'amount mismatch unexpectedly created a payment for bill %', v_bill_mismatch; END IF;
  IF (SELECT status FROM public.bills WHERE id = v_bill_mismatch) IS DISTINCT FROM 'unpaid' THEN
    RAISE EXCEPTION 'amount mismatch changed bill % from unpaid', v_bill_mismatch;
  END IF;

  SELECT result INTO v_event_result
  FROM public.payment_events
  WHERE provider_event_id = v_evt_mismatch;
  IF v_event_result IS DISTINCT FROM 'amount_mismatch' THEN
    RAISE EXCEPTION 'amount mismatch event result was not recorded: %', v_event_result;
  END IF;

  -- Unknown checkout session is recorded and remains unprocessed for provider retry.
  SELECT public.apply_checkout_paid(
    v_evt_unknown,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    'sess-unknown-' || gen_random_uuid()::text,
    'pay-unknown-' || gen_random_uuid()::text, 10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'unknown_session' THEN RAISE EXCEPTION 'unknown session expected unknown_session, got %', v_result; END IF;
  SELECT result, processed_at INTO v_event_result, v_paid_event_processed_at
  FROM public.payment_events
  WHERE provider_event_id = v_evt_unknown;
  IF v_event_result IS DISTINCT FROM 'unknown_session' OR v_paid_event_processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'unknown session outcome must be recorded but remain unprocessed';
  END IF;

  -- A new row violating the NOT VALID check must still be rejected. Use a real service area id.
  BEGIN
    INSERT INTO public.bills (account_no, account_name, period, kwh, amount, amount_centavos, due_date, status, area_id)
    VALUES ('99900000001', 'Check constraint test', '2098-01', 1, 123.45, 12344, current_date + 7, 'unpaid', v_area_id);
    RAISE EXCEPTION 'mismatched bill amount unexpectedly passed the CHECK';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Audit trail: exactly one paid event for the paid bill and one mismatch exception for its bill.
  SELECT count(*) INTO v_payment_count
  FROM public.audit_log
  WHERE action = 'payment.paid' AND entity = 'bills' AND entity_id = v_bill_paid::text;
  IF v_payment_count <> 1 THEN RAISE EXCEPTION 'expected one payment.paid audit row, got %', v_payment_count; END IF;

  SELECT count(*) INTO v_payment_count
  FROM public.audit_log
  WHERE action = 'payment.exception'
    AND entity = 'bills'
    AND entity_id = v_bill_mismatch::text
    AND details ->> 'result' = 'amount_mismatch';
  IF v_payment_count <> 1 THEN RAISE EXCEPTION 'expected one amount_mismatch payment.exception audit row, got %', v_payment_count; END IF;

  -- Save fixture identifiers for RLS checks in the outer transaction.
  PERFORM set_config('payments_hardening.member_a', v_member_a::text, true);
  PERFORM set_config('payments_hardening.member_b', v_member_b::text, true);
  PERFORM set_config('payments_hardening.member_b_payment', v_payment_b_id::text, true);
END;
$$;

-- Verify table access and RLS visibility as authenticated member B (positive control).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'sub', current_setting('payments_hardening.member_b', true)
)::text, true);
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.payments
  WHERE id = current_setting('payments_hardening.member_b_payment', true)::bigint;
  IF v_count <> 1 THEN RAISE EXCEPTION 'member B should see own payment; got %', v_count; END IF;
END;
$$;

-- Member A must not see member B's payment.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'sub', current_setting('payments_hardening.member_a', true)
)::text, true);
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.payments
  WHERE id = current_setting('payments_hardening.member_b_payment', true)::bigint;
  IF v_count <> 0 THEN RAISE EXCEPTION 'member A can see member B payment'; END IF;

  BEGIN
    EXECUTE 'TRUNCATE TABLE public.payments';
    RAISE EXCEPTION 'authenticated unexpectedly truncated payments';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- Audit log UPDATE and DELETE must be rejected for the authenticated role.
DO $$
BEGIN
  BEGIN
    UPDATE public.audit_log SET action = action WHERE action = 'payment.paid';
    RAISE EXCEPTION 'UPDATE on audit_log unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'UPDATE on audit_log unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.audit_log WHERE action = 'payment.paid';
    RAISE EXCEPTION 'DELETE on audit_log unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'DELETE on audit_log unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
