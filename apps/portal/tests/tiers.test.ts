/** Good, Better, Best on vinyl quotes, priced from the same layout. */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { resolveTiers, tierOptions, tierCandidates, DEFAULT_TIERS } from '../../web/src/tiers'
import { buildProposal } from '../../web/src/proposal'
import type { QuoteCalcInput, QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

// Settings as set on 2026-10-14: no dig 0.56, dig set 0.60; sub $24 a section.
const st = (name: string, margin: number, sectionsPerMH: number) => ({ name, category: 'Vinyl', margin, sectionsPerMH, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, isActive: true })
const STYLES: Array<QuoteStyle & { isActive: boolean }> = [
  st("WV-ND 6'x6' Privacy", 0.56, 1.2), st("WV-ND 6'x8' Privacy", 0.56, 1.2),
  st("WV-DS 6'x6' Privacy", 0.6, 0.8), st("WV-DS 6'x8' Privacy", 0.6, 0.8),
  st("TV-ND 6'x6' Privacy", 0.56, 1.2), st("TV-ND 6'x8' Privacy", 0.56, 1.2),
  st("TV-DS 6'x6' Privacy", 0.6, 1.1),
]
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
// The 300 ft backyard: 3 runs of 100, 2 corners, 2 ends, 1 walk gate.
const input = (style: QuoteStyle): QuoteCalcInput => ({
  style, runs: [{ ft: 100 }, { ft: 100 }, { ft: 100 }], corners: 2, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
})

describe('300 ft backyard', () => {
  const tiers = resolveTiers(input(STYLES[1]), STYLES)

  test('shows all three tiers: white dig set, white no dig (most popular), tan no dig', () => {
    expect(tiers.map(t => [t.spec.label, t.style.name.slice(0, 5), t.popular])).toEqual([
      ['Good', 'WV-DS', false], ['Better', 'WV-ND', true], ['Best', 'TV-ND', false],
    ])
  })

  test('Better is priced above Good, and Best above Better', () => {
    const [good, better, best] = tiers.map(t => t.option.finalPrice)
    expect(better).toBeGreaterThan(good)
    expect(best).toBeGreaterThan(better)
  })

  test('each tier uses the width that prices lower, and says which', () => {
    for (const t of tiers) {
      expect(t.widthFt).not.toBeNull()
      expect(t.otherWidth!.price).toBeGreaterThanOrEqual(t.option.finalPrice)
      expect(t.style.name).toContain(`x${t.widthFt}'`)
    }
  })

  test('a tier left off is not offered; a swapped tier uses the chosen style', () => {
    const t = resolveTiers(input(STYLES[1]), STYLES, DEFAULT_TIERS, 'better', { off: ['good'], swap: { best: "TV-ND 6'x6' Privacy" } })
    expect(tierOptions(t).map(o => o.tier!.key)).toEqual(['better', 'best'])
    expect(t[2].style.name).toBe("TV-ND 6'x6' Privacy")
    expect(t[2].swapped).toBe(true)
  })

  test('on the proposal: tiers first, the most popular recommended, blurbs carried', () => {
    const own = STYLES.find(s => s.name === tiers[1].style.name)!
    const p = buildProposal({
      input: input(own), styles: [own], ownPrice: 0, company: { name: 'G', phone: '', email: '' }, customer: { name: 'C', address: '' },
      warranty: '', settings: {}, photoIds: {}, tiers: tierOptions(tiers),
    })
    expect(p.options.map(o => o.tier?.label)).toEqual(['Good', 'Better', 'Best'])
    expect(p.recommended).toBe(1)
    expect(p.options[1].badge).toBe('Most popular')
    expect(p.options[0].tier!.blurb).toBe('Dig set: posts set in concrete.')
  })

  test('inactive styles are not used', () => {
    expect(tierCandidates(DEFAULT_TIERS[0], [...STYLES.slice(0, 2), { ...STYLES[2], isActive: false }, STYLES[3]]).map(s => s.name)).toEqual(["WV-DS 6'x8' Privacy"])
  })
})
