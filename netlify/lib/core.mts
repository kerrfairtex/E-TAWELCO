import { getDatabase } from '@netlify/database'
import { getUser, verifyRequestOrigin, type User } from '@netlify/identity'

export type Role = 'member' | 'staff' | 'admin'
export const ROLES: Role[] = ['member', 'staff', 'admin']

export interface Session {
  id: string
  email: string
  name: string | null
  role: Role
}

export const db = () => getDatabase()

export const json = (data: unknown, status = 200) => Response.json(data, { status })
export const fail = (error: string, status = 400) => Response.json({ error }, { status })

// Roles live in app_metadata.roles (read by @netlify/identity) and app_metadata.authorization.roles
// (this site's JWT roles path, read by the CDN for role-based redirects). Accept either.
export function rolesOf(user: Pick<User, 'roles' | 'appMetadata'>): string[] {
  const auth = (user.appMetadata?.authorization ?? {}) as { roles?: string[] }
  return [...new Set([...(user.roles ?? []), ...(auth.roles ?? [])])]
}

export function primaryRole(roles: string[]): Role {
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('staff')) return 'staff'
  return 'member'
}

export function roleMetadata(appMetadata: Record<string, unknown> | undefined, role: Role) {
  const roles = [role]
  const authorization = { ...((appMetadata?.authorization as object) ?? {}), roles }
  return { ...(appMetadata ?? {}), roles, authorization }
}

// Returns the signed-in user (and keeps their profile row in sync), or null for visitors.
export async function currentSession(): Promise<Session | null> {
  const user = await getUser()
  if (!user) return null
  const role = primaryRole(rolesOf(user))
  const email = user.email ?? ''
  await db().sql`
    INSERT INTO profiles (identity_id, email, full_name, role)
    VALUES (${user.id}, ${email}, ${user.name ?? null}, ${role})
    ON CONFLICT (identity_id) DO UPDATE
      SET email = EXCLUDED.email, role = EXCLUDED.role,
          full_name = COALESCE(profiles.full_name, EXCLUDED.full_name), last_seen_at = NOW()`
  return { id: user.id, email, name: user.name ?? null, role }
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
  const session = await currentSession()
  if (!session) return fail('Please log in', 401)
  if (roles && !roles.includes(session.role)) return fail('You do not have access to this', 403)
  return session
}

export const isStaff = (s: Session | null) => !!s && (s.role === 'staff' || s.role === 'admin')

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json()
    return data && typeof data === 'object' ? data : {}
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
