/**
 * What a phone loads (audit #17, Oct 27 2026: the Salesman's iPhone Safari page
 * closed after 20 to 40 minutes; every page load read about 11 MB of JSON).
 *   - Company settings and the books (/api/business-state) leave out every job's
 *     milestone list and the Sales Orders when asked (?omit=): 3.9 MB to 0.2 MB.
 *     The web app never reads or sends the milestone lists from there, and reads
 *     the Sales Orders only when a screen showing them opens.
 *   - The appointments' refresh asks only for what changed (?since=).
 *   - The follow up board comes as one table.
 *   - A quote's change orders, its photos and who is signed in are read once per
 *     screen, not once per part of the screen.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { omittedParts, leanState, OMITTABLE } from '../src/server/routes/business-state'
import { toTable } from '../src/server/lib/listTable'
import { fromTable } from '../../web/src/listTable'

const web = (f: string) => fs.readFileSync(path.join(__dirname, '../../web/src', f), 'utf8')
const portal = (f: string) => fs.readFileSync(path.join(__dirname, '../src/server', f), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')

describe('business state: parts left out when asked', () => {
  test('only the job checklists and the Sales Orders can be left out; any other word is ignored', () => {
    expect([...OMITTABLE].sort()).toEqual(['jobChecklists', 'pendingOrders'])
    expect([...omittedParts({ omit: 'jobChecklists,pendingOrders' })].sort()).toEqual(['jobChecklists', 'pendingOrders'])
    expect([...omittedParts({ omit: 'config, payments ,jobChecklists' })]).toEqual(['jobChecklists'])
    expect([...omittedParts({ omit: ['pendingOrders', 'invoices'] })]).toEqual(['pendingOrders'])
    expect(omittedParts({}).size).toBe(0)
    expect(omittedParts(undefined).size).toBe(0)
  })

  test('the answer is a copy without them; the record itself is untouched', () => {
    const s = { id: 'x', version: 3, config: { a: 1 }, jobChecklists: { j: [1] }, pendingOrders: [{ id: 'o' }], payments: [] }
    const lean = leanState(s, omittedParts({ omit: 'jobChecklists,pendingOrders' })) as any
    expect(lean).toEqual({ id: 'x', version: 3, config: { a: 1 }, payments: [] })
    expect(s.jobChecklists).toEqual({ j: [1] })
    expect(s.pendingOrders).toEqual([{ id: 'o' }])
    expect(leanState(s, new Set())).toBe(s)
    expect(leanState(null, omittedParts({ omit: 'jobChecklists' }))).toBeNull()
  })

  test('every answer of the route (read, save, refused, stale) goes through it', () => {
    const r = code(portal('routes/business-state.ts'))
    // (The read also says which copy of the price data it is: pricingPart, lib/pricingStamp.ts; a save, what it left out.)
    expect(r).toMatch(/res\.json\(\{ success: true, data: leanState\(s, omittedParts\(req\.query\)\)(, pricingPart: businessPart\(s\.config, s\.budget\))? \}\)/)
    expect(r).toMatch(/res\.json\(\{ success: true, data: leanState\(s, omit\)(, \.\.\.\(leftOut \? \{ leftOut \} : \{\}\))? \}\)/)
    expect(r).toMatch(/refuse\(res, refused, \{ data: leanState\(saved, omit\)/)
    // Stale twice, and the Salesman's save built on a copy the server did not hand out (lib/salesServed.ts).
    expect((r.match(/refuseStale\(res, leanState\(/g) || []).length).toBe(3)
  })

  test('the web app never holds or sends every job\'s milestone list', () => {
    const store = code(web('businessStateStore.ts'))
    expect(store).not.toMatch(/jobChecklists:/)
    expect(store).toMatch(/omit=\$\{omitList\(\)\.join\(','\)\}/)
    expect(store).toMatch(/\['jobChecklists', \.\.\.LAZY/)
    // Nothing in the app reads it from the business state any more.
    for (const f of fs.readdirSync(path.join(__dirname, '../../web/src')).filter(f => /\.(ts|tsx)$/.test(f))) {
      expect(code(web(f)), f).not.toMatch(/getBusinessField\(\s*'jobChecklists'/)
      expect(code(web(f)), f).not.toMatch(/setBusinessField\(\s*'jobChecklists'/)
    }
    // A job's checklist is the server's (one job at a time).
    expect(code(web('checklistStore.ts'))).toMatch(/fetchMilestones\(jobId\)/)
  })

  test('the Sales Orders are read when a screen showing them opens, and never saved before that', () => {
    const store = code(web('businessStateStore.ts'))
    expect(store).toMatch(/const LAZY: ReadonlyArray<keyof BusinessFields> = \['pendingOrders'\]/)
    // A part not read is never in a save, and is not changed here.
    expect(store).toMatch(/if \(LAZY\.includes\(k\) && !loadedLazy\.has\(k\)\) continue/)
    expect(store).toMatch(/if \(LAZY\.includes\(key\) && !loadedLazy\.has\(key\)\) return/)
    const orders = code(web('pendingOrderStore.ts'))
    expect(orders).toMatch(/if \(!isBusinessFieldLoaded\('pendingOrders'\)\) throw/)
    expect(orders).toMatch(/needBusinessFields\(\['pendingOrders'\]\)/)
    // Every screen that shows them asks for them.
    for (const f of ['PendingOrdersPage.tsx', 'InventoryPage.tsx']) {
      expect(code(web(f)), f).toMatch(/usePendingOrders\(\)/)
      expect(code(web(f)), f).toMatch(/Loading the [Ss]ales [Oo]rders/)
    }
    // No other screen reads them (a new one must ask with usePendingOrders / needBusinessFields).
    const readers = fs.readdirSync(path.join(__dirname, '../../web/src')).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
      .filter(f => /getPendingOrders\w*\(|getBusinessField\(\s*'pendingOrders'/.test(code(web(f))))
    expect(readers.sort()).toEqual(['InventoryPage.tsx', 'PendingOrdersPage.tsx', 'pendingOrderStore.ts'])
  })
})

describe('the lists\' refresh asks only for what changed', () => {
  test('appointments: ?since= on the server and in the store; read with the other lists each time', () => {
    const route = code(portal('routes/appointments.ts'))
    expect(route).toMatch(/OR: \[\{ updatedAt: \{ gt: since \} \}, \{ contact: \{ updatedAt: \{ gt: since \} \} \}\]/)
    expect(route).toMatch(/serverTime, partial: true/)
    const store = code(web('appointmentsStore.ts'))
    expect(store).toMatch(/\?since=\$\{encodeURIComponent\(lastSync\)\}/)
    expect(store).toMatch(/if \(row\.deletedAt \|\| row\.archivedAt\) byId\.delete\(row\.id\)/)
    const live = code(web('liveRefresh.ts'))
    expect(live).toMatch(/refreshSchedule\(\), refreshAppointments\(\)\]/)
  })

  test('the first read of quotes, jobs and customers uses the same address as the refresh (no trailing slash)', () => {
    for (const f of ['savedQuotesApi.ts', 'savedJobsApi.ts', 'crmContactsApi.ts']) expect(code(web(f)), f).not.toMatch(/asTable\('\/'\)/)
  })
})

describe('the follow up board as one table', () => {
  test('turns back into the same cards by id', () => {
    const cards = {
      c1: { dueOn: '2026-10-29', dueKind: 'call', status: 'upcoming', days: 2, badge: null, stepIndex: 0, stepCount: 4, lastOutcome: null, lastContactAt: null, ownerName: 'Pat', state: { stage: 'Appointment', touches: 0 }, opened: null },
      c2: { dueOn: null, dueKind: 'call', status: 'none', days: 0, badge: null, stepIndex: 0, stepCount: 0, lastOutcome: null, lastContactAt: null, ownerName: '', state: null, opened: { count: 2 } },
    }
    const t = JSON.parse(JSON.stringify(toTable(Object.entries(cards).map(([id, c]) => ({ id, ...c })))))
    const back: Record<string, unknown> = {}
    for (const { id, ...c } of fromTable<any>(t) as any[]) back[id] = c
    expect(back).toEqual(cards)
    expect(code(portal('routes/follow-ups.ts'))).toMatch(/req\.query\.shape === 'table'/)
    expect(code(web('followUpStore.ts'))).toMatch(/\/api\/follow-ups\/board\?shape=table/)
  })
})

describe('one read per screen', () => {
  test('a quote\'s change orders: one at a time, not again within seconds, and a change made here reads again', () => {
    const co = code(web('ChangeOrders.tsx'))
    expect(co).toMatch(/const going = inFlight\.get\(key\)/)
    expect(co).toMatch(/Date\.now\(\) - \(readAt\.get\(key\) \?\? 0\) < FRESH_MS/)
    expect(co).toMatch(/function put\(row: ChangeOrder\) \{[\s\S]*?readAt\.clear\(\)/)
  })

  test('the same photo list asked twice on one screen is one request; after a change it is read fresh', () => {
    const m = code(web('mediaStore.ts'))
    expect(m).toMatch(/const going = opts\.fresh \? undefined : \(listing\.get\(q\) \?\? \(Date\.now\(\) - \(recentLists\.get\(q\)\?\.at \?\? 0\) < 5_000/)
    // Any photo change made here forgets the recent lists.
    expect(m).toMatch(/const notify = \(\) => \{ recentLists\.clear\(\)/)
    for (const fn of ['patchMedia', 'uploadMarkup', 'deleteMedia']) expect(m).toMatch(new RegExp(`export async function ${fn}[\\s\\S]{0,300}?recentLists\\.clear\\(\\)`))
    expect(code(web('MediaGallery.tsx'))).toMatch(/listMedia\(lookup, \{ fresh: true \}\)/)
    expect(code(web('CustomerPhotoTicks.tsx'))).toMatch(/\{ fresh: true \}\)/)
  })

  test('who is signed in is not asked of the server again by each screen', () => {
    expect(code(web('crmAuth.ts'))).toMatch(/export async function fetchCurrentUser\(\): Promise<CrmUser \| null> \{\s*if \(signedInUser\) return signedInUser/)
  })
})
