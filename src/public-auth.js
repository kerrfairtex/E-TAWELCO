import { supabase } from './browser-supabase.js'
import './public-pay.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function friendly(error) {
  const code = error?.code || ''
  const msg = String(error?.message || '').toLowerCase()
  if (error?.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch') || msg.includes('network')) return 'Network problem. Check your connection and try again.'
  if (error?.status === 429 || code === 'over_request_rate_limit' || msg.includes('rate limit')) return 'Too many attempts. Please wait a minute and try again.'
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'Please confirm your email address first. Check your inbox.'
  if (code === 'invalid_credentials' || error?.status === 400 || msg.includes('invalid login')) return 'That email and password do not match.'
  return 'We could not sign you in right now. Please try again.'
}

function bind(formId, emailId, passwordId, messageId, role, emailErrId, pwErrId) {
  const form = document.getElementById(formId)
  if (!form) return
  const emailEl = document.getElementById(emailId)
  const pwEl = document.getElementById(passwordId)
  const msgEl = document.getElementById(messageId)
  const emailErr = document.getElementById(emailErrId)
  const pwErr = document.getElementById(pwErrId)
  const button = form.querySelector('button[type="submit"]')
  const toggle = form.querySelector('.pw-toggle')
  const label = button.textContent
  let busy = false

  if (toggle) {
    toggle.addEventListener('click', () => {
      const show = pwEl.type === 'password'
      pwEl.type = show ? 'text' : 'password'
      toggle.textContent = show ? 'Hide' : 'Show'
      toggle.setAttribute('aria-pressed', String(show))
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
    })
  }

  const setInvalid = (el, errEl, text) => {
    if (errEl) errEl.textContent = text
    el.setAttribute('aria-invalid', String(Boolean(text)))
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (busy) return

    const email = emailEl.value.trim()
    const password = pwEl.value
    const emailMsg = !email ? 'Enter your email address.' : !EMAIL_RE.test(email) ? 'Enter a valid email, like name@gmail.com.' : ''
    const pwMsg = password ? '' : 'Enter your password.'
    setInvalid(emailEl, emailErr, emailMsg)
    setInvalid(pwEl, pwErr, pwMsg)
    msgEl.textContent = ''
    if (emailMsg || pwMsg) {
      ;(emailMsg ? emailEl : pwEl).focus()
      return
    }
    if (!supabase) {
      msgEl.textContent = 'Sign-in is not available right now. Please contact support.'
      return
    }

    busy = true
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    button.textContent = 'Signing in…'
    msgEl.textContent = 'Signing you in…'
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (error) {
      msgEl.textContent = friendly(error)
      busy = false
      button.disabled = false
      button.removeAttribute('aria-busy')
      button.textContent = label
      return
    }
    window.location.assign(`/dashboard/?login=${role}`)
  }, true)
}

bind('adminLoginForm', 'adminId', 'adminPw', 'adminLoginMsg', 'admin', 'adminIdErr', 'adminPwErr')
bind('loginForm', 'acct', 'pw', 'loginMsg', 'member', 'acctErr', 'pwErr')

function bindOutage() {
  const form = document.getElementById('outageForm')
  if (!form) return
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  let busy = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (busy) return
    const msg = document.getElementById('outageMsg')
    const brgyEl = document.getElementById('oBrgy')
    const brgyErr = document.getElementById('oBrgyErr')
    const emailEl = document.getElementById('oEmail')
    const button = form.querySelector('button[type="submit"]')
    const area_id = document.getElementById('oIsland').value
    const barangay = (brgyEl.value || '').trim()
    const observation = (form.querySelector('input[name="what"]:checked') || {}).value || ''
    const landmark = document.getElementById('oLandmark').value.trim()
    const email = emailEl.value.trim()
    const website = (document.getElementById('oWebsite') || {}).value || ''
    brgyErr.textContent = ''
    brgyEl.removeAttribute('aria-invalid')
    msg.textContent = ''
    if (!barangay) {
      brgyErr.textContent = 'Choose or enter a barangay.'
      brgyEl.setAttribute('aria-invalid', 'true')
      brgyEl.focus()
      return
    }
    if (email && !EMAIL_RE.test(email)) {
      msg.textContent = 'Enter a valid email, like name@gmail.com.'
      emailEl.focus()
      return
    }
    busy = true
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    const label = button.textContent
    button.textContent = 'Sending…'
    try {
      const headers = { 'Content-Type': 'application/json' }
      const { data } = supabase ? await supabase.auth.getSession() : { data: null }
      const token = data && data.session ? data.session.access_token : null
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch('/api/outages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ area_id, barangay, observation, landmark, email, website }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        msg.textContent = response.status === 400 && result.error ? result.error : 'We could not send your report right now. Please try again.'
        return
      }
      const ticket = result.report && result.report.ticket_no ? result.report.ticket_no : null
      form.reset()
      msg.textContent = `Report sent.${ticket ? ` Your ticket number is ${ticket}.` : ''} For urgent hazards, keep away from fallen lines and contact an authorized emergency service.`
    } catch {
      msg.textContent = 'We could not send your report right now. Please try again.'
    } finally {
      busy = false
      button.disabled = false
      button.removeAttribute('aria-busy')
      button.textContent = label
    }
  }, true)
}

bindOutage()
