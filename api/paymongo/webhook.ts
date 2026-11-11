import crypto from 'node:crypto'
import { fail, json } from '../_lib/core.ts'
import { createSupabaseServerClient, getWebhookSecret } from '../_lib/paymongo.ts'

export const ALLOWED_EVENTS = new Set([
  'checkout_session.payment.paid',
  'payment.paid',
  'payment.failed',
  'payment.expired',
])

export function parseSignatureHeader(value: string) {
  const parts = new Map<string, string>()
  for (const part of value.split(',')) {
    const [key, ...rest] = part.trim().split('=')
    if (key && rest.length > 0) parts.set(key, rest.join('='))
  }
  return { timestamp: parts.get('t') || '', testSignature: parts.get('te') || '', liveSignature: parts.get('li') || '' }
}

export function verifyPayMongoSignature(rawBody: string, header: string, secret: string, mode: 'test' | 'live', now = Date.now()) {
  const { timestamp, testSignature, liveSignature } = parseSignatureHeader(header)
  const timestampSeconds = Number(timestamp)
  if (!timestamp || !Number.isFinite(timestampSeconds)) return false
  if (Math.abs(now - timestampSeconds * 1000) > 5 * 60 * 1000) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const received = mode === 'test' ? testSignature : liveSignature
  if (!/^[a-f0-9]+$/i.test(received) || received.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
}

export type ParsedPaidCheckout = {
  eventId: string
  eventType: string
  livemode: boolean
  checkoutSessionId: string
  paymentId: string
  amountCentavos: number
  currency: string
  method: string
  paidAt: string
}

export function parsePaidCheckoutEvent(event: any): ParsedPaidCheckout | null {
  const eventAttributes = event?.data?.attributes ?? {}
  const session = eventAttributes.data ?? {}
  const sessionAttributes = session.attributes ?? {}
  const payments = Array.isArray(sessionAttributes.payments) ? sessionAttributes.payments : []
  const paidPayment = payments.find((payment: any) => payment?.attributes?.status === 'paid')
  if (!paidPayment) return null
  const paymentAttributes = paidPayment.attributes ?? {}
  const method = paymentAttributes.source?.type
    || paymentAttributes.payment_method_details?.type
    || paymentAttributes.payment_method?.type
    || 'unknown'
  return {
    eventId: String(event?.data?.id || ''),
    eventType: String(eventAttributes.type || ''),
    livemode: Boolean(eventAttributes.livemode),
    checkoutSessionId: String(session?.id || ''),
    paymentId: String(paidPayment.id || ''),
    amountCentavos: Number(paymentAttributes.amount),
    currency: String(paymentAttributes.currency || '').toUpperCase(),
    method: String(method),
    paidAt: String(paymentAttributes.paid_at || eventAttributes.created_at || new Date().toISOString()),
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
}

function auditPayload(eventId: string, eventType: string, details: Record<string, unknown>) {
  return { actor_id: null, actor_email: null, action: `paymongo.${eventType}`, entity: 'payment_event', entity_id: eventId, details }
}

async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  try {
    const rawBody = await req.text()
    const mode = process.env.PAYMONGO_MODE === 'live' ? 'live' : 'test'
    const secret = getWebhookSecret()
    const signatureHeader = req.headers.get('paymongo-signature') || req.headers.get('Paymongo-Signature') || ''
    if (!secret) return fail('Webhook is not configured', 503)
    if (!signatureHeader || !verifyPayMongoSignature(rawBody, signatureHeader, secret, mode)) return fail('Invalid webhook signature', 401)

    let event: any
    try { event = JSON.parse(rawBody) } catch { return fail('Invalid webhook body', 400) }
    const eventId = String(event?.data?.id || '')
    const attributes = event?.data?.attributes ?? {}
    const eventType = String(attributes.type || '')
    if (!eventId || !ALLOWED_EVENTS.has(eventType)) return json({ ok: true, ignored: true }, 200)
    if (Boolean(attributes.livemode) !== (mode === 'live')) return fail('Webhook environment mismatch', 400)

    const client = createSupabaseServerClient()
    if (eventType === 'checkout_session.payment.paid') {
      const parsed = parsePaidCheckoutEvent(event)
      if (!parsed || parsed.eventId !== eventId || !parsed.checkoutSessionId || !parsed.paymentId || !Number.isSafeInteger(parsed.amountCentavos) || parsed.amountCentavos <= 0 || parsed.currency !== 'PHP') {
        await client.from('audit_log').insert(auditPayload(eventId, eventType, { reason: 'invalid_paid_payload' }))
        return fail('Invalid payment event payload', 400)
      }
      const { data: result, error } = await client.rpc('apply_checkout_paid', {
        p_event_id: parsed.eventId,
        p_event_type: parsed.eventType,
        p_livemode: parsed.livemode,
        p_payload: event,
        p_checkout_session_id: parsed.checkoutSessionId,
        p_payment_id: parsed.paymentId,
        p_amount_centavos: parsed.amountCentavos,
        p_method: parsed.method,
        p_paid_at: parsed.paidAt,
        p_channel: parsed.method === 'gcash' || parsed.method === 'paymaya' || parsed.method === 'qrph' || parsed.method === 'grab_pay' ? 'mobile_wallet' : 'bank',
      })
      if (error) throw error
      if (result === 'unknown_session') return json({ ok: true, retryable: true, result }, 202)
      return json({ ok: true, processed: true, result }, 200)
    }

    const { error: insertError } = await client.from('payment_events').insert({ provider_event_id: eventId, type: eventType, raw_payload: event, livemode: Boolean(attributes.livemode) })
    if (insertError && errorCode(insertError) !== '23505') throw insertError
    if (insertError && errorCode(insertError) === '23505') return json({ ok: true, replay: true }, 200)
    const nestedSessionId = String(attributes.data?.id || attributes.checkout_session_id || '')
    if (nestedSessionId) {
      await client.from('payment_attempts').update({ status: eventType === 'payment.failed' ? 'failed' : 'expired', updated_at: new Date().toISOString() }).eq('provider_checkout_session_id', nestedSessionId).eq('status', 'pending')
    }
    await client.from('payment_events').update({ processed_at: new Date().toISOString() }).eq('provider_event_id', eventId)
    return json({ ok: true, processed: true }, 200)
  } catch (error) {
    console.error('[paymongo-webhook]', error)
    return fail('Unable to process webhook', 500)
  }
}

export default { fetch: handler }
