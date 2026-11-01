import crypto from 'node:crypto'

export const PAYMONGO_API_BASE = 'https://api.paymongo.com/v2'
export const PAYMONGO_PAYMENT_METHODS = ['card', 'gcash', 'paymaya', 'qrph'] as const

export function getWebhookSecret() {
  return process.env.PAYMONGO_WEBHOOK_SECRET || ''
}

export function parsePaymongoHeader(header: string | null) {
  if (!header) return null
  const parts: Record<string, string> = {}
  for (const piece of header.split(',')) {
    const i = piece.indexOf('=')
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim()
  }
  if (!/^\d+$/.test(parts.t ?? '')) return null
  return { tRaw: parts.t, te: parts.te ?? '', li: parts.li ?? '' }
}

export function verifyPaymongoSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret) return false
  const sig = parsePaymongoHeader(header)
  if (!sig) return false
  const t = Number(sig.tRaw)
  const tSec = t > 1e12 ? t / 1000 : t
  if (Math.abs(nowSec - tSec) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${sig.tRaw}.${rawBody}`).digest()
  return [sig.li, sig.te]
    .filter(Boolean)
    .some((c) => /^[0-9a-f]{64}$/i.test(c) && crypto.timingSafeEqual(Buffer.from(c, 'hex'), expected))
}
