import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { fail, json } from '../_lib/core.ts'
import { createCheckoutSession, getPayMongoSecret, getWebhookSecret, isLiveAvailable } from '../_lib/paymongo.ts'

function amountInCentavos(value: number) {
  return Math.round(Number(value) * 100)
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  if (!isLiveAvailable()) {
    return fail('PayMongo is not configured for live checkout', 503)
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return fail('Not authenticated', 401)

  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: auth, error: authError } = await client.auth.getUser(token)
  if (authError || !auth.user) return fail('Invalid session', 401)

  const body = await req.json().catch(() => ({}))
  const billId = Number(body.bill_id)
  const amount = Number(body.amount)
  if (!Number.isFinite(billId) || billId <= 0) return fail('Invalid bill', 400)
  if (!Number.isFinite(amount) || amount <= 0) return fail('Invalid amount', 400)

  const { data: profile, error: profileError } = await client.from('profiles').select('account_no, full_name, email').eq('id', auth.user.id).maybeSingle()
  if (profileError || !profile) return fail('Profile not found', 404)

  const linkedNo = typeof profile.account_no === 'string' ? profile.account_no.trim() : ''
  if (!linkedNo) return fail('No linked account number found', 400)

  const { data: bill, error: billError } = await client.from('bills').select('id, account_no, amount, status, due_date, period').eq('id', String(billId)).eq('account_no', linkedNo).maybeSingle()
  if (billError || !bill) return fail('Bill not found', 404)
  if (bill.status !== 'unpaid') return fail('Bill is already paid', 409)

  const sessionPayload = {
    data: {
      attributes: {
        line_items: [{
          name: `TAWELCO bill ${bill.period}`,
          amount: amountInCentavos(amount),
          currency: 'PHP',
          quantity: 1,
        }],
        payment_method_types: ['card', 'gcash', 'qrph'],
        success_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/#my-bills?pay=success`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/#my-bills?pay=cancelled`,
        reference_number: `BILL-${bill.id}-${bill.period}`,
        send_email_receipt: false,
        metadata: {
          bill_id: String(bill.id),
          account_no: linkedNo,
          user_id: auth.user.id,
          period: bill.period,
        },
      },
    },
  }

  try {
    const data = await createCheckoutSession(sessionPayload)
    const checkoutUrl = data?.data?.attributes?.checkout_url || data?.checkout_url || data?.data?.attributes?.url || null
    const checkoutId = data?.data?.id || data?.id || null

    if (!checkoutUrl || !checkoutId) {
      throw new Error('PayMongo response did not include a checkout URL')
    }

    return json({
      ok: true,
      checkout_url: checkoutUrl,
      checkout_id: checkoutId,
      bill_id: bill.id,
      amount,
      currency: 'PHP',
      success_url: sessionPayload.data.attributes.success_url,
      cancel_url: sessionPayload.data.attributes.cancel_url,
    })
  } catch (error) {
    console.error('[paymongo-checkout]', error)
    return fail(error instanceof Error ? error.message : 'Unable to create checkout session', 500)
  }
}

export const config = { runtime: 'nodejs' }
