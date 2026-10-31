// ============================================================================
// Verify that all three permission-map copies are in sync with permissions.json
// Run: node tests/permissions-sync.test.mjs
// Fails if any copy differs from the JSON source of truth.
// ============================================================================
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Read the JSON source of truth
const jsonPath = join(root, 'permissions.json')
const jsonRaw = readFileSync(jsonPath, 'utf-8')
const jsonData = JSON.parse(jsonRaw)

// Extract data-only fields for comparison
function normalize(routes) {
  return JSON.stringify(routes.map(p => ({
    id: p.id, label: p.label, group: p.group,
    allowedRoles: p.allowedRoles, functions: (p.functions || []).sort(),
    status: p.status, apiActions: (p.apiActions || []).sort(), description: p.description,
  })).sort((a, b) => a.id.localeCompare(b.id)))
}

const jsonNorm = normalize(jsonData)

// Read all three consumer files
const tsVercel = readFileSync(join(root, 'api/_lib/permissions.ts'), 'utf-8')
const tsNetlify = readFileSync(join(root, 'netlify/lib/permissions.mts'), 'utf-8')
const jsDashboard = readFileSync(join(root, 'src/dashboard/permissions.js'), 'utf-8')

// Helpers
const netlifyImportsJson = tsNetlify.includes('permissions.json')

// Extract inline data from Vercel TS (const _perms: RoutePermission[] = [...])
function extractTSPermissions(tsCode) {
  const match = tsCode.match(/const _perms: RoutePermission\[\] = \[([\s\S]*?)\n\]/)
  if (!match) return []
  const jsonStr = '[' + match[1] + ']'
  try { return JSON.parse(jsonStr) } catch(e) { return [] }
}

// Extract inline data from dashboard JS (const PERMISSIONS = [...])
function extractJSPermissions(jsCode) {
  const match = jsCode.match(/const PERMISSIONS: AnyRoutePermission\[\] = \[([\s\S]*?)\n\]/)
  if (!match) return []
  const jsonStr = '[' + match[1] + ']'
  try { return JSON.parse(jsonStr) } catch(e) { return [] }
}

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log('  PASS: ' + name); passed++ }
  catch(e) { console.log('  FAIL: ' + name + ' -- ' + e.message); failed++ }
}

console.log('=== Permission Map Sync Tests ===\n')

test('dashboard permissions.js imports from permissions.json', () => {
  assert(jsDashboard.includes('permissions.json'), 'Dashboard JS must reference permissions.json')
})

test('Vercel permissions.ts inline data matches permissions.json', () => {
  const tsPerms = extractTSPermissions(tsVercel)
  assert(tsPerms.length > 0, 'Could not extract permissions from permissions.ts')
  assert(normalize(tsPerms) === jsonNorm, 'Vercel TS inline data differs from JSON source of truth')
})

test('netlify/lib/permissions.mts imports from permissions.json', () => {
  assert(netlifyImportsJson, 'Netlify permissions.mts must import from permissions.json')
})

test('people route is admin-only in JSON', () => {
  const people = jsonData.find(p => p.id === 'people')
  assert(people, 'people route not found')
  assert(people.allowedRoles.length === 1 && people.allowedRoles[0] === 'admin',
    'people must be admin-only')
})

test('add-users route is admin-only in JSON', () => {
  const au = jsonData.find(p => p.id === 'add-users')
  assert(au, 'add-users route not found')
  assert(au.allowedRoles.length === 1 && au.allowedRoles[0] === 'admin',
    'add-users must be admin-only')
})

test('areas requires functions in JSON', () => {
  const areas = jsonData.find(p => p.id === 'areas')
  assert(areas, 'areas route not found')
  assert(areas.functions && areas.functions.length > 0, 'areas must require functions')
})

test('manual-payments is NOT visible to customer_service-only staff', () => {
  const mp = jsonData.find(p => p.id === 'manual-payments')
  assert(mp, 'manual-payments route not found')
  // customer_service is NOT in the required functions for manual-payments
  assert(!mp.functions || !mp.functions.includes('customer_service'),
    'manual-payments must not be accessible to customer_service-only staff')
})

console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===')
if (failed > 0) process.exit(1)
