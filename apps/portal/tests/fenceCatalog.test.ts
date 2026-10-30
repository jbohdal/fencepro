/**
 * Fence styles as choices (web/src/fenceCatalog.ts).
 *
 *   - Every style code maps to its choices and a plain name; the codes stay
 *     the internal names, and the 28 live styles' math is untouched (that is
 *     proven on every saved quote by savedQuotesPriceSame.db.test.ts).
 *   - A test job lot color with known section, post and gate prices gives the
 *     expected material cost, with no part counted twice; parts no piece price
 *     covers still price from Inventory; the parts list is the source color's
 *     with the color swapped.
 *   - A color cannot be quoted until it is fully priced (by piece or by part).
 *   - Removing the test color leaves nothing behind.
 *   - Overrides, the color's own Target Profit %, Good Better Best following
 *     the color, a new height, and the website widget.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import {
  DEFAULT_CATALOG, LEGACY_STYLE_CHOICES, plainName, styleLabel, planAddColor, planRemoveOption, planUpdateOption, planAddChoice,
  colorStatus, coverageWarnings, isColorPart, swapColor, previewColorParts, piecePartChoices, defaultCovers, materialOf, optionOf,
  type CatalogState, type JobLotQuote, type InvItem,
} from '../../web/src/fenceCatalog'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { estimateConfig, estimateStyles } from '../../web/src/estimate'
import { calculateQuote, widthComparison, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { compareStyles, priceOption } from '../../web/src/proposal'
import { setMaterialPriceSource, inventoryPriceSource, normalizeItemName } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { isQuotable } from '../../web/src/styleAvailability'
import { resolveTiers } from '../../web/src/tiers'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { widgetCatalog } from '../src/server/lib/estimates'
import type { FenceStyle } from '../../web/src/configStore'

const prices: Record<string, number> = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const baseItems = (): InvItem[] => Object.entries(prices).map(([name, unitCost], i) => ({ id: `fx${i}`, name, unitCost, category: 'Fixture' }))

// The live lineup (28 styles, the five on hold), with the live Target Profit %.
const LIVE: FenceStyle[] = DEFAULT_FENCE_STYLES.map(s => ({
  ...s, targetProfitPct: s.installMethod === 'dig-set' || /-DS /.test(s.name) ? 10 : s.category === 'Vinyl' ? 14 : 12,
  ...(["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail', 'Durafence'].includes(s.name) ? { quotable: false } : {}),
}))
const fresh = (): CatalogState => ({ fenceStyles: JSON.parse(JSON.stringify(LIVE)), fenceCatalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG)), items: baseItems(), kits: [] })

/** Settings as the app reads them, with this Inventory and these kits as the sources. */
function use(st: CatalogState) {
  setMaterialPriceSource(inventoryPriceSource(st.items))
  setSavedKitSets(() => st.kits)
  return estimateConfig({ fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog, pricing: { overheadPct: 30 } } as any)
}
afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

const job = (style: any, cfg: any, over: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style, runs: [{ ft: 37, rail: 'auto' }, { ft: 120, rail: 'auto' }, { ft: 52, rail: 'auto' }], corners: 2, ends: 2, walkGates: 1, dblGates: 1,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
  pricing: cfg.pricing, overrides: {}, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...over,
})

const PIECES = { section6: 9100, section8: 11500, post: 3150, walkGate: 32000, dblGate: 61000 }
const LOT = (covers: JobLotQuote['covers'], over: Partial<JobLotQuote['byHeight'][string]> = {}): JobLotQuote => ({
  supplier: 'Test Supply', quotedOn: '2026-10-01', covers,
  byHeight: {
    '6': { sectionCents: { '6': PIECES.section6, '8': PIECES.section8 }, postCents: PIECES.post, walkGateCents: PIECES.walkGate, dblGateCents: PIECES.dblGate, ...over },
    '8': { sectionCents: { '6': 14000, '8': 17500 }, postCents: 4000, walkGateCents: 45000, dblGateCents: 90000 },
  },
})
const ADD = { material: 'vinyl', under: { dim: 'style', key: 'privacy' }, label: 'Testclay', copyFrom: 'white' }

