/**
 * A Settings or budget change saved, then put back the way it was before the
 * page reloaded, reaches the server (night of Oct 30, 2026).
 *
 * The phone's Settings store skipped Settings and the budget whenever they
 * matched the copy it last READ, and a save did not move that copy on. So a
 * rate changed from 30 to 35, saved, and put back to 30 stayed 35 on the
 * server while the screen said Saved (found through Fence Styles: a choice
 * added, then removed on the same page, came back on reload). This drives the
 * real store (web businessStateStore.ts, syncGuard.ts) against a small server.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

type Rec = { config: any; budget: any; version: number }
const server: { rec: Rec; patches: Array<Record<string, unknown>>; another: Partial<Rec> | null } = { rec: { config: {}, budget: {}, version: 1 }, patches: [], another: null }
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

vi.mock('../../web/src/crmAuth', () => ({
  isSignedIn: () => true,
  fetchWithAuth: async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === 'GET') return answer(200, { success: true, data: { ...server.rec } })
    const { baseVersion, ...patch } = JSON.parse(init.body ?? '{}')
    if (baseVersion !== server.rec.version) return answer(409, { code: 'STALE_VERSION', data: { ...server.rec }, version: server.rec.version })
    server.patches.push(patch)
    server.rec = { ...server.rec, ...patch, version: server.rec.version + 1 }
    return answer(200, { success: true, version: server.rec.version })
  },
}))

async function store() {
  vi.resetModules()
  const s = await import('../../web/src/businessStateStore')
  const outbox = await import('../../web/src/outbox')
  const kept = new Map<string, any>()
  await outbox.startOutbox('u1', { storage: { all: async () => [...kept.values()], put: async (o: any) => { kept.set(o.id, o) }, remove: async (id: string) => { kept.delete(id) } } })
  await s.initBusinessState()
  return s
}

beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { hostname: 'app.test' }, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' })
  server.rec = { config: { overheadPct: 30 }, budget: { rent: 100 }, version: 1 }
  server.patches = []
})

describe('Settings put back the way they were', () => {
  test('a rate changed and saved, then put back, is saved back', async () => {
    const s = await store()
    s.setBusinessField('config', { overheadPct: 35 })
    expect(await s.whenBusinessStateSaved()).toBe(true)
    expect(server.rec.config.overheadPct).toBe(35)
    s.setBusinessField('config', { overheadPct: 30 })
    expect(await s.whenBusinessStateSaved()).toBe(true)
    expect(server.rec.config.overheadPct).toBe(30)
    expect(server.patches).toHaveLength(2)
  })

  test('a budget changed and saved, then put back, is saved back', async () => {
    const s = await store()
    s.setBusinessField('budget', { rent: 250 })
    await s.whenBusinessStateSaved()
    s.setBusinessField('budget', { rent: 100 })
    await s.whenBusinessStateSaved()
    expect(server.rec.budget.rent).toBe(100)
  })

  test('a change saved after another device saved first, then put back, is saved back', async () => {
    const s = await store()
    server.rec = { ...server.rec, budget: { rent: 500 }, version: 2 }
    s.setBusinessField('config', { overheadPct: 35 })
    await s.whenBusinessStateSaved()
    expect(server.rec).toMatchObject({ config: { overheadPct: 35 }, budget: { rent: 500 } })
    s.setBusinessField('config', { overheadPct: 30 })
    await s.whenBusinessStateSaved()
    expect(server.rec).toMatchObject({ config: { overheadPct: 30 }, budget: { rent: 500 } })
  })

  test('what another device saved can be put back here', async () => {
    const s = await store()
    server.rec = { ...server.rec, budget: { rent: 500 }, version: 2 }
    s.setBusinessField('config', { overheadPct: 35 })
    await s.whenBusinessStateSaved()
    expect(s.getBusinessField('budget')).toEqual({ rent: 500 })
    s.setBusinessField('budget', { rent: 100 })
    await s.whenBusinessStateSaved()
    expect(server.rec.budget.rent).toBe(100)
  })

  test('Settings that were not touched here are still not sent', async () => {
    const s = await store()
    s.setBusinessField('bundles', [{ id: 'b' }])
    await s.whenBusinessStateSaved()
    expect(Object.keys(server.patches[0])).toEqual(['bundles'])
  })
})
