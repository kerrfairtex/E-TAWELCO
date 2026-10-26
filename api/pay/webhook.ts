/**
 * POST /api/pay/webhook — PayMongo webhook receiver
 *
 * Separate Serverless Function so Vercel routes /api/pay/webhook correctly
 * (api/[...path].ts catch-all does not match multi-segment paths on Vercel).
 *
 * DB references (PENDING — confirmed by migration required):
 *   confirm_online_payment(p_payment_id, p_provider_ref, p_amount, p_paid_at, p_paid_channel)
 *   payments table (PENDING): provider_ref, status, amount, channel
 *
 * The webhook NEVER writes to payments or bills directly.
 * It only calls confirm_online_payment RPC. If RPC fails, return 500 so PayMongo retries.
 */
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { fail, internalError, json, supabase } from '../_lib/core.js'

const payMongoEnabled = () =>
  process.env.PAYMONGO_ENABLED === 'true' &&
  !!process.env.PAYMONGO_SECRET_KEY

export default {
  async fetch(req: Request) {
    try {
      if (req.method !== 'POST') return fail('Method not allowed', 405)
      if (!payMongoEnabled()) return fail('PayMongo payments are not enabled', 404)

      // Fail closed: if webhook secret is not configured, return 503 and process nothing
      const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET
      if (!webhookSecret) return fail('Webhook secret not configured', 503)

      // Read raw body FIRST — before any other consumer touches the stream
      const rawBody = await req.text()
      const sigHeader = req.headers.get('paymongo-signature') || ''

      // Parse Paymongo-Signature: t=<timestamp>,te=<test_sig>,li=<live_sig>
      const parts: Record<string, string> = {}
      for (const pair of sigHeader.split(',')) {
        const idx = pair.indexOf('=')
        if (idx > 0) parts[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
      const t = parts['t']

      // Timestamp tolerance: reject events older than 5 minutes (from header t)
      if (!t) return fail('Missing timestamp', 401)
      const eventTime = Number(t)
      if (!Number.isFinite(eventTime) || Math.abs(Date.now() / 1000 - eventTime) > 300) {
        return fail('Timestamp out of tolerance', 401)
      }

      // Determine key mode from the SECRET key prefix (sk_test_ or sk_live_)
      const isLive = process.env.PAYMONGO_SECRET_KEY!.startsWith('sk_live_')
      const sigToUse = isLive ? parts['li'] : parts['te']

      // If live key receives a test-signed event (or vice versa), sigToUse will be empty → 401
      if (!sigToUse) return fail('Signature field for key mode not present', 401)

      // Compute HMAC: signedPayload = `${t}.${rawBody}`, HMAC-SHA256 with webhook secret
      const signedPayload = `${t}.${rawBody}`
      const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex')

      // Constant-time comparison
      const expectedBuf = Buffer.from(expected, 'hex')
      const providedBuf = Buffer.from(sigToUse, 'hex')
      if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
        return fail('Invalid signature', 401)
      }

      // Parse payload (defensive, optional chaining)
      let payload: any = {}
      try { payload = JSON.parse(rawBody) } catch { return fail('Invalid JSON', 400) }

      const eventType = payload?.data?.attributes?.type
      const checkoutData = payload?.data?.attributes?.data

      // Ack 200 for non-checkout_session.payment.paid events
      if (eventType !== 'checkout_session.payment.paid') {
        return json({ ok: true, ignored: eventType })
      }

      // Look up payment by session ID (stored at creation as provider_ref)
      // payments table (PENDING) — provider_ref column NOT confirmed by migration
      const sessionId = checkoutData?.id
      if (!sessionId) return fail('Missing session ID', 400)

      const client = supabase(req)
      const { data: payment, error: payErr } = await client.from('payments')
        .select('id,status,amount')
        .eq('provider_ref', sessionId)
        .maybeSingle()
      if (payErr) throw payErr
      if (!payment) return fail('Payment record not found', 404)

      // Idempotency: if already succeeded, return 200
      if (payment.status === 'succeeded') {
        return json({ ok: true, message: 'Payment already processed' })
      }

      // Amount verification: paid amount (centavos) must match payment.amount (pesos) * 100
      const paidAmount = checkoutData?.attributes?.payment_intent?.attributes?.amount ||
                         checkoutData?.attributes?.payments?.[0]?.attributes?.amount || 0
      if (paidAmount !== Math.round(Number(payment.amount) * 100)) {
        return fail('Amount mismatch', 400)
      }

      // Determine channel: store real channel on payments.channel
      // bills.paid_channel: gcash/paymaya → mobile_wallet; card/qrph → NULL
      const sourceType = checkoutData?.attributes?.payments?.[0]?.attributes?.source?.type || 'card'
      const billPaidChannel = (sourceType === 'gcash' || sourceType === 'paymaya') ? 'mobile_wallet' : null

      // Delegate to confirm_online_payment RPC (service role only)
      // payments table and RPC are PENDING — schema NOT confirmed by migration
      const requestId = randomBytes(8).toString('hex')
      const { error: rpcErr } = await client.rpc('confirm_online_payment', {
        p_payment_id: payment.id,
        p_provider_ref: sessionId,
        p_amount: Math.round(Number(payment.amount) * 100),
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
