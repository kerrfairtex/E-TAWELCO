// Permission-map tests for E-TAWELCO role-based access control
// Run with: node tests/permissions.test.mjs
import { PERMISSIONS, canAccess, canAccessStaff, isUsable, STATUS, STATUS_LABEL } from '../src/dashboard/permissions.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try { fn(); passed++; console.log('  PASS: ' + name) }
  catch (e) { failed++; console.log('  FAIL: ' + name + ' — ' + e.message) }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed') }

console.log('\n=== Permission Map Tests ===\n')

// --- Structure tests ---
test('every route has REQUIRED fields', () => {
  for (const p of PERMISSIONS) {
    assert(p.id, `route missing id: ${p.id || '(none)'}`)
    assert(p.label, `route ${p.id} missing label`)
    assert(p.group, `route ${p.id} missing group`)
    assert(Array.isArray(p.allowedRoles), `route ${p.id} allowedRoles not array`)
    assert(p.allowedRoles.length > 0, `route ${p.id} has no allowed roles`)
    assert(p.allowedRoles.every(r => ['guest','member','staff','admin'].includes(r)),
      `route ${p.id} has invalid role in allowedRoles`)
    assert(p.status, `route ${p.id} missing status`)
    assert(p.apiActions, `route ${p.id} missing apiActions`)
  }
})

test('every route status is valid', () => {
  const valid = Object.keys(STATUS)
  for (const p of PERMISSIONS) {
    assert(valid.includes(p.status), `route ${p.id} has invalid status '${p.status}'`)
  }
})

test('every route has a unique id', () => {
  const ids = PERMISSIONS.map(p => p.id)
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i)
  assert(dups.length === 0, `duplicate route ids: ${dups.join(', ')}`)
})

// --- Access control tests ---
test('guest can access only guest routes', () => {
  for (const p of PERMISSIONS) {
    if (!p.allowedRoles.includes('guest')) {
      assert(!canAccess('guest', p.id), `guest should NOT access ${p.id}`)
    }
  }
})

test('member can access overview and outages (working routes)', () => {
  assert(canAccess('member', 'overview'), 'member should access overview')
  assert(canAccess('member', 'outages'), 'member should access outages')
  assert(canAccess('member', 'profile'), 'member should access profile')
})

test('member cannot access staff/admin routes', () => {
  assert(!canAccess('member', 'areas'), 'member should NOT access areas')
  assert(!canAccess('member', 'people'), 'member should NOT access people')
  assert(!canAccess('member', 'billing'), 'member should NOT access billing overhead')
  assert(!canAccess('member', 'settings'), 'member should NOT access settings')
  assert(!canAccess('member', 'audit'), 'member should NOT access audit')
})

test('staff with matching function can access areas', () => {
  assert(canAccessStaff('staff', ['customer_service'], 'areas'), 'staff+customer_service should access areas')
  assert(canAccessStaff('staff', ['billing'], 'areas'), 'staff+billing should access areas')
})

test('staff without functions cannot access areas', () => {
  assert(!canAccessStaff('staff', [], 'areas'), 'staff with empty functions should NOT access areas')
})

test('staff with non-matching function cannot access people', () => {
  assert(!canAccessStaff('staff', ['meter_reader'], 'people'), 'staff+meter_reader should NOT access people (needs customer_service)')
})

test('admin can access everything', () => {
  for (const p of PERMISSIONS) {
    if (p.allowedRoles.includes('admin')) {
      assert(canAccess('admin', p.id), `admin should access ${p.id}`)
    }
  }
})

test('admin with functions check passes for any route', () => {
  for (const p of PERMISSIONS) {
    if (p.allowedRoles.includes('admin')) {
      assert(canAccessStaff('admin', ['customer_service'], p.id), `admin+customer_service should access ${p.id}`)
    }
  }
})

// --- Status tests ---
test('placeholder/needs_backend routes are not usable', () => {
  for (const p of PERMISSIONS) {
    if (p.status === 'placeholder' || p.status === 'needs_backend') {
      assert(!isUsable(p.id), `route ${p.id} (${p.status}) should not be usable`)
    }
  }
})

test('working/partial routes are usable', () => {
  for (const p of PERMISSIONS) {
    if (p.status === 'working' || p.status === 'partial') {
      assert(isUsable(p.id), `route ${p.id} (${p.status}) should be usable`)
    }
  }
})

