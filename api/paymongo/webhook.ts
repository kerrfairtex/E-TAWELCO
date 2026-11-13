import crypto from 'node:crypto'
import { fail, json } from '../_lib/core.ts'
import { createSupabaseServerClient, getWebhookSecret } from '../_lib/paymongo.ts'

export const ALLOWED_EVENTS = new Set([
  'checkout_session.payment.paid',
  'payment.paid',
  'payment.failed',
  'payment.expired',
])

export function shouldIgnorePayMongoEvent(eventType: string, livemode: boolean, mode: 'test' | 'live') {
  return !ALLOWED_EVENTS.has(eventType) || livemode !== (mode === 'live')
}

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

function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value * 1000)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'string') {
    const text = value.trim()
    const d = /^\d+(\.\d+)?$/.test(text) ? new Date(Number(text) * 1000) : new Date(text)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

export function parsePaidCheckoutEvent(event: any): ParsedPaidCheckout | null {
  const eventAttributes = event?.data?.attributes ?? {}
  const session = eventAttributes.data ?? {}
  const sessionAttributes = session.attributes ?? {}
  const payments = Array.isArray(sessionAttributes.payments) ? sessionAttributes.payments : []
  const paidPayment = payments.find((payment: any) => String(payment?.attributes?.status || '').trim().toLowerCase() === 'paid')
  if (!paidPayment) return null

  const paymentAttributes = paidPayment.attributes ?? {}
  const lineItems = Array.isArray(sessionAttributes.line_items) ? sessionAttributes.line_items : []
  const validLineItems = lineItems.length > 0 && lineItems.every((item: any) => {
    const amount = Number(item?.amount)
    const quantity = Number(item?.quantity ?? 1)
    return Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(quantity) && quantity > 0
  })
  const lineItemTotal = validLineItems
    ? lineItems.reduce((total: number, item: any) => total + Number(item.amount) * Number(item.quantity ?? 1), 0)
    : Number.NaN
  const lineItemCurrencies = new Set(lineItems.map((item: any) => String(item?.currency || '').trim().toUpperCase()).filter(Boolean))
  const fallbackAmount = Number.isSafeInteger(lineItemTotal) ? lineItemTotal : Number.NaN
  const amountValue = paymentAttributes.amount ?? sessionAttributes.amount
  const amountCentavos = amountValue == null ? fallbackAmount : Number(amountValue)
  const currencyValue = paymentAttributes.currency ?? sessionAttributes.currency
  const everyLineItemHasCurrency = lineItems.every((item: any) => String(item?.currency || '').trim().length > 0)
  const fallbackCurrency = lineItemCurrencies.size === 1 && everyLineItemHasCurrency ? [...lineItemCurrencies][0] : ''
  const currency = String(currencyValue ?? fallbackCurrency).trim().toUpperCase()
  const method = paymentAttributes.source?.type
    || paymentAttributes.payment_method_details?.type
    || paymentAttributes.payment_method?.type
    || sessionAttributes.payment_method_used
    || 'unknown'
  const paidAt = toIso(paymentAttributes.paid_at ?? sessionAttributes.paid_at ?? eventAttributes.created_at)
  if (!paidAt) return null

  return {
    eventId: String(event?.data?.id || '').trim(),
    eventType: String(eventAttributes.type || '').trim(),
    livemode: Boolean(eventAttributes.livemode),
    checkoutSessionId: String(session?.id || '').trim(),
    paymentId: String(paidPayment.id || '').trim(),
    amountCentavos,
    currency,
    method: String(method).trim().toLowerCase(),
    paidAt,
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
}

export function shouldReconcileDuplicate(
  result: unknown,
  attemptStatus: unknown,
  billStatus: unknown,
  paymentExists: boolean,
) {
  return result === 'duplicate'
    && attemptStatus === 'pending'
    && (billStatus === 'unpaid' || billStatus === 'overdue')
    && !paymentExists
}

function auditPayload(eventId: string, eventType: string, details: Record<string, unknown>) {
  return { actor_id: null, actor_email: null, action: `paymongo.${eventType}`, entity: 'payment_event', entity_id: eventId, details }
}

async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  try {
    const rawBody = await req.text()
    let event: any
    try { event = JSON.parse(rawBody) } catch { return fail('Invalid webhook body', 400) }

    const mode = process.env.PAYMONGO_MODE === 'live' ? 'live' : 'test'
    const eventId = String(event?.data?.id || '').trim()
    const attributes = event?.data?.attributes ?? {}
    const eventType = String(attributes.type || '').trim()
    const livemode = Boolean(attributes.livemode)
    console.log('[paymongo-webhook] received', { eventId, eventType, livemode })

    if (!eventId || shouldIgnorePayMongoEvent(eventType, livemode, mode)) {
      console.log('[paymongo-webhook] acknowledged unrelated event', { eventId, eventType, livemode, mode })
      return json({ ok: true, ignored: true }, 200)
    }

    const secret = getWebhookSecret()
    const signatureHeader = req.headers.get('paymongo-signature') || req.headers.get('Paymongo-Signature') || ''
    if (!secret) return fail('Webhook is not configured', 503)
    if (!signatureHeader || !verifyPayMongoSignature(rawBody, signatureHeader, secret, mode)) {
      console.error('[paymongo-webhook] invalid signature', { hasHeader: Boolean(signatureHeader), mode })
      return fail('Invalid webhook signature', 401)
    }

    const client = createSupabaseServerClient()
    if (eventType === 'checkout_session.payment.paid') {
      const parsed = parsePaidCheckoutEvent(event)
      if (!parsed || parsed.eventId !== eventId || !parsed.checkoutSessionId || !parsed.paymentId || !Number.isSafeInteger(parsed.amountCentavos) || parsed.amountCentavos <= 0 || parsed.currency !== 'PHP') {
        await client.from('audit_log').insert(auditPayload(eventId, eventType, { reason: 'invalid_paid_payload' }))
        console.error('[paymongo-webhook] invalid paid payload', { eventId, eventType })
        return fail('Invalid payment event payload', 400)
      }
    const paymentArgs = {
      p_event_type: parsed.eventType,
      p_livemode: parsed.livemode,
      p_payload: event,
      p_checkout_session_id: parsed.checkoutSessionId,
      p_payment_id: parsed.paymentId,
      p_amount_centavos: parsed.amountCentavos,
      p_method: parsed.method,
      p_paid_at: parsed.paidAt,
      p_channel: parsed.method === 'gcash' || parsed.method === 'paymaya' || parsed.method === 'qrph' || parsed.method === 'grab_pay' ? 'mobile_wallet' : 'bank',
    }
    const { data: result, error } = await client.rpc('apply_checkout_paid', {
      p_event_id: parsed.eventId,
      ...paymentArgs,
    })
    console.log('[paymongo-webhook] apply_checkout_paid', { eventId, result, error: error ? { message: (error as any).message, code: (error as any).code } : null })
    if (error) throw error

    let finalResult = result
    if (result === 'duplicate') {
      const { data: attempt, error: attemptError } = await client
        .from('payment_attempts')
        .select('bill_id,status')
        .eq('provider_checkout_session_id', parsed.checkoutSessionId)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle()
      if (attemptError) throw attemptError

      if (attempt?.status === 'pending') {
        const [{ data: bill, error: billError }, { data: payment, error: paymentError }] = await Promise.all([
          client.from('bills').select('status').eq('id', attempt.bill_id).maybeSingle(),
          client.from('payments').select('id').eq('paymongo_reference', parsed.paymentId).maybeSingle(),
        ])
        if (billError) throw billError
        if (paymentError) throw paymentError

        if (shouldReconcileDuplicate(result, attempt.status, bill?.status, Boolean(payment))) {
          const { data: recoveredResult, error: recoveryError } = await client.rpc('apply_checkout_paid', {
            p_event_id: `reconcile-${parsed.eventId}`,
            ...paymentArgs,
          })
          console.log('[paymongo-webhook] reconciled previously acknowledged event', {
            eventId,
            result: recoveredResult,
            error: recoveryError ? { message: (recoveryError as any).message, code: (recoveryError as any).code } : null,
          })
          if (recoveryError) throw recoveryError
          finalResult = recoveredResult
        }
      }
    }

    if (finalResult === 'unknown_session') console.error('[paymongo-webhook] unknown_session', { eventId })
    if (finalResult === 'unknown_session') return json({ ok: true, retryable: true, result: finalResult }, 202)
    return json({ ok: true, processed: true, result: finalResult }, 200)
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
