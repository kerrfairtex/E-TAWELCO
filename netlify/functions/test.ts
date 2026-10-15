import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  return new Response(JSON.stringify({ ok: true, test: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

export const config: Config = { path: '/api/test', method: 'GET' }
