import { createClient } from '@supabase/supabase-js'

const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null

const configurationError = () => new Error('Dashboard authentication is not configured. Please contact the administrator.')
const authClient = () => {
  if (!supabase) throw configurationError()
  return supabase
}
const identityForLogin = (value) => {
  const id = value.trim()
  if (/^\d{8}$/.test(id)) return `${id}@admin.tawelco.local`
  if (/^\d{11}$/.test(id)) return `${id}@member.tawelco.local`
  return id
}
const authError = (error) => ({ status: error?.status, message: error?.message })
const requestedRole = new URLSearchParams(location.search).get('login')
const login = async (identifier, password) => {
  const { data, error } = await authClient().auth.signInWithPassword({ email: identityForLogin(identifier), password })
  if (error) throw authError(error)
  return data.session
}
const logout = () => authClient().auth.signOut()
const refreshSession = async () => { const { data } = await authClient().auth.getSession(); return data.session }
const getUser = async () => { const { data } = await authClient().auth.getUser(); return data.user }
const onAuthChange = (callback) => authClient().auth.onAuthStateChange((event) => callback(event.toLowerCase()))
const requestPasswordRecovery = (email) => authClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/dashboard/` })
const updateUser = (attributes) => authClient().auth.updateUser(attributes)

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const REPORT_STATUS = { received: 'Received', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved' }
const AREA_STATUS = { steady: 'Steady', limited: 'Limited hours', outage: 'Outage reported' }
const ROLE_LABEL = { member: 'Member', staff: 'Staff', admin: 'Admin' }
const OBSERVATIONS = ['No power at my house', 'Whole street is out', 'Fallen line', 'Flickering']

const badge = (kind, map) => `<span class="badge b-${esc(kind)}">${esc(map[kind] ?? kind)}</span>`
const fmtNum = (n) => new Intl.NumberFormat('en-PH').format(n ?? 0)
const fmtDate = (d) => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
const fmtDay = (d, opts = { month: 'short', day: 'numeric' }) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', opts)
const ago = (d) => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

const state = { session: null, profile: null, areas: [], team: null }
const isStaff = () => state.session && state.session.role !== 'member'
const isAdmin = () => state.session?.role === 'admin'

// ---------- API ----------
async function api(path, opts = {}) {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  const headers = new Headers(opts.body ? { 'Content-Type': 'application/json' } : undefined)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) { showAuth(); throw new Error('Please log in again') }
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`)
  return data
}

const setMsg = (el, text, kind = 'err') => { el.textContent = text; el.className = `msg ${text ? kind : ''}` }

async function busy(btn, fn) {
  btn.disabled = true
  try { return await fn() } finally { btn.disabled = false }
}

function authMessage(error) {
  if (error?.status === 401 || error?.status === 400) return 'That ID and password do not match.'
  if (error?.status === 403) return 'This account is not permitted to sign in.'
  if (error?.status === 422) return 'Check the account details and password requirements.'
  return error?.message || 'Something went wrong. Please try again.'
}

// ---------- Auth views ----------
function showTab(name) {
  $$('#auth [data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name })
  $$('#authTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)))
  $('#authTabs').hidden = name === 'setpw'
  $(`#auth [data-panel="${name}"] input`)?.focus()
}

function showAuth(tab = 'login') {
  state.session = null
  $('#loading').hidden = true
  $('#app').hidden = true
  $('#who').hidden = true
  $('#auth').hidden = false
  showTab(tab)
}

  $$('#authTabs [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))
  $$('[data-tab-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tabGo)))
  const loginIntent = new URLSearchParams(location.search).get('login')
  if (loginIntent === 'admin' || loginIntent === 'member') {
  showTab('login')
  $('#lEmail').focus()
  }
  
  $('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault()
  const msg = $('.msg', e.target)
  const email = $('#lEmail').value.trim(), pw = $('#lPw').value
  if (!email || !pw) return setMsg(msg, 'Enter your email and password.')
  busy($('button[type=submit]', e.target), async () => {
    try {
      await login(email, pw)
      setMsg(msg, '')
      await start()
    } catch (err) {
      setMsg(msg, authMessage(err))
    }
  })
})

$('#signupForm').addEventListener('submit', (e) => {
  e.preventDefault()
  const msg = $('.msg', e.target)
  const name = $('#sName').value.trim(), email = $('#sEmail').value.trim(), pw = $('#sPw').value
  if (!name || !email) return setMsg(msg, 'Enter your name and email.')
  if (pw.length < 8) return setMsg(msg, 'Choose a password of at least 8 characters.')
  busy($('button[type=submit]', e.target), async () => {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name, role: 'member' }, emailRedirectTo: `${location.origin}/dashboard/` } })
      if (error) throw authError(error)
      if (data.session) await start()
      else { e.target.reset(); setMsg(msg, 'Check your email for a link to confirm your account.', 'ok') }
    } catch (err) { setMsg(msg, authMessage(err)) }
  })
})

$('#forgotForm').addEventListener('submit', (e) => {
  e.preventDefault()
  const msg = $('.msg', e.target)
  const email = $('#fEmail').value.trim()
  if (!email) return setMsg(msg, 'Enter your email.')
  busy($('button[type=submit]', e.target), async () => {
    try { await requestPasswordRecovery(email); setMsg(msg, 'If that email has an account, a reset link is on its way.', 'ok') } catch (err) { setMsg(msg, authMessage(err)) }
  })
})

let inviteToken = null
$('#setPwForm').addEventListener('submit', (e) => {
  e.preventDefault()
  const msg = $('.msg', e.target)
  const pw = $('#nPw').value
  if (pw.length < 8) return setMsg(msg, 'Choose a password of at least 8 characters.')
  busy($('button[type=submit]', e.target), async () => {
    try {
      if (inviteToken) { await acceptInvite(inviteToken, pw); inviteToken = null } else await updateUser({ password: pw })
      await start()
    } catch (err) { setMsg(msg, authMessage(err)) }
  })
})

$('#logoutBtn').addEventListener('click', async () => {
  try { await logout() } catch {}
  location.hash = ''
  showAuth()
})

onAuthChange((event) => { if (event === 'logout' && state.session) showAuth() })

// ---------- Charts ----------
// Single-series column chart (one hue), baseline-anchored with 4px rounded tops and a hover tooltip per column.
function columnChart(points, { label, height = 200 }) {
  const W = 640, H = height, pad = { t: 18, r: 8, b: 26, l: 30 }
  const max = Math.max(1, ...points.map((p) => p.value))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const slot = iw / points.length, bw = Math.max(4, Math.min(28, slot - 2))
  const y = (v) => pad.t + ih - (v / top) * ih
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const maxIdx = points.reduce((m, p, i) => (p.value > points[m].value ? i : m), 0)

  const grid = ticks.map((v) => `<line class="${v ? 'gridline' : 'baseline'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
    <text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')
  const bars = points.map((p, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2, h = (p.value / top) * ih, yb = pad.t + ih
    const showX = points.length <= 8 || i % 2 === (points.length - 1) % 2
    return `<g data-i="${i}">
      <rect class="hit" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih + pad.b}"/>
      ${p.value ? `<path class="bar" d="${roundedTop(x, yb, bw, h)}"/>` : ''}
      ${i === maxIdx && p.value ? `<text class="val" x="${x + bw / 2}" y="${y(p.value) - 6}" text-anchor="middle">${p.value}</text>` : ''}
      ${showX ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(p.short)}</text>` : ''}
    </g>`
  }).join('')

  return `<div class="chart" data-chart>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><g class="axis">${grid}${bars}</g></svg>
    <div class="tip" hidden></div>
  </div>
  ${tableView(['Day', 'Reports'], points.map((p) => [p.long, p.value]))}`
}

