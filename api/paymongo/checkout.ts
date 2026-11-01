import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { fail, json } from '../_lib/core.ts'
import { PAYMONGO_API_BASE, PAYMONGO_PAYMENT_METHODS } from '../_lib/paymongo.ts'

const PAYABLE_STATUSES = new Set(['unpaid', 'overdue', 'pending', 'failed', 'expired'])
const ATTEMPT_TTL_MS = 30 * 60 * 1000
const IN_FLIGHT_MS = 60 * 1000

async function markAttemptFailed(client: SupabaseClient, attemptId: number) {
  const { error } = await client
    .from('payment_attempts')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', attemptId)
  if (error) console.error('[paymongo-checkout] could not mark attempt failed', error)
}

async function readActivePendingAttempt(client: SupabaseClient, billId: number) {
  const { data, error } = await client
    .from('payment_attempts')
    .select('id, provider_checkout_session_id, checkout_url, created_at')
    .eq('bill_id', billId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export default {
  async fetch(req: Request) {
    if (req.method !== 'POST') return fail('Method not allowed', 405)

    const SUPABASE_URL = process.env.SUPABASE_URL
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    const PAYMONGO_KEY = process.env.PAYMONGO_SECRET_KEY
    const SITE_URL = process.env.SITE_URL
    if (!SUPABASE_URL || !SERVICE_KEY || !PAYMONGO_KEY || !SITE_URL) {
      console.error('[paymongo-checkout] missing env', {
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!SERVICE_KEY,
        PAYMONGO_SECRET_KEY: !!PAYMONGO_KEY,
        SITE_URL: !!SITE_URL,
      })
      return fail('Payments are temporarily unavailable', 503)
    }
    const siteUrl = SITE_URL.replace(/\/+$/, '')
    const successUrl = `${siteUrl}/dashboard/#my-bills?pay=success`
    const cancelUrl = `${siteUrl}/dashboard/#my-bills?pay=cancelled`

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return fail('Not authenticated', 401)

    const client: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await client.auth.getUser(token)
    if (authError || !auth.user) return fail('Invalid session', 401)
    const userId = auth.user.id

    let body: any = null
    try {
      body = await req.json()
    } catch {
      return fail('Invalid JSON body', 400)
    }
    const billId = Number(body?.bill_id)
    if (!Number.isSafeInteger(billId) || billId <= 0) return fail('Invalid bill', 400)

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id, account_no')
      .eq('id', userId)
      .maybeSingle()
    if (profileError) {
      console.error('[paymongo-checkout] profile lookup failed', profileError)
      return fail('Could not load profile', 500)
    }
    if (!profile) return fail('Profile not found', 404)
    const linkedNo = typeof profile.account_no === 'string' ? profile.account_no.trim() : ''
    if (!linkedNo) return fail('No linked account number found', 400)

    const { data: bill, error: billError } = await client
      .from('bills')
      .select('id, account_no, amount, amount_centavos, status, period')
      .eq('id', billId)
      .eq('account_no', linkedNo)
      .maybeSingle()
    if (billError) {
      console.error('[paymongo-checkout] bill lookup failed', billError)
      return fail('Could not load bill', 500)
    }
    if (!bill) return fail('Bill not found', 404)
    if (!PAYABLE_STATUSES.has(String(bill.status))) return fail('Bill is not payable', 409)

    const amountCentavos = Number(bill.amount_centavos ?? Math.round(Number(bill.amount) * 100))
    if (!Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) {
      return fail('Bill amount is invalid', 500)
    }

    const respond = (checkoutUrl: string, checkoutId: string | null) =>
      json({
        ok: true,
        checkout_url: checkoutUrl,
        checkout_id: checkoutId,
        bill_id: bill.id,
        amount: amountCentavos / 100,
        currency: 'PHP',
        success_url: successUrl,
        cancel_url: cancelUrl,
      })

    const nowIso = new Date().toISOString()
    const { error: staleError } = await client
      .from('payment_attempts')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('bill_id', bill.id)
      .eq('status', 'pending')
      .lte('expires_at', nowIso)
    if (staleError) {
      console.error('[paymongo-checkout] expiring stale attempts failed', staleError)
      return fail('Could not start payment', 500)
    }

    let pending: any = null
    try {
      pending = await readActivePendingAttempt(client, bill.id)
    } catch (error) {
      console.error('[paymongo-checkout] pending-attempt lookup failed', error)
      return fail('Could not start payment', 500)
    }
    if (pending) {
      if (pending.checkout_url) {
        return respond(pending.checkout_url, pending.provider_checkout_session_id)
      }
      const ageMs = Date.now() - new Date(pending.created_at).getTime()
      if (ageMs < IN_FLIGHT_MS) {
        return fail('A payment is already being prepared. Try again in a few seconds.', 409)
      }
      await markAttemptFailed(client, pending.id) // true orphan
    }

    const { data: attempt, error: insertError } = await client
      .from('payment_attempts')
      .insert({
        bill_id: bill.id,
        user_id: userId,
        amount_centavos: amountCentavos,
        currency: 'PHP',
        status: 'pending',
        idempotency_key: randomUUID(),
        provider_checkout_session_id: null,
        expires_at: new Date(Date.now() + ATTEMPT_TTL_MS).toISOString(),
      })
      .select('id')
      .single()
    if (insertError || !attempt) {
      if (insertError?.code === '23505') {
        return fail('A payment is already in progress for this bill. Try again shortly.', 409)
      }
      console.error('[paymongo-checkout] insert payment_attempts failed', insertError)
      return fail('Could not create payment attempt', 500)
    }

    let created: any
    try {
      const res = await fetch(`${PAYMONGO_API_BASE}/checkout_sessions`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${PAYMONGO_KEY}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [
                { name: `TAWELCO bill ${bill.period}`, amount: amountCentavos, currency: 'PHP', quantity: 1 },
              ],
              payment_method_types: [...PAYMONGO_PAYMENT_METHODS],
              success_url: successUrl,
              cancel_url: cancelUrl,
              reference_number: `BILL-${bill.id}-${bill.period}`,
              metadata: {
                bill_id: String(bill.id),
                attempt_id: String(attempt.id),
                user_id: userId,
                period: bill.period,
              },
            },
          },
        }),
      })
      const raw = await res.text()
      if (!res.ok) throw new Error(`PayMongo ${res.status}: ${raw.slice(0, 500)}`)
      created = JSON.parse(raw)
    } catch (error) {
      console.error('[paymongo-checkout] create session failed', error)
      await markAttemptFailed(client, attempt.id)
      return fail('Unable to create checkout session', 502)
    }

    const checkoutId: string | null = created?.data?.id ?? null
    const checkoutUrl: string | null = created?.data?.attributes?.checkout_url ?? null
    if (!checkoutId || !checkoutUrl) {
      console.error('[paymongo-checkout] response missing id or url', created)
      await markAttemptFailed(client, attempt.id)
      return fail('Unable to create checkout session', 502)
    }

    const { error: saveError } = await client
      .from('payment_attempts')
      .update({
        provider_checkout_session_id: checkoutId,
        checkout_url: checkoutUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attempt.id)
    if (saveError) {
      console.error('[paymongo-checkout] saving session failed', saveError)
      await markAttemptFailed(client, attempt.id)
      return fail('Could not save checkout session', 500)
    }

    return respond(checkoutUrl, checkoutId)
  },
}
