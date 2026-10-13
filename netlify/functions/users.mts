import type { Config, Context } from '@netlify/functions'
import { admin } from '@netlify/identity'
import { audit, authorize, db, fail, json, oneOf, readBody, roleMetadata, ROLES } from '../lib/core.mts'

// Admin-only: list everyone who has signed in and grant member, staff or admin roles.
export default async (req: Request, context: Context) => {
  const s = await authorize(req, ['admin'])
  if (s instanceof Response) return s
  const sql = db().sql

  if (req.method === 'GET') {
    const users = await sql`
      SELECT p.identity_id AS id, p.email, p.full_name, p.role, p.area_id, a.name AS area_name, p.created_at, p.last_seen_at,
             (SELECT count(*)::int FROM outage_reports r WHERE r.reporter_id = p.identity_id) AS reports
      FROM profiles p LEFT JOIN service_areas a ON a.id = p.area_id
      ORDER BY CASE p.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, COALESCE(p.full_name, p.email)
      LIMIT 500`
    return json({ users })
  }

  if (req.method !== 'PATCH' || !context.params.id) return fail('Method not allowed', 405)
  const id = context.params.id
  const role = oneOf((await readBody(req)).role, ROLES)
  if (!role) return fail('Role must be member, staff or admin')
  if (id === s.id) return fail('You cannot change your own role')

  const [profile] = await sql`SELECT role FROM profiles WHERE identity_id = ${id}`
  if (!profile) return fail('User not found', 404)

  try {
    const user = await admin.getUser(id)
    await admin.updateUser(id, { app_metadata: roleMetadata(user.appMetadata, role) })
  } catch {
    return fail('Could not update this user in Identity', 502)
  }
  await sql`UPDATE profiles SET role = ${role} WHERE identity_id = ${id}`
  await audit(s, 'user.role', 'profile', id, { from: profile.role, to: role })
  return json({ ok: true, role })
}

export const config: Config = { path: ['/api/users', '/api/users/:id'], method: ['GET', 'PATCH'] }
