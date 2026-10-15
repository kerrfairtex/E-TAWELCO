import type { Config } from '@netlify/functions'

const handler = async (req: Request) => {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

export { handler }
export const config: Config = { path: '/api/health2', method: 'GET' }
