/**
 * The Salesman's fence picker (web/src/salesmanPicks.ts, Jonathan, Nov 2 2026, "so a new Salesman can't get
 * confused"): she picks only Material > Style > Height > Color (Finish, Picket type) > add ons; section width is
 * always the best price; install is the Better option's; a choice with one option is not shown; nothing that cannot
 * be quoted shows. And the quote's main fence is the Better option's fence at the same price.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { simplePicker, widthChoices, betterInstall, picksOf, widthSiblings, oneWidthEach, choiceLabel, AUTO_DIMS } from '../../web/src/salesmanPicks'
import { DEFAULT_CATALOG, resolveFenceStyles, styleLabel, sectionWords, type FenceCatalog } from '../../web/src/fenceCatalog'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { isQuotable } from '../../web/src/styleAvailability'
import { resolveTiers, cheapestStyle, type TierSet } from '../../web/src/tiers'
import { priceOption } from '../../web/src/proposal'
import { WOOD_REAL_STYLES } from '../../web/src/wood'
import { planTanAutoNd } from '../../web/src/tanAutoNd'
import { customerFenceName } from '../src/server/lib/customerFenceName'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { VINYL_STARTER, CHAIN_STARTER, WOOD_STARTER } from '../src/server/lib/tierStarters'
import type { FenceStyle } from '../../web/src/configStore'
import type { QuoteCalcInput, QuoteStyle } from '../../web/src/quoteCalc'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
/** The default styles, every one priced (the picker reads only the switches and the tree), wood's six real ones added. */
function styles(edit: (s: FenceStyle[]) => void = () => {}, catalog: FenceCatalog = DEFAULT_CATALOG): FenceStyle[] {
  const list: FenceStyle[] = clone(DEFAULT_FENCE_STYLES)
  WOOD_REAL_STYLES.forEach((name, i) => {
    const [, style, height, picket, install, width] = name.split('/')
    list.push({ id: `wood${i}`, name, category: 'Wood', margin: 0.6, sectionsPerMH: 1, panelWidth: 8, mhPerWalkGate: 2, mhPerDblGate: 4, isActive: true, material: 'wood', choices: { style, height, picket, install, width } } as FenceStyle)
  })
  edit(list)
  // 8 ft tall vinyl waits for its piece prices in the defaults: priced here, so it shows.
  for (const s of list) if (/ 8'x[68]' Privacy$/.test(s.name)) s.pieceCents = { section: 9000, post: 2700 } as FenceStyle['pieceCents']
  return resolveFenceStyles(list, catalog, () => 1, () => null)
}
const ok = (s: FenceStyle) => isQuotable(s)
const shown = (v: ReturnType<typeof simplePicker>) => v.dims.filter(d => d.shown).map(d => [d.label, d.options.map(o => o.label)])

