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
import { cutContractCents, cutFloorCents, cutFullCreditNote, cutUnderMinimum, cutUnderMinimumWarning } from '../../web/src/discountMinimum'

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

  test('a job over the minimum cut to under it: the credit stops at the minimum (Nov 3 2026, item 32)', () => {
    // Today's credit was $240, a $311 contract; now it stops at $201, a $350 contract.
    const d = draft(input([16], MIN), 551, input([6], MIN))
    expect(total(d)).toBe(-20100)
    expect(d.cut?.full.reduce((t, l) => t + l.amountCents, 0)).toBe(-24000)
  })

  test('a move or repair (one price difference line) already counts from the contract, the minimum in the new price', () => {
    const was = input([6], MIN)
    const d = (priceNow: number) => changeOrderDraft({ signed: signedAs(was, 350), current: input([16], MIN), signedOverrides: was.overrides, styles: [style], priceNow, sectionsNow: 2, simple: true })
    expect(total(d(551))).toBe(20100)
    expect(total(d(350))).toBe(0)
  })
})

/**
 * A cut stops at the minimum job price (Jonathan, Nov 3 2026, item 32: "yes, a
 * cut stops at $350. Owner can override."). His example: $647 cut to 8 ft left
 * $319. Here 20 ft signed at $647 (the test catalog prices 20 ft at $790 today
 * and 8 ft at $311), cut to 8 ft: the full credit is $479, a $168 contract; it
 * stops at $297 and a $350 contract.
 */
