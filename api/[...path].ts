import { createClient } from '@supabase/supabase-js'; import { randomBytes } from 'node:crypto'
import { authorize, body, fail, handleApi, internalError, isStaff, json, oneOf, pathParts, readAreas, readProfile, statuses, areaStatuses, observations, supabase, text, withTicket, audit, type Session } from './_lib/core.js'



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
  await client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id)
  return json({ profile: await readProfile(client, s.id) })
}

async function team(req: Request, client: ReturnType<typeof supabase>) { const s = await authorize(req, ['staff', 'admin']); if (s instanceof Response) return s; const { data, error } = await client.from('profiles').select('id,email,full_name,role').in('role', ['staff', 'admin']).order('full_name'); if (error) throw error; return json({ team: data ?? [] }) }

async function users(req: Request, client: ReturnType<typeof supabase>, id?: string) { const s = await authorize(req, ['admin']); if (s instanceof Response) return s; if (req.method === 'GET') { const { data, error } = await client.from('profiles').select('id,email,full_name,role,area_id,created_at,last_seen_at,service_areas(name)').order('role').limit(500); if (error) throw error; return json({ users: data ?? [] }) }
  if (req.method === 'POST') {
    const b = await body(req)
    const type = oneOf(b.type, ['member', 'staff', 'admin'] as const)
    const full_name = text(b.full_name, 120)
    const login_id = text(b.login_id, 20).replace(/\s/g, '')
    const area_id = b.area_id ? text(b.area_id, 100) : null
    const confirm_id = text(b.confirm_id, 20).replace(/\s/g, '')
    if (!type || !full_name || full_name.length < 2 || !login_id) return fail('Type, name and login ID are required.')
    if (type === 'member' && !/^\d{11}$/.test(login_id)) return fail('Member login ID must be 11 digits.')
    if (type !== 'member' && !/^\d{8}$/.test(login_id)) return fail('Staff and admin login IDs must be 8 digits.')
    if (type === 'admin' && confirm_id !== login_id) return fail('Type the ID again to confirm.')
    if (area_id) { const { data: area } = await client.from('service_areas').select('id').eq('id', area_id).maybeSingle(); if (!area) return fail('Unknown area.') }
    const dup = type === 'member' ? (await client.from('profiles').select('id').eq('account_no', login_id).maybeSingle()).data : (await client.from('profiles').select('id').eq('admin_id', login_id).maybeSingle()).data
    if (dup) return fail('That ID is already in use', 409)
    const email = `${login_id}@${type === 'member' ? 'member' : 'admin'}.tawelco.local`
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    let password = ''
    const limit = 256 - (256 % pool.length)
    for (let i = 0; i < 14; i++) { let r; do { r = randomBytes(1)[0] } while (r >= limit); password += pool[r % pool.length] }
    const { data: created, error: createError } = await (client as any).auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: type }, user_metadata: { full_name } })
    const userId = created?.user?.id
    if (createError || !userId) {
      const msg = String(createError?.message || '')
      const dupErr = msg.includes('already') || msg.includes('exists') || msg.includes('duplicate')
      if (dupErr) return fail('That ID is already in use', 409)
      console.error('[v0] createUser failed for email ' + email + ': ' + msg)
      return fail('Could not create the account', 502)
    }
    const update: Record<string, unknown> = { full_name, role: type, updated_at: new Date().toISOString() }
    if (type === 'member') update.account_no = login_id
    else update.admin_id = login_id
    if (area_id) update.area_id = area_id
    else update.area_id = null
    const { error: updateError } = await client.from('profiles').update(update).eq('id', userId)
    if (updateError) {
      try { await (client as any).auth.admin.deleteUser(userId) } catch { /* best-effort cleanup */ }
      console.error('[v0] profile update failed for user ' + userId + ': ' + String(updateError.message))
      return fail('Could not create the account', 500)
    }
    // If the trigger-created profile wasn't found (0 rows affected), upsert instead
    const upserted = await client.from('profiles').upsert({ id: userId, email: `${login_id}@${type === 'member' ? 'member' : 'admin'}.tawelco.local`, ...update }, { onConflict: 'id' })
    if (upserted.error) {
      try { await (client as any).auth.admin.deleteUser(userId) } catch { /* best-effort cleanup */ }
      console.error('[v0] profile upsert failed for user ' + userId + ': ' + String(upserted.error.message))
      return fail('Could not create the account', 500)
    }
    const { data: profile, error: readError } = await client.from('profiles').select('id, full_name, role, account_no, admin_id, area_id').eq('id', userId).maybeSingle()
    if (readError || !profile || profile.role !== type || profile.full_name !== full_name || (type === 'member' && profile.account_no !== login_id) || (type !== 'member' && profile.admin_id !== login_id) || (area_id && profile.area_id !== area_id) || (!area_id && profile.area_id !== null)) {
      try { await (client as any).auth.admin.deleteUser(userId) } catch { /* best-effort cleanup */ }
      console.error('[v0] profile verification failed for user ' + userId + ': ' + String(readError?.message || 'profile data mismatch'))
      return fail('Could not create the account', 500)
    }
    await audit(client, s, 'user.create', 'profile', userId, { role: type, id_masked: '****' + login_id.slice(-4) })
    return json({ ok: true, id: userId, role: type, login_id, password }, 201)
  }
  if (req.method !== 'PATCH' || !id) return fail('Method not allowed', 405); if (id === s.id) return fail('You cannot change your own role'); const role = oneOf((await body(req)).role, ['member', 'staff', 'admin'] as const); if (!role) return fail('Role must be member, staff or admin'); const { data: profile } = await client.from('profiles').select('role').eq('id', id).maybeSingle(); if (!profile) return fail('User not found', 404); const { error } = await client.from('profiles').update({ role }).eq('id', id); if (error) throw error; await audit(client, s, 'user.role', 'profile', id, { from: profile.role, to: role }); return json({ ok: true, role }) }

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
  if (req.method !== 'PATCH' || !staff) return fail('You do not have access to this', 403); const b = await body(req); const status = oneOf(b.status, statuses); if (!status) return fail('Unknown status'); const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }; if (b.assigned_to !== undefined) { const assignee = text(b.assigned_to, 80); if (assignee) { const { data: member } = await client.from('profiles').select('id').eq('id', assignee).in('role', ['staff', 'admin']).maybeSingle(); if (!member) return fail('Assignee must be a staff member'); } patch.assigned_to = assignee || null } const { data: updated, error } = await client.from('outage_reports').update(patch).eq('id', id).select('id').maybeSingle(); if (error) throw error; if (!updated) return fail('Report not found', 404); await client.from('outage_updates').insert({ report_id: id, author_id: s.id, status, note: text(b.note, 1000) || null }); await audit(client, s, 'outage.update', 'outage_report', id, { status }); return json({ ok: true })
}

