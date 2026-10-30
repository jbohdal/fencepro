/**
 * Real wood kits (Jonathan, Oct 30 2026; web/src/wood.ts): three wood styles,
 * Stockade, Board on Board and Shadow Box, 6 ft tall, dig set, 8 ft sections,
 * each in two picket grades (PT Pine = Good, Alta Premium = Better): six
 * styles, each with its own kit. A new wood fence's material is its own kit
 * priced from Inventory, its labor the White Vinyl dig set 6'x8' privacy
 * install labor × the Wood factor; wood is held until every part of its kit
 * has a price and then quotes by itself. The gate post kit (materialKits.ts
 * withGatePosts) takes the posts each side of a gate out of the end posts,
 * only where a set has one. Proposals offer the two grades as Good / Better.
 *
 * Sample jobs: two runs, 100 ft and 60 ft, one corner and three end posts,
 * two of them each side of a 4 ft walk gate (sections per run, never total
 * footage ÷ 8: 13 + 8 = 21, not 20); and a drawn 100 ft straight line with a
 * 4 ft walk gate in the middle, as the app counts it: runs 48 + 48 ft, no
 * corners, 4 end posts (2 at the ends, 2 at the gate).
 */

import { describe, test, expect, afterEach } from 'vitest'
import { setMaterialPriceSource } from '../../web/src/materialCalculator'
import {
  setSavedKitSets, builtInKitSet, linesFromKitSet, linesFromKitSetJobLot, withGatePosts, countsFor, KIT_KINDS, KIT_LABEL, PIECE_OF_KIT, type KitSet,
} from '../../web/src/materialKits'
import { estimate, estimateConfig, estimateStyles, heldStyleReason, quoteJobFor, type EstimateData } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import {
  planWood, planWoodRealKits, woodRealKitSet, leafPickets, woodStyleName, woodKitId, WOOD_PARTS, WOOD_STYLES, WOOD_GRADES, WOOD_REAL_STYLES,
  WOOD_MATERIAL, WOOD_OLD_OF, WOOD_LABOR_FROM, type WoodState,
} from '../../web/src/wood'
import { isHeldSavedQuote, heldQuoteSave, heldSavedNumbers } from '../../web/src/heldQuote'
import { DEFAULT_CATALOG } from '../../web/src/fenceCatalog'
import { styleParts } from '../../web/src/proposalOptions'
import { WOOD_STARTER, startersFor, tierSpecSchema } from '../src/server/lib/tierStarters'
import type { FenceStyle } from '../../web/src/configStore'
import type { PricingSettings } from '../../web/src/pricingEngine'

const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}

const PINE = "Wood, Picket, PT Pine, 1x6x6'", PREMIUM = "Wood, Picket, Alta Premium Treated Dog-Ear, 1x6x6'"
const PICKET_NAIL = 'Wood, Picket Nail, 1-3/4" x .090 15° 304 SS Ring Shank', FRAMING_NAIL = 'Wood, Framing Nail, 3" x .120 21° Galv Ring Shank'
const SCREW = 'Wood, Screw, Self-Tapping, Picket to Steel Gate Frame', FRAME = 'Wood, Steel Gate Frame (hinges included)'

/** The Oct 19 privacy rows, as live has them (kept, held). */
const OLD_ROWS: FenceStyle[] = Object.entries(WOOD_OLD_OF).map(([name, v]) => {
  const [, , height, install, width] = name.split('/')
  return { id: `fs_${name.replace(/\//g, '_')}`, name, category: 'Wood', margin: 0.6, sectionsPerMH: 0.8, panelWidth: Number(width), mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, material: 'wood', choices: { style: 'privacy', height, install, width }, woodOf: v } as FenceStyle
})
const plan = planWood({ fenceStyles: [...DEFAULT_FENCE_STYLES, ...OLD_ROWS], items: [], kits: [] }, '2026-10-30T12:00:00.000Z')
const config = { fenceStyles: plan.state.fenceStyles, pricing: { ...PRICING, overheadPct: 30 } } as any
const COST = Object.fromEntries(WOOD_PARTS.map(p => [p.part, p.unitCost]))

