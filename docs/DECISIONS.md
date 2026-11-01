# E-TAWELCO Phase 3 Decisions

**Status:** APPROVED — all six fields answered by user on 2026-10-17.

## 1. Scope

DEMO — no real payments, test users only.

**Real billing requires written TAWELCO authorization.** Authorization reference: UNANSWERED.
TAWELCO is under NEA-appointed management since 2022 and a Dec 2025 debt restructuring; authorization must come from current management.

## 2. Schema

Normalized: accounts + account_members (many-to-many) -> bills via account_id.

**Not** profiles.account_no.

## 3. Tariff source and charge components

UNANSWERED — official schedule and date not provided.

Aggregator figure of 9.7519/kWh at 400 kWh is unofficial and undated. Demo uses placeholder rates labeled "sample".

## 4. Data Privacy Act (RA 10173)

- Data controller: TAWELCO (expected)
- DPO: UNANSWERED
- NPC registration: ask counsel
- Processor agreement required
- Retention: purpose-limited; billing records follow tax retention

## 5. Payment provider

none yet. Shortlist: PayMongo, Xendit.

Merchant account must be in TAWELCO's name. Fees: UNVERIFIED.

## 6. Tax and documents

UNANSWERED — tax status, TIN, VAT treatment, invoice issuer, e-invoicing coverage, permit, numbering.

Retention default: 5 years, no hard deletes, pending accountant confirmation.

No document titled "Official Receipt" or "Invoice" is generated.

---

**Scope = demo.** Part B skips: payments, payment_events, invoices, receipts, credit_notes, idempotency_keys (for payments), and apply_payment() payment-specific logic. Ledger, bills, bill_line_items, accounts, billing_periods, adjustments, audit_log are still built.

**Part B preconditions:**
- Phase 2 precondition evidence still missing (preview build green, /api/health = 200, /api/does-not-exist = 404, static routes = 200)
- All fix/vercel-runtime deployments are BLOCKED by Vercel (private repo + Hobby plan)

**Next step:** Unblock Vercel deployment, verify Phase 2, then proceed to Part B staging/schema work.
