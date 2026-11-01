import { createClient } from '@supabase/supabase-js'
import { fail, json } from '../_lib/core.ts'
import { getWebhookSecret, verifyPaymongoSignature } from '../_lib/paymongo.ts'

// Wallets map to 'mobile_wallet'; everything else (card, qrph, ...) maps to 'bank'.
// Verify these values against the payChannels list in api/[...path].ts and any
// check constraint on bills.paid_channel, otherwise the RPC's bill update will fail.
const WALLETS = ['gcash', 'paymaya', 'grab_pay', 'shopee_pay']
const channelFor = (m: string) => (WALLETS.includes(m) ? 'mobile_wallet' : 'bank')

function toIso(v: unknown): string | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

export default {
  async fetch(req: Request) {
    if (req.method !== 'POST') return fail('Method not allowed', 405)

    // Read the raw body first, before any parsing, so the signature check is exact.
    const rawBody = await req.text()
    const header = req.headers.get('paymongo-signature')
    if (!verifyPaymongoSignature(rawBody, header, getWebhookSecret())) {
      return fail('Invalid signature', 401)
    }

    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      return fail('Invalid JSON', 400)
    }

    // Accept both payload shapes seen in PayMongo's docs:
    //   data.attributes.{type,data}  (v1-style event)
    //   data.{type,data}             (v2-style event)
    const root = body?.data ?? {}
    const ev = root?.attributes?.type ? root.attributes : root
    const type = ev?.type
    if (type !== 'checkout_session.payment.paid') {
      return json({ ok: true, ignored: type ?? null }) // 2xx so PayMongo does not retry
    }

    const session = ev?.data
    const sessionId: string | undefined = session?.id
    const payment = session?.attributes?.payments?.[0]
    const pa = payment?.attributes ?? payment
    const paymentId: string | undefined = payment?.id
    const amount = Number(pa?.amount)
    const method: string = pa?.source?.type ?? 'unknown'
    const eventId = String(root?.id ?? body?.id ?? `${type}:${sessionId}:${paymentId}`)

    // Test events must never touch live data, and live events must never touch test data.
    const isLiveKey = (process.env.PAYMONGO_SECRET_KEY || '').startsWith('sk_live_')
    if (!!ev?.livemode !== isLiveKey) {
      console.warn('[paymongo-webhook] livemode mismatch, ignored', eventId)
      return json({ ok: true, ignored: 'livemode_mismatch' })
    }

    // Only PHP payments are valid for bills.
    if (pa?.currency && pa.currency !== 'PHP') {
      console.error('[paymongo-webhook] NEEDS REVIEW non-PHP currency', { eventId, currency: pa.currency })
      return json({ ok: true, ignored: 'currency' })
    }

    if (!sessionId || !paymentId || !Number.isSafeInteger(amount) || amount <= 0) {
      console.error('[paymongo-webhook] unrecognised payload', { type, sessionId, paymentId, amount })
      return fail('Unrecognised payload', 500) // fail loudly so PayMongo retries and you see the log
    }

    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return fail('Server not configured', 503)
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: result, error } = await client.rpc('apply_checkout_paid', {
      p_event_id: eventId,
      p_event_type: type,
      p_livemode: !!ev?.livemode,
      p_payload: body,
      p_checkout_session_id: sessionId,
      p_payment_id: paymentId,
      p_amount_centavos: amount,
      p_method: method,
      p_paid_at: toIso(pa?.paid_at),
      p_channel: channelFor(method),
    })
    if (error) {
      console.error('[paymongo-webhook] rpc failed', error)
      return fail('Processing error', 500) // PayMongo will retry
    }

    console.log('[paymongo-webhook]', JSON.stringify({ eventId, sessionId, paymentId, result }))

    // The session row may not be saved yet if the webhook beats checkout.ts: let PayMongo retry.
    if (result === 'unknown_session') return fail('Unknown session', 500)

    if (result === 'amount_mismatch' || result === 'second_payment_for_bill' || result === 'bill_not_payable') {
      console.error('[paymongo-webhook] NEEDS REVIEW', { eventId, paymentId, result })
    }
    return json({ ok: true, result })
  },
}