/** Inventory as the one-time step leaves it (Jonathan's costs, every part priced), concrete and the drop rod at live's, and any changes. */
function data(changes: Record<string, number> = {}): EstimateData {
  const prices: Record<string, number> = { ...COST, 'Misc, Concrete': 7.06, 'Drop Rod, 48", Black': 48.01, ...changes }
  return { config, inventory: plan.state.items.map(i => ({ name: i.name, unitCost: prices[i.name] ?? 0, status: 'active' })), kits: plan.state.kits }
}
const priced = data()
const ST = woodStyleName('stockade', 'pine'), ST_P = woodStyleName('stockade', 'premium')
const BOB = woodStyleName('bob', 'pine'), SB_P = woodStyleName('sb', 'premium')
const job = (fenceStyle: string) => ({ fenceStyle, runs: [100, 60], corners: 1, ends: 3, walkGates: 1, dblGates: 0 })
const drawn = (fenceStyle: string) => ({ fenceStyle, runs: [48, 48], corners: 0, ends: 4, walkGates: 1, dblGates: 0 })

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('the real wood kits', () => {
  test('six styles (three styles × two picket grades), 6 ft tall, dig set, 8 ft panels, each with its own kit; labor from WV-DS 6x8', () => {
    expect(WOOD_REAL_STYLES).toEqual([
      'wood/stockade/6/pine/ds/8', 'wood/stockade/6/premium/ds/8', 'wood/bob/6/pine/ds/8', 'wood/bob/6/premium/ds/8', 'wood/sb/6/pine/ds/8', 'wood/sb/6/premium/ds/8',
    ])
    expect(plan.styles).toEqual(WOOD_REAL_STYLES)
    expect(plan.kits).toEqual(WOOD_REAL_STYLES)
    const cfg = estimateConfig(config)
    for (const n of WOOD_REAL_STYLES) {
      const s = cfg.fenceStyles.find(x => x.name === n)!
      expect(s.woodOf).toBe(WOOD_LABOR_FROM)
      expect(s.panelWidth).toBe(8)
      expect(s.category).toBe('Wood')
    }
    expect(cfg.fenceStyles.find(x => x.name === ST)!.label).toBe('Wood Stockade, 6 ft tall, 8 ft panels, Dig set, PT Pine pickets')
    expect(cfg.fenceStyles.find(x => x.name === SB_P)!.label).toBe('Wood Shadow Box, 6 ft tall, 8 ft panels, Dig set, Alta Premium pickets')
    expect(cfg.fenceStyles.find(x => x.name === 'wood/privacy/6/nd/6')!.label).toBe('Wood Privacy, 6 ft tall, 6 ft panels, No dig')
  })

  test('quantities as set Oct 30 2026; the two grades differ only in the picket', () => {
    const q = (style: 'stockade' | 'bob' | 'sb', grade: 'pine' | 'premium', kind: Parameters<typeof withGatePosts>[1] extends never ? never : keyof KitSet['kits']) =>
      Object.fromEntries((woodRealKitSet(style, grade).kits[kind] ?? []).map(p => [p.part, p.qty]))
    expect(q('stockade', 'pine', 'section')).toEqual({ "Wood, PT Rail, 2x4x8'": 3, [PINE]: 17, [PICKET_NAIL]: 102, [FRAMING_NAIL]: 12 })
    expect(q('bob', 'premium', 'section')).toEqual({ "Wood, PT Rail, 2x4x8'": 3, [PREMIUM]: 22, [PICKET_NAIL]: 132, [FRAMING_NAIL]: 12 })
    expect(q('sb', 'pine', 'section')[PINE]).toBe(22)
    expect(q('sb', 'pine', 'line')).toEqual({ "Wood, PT Post, Line, 4x4x8'": 1, 'Misc, Concrete': 1 })
    expect(q('sb', 'pine', 'gatePost')).toEqual({ "Wood, PT Post, Gate, 6x6x8'": 1, 'Misc, Concrete': 2 })
    expect([4, 5, 6].map(w => leafPickets(17, w))).toEqual([9, 11, 13])
    expect([4, 5, 6].map(w => leafPickets(22, w))).toEqual([11, 14, 17])
    expect(q('stockade', 'pine', 'walkGate')).toEqual({ [FRAME]: 1, [PINE]: 9, [SCREW]: 36, 'Wood, Gate Latch': 1 })
    expect(q('bob', 'premium', 'walkGate6')).toEqual({ [FRAME]: 1, [PREMIUM]: 17, [SCREW]: 68, 'Wood, Gate Latch': 1 })
    expect(q('sb', 'pine', 'dblGate12')).toEqual({ [FRAME]: 2, [PINE]: 34, [SCREW]: 136, 'Wood, Gate Latch': 1 })
    expect(q('stockade', 'premium', 'dblGate10')[PREMIUM]).toBe(22)
    expect(q('stockade', 'pine', 'anyDblGate')).toEqual({ 'Drop Rod, 48", Black': 1 })
    for (const s of WOOD_STYLES) {
      const pine = woodRealKitSet(s.key, 'pine'), prem = woodRealKitSet(s.key, 'premium')
      expect(JSON.stringify(pine.kits).replaceAll(PINE, 'P')).toBe(JSON.stringify(prem.kits).replaceAll(PREMIUM, 'P'))
      for (const set of [pine, prem]) {
        expect(set.madeFor).toBe('wood-real')
        expect(set.roundUp).toEqual([])
        expect(set.kits.blank).toBeUndefined()
        const all = KIT_KINDS.flatMap(k => set.kits[k] ?? []).map(p => p.part)
        expect(all.some(p => /cap|hinge \(|brace|Exterior/i.test(p))).toBe(false)
        for (const k of ['walkGate', 'walkGate5', 'walkGate6', 'dblGate', 'dblGate10', 'dblGate12'] as const) expect((set.kits[k] ?? []).some(p => /Rail|Nail/.test(p.part))).toBe(false)
      }
    }
    expect(woodKitId('bob', 'premium')).toBe('kit_wood_real_bob_6_premium_ds_8')
  })

  test('the new parts: 12, at Jonathan\'s costs (shelf × 1.0722, whole cents; the frame and the screw as given)', () => {
    expect(WOOD_PARTS.map(p => [p.part, p.unitCost])).toEqual([
      ["Wood, PT Post, Line, 4x4x8'", 11.34], ["Wood, PT Post, Corner, 4x4x8'", 11.34], ["Wood, PT Post, End, 4x4x8'", 11.34],
      ["Wood, PT Post, Gate, 6x6x8'", 39.33], ["Wood, PT Rail, 2x4x8'", 5.23], [PINE, 2.77], [PREMIUM, 3.95],
      [PICKET_NAIL, 0.08], [FRAMING_NAIL, 0.04], [SCREW, 0.09], ['Wood, Gate Latch', 31.82], [FRAME, 350],
    ])
    for (const p of WOOD_PARTS) if (p.shelf) expect(Math.abs(p.unitCost - p.shelf * 1.0722)).toBeLessThan(0.005 + 1e-9)
    expect(plan.state.items.filter(i => i.unitCost > 0).every(i => i.priceUpdatedAt === '2026-10-30')).toBe(true)
  })

  test('the 160 ft job, per run: 21 sections, 19 line posts, 1 corner, 1 end and 2 gate posts, the walk gate', () => {
    for (const [name, pk, n, leaf] of [[ST, PINE, 17, 9], [ST_P, PREMIUM, 17, 9], [BOB, PINE, 22, 11], [SB_P, PREMIUM, 22, 11]] as const) {
      const est = estimate(priced, job(name))
      expect(est.perRunSections).toEqual([13, 8])
      expect(est.sections).toBe(21)
      expect(Object.fromEntries(est.pullSheet.map(i => [i.item, i.qty]))).toEqual({
        "Wood, PT Post, Line, 4x4x8'": 19, "Wood, PT Post, Corner, 4x4x8'": 1, "Wood, PT Post, End, 4x4x8'": 1, "Wood, PT Post, Gate, 6x6x8'": 2,
        'Misc, Concrete': 19 + 1 + 1 + 2 * 2, "Wood, PT Rail, 2x4x8'": 21 * 3, [pk]: 21 * n + leaf, [PICKET_NAIL]: 21 * n * 6, [FRAMING_NAIL]: 21 * 12,
        [FRAME]: 1, [SCREW]: 4 * leaf, 'Wood, Gate Latch': 1,
      })
    }
  })

  test('the drawn 100 ft line with a 4 ft walk gate: Stockade, PT Pine pickets, priced from Inventory, no "Wood material × 115%" line', () => {
    const est = estimate(priced, drawn(ST))
    expect(est.sections).toBe(12)
    const byName = (a: any[], b: any[]) => String(a[0]).localeCompare(String(b[0]))
    expect(est.pullSheet.map(i => [i.item, i.qty, i.unitCost, i.total]).sort(byName)).toEqual([
      ["Wood, PT Post, End, 4x4x8'", 2, 11.34, 22.68],
      ["Wood, PT Post, Gate, 6x6x8'", 2, 39.33, 78.66],
      ['Misc, Concrete', 16, 7.06, 112.96],
      ["Wood, PT Post, Line, 4x4x8'", 10, 11.34, 113.4],
      ["Wood, PT Rail, 2x4x8'", 36, 5.23, 188.28],
      [PINE, 213, 2.77, 590.01],
      [PICKET_NAIL, 1224, 0.08, 97.92],
      [FRAMING_NAIL, 144, 0.04, 5.76],
      [FRAME, 1, 350, 350],
      [SCREW, 36, 0.09, 3.24],
      ['Wood, Gate Latch', 1, 31.82, 31.82],
    ].sort(byName))
    expect(est.pullSheet.some(i => /Wood material/.test(i.item) || i.moneyOnly)).toBe(false)
    expect(est.materialCost).toBe(1594.73)
    // Alta Premium: the same fence, 213 pickets at $3.95.
    expect(estimate(priced, drawn(ST_P)).materialCost).toBe(Math.round((1594.73 + 213 * (3.95 - 2.77)) * 100) / 100)
  })

  test('labor: WV-DS 6x8 install labor × 115% for all six; the material is not vinyl × 115%', () => {
    const vinyl = estimate(priced, job(WOOD_LABOR_FROM))
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
    expect(parts[FRAME]).toBe(4)
    expect(parts['Wood, Gate Latch']).toBe(2)
    expect(Object.keys(parts).some(p => /Blank/.test(p))).toBe(false)
  })
})

describe('Good / Better on the proposal: PT Pine and Alta Premium pickets', () => {
  const tierSet = { category: 'Wood', tiers: WOOD_STARTER, popular: null }
  const req = (fenceStyle: string) => ({
    fenceStyle, runs: [{ ft: 48, rail: 'auto' as const }, { ft: 48, rail: 'auto' as const }], corners: 0, ends: 4, walkGates: 1, dblGates: 0,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new' as const,
    move: null, repair: null, tierSet, tierPrefs: { off: [], swap: {} }, compare: false, offer: [], offerNewFence: false, offerMoveAsIs: true, photoIds: {}, keepStyle: null,
  })
  test('the Wood set starts with Good = PT Pine and Better = Alta Premium; the server takes those tier colors', () => {
    expect(WOOD_STARTER.map(t => [t.name, t.color])).toEqual([['Good', 'pine'], ['Better', 'premium']])
    for (const t of WOOD_STARTER) expect(tierSpecSchema.parse(t)).toBeTruthy()
    expect(startersFor({ fenceStyles: plan.state.fenceStyles }).find(s => s.key === 'wood')).toMatchObject({ category: 'Wood', tiers: WOOD_STARTER, popular: null })
    // Not made (empty) before the wood styles are in Settings: made as soon as they are.
    expect(startersFor({ fenceStyles: DEFAULT_FENCE_STYLES }).some(s => s.key === 'wood')).toBe(false)
    expect(styleParts(ST, { material: 'wood', choices: { style: 'stockade', height: '6', picket: 'pine', install: 'ds', width: '8' } }))
      .toEqual({ family: 'wood', color: 'pine', install: 'dig-set', height: '6', width: 8, model: 'stockade' })
  })
  test('a Stockade quote and a Board on Board quote each show both options with their prices', () => {
    for (const [own, better] of [[ST, ST_P], [BOB, woodStyleName('bob', 'premium')]]) {
      const j = quoteJobFor(priced, req(own))
      const tiers = j.tiers.map(t => [t.spec.name, t.style?.name, t.reason])
      expect(tiers).toEqual([['Good', own, undefined], ['Better', better, undefined]])
      const opts = j.proposalOptions.filter(o => o.tier)
      expect(opts.map(o => o.fenceStyle)).toEqual([own, better])
      expect(opts.every(o => o.finalPrice > 0)).toBe(true)
      expect(opts[1].finalPrice).toBeGreaterThan(opts[0].finalPrice)
      expect(opts[0].finalPrice).toBe(j.totals.price)
    }
  })
  test('while a part has no price, neither tier is offered and each says why', () => {
    const j = quoteJobFor(data({ [SCREW]: 0 }), { ...req(ST), keepStyle: ST })
    expect(j.tiers.map(t => t.reason)).toEqual([expect.stringMatching(/waiting for prices on 1 part/), expect.stringMatching(/waiting for prices on 1 part/)])
  })
})

describe('the gate post kit', () => {
  const set = woodRealKitSet('stockade', 'pine')
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
      expect(linesFromKitSet({ ...b, kits: { ...b.kits, gatePost: [] } }, c)).toEqual(linesFromKitSet(b, c))
    }
  })
  test('in the Material Kits editor and the piece prices', () => {
    expect(KIT_LABEL.gatePost).toBe('Gate post (each side of a gate, used in place of an end post)')
    expect(PIECE_OF_KIT.gatePost).toBe('post')
    const lot = { color: 'X', supplier: 'S', quotedOn: '2026-10-30', width: 8, sections: { '8': 100 }, end: 30, covers: { section: [], post: ["Wood, PT Post, Gate, 6x6x8'", "Wood, PT Post, End, 4x4x8'"], walkGate: [], dblGate: [] } }
    expect(linesFromKitSetJobLot(set, base, lot as any).find(l => /end post/.test(l.part))?.qty).toBe(6)
  })
})

