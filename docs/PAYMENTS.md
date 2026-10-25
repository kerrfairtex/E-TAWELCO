# Online Payments - Demo Flow (demo-payments branch)

## Goal

Members can pay bills online via a **simulated** payment flow (no real
gateway). A two-step server flow: the checkout screen is rendered
client-side only, and the server runs only when the member taps Pay in
the fake checkout. No PayMongo, no webhook, no `payments` table, no
database migrations required.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `DEMO_PAYMENTS` | Yes | Must be exactly `'true'` on the server. When unset or any other value, the simulate route returns 404 and the Pay button is hidden. |

No gateway keys are needed. No webhook secret.

## Flow

1. Member signs in to the dashboard and opens **My bills**.
2. `/api/bills?scope=mine` returns `pay: { enabled: DEMO_PAYMENTS === 'true', demo: true }`.
3. If `pay.enabled` is true, an unpaid bill row shows a **Pay** button.
4. Member taps **Pay** on a bill -> the frontend renders a fake checkout
   screen (client-side only, no server call yet).
5. Member selects a payment method (GCash, Maya, or Card — label only)
   and taps **Pay** in the fake checkout.
6. Frontend calls `POST /api/pay/simulate` with `{ bill_id, method }`.
7. Server verifies the member's session, looks up the bill by `id` **and**
   the session profile's `account_no`, checks it is still `unpaid`, and
   runs:
   ```sql
   UPDATE bills
   SET status = 'paid',
       paid_at = now(),
       paid_channel = 'mobile_wallet',
       payment_ref = 'SIM-YYYYMMDD-RRRRRR',
       recorded_by = <member id>,
       updated_at = now()
   WHERE id = <billId> AND status = 'unpaid'
   ```
   The `WHERE status = 'unpaid'` clause is the idempotency guard: if the
   bill was already paid (by a concurrent request or otherwise), zero rows
   are affected and the server returns 409.
8. Server returns `{ ok: true, payment_ref, amount, period, method }`.
9. Frontend shows a success receipt (reference, amount, period, method,
   timestamp) and a **Back to My bills** button.

## New route

| Route | Method | Auth | Gate |
|-------|--------|------|------|
| `/api/simulate` | POST | Member | `DEMO_PAYMENTS === 'true'` (404 otherwise) |

### Route mapping (api/[...path].ts)

- `POST /api/simulate` is routed via `'simulate'` in the `known` array.
- The handler is `paySimulate()`.

## Server handler: paySimulate()

Located at `api/[...path].ts`, `paySimulate()` function:

```
Line 295: if (req.method !== 'POST') return fail('Method not allowed', 405)
Line 296: if (process.env.DEMO_PAYMENTS !== 'true') return fail('Demo payments are not enabled', 404)
Line 297: const s = await authorize(req); if (s instanceof Response) return s
Line 299: const billId = Number(b.bill_id)
Line 301: const method = oneOf(b.method, ['gcash', 'maya', 'card'])
Line 303-305: SELECT account_no FROM profiles WHERE id = s.id
Line 306: SELECT ... FROM bills WHERE id = billId AND account_no = linkedNo
Line 308: if (!bill) return fail('Bill not found', 404)
Line 309: if (bill.status !== 'unpaid') return fail('Bill is already paid', 409)
Line 310: const amount = Number(bill.amount)   // from DB, never from client
Line 313: const ref = `SIM-${date}-${rand}`
Line 314: UPDATE bills SET status='paid', paid_at=..., paid_channel='mobile_wallet',
         payment_ref=ref, recorded_by=s.id, updated_at=...
         WHERE id = billId AND status = 'unpaid'
Line 316: if (!count || count === 0) return fail('Bill was already paid', 409)
Line 317: audit(client, s, 'payment.simulated', 'bill', billId, { bill_id, amount, method, provider: 'simulate' })
Line 318: return json({ ok: true, payment_ref: ref, amount, period: bill.period, method })
```

### Security checks (PASS/FAIL)

- **Amount read from DB, not client**: PASS — line 310: `const amount = Number(bill.amount)`.
  The client sends only `bill_id` and `method`; the amount comes from the
  database row fetched at line 306.
- **Ownership checked via session profile account_no**: PASS — line 303
  fetches `profiles.account_no` by `s.id` (session user id), then line 306
  fetches the bill with `.eq('account_no', linkedNo)`.
- **Already-paid check**: PASS — line 309 returns 409 before any update.
- **Atomic UPDATE with idempotency**: PASS — line 314 updates with
  `.eq('id', billId).eq('status', 'unpaid')`, and line 316 checks
  `count === 0` → 409. This is a compare-and-swap: if a concurrent
  request or prior state already paid the bill, zero rows are updated.
- **DEMO_PAYMENTS gate**: PASS — line 296 returns 404 when not
  `'true'`.
- **No secrets or full payloads logged**: PASS — line 317 logs only
  `bill_id`, `amount`, `method`, `provider`. No `payment_ref`, no raw
  request body, no env values.
- **Member auth required**: PASS — line 297: `authorize(req)`.

## Bills response (GET /api/bills?scope=mine)

The bills handler returns `pay` info so the frontend knows whether to
show the Pay button:

