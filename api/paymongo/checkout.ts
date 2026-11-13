import crypto from 'node:crypto'
import { fail, json } from '../_lib/core.ts'
import {
  createCheckoutSession,
  createSupabaseServerClient,
  isLiveAvailable,
  retrieveCheckoutSession,
} from '../_lib/paymongo.ts'

export const PAYMENT_METHOD_TYPES = ['card', 'gcash', 'paymaya', 'grab_pay', 'qrph'] as const

export function parseCheckoutSession(data: any) {
  const session = data?.data ?? data
  const attributes = session?.attributes ?? {}
  return {
    id: session?.id ?? data?.id ?? null,
    url: attributes.checkout_url ?? attributes.url ?? data?.checkout_url ?? null,
    status: attributes.status ?? data?.status ?? null,
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23505'
}

function providerStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : null
}

async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  if (!isLiveAvailable()) return fail('PayMongo is not configured', 503)

  try {
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return fail('Not authenticated', 401)

    const client = createSupabaseServerClient()
    const { data: auth, error: authError } = await client.auth.getUser(token)
    if (authError || !auth.user) return fail('Invalid session', 401)

    const body = await req.json().catch(() => ({}))
    const billId = Number(body.bill_id)
    if (!Number.isInteger(billId) || billId <= 0) return fail('Invalid bill', 400)

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('account_no, full_name, email')
      .eq('id', auth.user.id)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile) return fail('Profile not found', 404)

    const linkedNo = typeof profile.account_no === 'string' ? profile.account_no.trim() : ''
    if (!linkedNo) return fail('No linked account number found', 400)

    const { data: bill, error: billError } = await client
      .from('bills')
      .select('id, account_no, amount, amount_centavos, status, due_date, period')
      .eq('id', billId)
      .eq('account_no', linkedNo)
      .maybeSingle()
    if (billError) throw billError
    if (!bill) return fail('Bill not found', 404)
    if (bill.status !== 'unpaid') return fail('Bill is already paid', 409)

    const billAmountCentavos = Number(
      bill.amount_centavos ?? Math.round(Number(bill.amount) * 100),
    )
    if (!Number.isSafeInteger(billAmountCentavos) || billAmountCentavos <= 0) {
      throw new Error('Bill amount is invalid')
    }

  const siteUrl = String(process.env.SITE_URL || '').replace(/\/$/, '')
  if (!/^https:\/\//i.test(siteUrl)) return fail('Payment return URL is not configured', 503)

  const expiresAt = () => new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const findPendingAttempt = async () => {
    const { data, error } = await client
      .from('payment_attempts')
      .select('id,status,amount_centavos,idempotency_key,provider_checkout_session_id,checkout_url,expires_at')
      .eq('bill_id', bill.id)
      .eq('user_id', auth.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  }

  const updateAttempt = async (attemptId: number, values: Record<string, unknown>) => {
    const { error } = await client
      .from('payment_attempts')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', attemptId)
      .eq('status', 'pending')
    if (error) throw error
  }

  const expireAttempt = async (attemptId: number) => {
    await updateAttempt(attemptId, { status: 'expired' })
  }

  const sessionPayload = (attemptId: number) => ({
    data: {
      attributes: {
        line_items: [{
          name: `TAWELCO bill ${bill.period}`,
          amount: billAmountCentavos,
          currency: 'PHP',
          quantity: 1,
        }],
        payment_method_types: PAYMENT_METHOD_TYPES,
        success_url: `${siteUrl}/dashboard/?pay=success&bill_id=${bill.id}#my-bills`,
        cancel_url: `${siteUrl}/dashboard/?pay=cancelled&bill_id=${bill.id}#my-bills`,
        reference_number: `BILL-${bill.id}-${bill.period}`,
        send_email_receipt: false,
        metadata: {
          bill_id: String(bill.id),
          attempt_id: String(attemptId),
          user_id: auth.user.id,
          period: bill.period,
        },
      },
    },
  })

  const resolvePendingAttempt = async (attempt: any) => {
    if (Number(attempt.amount_centavos) !== billAmountCentavos) {
      await expireAttempt(attempt.id)
      return null
    }

    let session: any
    if (attempt.provider_checkout_session_id) {
      try {
        session = await retrieveCheckoutSession(attempt.provider_checkout_session_id)
      } catch (error) {
        if (providerStatus(error) === 404) {
          await expireAttempt(attempt.id)
          return null
        }
        if (attempt.checkout_url) {
          console.warn('[paymongo-checkout] using saved checkout URL after session lookup failed', {
            attemptId: attempt.id,
            status: providerStatus(error),
          })
          return {
            id: attempt.provider_checkout_session_id,
            url: attempt.checkout_url,
            attemptId: attempt.id,
          }
        }
        throw error
      }

      const details = parseCheckoutSession(session)
      if (details.status === 'expired') {
        await expireAttempt(attempt.id)
        return null
      }
      if (details.status !== 'active') {
        const error = new Error('The existing PayMongo checkout session is not active') as Error & { status?: number }
        error.status = 409
        throw error
      }
      if (!details.url) throw new Error('PayMongo did not return a checkout URL for the active session')

      await updateAttempt(attempt.id, {
        checkout_url: details.url,
        expires_at: expiresAt(),
      })
      return { id: details.id || attempt.provider_checkout_session_id, url: details.url, attemptId: attempt.id }
    }

    session = await createCheckoutSession(sessionPayload(attempt.id), attempt.idempotency_key)
    const details = parseCheckoutSession(session)
    if (!details.id || !details.url) throw new Error('PayMongo response did not include checkout details')

    await updateAttempt(attempt.id, {
      provider_checkout_session_id: details.id,
      checkout_url: details.url,
      expires_at: expiresAt(),
    })
    return { id: details.id, url: details.url, attemptId: attempt.id }
  }

  let attempt = await findPendingAttempt()
  if (attempt) {
    const existingCheckout = await resolvePendingAttempt(attempt)
    if (existingCheckout) {
      return json({ ok: true, checkout_url: existingCheckout.url, checkout_id: existingCheckout.id, attempt_id: existingCheckout.attemptId, bill_id: bill.id, amount: billAmountCentavos / 100, currency: 'PHP' })
    }
  }

  const idempotencyKey = `bill-${bill.id}-${auth.user.id}-${crypto.randomUUID()}`
  const { data: insertedAttempt, error: attemptError } = await client
    .from('payment_attempts')
    .insert({
      bill_id: bill.id,
      user_id: auth.user.id,
      amount_centavos: billAmountCentavos,
      currency: 'PHP',
      status: 'pending',
      idempotency_key: idempotencyKey,
      expires_at: expiresAt(),
    })
    .select('id,status,amount_centavos,idempotency_key,provider_checkout_session_id,checkout_url,expires_at')
    .single()

  if (attemptError) {
    if (!isUniqueViolation(attemptError)) throw attemptError
    attempt = await findPendingAttempt()
    if (!attempt) {
      const error = new Error('Another checkout is being prepared. Please try again shortly.') as Error & { status?: number }
      error.status = 409
      throw error
    }
    const racedCheckout = await resolvePendingAttempt(attempt)
    if (!racedCheckout) {
      const error = new Error('Another checkout is being prepared. Please try again shortly.') as Error & { status?: number }
      error.status = 409
      throw error
    }
    return json({ ok: true, checkout_url: racedCheckout.url, checkout_id: racedCheckout.id, attempt_id: racedCheckout.attemptId, bill_id: bill.id, amount: billAmountCentavos / 100, currency: 'PHP' })
  }

  attempt = insertedAttempt
  let checkout
  try {
    checkout = await resolvePendingAttempt(attempt)
  } catch (error) {
    const status = providerStatus(error)
    if (status !== null && status >= 400 && status < 500 && status !== 429) {
      await updateAttempt(attempt.id, { status: 'failed' })
      await client.from('audit_log').insert({ actor_id: auth.user.id, actor_email: profile.email ?? null, action: 'payment.checkout_failed', entity: 'payment_attempt', entity_id: String(attempt.id), details: { bill_id: bill.id, reason: 'provider_rejection', provider_status: status } })
    }
    throw error
  }
  if (!checkout) throw new Error('PayMongo returned an expired checkout session')

  return json({
    ok: true,
    checkout_url: checkout.url,
    checkout_id: checkout.id,
    attempt_id: checkout.attemptId,
    bill_id: bill.id,
    amount: billAmountCentavos / 100,
    currency: 'PHP',
  })
  } catch (error) {
    console.error('[paymongo-checkout]', error)
    const status = providerStatus(error)
    if (status === 409) return fail('A checkout is already active or being prepared. Please try again shortly.', 409)
    if (status !== null) return fail('PayMongo could not confirm the checkout. Please try again shortly.', status >= 500 || status === 429 ? 503 : 502)
    return fail('Unable to create checkout session. Please try again shortly.', 500)
  }
}

export default { fetch: handler }
