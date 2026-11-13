import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function verifyPaymongoSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false
  const parts: Record<string, string> = {}
  for (const piece of header.split(',')) {
    const index = piece.indexOf('=')
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim()
  }
  if (!/^\d+$/.test(parts.t ?? '')) return false
  const timestamp = Number(parts.t)
  if (Math.abs(nowSec - (timestamp > 1e12 ? timestamp / 1000 : timestamp)) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest()
  return [parts.te, parts.li].filter(Boolean).some((candidate) => {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) return false
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), expected)
  })
}

export type PayMongoCheckoutStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded'

export const PAYMONGO_API_BASE = 'https://api.paymongo.com/v1'

export function paymongoHeaders(secretKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export function getPayMongoSecret() {
  return (process.env.PAYMONGO_SECRET_KEY || '').trim()
}

export function getWebhookSecret() {
  return (process.env.PAYMONGO_WEBHOOK_SECRET || '').trim()
}

export function isLiveAvailable() {
  const mode = process.env.PAYMONGO_MODE
  const sk = (process.env.PAYMONGO_SECRET_KEY || '').trim()
  const pk = process.env.PAYMONGO_PUBLIC_KEY || ''
  const match = (p: 'live' | 'test') => sk.startsWith(`sk_${p}_`) && pk.startsWith(`pk_${p}_`)
  return Boolean(
    process.env.PAYMONGO_WEBHOOK_SECRET &&
      ((mode === 'live' && match('live')) || (mode === 'test' && match('test'))),
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

async function paymongoRequest(path: string, init: RequestInit = {}) {
  const secretKey = getPayMongoSecret()
  if (!secretKey) throw new Error('PayMongo server configuration is missing')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  let response: Response
  try {
    response = await fetch(`${PAYMONGO_API_BASE}${path}`, {
      ...init,
      headers: { ...paymongoHeaders(secretKey), ...init.headers },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('PayMongo request timed out')
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  if (!response.ok) {
    console.error('[paymongo] request failed', {
      path,
      status: response.status,
      response: text.slice(0, 500),
    })
    const error = new Error('PayMongo request failed') as Error & { status?: number }
    error.status = response.status
    throw error
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('PayMongo returned an invalid response')
  }
}

export async function createCheckoutSession(payload: Record<string, unknown>, idempotencyKey?: string) {
  return paymongoRequest('/checkout_sessions', {
    method: 'POST',
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    body: JSON.stringify(payload),
  })
}

export async function retrieveCheckoutSession(checkoutSessionId: string) {
  return paymongoRequest(`/checkout_sessions/${encodeURIComponent(checkoutSessionId)}`, { method: 'GET' })
}
