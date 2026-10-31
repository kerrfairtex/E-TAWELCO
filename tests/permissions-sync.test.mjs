// ============================================================================
// Verify that all three permission-map copies are in sync with permissions.json
// Run: node tests/permissions-sync.test.mjs
// Fails if any copy differs from the JSON source of truth.
// ============================================================================
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

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

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS: ' + name) }
  catch (e) { failed++; console.log('  FAIL: ' + name + ' -- ' + e.message) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed') }

// Import the dashboard JS version
import { PERMISSIONS as jsPerms } from '../src/dashboard/permissions.js'
const jsNorm = normalize(jsPerms)

// Read Vercel permissions.ts — it has inline data from permissions.json
const tsVercel = readFileSync(join(root, 'api/_lib/permissions.ts'), 'utf-8')
// Extract the inline array: const permissionsData = [ ... ]
const inlineMatch = tsVercel.match(/const permissionsData = (\[.*?\]) as const/s)
let tsVercelData = null
if (inlineMatch) {
  try { tsVercelData = eval(inlineMatch[1]) } catch(e) {}
}
const tsNorm = tsVercelData ? normalize(tsVercelData) : null

// Read Netlify permissions.mts — it imports from ../../permissions.json
const tsNetlify = readFileSync(join(root, 'netlify/lib/permissions.mts'), 'utf-8')

// Check for local copy of permissions.json
const localCopyPath = join(root, 'api/_lib/permissions.json')
let localCopyMatches = false
try {
  const localRaw = readFileSync(localCopyPath, 'utf-8')
  const localParsed = JSON.parse(localRaw)
  localCopyMatches = JSON.stringify(localParsed) === JSON.stringify(jsonData)
} catch(e) {
  localCopyMatches = false
}

console.log('\n=== Permission Map Sync Tests ===\n')

test('dashboard permissions.js matches permissions.json', () => {
  assert(jsNorm === jsonNorm, 'Dashboard JS permissions differ from JSON source of truth')
})

test('Vercel permissions.ts inline data matches permissions.json', () => {
  assert(tsNorm !== null, 'Could not extract inline data from permissions.ts')
  assert(tsNorm === jsonNorm, 'Vercel TS permissions data differs from JSON')
})

test('Netlify permissions.mts imports from ../../permissions.json', () => {
  assert(tsNetlify.includes("from '../../permissions.json'"),
    'Netlify permissions.mts must import from ../../permissions.json')
})

test('local copy api/_lib/permissions.json matches root permissions.json', () => {
  assert(localCopyMatches, 'Local copy of permissions.json differs from root')
})

test('people route is admin-only in JSON', () => {
  const p = jsonData.find(x => x.id === 'people')
  assert(p && p.allowedRoles.includes('admin') && !p.allowedRoles.includes('staff'),
    'people must be admin-only in permissions.json')
})

test('add-users route is admin-only in JSON', () => {
  const p = jsonData.find(x => x.id === 'add-users')
  assert(p && p.allowedRoles.includes('admin') && !p.allowedRoles.includes('staff'),
    'add-users must be admin-only in permissions.json')
})

test('areas requires functions in JSON', () => {
  const p = jsonData.find(x => x.id === 'areas')
  assert(p && p.functions && p.functions.length > 0, 'areas must require staff functions')
})

test('manual-payments is NOT visible to customer_service-only staff', () => {
  const p = jsonData.find(x => x.id === 'manual-payments')
  assert(p && p.functions && p.functions.includes('cashier_collector'),
    'manual-payments functions must include cashier_collector')
  assert(!p.functions.includes('customer_service'),
    'manual-payments functions must NOT include customer_service')
})

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