describe('what she is asked', () => {
  test('vinyl: Style, Height, Color only; never Install or Section width', () => {
    const v = simplePicker(styles(), DEFAULT_CATALOG, 'vinyl', {}, ok)
    expect(v.dims.map(d => d.key)).toEqual(['style', 'height', 'color'])
    expect(v.dims.some(d => AUTO_DIMS.has(d.key))).toBe(false)
    // Privacy picked first: its heights; White and Tan both quote at 6 ft.
    expect(shown(v)).toEqual([['Style', ['Privacy', 'Bell']], ['Height', ['6 ft', '8 ft']], ['Color', ['White', 'Tan']]])
    expect(v.picks).toEqual({ style: 'privacy', height: '6', color: 'white' })
    // Every width and install of White 6 ft privacy is left for the quote to choose between.
    expect(v.candidates.map(s => s.name).sort()).toEqual(["WV-Auto DS Privacy", "WV-Auto ND Privacy", "WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy", "WV-ND 6'x6' Privacy", "WV-ND 6'x8' Privacy"])
  })

  test('a choice with one option is used, not shown: Bell is 4 ft White only', () => {
    const v = simplePicker(styles(), DEFAULT_CATALOG, 'vinyl', { style: 'bell' }, ok)
    expect(shown(v)).toEqual([['Style', ['Privacy', 'Bell']]])
    expect(v.picks).toEqual({ style: 'bell', height: '4', color: 'white' })
    expect(v.candidates.map(s => s.name)).toEqual(["WV-ND Bell 4'x6'"])
  })

  test('anything that cannot be quoted is hidden, not greyed: Tan 8 ft tall off, Other (Durafence) off', () => {
    const list = styles(l => { for (const s of l) if (/^TV-(ND|DS) 8'/.test(s.name) || s.name === 'Durafence') s.quotable = false })
    const v = simplePicker(list, DEFAULT_CATALOG, 'vinyl', { style: 'privacy', height: '8' }, ok)
    expect(shown(v)).toEqual([['Style', ['Privacy', 'Bell']], ['Height', ['6 ft', '8 ft']]])
    expect(v.picks.color).toBe('white')
    expect(simplePicker(list, DEFAULT_CATALOG, 'other', {}, ok).dims).toEqual([])
  })

  test('wood: Style and Picket type only (Height, Install and Section width have one choice each)', () => {
    // No kits in this test: wood counts as priced.
    const v = simplePicker(styles(), DEFAULT_CATALOG, 'wood', {}, s => isQuotable({ ...s, held: undefined }))
    expect(shown(v)).toEqual([['Style', ['Stockade', 'Board on Board', 'Shadow Box']], ['Picket type', ['PT Pine', 'Alta Premium']]])
    expect(v.candidates.map(s => s.name)).toEqual(['wood/stockade/6/pine/ds/8'])
    expect(choiceLabel('wood', { key: 'picket', label: 'Pickets' })).toBe('Picket type')
    expect(choiceLabel('vinyl', { key: 'width', label: 'Panel width' })).toBe('Section width')
    expect(choiceLabel('alum', { key: 'panel', label: 'Panel style' })).toBe('Style')
  })

  test('aluminum: Industrial Abigail off, so Emily 4 ft is used and nothing is asked', () => {
    const list = styles(l => { l.find(s => s.name === 'Alum - DS - Ind Abigail')!.quotable = false })
    const v = simplePicker(list, DEFAULT_CATALOG, 'alum', {}, ok)
    expect(shown(v)).toEqual([])
    expect(v.candidates.map(s => s.name).sort()).toEqual(['Alum - DS - Emily - 48', 'Alum - ND - Emily - 48'])
  })
})

describe('chain link: barbed wire is an add on, not a height', () => {
  test('commercial off (as today): no "6 ft + 1 ft barbed wire" height and no add on; Grade not asked', () => {
    const list = styles(l => { for (const s of l) if (s.category === 'Commercial') s.quotable = false })
    const v = simplePicker(list, DEFAULT_CATALOG, 'chain', {}, ok)
    expect(shown(v)).toEqual([['Height', ['4 ft', '5 ft', '6 ft']], ['Finish', ['Galvanized', 'Black']]])
    expect(v.dims.some(d => d.key === 'barbed' && d.shown)).toBe(false)
  })

  test('a barbed wire fence that can be quoted: 6 ft, then Barbed wire Yes picks the 6+1 fence (its old style)', () => {
    const v0 = simplePicker(styles(), DEFAULT_CATALOG, 'chain', { height: '6' }, ok)
    expect(shown(v0)).toEqual([['Height', ['4 ft', '5 ft', '6 ft']], ['Finish', ['Galvanized', 'Black']], ['Barbed wire', ['No', 'Yes, 1 ft on top']]])
    // The height list never has the add on in it.
    expect(v0.dims.find(d => d.key === 'height')!.options.some(o => /barbed/.test(o.label))).toBe(false)
    const no = widthChoices(v0.candidates, DEFAULT_CATALOG, 'chain', 'no-dig')
    expect(no.map(s => s.name)).toEqual(["CL - 6' Galv"])
    const yes = simplePicker(styles(), DEFAULT_CATALOG, 'chain', { height: '6', barbed: 'yes' }, ok)
    expect(widthChoices(yes.candidates, DEFAULT_CATALOG, 'chain', 'no-dig').map(s => s.name)).toEqual(["CL - Com 6'+1'"])
    expect(picksOf(yes.candidates[0], DEFAULT_CATALOG)).toEqual({ material: 'chain', picks: { height: '6', finish: 'galv', barbed: 'yes' } })
    // At 4 ft there is no barbed wire fence: the add on is not asked.
    expect(simplePicker(styles(), DEFAULT_CATALOG, 'chain', { height: '4' }, ok).dims.some(d => d.key === 'barbed' && d.shown)).toBe(false)
  })

  test('green is made only at 4 ft: it shows at 4 ft and not at 5 or 6 ft', () => {
    const cat: FenceCatalog = clone(DEFAULT_CATALOG)
    cat.materials.find(m => m.key === 'chain')!.dims.find(d => d.key === 'finish')!.options.push({ key: 'green', label: 'Green' })
    const list = styles(l => {
      for (const install of ['nd', 'ds']) l.push({ id: `g${install}`, name: `chain/4/green/res/${install}`, category: 'Chainlink', margin: 0.6, sectionsPerMH: 1, panelWidth: 10, mhPerWalkGate: 1, mhPerDblGate: 2, isActive: true, material: 'chain', choices: { height: '4', finish: 'green', grade: 'res', install }, madeFrom: "CL - 4' Black" } as FenceStyle)
    }, cat)
    const four = simplePicker(list, cat, 'chain', { height: '4' }, s => isQuotable({ ...s, held: undefined }))
    expect(four.dims.find(d => d.key === 'finish')!.options.map(o => o.label)).toEqual(['Galvanized', 'Black', 'Green'])
    const five = simplePicker(list, cat, 'chain', { height: '5', finish: 'green' }, s => isQuotable({ ...s, held: undefined }))
    expect(five.dims.find(d => d.key === 'finish')!.options.map(o => o.label)).toEqual(['Galvanized', 'Black'])
    expect(five.picks.finish).toBe('galv')
  })
})

describe('install and width are worked out', () => {
  test('the Better option says the install; else the first in the tree', () => {
    expect(betterInstall({ tiers: VINYL_STARTER, popular: 'better' })).toBe('no-dig')
    expect(betterInstall({ tiers: CHAIN_STARTER, popular: 'better' })).toBe('no-dig')
    expect(betterInstall({ tiers: WOOD_STARTER, popular: null })).toBeNull()
    expect(betterInstall({ tiers: [{ key: 'good', install: 'dig-set' }, { key: 'top', install: 'dig-set' }], popular: 'top' })).toBe('dig-set')
    expect(betterInstall(null)).toBeNull()
    const v = simplePicker(styles(), DEFAULT_CATALOG, 'vinyl', {}, ok)
    expect(widthChoices(v.candidates, DEFAULT_CATALOG, 'vinyl', 'no-dig').map(s => s.name).sort()).toEqual(["WV-Auto ND Privacy", "WV-ND 6'x6' Privacy", "WV-ND 6'x8' Privacy"])
    expect(widthChoices(v.candidates, DEFAULT_CATALOG, 'vinyl', 'dig-set').map(s => s.name).sort()).toEqual(["WV-Auto DS Privacy", "WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy"])
    expect(widthChoices(v.candidates, DEFAULT_CATALOG, 'vinyl', null).map(s => s.name).sort()).toEqual(["WV-Auto ND Privacy", "WV-ND 6'x6' Privacy", "WV-ND 6'x8' Privacy"])
  })

  test("owner's Advanced width: the same fence in every width, best price first; a Salesman's lists show each fence once", () => {
    const list = styles()
    const own = list.find(s => s.name === "WV-ND 6'x8' Privacy")!
    expect(widthSiblings(own, list).map(w => [w.style.name, w.label])).toEqual([
      ['WV-Auto ND Privacy', 'Best price (6 or 8 ft sections for each run)'],
      ["WV-ND 6'x6' Privacy", 'All 6 ft sections'],
      ["WV-ND 6'x8' Privacy", 'All 8 ft sections'],
    ])
    expect(widthSiblings(list.find(s => s.name === "CL - 4' Galv")!, list)).toEqual([])
    const once = oneWidthEach(list.filter(ok), ways => ways[ways.length - 1]).map(s => s.name)
    expect(once).toContain('WV-Auto ND Privacy')
    expect(once).not.toContain("WV-ND 6'x8' Privacy")
    // 8 ft tall has no best price mix: the width the quote prices lower (here the last given).
    expect(once.filter(n => n.startsWith("WV-ND 8'"))).toEqual(["WV-ND 8'x8' Privacy"])
    expect(once).toContain("CL - 4' Galv")
  })
})

describe('the main price is the Better option: the same fence at the same price', () => {
  const st = (name: string, margin: number, sectionsPerMH: number, category = 'Vinyl', panelWidth = 6, extra: Partial<QuoteStyle> = {}) =>
    ({ id: name, name, category, margin, sectionsPerMH, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth, isActive: true, ...extra }) as unknown as FenceStyle
  const STYLES: FenceStyle[] = [
    st("WV-ND 6'x6' Privacy", 0.56, 1.2), st("WV-ND 6'x8' Privacy", 0.56, 1.2, 'Vinyl', 8),
    st("WV-DS 6'x6' Privacy", 0.6, 0.8), st("WV-DS 6'x8' Privacy", 0.6, 0.8, 'Vinyl', 8),
    st("TV-ND 6'x6' Privacy", 0.56, 1.2), st("TV-ND 6'x8' Privacy", 0.56, 1.2, 'Vinyl', 8),
    st("TV-DS 6'x6' Privacy", 0.6, 1.1), st("TV-DS 6'x8' Privacy", 0.6, 1.1, 'Vinyl', 8),
    st('WV-Auto ND Privacy', 0.56, 1.2, 'Vinyl', 6, { autoRailMix: true, installMethod: 'no-dig', colorFamily: 'white' } as Partial<QuoteStyle>),
    st('WV-Auto DS Privacy', 0.6, 0.8, 'Vinyl', 6, { autoRailMix: true, installMethod: 'dig-set', colorFamily: 'white' } as Partial<QuoteStyle>),
    st('TV-Auto DS Privacy', 0.6, 1.1, 'Vinyl', 6, { autoRailMix: true, installMethod: 'dig-set', colorFamily: 'tan' } as Partial<QuoteStyle>),
  ]
  const ALL = planTanAutoNd(STYLES).fenceStyles
  const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'foot' as const, subRateByCategory: { Vinyl: 5 } }
  const VINYL: TierSet = { id: 'v', category: 'Vinyl', tiers: VINYL_STARTER, popular: 'better', sortOrder: 0, version: 1 }
  const YARDS: Array<{ runs: number[]; walk: number; dbl: number }> = [
    { runs: [20, 95, 128, 95, 20], walk: 1, dbl: 1 },
    { runs: [12, 50, 112, 50, 12], walk: 1, dbl: 0 },
    { runs: [100, 100, 100], walk: 1, dbl: 0 },
    { runs: [64, 48], walk: 0, dbl: 0 },
    { runs: [37, 120, 52], walk: 2, dbl: 1 },
  ]
  const input = (style: QuoteStyle, y: typeof YARDS[number]): QuoteCalcInput => ({
    style, runs: y.runs.map(ft => ({ ft, rail: 'auto' as const })), corners: y.runs.length - 1, ends: 2, walkGates: y.walk, dblGates: y.dbl,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
  })

  for (const color of ['white', 'tan']) {
    test(`${color} 6 ft privacy, every yard: the quote's fence is Better's, at Better's price`, () => {
      const list = resolveFenceStyles(clone(ALL), DEFAULT_CATALOG, () => 1, () => null)
      const v = simplePicker(list, DEFAULT_CATALOG, 'vinyl', { style: 'privacy', height: '6', color }, () => true)
      const ways = widthChoices(v.candidates, DEFAULT_CATALOG, 'vinyl', betterInstall(VINYL))
      // Tan no dig now has its best price fence too, like White.
      expect(ways.some(s => s.autoRailMix)).toBe(true)
      for (const y of YARDS) {
        const main = cheapestStyle(input(ways[0], y), ways)!
        const again = cheapestStyle(input(main, y), ways)!
        expect(again.name, 'the pick is settled').toBe(main.name)
        const better = resolveTiers(input(main, y), list, VINYL).find(t => t.spec.key === 'better')!
        expect(better.style!.name).toBe(main.name)
        expect(Math.round(better.option!.finalPrice * 100)).toBe(Math.round(priceOption(input(main, y), main).finalPrice * 100))
        // Never dearer than any width of that fence.
        for (const s of ways) expect(Math.round(priceOption(input(main, y), main).finalPrice * 100)).toBeLessThanOrEqual(Math.round(priceOption(input(main, y), s).finalPrice * 100))
      }
    })
  }
})

describe('one word: sections', () => {
  test('plain names and the customer name read sections; a label saved with panels does too', () => {
    resolveFenceStyles(styles(), DEFAULT_CATALOG, () => 1, () => null)
    expect(styleLabel("WV-ND 6'x8' Privacy")).toBe('White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig')
    expect(styleLabel('WV-Auto ND Privacy')).toBe('White Vinyl Privacy, 6 ft tall, 6 or 8 ft sections (best price), No dig')
    expect(sectionWords('a 6 ft panels b')).toBe('a 6 ft sections b')
    expect(customerFenceName('White Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), No dig', ['6ft', '8ft'])).toBe('White Vinyl Privacy, 6 ft tall, 6 ft and 8 ft sections, No dig')
    expect(customerFenceName('White Vinyl Privacy, 6 ft tall, 6 or 8 ft sections (best price), No dig', ['8ft'])).toBe('White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig')
    expect(customerFenceName('White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig')).toBe('White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig')
    expect(customerFenceName('Aluminum Emily, 4 ft tall, No dig')).toBe('Aluminum Emily, 4 ft tall, No dig')
  })
})
