import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
const identityForLogin = (value, role) => {
  const id = value.trim()
  return role === 'admin' ? `${id}@admin.tawelco.local` : `${id}@member.tawelco.local`
}

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
    const { error } = await supabase.auth.signInWithPassword({
      email: identityForLogin(value, role),
      password: password.value,
    })
    if (error) {
      message.textContent = 'That ID and password do not match.'
      button.disabled = false
      return
    }
    window.location.assign(`/dashboard/?login=${role}`)
  }, true)
}

bind('adminLoginForm', 'adminId', 'adminPw', 'adminLoginMsg', 'admin')
bind('loginForm', 'acct', 'pw', 'loginMsg', 'member')
