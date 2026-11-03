import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type PayMongoCheckoutStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded'

export const PAYMONGO_API_BASE = 'https://api.paymongo.com/v2'

export function paymongoHeaders(secretKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export function getPayMongoSecret() {
  return process.env.PAYMONGO_SECRET_KEY || ''
}

export function getWebhookSecret() {
  return process.env.PAYMONGO_WEBHOOK_SECRET || ''
}

export function isLiveAvailable() {
  return Boolean(
    process.env.PAYMONGO_SECRET_KEY &&
      process.env.PAYMONGO_PUBLIC_KEY &&
      process.env.PAYMONGO_WEBHOOK_SECRET,
  )
}

export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) throw new Error('Supabase server configuration is missing')

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function createCheckoutSession(payload: Record<string, unknown>) {
  const secretKey = getPayMongoSecret()
  if (!secretKey) throw new Error('PayMongo server configuration is missing')

  const response = await fetch(`${PAYMONGO_API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: paymongoHeaders(secretKey),
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  if (!response.ok) {
    console.error('[paymongo] checkout request failed', {
      status: response.status,
      response: text.slice(0, 500),
    })
    throw new Error('PayMongo checkout request failed')
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('PayMongo returned an invalid response')
  }
}