// --- Role hierarchy tests ---
test('no staff route is reachable by member', () => {
  for (const p of PERMISSIONS) {
    const staffOrAdmin = p.allowedRoles.some(r => r === 'staff' || r === 'admin')
    const memberAllowed = p.allowedRoles.includes('member')
    if (staffOrAdmin && !memberAllowed) {
      assert(!canAccess('member', p.id), `member should NOT reach ${p.id}`)
    }
  }
})

test('no admin-only route is reachable by member or staff', () => {
  for (const p of PERMISSIONS) {
    const adminOnly = p.allowedRoles.includes('admin') && !p.allowedRoles.includes('staff')
    if (adminOnly) {
      assert(!canAccess('member', p.id), `member should NOT reach admin-only ${p.id}`)
      assert(!canAccess('staff', p.id), `staff should NOT reach admin-only ${p.id}`)
    }
  }
})

// --- Payment security ---
test('payment routes require role authorization in apiActions', () => {
  const payRoutes = PERMISSIONS.filter(p => p.apiActions.some(a => a.includes('pay') || a.includes('payment')))
  for (const p of payRoutes) {
    assert(p.allowedRoles.includes('staff') || p.allowedRoles.includes('admin'),
      `payment route ${p.id} must require staff or admin role`)
  }
})

// ===== 5. authorizeWithFunctions behavior when staff_function is missing/NULL =====
function simulateAuthorizeWithFunctions(session, roles, functions) {
  // Replicates the logic from api/_lib/core.ts authorizeWithFunctions
  // After fix: admin role bypasses staff_function check
  if (!session || !roles.includes(session.role)) return { denied: true, status: 403 }
  if (session.role === 'admin') return { denied: false, status: 200, session }
  if (functions && functions.length > 0) {
    const userFunctions = session.staff_function ?? []
    const hasFunction = functions.some((fn) => userFunctions.includes(fn))
    if (!hasFunction) return { denied: true, status: 403 }
  }
  return { denied: false, status: 200, session }
}

const functionRoute = { roles: ['staff', 'admin'], functions: ['cashier_collector'] }

// Staff with NULL staff_function must be denied function-gated routes
test('staff with NULL staff_function denied on function-gated routes', () => {
  const s = { id: 'x', role: 'staff', email: 'a@b.c', staff_function: null }
  const r = simulateAuthorizeWithFunctions(s, functionRoute.roles, functionRoute.functions)
  assert(r.denied, 'staff with NULL staff_function must be denied')
  assert(r.status === 403, 'must return 403')
})

test('staff with matching function allowed', () => {
  const s = { id: 'x', role: 'staff', email: 'a@b.c', staff_function: ['cashier_collector'] }
  const r = simulateAuthorizeWithFunctions(s, functionRoute.roles, functionRoute.functions)
  assert(!r.denied, 'staff with matching function should be allowed')
})

test('staff with non-matching function denied', () => {
  const s = { id: 'x', role: 'staff', email: 'a@b.c', staff_function: ['customer_service'] }
  const r = simulateAuthorizeWithFunctions(s, functionRoute.roles, functionRoute.functions)
  assert(r.denied, 'staff with wrong function should be denied')
})

test('admin bypasses function check even with NULL/empty staff_function', () => {
  // Admin role bypasses staff_function check on server (authorizeWithFunctions)
  // and client (canAccessStaff only checks functions for role === 'staff').
  const s = { id: 'x', role: 'admin', email: 'a@b.c', staff_function: null }
  const r = simulateAuthorizeWithFunctions(s, functionRoute.roles, functionRoute.functions)
  assert(!r.denied, 'admin should bypass function check')
  assert(r.status === 200, 'admin should get 200')
  
  // Client-side: admin also bypasses
  assert(canAccessStaff('admin', [], 'areas'), 'admin can access areas regardless of functions')
  assert(canAccessStaff('admin', [], 'manual-payments'), 'admin can access manual-payments regardless of functions')
})

// --- Summary ---
console.log(`\\n=== Results: ${passed} passed, ${failed} failed ===\\n`)
if (failed > 0) {
  console.log(STATUS_LABEL)
  process.exit(1)
} else {
  console.log('All permission-map tests passed.')
  process.exit(0)
}