describe('choices and plain names for the old codes', () => {
  test('every code the app has had maps to choices, a plain name, and a path in the tree', () => {
    for (const s of LIVE) expect(LEGACY_STYLE_CHOICES[s.name], s.name).toBeTruthy()
    const names = Object.keys(LEGACY_STYLE_CHOICES).map(code => plainName(DEFAULT_CATALOG, LEGACY_STYLE_CHOICES[code]))
    expect(new Set(names).size).toBe(names.length)
    for (const code of Object.keys(LEGACY_STYLE_CHOICES)) {
      const sc = LEGACY_STYLE_CHOICES[code]
      const m = materialOf(DEFAULT_CATALOG, sc.material)!
      for (const d of m.dims) expect(optionOf(m, d.key, sc.choices[d.key]), `${code} ${d.key}`).toBeTruthy()
    }
  })
  test('the names Jonathan asked for', () => {
    expect(styleLabel("WV-ND 6'x8' Privacy")).toBe('White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig')
    expect(styleLabel("CL - 4' Black")).toBe('Black Chain Link, 4 ft, Residential, No dig')
    expect(styleLabel('WV-Auto DS Privacy')).toBe('White Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), Dig set')
    expect(styleLabel("WV-ND 8'x6' Privacy")).toBe('White Vinyl Privacy, 8 ft tall, 6 ft panels, No dig')
    expect(styleLabel("CL - Com 6'+1' Black")).toBe('Black Chain Link, 6 ft + 1 ft barbed wire, Commercial, No dig')
    expect(styleLabel('Alum - DS - Ind Abigail')).toBe('Aluminum Industrial Abigail, 6 ft tall, Dig set')
    expect(styleLabel('Durafence')).toBe('Durafence')
    // Old imported text that is not a style stays as it is.
    expect(styleLabel('WVND')).toBe('WVND')
  })
  test('reading Settings keeps every number the math uses, and a renamed choice renames every fence', () => {
    const cfg = use(fresh())
    for (const s of cfg.fenceStyles) {
      const was = LIVE.find(x => x.name === s.name)!
      for (const k of ['name', 'category', 'sectionsPerMH', 'panelWidth', 'mhPerWalkGate', 'mhPerDblGate', 'isActive', 'quotable', 'autoRailMix', 'installMethod', 'colorFamily'] as const) expect(s[k], `${s.name} ${k}`).toEqual(was[k])
      if (/ 8'x[68]' /.test(s.name)) {
        // 8 ft tall is priced by the piece (Jonathan, Oct 21, 2026): held until its section and post prices are in.
        expect(s.held, s.name).toBe('8 ft tall is priced by the piece: enter its section and post prices in Settings → Price List')
        expect(s.jobLot).toMatchObject({ tall: true, coversAll: ['section', 'post'], sections: {} })
        continue
      }
      expect(s.held, s.name).toBeUndefined()
      expect(s.jobLot).toBeUndefined()
    }
    const st = fresh()
    const renamed = planUpdateOption(st, 'vinyl', 'color', 'white', { label: 'Bright White' })
    const cfg2 = use(renamed)
    expect(cfg2.fenceStyles.find(s => s.name === "WV-ND 6'x8' Privacy")!.label).toBe('Bright White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig')
  })
  test('color parts: by a whole piece of the name, swapped for the new color', () => {
    expect(isColorPart('*Vinyl, White, Picket, 62-1/4"', ['White', 'W'])).toBe(true)
    expect(isColorPart("V , W, Picket Section 8' x 6' Privacy", ['White', 'W'])).toBe(true)
    expect(isColorPart("Vinyl, Rail Insert, 8'", ['White', 'W'])).toBe(false)
    expect(isColorPart('ND, Donut', ['White', 'W'])).toBe(false)
    expect(swapColor('*Vinyl, White, Picket, 62-1/4"', ['White', 'W'], 'Clay')).toBe('*Vinyl, Clay, Picket, 62-1/4"')
    expect(swapColor("V , W, Picket Section 8' x 6' Privacy", ['White', 'W'], 'Clay')).toBe("V , Clay, Picket Section 8' x 6' Privacy")
    expect(swapColor('Res, Fabric, 48", Blk, KK (9)', ['Black', 'Blk'], 'Green')).toBe('Res, Fabric, 48", Green, KK (9)')
  })
})

