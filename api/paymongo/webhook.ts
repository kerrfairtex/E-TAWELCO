import { createClient } from '@supabase/supabase-js'
import { fail, json } from '../_lib/core.ts'
import {
  verifyPaymongoSignature,
  SignatureResult,
  isLiveAvailable,
  toCentavos,
} from '../_lib/paymongo.ts'

/**
 * PayMongo webhook handler for E-TAWELCO.
 *
 * Reconciles the upstream webhook endpoint with the local paymongo.ts module:
 * - Uses local verifyPaymongoSignature (HMAC-SHA256, timestamp tolerance, key-mode switching)
 * - Uses local SUPABASE_SECRET_KEY convention (not SUPABASE_SERVICE_ROLE_KEY)
 * - Updates bills table with payment status
 */

export default async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  if (!isLiveAvailable()) {
    return fail('PayMongo is not configured for live checkout', 503)
  }

  const rawBody = await req.text()
  const sigHeader = req.headers.get('paymongo-signature') || ''

  // Use the local, more robust signature verification
  const sigResult: SignatureResult = verifyPaymongoSignature(sigHeader, rawBody)

  if (!sigResult.valid) {
    // Non-payment events return status 200 (ack) — still reject
    if (sigResult.status === 200) return json({ ok: true, ignored: true }, 200)
    return fail(sigResult.reason || 'Invalid signature', sigResult.status || 401)
  }

  // At this point the signature is valid and the event is checkout_session.payment.paid
  // Re-parse to get full event data (verifyPaymongoSignature already validated it)
  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return fail('Invalid JSON body', 400)
  }

  const payment = event?.data?.attributes || event?.data || null
  const paymentId = event?.data?.id || payment?.id || null
  const status = payment?.status || event?.type || null

  if (!paymentId || !status) {
    return json({ ok: false, ignored: true }, 202)
  }

  const metadata = payment?.metadata || {}
  const billId = Number(metadata.bill_id || payment?.bill_id || 0)

  if (!billId) {
    return json({ ok: false, ignored: true }, 202)
  }

  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const amount = Number(payment.amount || metadata.amount || 0)
  const settlement = payment?.paid_at || payment?.updated_at || null

  const { error: billError } = await client.from('bills').update({
    status: status === 'paid' ? 'paid' : 'unpaid',
    paid_at: status === 'paid' ? settlement : null,
    paid_channel: 'mobile_wallet',
    payment_ref: paymentId,
    updated_at: new Date().toISOString(),
  }).eq('id', billId)

  if (billError) {
    console.error('[paymongo-webhook] bill update error:', billError.message)
    return fail('Failed to update bill', 500)
  }

  return json({ ok: true, processed: true, payment_id: paymentId })
}

export const config = { runtime: 'nodejs' }
