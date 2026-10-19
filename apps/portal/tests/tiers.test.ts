/**
 * Good, Better, Best: tier sets turned into styles for one quote and priced
 * from the same layout (web/src/tiers.ts), the starting sets the server makes
 * (lib/tierStarters.ts), and proposals keeping the tiers they were made with.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { resolveTiers, tierOptions, tierStyles, styleParts, sampleInput, SAMPLE_YARDS, type TierSet } from '../../web/src/tiers'
import { buildProposal, priceOption } from '../../web/src/proposal'
import type { QuoteCalcInput, QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { VINYL_STARTER, startersFor, vinylFromOldSettings, tierSetBodySchema } from '../src/server/lib/tierStarters'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

// Settings as set on 2026-10-14: no dig 0.56, dig set 0.60; sub $24 a section.
const st = (name: string, margin: number, sectionsPerMH: number, category = 'Vinyl', panelWidth = 6) =>
  ({ name, category, margin, sectionsPerMH, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth, isActive: true })
const STYLES: Array<QuoteStyle & { isActive: boolean; category: string }> = [
  st("WV-ND 6'x6' Privacy", 0.56, 1.2), st("WV-ND 6'x8' Privacy", 0.56, 1.2, 'Vinyl', 8),
  st("WV-DS 6'x6' Privacy", 0.6, 0.8), st("WV-DS 6'x8' Privacy", 0.6, 0.8, 'Vinyl', 8),
  st("TV-ND 6'x6' Privacy", 0.56, 1.2), st("TV-ND 6'x8' Privacy", 0.56, 1.2, 'Vinyl', 8),
  st("TV-DS 6'x6' Privacy", 0.6, 1.1), st("TV-DS 6'x8' Privacy", 0.6, 1.1, 'Vinyl', 8),
  { ...st('WV-Auto ND Privacy', 0.56, 1.2), autoRailMix: true },
  st("CL - 4' Galv", 0.6, 2, 'Chainlink', 10), st("CL - 4' Black", 0.6, 2, 'Chainlink', 10),
  st('Alum - ND - Emily - 48', 0.6, 1, 'Aluminum'), st('Alum - DS - Emily - 48', 0.6, 1, 'Aluminum'),
]
const byName = (n: string) => STYLES.find(s => s.name === n)!
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
// The 300 ft backyard: 3 runs of 100, 2 corners, 2 ends, 1 walk gate.
const input = (style: QuoteStyle): QuoteCalcInput => ({
  style, runs: [{ ft: 100 }, { ft: 100 }, { ft: 100 }], corners: 2, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
})
const VINYL: TierSet = { id: 'v', category: 'Vinyl', tiers: VINYL_STARTER, popular: 'better', sortOrder: 0, version: 1 }

describe('the vinyl set on a white quote (300 ft backyard)', () => {
  // Priced once the Inventory prices are in place.
  let tiers: ReturnType<typeof resolveTiers> = []
  beforeAll(() => { tiers = resolveTiers(input(byName("WV-ND 6'x8' Privacy")), STYLES, VINYL) })

  test('Good dig set, Better no dig (Most popular), Best no dig: all white, like the quote', () => {
    expect(tiers.map(t => [t.spec.name, t.style!.name.slice(0, 5), t.popular])).toEqual([
      ['Good', 'WV-DS', false], ['Better', 'WV-ND', true], ['Best', 'WV-ND', false],
    ])
  })

  test('Best uses 6 ft wide sections', () => {
    expect(styleParts(tiers[2].style!.name)!.width).toBe(6)
    expect(tiers[2].style!.name).toBe("WV-ND 6'x6' Privacy")
  })

  test('Good and Better use whichever width prices lower, and say which', () => {
    for (const t of tiers.slice(0, 2)) {
      expect(t.widthFt).not.toBeNull()
      expect(t.otherWidth!.price).toBeGreaterThanOrEqual(t.option!.finalPrice)
      expect(t.style!.name).toContain(`x${t.widthFt}'`)
    }
  })

  test('every price is the quote math for that style', () => {
    for (const t of tiers) expect(t.option!.finalPrice).toBe(priceOption(input(t.style!), t.style!).finalPrice)
  })

  test('the words for the proposal are the new lineup', () => {
    expect(tiers.map(t => t.spec.text)).toEqual([
      'Posts set in concrete. Solid fence at the best price.',
      'Steel pipe driven deep, no concrete, faster install.',
      'More posts per foot for the strongest fence we build.',
    ])
  })

  test('a tier left off is not offered; a swapped tier uses the chosen style', () => {
    const t = resolveTiers(input(byName("WV-ND 6'x8' Privacy")), STYLES, VINYL, { off: ['good'], swap: { best: "TV-ND 6'x6' Privacy" } })
    expect(tierOptions(t).map(o => o.tier!.key)).toEqual(['better', 'best'])
    expect(t[2].style!.name).toBe("TV-ND 6'x6' Privacy")
    expect(t[2].swapped).toBe(true)
  })

  test('on the proposal: tiers first, the most popular recommended, words carried, the set kept with it', () => {
    const own = tiers[1].style!
    const p = buildProposal({
      input: input(own), styles: [own], ownPrice: 0, company: { name: 'G', phone: '', email: '' }, customer: { name: 'C', address: '' },
      warranty: '', settings: {}, photoIds: {}, tiers: tierOptions(tiers), tierSet: VINYL,
    })
    expect(p.options.slice(0, 3).map(o => o.tier?.label)).toEqual(['Good', 'Better', 'Best'])
    expect(p.recommended).toBe(1)
    expect(p.options[1].badge).toBe('Most popular')
    expect(p.options[0].tier!.blurb).toBe('Posts set in concrete. Solid fence at the best price.')
    expect(p.tierSet!.tiers.map(t => t.key)).toEqual(['good', 'better', 'best'])
  })

  test("a tier's own photo goes on its option, ahead of the style's photo", () => {
    const opts = tierOptions(tiers, { 'tier:Vinyl:best': 'photo-best' })
    const p = buildProposal({
      input: input(tiers[1].style!), styles: [tiers[1].style!], ownPrice: 0, company: { name: 'G', phone: '', email: '' }, customer: { name: 'C', address: '' },
      warranty: '', settings: {}, photoIds: { "WV-ND 6'x6' Privacy": 'style-photo', "WV-DS 6'x8' Privacy": 'ds-photo' }, tiers: opts,
    })
    expect(p.options[2].photoId).toBe('photo-best')
    expect(p.options[0].photoId).toBe(p.options[0].fenceStyle === "WV-DS 6'x8' Privacy" ? 'ds-photo' : null)
  })

  test('inactive styles are not used', () => {
    const fewer = STYLES.map(s => (s.name === "WV-DS 6'x6' Privacy" ? { ...s, isActive: false } : s))
    const r = tierStyles(VINYL_STARTER[0], byName("WV-ND 6'x8' Privacy"), fewer)
    expect('styles' in r && r.styles.map(s => s.name)).toEqual(["WV-DS 6'x8' Privacy"])
  })
})

describe('color follows the quote', () => {
  test('a tan quote gets tan tiers, Best included (no switch to another color)', () => {
    const t = resolveTiers(input(byName("TV-ND 6'x8' Privacy")), STYLES, VINYL)
    expect(t.map(x => x.style!.name.slice(0, 2))).toEqual(['TV', 'TV', 'TV'])
    expect(t[2].style!.name).toBe("TV-ND 6'x6' Privacy")
  })

  test('a white auto mix quote gets white tiers', () => {
    const t = resolveTiers(input(byName('WV-Auto ND Privacy')), STYLES, VINYL)
    expect(t.map(x => x.style!.name.slice(0, 2))).toEqual(['WV', 'WV', 'WV'])
    expect(t[2].style!.name).toBe("WV-ND 6'x6' Privacy")
  })
})

describe('a tier that cannot be built says why', () => {
  test('a missing style', () => {
    const noTan6 = STYLES.filter(s => s.name !== "TV-ND 6'x6' Privacy")
    const t = resolveTiers(input(byName("TV-ND 6'x8' Privacy")), noTan6, VINYL)
    expect(t[2].style).toBeUndefined()
    expect(t[2].reason).toBe('No tan, no dig, 6 ft tall, 6 ft wide vinyl privacy style is turned on in Settings → Fence Styles.')
    expect(tierOptions(t).map(o => o.tier!.key)).toEqual(['good', 'better'])
  })

  test('a style tiers cannot read', () => {
    const bell = { ...st("WV-ND Bell 4'x6'", 0.56, 1.2), isActive: true }
    const t = resolveTiers(input(bell), [...STYLES, bell], VINYL)
    expect(t.every(x => !x.style && /is not one tiers can be built from/.test(x.reason!))).toBe(true)
  })

  test('a specific style that is turned off', () => {
    const set = { ...VINYL, tiers: [{ ...VINYL_STARTER[0], style: 'Durafence' }] }
    expect(resolveTiers(input(byName("WV-ND 6'x8' Privacy")), STYLES, set)[0].reason).toBe('The style Durafence is not turned on in Settings → Fence Styles.')
  })
})

describe('other settings on a tier', () => {
  test('a specific style wins over install, width and color', () => {
    const set = { ...VINYL, tiers: [{ ...VINYL_STARTER[2], style: "TV-DS 6'x8' Privacy" }] }
    expect(resolveTiers(input(byName("WV-ND 6'x8' Privacy")), STYLES, set)[0].style!.name).toBe("TV-DS 6'x8' Privacy")
  })

  test('a price adjustment goes through the quote math (Price adjust)', () => {
    const plain = resolveTiers(input(byName("WV-ND 6'x8' Privacy")), STYLES, VINYL)[2].option!.finalPrice
    const up = resolveTiers(input(byName("WV-ND 6'x8' Privacy")), STYLES, { ...VINYL, tiers: VINYL_STARTER.map(t => ({ ...t, priceAdjustPct: 10 })) })[2].option!.finalPrice
    const direct = priceOption({ ...input(byName("WV-ND 6'x6' Privacy")), priceAdjust: 0.1 }, byName("WV-ND 6'x6' Privacy")).finalPrice
    expect(up).toBe(direct)
    expect(up).toBeGreaterThan(plain)
  })

  test('chain link: two options, dig set (none until it is added and priced) and no dig', () => {
    const set: TierSet = { id: 'c', category: 'Chainlink', popular: 'better', sortOrder: 1, version: 1, tiers: startersFor({ fenceStyles: STYLES }).find(s => s.key === 'chainlink')!.tiers }
    const t = resolveTiers(input(byName("CL - 4' Galv")), STYLES, set)
    expect(t.map(x => x.style?.name ?? null)).toEqual([null, "CL - 4' Galv"])
    expect(t[1].popular).toBe(true)
  })
  test('chain link: a tier set to another finish still gives galvanized and black of the same height', () => {
    const set: TierSet = { id: 'c', category: 'Chainlink', popular: null, sortOrder: 1, version: 1, tiers: [
      { key: 'good', name: 'Good', install: 'same', width: 'same', color: 'galv', text: '' },
      { key: 'better', name: 'Better', install: 'same', width: 'same', color: 'black', text: '' },
    ] }
    expect(resolveTiers(input(byName("CL - 4' Galv")), STYLES, set).map(t => t.style!.name)).toEqual(["CL - 4' Galv", "CL - 4' Black"])
  })

  test('aluminum: dig set and no dig of the same model', () => {
    const set: TierSet = { id: 'a', category: 'Aluminum', popular: null, sortOrder: 2, version: 1, tiers: startersFor({ fenceStyles: STYLES }).find(s => s.key === 'aluminum')!.tiers }
    expect(resolveTiers(input(byName('Alum - ND - Emily - 48')), STYLES, set).map(t => t.style!.name)).toEqual(['Alum - DS - Emily - 48', 'Alum - ND - Emily - 48'])
  })
})

describe('changing a tier in Settings changes new quotes, not sent ones', () => {
  test('a new quote uses the edited set; the sent proposal keeps its prices and words', () => {
    const own = byName("WV-ND 6'x8' Privacy")
    const sentTiers = resolveTiers(input(own), STYLES, VINYL)
    const sent = buildProposal({ input: input(own), styles: [own], ownPrice: 0, company: { name: 'G', phone: '', email: '' }, customer: { name: 'C', address: '' }, warranty: '', settings: {}, photoIds: {}, tiers: tierOptions(sentTiers), tierSet: VINYL })
    const frozen = JSON.parse(JSON.stringify(sent))

    // Settings: Best renamed, new words, 8 ft wide, 15% more.
    const edited: TierSet = { ...VINYL, version: 2, tiers: VINYL_STARTER.map(t => (t.key === 'best' ? { ...t, name: 'Premium', text: 'Our top fence.', width: '8' as const, priceAdjustPct: 15 } : t)) }
    const fresh = resolveTiers(input(own), STYLES, edited)
    expect(fresh[2].spec.name).toBe('Premium')
    expect(fresh[2].option!.finalPrice).not.toBe(sentTiers[2].option!.finalPrice)

    // The sent proposal is what was frozen; reopened, the quote uses the set it was sent with.
    expect(sent).toEqual(frozen)
    const reopened = resolveTiers(input(own), STYLES, sent.tierSet!)
    expect(reopened.map(t => [t.spec.name, t.option!.finalPrice])).toEqual(sentTiers.map(t => [t.spec.name, t.option!.finalPrice]))
    expect(sent.options[2].tier!.label).toBe('Best')
  })
})

describe('starting sets', () => {
  test('made from the styles in Settings; categories as Settings names them', () => {
    const s = startersFor({ fenceStyles: STYLES })
    expect(s.map(x => [x.key, x.category, x.tiers.length, x.popular])).toEqual([
      ['vinyl', 'Vinyl', 3, 'better'], ['chainlink', 'Chainlink', 2, 'better'], ['aluminum', 'Aluminum', 2, 'better'],
    ])
    expect(s.every(x => tierSetBodySchema.safeParse({ tiers: x.tiers, popular: x.popular }).success)).toBe(true)
  })

  test('a category whose styles are not there starts empty', () => {
    const s = startersFor({ fenceStyles: STYLES.filter(x => !/^(CL|Alum)/.test(x.name)) })
    expect(s.map(x => x.tiers.length)).toEqual([3, 0, 0])
  })

  test('old settings: untouched defaults take the new lineup (no tan Best)', () => {
    const old = { tiers: [
      { key: 'good', label: 'Good', color: 'white', install: 'dig-set', heightFt: 6, blurb: 'Dig set: posts set in concrete.' },
      { key: 'better', label: 'Better', color: 'white', install: 'no-dig', heightFt: 6, blurb: 'No dig: steel pipe driven deep, no concrete, faster install.' },
      { key: 'best', label: 'Best', color: 'tan', install: 'no-dig', heightFt: 6, blurb: 'Tan: premium color, on steel pipe driven deep with no concrete.' },
    ], popular: 'better' }
    expect(vinylFromOldSettings(old)).toEqual({ tiers: VINYL_STARTER, popular: 'better' })
    expect(vinylFromOldSettings(undefined)).toEqual({ tiers: VINYL_STARTER, popular: 'better' })
    expect(vinylFromOldSettings({ financing: {} })).toEqual({ tiers: VINYL_STARTER, popular: 'better' })
  })

  test('old settings: his own edits are kept', () => {
    const r = vinylFromOldSettings({ tiers: [
      { key: 'good', label: 'Basic', color: 'white', install: 'dig-set', heightFt: 6, blurb: 'Concrete set posts.' },
      { key: 'best', label: 'Best', color: 'tan', install: 'dig-set', heightFt: 6, blurb: 'Tan: premium color, on steel pipe driven deep with no concrete.' },
    ], popular: 'best' })
    expect(r.tiers[0]).toMatchObject({ name: 'Basic', text: 'Concrete set posts.', install: 'dig-set', color: 'same' })
    expect(r.tiers[2]).toMatchObject({ name: 'Best', install: 'dig-set', color: 'same', width: '6' })
    expect(r.popular).toBe('best')
  })

  test('a set has at most 3 tiers with different keys', () => {
    expect(tierSetBodySchema.safeParse({ tiers: [...VINYL_STARTER, { ...VINYL_STARTER[0], key: 'x' }] }).success).toBe(false)
    expect(tierSetBodySchema.safeParse({ tiers: [VINYL_STARTER[0], VINYL_STARTER[0]] }).success).toBe(false)
  })
})

describe('sample yards for the Settings preview', () => {
  test('measured by the yard layout rules', () => {
    const i = sampleInput('straight150', byName("WV-ND 6'x8' Privacy"), pricing, DEFAULT_RAIL_OPTIMIZER_SETTINGS)
    expect(i.walkGates).toBe(1)
    expect(i.runs.reduce((t, r) => t + r.ft, 0)).toBe(146)
    const b = sampleInput('backyard300', byName("WV-ND 6'x8' Privacy"), pricing, DEFAULT_RAIL_OPTIMIZER_SETTINGS)
    expect([b.walkGates, b.dblGates]).toEqual([1, 1])
    expect(SAMPLE_YARDS.length).toBeGreaterThanOrEqual(2)
  })
})
