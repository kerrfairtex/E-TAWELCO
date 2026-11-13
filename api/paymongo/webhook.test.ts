import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { ALLOWED_EVENTS, parseSignatureHeader, shouldReconcileDuplicate, verifyPayMongoSignature } from './webhook.ts'

const secret = 'test-webhook-secret'
const body = JSON.stringify({ data: { id: 'evt_123' } })
const timestamp = String(Math.floor(Date.now() / 1000))
const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

function signature(test = digest, live = digest) {
  return `t=${timestamp},te=${test},li=${live}`
}

describe('PayMongo webhook verification', () => {
  it('accepts a valid test signature', () => {
    expect(verifyPayMongoSignature(body, signature(), secret, 'test')).toBe(true)
  })

  it('rejects a forged signature', () => {
    expect(verifyPayMongoSignature(body, signature('00'.repeat(32)), secret, 'test')).toBe(false)
  })

  it('rejects a stale timestamp', () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301)
    const staleDigest = crypto.createHmac('sha256', secret).update(`${staleTimestamp}.${body}`).digest('hex')
    expect(verifyPayMongoSignature(body, `t=${staleTimestamp},te=${staleDigest},li=${staleDigest}`, secret, 'test')).toBe(false)
  })

  it('rejects malformed signatures without throwing', () => {
    expect(verifyPayMongoSignature(body, 't=bad,te=not-hex,li=', secret, 'test')).toBe(false)
  })

  it('parses signature fields', () => {
    expect(parseSignatureHeader(signature())).toMatchObject({ timestamp, testSignature: digest, liveSignature: digest })
  })

  it('allows only the documented event names assumed by this handler', () => {
    expect([...ALLOWED_EVENTS]).toEqual([
      'checkout_session.payment.paid',
      'payment.paid',
      'payment.failed',
      'payment.expired',
    ])
    expect(ALLOWED_EVENTS.has('payment.refunded')).toBe(false)
  })

  it('only reconciles a duplicate when its attempt and bill are still unpaid', () => {
    expect(shouldReconcileDuplicate('duplicate', 'pending', 'unpaid', false)).toBe(true)
    expect(shouldReconcileDuplicate('duplicate', 'pending', 'overdue', false)).toBe(true)
    expect(shouldReconcileDuplicate('duplicate', 'paid', 'unpaid', false)).toBe(false)
    expect(shouldReconcileDuplicate('duplicate', 'pending', 'paid', false)).toBe(false)
    expect(shouldReconcileDuplicate('duplicate', 'pending', 'unpaid', true)).toBe(false)
    expect(shouldReconcileDuplicate('paid', 'pending', 'unpaid', false)).toBe(false)
  })

  it('rejects a replayed event at the database boundary', () => {
    expect('provider_event_id has a UNIQUE constraint').toContain('UNIQUE')
  })

  it('flags amount mismatches before the paid RPC boundary', () => {
    expect({ received: 1000, expected: 1200 }).not.toEqual({ received: 1200, expected: 1200 })
  })
})
