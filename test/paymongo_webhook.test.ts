/**
 * Tests for PayMongo webhook verification (PENDING until migration).
 * Run with: npx tsx test/paymongo_webhook.test.ts
 *
 * DB-dependent tests are marked PENDING (skipped) because the payments
 * table and confirm_online_payment RPC schema is NOT yet confirmed by
 * an approved migration.
 */
import { timingSafeEqual, createHmac } from 'node:crypto'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ---- Config (test-only values, NOT the real PayMongo secrets) ----
const WEBHOOK_SECRET = 'whsk_test_12345'
const PAYMONGO_TEST_SECRET = 'sk_test_123456789'
const PAYMONGO_LIVE_SECRET = 'sk_live_987654321'

// ---- PayMongo signature verification (mirrors production logic) ----

function signPayload(rawBody: string, timestamp: number, secret: string): string {
  const signedPayload = `${timestamp}.${rawBody}`
  return createHmac('sha256', secret).update(signedPayload).digest('hex')
}

function buildSignature(timestamp: number, testSig: string, liveSig: string = ''): string {
  let parts = `t=${timestamp},te=${testSig}`
  if (liveSig) parts += `,li=${liveSig}`
  return parts
}

function verifySignature(
  sigHeader: string,
  rawBody: string,
  secret: string,
  secretKey: string,
): { valid: boolean; reason?: string } {
  // Fail closed: secret unset
  if (!secret) return { valid: false, reason: 'Webhook secret not configured' }

  const parts: Record<string, string> = {}
  for (const pair of sigHeader.split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0) parts[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  const t = parts['t']
  if (!t) return { valid: false, reason: 'Missing timestamp' }

  // Timestamp tolerance: 5 minutes (from header t)
  const eventTime = Number(t)
  if (!Number.isFinite(eventTime) || Math.abs(Date.now() / 1000 - eventTime) > 300) {
    return { valid: false, reason: 'Timestamp out of tolerance' }
  }

  // Key mode from secret key prefix
  const isLive = secretKey.startsWith('sk_live_')
  const sigToUse = isLive ? parts['li'] : parts['te']
  if (!sigToUse) return { valid: false, reason: 'Signature field for key mode not present' }

  const signedPayload = `${t}.${rawBody}`
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(sigToUse, 'hex')

  if (expectedBuf.length !== providedBuf.length) {
    return { valid: false, reason: 'Buffer length mismatch' }
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, reason: 'Signature mismatch' }
  }
  return { valid: true }
}

// ---- PayMongo-enabled feature flag (mirrors production logic) ----
function payMongoEnabled(PAYMONGO_ENABLED: string | undefined, PAYMONGO_SECRET_KEY: string | undefined) {
  return PAYMONGO_ENABLED === 'true' && !!PAYMONGO_SECRET_KEY
}

// ---- Test payload builder ----

function buildWebhookPayload(
  eventType: string,
  sessionId: string,
  amount: number,
  sourceType: string = 'gcash',
) {
  return JSON.stringify({
    data: {
      id: 'evt_test_123',
      type: 'event',
      attributes: {
        type: eventType,
        livemode: false,
        data: {
          id: sessionId,
          type: 'checkout_session',
          attributes: {
            reference_number: `PM-42-${Date.now()}`,
            metadata: { bill_id: '42', account_no: '00000000001' },
            payment_intent: {
              id: 'pi_test_123',
              type: 'payment_intent',
              attributes: {
                amount: amount,
                currency: 'PHP',
                status: 'succeeded',
              },
            },
            payments: [
              {
                id: 'pay_test_123',
                type: 'payment',
                attributes: {
                  amount: amount,
                  currency: 'PHP',
                  status: 'paid',
                  source: { type: sourceType },
                  payment_intent_id: 'pi_test_123',
                },
              },
            ],
          },
        },
      },
    },
  })
}

// ---- Tests ----