// Horizontal single-series bar chart, sorted, every bar direct-labeled (few bars, so labels don't crowd).
function barChart(rows, { label }) {
  const rowH = 30, W = 640, lw = 150, vw = 36
  const H = rows.length * rowH + 4
  const max = Math.max(1, ...rows.map((r) => r.value))
  const iw = W - lw - vw
  const bars = rows.map((r, i) => {
    const yy = i * rowH + 4, w = (r.value / max) * iw
    return `<g data-i="${i}">
      <rect class="hit" x="0" y="${yy}" width="${W}" height="${rowH}"/>
      <text class="lbl" x="${lw - 10}" y="${yy + rowH / 2 + 4}" text-anchor="end">${esc(r.label)}</text>
      ${r.value ? `<path class="bar" d="${roundedRight(lw, yy + 5, w, rowH - 10)}"/>` : ''}
      <text class="val" x="${lw + w + 6}" y="${yy + rowH / 2 + 4}">${r.value}</text>
    </g>`
  }).join('')
  return `<div class="chart" data-chart>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <line class="baseline" x1="${lw}" x2="${lw}" y1="0" y2="${H}"/>${bars}
    </svg>
    <div class="tip" hidden></div>
  </div>
  ${tableView(['Area', 'Open reports'], rows.map((r) => [r.label, r.value]))}`
}

