create or replace function public.apply_checkout_paid(
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
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_events%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_bill public.bills%rowtype;
  v_result text;
begin
  insert into public.payment_events (provider_event_id, type, raw_payload, livemode)
  values (p_event_id, p_event_type, p_payload, coalesce(p_livemode, false))
  on conflict (provider_event_id) do nothing;

  select * into v_event
  from public.payment_events
  where provider_event_id = p_event_id
  for update;

  if v_event.processed_at is not null then
    return 'duplicate';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where provider_checkout_session_id = p_checkout_session_id
  for update;

  if not found then
    return 'unknown_session';
  end if;

  select * into v_bill
  from public.bills
  where id = v_attempt.bill_id
  for update;

  if exists (select 1 from public.payments where paymongo_reference = p_payment_id) then
    v_result := 'duplicate';
  elsif v_bill.status = 'paid'
     or exists (select 1 from public.payments where bill_id = v_bill.id and status = 'paid') then
    v_result := 'second_payment_for_bill';
  elsif v_bill.status not in ('unpaid', 'overdue', 'pending', 'failed', 'expired') then
    v_result := 'bill_not_payable';
  elsif p_amount_centavos <> v_attempt.amount_centavos
     or p_amount_centavos <> v_bill.amount_centavos then
    v_result := 'amount_mismatch';
  else
    insert into public.payments
      (bill_id, paymongo_reference, amount, method, status, paid_at, account_id, currency, raw_event_id)
    values
      (v_bill.id, p_payment_id, (p_amount_centavos / 100.0)::numeric(12,2),
       coalesce(p_method, 'unknown'), 'paid', coalesce(p_paid_at, now()),
       v_attempt.user_id, 'PHP', p_event_id);

    update public.payment_attempts
       set status = 'paid', updated_at = now()
     where id = v_attempt.id;

    update public.payment_attempts
       set status = 'cancelled', updated_at = now()
     where bill_id = v_bill.id and status = 'pending' and id <> v_attempt.id;

    update public.bills
       set status = 'paid',
           paid_at = coalesce(p_paid_at, now()),
           paid_channel = p_channel,
           payment_ref = p_payment_id,
           updated_at = now()
     where id = v_bill.id;

    v_result := 'paid';
  end if;

  update public.payment_events set processed_at = now() where id = v_event.id;
  return v_result;
end
$$;

revoke all on function public.apply_checkout_paid(text, text, boolean, jsonb, text, text, bigint, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_checkout_paid(text, text, boolean, jsonb, text, text, bigint, text, timestamptz, text)
  to service_role;
