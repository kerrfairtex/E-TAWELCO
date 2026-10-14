import { createClient } from '@supabase/supabase-js'
import { authorize, body, fail, handleApi, internalError, isStaff, json, oneOf, pathParts, readAreas, readProfile, statuses, areaStatuses, observations, supabase, text, withTicket, audit, type Session } from './_lib/core.js'

export const runtime = 'nodejs'

async function areas(req: Request, client: ReturnType<typeof supabase>, id?: string) {
  if (req.method === 'GET') return json({ areas: await readAreas(client) })
  const s = await authorize(req, ['staff', 'admin']); if (s instanceof Response) return s
  if (req.method !== 'PATCH' || !id) return fail('Method not allowed', 405)
  const { data: current } = await client.from('service_areas').select('*').eq('id', id).maybeSingle()
  if (!current) return fail('Area not found', 404)
  const b = await body(req); const status = b.status === undefined ? current.status : oneOf(b.status, areaStatuses)
  const rate = b.rate === undefined ? Number(current.rate) : Number(b.rate)
  if (!status) return fail('Status must be steady, limited or outage')
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000) return fail('Rate must be a positive number')
  const patch = { status, rate, source: b.source === undefined ? current.source : text(b.source, 200) || 'To be confirmed', hours: b.hours === undefined ? current.hours : text(b.hours, 120) || 'To be confirmed', office: b.office === undefined ? current.office : text(b.office, 200) || 'To be confirmed', notice: b.notice === undefined ? current.notice : text(b.notice, 300) || null, updated_at: new Date().toISOString() }
  const { data, error } = await client.from('service_areas').update(patch).eq('id', id).select('id,name,status,source,rate,hours,office,notice,updated_at').single()
  if (error) throw error
  await audit(client, s, 'area.update', 'service_area', id, { before: current, after: patch })
  return json({ area: data })
}

async function me(req: Request, client: ReturnType<typeof supabase>) {
  const s = await authorize(req); if (s instanceof Response) return s
  const existing = await readProfile(client, s.id)
  if (!existing) {
    const { error } = await client.from('profiles').upsert({ id: s.id, email: s.email, full_name: s.name, role: 'member', updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) throw error
  }
  if (req.method === 'PATCH') { const b = await body(req); const areaId = text(b.area_id, 40) || null; if (areaId && !(await client.from('service_areas').select('id').eq('id', areaId).maybeSingle()).data) return fail('Unknown area'); const { error } = await client.from('profiles').update({ full_name: text(b.full_name, 120) || null, phone: text(b.phone, 30) || null, area_id: areaId, updated_at: new Date().toISOString() }).eq('id', s.id); if (error) throw error }
  return json({ profile: await readProfile(client, s.id) })
}

async function team(req: Request, client: ReturnType<typeof supabase>) { const s = await authorize(req, ['staff', 'admin']); if (s instanceof Response) return s; const { data, error } = await client.from('profiles').select('id,email,full_name,role').in('role', ['staff', 'admin']).order('full_name'); if (error) throw error; return json({ team: data ?? [] }) }

async function users(req: Request, client: ReturnType<typeof supabase>, id?: string) { const s = await authorize(req, ['admin']); if (s instanceof Response) return s; if (req.method === 'GET') { const { data, error } = await client.from('profiles').select('id,email,full_name,role,area_id,created_at,last_seen_at,service_areas(name)').order('role').limit(500); if (error) throw error; return json({ users: data ?? [] }) } if (req.method !== 'PATCH' || !id) return fail('Method not allowed', 405); if (id === s.id) return fail('You cannot change your own role'); const role = oneOf((await body(req)).role, ['member', 'staff', 'admin'] as const); if (!role) return fail('Role must be member, staff or admin'); const { data: profile } = await client.from('profiles').select('role').eq('id', id).maybeSingle(); if (!profile) return fail('User not found', 404); const { error } = await client.from('profiles').update({ role }).eq('id', id); if (error) throw error; await audit(client, s, 'user.role', 'profile', id, { from: profile.role, to: role }); return json({ ok: true, role }) }

async function stats(req: Request, client: ReturnType<typeof supabase>) {
  const s = await authorize(req)
  if (s instanceof Response) return s
  const byStatus: Record<string, number> = { received: 0, assigned: 0, in_progress: 0, resolved: 0 }
  if (!isStaff(s)) {
    const { data, error } = await client.from('outage_reports').select('status').eq('reporter_id', s.id)
    if (error) throw error
    for (const r of data ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    return json({ scope: 'mine', byStatus })
  }
  const [reports, areas, activity] = await Promise.all([
    client.from('outage_reports').select('status, area_id, assigned_to, created_at, updated_at'),
    client.from('service_areas').select('id, name, status'),
    s.role === 'admin' ? client.from('audit_log').select('actor_email, action, entity, entity_id, details, created_at').order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null }),
  ])
  if (reports.error) throw reports.error
  if (areas.error) throw areas.error
  if (activity.error) throw activity.error
  const rows = reports.data ?? []
  const now = Date.now(), day = 86_400_000
  const isOpen = (r: { status: string }) => r.status !== 'resolved'
  const openByArea = new Map<string, number>()
  const perDay = new Map<string, number>()
  const resolveHours: number[] = []
  const totals = { open: 0, unassigned: 0, mine: 0, week: 0, median_hours: null as number | null }
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    const created = new Date(r.created_at).getTime()
    if (isOpen(r)) {
      totals.open++
      if (!r.assigned_to) totals.unassigned++
      if (r.assigned_to === s.id) totals.mine++
      openByArea.set(r.area_id, (openByArea.get(r.area_id) ?? 0) + 1)
    } else if (now - created <= 30 * day) {
      resolveHours.push((new Date(r.updated_at).getTime() - created) / 3_600_000)
    }
    if (now - created <= 7 * day) totals.week++
    const key = new Date(created).toISOString().slice(0, 10)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }
  if (resolveHours.length) {
    resolveHours.sort((a, b) => a - b)
    const mid = Math.floor(resolveHours.length / 2)
    const median = resolveHours.length % 2 ? resolveHours[mid] : (resolveHours[mid - 1] + resolveHours[mid]) / 2
    totals.median_hours = Math.round(median * 10) / 10
  }
  const daily = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * day).toISOString().slice(0, 10)
    return { day: d, n: perDay.get(d) ?? 0 }
  })
  const areaStatus: Record<string, number> = { steady: 0, limited: 0, outage: 0 }
  for (const a of areas.data ?? []) areaStatus[a.status] = (areaStatus[a.status] ?? 0) + 1
  const byArea = (areas.data ?? []).map((a) => ({ id: a.id, name: a.name, open: openByArea.get(a.id) ?? 0 })).sort((a, b) => b.open - a.open)
  return json({ scope: 'all', byStatus, totals, daily, byArea, areaStatus, activity: activity.data ?? [] })
}

