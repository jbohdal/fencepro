/**
 * Tan 8 ft tall vinyl (Jonathan, Oct 29, 2026: "OK Tan 8 ft."): TV-ND and
 * TV-DS, 8'x6' and 8'x8', defined as the four White 8 ft styles are, priced
 * by the piece and held until their section and post costs are typed.
 */

import { describe, test, expect, afterEach } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap, TALL_VINYL_SECTION, type LineItem } from '../../web/src/materialCalculator'
import { setSavedKitSets, kitSetFor, clearBuiltInKits } from '../../web/src/materialKits'
import { DEFAULT_CATALOG, styleLabel, isTallVinyl, styleChoicesOf, type InvItem } from '../../web/src/fenceCatalog'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { isQuotable } from '../../web/src/styleAvailability'
import { planTanTall, planTanTallParts, TAN_TALL } from '../../web/src/tanTall'
import { applyTallPrices, tallKey } from '../../web/src/tallVinylPriceSave'
import type { FenceStyle } from '../../web/src/configStore'

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

const TAN = TAN_TALL.map(([t]) => t)
const WHITE = TAN_TALL.map(([, w]) => w)
// Live's Tan Inventory prices for the parts an 8 ft tall Tan fence uses (Oct 29, 2026).
const INV: Record<string, number> = {
  "V , T, Post, 8' Privacy, CP, 5\" x 5\"": 27.5, "V , T, Post, 8' Privacy, EP, 5\" x 5\"": 27.5, "V , T, Post, 8' Privacy, LP, 5\" x 5\"": 27.5,
  'Vinyl, Tan, Cap, 5"x5"': 2, 'Vinyl, Tan, Cap, Gate': 2.14, "*Vinyl, Tan, Rail, 6'": 9.6, "*Vinyl, Tan, Rail, 8'": 13.6, "Vinyl, Rail Insert, 8'": 8.15,
  'ND, Donut': 4.12, "Pipe, PT40, Galv, 2-1/2\" x 8'": 16.06, 'Misc, Concrete': 7.06,
  'V , T, Privacy Gate 8 x 4': 458, '*Vinyl, Gate, Hinge': 29.03, '*Vinyl, Gate, Latch': 20.46, '*Vinyl, Gate, Handle': 5.98,
}
// Live's saved White 8 ft and Tan styles (config.fenceStyles, Oct 29, 2026), as saved.
const LIVE: FenceStyle[] = [
  { id: 'auto-tv-ds', name: 'TV-Auto DS Privacy', margin: 0.6, choices: { color: 'tan', style: 'privacy', width: 'auto', height: '6', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, autoRailMix: true, colorFamily: 'tan', mhPerDblGate: 4.8, installMethod: 'dig-set', mhPerWalkGate: 2.4, sectionsPerMH: 1.1, targetProfitPct: 10 },
  { id: '3', name: "WV-ND 8'x6' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '6', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
  { id: '4', name: "WV-ND 8'x8' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
  { id: '8', name: "WV-DS 8'x6' Privacy", margin: 0.6, choices: { color: 'white', style: 'privacy', width: '6', height: '8', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.7, targetProfitPct: 10 },
  { id: '9', name: "WV-DS 8'x8' Privacy", margin: 0.6, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.7, targetProfitPct: 10 },
  { id: '10', name: "TV-ND 6'x6' Privacy", margin: 0.56, choices: { color: 'tan', style: 'privacy', width: '6', height: '6', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 1.2, targetProfitPct: 14 },
  { id: '13', name: "TV-DS 6'x8' Privacy", margin: 0.6, choices: { color: 'tan', style: 'privacy', width: '8', height: '6', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 1.1, targetProfitPct: 10 },
  { id: '14', name: "CL - 4' Galv", margin: 0.6, category: 'Chainlink', isActive: true, panelWidth: 10, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 1.5 },
] as FenceStyle[]

describe('the four Tan 8 ft styles, as the White ones', () => {
  test('defaults: next to the Tan styles, the White 8 ft man hours, margin, widths', () => {
    for (const [tan, white] of TAN_TALL) {
      const t = DEFAULT_FENCE_STYLES.find(s => s.name === tan)!, w = DEFAULT_FENCE_STYLES.find(s => s.name === white)!
      const { id: _a, name: _b, ...tr } = t, { id: _c, name: _d, ...wr } = w
      expect(tr).toEqual(wr)
      expect(t.pieceCents).toBeUndefined()
    }
    expect(new Set(DEFAULT_FENCE_STYLES.map(s => s.id)).size).toBe(DEFAULT_FENCE_STYLES.length)
  })
  test.each(TAN_TALL.map(x => [...x]))('%s: 8 ft tall Tan, plain name, its parts list derives cleanly', (tan, white) => {
    clearBuiltInKits()
    const sc = styleChoicesOf({ name: tan })!
    expect(isTallVinyl(sc)).toBe(true)
    expect(sc.choices).toEqual({ ...styleChoicesOf({ name: white })!.choices, color: 'tan' })
    expect(styleLabel(tan)).toBe(styleLabel(white).replace('White', 'Tan'))
    const set = kitSetFor(tan, [])
    if (!set || set === 'archived') throw new Error('no kit')
    expect(set.mismatch).toBeUndefined()
    const w = /8'x8'/.test(tan) ? 8 : 6
    const c = TALL_VINYL_SECTION[w]
    const want: Record<string, number> = { [`*Vinyl, Tan, Rail, ${w}'`]: c.rails, [`*Vinyl, Tan, Mid Rail, ${w}'`]: c.midRails, "*Vinyl, Tan, Picket, 4'": c.pickets, "*Vinyl, Tan, U Channel, 4'": c.uChannels }
    if (c.railInserts) want["Vinyl, Rail Insert, 8'"] = c.railInserts
    expect(Object.fromEntries(set.kits.section!.map(p => [p.part, p.qty]))).toEqual(want)
  })
})

describe('planTanTall: the one time step', () => {
  test("adds the four once, with each one's White 8 ft settings, after the Tan styles; no price copied; nothing else changes", () => {
    const saved = LIVE.map(s => (WHITE.includes(s.name) ? { ...s, pieceCents: { section: 41250, post: 6500, pricedOn: '2026-10-29' }, pricePerFoot: 55, subRate: 4 } : s))
    const plan = planTanTall(saved)
    expect(plan.added).toEqual(TAN)
    expect(plan.copiedFrom).toEqual(Object.fromEntries(TAN_TALL.map(([t, w]) => [t, w])))
    expect(plan.fenceStyles.map(s => s.name)).toEqual([...LIVE.slice(0, 7).map(s => s.name), ...TAN, "CL - 4' Galv"])
    // The White 8 ft style's shape, Tan's choices; never a price.
    for (const [tan, white] of TAN_TALL) {
      const t = plan.fenceStyles.find(s => s.name === tan)!
      const w = LIVE.find(s => s.name === white)!
      expect(Object.keys(t).sort()).toEqual(Object.keys(w).sort())
      const { id: _a, name: _b, choices: tc, ...tr } = t
      const { id: _c, name: _d, choices: wc, ...wr } = w
      expect(tr).toEqual(wr)
      expect(tc).toEqual({ ...wc, color: 'tan' })
      expect(t.pieceCents).toBeUndefined()
      expect(t.pricePerFoot).toBeUndefined()
      expect(t.subRate).toBeUndefined()
    }
    // Existing styles untouched; ids unique.
    expect(plan.fenceStyles.filter(s => !TAN.includes(s.name))).toEqual(saved)
    expect(new Set(plan.fenceStyles.map(s => s.id)).size).toBe(plan.fenceStyles.length)
    // Again: nothing added.
    expect(planTanTall(plan.fenceStyles).added).toEqual([])
    expect(planTanTall(plan.fenceStyles).fenceStyles).toEqual(plan.fenceStyles)
  })
  test('only the missing ones; a White one gone: the defaults; switched off follows White', () => {
    const one = planTanTall([...LIVE, { ...DEFAULT_FENCE_STYLES.find(s => s.name === TAN[0])! }])
    expect(one.added).toEqual(TAN.slice(1))
    const noWhite = planTanTall(LIVE.filter(s => s.name !== WHITE[3]))
    expect(noWhite.copiedFrom[TAN[3]]).toBe('defaults')
    expect(noWhite.fenceStyles.find(s => s.name === TAN[3])).toMatchObject({ sectionsPerMH: 0.7, panelWidth: 8, margin: 0.64 })
    const off = planTanTall(LIVE.map(s => (s.name === WHITE[0] ? { ...s, quotable: false, isActive: false } : s)))
    expect(off.fenceStyles.find(s => s.name === TAN[0])).toMatchObject({ quotable: false, isActive: false })
  })
  test('the Tan $0 section parts, as the White ones were made', () => {
    clearBuiltInKits()
    const items: InvItem[] = Object.entries(INV).map(([name, unitCost], i) => ({ id: `x${i}`, name, unitCost, category: 'Vinyl Tan', status: 'active' }))
    const plan = planTanTall(LIVE)
    const p = planTanTallParts({ fenceStyles: plan.fenceStyles, items, kits: [] }, plan.added)
    expect(p.added.sort()).toEqual(["*Vinyl, Tan, Mid Rail, 6'", "*Vinyl, Tan, Mid Rail, 8'", "*Vinyl, Tan, Picket, 4'", "*Vinyl, Tan, U Channel, 4'"])
    for (const n of p.added) expect(p.items.find(i => i.name === n)).toMatchObject({ unitCost: 0, includedIn: '8 ft tall section price', category: 'Vinyl Tan' })
    expect(p.items.slice(0, items.length)).toEqual(items)
    expect(p.items.length).toBe(items.length + 4)
    // The White styles' parts are not touched (only the styles just added), and a missing Tan rail is never made at $0.
    const noRails = items.filter(i => !/Tan, Rail/.test(i.name))
    const q = planTanTallParts({ fenceStyles: plan.fenceStyles, items: noRails, kits: [] }, plan.added)
    expect(q.added.some(n => /Rail, [68]'$/.test(n) && !/Mid Rail/.test(n))).toBe(false)
    expect(q.items.some(i => /Tan, Rail, [68]'$/.test(i.name))).toBe(false)
    expect(q.items.some(i => /White/.test(i.name))).toBe(false)
    // Again: nothing more.
    expect(planTanTallParts({ fenceStyles: plan.fenceStyles, items: p.items, kits: [] }, plan.added).added).toEqual([])
  })
})

const job = (cfg: ReturnType<typeof estimateConfig>, name: string, over: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style: cfg.fenceStyles.find(s => s.name === name)!, runs: [{ ft: 48, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer!, ...over,
})
const line = (items: LineItem[], name: string) => items.filter(i => i.item === name)

describe('held until priced; with prices typed, they quote', () => {
  const setup = (styles: FenceStyle[]) => {
    setMaterialPriceSource(priceSourceFromMap(INV))
    setSavedKitSets(() => [])
    return estimateConfig({ fenceStyles: styles, fenceCatalog: DEFAULT_CATALOG } as any)
  }
  test('nothing typed: each held, with the 8 ft tall reason', () => {
    const cfg = setup(planTanTall(LIVE).fenceStyles)
    for (const n of TAN) {
      const s = cfg.fenceStyles.find(x => x.name === n)!
      expect(isQuotable(s), n).toBe(false)
      expect(s.held).toBe('8 ft tall needs its section and post prices in Settings → Price List → 8 ft tall vinyl')
    }
  })
  test.each(TAN)('%s: typed in Settings → Price List → 8 ft tall vinyl, it quotes by the piece; gates from the Tan parts', name => {
    const before = setup(planTanTall(LIVE).fenceStyles)
    const tall = before.fenceStyles.filter(s => s.isActive !== false && isTallVinyl(styleChoicesOf(s)))
    const r = applyTallPrices(before.fenceStyles, tall, { [tallKey(name, 'section')]: '430', [tallKey(name, 'post')]: '70' }, '2026-10-30')
    expect(r.bad).toEqual([])
    const cfg = setup(r.fenceStyles)
    const s = cfg.fenceStyles.find(x => x.name === name)!
    expect(isQuotable(s)).toBe(true)
    // The other Tan ones still wait for their own.
    for (const n of TAN.filter(n => n !== name)) expect(isQuotable(cfg.fenceStyles.find(x => x.name === n)!)).toBe(false)
    const w = /8'x8'/.test(name) ? 8 : 6
    const n = 48 / w
    const q = calculateQuote(job(cfg, name, { walkGates: 1 }))
    expect(q.sections).toBe(n)
    expect(line(q.materials.items, `8 ft tall Tan: section, ${w} ft wide`)).toEqual([expect.objectContaining({ qty: n, unitCost: 430, jobLotPiece: true })])
    expect(line(q.materials.items, '8 ft tall Tan: end post')).toEqual([expect.objectContaining({ qty: 2, unitCost: 70, jobLotPiece: true })])
    expect(line(q.materials.items, "*Vinyl, Tan, Picket, 4'")).toEqual([expect.objectContaining({ qty: TALL_VINYL_SECTION[w].pickets * n, unitCost: 0, costSource: 'jobLot' })])
    expect(line(q.materials.items, 'V , T, Privacy Gate 8 x 4')).toEqual([expect.objectContaining({ qty: 1, unitCost: 458 })])
    expect(q.materials.items.some(i => /White|V , W/.test(i.item))).toBe(false)
    expect(q.priced.price).toBeGreaterThan(0)
  })
})
