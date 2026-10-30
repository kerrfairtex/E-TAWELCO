import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { fail, json } from '../_lib/core.ts'
import { getWebhookSecret } from '../_lib/paymongo.ts'

export default async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  const rawBody = await req.text()
  const signature = req.headers.get('paymongo-signature') || ''
  const secret = getWebhookSecret()

  if (!secret) return fail('Webhook secret not configured', 503)
  if (!signature) return fail('Missing PayMongo signature', 401)

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  if (crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
    // exact match — okay
  } else if (expected !== signature) {
    return fail('Invalid webhook signature', 401)
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return fail('Invalid JSON body', 400)
  }

  const payment = event?.data?.attributes || event?.data || null
  const paymentId = event?.data?.id || payment?.id || null
  const status = payment?.status || event?.type || null
  const metadata = payment?.metadata || {}
  const billId = Number(metadata.bill_id || payment?.bill_id || 0)

  if (!paymentId || !billId || !status) {
    return json({ ok: false, ignored: true }, 202)
  }

  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const amount = Number(payment.amount || metadata.amount || 0)
  const settlement = payment?.paid_at || payment?.updated_at || null

  await client.from('bills').update({
    status: status === 'paid' ? 'paid' : 'unpaid',
    paid_at: status === 'paid' ? settlement : null,
    paid_channel: 'mobile_wallet',
    payment_ref: paymentId,
    updated_at: new Date().toISOString(),
  }).eq('id', billId)

  return json({ ok: true, processed: true, payment_id: paymentId })
}
