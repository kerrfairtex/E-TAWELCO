import type { Config } from '@netlify/functions'

export type PayMongoCheckoutStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded'

export const PAYMONGO_API_BASE = 'https://api.paymongo.com/v2'

export function paymongoHeaders(secretKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

export function getPayMongoSecret() {
  return process.env.PAYMONGO_SECRET_KEY || ''
}

export function getWebhookSecret() {
  return process.env.PAYMONGO_WEBHOOK_SECRET || ''
}

export function isLiveAvailable() {
  return !!process.env.PAYMONGO_SECRET_KEY && !!process.env.PAYMONGO_PUBLIC_KEY && !!process.env.PAYMONGO_WEBHOOK_SECRET
}

export async function createCheckoutSession(payload: Record<string, unknown>) {
  const secretKey = getPayMongoSecret()
  if (!secretKey) throw new Error('PAYMONGO_SECRET_KEY is not configured')

  const res = await fetch(`${PAYMONGO_API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: paymongoHeaders(secretKey),
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`PayMongo checkout creation failed: ${text.slice(0, 500)}`)
  }

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export const config: Config = { path: '/api/paymongo/checkout', method: 'POST' }
