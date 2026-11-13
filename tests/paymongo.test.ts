import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { verifyPaymongoSignature } from '../api/_lib/paymongo.ts'
import { parsePaidCheckoutEvent } from '../api/paymongo/webhook.ts'
import { PAYMENT_METHOD_TYPES, parseCheckoutSession } from '../api/paymongo/checkout.ts'

const secret = 'whsk_test_secret'
const body = '{"data":{"type":"checkout_session.payment.paid"}}'
const now = 1_760_000_000
const sign = (t: number, b = body, s = secret) =>
  crypto.createHmac('sha256', s).update(`${t}.${b}`).digest('hex')
const check = (hdr: string | null, b = body, s = secret) =>
  verifyPaymongoSignature(b, hdr, s, now)

describe('checkout payment methods', () => {
  it('passes the requested live payment methods to PayMongo', () => {
    expect(PAYMENT_METHOD_TYPES).toEqual(['card', 'gcash', 'paymaya', 'grab_pay', 'qrph'])
  })

  it('extracts a reusable hosted checkout session', () => {
    expect(parseCheckoutSession({
      data: {
        id: 'cs_test_123',
        attributes: { status: 'active', checkout_url: 'https://checkout.paymongo.com/cs_test_123' },
      },
    })).toEqual({
      id: 'cs_test_123',
      url: 'https://checkout.paymongo.com/cs_test_123',
      status: 'active',
    })
  })

  it('recognizes expired provider sessions', () => {
    expect(parseCheckoutSession({ data: { id: 'cs_test_old', attributes: { status: 'expired' } } }).status).toBe('expired')
  })
})

describe('parsePaidCheckoutEvent', () => {
  it('parses the v2 nested checkout session payment', () => {
    const parsed = parsePaidCheckoutEvent({
      data: {
        id: 'evt_live_123',
        attributes: {
          type: 'checkout_session.payment.paid',
          livemode: true,
          created_at: 1760000000,
          data: {
            id: 'cs_live_123',
            attributes: {
              payments: [{ id: 'pay_live_123', attributes: { status: 'pending', amount: 10000, currency: 'PHP' } }, { id: 'pay_live_paid', attributes: { status: 'paid', amount: 10000, currency: 'PHP', source: { type: 'gcash' }, paid_at: '2026-11-08T00:00:00Z' } }],
            },
          },
        },
      },
    })
    expect(parsed).toEqual({
      eventId: 'evt_live_123',
      eventType: 'checkout_session.payment.paid',
      livemode: true,
      checkoutSessionId: 'cs_live_123',
      paymentId: 'pay_live_paid',
      amountCentavos: 10000,
      currency: 'PHP',
      method: 'gcash',
      paidAt: '2026-11-08T00:00:00.000Z',
    })
  })

  it('does not treat the event id as the payment id', () => {
    const parsed = parsePaidCheckoutEvent({ data: { id: 'evt_1', attributes: { type: 'checkout_session.payment.paid', data: { id: 'cs_1', attributes: { payments: [] } } } } })
    expect(parsed).toBeNull()
  })
})

describe('verifyPaymongoSignature', () => {
  it('accepts test-mode header (li empty)', () => {
    expect(check(`t=${now},te=${sign(now)},li=`)).toBe(true)
  })
  it('accepts live-mode header (te empty)', () => {
    expect(check(`t=${now},te=,li=${sign(now)}`)).toBe(true)
  })
  it('accepts a timestamp inside the window', () => {
    expect(check(`t=${now - 299},te=${sign(now - 299)},li=`)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(check(`t=${now},te=${sign(now)},li=`, body + ' ')).toBe(false)
  })
  it('rejects the wrong secret', () => {
    expect(check(`t=${now},te=${sign(now, body, 'other')},li=`)).toBe(false)
  })
  it('rejects an old timestamp', () => {
    expect(check(`t=${now - 301},te=${sign(now - 301)},li=`)).toBe(false)
  })
  it('rejects both signatures empty', () => {
    expect(check(`t=${now},te=,li=`)).toBe(false)
  })
  it('rejects non-hex and malformed headers', () => {
    expect(check(`t=${now},te=zzzz,li=`)).toBe(false)
    expect(check('garbage')).toBe(false)
    expect(check(null)).toBe(false)
  })
  it('rejects an empty secret', () => {
    expect(check(`t=${now},te=${sign(now)},li=`, body, '')).toBe(false)
  })
})

describe('parsePaidCheckoutEvent paid_at normalization', () => {
  const build = (paidAt: unknown, createdAt: unknown = 1760000000) => ({
    data: {
      id: 'evt_epoch',
      attributes: {
        type: 'checkout_session.payment.paid',
        livemode: false,
        created_at: createdAt,
        data: {
          id: 'cs_epoch',
          attributes: {
            payments: [{ id: 'pay_epoch', attributes: { status: 'paid', amount: 10000, currency: 'PHP', source: { type: 'gcash' }, paid_at: paidAt } }],
          },
        },
      },
    },
  })

  it('converts epoch seconds (number) to ISO', () => {
    expect(parsePaidCheckoutEvent(build(1794414256))?.paidAt).toBe('2026-11-11T16:24:16.000Z')
  })

  it('converts epoch seconds (numeric string) to ISO', () => {
    expect(parsePaidCheckoutEvent(build('1794414256'))?.paidAt).toBe('2026-11-11T16:24:16.000Z')
  })

  it('falls back to created_at (epoch) when paid_at is missing', () => {
    expect(parsePaidCheckoutEvent(build(undefined))?.paidAt).toBe(new Date(1760000000 * 1000).toISOString())
  })

  it('never returns a bare numeric string', () => {
    expect(parsePaidCheckoutEvent(build(1794414256))?.paidAt).not.toMatch(/^\d+$/)
  })

  it('rejects malformed paid_at instead of substituting the current time', () => {
    expect(parsePaidCheckoutEvent(build('not-a-timestamp'))).toBeNull()
  })
})
