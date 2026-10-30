/**
 * Real wood kits (Jonathan, Oct 30 2026; web/src/wood.ts): three wood styles,
 * Stockade, Board on Board and Shadow Box, 6 ft tall, dig set, 8 ft sections,
 * each with its own kit. A new wood fence's material is its own kit priced
 * from Inventory, its labor the White Vinyl dig set 6'x8' privacy install
 * labor × the Wood factor; wood is held until every part of its kit has a
 * price and then quotes by itself. The gate post kit (materialKits.ts
 * withGatePosts) takes the posts each side of a gate out of the end posts,
 * only where a set has one.
 *
 * The sample job: two runs, 100 ft and 60 ft, one corner and three end posts,
 * two of them each side of a 4 ft walk gate. Sections per run, never total
 * footage ÷ 8: 13 + 8 = 21 (not 20); line posts 12 + 7 = 19.
 */

import { describe, test, expect, afterEach } from 'vitest'
import { setMaterialPriceSource } from '../../web/src/materialCalculator'
import {
  setSavedKitSets, builtInKitSet, linesFromKitSet, linesFromKitSetJobLot, withGatePosts, countsFor, KIT_KINDS, KIT_LABEL, PIECE_OF_KIT, type KitSet,
} from '../../web/src/materialKits'
import { estimate, estimateConfig, estimateStyles, heldStyleReason, type EstimateData } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import {
  planWood, planWoodRealKits, woodRealKitSet, leafPickets, woodStyleName, woodKitId, WOOD_KITS, WOOD_PARTS, WOOD_STYLES, WOOD_REAL_STYLES,
  WOOD_MATERIAL, WOOD_OLD_OF, WOOD_LABOR_FROM, WOOD_FRAME_PRICE, type WoodState,
} from '../../web/src/wood'
import { isHeldSavedQuote, heldQuoteSave, heldSavedNumbers } from '../../web/src/heldQuote'
import { DEFAULT_CATALOG } from '../../web/src/fenceCatalog'
import type { FenceStyle } from '../../web/src/configStore'
import type { PricingSettings } from '../../web/src/pricingEngine'

const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}

/** Test prices (dollars), as Jonathan would type them in Inventory; concrete and the drop rod are live's, the frame his $350. */
const TEST_PRICES: Record<string, number> = {
  "Wood, PT Post, Line, 4x4x8'": 12.98, "Wood, PT Post, Corner, 4x4x8'": 12.98, "Wood, PT Post, End, 4x4x8'": 12.98,
  "Wood, PT Post, Gate, 6x6x8'": 29.98, "Wood, PT Rail, 2x4x8'": 5.48,
  "Wood, Picket, Stockade, 1x6x6'": 2.58, "Wood, Picket, Board on Board, 1x6x6'": 2.18, "Wood, Picket, Shadow Box, 1x6x6'": 2.18,
  'Wood, Nail, Picket, 2" Ring Shank': 0.03, 'Wood, Screw, Rail, 3" Exterior': 0.12, 'Wood, Screw, Picket to Steel Frame, Self-Tapping': 0.09,
  'Wood, Gate Latch': 12.47, 'Wood, Steel Gate Frame (hinges included)': 350,
  'Misc, Concrete': 7.06, 'Drop Rod, 48", Black': 48.01,
}

/** The Oct 19 privacy rows, as live has them (kept, held). */
const OLD_ROWS: FenceStyle[] = Object.entries(WOOD_OLD_OF).map(([name, v]) => {
  const [, , height, install, width] = name.split('/')
  return { id: `fs_${name.replace(/\//g, '_')}`, name, category: 'Wood', margin: 0.6, sectionsPerMH: 0.8, panelWidth: Number(width), mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, material: 'wood', choices: { style: 'privacy', height, install, width }, woodOf: v } as FenceStyle
})
const plan = planWood({ fenceStyles: [...DEFAULT_FENCE_STYLES, ...OLD_ROWS], items: [], kits: [] }, '2026-10-30T12:00:00.000Z')
const config = { fenceStyles: plan.state.fenceStyles, pricing: { ...PRICING, overheadPct: 30 } } as any

