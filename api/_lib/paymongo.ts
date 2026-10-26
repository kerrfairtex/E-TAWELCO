/**
 * Shared PayMongo helpers for E-TAWELCO integration.
 *
 * This module is the SINGLE source of truth for:
 * - payMongoEnabled() — feature flag check
 * - PayMongo signature verification (HMAC-SHA256, timestamp tolerance, key-mode switching)
 * - PayMongo v2 API calls (checkout session creation)
 * - Amount conversion (PHP pesos ↔ centavos)
 * - Basic auth header construction
 *
 * DB references (PENDING — confirmed by migration required):
 *   payments table (PENDING): id, bill_id, provider, provider_ref, amount (pesos),
 *     currency, method, status, channel, created_at, updated_at, paid_at
 *   confirm_online_payment(p_payment_id, p_provider_ref, p_amount,
 *     p_event_id, p_paid_at, p_paid_channel)
 *
 * Docs source: https://developers.paymongo.com/docs/payment-channels-hosted-checkout
 *   "We recommend /v2 for new integrations."
 *   "The payment_method_types field accepts the following values:
 *    ["card"], ["gcash"], ["paymaya"], ["qrph"]"
 */

import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { fail, internalError, json, supabase, audit } from './core.js'
import type { Response } from 'node:http'

// ---- Feature flag ----

export const payMongoEnabled = () =>
  process.env.PAYMONGO_ENABLED === 'true' &&
  !!process.env.PAYMONGO_SECRET_KEY

// ---- Amount helpers ----

/** Convert PHP pesos → centavos (PayMongo boundary only). */
export const toCentavos = (pesos: number | string): number =>
  Math.round(Number(pesos) * 100)

/** Format centavos as decimal string "X.XX" for display. */
export const formatAmount = (centavos: number): string =>
  (centavos / 100).toFixed(2)

// ---- Signature verification ----

/** Parse the Paymongo-Signature header: t=<ts>,te=<test_sig>,li=<live_sig> */
export function parseSignatureHeader(header: string): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const pair of header.split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0) parts[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  return parts
}

/**
 * Verify a PayMongo webhook signature.
 * Returns { valid: true } or { valid: false, reason, status }.
 *
 * - Uses t from the header for timestamp tolerance (5 min).
 * - Key mode determined from PAYMONGO_SECRET_KEY prefix (sk_test_ vs sk_live_).
 *   Uses 'te' for test keys, 'li' for live keys.
 *   If a live key receives a test-signed event (or vice versa), the missing
 *   signature field yields 401.
 * - Signed payload: `${t}.${rawBody}`, HMAC-SHA256 with PAYMONGO_WEBHOOK_SECRET.
 */
export interface SignatureResult {
  valid: boolean
  eventId?: string
  checkoutData?: any
  reason?: string
  status?: number
}

export function verifyPaymongoSignature(
  sigHeader: string,
  rawBody: string,
): SignatureResult {
  // Fail closed: webhook secret not configured → 503
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET
  if (!webhookSecret) {
    return { valid: false, reason: 'Webhook secret not configured', status: 503 }
  }

  const parts = parseSignatureHeader(sigHeader)
  const t = parts['t']
  if (!t) return { valid: false, reason: 'Missing timestamp', status: 401 }

  const eventTime = Number(t)
  if (!Number.isFinite(eventTime) || Math.abs(Date.now() / 1000 - eventTime) > 300) {
    return { valid: false, reason: 'Timestamp out of tolerance', status: 401 }
  }

  // Key mode from SECRET key prefix
  const isLive = process.env.PAYMONGO_SECRET_KEY!.startsWith('sk_live_')
  const sigToUse = isLive ? parts['li'] : parts['te']
  if (!sigToUse) {
    return { valid: false, reason: 'Signature field for key mode not present', status: 401 }
  }

  const signedPayload = `${t}.${rawBody}`
  const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(sigToUse, 'hex')

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, reason: 'Invalid signature', status: 401 }
  }

  let payload: any = {}
  try { payload = JSON.parse(rawBody) } catch {
    return { valid: false, reason: 'Invalid JSON body', status: 400 }
  }

  const eventType = payload?.data?.attributes?.type
  const checkoutData = payload?.data?.attributes?.data
  const eventId = payload?.data?.id

  if (eventType !== 'checkout_session.payment.paid') {
    // Non-payment events: ack 200
    return { valid: false, reason: `Not a payment.paid event: ${eventType}`, status: 200, eventId, checkoutData }
  }

  return { valid: true, eventId, checkoutData }
}

