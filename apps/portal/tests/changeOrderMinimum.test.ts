/**
 * A change order on a job signed at the minimum job price (Jonathan, Nov 3
 * 2026, approval item 32: "Yes. Count from the signed price. If the new total
 * is still under the minimum, charge $0.").
 *
 * His example, from the dev catalog: 6 ft signed at the $350 minimum ($260
 * from cost), 10 ft added. 16 ft prices at $572, so the change is $222 and the
 * contract $572, never $312 and $662. Here the test catalog prices 6 ft at $311
 * and 16 ft at $551 (8 ft panels: 1 and 2 panels), so the same rule is $201
 * and a $551 contract, never $240 and $590.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const style: QuoteStyle = { name: "WV-ND 6'x8' Privacy", category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 8 }
const tan: QuoteStyle = { ...style, name: "TV-ND 6'x8' Privacy", margin: 0.6 }
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const input = (runs: number[], extra: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style, runs: runs.map(ft => ({ ft })), corners: Math.max(0, runs.length - 1), ends: 2, walkGates: 0, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing,
  overrides: { wholeDollar: true }, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
})
const price = (i: QuoteCalcInput) => Math.round(calculateQuote(i).priced.price * 100)
/** The quote as signed: its inputs and the price the customer signed for (dollars). */
const signedAs = (i: QuoteCalcInput, finalPrice: number) => ({
  id: 'q1', fenceStyle: i.style!.name, runs: i.runs.map(r => r.ft), runRails: i.runs.map(() => 'auto'), corners: i.corners, ends: i.ends,
  walkGates: i.walkGates, dblGates: i.dblGates, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
  sections: calculateQuote(i).sections, finalPrice,
}) as any
const draft = (was: QuoteCalcInput, finalPrice: number, now: QuoteCalcInput) => changeOrderDraft({
  signed: signedAs(was, finalPrice), current: now, signedOverrides: was.overrides, styles: [style, tan],
  priceNow: calculateQuote(now).priced.price, sectionsNow: calculateQuote(now).sections, simple: false,
})
const total = (d: ReturnType<typeof changeOrderDraft>) => d.lines.reduce((t, l) => t + l.amountCents, 0)
const MIN = { minimumCents: 35000 }

describe('a job signed at the minimum: the change counts from the price signed for', () => {
  test('the catalog: 6 ft is under the $350 minimum, 16 ft is over it', () => {
    expect(price(input([6]))).toBe(31100)
    expect(price(input([16]))).toBe(55100)
  })

  test('6 ft signed at $350, 10 ft added: $201, the contract $551, the same as 16 ft quoted fresh', () => {
    const d = draft(input([6], MIN), 350, input([16], MIN))
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0].description).toBe('Add 10 ft of fence, 1 panel more (6 ft to 16 ft)')
    expect(total(d)).toBe(20100)
    expect(35000 + total(d)).toBe(price(input([16])))
    expect(d.warnings).toEqual(['Signed at the $350 minimum job price: this change is counted from the $350 signed for. The new work prices at $551, so the contract becomes $551.'])
  })

  test('before the rule, the same change was $240 from the $311 the 6 ft prices at, a $590 contract', () => {
    // No minimum on the job (Settings do not apply it to new fences): the steps as always.
    const d = draft(input([6]), 311, input([16]))
    expect(total(d)).toBe(24000)
    expect(d.warnings).toBeUndefined()
  })

  test('still under the minimum after the change: $0, the contract stays at the minimum', () => {
    // A $600 minimum: 16 ft at $551 is still under it.
    const min = { minimumCents: 60000 }
    const d = draft(input([6], min), 600, input([16], min))
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0].amountCents).toBe(0)
    expect(d.warnings?.[0]).toBe('Signed at the $600 minimum job price, and still under it with this change: no charge and no credit. The contract stays $600.')
  })

  test('fence taken off a job held at the minimum: no credit, as the same work quoted fresh is still the minimum', () => {
    const min = { minimumCents: 60000 }
    const d = draft(input([16], min), 600, input([6], min))
    expect(d.lines[0].description).toMatch(/^Remove 10 ft of fence/)
    expect(d.lines[0].amountCents).toBe(0)
  })

  test('a gate and fence on one change: the lines add up to the new work as a change order prices it, less the $350 signed for', () => {
    const now = input([16], { ...MIN, walkGates: 1, ends: 4 })
    const d = draft(input([6], MIN), 350, now)
    // The same change from the $311 the 6 ft prices at today (2 new gate posts and all), less the $39 the minimum lifted it.
    const fromCost = draft(input([6]), 311, input([16], { walkGates: 1, ends: 4 }))
    expect(d.lines.length).toBe(2)
    expect(total(d)).toBe(total(fromCost) - 3900)
    expect(d.lines.every(l => l.amountCents >= 0)).toBe(true)
  })

  test('a job signed over the minimum is priced exactly as before, minimum on or not', () => {
    const was = input([40, 50, 40], { corners: 2, walkGates: 1 })
    const changes: QuoteCalcInput[] = [
      input([40, 57, 40], { corners: 2, walkGates: 1 }),
      input([40, 50, 40], { corners: 2, walkGates: 2, ends: 4 }),
      input([40, 50, 40], { corners: 2, walkGates: 0 }),
      input([40, 10], { corners: 1, walkGates: 1 }),
      input([40, 50, 40], { corners: 2, walkGates: 1, style: tan }),
    ]
    for (const now of changes) {
      const before = draft(was, price(was) / 100, now)
      const after = draft({ ...was, ...MIN }, price(was) / 100, { ...now, ...MIN })
      expect(after.lines.map(l => [l.description, l.amountCents])).toEqual(before.lines.map(l => [l.description, l.amountCents]))
      expect(after.warnings).toEqual(before.warnings)
    }
  })

  test('a job over the minimum cut to under it: today\'s credit stands (only a job signed at the minimum counts from it)', () => {
    const d = draft(input([16], MIN), 551, input([6], MIN))
    expect(total(d)).toBe(-24000)
  })

  test('a move or repair (one price difference line) already counts from the contract, the minimum in the new price', () => {
    const was = input([6], MIN)
    const d = (priceNow: number) => changeOrderDraft({ signed: signedAs(was, 350), current: input([16], MIN), signedOverrides: was.overrides, styles: [style], priceNow, sectionsNow: 2, simple: true })
    expect(total(d(551))).toBe(20100)
    expect(total(d(350))).toBe(0)
  })
})
