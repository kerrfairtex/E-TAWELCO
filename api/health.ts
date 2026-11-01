export default {
  async fetch(req: Request) {
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: {
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSecretKey: !!process.env.SUPABASE_SECRET_KEY,
        hasSecretKey: !!process.env.SUPABASE_SECRET_KEY,
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
  }
}