/** Inventory: the wood parts at these prices (a part not named: $0). */
function data(prices: Record<string, number>): EstimateData {
  const inventory = plan.state.items.map(i => ({ name: i.name, unitCost: prices[i.name] ?? 0, status: 'active' }))
  return { config, inventory, kits: plan.state.kits }
}
const priced = data(TEST_PRICES)
const job = (fenceStyle: string) => ({ fenceStyle, runs: [100, 60], corners: 1, ends: 3, walkGates: 1, dblGates: 0 })
const ST = woodStyleName('stockade'), BOB = woodStyleName('bob'), SB = woodStyleName('sb')

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('the real wood kits', () => {
  test('three styles, 6 ft tall, dig set, 8 ft panels, each with its own kit; labor from WV-DS 6x8', () => {
    expect(WOOD_REAL_STYLES).toEqual(['wood/stockade/6/ds/8', 'wood/bob/6/ds/8', 'wood/sb/6/ds/8'])
    expect(plan.styles).toEqual(WOOD_REAL_STYLES)
    expect(plan.kits).toEqual(WOOD_REAL_STYLES)
    const cfg = estimateConfig(config)
    for (const n of WOOD_REAL_STYLES) {
      const s = cfg.fenceStyles.find(x => x.name === n)!
      expect(s.woodOf).toBe(WOOD_LABOR_FROM)
      expect(s.panelWidth).toBe(8)
      expect(s.label).toMatch(/^Wood (Stockade|Board on Board|Shadow Box), 6 ft tall, 8 ft panels, Dig set$/)
    }
  })

  test('quantities as set Oct 30 2026', () => {
    const q = (key: 'stockade' | 'bob' | 'sb', kind: keyof typeof WOOD_KITS.stockade) => Object.fromEntries((woodRealKitSet(key).kits[kind] ?? []).map(p => [p.part, p.qty]))
    expect(q('stockade', 'section')).toEqual({ "Wood, PT Rail, 2x4x8'": 3, "Wood, Picket, Stockade, 1x6x6'": 17, 'Wood, Nail, Picket, 2" Ring Shank': 102, 'Wood, Screw, Rail, 3" Exterior': 12 })
    expect(q('bob', 'section')).toEqual({ "Wood, PT Rail, 2x4x8'": 3, "Wood, Picket, Board on Board, 1x6x6'": 22, 'Wood, Nail, Picket, 2" Ring Shank': 132, 'Wood, Screw, Rail, 3" Exterior': 12 })
    expect(q('sb', 'section')["Wood, Picket, Shadow Box, 1x6x6'"]).toBe(22)
    expect(q('sb', 'line')).toEqual({ "Wood, PT Post, Line, 4x4x8'": 1, 'Misc, Concrete': 1 })
    expect(q('sb', 'gatePost')).toEqual({ "Wood, PT Post, Gate, 6x6x8'": 1, 'Misc, Concrete': 2 })
    // Gate leaves: pickets per foot × width, rounded up per leaf.
    expect([4, 5, 6].map(w => leafPickets(17, w))).toEqual([9, 11, 13])
    expect([4, 5, 6].map(w => leafPickets(22, w))).toEqual([11, 14, 17])
    expect(q('stockade', 'walkGate')).toEqual({ 'Wood, Steel Gate Frame (hinges included)': 1, "Wood, Picket, Stockade, 1x6x6'": 9, 'Wood, Screw, Picket to Steel Frame, Self-Tapping': 36, 'Wood, Gate Latch': 1 })
    expect(q('bob', 'walkGate6')).toEqual({ 'Wood, Steel Gate Frame (hinges included)': 1, "Wood, Picket, Board on Board, 1x6x6'": 17, 'Wood, Screw, Picket to Steel Frame, Self-Tapping': 68, 'Wood, Gate Latch': 1 })
    expect(q('sb', 'dblGate12')).toEqual({ 'Wood, Steel Gate Frame (hinges included)': 2, "Wood, Picket, Shadow Box, 1x6x6'": 34, 'Wood, Screw, Picket to Steel Frame, Self-Tapping': 136, 'Wood, Gate Latch': 1 })
    expect(q('stockade', 'dblGate10')["Wood, Picket, Stockade, 1x6x6'"]).toBe(22)
    expect(q('stockade', 'anyDblGate')).toEqual({ 'Drop Rod, 48", Black': 1 })
    for (const s of WOOD_STYLES) {
      const set = woodRealKitSet(s.key)
      expect(set.id).toBe(woodKitId(s.key))
      expect(set.madeFor).toBe('wood-real')
      expect(set.roundUp).toEqual([])
      expect(set.kits.blank).toBeUndefined()
      const all = KIT_KINDS.flatMap(k => set.kits[k] ?? []).map(p => p.part)
      expect(all.some(p => /cap|hinge|brace|dog ear/i.test(p) && !/hinges included/.test(p))).toBe(false)
      // No rails or nails in a gate.
      for (const k of ['walkGate', 'walkGate5', 'walkGate6', 'dblGate', 'dblGate10', 'dblGate12'] as const) expect((set.kits[k] ?? []).some(p => /Rail|Nail/.test(p.part))).toBe(false)
    }
    expect(WOOD_PARTS.map(p => p.part)).toHaveLength(13)
    expect(WOOD_PARTS.filter(p => p.unitCost > 0)).toEqual([{ part: 'Wood, Steel Gate Frame (hinges included)', unitCost: WOOD_FRAME_PRICE, styles: ['stockade', 'bob', 'sb'] }])
  })

  test('the sample job, per run: 21 sections, 19 line posts, 1 corner, 1 end and 2 gate posts, the walk gate', () => {
    for (const [name, pk, n, leaf] of [[ST, "Wood, Picket, Stockade, 1x6x6'", 17, 9], [BOB, "Wood, Picket, Board on Board, 1x6x6'", 22, 11], [SB, "Wood, Picket, Shadow Box, 1x6x6'", 22, 11]] as const) {
      const est = estimate(priced, job(name))
      expect(est.perRunSections).toEqual([13, 8])
      expect(est.sections).toBe(21)
      expect(Object.fromEntries(est.pullSheet.map(i => [i.item, i.qty]))).toEqual({
        "Wood, PT Post, Line, 4x4x8'": 19,
        "Wood, PT Post, Corner, 4x4x8'": 1,
        "Wood, PT Post, End, 4x4x8'": 1,
        "Wood, PT Post, Gate, 6x6x8'": 2,
        'Misc, Concrete': 19 + 1 + 1 + 2 * 2,
        "Wood, PT Rail, 2x4x8'": 21 * 3,
        [pk]: 21 * n + leaf,
        'Wood, Nail, Picket, 2" Ring Shank': 21 * n * 6,
        'Wood, Screw, Rail, 3" Exterior': 21 * 12,
        'Wood, Steel Gate Frame (hinges included)': 1,
        'Wood, Screw, Picket to Steel Frame, Self-Tapping': 4 * leaf,
        'Wood, Gate Latch': 1,
      })
    }
  })

  test('priced from Inventory like any style: each part at its own price, no "Wood material × 115%" line', () => {
    for (const name of WOOD_REAL_STYLES) {
      const est = estimate(priced, job(name))
      expect(est.pullSheet.every(i => i.unitCost === TEST_PRICES[i.item] && i.costSource === 'inventory' && !i.moneyOnly)).toBe(true)
      expect(est.pullSheet.some(i => /Wood material/.test(i.item))).toBe(false)
      const cents = est.pullSheet.reduce((t, i) => t + Math.round(i.qty * i.unitCost * 100), 0)
      expect(Math.round(est.materialCost * 100)).toBe(cents)
    }
    expect(estimate(priced, job(ST)).materialCost).toBe(2258.77)
  })

  test('labor: WV-DS 6x8 install labor × 115%; the material is not vinyl × 115%', () => {
    const vinyl = estimate(priced, job(WOOD_LABOR_FROM))
    expect(vinyl.sections).toBe(21)
    expect(vinyl.laborCost).toBe(21 * 24 + 10)
    for (const name of WOOD_REAL_STYLES) {
      const wood = estimate(priced, job(name))
      expect(wood.laborCost).toBe(591.1)
      expect(wood.materialCost).not.toBe(Math.round(vinyl.materialCost * 1.15 * 100) / 100)
    }
  })

  test('a double gate: two gate posts, two frames, one drop rod a job, no blank post; gate posts never more than the end posts', () => {
    const est = estimate(priced, { ...job(BOB), walkGates: 0, dblGates: 2, ends: 3 })
    const parts = Object.fromEntries(est.pullSheet.map(i => [i.item, i.qty]))
    expect(parts["Wood, PT Post, Gate, 6x6x8'"]).toBe(3)
    expect(parts["Wood, PT Post, End, 4x4x8'"]).toBeUndefined()
    expect(parts['Drop Rod, 48", Black']).toBe(1)
    expect(parts['Wood, Steel Gate Frame (hinges included)']).toBe(4)
    expect(parts['Wood, Gate Latch']).toBe(2)
    expect(Object.keys(parts).some(p => /Blank/.test(p))).toBe(false)
  })
})

