/**
 * A Settings save the server refuses for a Target Margin over 80% (routes/
 * business-state.ts, TARGET_MARGIN_TOO_HIGH; final review Nov 3 2026: the
 * owner saw only "1 waiting for signal" while the page kept 45%). The phone
 * takes the saved copy back, says why in the server's words, and nothing
 * waits to be sent again. A number under the cap saves as usual.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

type Rec = { config: any; budget: any; version: number }
const server: { rec: Rec; patches: Array<Record<string, unknown>> } = { rec: { config: {}, budget: {}, version: 1 }, patches: [] }
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
const WORDS = 'Not saved: Target Margin (Overhead % + Target Profit %) can be at most 80%. Lower the Target Profit for White Vinyl Privacy.'

vi.mock('../../web/src/crmAuth', () => ({
  isSignedIn: () => true,
  fetchWithAuth: async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === 'GET') return answer(200, { success: true, data: { ...server.rec } })
    const { baseVersion, ...patch } = JSON.parse(init.body ?? '{}')
    if (baseVersion !== server.rec.version) return answer(409, { code: 'STALE_VERSION', data: { ...server.rec }, version: server.rec.version })
    // The server's check: Vinyl's Target Profit at the overhead in use (25.6%) may be at most 54.4%.
    const profit = (patch as any).config?.vinylProfit
    if (typeof profit === 'number' && 25.6 + profit > 80) return answer(400, { success: false, code: 'TARGET_MARGIN_TOO_HIGH', error: WORDS, data: { ...server.rec }, version: server.rec.version })
    server.patches.push(patch)
    server.rec = { ...server.rec, ...patch, version: server.rec.version + 1 }
    return answer(200, { success: true, version: server.rec.version })
  },
}))

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function store() {
  vi.resetModules()
  const kept = new Map<string, string>()
  const s = await import('../../web/src/businessStateStore')
  const outbox = await import('../../web/src/outbox')
  await outbox.startOutbox('u1', { storage: { all: async () => [...kept.values()].map(o => JSON.parse(o)), put: async (o: any) => { kept.set(o.id, JSON.stringify(o)) }, remove: async (id: string) => { kept.delete(id) } } })
  await s.initBusinessState()
  return { s, outbox, kept }
}

const said: string[] = []
beforeEach(() => {
  said.length = 0
  const w = Object.assign(new EventTarget(), { location: { hostname: 'app.test' }, removeEventListener: () => {} })
  w.addEventListener('ezbiz:refused', (e: any) => said.push(e.detail?.message ?? ''))
  vi.stubGlobal('window', w)
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' })
  server.rec = { config: { vinylProfit: 15 }, budget: {}, version: 1 }
  server.patches = []
})

describe('a Settings save over the Target Margin cap', () => {
  test('54% (79.6% with 25.6% overhead): saved', async () => {
    const { s } = await store()
    s.setBusinessField('config', { vinylProfit: 54 } as any)
    expect(await s.whenBusinessStateSaved(20_000)).toBe(true)
    expect(server.rec.config.vinylProfit).toBe(54)
  }, 30_000)

  test('55% (80.6%): refused, the screen goes back to 15%, the reason is shown, nothing waits for signal', async () => {
    const { s, outbox, kept } = await store()
    s.setBusinessField('config', { vinylProfit: 55 } as any)
    await wait(3_000)
    expect(server.rec.config.vinylProfit).toBe(15)
    expect(s.getBusinessField('config').vinylProfit).toBe(15)
    expect(said.some(m => m.includes('Target Margin') && m.includes('80%'))).toBe(true)
    expect(outbox.pendingFor('').length).toBe(0)
    expect(kept.size).toBe(0)
  }, 30_000)
})