const payChannels = ['office', 'collector', 'mobile_wallet', 'bank'] as const
const todayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
const maskName = (name: string) => name.trim().split(/\s+/).map((p) => (p.length <= 1 ? p : p[0] + '*'.repeat(Math.min(p.length - 1, 6)))).join(' ')

async function bills(req: Request, client: ReturnType<typeof supabase>, id?: string) {
  const url = new URL(req.url)
  const today = todayManila()

  if (req.method === 'GET' && !id && url.searchParams.get('scope') === 'mine') {
    const s = await authorize(req); if (s instanceof Response) return s
    const { data: profile, error: profileError } = await client.from('profiles').select('account_no').eq('id', s.id).maybeSingle()
    if (profileError) throw profileError
    const linkedNo = typeof profile?.account_no === 'string' ? profile.account_no.trim() : ''
    const emptySummary = { unpaid_count: 0, unpaid_total: 0, overdue_count: 0, overdue_total: 0 }
    if (!linkedNo) return json({ linked: false, bills: [], summary: emptySummary })
    const { data, error } = await client.from('bills').select('id,period,kwh,amount,due_date,status,paid_at,paid_channel,account_name').eq('account_no', linkedNo).order('period', { ascending: false }).limit(24)
    if (error) throw error
    const list = (data ?? []).map((b: any) => ({
      id: b.id,
      period: b.period,
      kwh: Number(b.kwh),
      amount: Number(b.amount),
      due_date: b.due_date,
      status: b.status,
      paid_at: b.paid_at,
      paid_channel: b.paid_channel,
      overdue: b.status === 'unpaid' && b.due_date < today,
    }))
    const unpaid = list.filter((b) => b.status === 'unpaid')
    const summary = {
      unpaid_count: unpaid.length,
      unpaid_total: Math.round(unpaid.reduce((sum, b) => sum + b.amount, 0) * 100) / 100,
      overdue_count: unpaid.filter((b) => b.overdue).length,
      overdue_total: Math.round(unpaid.filter((b) => b.overdue).reduce((sum, b) => sum + b.amount, 0) * 100) / 100,
    }
    const latestName = (data ?? [])[0]?.account_name
    return json({
      linked: true,
      account: { masked_no: `*******${linkedNo.slice(-4)}`, name: latestName ? maskName(String(latestName)) : null },
      bills: list,
      summary,
      pay: { enabled: process.env.DEMO_PAYMENTS === 'true', demo: true },
    })
  }

  if (req.method === 'GET' && !id && url.searchParams.has('account_no')) {
    return fail('We could not find that account number.', 404)
  }

  const s = await authorize(req, ['admin']); if (s instanceof Response) return s

  if (req.method === 'GET' && !id) {
    const status = text(url.searchParams.get('status'), 10)
    const q = text(url.searchParams.get('q'), 40).replace(/[^\p{L}\p{N} ]/gu, '')
    let query = client.from('bills').select('*,service_areas(name)').order('due_date', { ascending: false }).order('id', { ascending: false }).limit(300)
    if (status === 'paid') query = query.eq('status', 'paid')
    else if (status === 'unpaid') query = query.eq('status', 'unpaid')
    else if (status === 'overdue') query = query.eq('status', 'unpaid').lt('due_date', today)
    if (q) query = query.or(`account_no.ilike.${q}%,account_name.ilike.%${q}%`)
    const [rows, all] = await Promise.all([query, client.from('bills').select('status,amount,due_date,paid_at').limit(5000)])
    if (rows.error) throw rows.error
    if (all.error) throw all.error
    const month = today.slice(0, 7)
    const summary = { unpaid_count: 0, unpaid_total: 0, overdue_count: 0, overdue_total: 0, collected_month: 0 }
    for (const b of all.data ?? []) {
      const amount = Number(b.amount)
      if (b.status === 'unpaid') {
        summary.unpaid_count++; summary.unpaid_total += amount
        if (b.due_date < today) { summary.overdue_count++; summary.overdue_total += amount }
      } else if (b.paid_at && new Date(b.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7) === month) summary.collected_month += amount
    }
    const round = (n: number) => Math.round(n * 100) / 100
    return json({
      bills: (rows.data ?? []).map((b: any) => ({ ...b, amount: Number(b.amount), kwh: Number(b.kwh), area_name: b.service_areas?.name ?? null, overdue: b.status === 'unpaid' && b.due_date < today })),
      summary: { ...summary, unpaid_total: round(summary.unpaid_total), overdue_total: round(summary.overdue_total), collected_month: round(summary.collected_month) },
    })
  }

  if (req.method === 'POST' && !id) {
    const b = await body(req)
    const accountNo = text(b.account_no, 20).replace(/\s/g, '')
    const accountName = text(b.account_name, 120)
    const period = text(b.period, 7)
    const dueDate = text(b.due_date, 10)
    const areaId = text(b.area_id, 40) || null
    const amount = Number(b.amount), kwh = b.kwh === undefined || b.kwh === '' ? 0 : Number(b.kwh)
    if (!/^\d{11}$/.test(accountNo)) return fail('Account number must be 11 digits')
    if (!accountName) return fail('Enter the account holder name')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail('Choose the billing month')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) return fail('Choose a due date')
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return fail('Enter a valid amount')
    if (!Number.isFinite(kwh) || kwh < 0 || kwh > 100_000) return fail('Enter valid kWh usage')
    if (areaId && !(await client.from('service_areas').select('id').eq('id', areaId).maybeSingle()).data) return fail('Unknown area')
    const { data, error } = await client.from('bills').insert({ account_no: accountNo, account_name: accountName, area_id: areaId, period, kwh, amount: Math.round(amount * 100) / 100, due_date: dueDate, created_by: s.id }).select('id').single()
    if (error) { if (error.code === '23505') return fail('A bill for this account and month already exists', 409); throw error }
    await audit(client, s, 'bill.create', 'bill', data.id, { account_no: accountNo, period, amount })
    return json({ ok: true, id: data.id }, 201)
  }

  if (req.method === 'PATCH' && id && /^\d+$/.test(id)) {
    const b = await body(req)
    const status = oneOf(b.status, ['unpaid', 'paid'] as const)
    if (!status) return fail('Status must be unpaid or paid')
    const { data: current } = await client.from('bills').select('id,account_no,period,status,amount').eq('id', id).maybeSingle()
    if (!current) return fail('Bill not found', 404)
    const now = new Date().toISOString()
    let patch: Record<string, unknown>
    if (status === 'paid') {
      const channel = oneOf(b.paid_channel, payChannels)
      if (!channel) return fail('Choose how the bill was paid')
      patch = { status, paid_at: now, paid_channel: channel, payment_ref: text(b.payment_ref, 60) || null, recorded_by: s.id, updated_at: now }
    } else patch = { status, paid_at: null, paid_channel: null, payment_ref: null, recorded_by: s.id, updated_at: now }
    const { error } = await client.from('bills').update(patch).eq('id', id)
    if (error) throw error
    await audit(client, s, status === 'paid' ? 'bill.paid' : 'bill.reopen', 'bill', id, { account_no: current.account_no, period: current.period, from: current.status, to: status, channel: patch.paid_channel ?? null })
    return json({ ok: true })
  }

  return fail('Method not allowed', 405)
}

