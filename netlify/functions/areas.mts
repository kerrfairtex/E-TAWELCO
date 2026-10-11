import type { Config, Context } from '@netlify/functions'
import { audit, authorize, db, fail, json, oneOf, readBody, text } from '../lib/core.mts'

const STATUSES = ['steady', 'limited', 'outage'] as const

export default async (req: Request, context: Context) => {
  const sql = db().sql

  if (req.method === 'GET') {
    const areas = await sql`
      SELECT a.id, a.name, a.marker_name, a.status, a.source, a.rate::float AS rate, a.hours, a.office, a.notice,
             a.extra, a.updated_at,
             COALESCE((SELECT json_agg(b.name ORDER BY b.name) FROM barangays b WHERE b.area_id = a.id), '[]') AS barangays
      FROM service_areas a ORDER BY a.sort_order, a.name`
    return json({ areas })
  }

  if (req.method !== 'PATCH' || !context.params.id) return fail('Method not allowed', 405)
  const s = await authorize(req, ['staff', 'admin'])
  if (s instanceof Response) return s

  const [area] = await sql`SELECT * FROM service_areas WHERE id = ${context.params.id}`
  if (!area) return fail('Area not found', 404)

  const b = await readBody(req)
  const status = b.status === undefined ? area.status : oneOf(b.status, STATUSES)
  if (!status) return fail('Status must be steady, limited or outage')
  const rate = b.rate === undefined ? Number(area.rate) : Number(b.rate)
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000) return fail('Rate must be a positive number')
  const next = {
    status,
    rate,
    source: b.source === undefined ? area.source : text(b.source, 200) || 'To be confirmed',
    hours: b.hours === undefined ? area.hours : text(b.hours, 120) || 'To be confirmed',
    office: b.office === undefined ? area.office : text(b.office, 200) || 'To be confirmed',
    notice: b.notice === undefined ? area.notice : text(b.notice, 300) || null,
  }

  const [updated] = await sql`
    UPDATE service_areas SET status = ${next.status}, rate = ${next.rate}, source = ${next.source},
      hours = ${next.hours}, office = ${next.office}, notice = ${next.notice}, updated_at = NOW()
    WHERE id = ${area.id}
    RETURNING id, name, status, source, rate::float AS rate, hours, office, notice, updated_at`
  await audit(s, 'area.update', 'service_area', area.id, {
    before: { status: area.status, rate: Number(area.rate), hours: area.hours, notice: area.notice },
    after: { status: next.status, rate: next.rate, hours: next.hours, notice: next.notice },
  })
  return json({ area: updated })
}

export const config: Config = { path: ['/api/areas', '/api/areas/:id'], method: ['GET', 'PATCH'] }
