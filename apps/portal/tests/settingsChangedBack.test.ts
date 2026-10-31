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
const server: { rec: Rec; patches: Array<Record<string, unknown>>; down: boolean } = { rec: { config: {}, budget: {}, version: 1 }, patches: [], down: false }
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

vi.mock('../../web/src/crmAuth', () => ({
  isSignedIn: () => true,
  fetchWithAuth: async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === 'GET') return answer(200, { success: true, data: { ...server.rec } })
    if (server.down) throw new Error('no signal')
    const { baseVersion, ...patch } = JSON.parse(init.body ?? '{}')
    if (baseVersion !== server.rec.version) return answer(409, { code: 'STALE_VERSION', data: { ...server.rec }, version: server.rec.version })
    server.patches.push(patch)
    server.rec = { ...server.rec, ...patch, version: server.rec.version + 1 }
    return answer(200, { success: true, version: server.rec.version })
  },
}))

const other = (patch: Partial<Rec>) => { server.rec = { ...server.rec, ...patch, version: server.rec.version + 1 } }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const kept = new Map<string, string>()

async function store(reopened = false) {
  vi.resetModules()
  if (!reopened) kept.clear()
  const s = await import('../../web/src/businessStateStore')
  const outbox = await import('../../web/src/outbox')
  const prices = await import('../../web/src/pricingFreshness')
  // Kept as a real copy, the way the phone's storage keeps it.
  await outbox.startOutbox('u1', { storage: { all: async () => [...kept.values()].map(o => JSON.parse(o)), put: async (o: any) => { kept.set(o.id, JSON.stringify(o)) }, remove: async (id: string) => { kept.delete(id) } } })
  await s.initBusinessState()
  /** The phone's normal price check, after the server's prices moved. */
  const readPrices = () => prices.checkPricing(async () => ({ stamp: 's', business: `p${server.rec.version}`, inventory: 'i', tiers: 't' }))
  return Object.assign(s, { readPrices })
}

beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { hostname: 'app.test' }, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' })
  server.rec = { config: { overheadPct: 30 }, budget: { rent: 100 }, version: 1 }
  server.patches = []
  server.down = false
})

describe('Settings changed on another device, a change waiting on this phone', () => {
  // The phone cannot send; the other device saves; the phone reads prices; the other device saves again; signal back.
  async function aroundAPriceRead(first: Partial<Rec>, second: Partial<Rec>, mine?: () => void) {
    const s = await store()
    server.down = true
    s.setBusinessField('bundles', [{ id: 'b' }] as any)
    mine?.()
    await wait(400)
    other(first)
    await s.readPrices()
    other(second)
    server.down = false
    expect(await s.whenBusinessStateSaved(30_000)).toBe(true)
    return s
  }

  test('saved twice: the newest stays', async () => {
    const s = await aroundAPriceRead({ config: { overheadPct: 35 } }, { config: { overheadPct: 40 } })
    expect(server.rec.config.overheadPct).toBe(40)
    expect(s.getBusinessField('config').overheadPct).toBe(40)
    expect(server.patches.flatMap(p => Object.keys(p))).not.toContain('config')
  }, 40_000)

  test('saved and put back: stays put back', async () => {
    await aroundAPriceRead({ config: { overheadPct: 35 } }, { config: { overheadPct: 30 } })
    expect(server.rec.config.overheadPct).toBe(30)
  }, 40_000)

  test('a fence style added then removed there does not come back', async () => {
    server.rec.config = { fenceStyles: [{ id: 'a' }] }
    await aroundAPriceRead({ config: { fenceStyles: [{ id: 'a' }, { id: 'semi' }] } }, { config: { fenceStyles: [{ id: 'a' }] } })
    expect(server.rec.config.fenceStyles.map((x: any) => x.id)).toEqual(['a'])
  }, 40_000)

  test('the app reopened with a change still waiting: what was read here is not sent back', async () => {
    const s = await store()
    server.down = true
    s.setBusinessField('bundles', [{ id: 'b' }] as any)
    await wait(400)
    other({ config: { overheadPct: 35 }, budget: { rent: 500 } })
    await s.readPrices()
    await wait(1_500)                                  // one more try fails: what waits is kept again on the phone
    server.down = false
    const again = await store(true)
    expect(await again.whenBusinessStateSaved(30_000)).toBe(true)
    await wait(1_000)
    expect(server.rec).toMatchObject({ config: { overheadPct: 35 }, budget: { rent: 500 } })
    expect(server.patches.flatMap(p => Object.keys(p))).not.toContain('config')
  }, 40_000)

  test('the app reopened: a Settings change made here and theirs both stay', async () => {
    server.rec.config = { overheadPct: 30, other: 1 }
    const s = await store()
    server.down = true
    s.setBusinessField('config', { overheadPct: 31, other: 1 })
    await wait(400)
    other({ config: { overheadPct: 30, other: 2 } })
    await s.readPrices()
    await wait(1_500)
    server.down = false
    const again = await store(true)
    expect(await again.whenBusinessStateSaved(30_000)).toBe(true)
    expect(server.rec.config).toEqual({ overheadPct: 31, other: 2 })
  }, 40_000)

  test('a Settings change waiting here and theirs both stay', async () => {
    server.rec.config = { overheadPct: 30, other: 1 }
    const s = await store()
    server.down = true
    s.setBusinessField('config', { overheadPct: 31, other: 1 })
    await wait(400)
    other({ config: { overheadPct: 30, other: 2 } })
    await s.readPrices()
    other({ config: { overheadPct: 30, other: 3 } })
    server.down = false
    expect(await s.whenBusinessStateSaved(30_000)).toBe(true)
    expect(server.rec.config).toEqual({ overheadPct: 31, other: 3 })
  }, 40_000)
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