describe('the gate post kit', () => {
  const set = woodRealKitSet('stockade')
  const base = countsFor("WV-DS 6'x6' Privacy", [40, 30], { corners: 1, ends: 6, walkGates: 2, dblGates: 1 })
  test('a set with a gate post kit: 2 a gate (walk or double, any width) out of the end posts, at most the end posts', () => {
    expect(withGatePosts(set, base)).toMatchObject({ end: 0, gatePost: 6 })
    expect(withGatePosts(set, { ...base, end: 9 })).toMatchObject({ end: 3, gatePost: 6 })
    expect(withGatePosts(set, { ...base, end: 2 })).toMatchObject({ end: 0, gatePost: 2 })
    expect(withGatePosts(set, { ...base, walkGate: 0, walkGate6: 1, dblGate: 0, dblGate12: 1, end: 9 })).toMatchObject({ end: 5, gatePost: 4 })
    expect(withGatePosts(set, { ...base, walkGate: 0, dblGate: 0 })).toMatchObject({ end: 6, gatePost: 0 })
  })
  test('a set without one (every vinyl, chain link and aluminum set) counts exactly as before', () => {
    for (const name of ["WV-ND 6'x6' Privacy", "WV-DS 6'x8' Privacy", "TV-ND 6'x6' Privacy", "CL - 4' Galv", 'Alum - DS - Emily - 48']) {
      const b = builtInKitSet(name)!
      expect(b.mismatch).toBeUndefined()
      expect(b.kits.gatePost).toBeUndefined()
      const c = countsFor(name, [40, 30], { corners: 1, ends: 6, walkGates: 2, dblGates: 1 })
      expect(withGatePosts(b, c)).toBe(c)
      // An empty gate post kit is no kit.
      expect(linesFromKitSet({ ...b, kits: { ...b.kits, gatePost: [] } }, c)).toEqual(linesFromKitSet(b, c))
    }
  })
  test('in the Material Kits editor and the piece prices', () => {
    expect(KIT_LABEL.gatePost).toBe('Gate post (each side of a gate, used in place of an end post)')
    expect(PIECE_OF_KIT.gatePost).toBe('post')
    // A job lot color with a gate post kit: the gate posts take the end post price.
    const lot = { color: 'X', supplier: 'S', quotedOn: '2026-10-30', width: 8, sections: { '8': 100 }, end: 30, covers: { section: [], post: ["Wood, PT Post, Gate, 6x6x8'", "Wood, PT Post, End, 4x4x8'"], walkGate: [], dblGate: [] } }
    const lines = linesFromKitSetJobLot(set, base, lot as any)
    expect(lines.find(l => /end post/.test(l.part))?.qty).toBe(6)
  })
})

