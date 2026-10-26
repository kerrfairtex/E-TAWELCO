/**
 * POST /api/pay/create — create a PayMongo v2 Checkout Session for a bill
 *
 * Separate Serverless Function so Vercel routes /api/pay/create correctly.
 *
 * DB references (PENDING — columns/functions are NOT yet confirmed by migration):
 *   payments table (PENDING) with columns: id, bill_id, provider, provider_ref,
 *     amount (pesos), currency, method, status, created_at — NOT YET created
 *
 * Docs source (fetched via curl from developers.paymongo.com):
 *   Hosted Checkout v2: "We recommend /v2 for new integrations" (developers.paymongo.com/docs/payment-channels-hosted-checkout)
 *     Endpoint: POST https://api.paymongo.com/v2/checkout_sessions
 *     Valid v2 payment_method_types: ["card", "gcash", "qrph"]
 */
import { authorize, body, fail, internalError, json, supabase, audit } from '../_lib/core.js'

const payMongoEnabled = () =>
  process.env.PAYMONGO_ENABLED === 'true' &&
  !!process.env.PAYMONGO_SECRET_KEY

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
      const { data: profile, error: profileError } = await client.from('profiles').select('account_no').eq('id', s.id).maybeSingle()
      if (profileError) throw profileError
      const linkedNo = typeof profile?.account_no === 'string' ? profile.account_no.trim() : ''
      const { data: bill, error: billError } = await client.from('bills').select('id,period,amount,status,account_no,account_name').eq('id', billId).eq('account_no', linkedNo).maybeSingle()
      if (billError) throw billError
      if (!bill) return fail('Bill not found', 404)
      if (bill.status !== 'unpaid') return fail('Bill is already paid', 409)

      // Check for existing pending payment (prevents duplicate checkout sessions)
      const existing = await client.from('payments').select('id').eq('bill_id', billId).eq('status', 'pending').maybeSingle()
      if (existing.data) return fail('Checkout session already created', 409)

      // Payment method types from env PAYMONGO_METHODS, default: card,gcash
      // Valid v2 values: card, gcash, paymaya, qrph
      const methodsStr = process.env.PAYMONGO_METHODS || 'card,gcash'
      const methods = methodsStr.split(',').map(m => m.trim()).filter(m => m.length > 0)

      const amount = Math.round(Number(bill.amount) * 100) // PHP → centavos (PayMongo boundary only)
      // Normalize SITE_URL: trim, strip trailing slash
      let siteUrl = (process.env.SITE_URL || '').trim().replace(/\/+$/, '')
      if (!siteUrl) return fail('SITE_URL is not configured', 500)
      const ref = `PM-${bill.id}-${Date.now()}`
      const checkoutPayload = {
        data: {
          type: 'checkout_session',
          attributes: {
            line_items: [{
              name: `E-TAWELCO Bill ${bill.period}`,
              amount: amount,
              currency: 'PHP',
              quantity: 1,
            }],
            payment_method_types: methods,
            success_url: `${siteUrl}/dashboard?tab=my-bills`,
            cancel_url: `${siteUrl}/dashboard?tab=my-bills`,
            reference_number: ref,
            metadata: { bill_id: String(bill.id), account_no: bill.account_no },
          },
        },
      }

      // Create Checkout Session with PayMongo v2
      // Endpoint from docs: https://api.paymongo.com/v2/checkout_sessions
      const pmRes = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY! + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(checkoutPayload),
      })
      const pmData = await pmRes.json()
      if (!pmRes.ok) {
        return fail(pmData?.errors?.[0]?.detail || pmData?.message || 'Payment provider error', 502)
      }

      const checkoutUrl = pmData.data?.attributes?.checkout_url
      const sessionId = pmData.data?.id || pmData.data?.attributes?.id

      // Insert a pending payment record (amount in PESOS, not centavos)
      // payments table (PENDING): id, bill_id, provider, provider_ref, amount,
      //   currency, method, status, created_at, updated_at, paid_at, channel
      const { error: insertErr } = await client.from('payments').insert({
        bill_id: billId,
        provider: 'paymongo',
        provider_ref: sessionId,
        amount: Number(bill.amount),
        currency: 'PHP',
        method: null,
        status: 'pending',
      })
      if (insertErr) throw insertErr

      await audit(client, s, 'payment.create', 'bill', billId, { bill_id: billId, amount, provider: 'paymongo' })
      return json({ ok: true, checkout_url: checkoutUrl, session_id: sessionId, amount: Number(bill.amount), period: bill.period })
    } catch (error) {
      return internalError(error)
    }
  }
}