async function paySimulate(req: Request, client: ReturnType<typeof supabase>, id?: string) {
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  if (process.env.DEMO_PAYMENTS !== 'true') return fail('Demo payments are not enabled', 404)
  const s = await authorize(req); if (s instanceof Response) return s
  const b = await body(req)
  const billId = Number(b.bill_id)
  if (!Number.isInteger(billId) || billId <= 0) return fail('Invalid bill', 400)
  const method = oneOf(b.method, ['gcash', 'maya', 'card'])
  if (!method) return fail('Invalid payment method', 400)
  const { data: profile, error: profileError } = await client.from('profiles').select('account_no').eq('id', s.id).maybeSingle()
  if (profileError) throw profileError
  const linkedNo = typeof profile?.account_no === 'string' ? profile.account_no.trim() : ''
  const { data: bill, error: billError } = await client.from('bills').select('id,period,amount,status,account_no').eq('id', billId).eq('account_no', linkedNo).maybeSingle()
  if (billError) throw billError
  if (!bill) return fail('Bill not found', 404)
  if (bill.status !== 'unpaid') return fail('Bill is already paid', 409)
  const amount = Number(bill.amount)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = String(Math.floor(100000 + Math.random() * 900000))
  const ref = `SIM-${date}-${rand}`
  const { data: updated, error: updateError } = await client.from('bills').update({ status: 'paid', paid_at: new Date().toISOString(), paid_channel: 'mobile_wallet', payment_ref: ref, recorded_by: s.id, updated_at: new Date().toISOString() }).eq('id', billId).eq('status', 'unpaid').select('id')
  if (updateError) throw updateError
  if (!updated || updated.length === 0) return fail('Bill was already paid', 409)
  await audit(client, s, 'payment.simulated', 'bill', billId, { bill_id: billId, amount, method, provider: 'simulate' })
  return json({ ok: true, payment_ref: ref, amount, period: bill.period, method })
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
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await authClient.auth.signInWithPassword({ email: `${identifier}@${role}.tawelco.local`, password })
  if (error || !data.session) return fail('That ID and password do not match.', 401)
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
}

export default {
  async fetch(req: Request) {
    try {
      const parts = pathParts(req)
      if (parts[1] === 'health') {
        return json({ ok: true, timestamp: new Date().toISOString(), uptime: process.uptime() })
      }
      if (parts[1] === 'login') return await login(req)
      const resource = parts[1]
      const id = parts[2]
      const known: readonly string[] = ['areas', 'me', 'team', 'users', 'stats', 'outages', 'bills', 'pay/simulate']
      if (!resource || !known.includes(resource)) return fail('Not found', 404)
      const client = supabase(req)
      if (resource === 'areas') return await areas(req, client, id)
      if (resource === 'me') return await me(req, client)
      if (resource === 'team') return await team(req, client)
      if (resource === 'users') return await users(req, client, id)
      if (resource === 'stats') return await stats(req, client)
      if (resource === 'outages') return await outages(req, client, id)
      if (resource === 'bills') return await bills(req, client, id)
      if (resource === 'pay/simulate') return await paySimulate(req, client, id)
      return fail('Not found', 404)
    } catch (error) {
      return internalError(error)
    }
  }
}