describe('a job lot color (priced by piece)', () => {
  let st: CatalogState
  beforeEach(() => {
    const s0 = fresh()
    const covers = defaultCovers(piecePartChoices(s0, ADD))
    st = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT(covers) }).state
  })

  test('its fences: one per White privacy fence, generated internal names, plain names, nothing priced in Inventory', () => {
    const made = st.fenceStyles.filter(s => s.madeFrom)
    const whites = LIVE.filter(s => LEGACY_STYLE_CHOICES[s.name]?.choices.color === 'white' && LEGACY_STYLE_CHOICES[s.name]?.choices.style === 'privacy')
    expect(made.length).toBe(whites.length)
    expect(made.map(s => s.name)).toContain('vinyl/privacy/6/testclay/nd/8')
    const cfg = use(st)
    expect(cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/8')!.label).toBe('Testclay Vinyl Privacy, 6 ft tall, 8 ft panels, No dig')
    const newItems = st.items.filter(i => i.madeFor === 'vinyl:color:testclay')
    expect(newItems.length).toBeGreaterThan(5)
    expect(newItems.every(i => i.unitCost === 0 && /Testclay/.test(i.name))).toBe(true)
  })

  test('known section, post and gate prices give the expected material cost, no part counted twice', () => {
    const cfg = use(st)
    const clay = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/8')!
    const white = cfg.fenceStyles.find(s => s.name === "WV-ND 6'x8' Privacy")!
    const c = calculateQuote(job(clay, cfg))
    const w = calculateQuote(job(white, cfg))
    // The parts list is White's with the color swapped: same parts, same quantities.
    const parts = (items: typeof c.materials.items, swap: boolean) => {
      const m = new Map<string, number>()
      for (const i of items) if (!i.jobLotPiece) { const n = swap ? swapColor(i.item, ['White', 'W'], 'Testclay') : i.item; m.set(n, Math.round(((m.get(n) ?? 0) + i.qty) * 100) / 100) }
      return [...m].sort()
    }
    expect(parts(c.materials.items, false)).toEqual(parts(w.materials.items, true))
    // Every Testclay part is covered by a piece price: $0 on the pull sheet.
    const colorLines = c.materials.items.filter(i => /Testclay/.test(i.item) && !i.jobLotPiece)
    expect(colorLines.length).toBeGreaterThan(0)
    expect(colorLines.every(i => i.total === 0 && i.costSource === 'jobLot')).toBe(true)
    // The shared parts (pipe, donuts, concrete, screws, insert, gate hardware) price from Inventory exactly as on White.
    const shared = (items: typeof c.materials.items) => items.filter(i => !i.jobLotPiece && !/White|Testclay|V , W/.test(i.item)).map(i => [i.item, i.qty, i.unitCost, i.total])
    expect(shared(c.materials.items)).toEqual(shared(w.materials.items))
    // The pieces: 26 sections of 8 ft (37, 120, 52 ft runs), 2 corner + 2 end + 23 line posts + 1 gate post, 1 walk gate, 1 double gate.
    const pieces = Object.fromEntries(c.materials.items.filter(i => i.jobLotPiece).map(i => [i.item, [i.qty, i.unitCost]]))
    expect(pieces).toEqual({
      'Job lot, Testclay: section, 8 ft wide': [c.sections, 115],
      'Job lot, Testclay: corner post': [2, 31.5], 'Job lot, Testclay: end post': [2, 31.5],
      'Job lot, Testclay: line post': [c.sections - 3, 31.5], 'Job lot, Testclay: gate post (center of a double gate)': [1, 31.5],
      'Job lot, Testclay: walk gate': [1, 320], 'Job lot, Testclay: double gate': [1, 610],
    })
    const sharedCost = shared(c.materials.items).reduce((t, x) => t + (x[3] as number), 0)
    const expected = Math.round((sharedCost + c.sections * 115 + (2 + 2 + (c.sections - 3) + 1) * 31.5 + 320 + 610) * 100) / 100
    expect(c.materialCost).toBeCloseTo(expected, 2)
  })

  test('a shared part ticked under the section price (rail insert) is no longer charged from Inventory', () => {
    const s0 = fresh()
    const covers = defaultCovers(piecePartChoices(s0, ADD))
    const insert = piecePartChoices(s0, ADD).section.find(p => /Rail Insert/.test(p.part))!.part
    const st2 = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT({ ...covers, section: [...covers.section, insert] }) }).state
    const cfg = use(st2)
    const c = calculateQuote(job(cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/8')!, cfg))
    const ins = c.materials.items.filter(i => normalizeItemName(i.item) === normalizeItemName(insert))
    expect(ins.reduce((t, i) => t + i.qty, 0)).toBe(c.sections)   // still on the pull sheet
    expect(ins.reduce((t, i) => t + i.total, 0)).toBe(0)           // its cost is in the section price
  })

  test('auto mix: 6 ft rail runs take the 6 ft section price, 8 ft runs the 8 ft one', () => {
    const cfg = use(st)
    const auto = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/auto')!
    const c = calculateQuote(job(auto, cfg, { runs: [{ ft: 36, rail: '6ft' }, { ft: 64, rail: '8ft' }] }))
    const pieces = Object.fromEntries(c.materials.items.filter(i => i.jobLotPiece).map(i => [i.item, i.qty]))
    expect(pieces['Job lot, Testclay: section, 6 ft wide']).toBe(6)
    expect(pieces['Job lot, Testclay: section, 8 ft wide']).toBe(8)
  })

  test('coverage warnings: a part under two prices, and a color part under none', () => {
    const s0 = fresh()
    const choices = piecePartChoices(s0, ADD)
    const covers = defaultCovers(choices)
    const cap = covers.post.find(p => /Cap, 5/.test(p))!
    const kits = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT(covers) }).state.kits.filter(k => k.madeFor === 'vinyl:color:testclay')
    expect(coverageWarnings(covers, kits, ['Testclay'])).toEqual([])
    const twice = coverageWarnings({ ...covers, section: [...covers.section, cap] }, kits, ['Testclay'])
    expect(twice.some(w => /included in 2 piece prices/.test(w))).toBe(true)
    const none = coverageWarnings({ ...covers, post: covers.post.filter(p => p !== cap) }, kits, ['Testclay'])
    expect(none.some(w => /Not in any piece price/.test(w) && /Cap/.test(w))).toBe(true)
  })

  test('not available for quoting until every piece price is in; then it is', () => {
    const s0 = fresh()
    const covers = defaultCovers(piecePartChoices(s0, ADD))
    const blank = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT(covers, { walkGateCents: null }) }).state
    let cfg = use(blank)
    const m = materialOf(blank.fenceCatalog, 'vinyl')!
    expect(colorStatus(cfg.fenceStyles, m, optionOf(m, 'color', 'testclay')!).missingPieces).toEqual(['6 ft tall: Walk gate'])
    expect(cfg.fenceStyles.filter(s => s.madeFrom).every(s => !isQuotable(s) && /not fully priced/.test(s.held!))).toBe(true)
    expect(estimateStyles({ fenceStyles: blank.fenceStyles, fenceCatalog: blank.fenceCatalog } as any, { inventory: blank.items, kits: blank.kits }).some(s => s.madeFrom)).toBe(false)
    const priced = planUpdateOption(blank, 'vinyl', 'color', 'testclay', { jobLot: LOT(covers) })
    cfg = use(priced)
    // 6 ft tall: on. 8 ft tall waits only for its own section and post prices (Oct 21, 2026), not the color's job lot.
    expect(cfg.fenceStyles.filter(s => s.madeFrom && s.choices?.height === '6').every(isQuotable)).toBe(true)
    expect(cfg.fenceStyles.filter(s => s.madeFrom && s.choices?.height === '8').map(s => s.held)).toEqual(Array(4).fill('8 ft tall is priced by the piece: enter its section and post prices in Settings → Price List'))
    // White's fences were never touched.
    expect(cfg.fenceStyles.filter(s => !s.madeFrom).map(s => [s.name, isQuotable(s)])).toEqual(use(fresh()).fenceStyles.map(s => [s.name, isQuotable(s)]))
  })

  test('removing the test color leaves nothing behind', () => {
    const before = fresh()
    const r = planRemoveOption(st, 'vinyl', 'color', 'testclay', new Set())
    expect(r.state).toEqual(before)
    expect(() => planRemoveOption(st, 'vinyl', 'color', 'testclay', new Set(['vinyl/privacy/6/testclay/nd/8']))).toThrow(/Archive it instead/)
    expect(() => planRemoveOption(before, 'vinyl', 'color', 'white', new Set())).toThrow(/came with the app/)
  })
})

