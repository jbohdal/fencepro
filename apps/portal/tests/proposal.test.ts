/** Proposals: which options are offered, how they are priced and labeled. */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { compareStyles, optionLabel, monthlyPayment, buildProposal, priceOption } from '../../web/src/proposal'
import { monthlyPayment as serverMonthly } from '../src/server/routes/proposal.js'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const st = (name: string, extra: Partial<QuoteStyle & { isActive: boolean }> = {}) =>
  ({ name, category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, isActive: true, ...extra })
const STYLES = [
  st('WV-Auto ND Privacy', { autoRailMix: true, installMethod: 'no-dig', colorFamily: 'white' }),
  st("WV-ND 6'x6' Privacy"), st("WV-ND 6'x8' Privacy"), st("WV-DS 6'x6' Privacy"), st("WV-DS 6'x8' Privacy"),
  st("TV-ND 6'x6' Privacy"), st("TV-ND 6'x8' Privacy"), st("TV-DS 6'x6' Privacy"), st("TV-DS 6'x8' Privacy", { isActive: false }),
  st("WV-ND 8'x6' Privacy"), st("WV-ND 8'x8' Privacy"),
  st("CL - 4' Galv", { category: 'Chainlink' }), st("CL - 4' Black", { category: 'Chainlink' }), st("CL - 5' Galv", { category: 'Chainlink' }),
  st('Durafence', { category: 'Other' }),
]
const by = (n: string) => STYLES.find(s => s.name === n)!
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const input = (style: QuoteStyle): QuoteCalcInput => ({
  style, runs: [{ ft: 100 }, { ft: 100 }, { ft: 100 }], corners: 2, ends: 4, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
})

describe('which options make sense', () => {
  test('6 ft tall vinyl: width, color and install, active styles only, itself first', () => {
    expect(compareStyles(by("WV-ND 6'x8' Privacy"), STYLES).map(s => s.name)).toEqual([
      "WV-ND 6'x8' Privacy", "WV-ND 6'x6' Privacy", "WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy", "TV-ND 6'x6' Privacy", "TV-ND 6'x8' Privacy", "TV-DS 6'x6' Privacy",
    ])
  })
  test('auto mix compares the 6 ft tall vinyl styles', () => {
    expect(compareStyles(by('WV-Auto ND Privacy'), STYLES)).toHaveLength(8)
  })
  test('8 ft tall vinyl compares only 8 ft tall', () => {
    expect(compareStyles(by("WV-ND 8'x6' Privacy"), STYLES).map(s => s.name)).toEqual(["WV-ND 8'x6' Privacy", "WV-ND 8'x8' Privacy"])
  })
  test('chain link: galvanized vs black at the same height', () => {
    expect(compareStyles(by("CL - 4' Galv"), STYLES).map(s => s.name)).toEqual(["CL - 4' Galv", "CL - 4' Black"])
  })
  test('nothing to compare for other styles', () => {
    expect(compareStyles(by('Durafence'), STYLES).map(s => s.name)).toEqual(['Durafence'])
  })
})

describe('labels and payments', () => {
  test('plain labels', () => {
    expect(optionLabel("TV-DS 6'x8' Privacy")).toBe('Tan vinyl privacy, dig set, 6 ft tall, 8 ft wide sections')
    expect(optionLabel("CL - 5' Black")).toBe('Chain link, 5 ft tall, black')
  })
  test('monthly payment: amortized, the same in the browser and on the server', () => {
    expect(monthlyPayment(10000, 9.99, 60)).toBeCloseTo(212.42, 2)
    expect(monthlyPayment(12000, 0, 12)).toBe(1000)
    expect(serverMonthly(10000, 9.99, 60)).toBe(monthlyPayment(10000, 9.99, 60))
  })
})

describe('the proposal', () => {
  test('each option is priced by the quote math; the quote keeps its own price', () => {
    const own = by("WV-ND 6'x8' Privacy")
    const p = buildProposal({
      input: input(own), styles: [own, by("WV-ND 6'x6' Privacy"), by("TV-ND 6'x8' Privacy")], ownPrice: 9500,
      company: { name: 'Getter Done Fence', phone: '352', email: 'x' }, customer: { name: 'A B', address: '1 Main' },
      warranty: 'One year', settings: { depositPct: 50, financing: { months: 60, apr: 9.99 } }, photoIds: {},
    })
    expect(p.options.map(o => o.fenceStyle)).toEqual(["WV-ND 6'x8' Privacy", "WV-ND 6'x6' Privacy", "TV-ND 6'x8' Privacy"])
    expect(p.options[0].finalPrice).toBe(9500)
    const six = calculateQuote({ ...input(by("WV-ND 6'x6' Privacy")) })
    expect(p.options[1].finalPrice).toBe(six.priced.price)
    expect(p.options[1].snapshot.pullSheet).toEqual(six.materials.items)
    expect(p.options[1].snapshot.runSections).toEqual([17, 17, 17])
    expect(p.options[0].snapshot.runSections).toEqual([13, 13, 13])
    expect(p.included[0]).toBe('300 ft of new fence, all materials and installation')
    expect(p.gatesText).toBe('1 walk gate')
    expect(p.depositPct).toBe(50)
    expect(p.financing).toEqual({ provider: '', apr: 9.99, months: 60, link: '' })
  })
  test('a price typed by hand is left out of the other options', () => {
    const o = priceOption({ ...input(by("WV-ND 6'x6' Privacy")), overrides: { finalPrice: 1 } }, by("WV-ND 6'x6' Privacy"))
    expect(o.finalPrice).toBeGreaterThan(1000)
  })
})