```
Line 201: pay: { enabled: process.env.DEMO_PAYMENTS === 'true', demo: true }
```

## Frontend changes (src/dashboard/main.js)

### Pay button in bills table

In `myBillsView()`, the table header adds an empty column when
`data.pay?.enabled`:

```
Line 940: ${payEnabled ? '<th><span class="visually-hidden">Action</span></th>' : ''}
Line 941: ${payEnabled ? `<td>${bill.status === 'unpaid' && data.pay?.enabled ? `<button class="btn btn-primary" type="button" data-pay-bill="${esc(b.id)}">Pay</button>` : ''}</td>` : ''}
```

Event listener attached after rendering:

```
Line 955: '[data-view="my-bills"]', view).forEach((button) => {
Line 956:   button.addEventListener('click', () => {
Line 957:     const bill = (data.bills || []).find((b) => String(b.id) === button.dataset.payBill)
Line 958:     if (bill) startSimulate(bill)
Line 959:   })
Line 960: })
```

### Replacement of sample text

The old `paymentSamples()` function showed "How to pay (sample)" with
GCash, Maya, Bank transfer, and PayPal details, ending with "This website
does not accept payments."

It is replaced with:

```
<div class="card-head"><h2>Online payment</h2></div>
<p class="muted">Pay your bill online during this demo. Select an unpaid bill below and follow the simulated checkout. No real money is transferred.</p>
```

### Fake checkout UI (checkoutUI + startSimulate)

The fake checkout is rendered client-side only (no server call when it
opens):

```
checkoutUI(bill):
  - .demo-checkout overlay modal
  - .demo-banner: "DEMO — No real money"
  - Bill period and amount display
  - GCash / Maya / Card radio buttons (default: GCash)
  - Fake input fields (readonly, disabled styling): "Mobile number", "Account number"
  - "Pay <amount>" button

startSimulate(bill):
  1. Render checkoutUI into a detached DOM element
  2. Method selection: click handler updates selectedMethod
  3. On Pay button click:
     - Disable button, show "Processing…"
     - 1.5s simulated delay (setTimeout)
     - POST /api/simulate with { bill_id, method }
  4. On success (result.ok):
     - Replace UI with success receipt:
       Reference, Amount, Period, Method, Paid on (timestamp)
       "Back to My bills" button
  5. On failure:
     - Replace UI with error message
       "Back to My bills" button
```

### CSS (dashboard/index.html)

CSS classes `.demo-checkout`, `.demo-overlay`, `.demo-modal`,
`.demo-banner`, `.demo-amount`, `.pay-choose`, `.demo-fields`,
`.demo-pay-btn`, `.demo-receipt`, `.demo-tag` are defined in the
`<style>` block of `dashboard/index.html` (and copied to
`public/dashboard/index.html` by the build).

## Admin Billing Oversight

In `billingView()` (`src/dashboard/main.js`), bill rows now show a **DEMO**
tag when `payment_ref` starts with `SIM-`:

```
Line 326: ${b.payment_ref && b.payment_ref.startsWith('SIM-') ? '<span class="demo-tag" title="Simulated payment">DEMO</span> ' : ''}${esc(PAY_CHANNEL[b.paid_channel] ?? '')}${b.payment_ref ? ` · ${esc(b.payment_ref)}` : ''}
```

## Public pages (index.html, public/index.html)

The payment channels section text is changed from:

> No payments are taken on this website. Pay through one of the channels
> above and the cooperative records it on your account...

To:

> Online payments are available in the member dashboard. Sign in to pay
> your bill online.

No Pay button is shown on the public page. Members must sign in to the
dashboard.

## Failure cases

| Scenario | Behavior |
|----------|----------|
| DEMO_PAYMENTS not 'true' | POST /api/simulate returns 404; Pay buttons hidden |
| Bill not found or not owned | 404 |
| Bill already paid | 409 "Bill is already paid" |
| Concurrent payment (race) | 409 "Bill was already paid" (UPDATE ... WHERE status='unpaid' affects 0 rows) |
| Invalid method | 400 "Invalid payment method" |
| Invalid/non-integer bill_id | 400 "Invalid bill" |
| Member not authenticated | 401 (authorize() returns 401) |
| Server error | 500 (audit not written if UPDATE fails before audit call) |

## Files changed (demo-payments vs admin-user-creation)

| File | Change |
|------|--------|
| `api/[...path].ts` | Add 'simulate' to known routes; add `paySimulate()` handler; return `pay` in bills response |
| `src/dashboard/main.js` | Pay button in myBillsView; `checkoutUI()` and `startSimulate()`; replace `paymentSamples()`; add DEMO tag in billingView |
| `index.html` | Replace "No payments are taken" with "Sign in to pay" text |
| `public/index.html` | Same text replacement (build output of index.html) |
| `dashboard/index.html` | Add CSS for `.demo-*` classes |
| `public/dashboard/index.html` | Same CSS addition (build output) |
| `docs/PAYMENTS.md` | This file |

## Build

```
npm run build
```

esbuild bundles `src/dashboard/main.js` -> `dashboard/app.js`, then copies
`index.html` -> `public/index.html` and `dashboard/app.js` ->
`public/dashboard/app.js`. CSS from `dashboard/index.html` is propagated
to `public/dashboard/index.html`.
