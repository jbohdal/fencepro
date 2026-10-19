/**
 * Commercial and industrial on hold: a style's "Available for quoting" switch
 * (fence style `quotable`). Off: not in the estimates the website, phone and
 * chat give (web/src/estimate.ts, which the server runs), not in the
 * widget's choices, not in Good Better Best or Compare options. On again:
 * back in each. Plus the Customers "Missing contact info" filters.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { estimate, estimateStyles, onHoldStyles, NOT_QUOTABLE_MESSAGE } from '../../web/src/estimate'
import { isQuotable, isOnHold } from '../../web/src/styleAvailability'
import { compareStyles } from '../../web/src/proposal'
import { resolveTiers, tierStyles, type TierSet } from '../../web/src/tiers'
import type { QuoteCalcInput, QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { CUSTOMER_FILTERS, asCustomerFilter } from '../../web/src/customerFilters'
import { widgetCatalog, NOT_QUOTABLE_MESSAGE as SERVER_MESSAGE, isNotQuotable } from '../src/server/lib/estimates'
import { holdStyles, STYLES_ON_HOLD } from '../src/server/lib/stylesOnHold'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const st = (name: string, category: string, panelWidth = 10, extra: Record<string, unknown> = {}) =>
  ({ id: name, name, category, margin: 0.6, targetProfitPct: 12, sectionsPerMH: 1.5, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth, isActive: true, ...extra })
const HELD = [...STYLES_ON_HOLD]
const base = () => [
  st("WV-ND 6'x6' Privacy", 'Vinyl', 6), st("WV-ND 6'x8' Privacy", 'Vinyl', 8),
  st("CL - 6' Galv", 'Chainlink'), st("CL - 6' Black", 'Chainlink'),
  st('Alum - ND - Emily - 48', 'Aluminum', 6), st('Alum - DS - Emily - 48', 'Aluminum', 6),
  st("CL - Com 6'", 'Commercial'), st("CL - Com 6'+1'", 'Commercial'), st("CL - Com 6'+1' Black", 'Commercial'),
  st('Alum - DS - Ind Abigail', 'Aluminum', 8), st('Durafence', 'Other', 8),
]
const held = () => holdStyles(base()).styles as ReturnType<typeof base>
const config = (fenceStyles: unknown[]) => ({ fenceStyles, company: { name: 'Getter Done Fence', phone: '3527894314' } }) as any
const job = (fenceStyle: string) => ({ fenceStyle, runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })

describe('the migration: the five styles, exactly', () => {
  test('sets quotable false on exactly the five names; a second run changes nothing', () => {
    const first = holdStyles(base())
    expect(first.changed.sort()).toEqual([...HELD].sort())
    expect((first.styles as any[]).filter(s => s.quotable === false).map(s => s.name).sort()).toEqual([...HELD].sort())
    const again = holdStyles(first.styles)
    expect(again.changed).toEqual([])
    expect(again.styles).toBe(first.styles)
  })
  test('a style named differently (Alum - DS - Emily - 48) is left alone', () => {
    expect((held() as any[]).find(s => s.name === 'Alum - DS - Emily - 48').quotable).toBeUndefined()
  })
})

describe('estimates (website widget, phone agent, chat, /api/quotes)', () => {
  test('the five are not offered; the rest are', () => {
    const names = estimateStyles(config(held())).map(s => s.name)
    for (const h of HELD) expect(names).not.toContain(h)
    expect(names).toContain("CL - 6' Galv")
  })
  test('asking for one gets "Call us for commercial and industrial fencing"', () => {
    for (const h of HELD) {
      let err: unknown
      try { estimate({ config: config(held()), inventory: [], kits: [] }, job(h)) } catch (e) { err = e }
      expect(isNotQuotable(err)).toBe(true)
      expect((err as Error).message).toBe('Call us for commercial and industrial fencing')
    }
    expect(SERVER_MESSAGE).toBe(NOT_QUOTABLE_MESSAGE)
  })
  test('the widget\'s choices have no commercial chain link and no Industrial Abigail; its on hold line has the phone', () => {
    const cat = widgetCatalog(estimateStyles(config(held())))
    expect(cat.some(m => m.material === 'chain-link-commercial')).toBe(false)
    expect(JSON.stringify(cat)).not.toContain('Ind Abigail')
    expect(onHoldStyles(config(held()))).toEqual({ styles: HELD.map(n => ({ name: n, category: base().find(s => s.name === n)!.category })), phone: '3527894314' })
  })
  test('turned back on: offered and priced again everywhere', () => {
    const back = held().map(s => (s.name === "CL - Com 6'" ? { ...s, quotable: true } : s))
    expect(estimateStyles(config(back)).map(s => s.name)).toContain("CL - Com 6'")
    expect(estimate({ config: config(back), inventory: [], kits: [] }, job("CL - Com 6'")).price).toBeGreaterThan(0)
    expect(widgetCatalog(estimateStyles(config(back))).some(m => m.material === 'chain-link-commercial')).toBe(true)
    expect(onHoldStyles(config(back)).styles.map(s => s.name)).not.toContain("CL - Com 6'")
  })
  test('a style turned off (Active off) is neither offered nor "on hold"', () => {
    const off = base().map(s => (s.name === 'Durafence' ? { ...s, isActive: false } : s))
    expect(isQuotable(off.find(s => s.name === 'Durafence'))).toBe(false)
    expect(isOnHold(off.find(s => s.name === 'Durafence'))).toBe(false)
  })
})

describe('Good Better Best and Compare options', () => {
  const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Chainlink: 2 } }
  const input = (style: QuoteStyle): QuoteCalcInput => ({
    style, runs: [{ ft: 100 }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
  })
  const set: TierSet = { id: 'c', category: 'Commercial', tiers: [
    { key: 'good', name: 'Good', install: 'same', width: 'same', color: 'same', style: "CL - Com 6'", text: '' },
    { key: 'better', name: 'Better', install: 'same', width: 'same', color: 'same', style: "CL - 6' Galv", text: '' },
  ], popular: null, sortOrder: 0, version: 1 }

  test('a tier set on a style that is on hold is not offered, and says why', () => {
    const styles = held()
    const own = styles.find(s => s.name === "CL - 6' Galv")! as unknown as QuoteStyle
    const r = tierStyles(set.tiers[0], own, styles as any)
    expect('reason' in r && r.reason).toMatch(/not available for quoting/)
    const tiers = resolveTiers(input(own), styles as any, set)
    expect(tiers[0].style).toBeUndefined()
    expect(tiers[1].style?.name).toBe("CL - 6' Galv")
  })
  test('a tier swapped by hand to a style on hold is not used', () => {
    const styles = held()
    const own = styles.find(s => s.name === "CL - 6' Galv")! as unknown as QuoteStyle
    const tiers = resolveTiers(input(own), styles as any, set, { off: [], swap: { better: 'Durafence' } })
    expect(tiers[1].swapped).toBe(false)
    expect(tiers[1].style?.name).toBe("CL - 6' Galv")
  })
  test('turned back on, the tier is offered', () => {
    const styles = held().map(s => (s.name === "CL - Com 6'" ? { ...s, quotable: true } : s))
    const own = styles.find(s => s.name === "CL - 6' Galv")! as unknown as QuoteStyle
    expect(resolveTiers(input(own), styles as any, set)[0].style?.name).toBe("CL - Com 6'")
  })
  test('Compare options leave out styles on hold, but always keep the quote\'s own', () => {
    const styles = held().map(s => (s.name === "CL - 6' Black" ? { ...s, quotable: false } : s))
    const own = styles.find(s => s.name === "CL - 6' Galv")!
    expect(compareStyles(own as any, styles as any).map((s: any) => s.name)).toEqual(["CL - 6' Galv"])
    const com = styles.find(s => s.name === "CL - Com 6'")!
    expect(compareStyles(com as any, styles as any).map((s: any) => s.name)).toEqual(["CL - Com 6'"])
  })
})

describe('Customers: Missing contact info', () => {
  const c = (phone: string, email: string, notes = '') => ({ phone, email, notes })
  test('no phone and no email (blank spaces count as none)', () => {
    const t = CUSTOMER_FILTERS['missing-contact'].test
    expect(t(c('', ''))).toBe(true)
    expect(t(c('  ', ' '))).toBe(true)
    expect(t(c('3525550100', ''))).toBe(false)
    expect(t(c('', 'a@b.co'))).toBe(false)
  })
  test('from the GD Schedule: the same, made from the schedule (what the Finish setup card counts)', () => {
    const t = CUSTOMER_FILTERS['missing-contact-schedule'].test
    expect(t(c('', '', 'Created from the GD Schedule (first job Feb 24, installed 2024-02-10).'))).toBe(true)
    expect(t(c('', '', 'Imported from JobNimbus'))).toBe(false)
    expect(t(c('3525550100', '', 'Created from the GD Schedule'))).toBe(false)
  })
  test('the address names a filter, or none', () => {
    expect(asCustomerFilter('missing-contact')).toBe('missing-contact')
    expect(asCustomerFilter('missing-contact-schedule')).toBe('missing-contact-schedule')
    expect(asCustomerFilter('nope')).toBe('')
    expect(asCustomerFilter(null)).toBe('')
  })
})
