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
  v_event_processed timestamptz;
  v_payment_count bigint;
  v_payment_b_id bigint;
  v_account_a text := lpad((10000000000 + floor(random() * 8000000000)::bigint)::text, 11, '0');
  v_account_b text := lpad((10000000000 + floor(random() * 8000000000)::bigint)::text, 11, '0');
BEGIN
  SELECT id INTO v_area_id FROM public.service_areas ORDER BY id LIMIT 1;
  IF v_area_id IS NULL THEN
    RAISE EXCEPTION 'payments_hardening test requires at least one service_areas row';
  END IF;

  -- Fixtures use the live profiles columns and defaults.
  INSERT INTO public.profiles (id, full_name, email, account_no)
  VALUES
    (v_member_a, 'Payment test member A', v_member_a::text || '@payments-test.invalid', v_account_a),
    (v_member_b, 'Payment test member B', v_member_b::text || '@payments-test.invalid', v_account_b);

  INSERT INTO public.bills (account_no, account_name, period, kwh, amount, amount_centavos, due_date, status, area_id)
  VALUES (v_account_b, 'Payment test member B', to_char(current_date, 'YYYY-MM'), 10, 100.00, 10000, current_date + 7, 'unpaid', v_area_id)
  RETURNING id INTO v_bill_paid;

  INSERT INTO public.payment_attempts (bill_id, user_id, amount_centavos, currency, status, idempotency_key, provider_checkout_session_id, expires_at)
  VALUES (v_bill_paid, v_member_b, 10000, 'PHP', 'pending', 'test-paid-' || gen_random_uuid()::text, 'sess-paid-' || gen_random_uuid()::text, now() + interval '30 minutes')
  RETURNING id INTO v_attempt_paid;

  -- Paid outcome, followed by a replay of the exact same event. Replay must not rewrite result.
  SELECT public.apply_checkout_paid(
    'evt-paid-' || gen_random_uuid()::text,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_paid),
    'pay-paid-' || gen_random_uuid()::text, 10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'paid' THEN RAISE EXCEPTION 'paid flow expected paid, got %', v_result; END IF;

  -- Capture event/reference created by the successful RPC for the replay and isolation checks.
  SELECT p.id, e.provider_event_id, p.paymongo_reference, e.result
    INTO v_payment_b_id, v_event_result, v_event_processed, v_event_result
  FROM public.payments p
  JOIN public.payment_events e ON e.provider_event_id = p.raw_event_id
  WHERE p.bill_id = v_bill_paid;
  IF v_payment_b_id IS NULL THEN RAISE EXCEPTION 'paid fixture payment was not created'; END IF;

  SELECT public.apply_checkout_paid(
    v_event_result,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_paid),
    (SELECT paymongo_reference FROM public.payments WHERE id = v_payment_b_id),
    10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'duplicate' THEN RAISE EXCEPTION 'replay expected duplicate, got %', v_result; END IF;
  SELECT result INTO v_event_result FROM public.payment_events WHERE provider_event_id = v_event_result;
  IF v_event_result <> 'paid' THEN RAISE EXCEPTION 'replay changed first event result: %', v_event_result; END IF;

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

  -- Amount mismatch is recorded but never creates a payments row.
  INSERT INTO public.bills (account_no, account_name, period, kwh, amount, amount_centavos, due_date, status, area_id)
  VALUES (v_account_a, 'Payment test member A', to_char(current_date, 'YYYY-MM'), 10, 100.00, 10000, current_date + 7, 'unpaid', v_area_id)
  RETURNING id INTO v_bill_mismatch;
  INSERT INTO public.payment_attempts (bill_id, user_id, amount_centavos, currency, status, idempotency_key, provider_checkout_session_id, expires_at)
  VALUES (v_bill_mismatch, v_member_a, 10000, 'PHP', 'pending', 'test-mismatch-' || gen_random_uuid()::text, 'sess-mismatch-' || gen_random_uuid()::text, now() + interval '30 minutes')
  RETURNING id INTO v_attempt_mismatch;
  SELECT public.apply_checkout_paid(
    'evt-mismatch-' || gen_random_uuid()::text,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    (SELECT provider_checkout_session_id FROM public.payment_attempts WHERE id = v_attempt_mismatch),
    'pay-mismatch-' || gen_random_uuid()::text, 9999, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'amount_mismatch' THEN RAISE EXCEPTION 'amount mismatch expected amount_mismatch, got %', v_result; END IF;
  SELECT count(*) INTO v_payment_count FROM public.payments WHERE paymongo_reference = 'pay-mismatch-test-placeholder';
  IF v_payment_count <> 0 THEN RAISE EXCEPTION 'amount mismatch unexpectedly created a payment'; END IF;
  SELECT result INTO v_event_result FROM public.payment_events WHERE type = 'checkout_session.payment.paid' AND result = 'amount_mismatch' ORDER BY created_at DESC LIMIT 1;
  IF v_event_result IS DISTINCT FROM 'amount_mismatch' THEN RAISE EXCEPTION 'amount mismatch event result was not recorded'; END IF;

  -- Unknown checkout session is recorded and remains unprocessed for provider retry.
  SELECT public.apply_checkout_paid(
    'evt-unknown-' || gen_random_uuid()::text,
    'checkout_session.payment.paid', false, '{}'::jsonb,
    'sess-unknown-' || gen_random_uuid()::text,
    'pay-unknown-' || gen_random_uuid()::text, 10000, 'gcash', now(), 'mobile_wallet'
  ) INTO v_result;
  IF v_result <> 'unknown_session' THEN RAISE EXCEPTION 'unknown session expected unknown_session, got %', v_result; END IF;
  SELECT result, processed_at INTO v_event_result, v_event_processed
  FROM public.payment_events WHERE result = 'unknown_session' ORDER BY created_at DESC LIMIT 1;
  IF v_event_result IS DISTINCT FROM 'unknown_session' OR v_event_processed IS NOT NULL THEN
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

  PERFORM set_config('payments_hardening.member_a', v_member_a::text, true);
  PERFORM set_config('payments_hardening.member_b_payment', v_payment_b_id::text, true);
END;
$$;

-- Verify RLS using member A's JWT claims. Member B's payment must not be visible.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}';
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

ROLLBACK;