describe('held until every wood part is priced, then quotes by itself', () => {
  test('new parts at $0 (the frame at $350): held, with how many are waiting', () => {
    const d = data({ 'Misc, Concrete': 7.06, 'Drop Rod, 48", Black': 48.01, 'Wood, Steel Gate Frame (hinges included)': 350 })
    // 5 posts and rails, the style's own picket, nails, 2 screws, the latch.
    for (const n of WOOD_REAL_STYLES) expect(heldStyleReason(d, n)).toBe('Wood is waiting for prices on 10 parts in Inventory')
    expect(estimateStyles(config, d).some(s => s.material === 'wood')).toBe(false)
    expect(() => estimate(d, job(ST))).toThrow()
  })
  test('each style goes by its own parts: Stockade priced, Board on Board missing its picket', () => {
    const d = data({ ...TEST_PRICES, "Wood, Picket, Board on Board, 1x6x6'": 0 })
    expect(heldStyleReason(d, ST)).toBeNull()
    expect(heldStyleReason(d, BOB)).toBe('Wood is waiting for prices on 1 part in Inventory')
    expect(heldStyleReason(d, SB)).toBeNull()
  })
  test('every part priced: available for quoting, no other step', () => {
    for (const n of WOOD_REAL_STYLES) expect(heldStyleReason(priced, n)).toBeNull()
    expect(estimateStyles(config, priced).filter(s => s.material === 'wood').map(s => s.name)).toEqual(WOOD_REAL_STYLES)
  })
  test('no kit in use: held', () => {
    const noKit: EstimateData = { ...priced, kits: plan.state.kits.map(k => (k.styleName === ST ? { ...k, archived: true } : k)) }
    expect(heldStyleReason(noKit, ST)).toMatch(/it has no material kit/)
  })
  test('the four Oct 19 privacy styles stay as rows, held by their archived choices', () => {
    for (const n of Object.keys(WOOD_OLD_OF)) expect(heldStyleReason(priced, n)).toMatch(/Privacy is archived/)
    expect(heldStyleReason(priced, 'wood/privacy/6/nd/6')).toMatch(/No dig is archived/)
    expect(estimateConfig(config).fenceStyles.filter(s => s.material === 'wood')).toHaveLength(7)
  })
})