function niceStep(max) {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag)
}
function roundedTop(x, yb, w, h) {
  const r = Math.min(4, h, w / 2)
  return `M${x},${yb}V${yb - h + r}Q${x},${yb - h} ${x + r},${yb - h}H${x + w - r}Q${x + w},${yb - h} ${x + w},${yb - h + r}V${yb}Z`
}
function roundedRight(x, y, w, h) {
  const r = Math.min(4, w, h / 2)
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
}
function tableView(head, rows) {
  return `<details class="as-table"><summary>Show as table</summary>
    <div class="table-wrap" style="margin-top:8px"><table><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`
}
function wireTips(root, tipFor) {
  $$('[data-chart]', root).forEach((chart, ci) => {
    const tip = $('.tip', chart), svg = $('svg', chart)
    $$('g[data-i]', svg).forEach((g) => {
      const show = () => {
        const bar = $('.bar', g)
        $$('.bar.on', svg).forEach((b) => b.classList.remove('on'))
        bar?.classList.add('on')
        const box = (bar ?? $('.hit', g)).getBoundingClientRect(), cb = chart.getBoundingClientRect()
        tip.innerHTML = tipFor(ci, Number(g.dataset.i))
        tip.style.left = `${box.left - cb.left + box.width / 2}px`
        tip.style.top = `${box.top - cb.top}px`
        tip.hidden = false
      }
      g.addEventListener('mouseenter', show)
      g.addEventListener('mouseleave', () => { tip.hidden = true; $('.bar', g)?.classList.remove('on') })
    })
  })
}

  // ---------- Views ----------
  async function auditView(view) {
    const stats = await api('/api/stats')
    view.innerHTML = `${head('Audit Log', 'Recent administrative actions recorded by the cooperative.')}
      <section class="card"><div class="card-head"><h2>Recent activity</h2><span class="small muted">Last 10 entries</span></div>
      ${stats.activity?.length ? `<ul class="activity">${stats.activity.map((a) => `<li><span><strong>${esc(a.actor_email)}</strong> ${esc(describeAction(a))}</span><span class="muted small">${esc(ago(a.created_at))}</span></li>`).join('')}</ul>` : '<p class="empty">No audit entries yet.</p>'}</section>`
  }

  async function unavailableAdminView(view, title, description) {
    view.innerHTML = `${head(title, description)}<section class="card"><h2>Module not connected</h2><p class="muted">This area is now reserved in the Admin dashboard, but the current project has no data model or API endpoint for it yet. The existing People, Outage reports, Service areas, and Audit Log modules are live.</p></section>`
  }

  const BILL_STATUS = { unpaid: 'Unpaid', overdue: 'Overdue', paid: 'Paid' }
  const PAY_CHANNEL = { office: 'Office counter', collector: 'Collector', mobile_wallet: 'Mobile wallet', bank: 'Bank' }
  const fmtPeso = (n) => `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`
  const fmtPeriod = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
  const billKind = (b) => (b.status === 'paid' ? 'paid' : b.overdue ? 'overdue' : 'unpaid')

  async function billingView(view) {
    if (!state.areas.length) state.areas = (await api('/api/areas')).areas
    view.innerHTML = `${head('Billing Oversight', 'Bills that members see when they check their amount on the public site.', '<button class="btn btn-primary" id="newBill" type="button">Add bill</button>')}
      <div id="billStats"></div>
      <form class="filters" id="billFilters" novalidate>
        <div class="field"><label for="bStatus">Status</label><select class="input" id="bStatus"><option value="">Any status</option>${Object.entries(BILL_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label for="bQ">Account or name</label><input class="input" id="bQ" autocomplete="off"></div>
      </form>
      <div id="billList"><p class="loading">Loading…</p></div>`

    let rows = []
    const load = async () => {
      const q = new URLSearchParams()
      if ($('#bStatus').value) q.set('status', $('#bStatus').value)
      if ($('#bQ').value.trim()) q.set('q', $('#bQ').value.trim())
      const { bills, summary } = await api(`/api/bills?${q}`)
      rows = bills
      $('#billStats').innerHTML = `<div class="bill-stats">
        <div class="card"><span class="small muted">Unpaid · ${fmtNum(summary.unpaid_count)} bills</span><strong>${esc(fmtPeso(summary.unpaid_total))}</strong></div>
        <div class="card"><span class="small muted">Overdue · ${fmtNum(summary.overdue_count)} bills</span><strong>${esc(fmtPeso(summary.overdue_total))}</strong></div>
        <div class="card"><span class="small muted">Collected this month</span><strong>${esc(fmtPeso(summary.collected_month))}</strong></div></div>`
      $('#billList').innerHTML = bills.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Account</th><th>Area</th><th>Period</th><th class="num">kWh</th><th class="num">Amount</th><th>Due</th><th>Status</th><th><span class="visually-hidden">Action</span></th></tr></thead>
        <tbody>${bills.map((b) => `<tr>
          <td><strong>${esc(b.account_name)}</strong><br><span class="small muted mono">${esc(b.account_no)}</span></td>
          <td>${b.area_name ? esc(b.area_name) : '<span class="muted">—</span>'}</td>
          <td>${esc(fmtPeriod(b.period))}</td>
          <td class="num">${esc(fmtNum(b.kwh))}</td>
          <td class="num">${esc(fmtPeso(b.amount))}</td>
          <td class="small">${esc(fmtDay(b.due_date, { month: 'short', day: 'numeric', year: 'numeric' }))}</td>
          <td>${badge(billKind(b), BILL_STATUS)}${b.status === 'paid' ? `<br><span class="small muted" title="${esc(fmtDate(b.paid_at))}">${b.payment_ref && b.payment_ref.startsWith('SIM-') ? '<span class="demo-tag" title="Simulated payment">DEMO</span> ' : ''}${esc(PAY_CHANNEL[b.paid_channel] ?? '')}${b.payment_ref ? ` · ${esc(b.payment_ref)}` : ''}</span>` : ''}</td>
          <td>${b.status === 'paid' ? `<button class="btn btn-secondary" type="button" data-reopen="${b.id}">Reopen</button>` : `<button class="btn btn-secondary" type="button" data-pay="${b.id}">Record payment</button>`}</td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="card empty">No bills match these filters.</div>'
    }

    const recordDialog = (bill) => {
      const body = openDialog('Record payment', `<form id="billPayForm" novalidate>
        <p class="small muted"><strong>${esc(bill.account_name)}</strong> · ${esc(bill.account_no)} · ${esc(fmtPeriod(bill.period))} · ${esc(fmtPeso(bill.amount))}</p>
        <div class="field"><label for="pChan">Paid through</label><select class="input" id="pChan" required><option value="">Choose one</option>${Object.entries(PAY_CHANNEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label for="pRef">Receipt or reference no. <span class="muted small">(optional)</span></label><input class="input" id="pRef" maxlength="60"></div>
        <button class="btn btn-primary" type="submit">Mark as paid</button><p class="msg" aria-live="polite"></p></form>`)
      const form = $('#billPayForm', body)
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const msg = $('.msg', form)
        if (!$('#pChan', form).value) return setMsg(msg, 'Choose how the bill was paid.')
        busy($('button[type=submit]', form), async () => {
          try {
            await api(`/api/bills/${bill.id}`, { method: 'PATCH', body: { status: 'paid', paid_channel: $('#pChan', form).value, payment_ref: $('#pRef', form).value.trim() } })
            dlg.close(); await load()
          } catch (err) { setMsg(msg, err.message) }
        })
      })
    }

    const createDialog = () => {
      const now = new Date()
      const body = openDialog('Add bill', `<form id="billForm" novalidate>
        <div class="grid-2">
          <div class="field"><label for="nAcct">Account number</label><input class="input" id="nAcct" inputmode="numeric" maxlength="11" autocomplete="off" required></div>
          <div class="field"><label for="nName">Account holder</label><input class="input" id="nName" maxlength="120" required></div>
          <div class="field"><label for="nArea">Island area</label><select class="input" id="nArea">${areaOptions('', 'No area')}</select></div>
          <div class="field"><label for="nPeriod">Billing month</label><input class="input" id="nPeriod" type="month" value="${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}" required></div>
          <div class="field"><label for="nKwh">kWh used</label><input class="input" id="nKwh" type="number" min="0" step="0.01" value="0"></div>
          <div class="field"><label for="nAmount">Amount (₱)</label><input class="input" id="nAmount" type="number" min="0" step="0.01" required></div>
          <div class="field"><label for="nDue">Due date</label><input class="input" id="nDue" type="date" required></div>
        </div>
        <button class="btn btn-primary" type="submit">Add bill</button><p class="msg" aria-live="polite"></p></form>`)
      const form = $('#billForm', body)
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const msg = $('.msg', form)
        const payload = { account_no: $('#nAcct', form).value.trim(), account_name: $('#nName', form).value.trim(), area_id: $('#nArea', form).value, period: $('#nPeriod', form).value, kwh: $('#nKwh', form).value, amount: $('#nAmount', form).value, due_date: $('#nDue', form).value }
        if (!/^\d{11}$/.test(payload.account_no)) return setMsg(msg, 'Account number must be 11 digits.')
        if (!payload.account_name || !payload.period || !payload.amount || !payload.due_date) return setMsg(msg, 'Fill in the name, month, amount and due date.')
        busy($('button[type=submit]', form), async () => {
          try { await api('/api/bills', { method: 'POST', body: payload }); dlg.close(); await load() } catch (err) { setMsg(msg, err.message) }
        })
      })
    }

    $('#newBill').addEventListener('click', createDialog)
    $('#bStatus').addEventListener('change', load)
    let timer
    $('#bQ').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300) })
    $('#billFilters').addEventListener('submit', (e) => e.preventDefault())
    $('#billList').addEventListener('click', async (e) => {
      const pay = e.target.closest('[data-pay]')
      if (pay) return recordDialog(rows.find((b) => String(b.id) === pay.dataset.pay))
      const reopen = e.target.closest('[data-reopen]')
      if (reopen && confirm('Mark this bill as unpaid again?')) {
        await busy(reopen, async () => { try { await api(`/api/bills/${reopen.dataset.reopen}`, { method: 'PATCH', body: { status: 'unpaid' } }); await load() } catch (err) { alert(err.message) } })
      }
    })
    await load()
  }

  const adminAlias = (view) => people(view)
  const repairAlias = (view) => outages(view)
  const VIEWS = {
    overview, outages, areas: areasView, people, profile: profileView,
    'manage-admins': adminAlias, 'add-users': async (view) => { await people(view); openAddUserDialog(view) }, 'repair-requests': repairAlias,
    complaints: (view) => unavailableAdminView(view, 'Complaints', 'Review and resolve member complaints.'),
    billing: billingView,
    'my-bills': myBillsView,
    gcash: (view) => unavailableAdminView(view, 'GCash Merchant', 'Manage GCash merchant reconciliation and settlement.'),
    audit: auditView,
    settings: (view) => unavailableAdminView(view, 'Master Settings', 'Configure cooperative-wide dashboard settings.'),
  }

function route() {
  let name = location.hash.replace('#', '') || 'overview'
  const link = $(`#sideNav [data-view="${name}"]`)
  if (!VIEWS[name] || !link || link.hidden) name = 'overview'
  $$('#sideNav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.view === name) || a.removeAttribute('aria-current'))
  $(`#sideNav [data-view="${name}"]`).setAttribute('aria-current', 'page')
  const view = $('#view')
  view.classList.remove('view-enter')
  void view.offsetWidth
  view.classList.add('view-enter')
  view.innerHTML = '<p class="loading">Loading…</p>'
  VIEWS[name](view).catch((err) => { view.innerHTML = `<div class="card"><p class="msg err">${esc(err.message)}</p></div>` })
}
window.addEventListener('hashchange', () => { if (state.session) route() })

const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions}</div>`

async function overview(view) {
  const stats = await api('/api/stats')
  const first = esc((state.profile?.full_name || state.session.email).split(/[\s@]/)[0])

  if (stats.scope === 'mine') {
    const { reports } = await api('/api/outages?scope=mine')
    const s = stats.byStatus
    const open = (s.received ?? 0) + (s.assigned ?? 0) + (s.in_progress ?? 0)
const area = state.areas.find((item) => item.id === state.profile?.area_id)
  const areaStatus = area ? badge(area.status, AREA_STATUS) : '<span class="muted">Add your island area</span>'
  const profileReady = Boolean(state.profile?.full_name && state.profile?.phone && state.profile?.area_id)
  view.innerHTML = `${head(`Hello, ${first}`, 'Stay informed, report issues, and follow every update in one place.', '<a class="btn btn-primary" href="#outages">Report an outage</a>')}
  <div class="stack">
  <section class="member-hero" aria-label="Member quick start">
    <div class="card">
      <h2>Power updates for your home</h2>
      <p class="muted">Tell us what is happening and the outage desk will keep your report moving. Add your area and phone number once to make future reports faster.</p>
      <div class="status-strip" aria-label="Your service area status"><div class="status-item"><span class="small muted">Your area</span><strong>${esc(area?.name || 'Not set')}</strong></div><div class="status-item"><span class="small muted">Current status</span><strong>${areaStatus}</strong></div><div class="status-item"><span class="small muted">Profile</span><strong>${profileReady ? 'Complete' : '<a href="#profile">Finish setup</a>'}</strong></div></div>
    </div>
    <div class="card"><h2>Next steps</h2><ul class="member-checklist"><li><span><a href="#outages">Report an outage</a><br><span class="small muted">Send location and issue details.</span></span></li><li><span><a href="#profile">Update your profile</a><br><span class="small muted">Keep your contact details ready.</span></span></li><li><span><a href="#outages">Check your reports</a><br><span class="small muted">Open a ticket for its timeline.</span></span></li></ul></div>
  </section>
  <div class="tiles">
          <div class="tile accent"><span class="tile-label">Open reports</span><span class="tile-num">${fmtNum(open)}</span><div class="tile-note">Being handled by the cooperative</div></div>
          <div class="tile"><span class="tile-label">Resolved</span><span class="tile-num">${fmtNum(s.resolved)}</span></div>
          <div class="tile"><span class="tile-label">Your island</span><span class="tile-num" style="font-size:1.35rem;margin-top:12px">${esc(areaName(state.profile?.area_id) || 'Not set')}</span>
            <div class="tile-note">${state.profile?.area_id ? areaBadge(state.profile.area_id) : '<a href="#profile">Add it to your profile</a>'}</div></div>
        </div>
        <section class="card"><div class="card-head"><h2>Recent reports</h2><a href="#outages" class="small">See all</a></div>
          ${reports.length ? reportTable(reports.slice(0, 5), false) : '<p class="empty">You have not reported an outage yet.</p>'}
        </section>
      </div>`
    bindReportRows(view)
    return
  }

  const t = stats.totals, s = stats.byStatus
  const daily = stats.daily.map((d) => ({ value: d.n, short: fmtDay(d.day, { day: 'numeric' }), long: fmtDay(d.day, { weekday: 'short', month: 'short', day: 'numeric' }) }))
  const byArea = stats.byArea.filter((a) => a.open > 0)
  const areaRows = (byArea.length ? byArea : []).slice(0, 8).map((a) => ({ label: a.name, value: a.open }))
  const total14 = daily.reduce((n, d) => n + d.value, 0)

  view.innerHTML = `${head(`Hello, ${first}`, `Cooperative-wide outage picture · updated ${esc(new Date().toLocaleTimeString('en-PH', { timeStyle: 'short' }))}`,
    '<button class="btn btn-secondary" type="button" id="refreshBtn">Refresh</button>')}
    <div class="stack">
      <div class="tiles">
        <div class="tile accent"><span class="tile-label">Open reports</span><span class="tile-num">${fmtNum(t.open)}</span><div class="tile-note">Not yet resolved</div></div>
        <div class="tile"><span class="tile-label">Unassigned</span><span class="tile-num">${fmtNum(t.unassigned)}</span><div class="tile-note">${t.unassigned ? '<a href="#outages">Assign a crew</a>' : 'Every open report has an owner'}</div></div>
        <div class="tile"><span class="tile-label">Assigned to you</span><span class="tile-num">${fmtNum(t.mine)}</span><div class="tile-note">Open and in your queue</div></div>
        <div class="tile"><span class="tile-label">New this week</span><span class="tile-num">${fmtNum(t.week)}</span><div class="tile-note">Last 7 days</div></div>
        <div class="tile"><span class="tile-label">Median time to resolve</span><span class="tile-num">${t.median_hours == null ? '–' : fmtNum(t.median_hours)}<span class="tile-unit">${t.median_hours == null ? '' : 'h'}</span></span><div class="tile-note">Reports from the last 30 days</div></div>
      </div>

      <section class="card" aria-labelledby="pipeTitle">
        <div class="card-head"><h2 id="pipeTitle">Report pipeline</h2><span class="small muted">All time</span></div>
        <div class="pipeline">${Object.keys(REPORT_STATUS).map((k) => `<div class="pipe">${badge(k, REPORT_STATUS)}<strong>${fmtNum(s[k])}</strong></div>`).join('')}</div>
      </section>

      <div class="cols">
        <section class="card" aria-labelledby="dailyTitle">
          <div class="card-head"><h2 id="dailyTitle">New reports, last 14 days</h2><span class="small muted">${fmtNum(total14)} total</span></div>
          ${columnChart(daily, { label: `New outage reports per day for the last 14 days, ${total14} in total` })}
        </section>
        <section class="card" aria-labelledby="areaTitle">
          <div class="card-head"><h2 id="areaTitle">Open reports by area</h2><a class="small" href="#areas">Service areas</a></div>
          ${areaRows.length ? barChart(areaRows, { label: 'Open outage reports per service area' }) : '<p class="empty">No open reports in any area.</p>'}
        </section>
      </div>

      <div class="cols">
        <section class="card" aria-labelledby="areaStatusTitle">
          <div class="card-head"><h2 id="areaStatusTitle">Service status</h2><a class="small" href="#areas">Update</a></div>
          <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
            ${Object.keys(AREA_STATUS).map((k) => `<div>${badge(k, AREA_STATUS)}<span class="tile-num" style="font-size:1.6rem">${fmtNum(stats.areaStatus[k])}</span><span class="tile-note">areas</span></div>`).join('')}
          </div>
        </section>
        ${isAdmin() ? `<section class="card" aria-labelledby="actTitle"><div class="card-head"><h2 id="actTitle">Recent activity</h2></div>
          ${stats.activity.length ? `<ul class="activity">${stats.activity.map((a) => `<li><span><strong>${esc(a.actor_email)}</strong> ${esc(describeAction(a))}</span><span class="muted small" title="${esc(fmtDate(a.created_at))}">${esc(ago(a.created_at))}</span></li>`).join('')}</ul>` : '<p class="empty">No staff activity yet.</p>'}
        </section>` : `<section class="card"><div class="card-head"><h2>Your queue</h2></div>
          <p>${t.mine ? `You have <strong>${fmtNum(t.mine)}</strong> open report${t.mine === 1 ? '' : 's'} assigned to you.` : 'Nothing is assigned to you right now.'}</p>
          <a class="btn btn-secondary" href="#outages">Open outage reports</a></section>`}
      </div>
    </div>`

  wireTips(view, (ci, i) => {
    // Chart order in the DOM: daily first, then area (if present).
    if (ci === 0) return `${esc(daily[i].long)} · <strong>${daily[i].value}</strong> report${daily[i].value === 1 ? '' : 's'}`
    return `${esc(areaRows[i].label)} · <strong>${areaRows[i].value}</strong> open`
  })
  $('#refreshBtn').addEventListener('click', () => route())
}

function describeAction(a) {
  if (a.action === 'outage.update') return `updated outage report #${a.entity_id}`
  if (a.action === 'area.update') return `updated ${areaName(a.entity_id) || a.entity_id}`
  if (a.action === 'user.role') return 'changed a user role'
  if (a.action === 'bill.create') return `added a bill for account ${a.details?.account_no ?? ''}`.trim()
  if (a.action === 'bill.paid') return `recorded a payment for account ${a.details?.account_no ?? ''}`.trim()
  if (a.action === 'bill.reopen') return `reopened a bill for account ${a.details?.account_no ?? ''}`.trim()
  return a.action
}

const areaName = (id) => state.areas.find((a) => a.id === id)?.name ?? ''
const areaBadge = (id) => { const a = state.areas.find((x) => x.id === id); return a ? badge(a.status, AREA_STATUS) : '' }
const areaOptions = (selected, blank = 'Choose an area') =>
  `<option value="">${esc(blank)}</option>${state.areas.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}`

function reportTable(rows, staff) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Ticket</th><th>Where</th><th>What</th><th>Status</th>${staff ? '<th>Assignee</th>' : ''}<th>Reported</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="clickable" tabindex="0" data-report="${r.id}">
      <td class="mono">${esc(r.ticket_no)}</td>
      <td><strong>${esc(r.barangay)}</strong><br><span class="small muted">${esc(r.area_name)}</span></td>
      <td>${esc(r.observation)}</td>
      <td>${badge(r.status, REPORT_STATUS)}</td>
      ${staff ? `<td>${r.assigned_to ? esc(r.assignee_name || r.assignee_email) : '<span class="muted">Unassigned</span>'}</td>` : ''}
      <td class="small" title="${esc(fmtDate(r.created_at))}">${esc(ago(r.created_at))}</td>
    </tr>`).join('')}</tbody></table></div>`
}

function bindReportRows(root, onChange) {
  $$('[data-report]', root).forEach((tr) => {
    const open = () => openReport(Number(tr.dataset.report), onChange)
    tr.addEventListener('click', open)
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } })
  })
}

