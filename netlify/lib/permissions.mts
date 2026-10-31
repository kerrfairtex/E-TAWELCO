// ============================================================================
// E-TAWELCO Shared Permission Map — Netlify Functions (TypeScript)
// ============================================================================
// Single source of truth: ../../permissions.json
// Mirrors api/_lib/permissions.ts. The dashboard (src/dashboard/permissions.js)
// imports the same JSON. To verify all three are in sync, run:
//   node tests/permissions-sync.test.mjs
// ============================================================================

export interface RoutePermission {
  id: string
  label: string
  group: string
  icon?: string
  allowedRoles: string[]
  functions?: string[]
  status: string
  apiActions: string[]
  description?: string
}

// Import the JSON data (single source of truth)
// @ts-ignore
import permissionsData from '../../permissions.json' assert { type: 'json' }

export const ROUTE_PERMISSIONS: Record<string, RoutePermission> = {}
for (const p of permissionsData) {
  ROUTE_PERMISSIONS[p.id] = { ...p, functions: p.functions || [] }
}

export function getPermission(route: string): RoutePermission | null {
  return ROUTE_PERMISSIONS[route] ?? null
}

export function isMethodAllowed(route: string, method: string): boolean {
  const perm = getPermission(route)
  if (!perm) return method === 'GET' || method === 'HEAD'
  return perm.methods.includes(method)
}

export function verifyNoBrowserMoneyOrStatus(): { passed: boolean; violations: string[] } {
  const violations: string[] = []
  for (const [key, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if ((perm as any).browserSetsMoneyOrStatus && perm.allowedRoles.includes('member')) {
      violations.push(`Route '${key}' allows member role AND browserSetsMoneyOrStatus=true — security violation`)
    }
  }
  return { passed: violations.length === 0, violations }
}

export function canAccessRoute(role: string, staffFunctions: string[] | undefined, route: string): boolean {
  const perm = getPermission(route)
  if (!perm) return false
  if (!perm.allowedRoles.includes(role)) return false
  if (role === 'staff' && perm.functions && perm.functions.length > 0) {
    const hasFunction = (staffFunctions || []).some((fn) => perm.functions!.includes(fn))
    if (!hasFunction) return false
  }
  return true
}
