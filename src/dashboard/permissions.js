// ============================================================================
// E-TAWELCO Shared Permission Map — CLIENT SIDE
// ============================================================================
// This is the single source of truth for route permissions, mirrored by the
// API layers. The raw data lives in ../permissions.json (JSON, no code).
// Both Vercel (api/_lib/permissions.ts) and Netlify (netlify/lib/permissions.mts)
// import the same JSON. The dashboard loads it statically at build time.
//
// To add a route: edit permissions.json and re-run the diff test in
// tests/permissions-sync.test.mjs
// ============================================================================

const STATUS = { working: 'working', partial: 'partial', placeholder: 'placeholder', needs_backend: 'needs_backend' }
const STATUS_LABEL = { working: 'Working', partial: 'Partial', placeholder: 'Coming soon', needs_backend: 'Needs backend' }
const STATUS_BADGE = { working: 'working', partial: 'partial', placeholder: 'placeholder', needs_backend: 'backend' }

// --- Single source of truth: permissions.json ---
// This is fetched at runtime in browser contexts, or can be imported statically.
export { STATUS, STATUS_LABEL, STATUS_BADGE }

// The permissions data — generated from permissions.json
// In the dashboard, fetch('/permissions.json') at runtime, or use this inline copy
// (kept in sync via tests/permissions-sync.test.mjs)
import PERMISSIONS_DATA from '../../permissions.json' with { type: 'json' }

export const PERMISSIONS = PERMISSIONS_DATA.map((p) => ({
  ...p,
  functions: p.functions || [],
}))

// --- Helpers ---
export function getRoute(id) {
  return PERMISSIONS.find((p) => p.id === id)
}

export function canAccess(role, id) {
  const p = getRoute(id)
  if (!p) return false
  if (!p.allowedRoles.includes(role)) return false
  return true
}

export function canAccessStaff(role, staffFunctions, id) {
  const p = getRoute(id)
  if (!p) return false
  if (!p.allowedRoles.includes(role)) return false
  // Only enforce function check when the route defines functions
  if (role === 'staff' && p.functions && p.functions.length > 0) {
    const hasFunction = (staffFunctions || []).some((f) => p.functions.includes(f))
    if (!hasFunction) return false
  }
  return true
}

export function isVisible(role, staffFunctions, id) {
  return canAccessStaff(role, staffFunctions, id)
}

export function isUsable(id) {
  const p = getRoute(id)
  if (!p) return false
  return p.status === STATUS.working || p.status === STATUS.partial
}

export function getGroups() {
  const seen = new Set()
  const groups = []
  for (const p of PERMISSIONS) {
    if (!seen.has(p.group)) {
      seen.add(p.group)
      groups.push(p.group)
    }
  }
  return groups
}

export function getRoutesByGroup() {
  const groups = getGroups()
  return groups.map((group) => ({
    group,
    routes: PERMISSIONS.filter((p) => p.group === group),
  }))
}

// --- Self-test (run with: node --input-type=module src/dashboard/permissions.js) ---
if (import.meta?.url === `file://${process.argv[1]}`) {
  let passed = 0, failed = 0
  const test = (name, fn) => {
    try { fn(); passed++; console.log('  PASS: ' + name) }
    catch (e) { failed++; console.log('  FAIL: ' + name + ' — ' + e.message) }
  }
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed') }

  console.log('\n=== Permission Map Tests ===\n')

  // Structure
  test('every route has REQUIRED fields', () => {
    for (const p of PERMISSIONS) {
      assert(p.id, `route missing id`)
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

  // Access control
  test('people is admin-only', () => {
    const p = PERMISSIONS.find(x => x.id === 'people')
    assert(p.allowedRoles.includes('admin') && !p.allowedRoles.includes('staff'), 'people must be admin-only')
  })

  test('add-users is admin-only', () => {
    const p = PERMISSIONS.find(x => x.id === 'add-users')
    assert(p.allowedRoles.includes('admin') && !p.allowedRoles.includes('staff'), 'add-users must be admin-only')
  })

  test('guest can access only guest routes', () => {
    for (const p of PERMISSIONS) {
      if (!p.allowedRoles.includes('guest')) assert(!canAccess('guest', p.id), `guest should NOT access ${p.id}`)
    }
  })

  test('member can access overview and outages', () => {
    assert(canAccess('member', 'overview'), 'member should access overview')
    assert(canAccess('member', 'outages'), 'member should access outages')
    assert(canAccess('member', 'profile'), 'member should access profile')
  })

  test('member cannot access staff/admin routes', () => {
    assert(!canAccess('member', 'areas'), 'member should NOT access areas')
    assert(!canAccess('member', 'people'), 'member should NOT access people')
    assert(!canAccess('member', 'billing'), 'member should NOT access billing')
    assert(!canAccess('member', 'settings'), 'member should NOT access settings')
    assert(!canAccess('member', 'audit'), 'member should NOT access audit')
  })

  test('staff with customer_service can access areas but NOT manual-payments', () => {
    assert(canAccessStaff('staff', ['customer_service'], 'areas'), 'staff+customer_service should access areas')
    assert(!canAccessStaff('staff', ['customer_service'], 'manual-payments'), 'staff+customer_service should NOT access manual-payments (needs cashier_collector or billing)')
  })

  test('staff with cashier_collector can access manual-payments', () => {
    assert(canAccessStaff('staff', ['cashier_collector'], 'manual-payments'), 'staff+cashier_collector should access manual-payments')
  })

  test('staff with no functions sees only unfunctioned staff/admin routes', () => {
    // Staff with no function should NOT see areas (requires function)
    assert(!canAccessStaff('staff', [], 'areas'), 'staff with no function should NOT access areas')
    // Staff with no function CAN access repair-requests (admin-only, needs staff to not see)
    assert(!canAccessStaff('staff', [], 'billing'), 'staff with no function should NOT access billing')
  })

  test('admin can access everything', () => {
    for (const p of PERMISSIONS) {
      if (p.allowedRoles.includes('admin')) assert(canAccess('admin', p.id), `admin should access ${p.id}`)
    }
  })

  test('no staff route is reachable by member', () => {
    for (const p of PERMISSIONS) {
      const staffOrAdmin = p.allowedRoles.some(r => r === 'staff' || r === 'admin')
      const memberAllowed = p.allowedRoles.includes('member')
      if (staffOrAdmin && !memberAllowed) assert(!canAccess('member', p.id), `member should NOT reach ${p.id}`)
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

  // Status tests
  test('placeholder/needs_backend routes are not usable', () => {
    for (const p of PERMISSIONS) {
      if (p.status === 'placeholder' || p.status === 'needs_backend') assert(!isUsable(p.id), `route ${p.id} should not be usable`)
    }
  })

  test('working/partial routes are usable', () => {
    for (const p of PERMISSIONS) {
      if (p.status === 'working' || p.status === 'partial') assert(isUsable(p.id), `route ${p.id} should be usable`)
    }
  })

  // Payment security
  test('payment routes require staff/admin role', () => {
    const payRoutes = PERMISSIONS.filter(p => p.apiActions.some(a => a.includes('pay') || a.includes('payment')))
    for (const p of payRoutes) {
      assert(p.allowedRoles.includes('staff') || p.allowedRoles.includes('admin'),
        `payment route ${p.id} must require staff or admin role`)
    }
  })

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) {
    console.log(STATUS_LABEL)
    process.exit(1)
  } else {
    console.log('All permission-map tests passed.')
    process.exit(0)
  }
}
