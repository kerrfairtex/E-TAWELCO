// ============================================================================
// E-TAWELCO Shared Permission Map — Vercel API (TypeScript)
// ============================================================================
const permissionsData = [
  {
    "id": "overview",
    "label": "Overview",
    "group": "Home",
    "icon": "#i-grid",
    "allowedRoles": [
      "member",
      "staff",
      "admin"
    ],
    "functions": [],
    "status": "partial",
    "apiActions": [
      "GET /api/stats"
    ],
    "description": "Account status, current balance, service-area status, latest outage updates."
  },
  {
    "id": "outages",
    "label": "Outage reports",
    "group": "Home",
    "icon": "#i-bolt",
    "allowedRoles": [
      "member",
      "staff",
      "admin"
    ],
    "functions": [],
    "status": "partial",
    "apiActions": [
      "GET /api/outages",
      "POST /api/outages",
      "GET /api/outages/{id}",
      "PATCH /api/outages/{id}"
    ],
    "description": "Report an outage, follow its progress, and view status updates."
  },
  {
    "id": "areas",
    "label": "Service areas",
    "group": "Home",
    "icon": "#i-map",
    "allowedRoles": [
      "staff",
      "admin"
    ],
    "functions": [
      "customer_service",
      "billing",
      "cashier_collector",
      "meter_reader",
      "line_crew_dispatch"
    ],
    "status": "partial",
    "apiActions": [
      "GET /api/areas",
      "PATCH /api/areas/{id}"
    ],
    "description": "View service-area status and update for assigned areas."
  },
  {
    "id": "my-bills",
    "label": "My bills",
    "group": "Billing",
    "icon": "#i-grid",
    "allowedRoles": [
      "member"
    ],
    "functions": [],
    "status": "needs_backend",
    "apiActions": [
      "GET /api/bills?scope=mine"
    ],
    "description": "View current bill and bill history with full breakdown. Requires an approved account link."
  },
  {
    "id": "billing",
    "label": "Billing Oversight",
    "group": "Billing",
    "icon": "#i-grid",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "partial",
    "apiActions": [
      "GET /api/bills",
      "POST /api/bills",
      "PATCH /api/bills/{id}"
    ],
    "description": "Bills list, summary, and administrative bill management."
  },
  {
    "id": "profile",
    "label": "My profile",
    "group": "Account",
    "icon": "#i-user",
    "allowedRoles": [
      "member",
      "staff",
      "admin"
    ],
    "functions": [],
    "status": "partial",
    "apiActions": [
      "GET /api/me",
      "PATCH /api/me"
    ],
    "description": "View and edit profile, phone, service address (municipality + barangay)."
  },
  {
    "id": "people",
    "label": "People",
    "group": "Account",
    "icon": "#i-people",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "working",
    "apiActions": [
      "GET /api/users",
      "POST /api/users",
      "PATCH /api/users/{id}"
    ],
    "description": "Search members, create users, change roles and assign service areas."
  },
  {
    "id": "repair-requests",
    "label": "Repair Requests",
    "group": "Operations",
    "icon": "#i-bolt",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "partial",
    "apiActions": [],
    "description": "Review and resolve repair requests. (Currently aliases outage reports.)"
  },
  {
    "id": "complaints",
    "label": "Complaints",
    "group": "Operations",
    "icon": "#i-bolt",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "placeholder",
    "apiActions": [],
    "description": "Review and resolve member complaints and billing disputes (ERC escalation info)."
  },
  {
    "id": "gcash",
    "label": "GCash Merchant",
    "group": "Billing",
    "icon": "#i-grid",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "placeholder",
    "apiActions": [],
    "description": "Manage GCash merchant reconciliation and settlement. Coming soon."
  },
  {
    "id": "audit",
    "label": "Audit Log",
    "group": "System",
    "icon": "#i-shield",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "working",
    "apiActions": [
      "GET /api/stats (audit data)"
    ],
    "description": "Filterable, exportable audit log of admin and staff actions."
  },
  {
    "id": "settings",
    "label": "Master Settings",
    "group": "System",
    "icon": "#i-cog",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "placeholder",
    "apiActions": [],
    "description": "Configure cooperative-wide settings: office info, hours, hotlines, rates, payment channels, fees."
  },
  {
    "id": "add-users",
    "label": "Add user",
    "group": "Account",
    "icon": "#i-people",
    "allowedRoles": [
      "admin"
    ],
    "functions": [],
    "status": "working",
    "apiActions": [
      "POST /api/users"
    ],
    "description": "Create a new staff or admin user account."
  },
  {
    "id": "member-lookup",
    "label": "Member lookup",
    "group": "Operations",
    "icon": "#i-search",
    "allowedRoles": [
      "staff",
      "admin"
    ],
    "functions": [
      "customer_service"
    ],
    "status": "needs_backend",
    "apiActions": [
      "GET /api/profiles/:id",
      "GET /api/bills?account_id=:id"
    ],
    "description": "Search members by account number or phone, view profile and billing history. Staff-scoped, access-logged."
  },
  {
    "id": "account-links",
    "label": "Account Link Requests",
    "group": "Operations",
    "icon": "#i-user",
    "allowedRoles": [
      "staff",
      "admin"
    ],
    "functions": [
      "customer_service",
      "billing"
    ],
    "status": "needs_backend",
    "apiActions": [
      "GET /api/account-links",
      "PATCH /api/account-links/{id}"
    ],
    "description": "Review and approve/reject member account link requests."
  },
  {
    "id": "notifications",
    "label": "Notifications",
    "group": "Account",
    "icon": "#i-bell",
    "allowedRoles": [
      "member",
      "staff",
      "admin"
    ],
    "functions": [],
    "status": "needs_backend",
    "apiActions": [
      "GET /api/notifications"
    ],
    "description": "View notifications and manage preferences."
  },
  {
    "id": "manual-payments",
    "label": "Manual Payments",
    "group": "Billing",
    "icon": "#i-cash",
    "allowedRoles": [
      "staff",
      "admin"
    ],
    "functions": [
      "cashier_collector",
      "billing"
    ],
    "status": "needs_backend",
    "apiActions": [
      "authorize(staff, admin) + functions(cashier_collector, billing)",
      "POST /api/manual-payments",
      "GET /api/manual-payments",
      "GET /api/receipts"
    ],
    "description": "Record counter or island-collector payments with official receipt numbers."
  }
] as const
// This file re-exports the JSON data as typed TypeScript for the API layer.
// The dashboard (src/dashboard/permissions.js) and Netlify (permissions.mts)
// import the same JSON file. To verify all three are in sync, run:
//   node tests/permissions-sync.test.mjs
// ============================================================================

import type { Role } from './core'

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
// @ts-ignore — JSON imports need resolution at build time
import permissionsData from '../../permissions.json'

export const ROUTE_PERMISSIONS: Record<string, RoutePermission> = permissionsData.reduce(
  (acc: Record<string, RoutePermission>, p: any) => {
    acc[p.id] = { ...p, functions: p.functions || [] }
    return acc
  }, {}
)

export function getPermission(route: string): RoutePermission | null {
  return ROUTE_PERMISSIONS[route] ?? null
}

export function isMethodAllowed(route: string, method: string): boolean {
  const perm = getPermission(route)
  if (!perm) return method === 'GET' || method === 'HEAD'
  return perm.methods?.includes(method) ?? (method === 'GET' || method === 'HEAD')
}

export function verifyNoBrowserMoneyOrStatus(): { passed: boolean; violations: string[] } {
  const violations: string[] = []
  for (const [key, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (perm.browserSetsMoneyOrStatus && perm.allowedRoles.includes('member')) {
      violations.push(`Route '${key}' allows member role AND browserSetsMoneyOrStatus=true — security violation`)
    }
  }
  return { passed: violations.length === 0, violations }
}

// Convenience: check if a role + functions can access a route
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

// Type re-export
export type { Role }