// ---- SITE_URL normalization ----

export function getSiteUrl(): string {
  let url = (process.env.SITE_URL || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('SITE_URL is not configured')
  return url
}

// ---- PayMongo v2 API client ----

/**
 * Valid v2 payment_method_types (from PayMongo docs):
 *   "card", "gcash", "paymaya", "qrph"
 * Docs: "The payment_method_types field accepts the following values:
 *        [\"card\"], [\"gcash\"], [\"paymaya\"], [\"qrph\"]"
 */
export const PAYMONGO_METHOD_TYPES = ['card', 'gcash', 'paymaya', 'qrph'] as const
export type PaymongoMethod = typeof PAYMONGO_METHOD_TYPES[number]

/** Parse payment methods from PAYMONGO_METHODS env (default: card,gcash). */
export function parsePaymentMethods(envValue?: string): PaymongoMethod[] {
  const str = envValue || 'card,gcash'
  return str
    .split(',')
    .map(m => m.trim() as PaymongoMethod)
    .filter(m => PAYMONGO_METHOD_TYPES.includes(m))
}

/**
 * Create a PayMongo v2 Checkout Session.
 * Docs: POST https://api.paymongo.com/v2/checkout_sessions
 * "We recommend /v2 for new integrations."
 */
export async function createCheckoutSession(
  billId: number,
  billPeriod: string,
  billAmountPesos: number | string,
  accountNo: string,
): Promise<{ checkoutUrl: string; sessionId: string } | { error: string }> {
  const siteUrl = getSiteUrl()
  const methods = parsePaymentMethods(process.env.PAYMONGO_METHODS)
  const amount = toCentavos(billAmountPesos)
  const ref = `PM-${billId}-${Date.now()}`

  const payload = {
    data: {
      type: 'checkout_session',
      attributes: {
        line_items: [{
          name: `E-TAWELCO Bill ${billPeriod}`,
          amount,
          currency: 'PHP',
          quantity: 1,
        }],
        payment_method_types: methods,
        success_url: `${siteUrl}/dashboard?tab=my-bills`,
        cancel_url: `${siteUrl}/dashboard?tab=my-bills`,
        reference_number: ref,
        metadata: { bill_id: String(billId), account_no: accountNo },
      },
    },
  }

  const res = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY! + ':').toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json()
  if (!res.ok) {
    return { error: data?.errors?.[0]?.detail || data?.message || 'Payment provider error' }
  }

  return {
    checkoutUrl: data.data?.attributes?.checkout_url,
    sessionId: data.data?.id || data.data?.attributes?.id,
  }
}

// ---- Payment expiry helper ----
// PENDING: pending payments expire after 30 minutes (pending_at + interval '30 minutes')
// This requires a DB migration — not yet implemented.
export const PAYMENT_PENDING_EXPIRES_MINUTES = 30

/**
 * Get a live pending checkout URL for a bill (if one exists within expiry window).
 * PENDING: requires payments table with checkout_url column and pending_at column.
 * Schema NOT confirmed by migration.
 */
export async function getLivePendingCheckout(
  client: SupabaseClient,
  billId: number,
): Promise<string | null> {
  const { data, error } = await client
    .from('payments')
    .select('checkout_url, pending_at, status')
    .eq('bill_id', billId)
    .eq('status', 'pending')
    .gte('pending_at', new Date(Date.now() - PAYMENT_PENDING_EXPIRES_MINUTES * 60_000).toISOString())
    .maybeSingle()

  if (error || !data) return null
  return data.checkout_url ?? null
}

export { fail, internalError, json, supabase, audit }
export type { SupabaseClient, Session }