async function outages(view) {
  const staff = isStaff()
  view.innerHTML = `${head('Outage reports', staff ? 'Triage, assign and resolve reports from every island.' : 'Report an outage and follow its progress.')}
    <div class="stack">
      ${staff ? '' : `<section class="card" aria-labelledby="newTitle"><div class="card-head"><div><h2 id="newTitle">Report an outage</h2><p class="small muted">Usually takes less than a minute. You can follow the ticket after sending it.</p></div></div>${reportForm()}</section>`}
      <section aria-labelledby="listTitle">
        <h2 id="listTitle" class="visually-hidden">Reports</h2>
        <form class="filters" id="filters">
          <div class="field"><label for="fStatus">Status</label><select class="input" id="fStatus"><option value="">Any status</option>${Object.entries(REPORT_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          ${staff ? `<div class="field"><label for="fArea">Area</label><select class="input" id="fArea">${areaOptions('', 'All areas')}</select></div>
          <label class="check"><input type="checkbox" id="fMine"> Assigned to me</label>` : ''}
        </form>
        <div id="list"><p class="loading">Loading…</p></div>
      </section>
    </div>`

  const load = async () => {
    const q = new URLSearchParams()
    if (!staff) q.set('scope', 'mine')
    if ($('#fStatus').value) q.set('status', $('#fStatus').value)
    if (staff && $('#fArea').value) q.set('area', $('#fArea').value)
    if (staff && $('#fMine').checked) q.set('assigned', 'me')
    const { reports } = await api(`/api/outages?${q}`)
    const list = $('#list')
    list.innerHTML = reports.length ? reportTable(reports, staff) : '<div class="card empty">No reports match these filters.</div>'
    bindReportRows(list, load)
  }
  $$('#filters select, #filters input').forEach((el) => el.addEventListener('change', load))
  if (!staff) bindReportForm(view, load)
  await load()
}

