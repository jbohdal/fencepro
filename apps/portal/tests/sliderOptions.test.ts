/**
 * The percent slider (Price adjust) is on the main option only, as the ± dollar
 * discount is. Jonathan, Nov 3 2026, to "Should the slider also move only the
 * main option?": "Yes." Good, Better, Best, Compare and added options, a move's
 * "Move as is" and a repair's "New fence instead" are priced as with no slider;
 * a tier's own Price adjust (Settings) stays on its option. Signing another
 * option puts the Price adjust it took on the quote.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { buildProposal, priceOption, sentSliderStyles, sliderNoteShown } from '../../web/src/proposal'
import { resolveTiers, type TierSet } from '../../web/src/tiers'
import { quoteJobFor } from '../../web/src/estimate'
import { VINYL_STARTER } from '../src/server/lib/tierStarters'
import { signedPricing } from '../src/server/routes/proposal.js'
import { requestFrom } from '../src/server/lib/quotePricing'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const st = (name: string, margin: number, sectionsPerMH: number, panelWidth = 6) =>
  ({ name, category: 'Vinyl', margin, sectionsPerMH, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth, isActive: true })
const STYLES: Array<QuoteStyle & { isActive: boolean; category: string }> = [
  st("WV-ND 6'x6' Privacy", 0.56, 1.2), st("WV-ND 6'x8' Privacy", 0.56, 1.2, 8),
  st("WV-DS 6'x6' Privacy", 0.6, 0.8), st("WV-DS 6'x8' Privacy", 0.6, 0.8, 8),
]
const byName = (n: string) => STYLES.find(s => s.name === n)!
const own = byName("WV-ND 6'x8' Privacy"), other = byName("WV-DS 6'x6' Privacy")
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const input = (style: QuoteStyle, priceAdjust: number, extra: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style, runs: [{ ft: 100 }, { ft: 100 }, { ft: 100 }], corners: 2, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
})
const VINYL: TierSet = { id: 'v', category: 'Vinyl', tiers: VINYL_STARTER, popular: 'better', sortOrder: 0, version: 1 }
const noSnap = <T extends { snapshot: object }>(o: T) => ({ ...o, snapshot: { ...o.snapshot, priceAdjust: undefined } })

describe('the slider moves the main option only', () => {
  test('+18%: the main option goes up; another style is priced as with no slider and says it took none', () => {
    const up = input(own, 0.18), plain = input(own, 0)
    expect(priceOption(up, own).finalPrice).toBeGreaterThan(priceOption(plain, own).finalPrice)
    const o = priceOption(up, other)
    expect(o.finalPrice).toBe(priceOption(plain, other).finalPrice)
    expect(noSnap(o)).toEqual(noSnap(priceOption(plain, other)))
    expect(o.snapshot.priceAdjust).toBe(0)
    // No slider on the quote: nothing new on the snapshot (proposals saved before stay as they were).
    expect(priceOption(plain, other).snapshot).not.toHaveProperty('priceAdjust')
    expect(priceOption(up, own).snapshot).not.toHaveProperty('priceAdjust')
  })

  test('a negative slider too', () => {
    expect(priceOption(input(own, -0.1), other).finalPrice).toBe(priceOption(input(own, 0), other).finalPrice)
  })

  test('Good, Better, Best: only the card that is the quote\'s own fence moves', () => {
    const t0 = resolveTiers(input(own, 0), STYLES, VINYL), t1 = resolveTiers(input(own, 0.03), STYLES, VINYL)
    expect(t1.map(t => t.style?.name)).toEqual(t0.map(t => t.style?.name))
    for (let i = 0; i < t1.length; i++) {
      const mine = t1[i].style!.name === own.name
      if (mine) expect(t1[i].option!.finalPrice, t1[i].spec.name).toBeGreaterThan(t0[i].option!.finalPrice)
      else expect(t1[i].option!.finalPrice, t1[i].spec.name).toBe(t0[i].option!.finalPrice)
    }
    expect(t1.some(t => t.style!.name === own.name)).toBe(true)
    expect(t1.some(t => t.style!.name !== own.name)).toBe(true)
  })

  test('a tier\'s own Price adjust (Settings) stays on its option, without the quote\'s slider', () => {
    const set = { ...VINYL, tiers: VINYL_STARTER.map(t => ({ ...t, priceAdjustPct: 10 })) }
    const t = resolveTiers(input(own, 0.18), STYLES, set)
    const best = t[2]
    expect(best.style!.name).not.toBe(own.name)
    expect(best.option!.finalPrice).toBe(calculateQuote({ ...input(best.style!, 0.1) }).priced.price)
    expect(best.option!.snapshot.priceAdjust).toBe(0.1)
    // The quote's own fence on a tier takes both.
    const mine = t.find(x => x.style!.name === own.name)!
    expect(mine.option!.finalPrice).toBe(calculateQuote(input(own, 0.28)).priced.price)
  })

  test('the proposal: the main option at the slider, the other at its own price', () => {
    const up = input(own, 0.18)
    const q = calculateQuote(up)
    const p = buildProposal({ input: up, styles: [own, other], ownPrice: q.priced.price, company: { name: '', phone: '', email: '' }, customer: { name: '', address: '' }, warranty: '', settings: {}, photoIds: {} })
    expect(p.options.find(o => o.fenceStyle === own.name)!.finalPrice).toBe(q.priced.price)
    expect(p.options.find(o => o.fenceStyle === other.name)!.finalPrice).toBe(priceOption(input(own, 0), other).finalPrice)
  })
})

describe('a move or repair: the other option takes no slider', () => {
  const data = { config: null, inventory: [], kits: [] }
  const base = {
    fenceStyle: "WV-ND 6'x6' Privacy", runs: [{ ft: 120, rail: 'auto' as const }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, compare: false, offer: [], overrides: {},
  }
  test('"Move as is" keeps its price; the move on the new line takes the +10%', () => {
    const req = { ...base, jobType: 'move' as const, offerMoveAsIs: true, move: { oldFt: 80, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd' as const, newPostCaps: false } }
    const j0 = quoteJobFor(data, { ...req, priceAdjust: 0 }, 30), j = quoteJobFor(data, { ...req, priceAdjust: 0.1 }, 30)
    const [asIs0, main0] = j0.proposalOptions, [asIs, main] = j.proposalOptions
    expect(asIs.label).toMatch(/^Move as is/)
    expect(noSnap(asIs)).toEqual(noSnap(asIs0))
    expect(asIs.snapshot.priceAdjust).toBe(0)
    expect(j.moveAsIs!.priceCents).toBe(j0.moveAsIs!.priceCents)
    expect(main.finalPrice).toBeGreaterThan(main0.finalPrice)
  })

  test('a repair\'s "New fence instead" keeps its price; the repair takes the +10%', () => {
    const req = { ...base, jobType: 'repair' as const, offerNewFence: true, repair: { what: 'other' as const, items: { replaceSection: 12 }, postType: 'nd' as const, newPostCaps: false, gateKind: 'walk' as const, debrisCleared: true } }
    const j0 = quoteJobFor(data, { ...req, priceAdjust: 0 }, 30), j = quoteJobFor(data, { ...req, priceAdjust: 0.1 }, 30)
    const [rep0, nf0] = j0.proposalOptions, [rep, nf] = j.proposalOptions
    expect(nf.label).toMatch(/^New fence instead/)
    expect(noSnap(nf)).toEqual(noSnap(nf0))
    expect(nf.snapshot.priceAdjust).toBe(0)
    expect(rep.finalPrice).toBeGreaterThan(rep0.finalPrice)
    // "A new fence may be the better deal" reads the new fence at the price offered.
    expect(j.repairCheck!.newFenceCents).toBe(Math.round(nf.finalPrice * 100))
  })
})

describe('signing', () => {
  const q = { fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 13301, proposal: { wholeDollar: false }, pricing: {} }
  test('another option puts the Price adjust it took on the quote', () => {
    expect(signedPricing(q, { priceAdjust: 0 }, { fenceStyle: "WV-DS 6'x6' Privacy", finalPrice: 9000 })).toEqual({ priceAdjust: 0 })
    expect(signedPricing(q, { priceAdjust: 0.1, costFactor: 0.4 }, { fenceStyle: "WV-DS 6'x6' Privacy", finalPrice: 9000 })).toEqual({ pricing: { costFactor: 0.4 }, priceAdjust: 0.1 })
  })
  test('the main option, or a proposal priced before (no Price adjust on the snapshot): the quote keeps its own', () => {
    expect(signedPricing(q, {}, { fenceStyle: q.fenceStyle, finalPrice: 13301 })).toEqual({})
    expect(signedPricing(q, {}, { fenceStyle: "WV-DS 6'x6' Privacy", finalPrice: 9000 })).toEqual({})
  })
})

describe('a sent proposal: Make main keeps every option at its sent price (review Nov 3 2026)', () => {
  const base = { company: { name: '', phone: '', email: '' }, customer: { name: '', address: '' }, warranty: '', settings: {}, photoIds: {} }
  const sentWith = (i: QuoteCalcInput) => buildProposal({ ...base, input: i, styles: [own, other], ownPrice: calculateQuote(i).priced.price })
  const priceOf = (p: { options: Array<{ fenceStyle: string; finalPrice: number }> }, name: string) => p.options.find(o => o.fenceStyle === name)!.finalPrice
  // Make main on `name`: the quote's fence is now that one, priced with the sent proposal's slider rule.
  const madeMain = (name: string, sliderOn: string[] | undefined) => {
    const i = input(byName(name), 0.1, sliderOn ? { sliderOn } : {})
    return { main: calculateQuote(i).priced.price, options: Object.fromEntries([own, other].map(s => [s.name, priceOption(i, s).finalPrice])) }
  }

  test('sent after the change (only the main option took the slider): the new main and the old main keep their sent prices', () => {
    const p = sentWith(input(own, 0.1))
    const on = sentSliderStyles(p, 0.1)
    expect(on).toEqual([own.name])
    const m = madeMain(other.name, on)
    expect(m.main).toBe(priceOf(p, other.name))
    expect(m.options[other.name]).toBe(priceOf(p, other.name))
    expect(m.options[own.name]).toBe(priceOf(p, own.name))
    // With no sent rule (a draft), the slider moves to the new main: the reviewer's $10,974 → $12,071.
    expect(madeMain(other.name, undefined).main).toBeGreaterThan(priceOf(p, other.name))
  })

  test('sent before the change (every option took the slider, nothing on its snapshot): all keep their sent prices', () => {
    const i = input(own, 0.1)
    const old = sentWith(i)
    // As it went out before Nov 3 2026: every option at the slider, no Price adjust on any snapshot.
    for (const o of old.options) {
      o.finalPrice = calculateQuote({ ...i, style: byName(o.fenceStyle) }).priced.price
      delete (o.snapshot as { priceAdjust?: number }).priceAdjust
    }
    const on = sentSliderStyles(old, 0.1)
    expect([...on!].sort()).toEqual([own.name, other.name].sort())
    const m = madeMain(other.name, on)
    expect(m.main).toBe(priceOf(old, other.name))
    expect(m.options[other.name]).toBe(priceOf(old, other.name))
    expect(m.options[own.name]).toBe(priceOf(old, own.name))
    // Saved again, every option still says it took the slider, so it reopens the same way.
    expect(sentSliderStyles(sentWith(input(other, 0.1, { sliderOn: on })), 0.1)!.sort()).toEqual([own.name, other.name].sort())
  })

  test('saved again after Make main, a proposal sent after the change reopens with the same rule', () => {
    const on = sentSliderStyles(sentWith(input(own, 0.1)), 0.1)
    const again = sentWith(input(other, 0.1, { sliderOn: on }))
    expect(again.options.find(o => o.fenceStyle === other.name)!.snapshot.priceAdjust).toBe(0)
    expect(sentSliderStyles(again, 0.1)).toEqual([own.name])
  })

  test('the server prices a Salesman\'s sent quote the same way', () => {
    const data = { config: null, inventory: [], kits: [] }
    const req = { fenceStyle: "WV-ND 6'x6' Privacy", runs: [{ ft: 120, rail: 'auto' as const }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, compare: false, offer: [], overrides: {}, jobType: 'new' as const }
    const plain = quoteJobFor(data, { ...req, priceAdjust: 0 }, 30), up = quoteJobFor(data, { ...req, priceAdjust: 0.1 }, 30)
    const held = quoteJobFor(data, { ...req, priceAdjust: 0.1, sliderOn: ['someone else'] }, 30)
    expect(up.calc.priced.price).toBeGreaterThan(plain.calc.priced.price)
    expect(held.calc.priced.price).toBe(plain.calc.priced.price)
    // The phone's request carries it to the server (lib/quotePricing.ts requestFrom).
    expect(requestFrom({ fenceStyle: 'x', sliderOn: ['a', 1, 'b'] }, null, () => null).req.sliderOn).toEqual(['a', 'b'])
    expect(requestFrom({ fenceStyle: 'x' }, null, () => null).req).not.toHaveProperty('sliderOn')
  })

  test('a best price quote shown as a tier\'s card (the fold): that tier keeps the slider after Make main', () => {
    const p = {
      options: [
        { fenceStyle: 'WV-Auto', snapshot: {} },
        { fenceStyle: other.name, tier: { key: 'good' }, snapshot: { priceAdjust: 0 } },
        { fenceStyle: own.name, tier: { key: 'better' }, snapshot: { priceAdjust: 0 } },
      ],
      ownTier: { own: 0, tier: 2 },
    }
    expect(sentSliderStyles(p, 0.1)).toEqual(['WV-Auto', 'tier:better'])
    // The note: the main option is the only fence carrying it until Make main.
    expect(sliderNoteShown(0.1, 3, sentSliderStyles(p, 0.1), 'WV-Auto')).toBe(true)
    expect(sliderNoteShown(0.1, 3, sentSliderStyles(p, 0.1), other.name)).toBe(false)
    // Tiers: the Better card takes the slider whichever fence it picks; Good does not.
    const t0 = resolveTiers(input(other, 0), STYLES, VINYL), t1 = resolveTiers(input(other, 0.1, { sliderOn: ['WV-Auto', 'tier:better'] }), STYLES, VINYL)
    expect(t1[0].option!.finalPrice).toBe(t0[0].option!.finalPrice)
    expect(t1[1].option!.finalPrice).toBe(calculateQuote(input(t1[1].style!, 0.1)).priced.price)
    expect(t1[1].option!.finalPrice).toBeGreaterThan(t0[1].option!.finalPrice)
  })

  test('no slider, or nothing sent: no rule', () => {
    expect(sentSliderStyles(sentWith(input(own, 0)), 0)).toBeUndefined()
    expect(sentSliderStyles({ options: [] }, 0.1)).toBeUndefined()
  })

  test('the note under the slider: only when no option but the main one carries it', () => {
    expect(sliderNoteShown(0.1, 2, undefined, own.name)).toBe(true)
    expect(sliderNoteShown(0.1, 2, [own.name], own.name)).toBe(true)
    // Dave Diamond 8595234e: sent before the change, every option at +2%.
    expect(sliderNoteShown(0.02, 3, [own.name, other.name], own.name)).toBe(false)
    // Made main on a sent quote: the old main carries it, the new one does not.
    expect(sliderNoteShown(0.1, 2, [own.name], other.name)).toBe(false)
    expect(sliderNoteShown(0, 2, undefined, own.name)).toBe(false)
    expect(sliderNoteShown(0.1, 1, undefined, own.name)).toBe(false)
  })
})
