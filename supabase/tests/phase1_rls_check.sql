-- Run only against a disposable development/branch database.
-- Replace the placeholders before execution; never run against production.

select c.conrelid::regclass as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid in ('public.bills'::regclass, 'public.payment_attempts'::regclass, 'public.payments'::regclass, 'public.payment_events'::regclass, 'public.refunds'::regclass)
order by 1, 2;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('payment_attempts','payments','payment_events','refunds')
order by tablename, policyname;

select relname, relrowsecurity
from pg_class
where oid in ('public.payment_attempts'::regclass, 'public.payments'::regclass, 'public.payment_events'::regclass, 'public.refunds'::regclass);

-- Authenticated-member rejection checks require a real dev user JWT and bill ID.
-- Service-role insertion checks require a disposable test bill/user.
-- These are intentionally explicit so a runner cannot mistake placeholders for proof.
-- \set member_jwt 'REPLACE_WITH_DEV_MEMBER_JWT'
-- \set test_bill_id 0
-- \set test_user_id '00000000-0000-0000-0000-000000000000'
-- \set provider_payment_id 'phase1-test-payment'
-- \set idempotency_key 'phase1-test-idempotency'