function reportForm() {
  const mine = state.profile?.area_id ?? ''
  return `<form id="reportForm" novalidate>
    <p class="small muted">Keep away from fallen lines. Your report goes to the cooperative's outage desk.</p>
    <div class="grid-2">
      <div class="field"><label for="rArea">Island area</label><select class="input" id="rArea" required>${areaOptions(mine)}</select></div>
      <div class="field"><label for="rBrgy">Barangay</label><span id="rBrgyWrap"></span></div>
      <div class="field"><label for="rObs">What do you see?</label><select class="input" id="rObs" required><option value="">Choose one</option>${OBSERVATIONS.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>
      <div class="field"><label for="rPhone">Phone for follow-up <span class="muted small">(optional)</span></label><input class="input" id="rPhone" inputmode="tel" autocomplete="tel" value="${esc(state.profile?.phone ?? '')}"></div>
    </div>
    <div class="field"><label for="rLandmark">Nearby landmark <span class="muted small">(optional)</span></label><input class="input" id="rLandmark" maxlength="200"></div>
    <button class="btn btn-primary" type="submit">Send report</button>
    <p class="msg" aria-live="polite"></p>
  </form>`
}

function bindReportForm(root, onDone) {
  const form = $('#reportForm', root)
  const renderBrgy = () => {
    const area = state.areas.find((a) => a.id === $('#rArea').value)
    $('#rBrgyWrap').innerHTML = area?.barangays?.length
      ? `<select class="input" id="rBrgy" required><option value="">Choose a barangay</option>${area.barangays.map((b) => `<option>${esc(b)}</option>`).join('')}</select>`
      : '<input class="input" id="rBrgy" maxlength="80" required>'
  }
  $('#rArea').addEventListener('change', renderBrgy)
  renderBrgy()
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const msg = $('.msg', form)
    const body = {
      area_id: $('#rArea').value, barangay: $('#rBrgy').value.trim(), observation: $('#rObs').value,
      phone: $('#rPhone').value.trim(), landmark: $('#rLandmark').value.trim(),
    }
    if (!body.area_id || !body.barangay || !body.observation) return setMsg(msg, 'Choose the area, barangay and what you see.')
    busy($('button[type=submit]', form), async () => {
      try {
        const { report } = await api('/api/outages', { method: 'POST', body })
        form.reset(); renderBrgy()
        setMsg(msg, `Report ${report.ticket_no} received. You can follow it below.`, 'ok')
        await onDone()
      } catch (err) { setMsg(msg, err.message) }
    })
  })
}

// ---------- Dialog ----------
const dlg = $('#dlg')
$('#dlgClose').addEventListener('click', () => dlg.close())
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
function openDialog(title, html) {
  $('#dlgTitle').textContent = title
  $('#dlgBody').innerHTML = html
  if (!dlg.open) dlg.showModal()
  return $('#dlgBody')
}

async function openReport(id, onChange) {
  const staff = isStaff()
  openDialog('Outage report', '<p class="loading">Loading…</p>')
  const [{ report, updates }, team] = await Promise.all([
    api(`/api/outages/${id}`),
    staff ? (state.team ? Promise.resolve(state.team) : api('/api/team').then((d) => (state.team = d.team))) : Promise.resolve([]),
  ]).catch((err) => { $('#dlgBody').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; throw err })

  const body = openDialog(`Report ${report.ticket_no}`, `
    <dl class="facts">
      <dt>Status</dt><dd>${badge(report.status, REPORT_STATUS)}</dd>
      <dt>Where</dt><dd>${esc(report.barangay)}, ${esc(report.area_name)}${report.landmark ? `<br><span class="small muted">Near ${esc(report.landmark)}</span>` : ''}</dd>
      <dt>What</dt><dd>${esc(report.observation)}</dd>
      ${staff ? `<dt>Reporter</dt><dd>${esc(report.reporter_email || 'Not signed in')}${report.phone ? ` · <a href="tel:${esc(report.phone)}">${esc(report.phone)}</a>` : ''}</dd>` : ''}
      <dt>Reported</dt><dd>${esc(fmtDate(report.created_at))}</dd>
    </dl>
    ${staff ? `<form id="updForm" class="card" style="padding:16px;margin-bottom:18px" novalidate>
      <h3 style="margin-bottom:12px">Update this report</h3>
      <div class="grid-2">
        <div class="field"><label for="uStatus">Status</label><select class="input" id="uStatus">${Object.entries(REPORT_STATUS).map(([k, v]) => `<option value="${k}"${k === report.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="uAssign">Assignee</label><select class="input" id="uAssign"><option value="">Unassigned</option>${team.map((m) => `<option value="${esc(m.id)}"${m.id === report.assigned_to ? ' selected' : ''}>${esc(m.full_name || m.email)}${m.id === state.session.id ? ' (you)' : ''}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="uNote">Note for the timeline <span class="muted small">(the reporter can see this)</span></label><textarea class="input" id="uNote" maxlength="1000"></textarea></div>
      <button class="btn btn-primary" type="submit">Save update</button>
      <p class="msg" aria-live="polite"></p>
    </form>` : ''}
    <h3 style="margin-bottom:12px">Timeline</h3>
    <ol class="timeline">${updates.map((u) => `<li><div>${badge(u.status, REPORT_STATUS)} <span class="small muted">${esc(fmtDate(u.created_at))}${u.author_name && u.author_role !== 'member' ? ` · ${esc(u.author_name)}` : ''}</span></div>${u.note ? `<p style="margin:6px 0 0">${esc(u.note)}</p>` : ''}</li>`).join('')}</ol>`)

  if (!staff) return
  $('#updForm', body).addEventListener('submit', (e) => {
    e.preventDefault()
    const msg = $('.msg', e.target)
    const payload = { status: $('#uStatus').value, note: $('#uNote').value.trim() }
    if (($('#uAssign').value || null) !== (report.assigned_to || null)) payload.assigned_to = $('#uAssign').value
    busy($('button[type=submit]', e.target), async () => {
      try {
        await api(`/api/outages/${id}`, { method: 'PATCH', body: payload })
        await openReport(id, onChange)
        onChange?.()
      } catch (err) { setMsg(msg, err.message) }
    })
  })
}

// ---------- Service areas ----------
async function areasView(view) {
  const { areas } = await api('/api/areas')
  state.areas = areas
  view.innerHTML = `${head('Service areas', 'Status, hours and notices shown to members for each island.')}
    <div class="table-wrap"><table>
      <thead><tr><th>Area</th><th>Status</th><th>Hours</th><th class="num">Rate / kWh</th><th>Notice</th><th>Updated</th><th><span class="visually-hidden">Edit</span></th></tr></thead>
      <tbody>${areas.map((a) => `<tr>
        <td><strong>${esc(a.name)}</strong><br><span class="small muted">${esc(a.source)}</span></td>
        <td>${badge(a.status, AREA_STATUS)}</td>
        <td>${esc(a.hours)}</td>
        <td class="num">₱${Number(a.rate).toFixed(2)}</td>
        <td class="small">${a.notice ? esc(a.notice) : '<span class="muted">None</span>'}</td>
        <td class="small muted" title="${esc(fmtDate(a.updated_at))}">${esc(ago(a.updated_at))}</td>
        <td><button class="btn btn-secondary btn-small" type="button" data-edit="${esc(a.id)}">Edit</button></td>
      </tr>`).join('')}</tbody></table></div>`
  $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => editArea(areas.find((a) => a.id === b.dataset.edit))))
}

