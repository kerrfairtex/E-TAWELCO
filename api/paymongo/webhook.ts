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

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
}

function auditPayload(eventId: string, eventType: string, details: Record<string, unknown>) {
  return { action: `paymongo.${eventType}`, entity: 'payment_event', entity_id: eventId, actor_email: 'paymongo-webhook', details }
}

async function handle(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  try {
    const rawBody = await req.text()
    const signatureHeader = req.headers.get('paymongo-signature') || req.headers.get('Paymongo-Signature') || ''
    const mode = process.env.PAYMONGO_MODE === 'live' ? 'live' : 'test'
    const secret = getWebhookSecret()
    if (!secret) return fail('Webhook is not configured', 503)
    if (!signatureHeader || !verifyPayMongoSignature(rawBody, signatureHeader, secret, mode)) return fail('Invalid webhook signature', 401)

    let event: any
    try { event = JSON.parse(rawBody) } catch { return fail('Invalid webhook body', 400) }

    const eventId = String(event?.data?.id || event?.id || '')
    const eventType = String(event?.data?.attributes?.type || event?.type || '')
    if (!eventId || !eventType || !ALLOWED_EVENTS.has(eventType)) return json({ ok: true, ignored: true }, 200)

    const client = createSupabaseServerClient()
    const livemode = Boolean(event?.data?.attributes?.livemode ?? event?.livemode ?? mode === 'live')
    const { error: eventError } = await client.from('payment_events').insert({
      provider_event_id: eventId,
      type: eventType,
      raw_payload: event,
      livemode,
    })
    if (eventError) {
      if (errorCode(eventError) !== '23505') throw eventError
      const { data: existing, error: lookupError } = await client.from('payment_events').select('processed_at').eq('provider_event_id', eventId).maybeSingle()
      if (lookupError) throw lookupError
      if (existing?.processed_at) return json({ ok: true, replay: true }, 200)
    }

    const attributes = event?.data?.attributes || {}
    const resource = attributes.data || {}
    const resourceAttrs = resource.attributes || {}
    const firstPayment = Array.isArray(resourceAttrs.payments) ? resourceAttrs.payments[0] : null
    const paymentAttrs = firstPayment?.attributes || {}
    const checkoutSessionId = String(
      (typeof resource.id === 'string' && resource.id.startsWith('cs_') ? resource.id : '') ||
      attributes.checkout_session_id || attributes.checkout_session?.id || attributes.metadata?.checkout_session_id || '')
        const paymentId = String(firstPayment?.id || attributes.payment_id || attributes.payment?.id || event?.data?.id || '')
        const amountCentavos = Number(paymentAttrs.amount ?? attributes.amount ?? attributes.payment?.amount ?? 0)
    const currency = String(attributes.currency || attributes.payment?.currency || 'PHP').toUpperCase()
        const method = String(paymentAttrs.source?.type || attributes.payment_method_type || attributes.method || 'unknown')
        const rawPaidAt = paymentAttrs.paid_at ?? attributes.paid_at ?? attributes.updated_at
    const paidAt = typeof rawPaidAt === 'number' ? new Date(rawPaidAt * 1000).toISOString() : (rawPaidAt || new Date().toISOString())

    const { data: attempt, error: attemptError } = await client
      .from('payment_attempts')
      .select('id,bill_id,provider_checkout_session_id,amount_centavos,currency')
      .eq('provider_checkout_session_id', checkoutSessionId)
      .maybeSingle()
    if (attemptError) throw attemptError
    if (!attempt) {
      const { error: auditError } = await client.from('audit_log').insert(auditPayload(eventId, eventType, { reason: 'attempt_not_found' }))
      if (auditError) throw auditError
      return json({ ok: true, ignored: true }, 200)
    }

    const { data: bill, error: billError } = await client.from('bills').select('id,amount_centavos,amount,status').eq('id', attempt.bill_id).single()
    if (billError) throw billError

    if (eventType.endsWith('.paid')) {
            const expectedAmount = Number(attempt.amount_centavos ?? bill.amount_centavos ?? Math.round(Number(bill.amount) * 100))
      if (amountCentavos !== expectedAmount || currency !== 'PHP' || currency !== String(attempt.currency).toUpperCase()) {
        const { error: auditError } = await client.from('audit_log').insert(auditPayload(eventId, eventType, { reason: 'amount_or_currency_mismatch', attempt_id: attempt.id, expected_amount_centavos: expectedAmount, received_amount_centavos: amountCentavos, received_currency: currency }))
        if (auditError) throw auditError
        return json({ ok: true, flagged: true }, 200)
      }

      const { data: rpcResult, error: rpcError } = await client.rpc('apply_checkout_paid', {
        p_event_id: eventId,
        p_event_type: eventType,
        p_livemode: livemode,
        p_payload: event,
        p_checkout_session_id: checkoutSessionId,
        p_payment_id: paymentId,
        p_amount_centavos: amountCentavos,
        p_method: method,
        p_paid_at: paidAt,
        p_channel: 'paymongo',
      })
      if (rpcError) throw rpcError
      if (rpcResult !== 'paid' && rpcResult !== 'duplicate') {
        const { error: flagError } = await client.from('audit_log').insert(auditPayload(eventId, eventType, { reason: `apply_checkout_paid:${rpcResult}`, attempt_id: attempt.id, payment_id: paymentId, amount_centavos: amountCentavos }))
        if (flagError) throw flagError
        return json({ ok: true, flagged: true, result: rpcResult }, 200)
      }
    } else {
      const nextStatus = eventType.endsWith('failed') ? 'failed' : 'expired'
      const { error: updateError } = await client.from('payment_attempts').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', attempt.id)
      if (updateError) throw updateError
    }

    const { error: processedError } = await client.from('payment_events').update({ processed_at: new Date().toISOString() }).eq('provider_event_id', eventId)
    if (processedError) throw processedError
    const { error: auditError } = await client.from('audit_log').insert(auditPayload(eventId, eventType, { attempt_id: attempt.id, payment_id: paymentId }))
    if (auditError) throw auditError

    return json({ ok: true, processed: true }, 200)
  } catch (error) {
    console.error('[paymongo-webhook]', error)
    return fail('Unable to process webhook', 500)
  }
}

export default { fetch: handle }
