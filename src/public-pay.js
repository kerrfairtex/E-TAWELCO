import { supabase } from './browser-supabase.js'

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e }

function bindPay() {
  const form = document.getElementById('payForm')
  if (!form) return
  const msg = document.getElementById('payMsg')
  const result = document.getElementById('payResult')
  const button = document.getElementById('payBtn')
  let busy = false

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (busy) return
    msg.textContent = ''
    result.hidden = true
    result.replaceChildren()
    busy = true
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    try {
      const { data } = supabase ? await supabase.auth.getSession() : { data: null }
      const token = data && data.session ? data.session.access_token : null
      if (!token) {
        msg.replaceChildren(document.createTextNode('Sign in with your email to check your bill. '), Object.assign(el('a', 'Sign in'), { href: '/dashboard/' }))
        return
      }
      const response = await fetch('/api/bills?scope=mine', { headers: { Authorization: `Bearer ${token}` } })
      const json = await response.json().catch(() => ({}))
      if (response.status === 401) {
        msg.replaceChildren(document.createTextNode('Your session has ended. '), Object.assign(el('a', 'Sign in again'), { href: '/dashboard/' }))
        return
      }
      if (!response.ok) { msg.textContent = 'We could not load your bill right now. Please try again.'; return }
      if (!json.linked) { msg.textContent = 'No account number is linked to your profile yet. Ask the cooperative to link it.'; return }
      const s = json.summary || {}
      result.appendChild(el('p', `Unpaid: ${s.unpaid_count || 0} bill(s), ${peso(s.unpaid_total || 0)}${s.overdue_count ? ` · Overdue: ${s.overdue_count} (${peso(s.overdue_total || 0)})` : ''}`, 'bill-summary'))
      const list = (json.bills || []).slice(0, 3)
      if (!list.length) result.appendChild(el('p', 'No bills found for your account yet.'))
      for (const b of list) {
        const status = b.status === 'paid' ? 'Paid' : b.overdue ? 'Overdue' : 'Unpaid'
        result.appendChild(el('p', `${b.period} · ${peso(b.amount)} · due ${b.due_date} · ${status}`))
      }
      result.appendChild(Object.assign(el('a', 'Open your dashboard to pay online'), { href: '/dashboard/' }))
      result.hidden = false
    } catch {
      msg.textContent = 'We could not load your bill right now. Please try again.'
    } finally {
      busy = false
      button.disabled = false
      button.removeAttribute('aria-busy')
    }
  }, true)
}

bindPay()