describe('a sent quote on an old wood style keeps its saved price (505174a0, Oct 23: wood/privacy/6/nd/6, $1,039)', () => {
  const saved = {
    id: '505174a0-32bd-4146-944e-960919c93a96', fenceStyle: 'wood/privacy/6/nd/6', status: 'SENT', finalPrice: 1039, materialCost: 412.5, laborCost: 230,
    runs: [60], sections: 10, notes: '', date: '2026-10-23',
    pullSheet: [{ item: 'Wood material: WV-ND 6\'x6\' Privacy material × 115%', qty: 1, unitCost: 412.5, total: 412.5, costSource: 'wood' }],
  }
  test('held, so the quote builder shows the saved numbers and a save keeps them (words only)', () => {
    const held = heldStyleReason(priced, saved.fenceStyle)
    expect(held).toBeTruthy()
    expect(isHeldSavedQuote(saved, { name: saved.fenceStyle, held: held ?? undefined })).toBe(true)
    expect(heldSavedNumbers(saved).price).toBe(1039)
    const out = heldQuoteSave(saved, { ...saved, notes: 'Called back', finalPrice: 2000 }, false)!
    expect(out.finalPrice).toBe(1039)
    expect(out.notes).toBe('Called back')
    expect(heldQuoteSave(saved, { ...saved, runs: [80] }, true)).toBeNull()
  })
})

