import { supabase } from './browser-supabase.js'

function bind(formId, identifierId, passwordId, messageId, role) {
  const form = document.getElementById(formId)
  if (!form) return
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const identifier = document.getElementById(identifierId)
    const password = document.getElementById(passwordId)
    const message = document.getElementById(messageId)
    const value = identifier.value.replace(/\s/g, '')
    const valid = role === 'admin' ? /^\d{8}$/.test(value) : /^\d{11}$/.test(value)
    if (!valid || !password.value) {
      message.textContent = role === 'admin' ? 'Enter your 8-digit admin ID and password.' : 'Enter your 11-digit account number and password.'
      return
    }
    const button = form.querySelector('button[type="submit"]')
    button.disabled = true
    message.textContent = 'Signing you in…'
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, identifier: value, password: password.value }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        message.textContent = response.status === 401 ? 'That ID and password do not match.' : 'We could not sign you in right now. Please try again.'
        button.disabled = false
        return
      }
      const { error } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token })
      if (error) throw error
    } catch {
      message.textContent = 'We could not sign you in right now. Please try again.'
      button.disabled = false
      return
    }
    window.location.assign(`/dashboard/?login=${role}`)
  }, true)
}

bind('adminLoginForm', 'adminId', 'adminPw', 'adminLoginMsg', 'admin')
bind('loginForm', 'acct', 'pw', 'loginMsg', 'member')