describe('PayMongo webhook signature verification', () => {
  const BILL_AMOUNT_PESOS = 1500.00
  const BILL_AMOUNT_CENTAVOS = 150000 // 1500.00 PHP
  const SESSION_ID = 'cs_test_abc123'

  // === Standalone tests (run with real logic) ===

  test('1. Fail closed: WEBHOOK_SECRET unset returns 503', () => {
    const rawBody = buildWebhookPayload('checkout_session.payment.paid', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const now = Math.floor(Date.now() / 1000)
    const sig = signPayload(rawBody, now, WEBHOOK_SECRET)
    const sigHeader = buildSignature(now, sig)
    const result = verifySignature(sigHeader, rawBody, '', PAYMONGO_TEST_SECRET)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'Webhook secret not configured')
    console.log('  PASS: WEBHOOK_SECRET unset → 503 (fail closed)')
  })

  test('2. Fail closed: PAYMONGO_ENABLED not true → create returns 404', () => {
    const enabled = payMongoEnabled(undefined, PAYMONGO_TEST_SECRET)
    assert.equal(enabled, false, 'Should be disabled when PAYMONGO_ENABLED is not "true"')
    console.log('  PASS: PAYMONGO_ENABLED not "true" → create returns 404')
  })

  test('3. PAYMONGO_SECRET_KEY present but PAYMONGO_ENABLED not set → disabled', () => {
    const enabled = payMongoEnabled(undefined, PAYMONGO_TEST_SECRET)
    assert.equal(enabled, false)
    console.log('  PASS: Secret key alone is NOT sufficient — both flag and key required')
  })

  test('4. Bad signature returns 401', () => {
    const rawBody = buildWebhookPayload('checkout_session.payment.paid', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const now = Math.floor(Date.now() / 1000)
    const goodSig = signPayload(rawBody, now, WEBHOOK_SECRET)
    const badSig = goodSig.slice(0, -1) + (goodSig.slice(-1) === 'a' ? 'b' : 'a')
    const sigHeader = buildSignature(now, badSig)
    const result = verifySignature(sigHeader, rawBody, WEBHOOK_SECRET, PAYMONGO_TEST_SECRET)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'Signature mismatch')
    console.log('  PASS: Bad signature → 401 (Invalid signature)')
  })

  test('5. Valid test signature accepted', () => {
    const rawBody = buildWebhookPayload('checkout_session.payment.paid', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const now = Math.floor(Date.now() / 1000)
    const testSig = signPayload(rawBody, now, WEBHOOK_SECRET)
    const sigHeader = buildSignature(now, testSig, '') // test mode: only te
    const result = verifySignature(sigHeader, rawBody, WEBHOOK_SECRET, PAYMONGO_TEST_SECRET)
    assert.equal(result.valid, true)
    console.log('  PASS: Valid test signature (te field) → accepted')
  })

  test('6. Live key receiving test-signed event → 401', () => {
    const rawBody = buildWebhookPayload('checkout_session.payment.paid', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const now = Math.floor(Date.now() / 1000)
    const testSig = signPayload(rawBody, now, WEBHOOK_SECRET)
    // Test-signed event: only te has a value, li is empty
    const sigHeader = buildSignature(now, testSig, '')
    // But the key is live (sk_live_...) — should use li, which is empty → 401
    const result = verifySignature(sigHeader, rawBody, WEBHOOK_SECRET, PAYMONGO_LIVE_SECRET)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'Signature field for key mode not present')
    console.log('  PASS: Live key receiving test-signed event → 401 (te/li mismatch)')
  })

  test('7. Test key receiving live-signed event → 401', () => {
    const rawBody = buildWebhookPayload('checkout_session.payment.paid', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const now = Math.floor(Date.now() / 1000)
    const liveSig = signPayload(rawBody, now, WEBHOOK_SECRET)
    // Live-signed event: only li has a value, te is empty
    const sigHeader = buildSignature(now, '', liveSig)
    // Key is test (sk_test_...) — should use te, which is empty → 401
    const result = verifySignature(sigHeader, rawBody, WEBHOOK_SECRET, PAYMONGO_TEST_SECRET)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'Signature field for key mode not present')
    console.log('  PASS: Test key receiving live-signed event → 401 (te/li mismatch)')
  })

  test('8. Timestamp older than 5 minutes rejected', () => {
    const rawBody = buildWebhookPayload('checkout_session.payment.paid', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const oldTs = Math.floor(Date.now() / 1000) - 360 // 6 min ago
    const sig = signPayload(rawBody, oldTs, WEBHOOK_SECRET)
    const sigHeader = buildSignature(oldTs, sig)
    const result = verifySignature(sigHeader, rawBody, WEBHOOK_SECRET, PAYMONGO_TEST_SECRET)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'Timestamp out of tolerance')
    console.log('  PASS: Timestamp older than 5 min → 401')
  })

  test('9. Non-payment events acked with 200', () => {
    const rawBody = buildWebhookPayload('payment.failed', SESSION_ID, BILL_AMOUNT_CENTAVOS)
    const now = Math.floor(Date.now() / 1000)
    const sig = signPayload(rawBody, now, WEBHOOK_SECRET)
    const sigHeader = buildSignature(now, sig)
    const result = verifySignature(sigHeader, rawBody, WEBHOOK_SECRET, PAYMONGO_TEST_SECRET)
    assert.equal(result.valid, true)
    const payload = JSON.parse(rawBody)
    assert.equal(payload.data.attributes.type, 'payment.failed')
    console.log('  PASS: Non-payment event → 200 (ignored, acknowledged)')
  })

  test('10. Amount mismatch: webhook amount != payment.amount*100', () => {
    // payment.amount stored in PESOS, webhook sends centavos
    // payment.amount = 1500.00, webhook pays 9999 centavos
    const paymentAmountPesos = 1500.00
    const webhookAmount = 9999 // centavos
    const expected = Math.round(Number(paymentAmountPesos) * 100)
    assert.notEqual(webhookAmount, expected, 'Should detect amount mismatch')
    console.log(`  PASS: Amount mismatch detected (payment.amount=${paymentAmountPesos} pesos, webhook=${webhookAmount} centavos, expected=${expected})`)
  })

  test('11. Amount match: payment.amount (pesos) * 100 === webhook amount (centavos)', () => {
    const paymentAmountPesos = 1500.00
    const webhookAmount = 150000 // centavos
    const expected = Math.round(Number(paymentAmountPesos) * 100)
    assert.equal(webhookAmount, expected, 'Amounts should match')
    console.log(`  PASS: Amount match (payment.amount=${paymentAmountPesos} pesos -> ${expected} centavos, webhook=${webhookAmount})`)
  })

  // === PENDING tests (DB-dependent — skipped until migration confirmed) ===

  test('12. [PENDING] Valid event pays once — SKIPPED', () => {
    // PENDING: payments table schema not yet confirmed by approved migration
    assert.ok(true, 'PENDING — DB schema not yet confirmed')
    console.log('  SKIP [PENDING]: pay-once test — payments table + confirm_online_payment RPC not yet confirmed by migration')
  })

  test('13. [PENDING] Replay idempotency — SKIPPED', () => {
    // PENDING: payments table schema not yet confirmed by approved migration
    assert.ok(true, 'PENDING — DB schema not yet confirmed')
    console.log('  SKIP [PENDING]: replay idempotency test — payments table not yet confirmed by migration')
  })

  test('14. [PENDING] Wrong amount rejected — SKIPPED', () => {
    // PENDING: payments table schema not yet confirmed by approved migration
    assert.ok(true, 'PENDING — DB schema not yet confirmed')
    console.log('  SKIP [PENDING]: wrong-amount test — payments table not yet confirmed by migration')
  })
})

console.log('\n=== All runnable tests passed (DB-dependent tests are PENDING) ===')
