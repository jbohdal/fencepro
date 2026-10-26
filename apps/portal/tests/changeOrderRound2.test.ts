/**
 * Change orders, round 2 review (Oct 26 2026), the parts with no database:
 *
 * - Per run rounding in a change order's words: 50 ft to 56 ft on a side with
 *   8 ft panels is still 7 panels, priced $0 ("still 7 panels on that side, no
 *   price change"), never an empty price; 8 ft of fence in two 4 ft pieces
 *   (a 12 ft side with a 4 ft gate) is 2 more panels, and the gate is its own
 *   line ("gates not counted" on the fence line).
 * - Permit reminders: at most every 3 days by the day in the reminder, so a
 *   pretend clock ahead of today never makes three in two seconds.
 * - The card's "opened" badge: a proposal accepted on the link is never "Not
 *   opened yet".
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'
import { openedBadgeText } from '../../web/src/proposalOpened'
import { openedForCard } from '../src/server/lib/proposalViewRules'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const style: QuoteStyle = { name: "WV-ND 6'x8' Privacy", category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 8 }
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const RUNS = [40, 50, 40]
const input = (extra: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style, runs: RUNS.map(ft => ({ ft })), corners: 2, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
})
const signedIn = input()
const signed = {
  id: 'q1', fenceStyle: style.name, runs: RUNS, runRails: RUNS.map(() => 'auto'), corners: 2, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0, sections: calculateQuote(signedIn).sections, finalPrice: calculateQuote(signedIn).priced.price,
} as any
const draft = (current: QuoteCalcInput) => changeOrderDraft({ signed, current, signedOverrides: signedIn.overrides, styles: [style], priceNow: calculateQuote(current).priced.price, sectionsNow: calculateQuote(current).sections, simple: false })

describe('a change order from the drawing says its panels (per run rounding)', () => {
  test('50 ft to 56 ft with 8 ft panels: still 7 panels on that side, $0, a real line', () => {
    const now = input({ runs: [{ ft: 40 }, { ft: 56 }, { ft: 40 }] })
    expect(calculateQuote(now).perRunSections[1]).toBe(calculateQuote(signedIn).perRunSections[1])
    const d = draft(now)
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0].description).toBe('Add 6 ft of fence (130 ft to 136 ft): still 7 panels on that side, no price change')
    expect(d.lines[0].amountCents).toBe(0)
    expect(d.scope).toMatchObject({ footageFt: 6 })
  })

  test('57 ft: one more panel, priced, and it says so', () => {
    const d = draft(input({ runs: [{ ft: 40 }, { ft: 57 }, { ft: 40 }] }))
    expect(d.lines[0].description).toBe('Add 7 ft of fence, 1 panel more (130 ft to 137 ft)')
    expect(d.lines[0].amountCents).toBeGreaterThan(0)
  })

  test('a 12 ft side with a 4 ft walk gate: 8 ft of fence in two 4 ft pieces is 2 panels (never pooled into 1), and the gate is its own line', () => {
    const now = input({ runs: [...RUNS, 4, 4].map(ft => ({ ft })), corners: 3, ends: 4, walkGates: 2 })
    // Per run rounding: ceil(4/8) + ceil(4/8) = 2 panels; pooled 8 ft would be 1.
    expect(calculateQuote(now).sections - calculateQuote(signedIn).sections).toBe(2)
    const d = draft(now)
    const fence = d.lines.find(l => /^Add 8 ft of fence/.test(l.description))!
    expect(fence.description).toBe('Add 8 ft of fence, 2 panels more (130 ft to 138 ft of fence, gates not counted)')
    expect(d.lines.find(l => l.description === 'Add 1 walk gate')!.amountCents).toBeGreaterThan(0)
    // The two pieces cost more than one 8 ft run: two panels and their posts.
    const oneRun = draft(input({ runs: [...RUNS, 8].map(ft => ({ ft })), corners: 3, ends: 2 }))
    expect(fence.amountCents).toBeGreaterThan(oneRun.lines[0].amountCents)
  })
})

describe('round 3: a gate put into a side is one change the customer can read', () => {
  // The Back (50 ft) gets a 4 ft walk gate in the middle: 23 + 23 ft of fence, two more gate posts.
  const gateIn = input({ runs: [40, 23, 23, 40].map(ft => ({ ft })), ends: 4, walkGates: 2 })
  test('one line: "Add 1 walk gate in the Back side (4 ft of fence becomes the gate)", the whole price difference', () => {
    const d = changeOrderDraft({ signed, current: gateIn, signedOverrides: signedIn.overrides, styles: [style], priceNow: calculateQuote(gateIn).priced.price, sectionsNow: calculateQuote(gateIn).sections, simple: false, gatesIn: { sides: ['Back'], openingFt: 4 } })
    expect(d.lines.map(l => l.description)).toEqual(['Add 1 walk gate in the Back side (4 ft of fence becomes the gate)'])
    // The same total as the two steps it replaces (the fence line, then the gate).
    const two = draft(gateIn)
    expect(two.lines.length).toBe(1)
    expect(d.lines[0].amountCents).toBe(two.lines[0].amountCents)
    expect(d.lines[0].amountCents).toBe(Math.round(calculateQuote({ ...gateIn, overrides: { wholeDollar: true } }).priced.price * 100) - Math.round(calculateQuote({ ...signedIn, overrides: { wholeDollar: true } }).priced.price * 100))
    expect(d.scope).toMatchObject({ footageFt: -4, walkGates: 1 })
    // No generic reason: whoever makes it types the reason (required, Oct 26 2026).
    expect(d.reason).toBe('')
    // A side named "Left side" is not "Left side side".
    expect(changeOrderDraft({ signed, current: gateIn, signedOverrides: signedIn.overrides, styles: [style], priceNow: 0, sectionsNow: 0, simple: false, gatesIn: { sides: ['Left side'], openingFt: 4 } }).lines[0].description).toBe('Add 1 walk gate in the Left side (4 ft of fence becomes the gate)')
  })
  test('without the drawing: the gate\'s usual 4 ft', () => {
    expect(draft(gateIn).lines[0].description).toBe('Add 1 walk gate (4 ft of fence becomes the gate)')
  })
  test('a gate and a shorter side too: the fence line says the gate took some of it, and never a bare "Remove ... more"', () => {
    const both = input({ runs: [32, 23, 23, 40].map(ft => ({ ft })), ends: 4, walkGates: 2 })
    const d = draft(both)
    const fence = d.lines.find(l => /^Remove 12 ft of fence/.test(l.description))!
    expect(fence.description).toMatch(/4 ft of it becomes the new gate/)
    expect(fence.description).not.toMatch(/^Remove 12 ft of fence, \d+ panels? more \(/)
    expect(d.lines.some(l => l.description === 'Add 1 walk gate')).toBe(true)
  })
})

describe('the card says a signed proposal was opened', () => {
  test('accepted on the link with no counted open: "Opened and signed", never "Not opened yet"', () => {
    const o = openedForCard({ customerId: 'c1' }, [{ crmContactId: 'c1', status: 'SOLD', shareToken: 't', viewCount: 0, acceptedAt: new Date() }])
    expect(o).toEqual({ count: 0, lastAt: null, signed: true })
    expect(openedBadgeText(o)).toBe('Opened and signed')
    expect(openedBadgeText({ count: 0, lastAt: null })).toBe('Not opened yet')
  })
})

describe('permit reminders: once every 3 days, by the day in the reminder', () => {
  test('a pretend clock 6 and 7 days ahead makes one, not three; one dated ahead of today holds the next', async () => {
    const { dueAgain } = await import('../src/server/lib/automations/queue.js')
    expect(dueAgain([], '2026-11-01')).toBe(true)
    // The automations test's ticks: Nov 1, Nov 1 (5 min later), Nov 2.
    expect(dueAgain(['2026-11-01'], '2026-11-01')).toBe(false)
    expect(dueAgain(['2026-11-01'], '2026-11-02')).toBe(false)
    expect(dueAgain(['2026-11-01'], '2026-11-03')).toBe(false)
    expect(dueAgain(['2026-11-01'], '2026-11-04')).toBe(true)
    // Real time after a pretend one ahead: not before 3 days past it.
    expect(dueAgain(['2026-11-02'], '2026-10-27')).toBe(false)
    expect(dueAgain(['2026-10-20', '2026-10-23'], '2026-10-26')).toBe(true)
  })
})