describe('held until every wood part is priced, then quotes by itself', () => {
  test('any part at $0 (the screw here): every wood style held on that one part', () => {
    const d = data({ [SCREW]: 0 })
    for (const n of WOOD_REAL_STYLES) expect(heldStyleReason(d, n)).toBe('Wood is waiting for prices on 1 part in Inventory')
    expect(estimateStyles(config, d).some(s => s.material === 'wood')).toBe(false)
    expect(() => estimate(d, job(ST))).toThrow()
  })
  test('each style goes by its own parts: Alta Premium at $0 holds only the premium styles', () => {
    const d = data({ [PREMIUM]: 0 })
    for (const s of WOOD_STYLES) {
      expect(heldStyleReason(d, woodStyleName(s.key, 'pine'))).toBeNull()
      expect(heldStyleReason(d, woodStyleName(s.key, 'premium'))).toBe('Wood is waiting for prices on 1 part in Inventory')
    }
  })
  test('as the one-time step leaves it, every part priced: all six available for quoting, no other step', () => {
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
    expect(estimateConfig(config).fenceStyles.filter(s => s.material === 'wood')).toHaveLength(10)
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
  oldWood.nameTemplate = 'Wood {style}, {height} tall, {width}, {install}'
  oldWood.dims = oldWood.dims.filter((d: any) => d.key !== 'picket')
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
  test('renamed vinyl parts and their kits archived, never deleted; six styles, kits and 12 new parts added; concrete and the drop rod reused', () => {
    expect(p.archivedItems.sort()).toEqual(['Wood, Picket, 62-1/4"', 'Wood, Rivet, 1"'])
    expect(p.state.items.filter(i => i.madeFor === 'wood').every(i => i.status === 'archived')).toBe(true)
    expect(p.archivedKits).toHaveLength(4)
    expect(p.state.kits.filter(k => k.madeFor === 'wood').every(k => k.archived)).toBe(true)
    expect(p.addedStyles).toEqual(WOOD_REAL_STYLES)
    expect(p.addedKits).toEqual(WOOD_REAL_STYLES)
    expect(p.addedItems).toEqual(WOOD_PARTS.map(x => x.part))
    expect(p.state.items).toHaveLength(old.items.length + 12)
    expect(p.state.fenceStyles).toHaveLength(old.fenceStyles.length + 6)
    for (const i of p.state.items.filter(i => i.madeFor === 'wood-real')) {
      expect(i.unitCost).toBe(COST[i.name])
      expect([i.category, i.status]).toEqual(['Wood', 'active'])
    }
    expect(p.state.items.find(i => i.name === 'Misc, Concrete')!.unitCost).toBe(7.06)
  })
  test('the saved tree: styles and pickets added, Privacy, No dig and 6 ft panels archived, wood turned back on', () => {
    const m = p.state.fenceCatalog!.materials.find(x => x.key === 'wood')!
    expect(m.quotable).toBeUndefined()
    expect(m.dims.map(d => d.key)).toEqual(['style', 'height', 'picket', 'install', 'width'])
    expect(m.dims.find(d => d.key === 'style')!.options.map(o => [o.key, !!o.archived])).toEqual([['privacy', true], ['stockade', false], ['bob', false], ['sb', false]])
    expect(m.dims.find(d => d.key === 'picket')!.options.map(o => o.label)).toEqual(WOOD_GRADES.map(g => g.label))
    expect(m.dims.find(d => d.key === 'install')!.options.find(o => o.key === 'nd')!.archived).toBe(true)
    expect(m.dims.find(d => d.key === 'width')!.options.find(o => o.key === '6')!.archived).toBe(true)
    expect(p.catalog).toHaveLength(9)
  })
  test('run again: nothing more', () => {
    const again = planWoodRealKits(p.state)
    expect([again.archivedItems, again.archivedKits, again.addedStyles, again.addedKits, again.addedItems, again.catalog]).toEqual([[], [], [], [], [], []])
  })
  test('the new styles quote from their new kits at once; the old ones stay held', () => {
    const d: EstimateData = {
      config: { ...config, fenceStyles: p.state.fenceStyles, fenceCatalog: p.state.fenceCatalog },
      inventory: p.state.items.map(i => ({ name: i.name, unitCost: i.unitCost, status: i.status as string })), kits: p.state.kits,
    }
    expect(heldStyleReason(d, ST)).toBeNull()
    expect(estimate(d, drawn(ST)).materialCost).toBe(1594.73)
    expect(heldStyleReason(d, 'wood/privacy/6/ds/8')).toMatch(/Privacy is archived/)
  })
})
