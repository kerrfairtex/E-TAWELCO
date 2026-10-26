/**
 * POST /api/pay/webhook — PayMongo webhook receiver
 *
 * Separate Serverless Function so Vercel routes /api/pay/webhook correctly
 * (api/[...path].ts catch-all does not match multi-segment paths on Vercel).
 *
 * All PayMongo helpers (signature verification, amount conversion, etc.)
 * live in api/_lib/paymongo.ts — this file imports from there.
 *
 * The webhook NEVER writes to payments or bills directly.
 * It only calls confirm_online_payment RPC. If RPC fails, return 500 so PayMongo retries.
 */
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto'
import { fail, internalError, json, supabase } from '../_lib/core.js'
import { payMongoEnabled, verifyPaymongoSignature, toCentavos } from '../_lib/paymongo.js'

export default {
  async fetch(req: Request) {
    try {
      if (req.method !== 'POST') return fail('Method not allowed', 405)
      if (!payMongoEnabled()) return fail('PayMongo payments are not enabled', 404)

      // Read raw body FIRST — before any other consumer touches the stream
      const rawBody = await req.text()
      const sigHeader = req.headers.get('paymongo-signature') || ''

      // Verify signature (fail-closed: 503 if secret unset, 401 on bad sig/timestamp/key-mode)
      const sigResult = verifyPaymongoSignature(sigHeader, rawBody)
      if (!sigResult.valid) {
        if (sigResult.status === 200) return json({ ok: true, ignored: true })
        if (sigResult.status === 503) return fail(sigResult.reason!, sigResult.status)
        return fail(sigResult.reason!, sigResult.status)
      }

      const { eventId, checkoutData } = sigResult

      // Extract session ID from the checkout session object
      const sessionId = checkoutData?.id
      if (!sessionId) return fail('Missing session ID', 400)

      const client = supabase(req)
      // Look up payment by session ID (stored at creation as provider_ref)
      // payments table (PENDING): provider_ref column NOT confirmed by migration
      const { data: payment, error: payErr } = await client.from('payments')
        .select('id,status,amount')
        .eq('provider_ref', sessionId)
        .maybeSingle()
      if (payErr) throw payErr
      if (!payment) return fail('Payment record not found', 404)

      // Idempotency: if already confirmed/failed/expired, return 200
      if (['confirmed', 'failed', 'expired'].includes(payment.status)) {
        return json({ ok: true, message: 'Payment already processed' })
      }

      // Amount verification: paid amount (centavos) must match payment.amount (pesos) * 100
      const paidAmount = checkoutData?.attributes?.payment_intent?.attributes?.amount ||
                         checkoutData?.attributes?.payments?.[0]?.attributes?.amount || 0
      if (paidAmount !== toCentavos(payment.amount)) {
        return fail('Amount mismatch', 400)
      }

      // Determine channel: store real channel
      // bills.paid_channel: gcash/paymaya → mobile_wallet; card/qrph → NULL
      const sourceType = checkoutData?.attributes?.payments?.[0]?.attributes?.source?.type || 'card'
      const billPaidChannel = (sourceType === 'gcash' || sourceType === 'paymaya') ? 'mobile_wallet' : null

      // Delegate to confirm_online_payment RPC (service role only)
      // RPC signature (PENDING — confirmed by migration required):
      //   confirm_online_payment(p_payment_id, p_provider_ref, p_amount, p_event_id, p_paid_at, p_paid_channel)
      const requestId = randomBytes(8).toString('hex')
      const { error: rpcErr } = await client.rpc('confirm_online_payment', {
        p_payment_id: payment.id,
        p_provider_ref: sessionId,
        p_amount: toCentavos(payment.amount),
        p_event_id: eventId,
        p_paid_at: new Date().toISOString(),
        p_paid_channel: billPaidChannel,
      })
      if (rpcErr) {
        // Log request ID and return 500 so PayMongo retries
        console.error(`[webhook:${requestId}] confirm_online_payment failed:`, rpcErr)
        return fail(`confirm_online_payment failed (req:${requestId})`, 500)
      }

      return json({ ok: true })
    } catch (error) {
      return internalError(error)
    }
  }
}