async function outages(req: Request, client: ReturnType<typeof supabase>, id?: string) {
  if (req.method === 'POST' && !id) { const s = await (async () => { const r = await authorize(req); return r instanceof Response ? null : r })(); const b = await body(req); const areaId = text(b.area_id, 40); const barangay = text(b.barangay, 80); const observation = oneOf(b.observation, observations); if (!areaId || !barangay || !observation) return fail('Choose an area, barangay and observation'); const phone = text(b.phone, 30) || null; if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) return fail('Enter a valid phone number'); const { data, error } = await client.from('outage_reports').insert({ reporter_id: s?.id ?? null, area_id: areaId, barangay, observation, phone, landmark: text(b.landmark, 200) || null }).select('id,status,created_at').single(); if (error) throw error; await client.from('outage_updates').insert({ report_id: data.id, author_id: s?.id ?? null, status: 'received', note: 'Report received' }); return json({ report: withTicket(data), tracked: !!s }, 201) }
  const s = await authorize(req); if (s instanceof Response) return s; const staff = isStaff(s)
  if (req.method === 'GET' && !id) { let q = client.from('outage_reports').select('*,service_areas(name)').order('created_at', { ascending: false }).limit(200); if (!staff || new URL(req.url).searchParams.get('scope') === 'mine') q = q.eq('reporter_id', s.id); const { data, error } = await q; if (error) throw error; return json({ reports: (data ?? []).map(withTicket) }) }
  if (!id) return fail('Not found', 404)
  if (req.method === 'GET') { const { data, error } = await client.from('outage_reports').select('*,service_areas(name)').eq('id', id).maybeSingle(); if (error) throw error; if (!data || (!staff && data.reporter_id !== s.id)) return fail('Report not found', 404); const { data: updates } = await client.from('outage_updates').select('*').eq('report_id', id).order('created_at'); return json({ report: withTicket(data), updates: updates ?? [] }) }
  if (req.method !== 'PATCH' || !staff) return fail('You do not have access to this', 403); const b = await body(req); const status = oneOf(b.status, statuses); if (!status) return fail('Unknown status'); const { error } = await client.from('outage_reports').update({ status, assigned_to: text(b.assigned_to, 80) || null, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; await client.from('outage_updates').insert({ report_id: id, author_id: s.id, status, note: text(b.note, 1000) || null }); await audit(client, s, 'outage.update', 'outage_report', id, { status }); return json({ ok: true })
}

async function login(req: Request) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  const b = await body(req)
  const role = b.role === 'admin' ? 'admin' : b.role === 'member' ? 'member' : null
  const identifier = text(b.identifier, 20).replace(/\s/g, '')
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : ''
  const valid = role === 'admin' ? /^\d{8}$/.test(identifier) : /^\d{11}$/.test(identifier)
  if (!role || !valid || !password) return fail('Enter your ID and password.')
  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await authClient.auth.signInWithPassword({ email: `${identifier}@${role}.tawelco.local`, password })
  if (error || !data.session) return fail('That ID and password do not match.', 401)
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
}

export default async function handler(req: Request) { try { if (pathParts(req)[1] === 'login') return await login(req); const { client, resource, id } = await handleApi(req); if (resource === 'areas') return await areas(req, client, id); if (resource === 'me') return await me(req, client); if (resource === 'team') return await team(req, client); if (resource === 'users') return await users(req, client, id); if (resource === 'stats') return await stats(req, client); if (resource === 'outages') return await outages(req, client, id); return fail('Not found', 404) } catch (error) { return internalError(error) } }
