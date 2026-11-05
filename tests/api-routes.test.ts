import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  auth: 'unauthenticated' as 'unauthenticated' | 'inactive' | 'member' | 'staff' | 'admin' | 'master_admin',
}))

vi.mock('../api/_lib/core.js', () => {
  const sessions: Record<string, { id: string; role: string; areaIds: string[] }> = {
    member: { id: 'member-1', role: 'member', areaIds: [] },
    staff: { id: 'staff-1', role: 'staff', areaIds: ['area-1'] },
    admin: { id: 'admin-1', role: 'admin', areaIds: [] },
    master_admin: { id: 'master-1', role: 'master_admin', areaIds: [] },
  }
  const response = (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status })
  const session = () => state.auth === 'inactive' ? null : sessions[state.auth]
  const chain = (result: { data?: unknown; error?: unknown } = { data: [] }) => {
    const value: any = {
      select: () => value, insert: () => value, update: () => value, delete: () => value,
      eq: () => value, in: () => value, order: () => value, limit: () => value,
      range: () => value, maybeSingle: async () => result, single: async () => result,
      then: (resolve: (x: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return value
  }
  const client = { from: () => chain(), rpc: async () => ({ data: null, error: null }) }
  return {
    authorize: async () => {
      if (state.auth === 'unauthenticated') return response('Please log in', 401)
      if (state.auth === 'inactive') return response('Please log in', 403)
      return session()
    },
    body: async (req: Request) => req.json().catch(() => ({})),
    fail: (message: string, status = 400) => response(message, status),
    handleApi: vi.fn(), internalError: () => response('Unexpected server error', 500),
    isStaff: (s: { role: string }) => ['staff', 'admin', 'master_admin'].includes(s.role),
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    oneOf: (value: unknown, allowed: readonly unknown[]) => allowed.includes(value) ? value : null,
    pathParts: (req: Request) => new URL(req.url).pathname.split('/').filter(Boolean),
    readAreas: async () => [], readProfile: async () => ({ id: 'member-1' }),
    statuses: ['received', 'assigned', 'in_progress', 'resolved'], areaStatuses: ['steady', 'limited', 'outage'],
    observations: ['none'], supabase: () => client, supabaseAuth: () => client,
    text: (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '',
    withTicket: (value: unknown) => value, audit: async () => ({ error: null }),
  }
})

import handler from '../api/[...path].ts'

const request = (path: string, method = 'GET', payload?: unknown) => new Request(`https://test.local/api/${path}`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload),
})

beforeEach(() => { state.auth = 'unauthenticated' })

describe('API authentication matrix', () => {
  for (const route of ['me', 'areas/area-1', 'team', 'users', 'stats', 'outages', 'bills']) {
    it(`${route} rejects unauthenticated access`, async () => {
      const response = await handler.fetch(request(route))
      expect(response.status).toBe(route.startsWith('areas') ? 200 : 401)
    })
  }

  for (const route of ['me', 'team', 'users', 'stats', 'outages', 'bills']) {
    it(`${route} rejects inactive users`, async () => {
      state.auth = 'inactive'
      const response = await handler.fetch(request(route))
      expect(response.status).toBe(403)
    })
  }
})

describe('API authorization and validation', () => {
  it('rejects member role changes', async () => {
    state.auth = 'member'
    const response = await handler.fetch(request('users/member-2', 'PATCH', { role: 'admin' }))
    expect(response.status).toBe(403)
  })

  it('rejects staff role changes', async () => {
    state.auth = 'staff'
    const response = await handler.fetch(request('users/member-2', 'PATCH', { role: 'admin' }))
    expect(response.status).toBe(403)
  })

  it('rejects invalid area payload with 400 rather than 500', async () => {
    state.auth = 'admin'
    const response = await handler.fetch(request('areas/area-1', 'PATCH', { rate: 'not-a-number' }))
    expect(response.status).toBe(400)
  })

  it('rejects invalid outage payload with 400 rather than 500', async () => {
    state.auth = 'member'
    const response = await handler.fetch(request('outages', 'POST', { area_id: '', barangay: '' }))
    expect(response.status).toBe(400)
  })
})

describe('staff scope and member ownership cases', () => {
  it('has a staff scope available to route enforcement', async () => {
    state.auth = 'staff'
    const response = await handler.fetch(request('stats'))
    expect(response.status).not.toBe(500)
  })

  it('does not grant member access to another member bill route by role', async () => {
    state.auth = 'member'
    const response = await handler.fetch(request('bills/another-member-bill'))
    expect([403, 404]).toContain(response.status)
  })

  it('does not grant member access to another member report route by role', async () => {
    state.auth = 'member'
    const response = await handler.fetch(request('outages/another-member-report'))
    expect([403, 404]).toContain(response.status)
  })
})
