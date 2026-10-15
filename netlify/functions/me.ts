import type { Config } from '@netlify/functions'
import { authorize, db, fail, json, readBody, text } from '../lib/core.mts'

export default async (req: Request) => {
  const s = await authorize(req)
  if (s instanceof Response) return s
  const sql = db().sql

  if (req.method === 'PATCH') {
    const b = await readBody(req)
    const fullName = text(b.full_name, 120) || null
    const phone = text(b.phone, 30) || null
    const areaId = text(b.area_id, 40) || null
    if (areaId && !(await sql`SELECT 1 FROM service_areas WHERE id = ${areaId}`).length) return fail('Unknown area')
    await sql`UPDATE profiles SET full_name = ${fullName}, phone = ${phone}, area_id = ${areaId} WHERE identity_id = ${s.id}`
  } else if (req.method !== 'GET') {
    return fail('Method not allowed', 405)
  }

  const [profile] = await sql`
    SELECT identity_id AS id, email, full_name, phone, area_id, role, created_at FROM profiles WHERE identity_id = ${s.id}`
  return json({ profile })
}

export const config: Config = { path: '/api/me', method: ['GET', 'PATCH'] }