describe('a color priced by part', () => {
  test('not available until each of its parts has a price in Inventory; overrides and Target Profit % apply', () => {
    const s0 = fresh()
    const rows = previewColorParts(s0, ADD)
    const picket8 = rows.find(r => r.height === '6' && r.width === '8' && r.kit === 'section' && /Picket/.test(r.part))!
    expect(picket8.qty).toBe(15)
    const st = planAddColor(s0, { ...ADD, pricing: 'part', overrides: [{ ...picket8, qty: 16 }], targetProfitPct: 20 }).state
    let cfg = use(st)
    const m = materialOf(st.fenceCatalog, 'vinyl')!
    const status = colorStatus(cfg.fenceStyles, m, optionOf(m, 'color', 'testclay')!)
    expect(status.ready).toBe(false)
    // Every part made, except the 8 ft tall section and post parts: those fences' own piece prices cover them (Oct 21, 2026).
    const tallOnly = new Set(['Mid Rail', "Picket, 4'", "U Channel, 4'", "8' Privacy"].flatMap(w => st.items.filter(i => i.madeFor && i.name.includes(w)).map(i => i.name)))
    expect(tallOnly.size).toBeGreaterThan(0)
    expect(status.unpricedParts.sort()).toEqual(st.items.filter(i => i.madeFor && !tallOnly.has(i.name)).map(i => i.name).sort())
    // Price every part: it switches on.
    const priced = { ...st, items: st.items.map(i => (i.madeFor ? { ...i, unitCost: prices[swapColor(i.name, ['Testclay'], 'White')] ?? 5 } : i)) }
    cfg = use(priced)
    const clay8 = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/8')!
    expect(isQuotable(clay8)).toBe(true)
    const kit = st.kits.find(k => k.styleName === clay8.name)!
    expect(kit.kits.section!.find(p => /Picket/.test(p.part))!.qty).toBe(16)
    // Its own Target Profit %: 30 overhead + 20 = 50% Target Margin; White stays at 44%.
    expect(clay8.margin).toBeCloseTo(0.5, 10)
    expect(cfg.fenceStyles.find(s => s.name === "WV-ND 6'x8' Privacy")!.margin).toBeCloseTo(0.56, 10)
  })
})

