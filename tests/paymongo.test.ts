import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { verifyPaymongoSignature } from '../api/_lib/paymongo.ts'

const secret = 'whsk_test_secret'
const body = '{"data":{"type":"checkout_session.payment.paid"}}'
const now = 1_760_000_000
const sign = (t: number, b = body, s = secret) =>
  crypto.createHmac('sha256', s).update(`${t}.${b}`).digest('hex')
const check = (hdr: string | null, b = body, s = secret) =>
  verifyPaymongoSignature(b, hdr, s, now)

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
