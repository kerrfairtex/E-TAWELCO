import crypto from 'node:crypto'
import { fail, json } from '../_lib/core.ts'
import {
  createCheckoutSession,
  createSupabaseServerClient,
  isLiveAvailable,
} from '../_lib/paymongo.ts'

export const PAYMENT_METHOD_TYPES = ['card', 'gcash', 'paymaya', 'grab_pay', 'qrph'] as const

export default async function handler(req: Request) {
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

    const now = new Date().toISOString()
    const { data: existingAttempt, error: existingAttemptError } = await client
      .from('payment_attempts')
      .select('id,status,provider_checkout_session_id,expires_at')
      .eq('bill_id', bill.id)
      .eq('user_id', auth.user.id)
      .eq('status', 'pending')
      .gt('expires_at', now)
      .maybeSingle()
    if (existingAttemptError) throw existingAttemptError
    if (existingAttempt) return fail('A payment session is already in progress for this bill. Please finish it or try again shortly.', 409)

    const idempotencyKey = `bill-${bill.id}-${auth.user.id}-${crypto.randomUUID()}`
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const { data: attempt, error: attemptError } = await client
      .from('payment_attempts')
      .insert({
        bill_id: bill.id,
        user_id: auth.user.id,
        amount_centavos: billAmountCentavos,
        currency: 'PHP',
        status: 'pending',
        idempotency_key: idempotencyKey,
        expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (attemptError) throw attemptError

    const siteUrl = String(process.env.SITE_URL || '').replace(/\/$/, '')
    if (!/^https:\/\//i.test(siteUrl)) return fail('Payment return URL is not configured', 503)

    const sessionPayload = {
      data: {
        attributes: {
          line_items: [{
            name: `TAWELCO bill ${bill.period}`,
            amount: billAmountCentavos,
            currency: 'PHP',
            quantity: 1,
          }],
          payment_method_types: PAYMENT_METHOD_TYPES,
          success_url: `${siteUrl}/dashboard/#my-bills?pay=success`,
          cancel_url: `${siteUrl}/dashboard/#my-bills?pay=cancelled`,
          reference_number: `BILL-${bill.id}-${bill.period}`,
          send_email_receipt: false,
          metadata: {
            bill_id: String(bill.id),
            attempt_id: String(attempt.id),
            user_id: auth.user.id,
            period: bill.period,
          },
        },
      },
    }

    let data: any
    try {
      data = await createCheckoutSession(sessionPayload, idempotencyKey)
    } catch (error) {
      await client.from('payment_attempts').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', attempt.id)
      await client.from('audit_log').insert({ actor_id: auth.user.id, actor_email: profile.email ?? null, action: 'payment.checkout_failed', entity: 'payment_attempt', entity_id: String(attempt.id), details: { bill_id: bill.id, reason: 'provider_rejection' } })
      throw error
    }
    const checkoutUrl = data?.data?.attributes?.checkout_url || data?.checkout_url || data?.data?.attributes?.url || null
    const checkoutId = data?.data?.id || data?.id || null
    if (!checkoutUrl || !checkoutId) {
      await client.from('payment_attempts').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', attempt.id)
      throw new Error('PayMongo response did not include checkout details')
    }

    const { error: attemptUpdateError } = await client
      .from('payment_attempts')
      .update({ provider_checkout_session_id: checkoutId, updated_at: new Date().toISOString() })
      .eq('id', attempt.id)
    if (attemptUpdateError) throw attemptUpdateError

    return json({
      ok: true,
      checkout_url: checkoutUrl,
      checkout_id: checkoutId,
      attempt_id: attempt.id,
      bill_id: bill.id,
      amount: billAmountCentavos / 100,
      currency: 'PHP',
    })
  } catch (error) {
    console.error('[paymongo-checkout]', error)
    return fail('Unable to create checkout session', 500)
  }
}