describe('a cut stops at the minimum job price', () => {
  test('the catalog: 20 ft at $790, 8 ft at $311', () => {
    expect(price(input([20]))).toBe(79000)
    expect(price(input([8]))).toBe(31100)
  })

  test('$647 cut to 8 ft: the credit is $297 and the contract $350, the line kept, the full credit kept for the owner', () => {
    const d = draft(input([20], MIN), 647, input([8], MIN))
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0].description).toMatch(/^Remove 12 ft of fence/)
    expect(d.lines[0].amountCents).toBe(-29700)
    expect(64700 + total(d)).toBe(35000)
    expect(d.warnings).toEqual(['This takes the job under the $350 minimum job price, so the credit stops at $297 and the contract becomes $350. With the full $479 credit it would be $168.'])
    expect(d.cut).toEqual({ floorCents: 35000, contractCents: 64700, full: [{ id: d.lines[0].id, amountCents: -47900 }], warning: d.warnings![0] })
    expect(d.warnings!.join(' ')).not.toMatch(/[—–-]/)
  })

  test('a cut that stays above the minimum is unchanged', () => {
    const d = draft(input([20], MIN), 790, input([16], MIN))
    const none = draft(input([20]), 790, input([16]))
    expect(total(d)).toBe(-23900)
    expect(d.lines.map(l => [l.description, l.amountCents])).toEqual(none.lines.map(l => [l.description, l.amountCents]))
    expect(d.warnings).toBeUndefined()
    expect(d.cut).toBeUndefined()
  })

  test('no minimum on the job (Settings do not apply it to new fences): the full credit', () => {
    const d = changeOrderDraft({ signed: signedAs(input([20]), 647), current: input([8], MIN), signedOverrides: {}, styles: [style], priceNow: 311, sectionsNow: 1, simple: false, minimumCents: 0 })
    expect(total(d)).toBe(-47900)
    expect(d.cut).toBeUndefined()
  })

  test('a job signed at the minimum keeps its own rule: no credit, never the cut warning', () => {
    const min = { minimumCents: 60000 }
    const d = draft(input([16], min), 600, input([6], min))
    expect(total(d)).toBe(0)
    expect(d.cut).toBeUndefined()
    expect(d.warnings).toEqual(['Signed at the $600 minimum job price, and still under it with this change: no charge and no credit. The contract stays $600.'])
  })

  test('counted from the contract with the other change orders in it', () => {
    // A $647 job with $200 of change orders added since: $847, so the credit stops at $497.
    const d = changeOrderDraft({ signed: signedAs(input([20]), 647), current: input([8], MIN), signedOverrides: {}, styles: [style], priceNow: 311, sectionsNow: 1, simple: false, contractCents: 84700 })
    expect(total(d)).toBe(-47900)
    const e = changeOrderDraft({ signed: signedAs(input([20]), 647), current: input([8], MIN), signedOverrides: {}, styles: [style], priceNow: 311, sectionsNow: 1, simple: false, contractCents: 74700 })
    expect(total(e)).toBe(-39700)
  })

  test('a contract already under the minimum (the owner let it through): no credit at all', () => {
    const d = draft(input([16], MIN), 340, input([8], MIN))
    expect(total(d)).toBe(0)
    expect(d.warnings?.[0]).toBe('The contract is $340, already at or under the $350 minimum job price, so this change gives no credit. With the full $240 credit it would be $100.')
  })

  test('a quote signed with dollars off is still held to $350, never $350 less its discount (review Nov 3 2026)', () => {
    // Repair R: $427 signed with $146 off was held only to $204, so a cut to $250 went through with no warning.
    const off = { wholeDollar: true, priceAdjustmentCents: -14600 }
    const d = draft(input([20], { ...MIN, overrides: off }), 427, input([8], { ...MIN, overrides: off }))
    expect(42700 + total(d)).toBe(35000)
    expect(d.warnings?.[0]).toMatch(/^This takes the job under the \$350 minimum job price, so the credit stops at \$77 and the contract becomes \$350\./)
    const r = changeOrderDraft({ signed: signedAs(input([20]), 427), current: input([8], { overrides: off }), signedOverrides: off, styles: [style], priceNow: 250, sectionsNow: 1, simple: true, minimumCents: 35000 })
    expect(42700 + total(r)).toBe(35000)
    expect(cutFloorCents(35050)).toBe(35000)
  })

  test('a contract taken below nothing keeps its minus sign, and the full credit figure is the real contract', () => {
    // A $647 job with $800 of approved credits since: $−153 now, no credit, and "−$632" with the full one.
    const d = changeOrderDraft({ signed: signedAs(input([20]), 647), current: input([8], MIN), signedOverrides: {}, styles: [style], priceNow: 311, sectionsNow: 1, simple: false, contractCents: -15300 })
    expect(total(d)).toBe(0)
    expect(d.warnings?.[0]).toBe('The contract is −$153, already at or under the $350 minimum job price, so this change gives no credit. With the full $479 credit it would be −$632.')
    expect(cutUnderMinimumWarning(20000, -85000, 35000, false)).toBe('This cannot be saved. It takes the job under the $350 minimum job price: the contract would be −$650. Take less off, or ask Jonathan.')
    // An earlier typed addition not signed yet is not in the contract, so it is not in the figure either.
    const contract = cutContractCents(64700, [{ status: 'draft', totalCents: 50000 }])
    const e = changeOrderDraft({ signed: signedAs(input([20]), 647), current: input([8], MIN), signedOverrides: {}, styles: [style], priceNow: 311, sectionsNow: 1, simple: false, contractCents: contract })
    expect(e.warnings?.[0]).toBe('This takes the job under the $350 minimum job price, so the credit stops at $297 and the contract becomes $350. With the full $479 credit it would be $168.')
    expect(cutFullCreditNote(64700, -47900, 35000)).toBe('Full credit given: the contract becomes $168, under the $350 minimum.')
  })

  test('the contract a cut counts from: additions once approved or signed, every cut not voided, the adjustments', () => {
    const orders = [
      { status: 'sent', totalCents: 50000 },                      // an addition not signed: not yet
      { status: 'sent', totalCents: 20000, signedAt: '2026-11-03' }, // signed: counts
      { status: 'approved', totalCents: 10000 },                  // approved: counts
      { status: 'draft', totalCents: -30000 },                    // an open cut: counts
      { status: 'needs_ok', totalCents: -5000 },                  // a Salesman's cut waiting for the OK: counts
      { status: 'void', totalCents: -40000 },                     // void: never
      { status: 'approved', totalCents: -1000, deletedAt: '2026-11-02' },
    ]
    expect(cutContractCents(84000, orders)).toBe(84000 + 20000 + 10000 - 30000 - 5000)
    expect(cutContractCents(84000, orders, -2500)).toBe(84000 + 20000 + 10000 - 30000 - 5000 - 2500)
    // The review's steps: $840 with an unsigned +$500; a $7,520 cut is held against $840, not $1,340.
    expect(cutUnderMinimum(cutContractCents(84000, [{ status: 'draft', totalCents: 50000 }]), -752000, 35000)).toBe(true)
  })

  test('a move or repair (minimum always on): the one price difference line stops at the minimum', () => {
    const was = input([20])
    const d = changeOrderDraft({ signed: signedAs(was, 647), current: input([8]), signedOverrides: {}, styles: [style], priceNow: 168, sectionsNow: 1, simple: true, minimumCents: 35000 })
    // The change in words at $0, then the price difference, which carries the credit.
    expect(d.lines.map(l => l.amountCents)).toEqual([0, -29700])
    expect(d.cut?.full.map(l => l.amountCents)).toEqual([0, -47900])
  })

  test('the screen and the server ask the same question', () => {
    expect(cutFloorCents(35050)).toBe(35000)
    expect(cutFloorCents(0)).toBe(0)
    expect(cutUnderMinimum(64700, -29700, 35000)).toBe(false)
    expect(cutUnderMinimum(64700, -29800, 35000)).toBe(true)
    expect(cutUnderMinimum(34000, 0, 35000)).toBe(false)
    expect(cutUnderMinimum(34000, 5000, 35000)).toBe(false)
    expect(cutUnderMinimum(34000, -100, 35000)).toBe(true)
    expect(cutUnderMinimumWarning(64700, -47900, 35000, false)).toBe('This cannot be saved. It takes the job under the $350 minimum job price: the contract would be $168. Take less off, or ask Jonathan.')
    expect(cutUnderMinimumWarning(64700, -47900, 35000, true)).toBe('This takes the job under the $350 minimum job price. As the owner you can give the full credit anyway.')
    // A void or an approval: "Take less off" is for cuts only.
    expect(cutUnderMinimumWarning(84000, -50000, 35000, false, 'void')).toBe('This cannot be voided. It takes the job under the $350 minimum job price: the contract would be $340. Ask Jonathan.')
    expect(cutUnderMinimumWarning(84000, -50000, 35000, true, 'void')).toBe('This takes the job under the $350 minimum job price: the contract would be $340. As the owner you can void it anyway.')
    expect(cutUnderMinimumWarning(84000, -50000, 35000, false, 'approve')).toBe('This cannot be approved. It takes the job under the $350 minimum job price: the contract would be $340. Ask Jonathan.')
    // With open change orders counted, it says so.
    expect(cutUnderMinimumWarning(20000, -35000, 35000, false, 'void', true)).toBe('This cannot be voided. Voiding this, with the open change orders, takes the job under the $350 minimum job price: the contract would be −$150. Ask Jonathan.')
    expect(cutUnderMinimumWarning(20000, -35000, 35000, true, 'void', true)).toBe('Voiding this, with the open change orders, takes the job under the $350 minimum job price: the contract would be −$150. As the owner you can void it anyway.')
    expect(cutUnderMinimumWarning(20000, -35000, 35000, false, 'approve', true)).toBe('This cannot be approved. Approving this, with the open change orders, takes the job under the $350 minimum job price: the contract would be −$150. Ask Jonathan.')
  })
})
