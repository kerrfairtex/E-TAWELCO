import crypto from 'node:crypto'
import type { Config } from '@netlify/functions'
import { fail, json } from '../_lib/core.ts'
import {
  createSupabaseServerClient,
  getWebhookSecret,
} from '../_lib/paymongo.ts'

export default async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  try {
    const rawBody = await req.text()
    const signature = req.headers.get('paymongo-signature') || ''
    const secret = getWebhookSecret()

    if (!secret) return fail('Webhook is not configured', 503)
    if (!signature) return fail('Missing PayMongo signature', 401)

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const received = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')
    if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, received)) {
      return fail('Invalid webhook signature', 401)
    }

    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch {
      return fail('Invalid webhook body', 400)
    }

    const payment = event?.data?.attributes || event?.data || null
    const paymentId = event?.data?.id || payment?.id || null
    const status = payment?.status || event?.type || null
    const metadata = payment?.metadata || {}
    const billId = Number(metadata.bill_id || payment?.bill_id || 0)

    if (!paymentId || !billId || !status) return json({ ok: true, ignored: true }, 200)

    const client = createSupabaseServerClient()
    const amount = Number(payment.amount || metadata.amount || 0)
    const settlement = payment?.paid_at || payment?.updated_at || null

    const { error } = await client.from('bills').update({
      status: status === 'paid' ? 'paid' : 'unpaid',
      paid_at: status === 'paid' ? settlement : null,
      paid_channel: 'mobile_wallet',
      payment_ref: paymentId,
      updated_at: new Date().toISOString(),
    }).eq('id', billId)
    if (error) throw error

    return json({ ok: true, processed: true, payment_id: paymentId, amount })
  } catch (error) {
    console.error('[paymongo-webhook]', error)
    return fail('Unable to process webhook', 500)
  }
}

export const config: Config = { path: '/api/paymongo/webhook', method: 'POST' }
