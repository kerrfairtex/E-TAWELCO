/**
 * POST /api/pay/create — create a PayMongo v2 Checkout Session for a bill
 *
 * Separate Serverless Function so Vercel routes /api/pay/create correctly.
 *
 * All PayMongo helpers (payMongoEnabled, createCheckoutSession, amount helpers)
 * live in api/_lib/paymongo.ts — this file imports from there.
 *
 * Docs source: https://developers.paymongo.com/docs/payment-channels-hosted-checkout
 *   "We recommend /v2 for new integrations."
 *   Valid v2 payment_method_types: ["card"], ["gcash"], ["paymaya"], ["qrph"]
 *
 * DB references (PENDING — confirmed by migration required):
 *   payments table (PENDING): id, bill_id, provider, provider_ref, amount (pesos),
 *     currency, method, status, channel, checkout_url, pending_at, created_at, updated_at
 */
import { authorize, body, fail, internalError, json, supabase, audit } from '../_lib/core.js'
import { payMongoEnabled, createCheckoutSession, getLivePendingCheckout } from '../_lib/paymongo.js'

export default {
  async fetch(req: Request) {
    try {
      if (req.method !== 'POST') return fail('Method not allowed', 405)
      if (!payMongoEnabled()) return fail('PayMongo payments are not enabled', 404)
      const s = await authorize(req); if (s instanceof Response) return s
      const b = await body(req)
      const billId = Number(b.bill_id)
      if (!Number.isInteger(billId) || billId <= 0) return fail('Invalid bill', 400)

      const client = supabase(req)

      // Link account number to the authenticated user's profile
      const { data: profile, error: profileError } = await client.from('profiles').select('account_no').eq('id', s.id).maybeSingle()
      if (profileError) throw profileError
      const linkedNo = typeof profile?.account_no === 'string' ? profile.account_no.trim() : ''

      // Fetch the bill, scoped to the member's account_no
      const { data: bill, error: billError } = await client.from('bills').select('id,period,amount,status,account_no,account_name').eq('id', billId).eq('account_no', linkedNo).maybeSingle()
      if (billError) throw billError
      if (!bill) return fail('Bill not found', 404)
      if (bill.status !== 'unpaid') return fail('Bill is already paid', 409)

      // Check for existing live pending payment within 30-min expiry window
      // PENDING: payments table needs checkout_url and pending_at columns
      const existingUrl = await getLivePendingCheckout(client, billId)
      if (existingUrl) {
        return json({ ok: true, checkout_url: existingUrl, session_id: null, amount: Number(bill.amount), period: bill.period, existing: true })
      }

      // Create PayMongo v2 Checkout Session
      const result = await createCheckoutSession(billId, bill.period, Number(bill.amount), bill.account_no)
      if ('error' in result) {
        return fail(result.error, 502)
      }

      // Insert a pending payment record (amount in PESOS, not centavos)
      // payments table (PENDING): checkout_url, pending_at added; account_no added
      const { error: insertErr } = await client.from('payments').insert({
        bill_id: billId,
        provider: 'paymongo',
        provider_ref: result.sessionId,
        checkout_url: result.checkoutUrl,
        account_no: bill.account_no,
        pending_at: new Date().toISOString(),
        amount: Number(bill.amount),
        currency: 'PHP',
        method: null,
        status: 'pending',
      })
      if (insertErr) throw insertErr

      await audit(client, s, 'payment.create', 'bill', billId, { bill_id: billId, amount: Number(bill.amount), provider: 'paymongo' })
      return json({ ok: true, checkout_url: result.checkoutUrl, session_id: result.sessionId, amount: Number(bill.amount), period: bill.period })
    } catch (error) {
      return internalError(error)
    }
  }
}
