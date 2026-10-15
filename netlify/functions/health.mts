import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasSecretKey: !!process.env.SUPABASE_SECRET_KEY,
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

export const config: Config = { path: '/api/health', method: 'GET' }
