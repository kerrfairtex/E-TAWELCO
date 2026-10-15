import type { Config } from '@netlify/functions'
import { authorize, db, json } from '../lib/core.mts'

// Staff and admins who can be assigned work.
export default async (req: Request) => {
  const s = await authorize(req, ['staff', 'admin'])
  if (s instanceof Response) return s
  const team = await db().sql`
    SELECT identity_id AS id, email, full_name, role FROM profiles
    WHERE role IN ('staff', 'admin') ORDER BY COALESCE(full_name, email)`
  return json({ team })
}

export const config: Config = { path: '/api/team', method: 'GET' }
