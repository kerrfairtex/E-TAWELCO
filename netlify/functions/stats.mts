import type { Config } from '@netlify/functions'
import { authorize, db, isStaff, json } from '../lib/core.mts'

// Summary numbers and series for the dashboard overview. Staff see the whole cooperative; members see their own reports.
export default async (req: Request) => {
  const s = await authorize(req)
  if (s instanceof Response) return s
  const sql = db().sql

  if (!isStaff(s)) {
    const rows = await sql`SELECT status, count(*)::int AS n FROM outage_reports WHERE reporter_id = ${s.id} GROUP BY status`
    return json({ scope: 'mine', byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])) })
  }

  const [byStatus, byArea, daily, [totals], areaStatus, activity] = await Promise.all([
    sql`SELECT status, count(*)::int AS n FROM outage_reports GROUP BY status`,
    sql`
      SELECT a.id, a.name, count(r.id)::int AS open
      FROM service_areas a
      LEFT JOIN outage_reports r ON r.area_id = a.id AND r.status <> 'resolved'
      GROUP BY a.id, a.name, a.sort_order
      ORDER BY open DESC, a.sort_order`,
    sql`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, count(r.id)::int AS n
      FROM generate_series((NOW() AT TIME ZONE 'Asia/Manila')::date - 13, (NOW() AT TIME ZONE 'Asia/Manila')::date, '1 day') d
      LEFT JOIN outage_reports r ON (r.created_at AT TIME ZONE 'Asia/Manila')::date = d
      GROUP BY d ORDER BY d`,
    sql`
      SELECT
        count(*) FILTER (WHERE status <> 'resolved')::int AS open,
        count(*) FILTER (WHERE status <> 'resolved' AND assigned_to IS NULL)::int AS unassigned,
        count(*) FILTER (WHERE status <> 'resolved' AND assigned_to = ${s.id})::int AS mine,
        count(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS week,
        (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM u.created_at - r.created_at) / 3600)::numeric, 1)::float
           FROM outage_reports r
           JOIN LATERAL (SELECT min(created_at) AS created_at FROM outage_updates
                         WHERE report_id = r.id AND status = 'resolved') u ON u.created_at IS NOT NULL
           WHERE r.created_at > NOW() - INTERVAL '30 days') AS median_hours
      FROM outage_reports`,
    sql`SELECT status, count(*)::int AS n FROM service_areas GROUP BY status`,
    s.role === 'admin'
      ? sql`SELECT actor_email, action, entity, entity_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 8`
      : Promise.resolve([]),
  ])

  return json({
    scope: 'all',
    totals,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    byArea,
    daily,
    areaStatus: Object.fromEntries(areaStatus.map((r) => [r.status, r.n])),
    activity,
  })
}

export const config: Config = { path: '/api/stats', method: 'GET' }
