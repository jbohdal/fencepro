/**
 * Extra hours on a Subcontractor quote (Nov 3 2026): charged at Settings'
 * "Sub extra labor, per hour", not the crew's man hour rate. Blank in
 * Settings: the man hour rate as before, and the quote says so. Hourly crew
 * quotes are not touched. New fences (pricingEngine), moves and repairs
 * (moveRepair), wood, and the quoted cost record at signing (jobCostingMath).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { calculatePrice, extraHourRate, type PriceInputs, type PricingSettings, type StylePricing } from '../../web/src/pricingEngine'
import { priceMove, moveRepairSettings, type WorkCommon, type MoveInputs } from '../../web/src/moveRepair'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, KIT_KINDS } from '../../web/src/materialKits'
import type { QuoteStyle } from '../../web/src/quoteCalc'
import { quotedCostOf } from '../src/server/lib/jobCostingMath'
import { redactCosts } from '../src/server/lib/costRedact'

const SUB: PricingSettings = {
  manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'foot', subRateDefault: 6, subRateByCategory: { Vinyl: 8 },
  subWalkGate: 50, subDblGate: 90, subTearOutSection: 3, subTearOutGate: 10,
}
const vinyl: StylePricing = { category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }
const job: PriceInputs = {
  sections: 25, footage: 150, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0,
  materialCost: 3000, extraLaborHrs: 2, hasSalesman: false, priceAdjust: 0, style: vinyl, pricing: SUB,
}
const FELL_BACK = /No sub extra labor rate is set in Settings → Pricing, so the extra hours are charged at the man hour rate \(\$22\/hr\)\./

describe('a new fence', () => {
  test('Subcontractor, rate set: 2 extra hours at $30, not the $22 man hour rate; no note', () => {
    const r = calculatePrice({ ...job, pricing: { ...SUB, subExtraHourRate: 30 } })
    expect(r.laborCost).toBe(150 * 8 + 50 + 90 + 2 * 30)
    expect(r.notes.join(' ')).not.toMatch(/extra labor/)
  })
  test('Subcontractor, Settings blank (or 0): the man hour rate as before, and the quote says so', () => {
    for (const p of [SUB, { ...SUB, subExtraHourRate: 0 }]) {
      const r = calculatePrice({ ...job, pricing: p })
      expect(r.laborCost).toBe(150 * 8 + 50 + 90 + 2 * 22)
      expect(r.notes.join(' ')).toMatch(FELL_BACK)
    }
  })
  test('no extra hours: no note, whatever Settings say', () => {
    expect(calculatePrice({ ...job, extraLaborHrs: 0 }).notes.join(' ')).not.toMatch(/extra labor/)
  })
  test('Hourly crew does not change: every man hour, extra hours too, at the man hour rate', () => {
    const mh = 25 / 1.2 + 2.4 + 4.8 + 2
    for (const p of [{ ...SUB, laborMode: 'hourly' as const, subExtraHourRate: 30 }, { ...SUB, subExtraHourRate: 30 }]) {
      const r = calculatePrice({ ...job, pricing: p, overrides: p.laborMode === 'hourly' ? undefined : { laborMode: 'hourly' } })
      expect(r.laborMode).toBe('hourly')
      expect(r.laborCost).toBeCloseTo(mh * 22, 2)
      expect(r.notes.join(' ')).not.toMatch(/extra labor/)
    }
  })
  test('flat labor typed on the quote replaces it all, no note', () => {
    const r = calculatePrice({ ...job, overrides: { laborCost: 900 } })
    expect(r.laborCost).toBe(900)
    expect(r.notes.join(' ')).not.toMatch(/extra labor/)
  })
  test('extraHourRate', () => {
    expect(extraHourRate('hourly', { manHourRate: 22, subExtraHourRate: 30 })).toEqual({ rate: 22, fellBack: false })
    expect(extraHourRate('subcontractor', { manHourRate: 22, subExtraHourRate: 30 })).toEqual({ rate: 30, fellBack: false })
    expect(extraHourRate('subcontractor', { manHourRate: 22 })).toEqual({ rate: 22, fellBack: true })
  })
})

describe('a move (and a wood move)', () => {
  const WV = "WV-ND 6'x6' Privacy"
  const style = (extra: Partial<QuoteStyle> = {}): QuoteStyle => ({ name: WV, category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, ...extra })
  const PRICING: PricingSettings = { ...SUB, manHourRate: 25, subUnit: 'section', subRateByCategory: { Vinyl: 24 }, subWalkGate: 10, subDblGate: 20 }
  const common = (p: PricingSettings, s: QuoteStyle = style(), extra: Partial<WorkCommon> = {}): WorkCommon => ({
    style: s, pricing: p, settings: moveRepairSettings({ moveRepair: { pullNdLaborCents: 500, pullNdDisposalCents: 300 } }), overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 2, ...extra,
  })
  const move: MoveInputs = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false }
  const yard = { runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }
  const line = (r: ReturnType<typeof priceMove>) => r.lines.find(l => l.key === 'extraHours')
  beforeAll(() => {
    const map: Record<string, number> = { 'Tear Out Haul-Away Fence': 9.5, 'Tear Out Haul-Away Gate': 27 }
    for (const k of KIT_KINDS) for (const p of builtInKitSet(WV)!.kits[k] ?? []) map[p.part] = p.fallbackCost
    setMaterialPriceSource(priceSourceFromMap(map))
    setSavedKitSets(() => [])
  })
  afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

  test('Subcontractor, rate set: $30 an hour', () => {
    const r = priceMove(common({ ...PRICING, subExtraHourRate: 30 }), move, yard)
    expect(line(r)).toMatchObject({ cents: 6000, math: '2 hr × $30.00 sub extra labor' })
    expect(r.warnings.join(' ')).not.toMatch(/extra labor/)
  })
  test('Subcontractor, blank: $25 man hour rate as before, said', () => {
    const r = priceMove(common(PRICING), move, yard)
    expect(line(r)).toMatchObject({ cents: 5000, math: '2 hr × $25.00' })
    expect(r.warnings.join(' ')).toMatch(/No sub extra labor rate is set/)
  })
  test('Hourly crew: the man hour rate, whatever the sub rate', () => {
    const r = priceMove(common({ ...PRICING, laborMode: 'hourly', subExtraHourRate: 30 }), move, yard)
    expect(line(r)).toMatchObject({ cents: 5000, math: '2 hr × $25.00' })
    expect(r.warnings.join(' ')).not.toMatch(/extra labor/)
  })
  test('a wood move: extra hours added as they are, at the sub extra labor rate', () => {
    const wood = style({ name: 'wood-test', woodBase: style(), woodFactor: 1.15 })
    const set = priceMove(common({ ...PRICING, subExtraHourRate: 30 }, wood), move, yard)
    const none = priceMove(common({ ...PRICING, subExtraHourRate: 30 }, wood, { extraLaborHrs: 0 }), move, yard)
    expect(line(set)?.cents).toBe(6000)
    expect(set.laborCents - none.laborCents).toBe(6000)
    const blank = priceMove(common(PRICING, wood), move, yard)
    expect(line(blank)?.cents).toBe(5000)
    expect(blank.warnings.join(' ')).toMatch(/No sub extra labor rate is set/)
  })
})

describe('the quoted cost record at signing', () => {
  const q = {
    id: 'q1', fenceStyle: 'WV', salesRep: '', sections: 10, runs: [60], materialCost: 500, laborCost: 0, tearOutCost: 0, totalCOGS: 0, finalPrice: 1500,
    pullSheet: [], pricing: { laborMode: 'subcontractor' }, work: null, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 2,
  }
  const ctx = (p: object) => ({ inventory: [], pricing: { laborMode: 'subcontractor', subUnit: 'foot', manHourRate: 22, subRateDefault: 5, ...p }, signedVia: 'app', signedAt: new Date('2026-11-03T12:00:00Z') })
  test('the sub is paid the extra hours at the sub extra labor rate; blank: the man hour rate', () => {
    expect(quotedCostOf({ ...q, laborCost: 360 }, ctx({ subExtraHourRate: 30 })).labor.subOtherCents).toBe(6000)
    expect(quotedCostOf({ ...q, laborCost: 344 }, ctx({})).labor.subOtherCents).toBe(4400)
  })
})

describe('who sees the rate', () => {
  test('a sub rate: never sent to the Salesman (margin hidden) or the Installer (costs and prices hidden)', () => {
    const settings = { config: { pricing: { subExtraHourRate: 30, subWalkGate: 50 } } }
    expect((redactCosts(settings, { margin: true }) as any).config.pricing).toEqual({})
    expect((redactCosts(settings, { prices: true }) as any).config.pricing).toEqual({})
  })
})