describe('the rest of the app follows the color', () => {
  test('Good Better Best: a tier "same color" stays on the quote\'s color; a White tier swaps to White', () => {
    const s0 = fresh()
    const covers = defaultCovers(piecePartChoices(s0, ADD))
    const st = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT(covers) }).state
    const cfg = use(st)
    const clay = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/8')!
    const set = { category: 'Vinyl', popular: null, tiers: [
      { key: 'g', name: 'Good', install: 'dig-set' as const, width: 'same' as const, color: 'same', text: '' },
      { key: 'b', name: 'Better', install: 'same' as const, width: 'same' as const, color: 'white', text: '' },
    ] }
    const t = resolveTiers(job(clay, cfg), cfg.fenceStyles, set)
    expect(t.map(x => x.style?.name)).toEqual(['vinyl/privacy/6/testclay/ds/8', "WV-ND 6'x8' Privacy"])
  })
  test('Compare options and the 6 ft vs 8 ft line include a color added in Settings, against White Vinyl on the same yard; removing it leaves nothing', () => {
    const s0 = fresh()
    const covers = defaultCovers(piecePartChoices(s0, ADD))
    const st = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT(covers) }).state
    const cfg = use(st)
    const white8 = cfg.fenceStyles.find(s => s.name === "WV-ND 6'x8' Privacy")!
    const clay8 = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/8')!
    const clay6 = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/6/testclay/nd/6')!
    expect(isQuotable(clay8)).toBe(true)
    // Quoting White: Testclay is offered next to it, priced on the same yard the way the quote prices it.
    const fromWhite = compareStyles(white8, cfg.fenceStyles)
    expect(fromWhite.map(s => s.name)).toContain(clay8.name)
    const priced = Object.fromEntries(fromWhite.map(s => [s.name, priceOption(job(white8, cfg), s).finalPrice]))
    expect(priced[clay8.name]).toBe(calculateQuote({ ...job(clay8, cfg), overrides: {} }).priced.price)
    expect(priced[white8.name]).toBe(calculateQuote(job(white8, cfg)).priced.price)
    expect(priced[clay8.name]).not.toBe(priced[white8.name])
    // Quoting Testclay: White is offered, and the 6 vs 8 ft line uses Testclay's own 6 and 8 ft fences.
    expect(compareStyles(clay8, cfg.fenceStyles).map(s => s.name)).toContain(white8.name)
    const w = widthComparison(job(clay8, cfg), cfg.fenceStyles)!
    expect(w).toEqual({ at6: calculateQuote(job(clay6, cfg)).priced.price, at8: calculateQuote(job(clay8, cfg)).priced.price })
    // White's own 6 vs 8 ft line is unchanged by the new color.
    expect(widthComparison(job(white8, cfg), cfg.fenceStyles)).toEqual(widthComparison(job(white8, use(s0)), use(s0).fenceStyles))
    // Remove it: Compare options are back to what they were.
    const gone = planRemoveOption(st, 'vinyl', 'color', 'testclay', new Set()).state
    expect(gone).toEqual(s0)
    const back = use(gone)
    expect(compareStyles(back.fenceStyles.find(s => s.name === white8.name)!, back.fenceStyles).map(s => s.name).some(n => /testclay/.test(n))).toBe(false)
  })
  test('the website widget offers the color once it can be quoted', () => {
    const s0 = fresh()
    const covers = defaultCovers(piecePartChoices(s0, ADD))
    const st = planAddColor(s0, { ...ADD, pricing: 'piece', jobLot: LOT(covers) }).state
    const list = estimateStyles({ fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog } as any, { inventory: st.items, kits: st.kits })
      .map(s => ({ name: s.name, category: s.category, label: s.label, ...(s.madeFrom ? { material: s.material, choices: s.choices, madeFrom: s.madeFrom, panelWidth: s.panelWidth, autoRailMix: !!s.autoRailMix } : {}) }))
    const vinyl = widgetCatalog(list).find(m => m.material === 'vinyl')!
    const nd8 = vinyl.styles.find(s => s.name === 'Privacy, 8 ft sections, no dig')!
    expect(nd8.colors).toEqual(['White', 'Tan', 'Testclay'])
    expect(nd8.crm['6ft'].Testclay).toBe('vinyl/privacy/6/testclay/nd/8')
  })
  test('a new height copies the fences and parts it is made from, starting turned off', () => {
    const s0 = fresh()
    const r = planAddChoice(s0, { material: 'vinyl', dim: 'height', label: '7 ft', copyFrom: '6' })
    const made = r.state.fenceStyles.filter(s => s.madeFrom)
    expect(made.length).toBe(LIVE.filter(s => LEGACY_STYLE_CHOICES[s.name]?.material === 'vinyl' && LEGACY_STYLE_CHOICES[s.name]!.choices.height === '6').length)
    const cfg = use(r.state)
    const s7 = cfg.fenceStyles.find(s => s.name === 'vinyl/privacy/7-ft/white/nd/8')!
    expect(s7.label).toBe('White Vinyl Privacy, 7 ft tall, 8 ft panels, No dig')
    expect(isQuotable(s7)).toBe(false)
    const on = use(planUpdateOption(r.state, 'vinyl', 'height', '7-ft', { quotable: true }))
    expect(isQuotable(on.fenceStyles.find(s => s.name === s7.name)!)).toBe(true)
    // Same parts as the 6 ft fence it copied: prices the same material.
    const six = on.fenceStyles.find(s => s.name === "WV-ND 6'x8' Privacy")!
    expect(calculateQuote(job(on.fenceStyles.find(s => s.name === s7.name)!, on)).materialCost).toBe(calculateQuote(job(six, on)).materialCost)
    expect(planRemoveOption(r.state, 'vinyl', 'height', '7-ft', new Set()).state).toEqual(s0)
  })
})
