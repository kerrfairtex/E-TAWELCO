import type { Config, Context } from '@netlify/functions'
import {
  audit, authorize, currentSession, db, fail, isStaff, json, oneOf, readBody, text, ticketNo,
} from '../lib/core.mts'

const STATUSES = ['received', 'assigned', 'in_progress', 'resolved'] as const
const OBSERVATIONS = ['No power at my house', 'Whole street is out', 'Fallen line', 'Flickering'] as const

const withTicket = <T extends { id: number; created_at: string }>(r: T) => ({ ...r, ticket_no: ticketNo(r.id, r.created_at) })

export default async (req: Request, context: Context) => {
  const sql = db().sql
  const id = context.params.id ? Number(context.params.id) : null

  // Anyone can report; signed-in members can follow their report from the dashboard.
  if (req.method === 'POST' && !id) {
    const s = await currentSession()
    const b = await readBody(req)
    const areaId = text(b.area_id, 40)
    const barangay = text(b.barangay, 80)
    const observation = oneOf(b.observation, OBSERVATIONS)
    const phone = text(b.phone, 30) || null
    const landmark = text(b.landmark, 200) || null
    const [area] = await sql`
      SELECT a.id, COALESCE((SELECT json_agg(name) FROM barangays WHERE area_id = a.id), '[]') AS barangays
      FROM service_areas a WHERE a.id = ${areaId}`
    if (!area) return fail('Choose an island area')
    if (!barangay || (area.barangays.length && !area.barangays.includes(barangay))) return fail('Choose a barangay in the selected area')
    if (!observation) return fail('Choose what you see')
    if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) return fail('Enter a valid phone number')

    const [report] = await sql`
      INSERT INTO outage_reports (reporter_id, area_id, barangay, landmark, observation, phone)
      VALUES (${s?.id ?? null}, ${area.id}, ${barangay}, ${landmark}, ${observation}, ${phone})
      RETURNING id, status, created_at`
    await sql`INSERT INTO outage_updates (report_id, author_id, status, note)
      VALUES (${report.id}, ${s?.id ?? null}, 'received', 'Report received')`
    return json({ report: withTicket(report), tracked: !!s }, 201)
  }

  const s = await authorize(req)
  if (s instanceof Response) return s
  const staff = isStaff(s)

  if (req.method === 'GET' && !id) {
    const url = new URL(req.url)
    const mine = !staff || url.searchParams.get('scope') === 'mine'
    const status = oneOf(url.searchParams.get('status'), STATUSES)
    const area = text(url.searchParams.get('area'), 40) || null
    const assigned = url.searchParams.get('assigned') === 'me' ? s.id : null
    const rows = await sql`
      SELECT r.id, r.area_id, a.name AS area_name, r.barangay, r.landmark, r.observation, r.status, r.created_at,
             r.updated_at, r.assigned_to, p.full_name AS assignee_name, p.email AS assignee_email,
             ${staff ? sql`r.phone, rp.email AS reporter_email` : sql`NULL AS phone, NULL AS reporter_email`}
      FROM outage_reports r
      JOIN service_areas a ON a.id = r.area_id
      LEFT JOIN profiles p ON p.identity_id = r.assigned_to
      LEFT JOIN profiles rp ON rp.identity_id = r.reporter_id
      WHERE (${mine} = FALSE OR r.reporter_id = ${s.id})
        AND (${status}::text IS NULL OR r.status = ${status})
        AND (${area}::text IS NULL OR r.area_id = ${area})
        AND (${assigned}::text IS NULL OR r.assigned_to = ${assigned})
      ORDER BY (r.status = 'resolved'), r.created_at DESC
      LIMIT 200`
    const counts = staff && !mine
      ? Object.fromEntries((await sql`SELECT status, count(*)::int AS n FROM outage_reports GROUP BY status`).map((c) => [c.status, c.n]))
      : undefined
    return json({ reports: rows.map(withTicket), counts })
  }

  if (!id || !Number.isInteger(id)) return fail('Not found', 404)
  const [report] = await sql`
    SELECT r.*, a.name AS area_name, rp.email AS reporter_email FROM outage_reports r
    JOIN service_areas a ON a.id = r.area_id
    LEFT JOIN profiles rp ON rp.identity_id = r.reporter_id
    WHERE r.id = ${id}`
  if (!report || (!staff && report.reporter_id !== s.id)) return fail('Report not found', 404)

  if (req.method === 'GET') {
    const updates = await sql`
      SELECT u.status, u.note, u.created_at, p.full_name AS author_name, p.role AS author_role
      FROM outage_updates u LEFT JOIN profiles p ON p.identity_id = u.author_id
      WHERE u.report_id = ${id} ORDER BY u.created_at`
    if (!staff) {
      delete report.reporter_email
      delete report.assigned_to
    }
    return json({ report: withTicket(report), updates })
  }

  if (req.method !== 'PATCH') return fail('Method not allowed', 405)
  if (!staff) return fail('You do not have access to this', 403)

  const b = await readBody(req)
  let status = b.status === undefined ? report.status : oneOf(b.status, STATUSES)
  if (!status) return fail('Unknown status')
  let assignedTo = report.assigned_to
  if (b.assigned_to !== undefined) {
    assignedTo = text(b.assigned_to, 80) || null
    if (assignedTo && !(await sql`SELECT 1 FROM profiles WHERE identity_id = ${assignedTo} AND role IN ('staff','admin')`).length) {
      return fail('Assignee must be a staff member')
    }
    if (assignedTo && status === 'received') status = 'assigned'
  }
  const note = text(b.note, 1000) || null
  if (status === report.status && assignedTo === report.assigned_to && !note) return fail('Nothing to update')

  await sql`UPDATE outage_reports SET status = ${status}, assigned_to = ${assignedTo}, updated_at = NOW() WHERE id = ${id}`
  await sql`INSERT INTO outage_updates (report_id, author_id, status, note) VALUES (${id}, ${s.id}, ${status}, ${note})`
  await audit(s, 'outage.update', 'outage_report', id, {
    from: report.status, to: status, assigned_to: assignedTo, note: !!note,
  })
  return json({ ok: true })
}

export const config: Config = { path: ['/api/outages', '/api/outages/:id'], method: ['GET', 'POST', 'PATCH'] }