function editArea(a) {
  const body = openDialog(`Edit ${a.name}`, `<form id="areaForm" novalidate>
    <div class="grid-2">
      <div class="field"><label for="aStatus">Status</label><select class="input" id="aStatus">${Object.entries(AREA_STATUS).map(([k, v]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="aRate">Rate per kWh (₱)</label><input class="input" id="aRate" type="number" min="0" max="1000" step="0.01" value="${esc(a.rate)}"></div>
      <div class="field"><label for="aHours">Service hours</label><input class="input" id="aHours" maxlength="120" value="${esc(a.hours)}"></div>
      <div class="field"><label for="aSource">Power source</label><input class="input" id="aSource" maxlength="200" value="${esc(a.source)}"></div>
    </div>
    <div class="field"><label for="aOffice">Office</label><input class="input" id="aOffice" maxlength="200" value="${esc(a.office)}"></div>
    <div class="field"><label for="aNotice">Notice for members <span class="muted small">(optional)</span></label><textarea class="input" id="aNotice" maxlength="300">${esc(a.notice ?? '')}</textarea></div>
    <button class="btn btn-primary" type="submit">Save changes</button>
    <p class="msg" aria-live="polite"></p>
  </form>`)
  $('#areaForm', body).addEventListener('submit', (e) => {
    e.preventDefault()
    const msg = $('.msg', e.target)
    const payload = {
      status: $('#aStatus').value, rate: Number($('#aRate').value), hours: $('#aHours').value,
      source: $('#aSource').value, office: $('#aOffice').value, notice: $('#aNotice').value,
    }
    busy($('button[type=submit]', e.target), async () => {
      try { await api(`/api/areas/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: payload }); dlg.close(); route() } catch (err) { setMsg(msg, err.message) }
    })
  })
}

// ---------- People (admin) ----------

const ensureAreas = async () => {
  if (state.areas && state.areas.length) { state.areasError = false; return }
  try {
    const { areas } = await api('/api/areas')
    state.areas = areas
    state.areasError = false
  } catch {
    state.areasError = true
  }
}

async function openAddUserDialog(view) {
  await ensureAreas()
  const body = openDialog('Add user', `<form id="addUserForm" novalidate>
    <div class="field"><label for="uType">Type</label><select class="input" id="uType" required><option value="">Choose one</option><option value="member">Member</option><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
    <div class="field"><label for="uName">Full name</label><input class="input" id="uName" maxlength="120" required></div>
    <div class="field"><label for="uId">Login ID</label><input class="input" id="uId" inputmode="numeric" autocomplete="off" required></div>
    <p class="small muted" id="uIdHint">Member account number must be 11 digits. Staff and admin IDs must be 8 digits.</p>
    <div class="field"><label for="uArea">Island area (optional)</label><select class="input" id="uArea">${areaOptions('', 'No area')}</select></div>
    <p class="small muted" id="uAreaError" hidden>Areas could not be loaded. You can still create the account and assign an area later.</p>
    <div class="field" id="uConfirmWrap" hidden><label for="uConfirm">Type the ID again to confirm</label><input class="input" id="uConfirm" inputmode="numeric" autocomplete="off" required></div>
    <button class="btn btn-primary" type="submit">Create account</button>
    <p class="msg" aria-live="polite"></p>
  </form>`)
  if (state.areasError) { const err = $("#uAreaError", body); if (err) err.hidden = false }
  const typeSelect = $('#uType', body)
  const idInput = $('#uId', body)
  const hint = $('#uIdHint', body)
  const confirmWrap = $('#uConfirmWrap', body)
  const updateHint = () => { hint.textContent = typeSelect.value === 'member' ? 'Member account number must be 11 digits.' : 'Staff and admin IDs must be 8 digits.'; confirmWrap.hidden = typeSelect.value !== 'admin' }
  typeSelect.addEventListener('change', updateHint)
  idInput.addEventListener('input', () => { const v = idInput.value.replace(/\s/g, ''); idInput.setCustomValidity(typeSelect.value === 'member' ? (/^\d{11}$/.test(v) ? '' : 'Must be 11 digits') : (/^\d{8}$/.test(v) ? '' : 'Must be 8 digits')); })
  typeSelect.addEventListener('change', () => idInput.dispatchEvent(new Event('input')))
  updateHint()
  body.addEventListener('submit', (e) => {
    e.preventDefault()
    const msg = $('.msg', body)
    const type = typeSelect.value
    const full_name = $('#uName', body).value.trim()
    const login_id = idInput.value.replace(/\s/g, '')
    const area_id = $('#uArea', body).value || null
    const confirm_id = $('#uConfirm', body)?.value.replace(/\s/g, '') ?? ''
    if (!type || !full_name || full_name.length < 2 || !login_id) return setMsg(msg, 'Type, name and login ID are required.')
    if (type === 'member' && !/^\d{11}$/.test(login_id)) return setMsg(msg, 'Member login ID must be 11 digits.')
    if (type !== 'member' && !/^\d{8}$/.test(login_id)) return setMsg(msg, 'Staff and admin login IDs must be 8 digits.')
    if (type === 'admin' && confirm_id !== login_id) return setMsg(msg, 'Type the ID again to confirm.')
    busy($('button[type=submit]', body), async () => {
      try {
        const result = await api('/api/users', { method: 'POST', body: { type, full_name, login_id, area_id, confirm_id } })
        body.innerHTML = `<div class="card"><h2>Account created</h2>
          <p><strong>Login ID:</strong> <code>${esc(result.login_id)}</code></p>
          <p><strong>One-time password:</strong></p>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="newUserPw" value="${esc(result.password)}" readonly style="font-family:monospace" readonly onclick="this.select()">
            <button class="btn btn-secondary" type="button" id="copyPw">Copy</button>
          </div>
          <p class="small muted">This password is shown once. Give it to the person privately. They should change it after signing in (My profile > Change password).</p>
          <button class="btn btn-secondary" type="button" id="refreshDir">Done - refresh directory</button>
        </div>`
        const pwEl = $('#newUserPw')
        if (pwEl) pwEl.addEventListener('click', () => pwEl.select())
        const copyEl = $('#copyPw')
        if (copyEl) copyEl.addEventListener('click', () => { navigator.clipboard.writeText(pwEl.value); setMsg($('.msg', body), 'Copied.', 'ok') })
        const refreshEl = body.querySelector('#refreshDir')
        if (refreshEl) refreshEl.addEventListener('click', () => { dlg.close(); people(view) })
      } catch (err) {
        setMsg(msg, err.message)
      }
    })
  })
}

async function people(view) {
  await ensureAreas()
  const { users } = await api('/api/users')
  const counts = users.reduce((m, u) => ({ ...m, [u.role]: (m[u.role] ?? 0) + 1 }), {})
  const render = (items) => {
    const query = ($('#peopleSearch', view)?.value || '').trim().toLowerCase()
    const role = $('#peopleRole', view)?.value || 'all'
    const filtered = items.filter((u) => {
      const text = `${u.full_name || ''} ${u.email} ${u.area_name || ''}`.toLowerCase()
      return (!query || text.includes(query)) && (role === 'all' || u.role === role)
    })
    $('#peopleCount', view).textContent = `${fmtNum(filtered.length)} ${filtered.length === 1 ? 'person' : 'people'}`
    $('#peopleRows', view).innerHTML = filtered.length ? filtered.map((u) => `<tr>
      <td><strong>${esc(u.full_name || '—')}</strong><br><span class="small muted">${esc(u.email)}</span></td>
      <td>${esc(u.area_name || '—')}</td>
      <td class="num">${fmtNum(u.reports)}</td>
      <td class="small muted" title="${esc(u.last_seen_at ? fmtDate(u.last_seen_at) : 'Not seen yet')}">${esc(u.last_seen_at ? ago(u.last_seen_at) : 'Never')}</td>
      <td>${u.id === state.session.id ? badge(u.role, ROLE_LABEL) + ' <span class="small muted">(you)</span>'
        : `<label class="visually-hidden" for="role-${esc(u.id)}">Role for ${esc(u.email)}</label>
           <select class="input role-select" id="role-${esc(u.id)}" data-user="${esc(u.id)}" data-was="${esc(u.role)}">
             ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}"${k === u.role ? ' selected' : ''}>${v}</option>`).join('')}
           </select>`}
        <span class="small" data-role-msg="${esc(u.id)}" aria-live="polite"></span></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No people match these filters.</td></tr>'
    $$('[data-user]', view).forEach((sel) => sel.addEventListener('change', async () => {
      const out = $(`[data-role-msg="${CSS.escape(sel.dataset.user)}"]`, view)
      sel.disabled = true
      try {
        await api(`/api/users/${encodeURIComponent(sel.dataset.user)}`, { method: 'PATCH', body: { role: sel.value } })
        const user = items.find((u) => u.id === sel.dataset.user)
        if (user) user.role = sel.value
        sel.dataset.was = sel.value
        out.textContent = 'Saved'; out.style.color = 'var(--ok)'
        state.team = null
      } catch (err) {
        sel.value = sel.dataset.was
        out.textContent = err.message; out.style.color = 'var(--err)'
      } finally { sel.disabled = false }
    }))
  }
  view.innerHTML = `${head('People', 'Manage access for members, outage staff and administrators.', '<button class="btn btn-secondary" type="button" id="peopleRefresh">Refresh</button>' + (isAdmin() ? ' <button class="btn btn-primary" type="button" id="addUserBtn">Add user</button>' : ''))}
    <div class="tiles admin-tiles" style="margin-bottom:20px">
      ${Object.keys(ROLE_LABEL).map((r) => `<button class="tile admin-tile" type="button" data-role-filter="${r}"><span class="tile-label">${ROLE_LABEL[r]}s</span><span class="tile-num">${fmtNum(counts[r])}</span><span class="tile-note">Filter people</span></button>`).join('')}
    </div>
    <section class="card admin-people-card">
      <div class="card-head"><div><h2>Directory</h2><p class="small muted" style="margin:4px 0 0">Role changes apply when the person's session refreshes.</p></div><span class="small muted" id="peopleCount"></span></div>
      <div class="filters" id="peopleFilters"><div class="field"><label for="peopleSearch">Search people</label><input class="input" id="peopleSearch" type="search" placeholder="Name, email or area"></div><div class="field"><label for="peopleRole">Role</label><select class="input" id="peopleRole"><option value="all">All roles</option>${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Area</th><th class="num">Reports</th><th>Last seen</th><th>Access</th></tr></thead><tbody id="peopleRows"></tbody></table></div>
    </section>`
  $('#peopleSearch', view).addEventListener('input', () => render(users))
  $('#peopleRole', view).addEventListener('change', () => render(users))
  $$('[data-role-filter]', view).forEach((tile) => tile.addEventListener('click', () => { $('#peopleRole', view).value = tile.dataset.roleFilter; render(users) }))
  $('#peopleRefresh', view).addEventListener('click', () => people(view))
  $('#addUserBtn', view).addEventListener('click', () => openAddUserDialog(view))
  render(users)
}

// ---------- Profile ----------
async function profileView(view) {
  const p = state.profile
  view.innerHTML = `${head('My profile', 'Used to prefill outage reports and show service news for your island.')}
    <section class="card" style="max-width:640px">
      <form id="profileForm" novalidate>
        <div class="field"><label>Email</label><div>${esc(p.email)} ${badge(p.role, ROLE_LABEL)}</div></div>
        <div class="grid-2">
          <div class="field"><label for="pName">Full name</label><input class="input" id="pName" maxlength="120" autocomplete="name" value="${esc(p.full_name ?? '')}"></div>
          <div class="field"><label for="pPhone">Phone</label><input class="input" id="pPhone" maxlength="30" inputmode="tel" autocomplete="tel" value="${esc(p.phone ?? '')}"></div>
        </div>
        <div class="field"><label for="pArea">Island area</label><select class="input" id="pArea">${areaOptions(p.area_id, 'Not set')}</select></div>
        <button class="btn btn-primary" type="submit">Save profile</button>
        <p class="msg" aria-live="polite"></p>
      </form>
      <p class="small muted" style="margin:8px 0 0">Member since ${esc(new Date(p.created_at).toLocaleDateString('en-PH', { dateStyle: 'long' }))}</p>
    </section>
    <section class="card" style="max-width:640px">
      <h2>Change password</h2>
      <form id="pwForm" novalidate>
        <div class="grid-2">
          <div class="field"><label for="pwNew">New password</label><input class="input" id="pwNew" type="password" autocomplete="new-password" minlength="10" required></div>
          <div class="field"><label for="pwConfirm">Confirm</label><input class="input" id="pwConfirm" type="password" autocomplete="new-password" minlength="10" required></div>
        </div>
        <button class="btn btn-primary" type="submit">Update password</button>
        <p class="msg" aria-live="polite"></p>
      </form>
    </section>`
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault()
    const msg = $('.msg', e.target)
    busy($('button[type=submit]', e.target), async () => {
      try {
        const { profile } = await api('/api/me', { method: 'PATCH', body: { full_name: $('#pName').value, phone: $('#pPhone').value, area_id: $('#pArea').value } })
        state.profile = profile
        renderWho()
        setMsg(msg, 'Profile saved.', 'ok')
      } catch (err) { setMsg(msg, err.message) }
    })
  })
  $('#pwForm').addEventListener('submit', (e) => {
    e.preventDefault()
    const msg = $('.msg', e.target)
    const pw = $('#pwNew').value, cpw = $('#pwConfirm').value
    if (pw.length < 10) return setMsg(msg, 'Password must be at least 10 characters.')
    if (pw !== cpw) return setMsg(msg, 'Passwords do not match.')
    busy($('button[type=submit]', e.target), async () => {
      try { await updateUser({ password: pw }); setMsg(msg, 'Password updated', 'ok'); $('#pwNew').value = ''; $('#pwConfirm').value = '' } catch (err) { setMsg(msg, err.message) }
    })
  })
}

async function myBillsView(view) {
  const data = await api('/api/bills?scope=mine')
  if (!data.linked) {
    view.innerHTML = `${head('My bills', 'Your current bill, due dates and payment history.')}
      <div class="stack">
        <section class="card"><h2>No account linked</h2><p class="muted">No account is linked to your profile yet. Ask the cooperative to link your account number.</p></section>
        ${paymentSamples()}
      </div>`
    return
  }
  const summary = data.summary ?? {}
  const bills = Array.isArray(data.bills) ? data.bills : []
  const account = data.account ?? {}
  view.innerHTML = `${head('My bills', 'Your current bill, due dates and payment history.')}
    <div class="stack">
      <section class="card">
        <div class="card-head"><h2>Account</h2><span class="small muted mono">${esc(account.masked_no ?? '')}</span></div>
        <p class="muted">${account.name ? esc(account.name) : 'No name on the latest bill.'}</p>
      </section>
      <div class="bill-stats">
        <div class="card"><span class="small muted">Amount unpaid</span><strong>${esc(fmtPeso(summary.unpaid_total))}</strong></div>
        <div class="card"><span class="small muted">Unpaid bills</span><strong>${esc(fmtNum(summary.unpaid_count))}</strong></div>
        <div class="card"><span class="small muted">Overdue amount</span><strong>${esc(fmtPeso(summary.overdue_total))}</strong></div>
      </div>
      <section class="card">
        <div class="card-head"><h2>Your bills</h2><span class="small muted">${esc(fmtNum(bills.length))} shown</span></div>
        ${bills.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Due date</th><th class="num">Amount</th><th>Status</th><th>Paid on</th><th></th></tr></thead>
        <tbody>${bills.map((b) => `<tr>
          <td>${esc(fmtPeriod(b.period))}</td>
          <td class="small">${esc(fmtDay(b.due_date, { month: 'short', day: 'numeric', year: 'numeric' }))}</td>
          <td class="num">${esc(fmtPeso(b.amount))}</td>
          <td>${badge(billKind(b), BILL_STATUS)}</td>
          <td class="small">${b.paid_at ? esc(fmtDate(b.paid_at)) : '<span class="muted">—</span>'}</td>
          <td class="num">${b.status === 'unpaid' && data.pay?.enabled ? `<button class="btn btn-primary" type="button" data-pay-bill="${esc(b.id)}">Pay</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="card empty">No bills yet.</div>'}
      </section>
      ${paymentSamples()}
    </div>`
}
    // Attach Pay button event listeners
    $$('[data-pay-bill]', view).forEach((button) => {
      button.addEventListener('click', () => {
        const bill = (data.bills || []).find((b) => String(b.id) === button.dataset.payBill)
        if (bill) startSimulate(bill)
      })
    })

function paymentSamples() {
  return `<section class="card">
    <div class="card-head"><h2>Online payment</h2></div>
    <p class="muted">Pay your bill online during this demo. Select an unpaid bill below and follow the simulated checkout. No real money is transferred.</p>
  </section>`
}

function checkoutUI(bill, onConfirm) {
  return `<div class="demo-checkout" id="demoCheckout">
    <div class="demo-overlay"></div>
    <div class="demo-modal">
      <div class="demo-banner">DEMO — No real money</div>
      <div class="card-head"><h2>Pay bill — ${esc(fmtPeriod(bill.period))}</h2></div>
      <div class="demo-amount"><strong>${esc(fmtPeso(bill.amount))}</strong></div>
      <label class="small muted">Payment method</label>
      <div class="pay-choose">
        <button type="button" class="demo-method" data-method="gcash" aria-pressed="true">GCash</button>
        <button type="button" class="demo-method" data-method="maya">Maya</button>
        <button type="button" class="demo-method" data-method="card">Card</button>
      </div>
      <div class="demo-fields">
        <div class="field"><label>Mobile number (demo)</label><input class="input" type="text" value="" readonly style="background:#f5f5f5"></div>
        <div class="field"><label>Account number (demo)</label><input class="input" type="text" value="" readonly style="background:#f5f5f5"></div>
      </div>
      <button type="button" class="btn btn-primary demo-pay-btn" style="width:100%">Pay ${esc(fmtPeso(bill.amount))}</button>
    </div>
  </div>`
}

async function startSimulate(bill) {
  const modal = checkoutUI(bill)
  const div = document.createElement('div')
  div.innerHTML = modal.trim()
  document.body.appendChild(div)
  
  // Set fake fields
  const methodBtn = div.querySelector('[data-method]')
  let selectedMethod = 'gcash'
  div.querySelectorAll('.demo-method').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('.demo-method').forEach(b => b.setAttribute('aria-pressed', 'false'))
      btn.setAttribute('aria-pressed', 'true')
      selectedMethod = btn.dataset.method
    })
  })
  
  div.querySelector('.demo-pay-btn').addEventListener('click', async () => {
    div.querySelector('.demo-pay-btn').disabled = true
    div.querySelector('.demo-pay-btn').textContent = 'Processing…'
    
    await new Promise(r => setTimeout(r, 1500))
    
    const result = await api('/api/simulate', { method: 'POST', body: { bill_id: Number(bill.id), method: selectedMethod } })
    if (result?.ok) {
      div.innerHTML = `<div class="demo-checkout"><div class="demo-overlay"></div><div class="demo-modal">
        <div class="demo-banner">DEMO — No real money</div>
        <div class="card-head"><h2>Payment successful</h2></div>
        <div class="demo-receipt">
          <div class="row"><span>Reference</span><strong>${esc(result.payment_ref)}</strong></div>
          <div class="row"><span>Amount</span><strong>${esc(fmtPeso(result.amount))}</strong></div>
          <div class="row"><span>Period</span><strong>${esc(fmtPeriod(bill.period))}</strong></div>
          <div class="row"><span>Method</span><strong>${esc(result.method)}</strong></div>
          <div class="row"><span>Paid on</span><strong>${esc(new Date().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</strong></div>
        </div>
        <button type="button" class="btn btn-primary demo-back" style="width:100%">Back to My bills</button>
      </div></div></div>`
      div.querySelector('.demo-back').addEventListener('click', () => {
        document.body.removeChild(div)
        myBillsView(document.querySelector('[data-view="my-bills"]'))
      })
    } else {
      div.innerHTML = `<div class="demo-checkout"><div class="demo-overlay"></div><div class="demo-modal">
        <div class="demo-banner">DEMO — No real money</div>
        <div class="card-head"><h2>Payment failed</h2></div>
        <p class="muted">${esc(result?.error || 'Something went wrong')}</p>
        <button type="button" class="btn btn-secondary demo-back" style="width:100%">Back to My bills</button>
      </div></div></div>`
      div.querySelector('.demo-back').addEventListener('click', () => {
        document.body.removeChild(div)
      })
    }
  })
}

// ---------- Boot ----------
function renderWho() {
  const p = state.profile
  $('#whoName').textContent = p.full_name || p.email
  const r = $('#whoRole')
  r.className = `badge b-${p.role}`
  r.textContent = ROLE_LABEL[p.role]
  $('#who').hidden = false
}

async function start() {
  const user = await getUser()
  if (!user) return showAuth()
  const { profile } = await api('/api/me')
  if (!profile) throw new Error('Your account profile is not available yet.')
  if (requestedRole && requestedRole !== profile.role) {
    await logout().catch(() => null)
    throw new Error(`This is a ${profile.role === 'admin' ? 'admin' : 'member'} account. Use the ${profile.role === 'admin' ? 'Admin' : 'Members'} login.`)
  }
  state.profile = { ...profile, email: user.email }
  state.areas = []
  state.session = { id: user.id, email: user.email, role: profile.role }
  $$('#sideNav [data-role]').forEach((a) => { a.hidden = a.dataset.role === 'admin' ? !isAdmin() : !isStaff() })
  renderWho()
  $('#loading').hidden = true
  $('#auth').hidden = true
  $('#app').hidden = false
  // Both roles share the shell, but each login always opens its own overview.
  if (!location.hash || location.hash === '#login' || location.hash === '#admin' || location.hash === '#member') {
    location.hash = '#overview'
  }
  route()
}

async function boot() {
  if (!hasSupabaseConfig) throw configurationError()
  await start()
}

boot().catch((err) => {
  $('#loading').textContent = err.message || 'Could not load the dashboard.'
})