describe('the Oct 30 change on saved Settings and Inventory (planWoodRealKits)', () => {
  // As live was: the four privacy rows, the Oct 19 renamed parts and kits, wood turned off by hand, the old tree.
  const oldWood = JSON.parse(JSON.stringify(WOOD_MATERIAL))
  oldWood.quotable = false
  oldWood.dims[0].options = [{ key: 'privacy', label: 'Privacy' }]
  for (const d of oldWood.dims) for (const o of d.options) delete o.archived
  const old: WoodState = {
    fenceStyles: [...DEFAULT_FENCE_STYLES, ...OLD_ROWS],
    fenceCatalog: { version: 1, materials: [...DEFAULT_CATALOG.materials.filter(m => m.key !== 'wood'), oldWood] },
    items: [
      { id: 'inv_wood_wood_picket_62_1_4_', name: 'Wood, Picket, 62-1/4"', unitCost: 0, category: 'Wood', status: 'active', madeFor: 'wood' },
      { id: 'inv_wood_wood_rivet_1_', name: 'Wood, Rivet, 1"', unitCost: 0, category: 'Wood', status: 'active', madeFor: 'wood' },
      { id: 'misc-conc', name: 'Misc, Concrete', unitCost: 7.06, category: 'Misc' },
      { id: 'clb-dr-48', name: 'Drop Rod, 48", Black', unitCost: 48.01, category: 'Chainlink Black' },
    ],
    kits: Object.keys(WOOD_OLD_OF).map(n => ({
      id: `kit_wood_${n.replace(/[^a-z0-9]+/gi, '_')}`, name: n, styleName: n, madeFor: 'wood', roundUp: [],
      kits: { section: [{ part: 'Wood, Picket, 62-1/4"', qty: 11, fallbackCost: 0 }] },
    })) as KitSet[],
  }
  const p = planWoodRealKits(old, '2026-10-30T12:00:00.000Z')
  test('renamed vinyl parts and their kits archived, never deleted; three styles, kits and 13 new parts added; concrete and the drop rod reused', () => {
    expect(p.archivedItems.sort()).toEqual(['Wood, Picket, 62-1/4"', 'Wood, Rivet, 1"'])
    expect(p.state.items.filter(i => i.madeFor === 'wood').every(i => i.status === 'archived')).toBe(true)
    expect(p.archivedKits).toHaveLength(4)
    expect(p.state.kits.filter(k => k.madeFor === 'wood').every(k => k.archived)).toBe(true)
    expect(p.addedStyles).toEqual(WOOD_REAL_STYLES)
    expect(p.addedKits).toEqual(WOOD_REAL_STYLES)
    expect(p.addedItems).toEqual(WOOD_PARTS.map(x => x.part))
    expect(p.state.items).toHaveLength(old.items.length + 13)
    expect(p.state.fenceStyles).toHaveLength(old.fenceStyles.length + 3)
    for (const i of p.state.items.filter(i => i.madeFor === 'wood-real')) {
      expect(i.unitCost).toBe(/Steel Gate Frame/.test(i.name) ? 350 : 0)
      expect([i.category, i.status]).toEqual(['Wood', 'active'])
    }
    expect(p.state.items.find(i => i.name === 'Misc, Concrete')!.unitCost).toBe(7.06)
  })
  test('the saved tree: the three styles added, Privacy, No dig and 6 ft panels archived, wood turned back on', () => {
    const m = p.state.fenceCatalog!.materials.find(x => x.key === 'wood')!
    expect(m.quotable).toBeUndefined()
    const opt = (dim: string, key: string) => m.dims.find(d => d.key === dim)!.options.find(o => o.key === key)!
    expect(m.dims.find(d => d.key === 'style')!.options.map(o => [o.key, o.label, !!o.archived])).toEqual([['privacy', 'Privacy', true], ['stockade', 'Stockade', false], ['bob', 'Board on Board', false], ['sb', 'Shadow Box', false]])
    expect(opt('install', 'nd').archived).toBe(true)
    expect(opt('width', '6').archived).toBe(true)
    expect(opt('install', 'ds').archived).toBeUndefined()
    expect(p.catalog).toHaveLength(7)
  })
  test('run again: nothing more', () => {
    const again = planWoodRealKits(p.state)
    expect([again.archivedItems, again.archivedKits, again.addedStyles, again.addedKits, again.addedItems, again.catalog]).toEqual([[], [], [], [], [], []])
  })
  test('the new styles quote from their new kits once priced', () => {
    const d: EstimateData = {
      config: { ...config, fenceStyles: p.state.fenceStyles, fenceCatalog: p.state.fenceCatalog },
      inventory: p.state.items.map(i => ({ name: i.name, unitCost: TEST_PRICES[i.name] ?? i.unitCost, status: i.status as string })), kits: p.state.kits,
    }
    expect(heldStyleReason(d, ST)).toBeNull()
    expect(estimate(d, job(ST)).materialCost).toBe(2258.77)
    expect(heldStyleReason(d, 'wood/privacy/6/ds/8')).toMatch(/Privacy is archived/)
  })
})
