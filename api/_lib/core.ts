import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPermission, isMethodAllowed, verifyNoBrowserMoneyOrStatus } from './permissions'

export type Role = 'member' | 'staff' | 'admin'
export type Session = { id: string; email: string; name: string | null; role: Role; staff_function: string[] | null }

// Server-only client. It always runs as service role because the tables have RLS enabled with no
// policies; access is enforced in code via authorize() and per-user filters. The caller's token is
// verified separately in currentSession(), never forwarded as the Authorization header.
export function supabase(_req?: Request) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// Auth client for login flow. Uses the publishable key only (no service role).
// Bearer parsing and auth.getUser(token) verification happen in currentSession().
export function supabaseAuth(_req?: Request) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
export const fail = (error: string, status = 400) => json({ error }, status)
export const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''
export const body = async (req: Request) => { try { const value = await req.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} } catch { return {} } }
export const oneOf = <T extends string>(value: unknown, allowed: readonly T[]) => allowed.includes(value as T) ? value as T : null
export const ticketNo = (id: number, createdAt: string) => `OUT-${new Date(createdAt).getFullYear()}-${String(id).padStart(5, '0')}`

export async function currentSession(req: Request, client: SupabaseClient = supabase(req)): Promise<Session | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: auth, error } = await client.auth.getUser(token)
  if (error || !auth.user) return null
  const { data: profile } = await client.from('profiles').select('role, full_name, staff_function').eq('id', auth.user.id).maybeSingle()
  const role: Role = profile?.role === 'admin' ? 'admin' : profile?.role === 'staff' ? 'staff' : 'member'
  return { id: auth.user.id, email: auth.user.email ?? '', name: profile?.full_name ?? null, role, staff_function: profile?.staff_function ?? null }
}

export async function authorize(req: Request, roles?: Role[]) {
  const session = await currentSession(req)
  if (!session) return fail('Please log in', 401)
  if (roles && !roles.includes(session.role)) return fail('You do not have access to this', 403)
  return session
}
export const isStaff = (s: Session) => s.role === 'staff' || s.role === 'admin'

// Authorize with staff function requirement (server-side enforcement of permission map)
// A staff or admin user must have at least one of the required functions in their staff_function array.
// If functions is empty, only role-based authorization applies (same as authorize).
export async function authorizeWithFunctions(req: Request, roles: Role[], functions?: string[]): Promise<Session | Response> {
  const session = await authorize(req, roles)
  if (session instanceof Response) return session
  // Admin role bypasses staff_function check — admins have implicit access to all functions
  if (session.role === 'admin') return session
  if (functions && functions.length > 0) {
    const userFunctions = session.staff_function ?? []
    const hasFunction = functions.some((fn) => userFunctions.includes(fn))
    if (!hasFunction) return fail('You do not have access to this', 403)
  }
  return session
}

// Shared route authorization — reads from the single permission map
// Usage: const s = await authorizeRoute(req, 'users'); if (s instanceof Response) return s
export async function authorizeRoute(req: Request, routeKey: string): Promise<Session | Response> {
  const perm = getPermission(routeKey)
  if (!perm) return fail('Unknown route', 404)
  if (!isMethodAllowed(routeKey, req.method)) return fail('Method not allowed', 405)
  if (perm.functions && perm.functions.length > 0) {
    return await authorizeWithFunctions(req, perm.roles, perm.functions)
  }
  return await authorize(req, perm.roles.length > 0 ? perm.roles : undefined)
}

// Safety check: call this in tests to verify no browser-mutable payment routes exist
export const PAYMENT_SECURITY_CHECK = verifyNoBrowserMoneyOrStatus()
export async function audit(client: SupabaseClient, s: Session, action: string, entity: string, entityId: string | number, details: unknown = {}) { await client.from('audit_log').insert({ actor_id: s.id, actor_email: s.email, action, entity, entity_id: String(entityId), details }) }

export const statuses = ['received', 'assigned', 'in_progress', 'resolved'] as const
export const areaStatuses = ['steady', 'limited', 'outage'] as const
export const observations = ['No power at my house', 'Whole street is out', 'Fallen line', 'Flickering'] as const
export const withTicket = <T extends { id: number; created_at: string }>(row: T) => ({ ...row, ticket_no: ticketNo(row.id, row.created_at) })
export function pathParts(req: Request) { return new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean) }
export function methodAllowed(req: Request, methods: string[]) { return methods.includes(req.method) }
export function corsHeaders() { return { 'Cache-Control': 'no-store' } }

export type ApiContext = { req: Request; client: SupabaseClient; session: Session }
export type ApiHandler = (ctx: ApiContext, id?: string) => Promise<Response>

export async function handleApi(req: Request) {
  const client = supabase(req)
  const parts = pathParts(req)
  const resource = parts[1] // /api/<resource>
  const id = parts[2]
  return { client, resource, id }
}

export async function readAreas(client: SupabaseClient) {
  const { data, error } = await client.from('service_areas').select('id,name,marker_name,status,source,rate,hours,office,notice,extra,updated_at,sort_order,barangays(name),municipalities!inner(id,psgc_code,name,serving_utility,tawelco_coverage_status,coverage_note,is_capital)').order('sort_order').order('name')
  if (error) throw error
  return (data ?? []).map((a: any) => ({ ...a, barangays: (a.barangays ?? []).map((b: any) => b.name).sort(), municipality: a.municipalities ?? null }))
}

export async function readMunicipalities(client: SupabaseClient) {
  const { data, error } = await client.from('municipalities').select('id,psgc_code,name,income_class,population_2020,population_note,serving_utility,tawelco_coverage_status,coverage_note,is_capital,sort_order').order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function readProfile(client: SupabaseClient, id: string) { const { data } = await client.from('profiles').select('id,email,full_name,phone,area_id,role,created_at,municipality_id,barangay_id,sitio_purok_landmark').eq('id', id).maybeSingle(); return data }

export function internalError(error: unknown) { console.error('[v0] API error', error); return fail('Unexpected server error', 500) }

export const apiConfig = { runtime: 'nodejs' as const }
