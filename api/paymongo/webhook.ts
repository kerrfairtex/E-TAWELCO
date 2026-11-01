import { fail, json } from '../_lib/core.ts'
import { getWebhookSecret, verifyPaymongoSignature } from '../_lib/paymongo.ts'

const SHOW = new Set(['type', 'resource', 'livemode', 'status', 'currency'])

function shape(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 5).map((v) => shape(v, key))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shape(v, k)
    return out
  }
  if (SHOW.has(key)) return value
  return `<${typeof value}:${String(value).length}>`
}

export default {
  async fetch(req: Request) {
    if (req.method !== 'POST') return fail('Method not allowed', 405)
    const rawBody = await req.text()
    const header = req.headers.get('paymongo-signature')
    const valid = verifyPaymongoSignature(rawBody, header, getWebhookSecret())
    let body: unknown = null
    try { body = JSON.parse(rawBody) } catch { /* ignore */ }
    console.log('[paymongo-webhook:capture]', JSON.stringify({
      signatureValid: valid,
      header: header ? header.replace(/=([0-9a-f]+)/gi, (_m, h) => `=<hex:${h.length}>`) : null,
      shape: shape(body),
    }))
    if (!valid) return fail('Invalid signature', 401)
    return json({ ok: true, captured: true })
  },
}
