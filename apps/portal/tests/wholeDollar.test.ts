/**
 * Whole dollar prices (Jonathan, Oct 21 2026): "from now on round every new
 * proposal and contract price to the whole dollar (logged as an adjustment out
 * of profit), so cents never show up on anything a customer signs. Don't
 * change already sent or signed quotes."
 *
 * Rounded DOWN, as the last step (after the slider, a typed price and the
 * commission gross up); commission and overhead stay on the price before
 * rounding, so the margin drops by exactly the cents. A quote sent, sold or
 * accepted before keeps its cents.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { calculatePrice, wholeDollarCents, keepsCents, roundsToWholeDollar, type PriceInputs, type PricingSettings } from '../../web/src/pricingEngine'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { buildProposal, buildWorkProposal, priceOption } from '../../web/src/proposal'
import { priceMove, moveRepairSettings, type WorkCommon } from '../../web/src/moveRepair'
import { quoteJobFor } from '../../web/src/estimate'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'
import { splitDollars } from '../../web/src/DollarPickets'
import { depositOf, finalOf, pricedWholeDollar } from '../src/server/lib/paymentMath'
import { wholeDollarLine } from '../src/server/lib/changeOrders'
import { depositDollars } from '../src/server/routes/proposal.js'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const pricing: PricingSettings = { manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27 }
const vinyl = { category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }
const job: PriceInputs = { sections: 25, footage: 150, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0, materialCost: 3000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, style: vinyl, pricing }

const st = (name: string, extra: Partial<QuoteStyle> = {}): QuoteStyle => ({ name, category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, ...extra })
const calcPricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const input = (style: QuoteStyle, extra: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style, runs: [{ ft: 97.3 }, { ft: 41.5 }], corners: 1, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0.03, pricing: calcPricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
})
const whole = (n: number) => Math.round(n * 100) % 100 === 0

describe('the engine rounds the price down to the whole dollar, out of profit', () => {
  test('rounded down, the cents logged, margin drops by exactly the cents', () => {
    const r = calculatePrice(job)
    const exact = calculatePrice({ ...job, overrides: { wholeDollar: false } })
    expect(exact.roundingCents).toBe(0)
    expect(r.price).toBe(Math.floor(exact.price))
    expect(r.priceBeforeRounding).toBe(exact.price)
    expect(r.roundingCents).toBe(Math.round(exact.price * 100) - r.price * 100)
    expect(r.roundingCents).toBeGreaterThan(0)
    expect(r.roundingCents).toBeLessThan(100)
    // Costs unchanged; the margin is lower by exactly the cents.
    expect([r.materialCost, r.laborCost, r.totalCOGS, r.basePrice]).toEqual([exact.materialCost, exact.laborCost, exact.totalCOGS, exact.basePrice])
    // (each margin is shown to the cent, so within a cent)
    expect(Math.abs(Math.round((exact.grossMargin - r.grossMargin) * 100) - r.roundingCents)).toBeLessThanOrEqual(1)
  })

  test('commission stays on the price before rounding (rounding never comes out of commission)', () => {
    const r = calculatePrice({ ...job, hasSalesman: true })
    const exact = calculatePrice({ ...job, hasSalesman: true, overrides: { wholeDollar: false } })
    expect(r.commissionAmt).toBe(exact.commissionAmt)
    expect(Math.abs(Math.round((exact.grossMargin - r.grossMargin) * 100) - r.roundingCents)).toBeLessThanOrEqual(1)
  })

  test('after the slider and the commission gross up; a price typed with cents is rounded too', () => {
    const slid = calculatePrice({ ...job, priceAdjust: 0.07, hasSalesman: true, pricing: { ...pricing, commissionMode: 'added' } })
    expect(whole(slid.price)).toBe(true)
    expect(slid.price).toBe(Math.floor(slid.priceBeforeRounding))
    const typed = calculatePrice({ ...job, overrides: { finalPrice: 7000.85 } })
    expect([typed.price, typed.roundingCents, typed.priceMethod]).toEqual([7000, 85, 'manual'])
    const already = calculatePrice({ ...job, overrides: { finalPrice: 7000 } })
    expect([already.price, already.roundingCents]).toEqual([7000, 0])
  })

  test('wholeDollarCents: down for a charge, to the larger whole dollar for a credit; off leaves it', () => {
    expect(wholeDollarCents(500027)).toEqual({ cents: 500000, roundingCents: 27 })
    expect(wholeDollarCents(500000)).toEqual({ cents: 500000, roundingCents: 0 })
    expect(wholeDollarCents(-2740)).toEqual({ cents: -2800, roundingCents: 60 })
    expect(wholeDollarCents(500027, false)).toEqual({ cents: 500027, roundingCents: 0 })
    expect(roundsToWholeDollar(undefined)).toBe(true)
    expect(roundsToWholeDollar({ wholeDollar: false })).toBe(false)
  })
})

describe('a quote sent, sold or accepted before keeps its cents; drafts do not', () => {
  test('keepsCents', () => {
    expect(keepsCents({ status: 'DRAFT' })).toBe(false)
    expect(keepsCents({ status: 'LOST' })).toBe(false)
    expect(keepsCents({ status: 'SENT' })).toBe(true)
    expect(keepsCents({ status: 'SOLD' })).toBe(true)
    expect(keepsCents({ status: 'DRAFT', shareToken: 'abc' })).toBe(true)
    expect(keepsCents({ status: 'DRAFT', acceptedAt: new Date() })).toBe(true)
    // Priced with the rule (saved after it): never keeps cents, whatever its status.
    expect(keepsCents({ status: 'SOLD', pricing: { wholeDollar: true } })).toBe(false)
    expect(keepsCents({ status: 'DRAFT', pricing: { wholeDollar: false } })).toBe(true)
    expect(keepsCents(null)).toBe(false)
  })

  test('a signed quote opened as it keeps its cents prices exactly as before', () => {
    const style = st("WV-ND 6'x8' Privacy")
    const kept = calculateQuote(input(style, { overrides: { wholeDollar: false } })).priced
    const before = calculateQuote(input(style, { overrides: { wholeDollar: false, costFactor: 0.58 } })).priced
    expect(kept.roundingCents).toBe(0)
    expect(kept.price).toBe(before.price)
    expect(whole(kept.price)).toBe(false)
  })
})

describe('every price a customer sees and signs is whole dollars', () => {
  test('proposal options (the quote\'s own, Compare options) and the proposal is marked whole dollar', () => {
    const own = st("WV-ND 6'x8' Privacy")
    const others = [st("WV-ND 6'x6' Privacy"), st("TV-DS 6'x8' Privacy"), st("WV-DS 6'x6' Privacy", { margin: 0.6 })]
    const i = input(own)
    const q = calculateQuote(i)
    const p = buildProposal({
      input: i, styles: [own, ...others], ownPrice: q.priced.price, ownRoundingCents: q.priced.roundingCents,
      company: { name: 'Co', phone: '', email: '' }, customer: { name: 'C', address: '' }, warranty: '', settings: { depositPct: 33 }, photoIds: {},
    })
    expect(p.wholeDollar).toBe(true)
    expect(p.options).toHaveLength(4)
    for (const o of p.options) {
      expect(whole(o.finalPrice), o.fenceStyle).toBe(true)
      expect(o.snapshot.roundingCents).toBeGreaterThanOrEqual(0)
      expect(o.snapshot.roundingCents).toBeLessThan(100)
    }
    expect(p.options[0].snapshot.roundingCents).toBe(q.priced.roundingCents)
    // A quote that keeps its cents makes a proposal without the mark (the deposit stays to the cent).
    expect(buildProposal({ input: i, styles: [own], ownPrice: 1234.56, wholeDollar: false, company: { name: '', phone: '', email: '' }, customer: { name: '', address: '' }, warranty: '', settings: {}, photoIds: {} }).wholeDollar).toBeUndefined()
    expect(whole(priceOption(i, others[0]).finalPrice)).toBe(true)
  })

  test('the quote builder\'s job: new fence, minimum job price, tiers; the rule is saved with the quote', () => {
    const data = { config: null, inventory: [], kits: [] }
    const req = {
      fenceStyle: "WV-ND 6'x8' Privacy", runs: [{ ft: 97.3, rail: 'auto' as const }, { ft: 41.5, rail: 'auto' as const }], corners: 1, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0.03, overrides: {}, jobType: 'new' as const,
      compare: true, offer: ["WV-ND 6'x6' Privacy"],
    }
    const j = quoteJobFor(data, req, 30)
    expect(whole(j.totals.price)).toBe(true)
    expect(j.totals.roundingCents).toBe(j.calc.priced.roundingCents)
    expect(j.pricing).toMatchObject({ wholeDollar: true, roundingCents: j.totals.roundingCents, overheadPct: 30 })
    for (const o of [...j.proposalOptions, ...j.compareRows.map(r => r.option)]) expect(whole(o.finalPrice), o.label).toBe(true)
    // Kept cents: the same job to the cent, and the quote says so.
    const kept = quoteJobFor(data, { ...req, overrides: { wholeDollar: false } }, 30)
    expect(kept.pricing).toMatchObject({ wholeDollar: false })
    expect(kept.totals.roundingCents).toBe(0)
    expect(Math.floor(kept.totals.price)).toBe(j.totals.price)
    // A tiny job lifted to the minimum job price: whole dollars.
    const tiny = quoteJobFor({ config: { moveRepair: { minimumJobCents: 35_050, minimumAppliesToNew: true } }, inventory: [], kits: [] }, { ...req, runs: [{ ft: 6, rail: 'auto' as const }], walkGates: 0, offer: [], compare: false }, 30)
    expect(tiny.newMin).toBe(true)
    expect([tiny.totals.price, tiny.totals.roundingCents]).toEqual([350, 50])
  })

  test('a move: rounded after the minimum job price; commission on the price before rounding', () => {
    const settings = moveRepairSettings({})
    const common = (extra: Partial<WorkCommon> = {}): WorkCommon => ({ style: st("WV-ND 6'x6' Privacy", { margin: 0.56 }), pricing: { ...calcPricing, commissionSalesman: 0.1 }, settings, overheadPct: 30, hasSalesman: true, priceAdjust: 0, extraLaborHrs: 0, ...extra })
    const m = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd' as const, newPostCaps: false }
    const line = { runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }
    const r = priceMove(common(), m, line)
    const exact = priceMove(common({ overrides: { wholeDollar: false } }), m, line)
    expect(r.priceCents % 100).toBe(0)
    expect(r.priceCents).toBe(Math.floor(exact.priceCents / 100) * 100)
    expect(r.roundingCents).toBe(exact.priceCents - r.priceCents)
    expect(r.commissionCents).toBe(exact.commissionCents)
    expect(exact.grossMarginCents - r.grossMarginCents).toBe(r.roundingCents)
    const tiny = priceMove(common({ settings: { ...settings, minimumJobCents: 35_075 } }), { ...m, oldFt: 6 }, { ...line, runs: [6] })
    expect([tiny.minimumApplied, tiny.priceCents, tiny.roundingCents]).toEqual([true, 35_000, 75])
    const prop = buildWorkProposal({ kind: 'move', description: 'Move', options: [], company: { name: '', phone: '', email: '' }, customer: { name: '', address: '' }, warranty: '', settings: {}, footageFt: 100, gatesText: '', photoIds: {} })
    expect(prop.wholeDollar).toBe(true)
  })
})

describe('deposit and final: whole dollars that add up to the contract', () => {
  test('a whole dollar contract: deposit rounded down, the final takes the rest', () => {
    for (const [contract, pct] of [[500_100, 50], [1_234_500, 33], [999_900, 25], [35_000, 50], [1_000_000, 40]] as const) {
      const dep = depositOf(contract, pct, true)
      const fin = finalOf(contract, [dep])
      expect(dep % 100, `${contract} ${pct}%`).toBe(0)
      expect(fin % 100).toBe(0)
      expect(dep + fin).toBe(contract)
      expect(dep).toBeLessThanOrEqual(Math.round(contract * pct / 100))
    }
    // The same numbers the proposal page shows (routes/proposal.ts): $5,001 at 50% is a $2,500 deposit.
    expect(depositDollars({ depositPct: 50, wholeDollar: true }, 5001)).toBe(2500)
    expect(depositOf(500_100, 50, true)).toBe(250_000)
  })

  test('a contract signed before Oct 29 2026 keeps its deposit to the cent; a cents proposal shows and bills the dollar it showed', () => {
    // Signed before (lib/customerDollars.ts): to the cent, as it was billed and printed.
    expect(depositOf(500_027, 50)).toBe(250_014)
    // The page of a cents proposal (sent before the whole dollar rule) shows the deposit to the dollar, and signing
    // now bills that (Jonathan, Oct 29 2026, D1: "Customers pay what they saw").
    expect(depositDollars({ depositPct: 50 }, 5000.27)).toBe(2500)
    expect(pricedWholeDollar({ proposal: { wholeDollar: true } })).toBe(true)
    expect(pricedWholeDollar({ pricing: { wholeDollar: true } })).toBe(true)
    expect(pricedWholeDollar({ proposal: { depositPct: 50 }, pricing: { costFactor: 0.6 } })).toBe(false)
    expect(pricedWholeDollar(null)).toBe(false)
  })
})

describe('change orders are whole dollars', () => {
  test('lines saved from now on: down for a charge, to the larger credit for a credit', () => {
    expect(wholeDollarLine({ id: 'a', description: 'Add', amountCents: 24_050 }).amountCents).toBe(24_000)
    expect(wholeDollarLine({ id: 'b', description: 'Credit', amountCents: -2_740 }).amountCents).toBe(-2_800)
    expect(wholeDollarLine({ id: 'c', description: 'Gate', amountCents: 39_500 }).amountCents).toBe(39_500)
  })

  test('filled in from the quote builder: every line whole, even on a quote signed with cents', () => {
    const style = st("WV-ND 6'x8' Privacy")
    const signedIn = input(style, { overrides: { wholeDollar: false } })
    const signedPrice = calculateQuote(signedIn).priced.price
    expect(whole(signedPrice)).toBe(false)
    const signed = {
      id: 'q1', fenceStyle: style.name, runs: [97.3, 41.5], runRails: ['auto', 'auto'], corners: 1, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: true, priceAdjust: 0.03, sections: 0, finalPrice: signedPrice,
    } as any
    const current = { ...signedIn, runs: [{ ft: 120 }, { ft: 41.5 }], walkGates: 2 }
    const d = changeOrderDraft({ signed, current, signedOverrides: signedIn.overrides, styles: [style], priceNow: calculateQuote(current).priced.price, sectionsNow: 0, simple: false })
    expect(d.lines.length).toBeGreaterThan(0)
    for (const l of d.lines) expect(l.amountCents % 100, l.description).toBe(0)
    // A move or repair (one price difference line): rounded down too.
    const simple = changeOrderDraft({ signed, current, signedOverrides: signedIn.overrides, styles: [style], priceNow: signedPrice + 240.5, sectionsNow: 0, simple: true })
    expect(simple.lines[simple.lines.length - 1].amountCents).toBe(24_000)
  })

  test('a signed quote with its price set by hand: each change is still priced from cost, never $0', () => {
    const style = st("WV-ND 6'x8' Privacy")
    const signedIn = input(style, { overrides: { finalPrice: 12145.78 } })
    const signed = {
      id: 'q2', fenceStyle: style.name, runs: [97.3, 41.5], runRails: ['auto', 'auto'], corners: 1, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: true, priceAdjust: 0.03, sections: 0, finalPrice: 12145.78,
    } as any
    const current = { ...signedIn, runs: [{ ft: 109.3 }, { ft: 41.5 }], walkGates: 2 }
    const d = changeOrderDraft({ signed, current, signedOverrides: signedIn.overrides, styles: [style], priceNow: 12145.78, sectionsNow: 0, simple: false })
    const fence = d.lines.find(l => /^Add 12 ft of fence/.test(l.description))!
    const gate = d.lines.find(l => /^Add 1 walk gate/.test(l.description))!
    expect(fence.amountCents).toBeGreaterThan(0)
    expect(gate.amountCents).toBeGreaterThan(0)
    for (const l of d.lines) expect(l.amountCents % 100, l.description).toBe(0)
    // The same as the change costs on the quote priced from cost.
    const fromCost = changeOrderDraft({ signed, current: { ...current, overrides: {} }, signedOverrides: {}, styles: [style], priceNow: 0, sectionsNow: 0, simple: false })
    expect(d.lines.map(l => l.amountCents)).toEqual(fromCost.lines.map(l => l.amountCents))
  })
})

describe('where every dollar goes: the cents come out of profit, never overhead', () => {
  test('overhead on the price before rounding; profit takes the cents', () => {
    const at = splitDollars({ price: 5000, materials: 2000, labor: 1000, commission: 0, overheadPct: 20, roundingCents: 73 })
    const before = splitDollars({ price: 5000.73, materials: 2000, labor: 1000, commission: 0, overheadPct: 20 })
    const part = (s: typeof at, k: string) => s.find(p => p.part === k)!.dollars
    expect(part(at, 'overhead')).toBeCloseTo(part(before, 'overhead'), 9)
    expect(part(before, 'profit') - part(at, 'profit')).toBeCloseTo(0.73, 9)
  })
})
