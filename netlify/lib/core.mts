import { getDatabase } from '@netlify/database'
import { verifyRequestOrigin } from '@netlify/identity'
import { createClient } from '@supabase/supabase-js'

export type Role = 'member' | 'staff' | 'admin'
export const ROLES: Role[] = ['member', 'staff', 'admin']

export interface Session {
  id: string
  email: string
  name: string | null
  role: Role
}

export const db = () => getDatabase()

const responseHeaders = { 'Cache-Control': 'no-store' }

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: responseHeaders })
export const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: responseHeaders })

export function roleMetadata(appMetadata: Record<string, unknown> | undefined, role: Role) {
  const roles = [role]
  const authorization = { ...((appMetadata?.authorization as object) ?? {}), roles }
  return { ...(appMetadata ?? {}), roles, authorization }
}

// Supabase owns authentication and the role in public.profiles. Netlify Database
// continues to store dashboard records, keyed by the same Supabase user id.
export async function currentSession(req?: Request): Promise<Session | null> {
  const authorization = req?.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    { global: { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} } },
  )
  const { data: authData } = await supabase.auth.getUser(bearer || undefined)
  const user = authData.user
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle()
  const role = profile?.role === 'admin' ? 'admin' : profile?.role === 'staff' ? 'staff' : 'member'
  const email = user.email ?? ''
  await db().sql`
    INSERT INTO profiles (identity_id, email, full_name, role)
    VALUES (${user.id}, ${email}, ${profile?.full_name ?? user.user_metadata?.full_name ?? null}, ${role})
    ON CONFLICT (identity_id) DO UPDATE
      SET email = EXCLUDED.email, role = EXCLUDED.role,
          full_name = COALESCE(EXCLUDED.full_name, profiles.full_name), last_seen_at = NOW()`
  return { id: user.id, email, name: profile?.full_name ?? user.user_metadata?.full_name ?? null, role }
}

// Guards an endpoint: checks the request origin on writes, requires a session, and optionally a role.
export async function authorize(req: Request, roles?: Role[]): Promise<Session | Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      verifyRequestOrigin(req)
    } catch {
      return fail('Request origin not allowed', 403)
    }
  }
  const session = await currentSession(req)
  if (!session) return fail('Please log in', 401)
  if (roles && !roles.includes(session.role)) return fail('You do not have access to this', 403)
  return session
}

export const isStaff = (s: Session | null) => !!s && (s.role === 'staff' || s.role === 'admin')

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 1_000_000) return {}
  try {
    const data = await req.json()
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null
}

export function ticketNo(id: number, createdAt: string | Date) {
  return `OUT-${new Date(createdAt).getFullYear()}-${String(id).padStart(5, '0')}`
}

export async function audit(s: Session, action: string, entity: string, entityId: string | number, details?: unknown) {
  await db().sql`
    INSERT INTO audit_log (actor_id, actor_email, action, entity, entity_id, details)
    VALUES (${s.id}, ${s.email}, ${action}, ${entity}, ${String(entityId)}, ${JSON.stringify(details ?? {})}::jsonb)`
}
