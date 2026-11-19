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

function bind(formId, identifierId, passwordId, messageId, identifierErrId, pwErrId) {
  const form = document.getElementById(formId)
  if (!form) return
  const identifierEl = document.getElementById(identifierId)
  const pwEl = document.getElementById(passwordId)
  const msgEl = document.getElementById(messageId)
  const identifierErr = document.getElementById(identifierErrId)
  const pwErr = document.getElementById(pwErrId)
  const button = form.querySelector('button[type="submit"]')
  const toggle = form.querySelector('.pw-toggle')
  const label = button.textContent
  const setMessage = (message = '') => {
    msgEl.textContent = message
    msgEl.hidden = !message
  }
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

    const identifier = identifierEl.value.trim()
    const normalizedId = identifier.replace(/\s/g, '')
    const accountId = /^\d{8}$/.test(normalizedId) || /^\d{11}$/.test(normalizedId)
    const loginEmail = accountId
      ? `${normalizedId}@${normalizedId.length === 8 ? 'admin' : 'member'}.tawelco.local`
      : identifier
    const identifierMsg = !identifier
      ? 'Enter your email or account ID.'
      : !accountId && !EMAIL_RE.test(identifier)
        ? 'Enter a valid email or account ID.'
        : ''
    const password = pwEl.value
    const pwMsg = password ? '' : 'Enter your password.'
    setInvalid(identifierEl, identifierErr, identifierMsg)
    setInvalid(pwEl, pwErr, pwMsg)
    setMessage()
    if (identifierMsg || pwMsg) {
      ;(identifierMsg ? identifierEl : pwEl).focus()
      return
    }
    if (!supabase) {
      setMessage('Sign-in is not available right now. Please contact support.')
      return
    }

    busy = true
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    button.textContent = 'Signing in…'
    setMessage('Signing you in…')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })
      if (error) throw error
    } catch (error) {
      setMessage(friendly(error))
      busy = false
      button.disabled = false
      button.removeAttribute('aria-busy')
      button.textContent = label
      return
    }
    window.location.assign('/dashboard/?login=unified')
  }, true)
}

bind('loginForm', 'acct', 'pw', 'loginMsg', 'acctErr', 'pwErr')

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
