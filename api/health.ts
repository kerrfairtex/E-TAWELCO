export default {
  async fetch(req: Request) {
    // TEMP-SUPABASE-CHECK: runtime verification of Supabase connectivity (remove before merge)
    const sbUrl = process.env.SUPABASE_URL || ''
    const sbPub = process.env.SUPABASE_PUBLISHABLE_KEY || ''
    const sbJwks = process.env.SUPABASE_JWKS_URL || ''

    // 1. Check Supabase auth health endpoint
    let authHealth = 0
    try {
      const authResp = await fetch(`${sbUrl}/auth/v1/health`, {
        headers: { apikey: sbPub }
      })
      authHealth = authResp.status
    } catch {
      authHealth = 0
    }

    // 2. Check JWKS endpoint returns 200 with "keys" array
    let jwks = false
    try {
      const jwksResp = await fetch(sbJwks)
      if (jwksResp.ok) {
        const jwksData = await jwksResp.json()
        jwks = Array.isArray(jwksData.keys)
      }
    } catch {
      jwks = false
    }

    // 3. Check profiles table via REST (publishable key only, no row data)
    let profilesTable = 'error'
    try {
      const profilesResp = await fetch(`${sbUrl}/rest/v1/profiles?select=id&limit=1`, {
        headers: {
          apikey: sbPub,
          Authorization: `Bearer ${sbPub}`
        }
      })
      if (profilesResp.status === 401 || profilesResp.status === 403) {
        profilesTable = 'rls-empty'
      } else if (profilesResp.status === 200) {
        profilesTable = 'ok'
      } else if (profilesResp.status === 404 || profilesResp.status === 400) {
        profilesTable = 'missing'
      } else {
        profilesTable = 'error'
      }
    } catch {
      profilesTable = 'error'
    }

    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: {
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSecretKey: !!process.env.SUPABASE_SECRET_KEY,
      },
      // TEMP-SUPABASE-CHECK output: no keys, URLs, headers, or row contents
      authHealth,
      jwks,
      profilesTable
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
  }
}
