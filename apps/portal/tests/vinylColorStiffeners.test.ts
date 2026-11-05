/**
 * Vinyl Colors form, stiffeners (Jonathan, Nov 5, 2026): picket and rail
 * stiffeners are optional, each ticked with a price and how many go in each
 * 6x6 and 6x8 section and each gate leaf. Ticked, they are priced lines of
 * their own in the color's section and gate kits (pull sheet and cost). An
 * 8 ft rail's stiffener is White's shared rail insert, priced in Inventory.
 * Chai Gray, saved before, shows the stiffeners its kits hold.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, kitSetFor, type KitSet } from '../../web/src/materialKits'
import { DEFAULT_CATALOG, resolveFenceStyles, type CatalogState, type InvItem } from '../../web/src/fenceCatalog'
import { planVinylColor, inputFromColor, formProblems, RAIL_INSERT_8, type VinylColorInput } from '../../web/src/vinylColorForm'
import { CHAI_GRAY } from './fixtures/chaiGray'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
let n = 0
const opts = { today: '2026-11-05', newId: (p: string) => `${p}_s${++n}` }

function baseState(): CatalogState {
  const cfg = estimateConfig({})
  const items: InvItem[] = [{ id: 'wv-insert', name: RAIL_INSERT_8, unitCost: 8.15, category: 'Vinyl White' }]
  return { fenceStyles: cfg.fenceStyles.map(s => { const c = { ...s }; delete c.label; delete c.held; delete c.jobLot; return c }), fenceCatalog: clone(DEFAULT_CATALOG), items, kits: [] }
}
const kitOf = (name: string, sets: KitSet[]) => { const k = kitSetFor(name, sets); if (!k || k === 'archived') throw new Error(`no kit for ${name}`); return k }
const qty = (set: KitSet, kind: keyof KitSet['kits'], part: string) => (set.kits[kind] ?? []).filter(p => p.part.trim() === part).reduce((t, p) => t + p.qty, 0)
const lines = (set: KitSet, kind: keyof KitSet['kits'], part: string) => (set.kits[kind] ?? []).filter(p => p.part.trim() === part).length

function quote(st: CatalogState, styleName: string, walkGates = 1) {
  const cfg = estimateConfig({ fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog } as any)
  setMaterialPriceSource(priceSourceFromMap(Object.fromEntries(st.items.map((i: InvItem) => [i.name, i.unitCost]))))
  setSavedKitSets(() => st.kits)
  const style = resolveFenceStyles(cfg.fenceStyles, cfg.fenceCatalog!).find(s => s.name === styleName)!
  return calculateQuote({
    style, runs: [{ ft: 50, rail: 'auto' }, { ft: 50, rail: 'auto' }], corners: 2, ends: 2, walkGates, dblGates: 0,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer!,
  })
}

beforeAll(() => { setSavedKitSets(() => []) })
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

const CLAY: VinylColorInput = {
  name: 'Test Clay', mode: 'piece', sizes: ['6x6', '6x8'], methods: ['nd', 'ds'], samePostPrice: true,
  posts: { '6': { allCents: 2578 } }, capCents: 386, uprightCents: 4000,
  sections: { '6x6': { costCents: null }, '6x8': { costCents: null } },
  pieces: { picketCents: 546, rail6Cents: 1480, rail8Cents: 1480, uTrimCents: 279 },
}

describe('Chai Gray, saved before Nov 5: the form shows the stiffeners its kits hold', () => {
  test('3 picket stiffeners and 1 rail insert per 6x8 section and per gate leaf, priced from Inventory', () => {
    const st = planVinylColor(baseState(), CHAI_GRAY, opts).state
    st.items.find(i => i.name === '*Vinyl, Chai Gray, Picket Stiffener')!.unitCost = 5.85
    const input = inputFromColor(st, 'chai-gray')!
    expect(input.stiffeners?.picket).toEqual({ perSection: { '6x8': 3 }, perLeaf: 3, cents: 585 })
    expect(input.stiffeners?.rail).toMatchObject({ perSection: { '6x8': 1 }, perLeaf: 1 })
  })

  test('saved with them ticked: each is its own priced line on the pull sheet, the section cost once', () => {
    const st0 = planVinylColor(baseState(), CHAI_GRAY, opts).state
    st0.items.find(i => i.name === '*Vinyl, Chai Gray, Picket Stiffener')!.unitCost = 5.85
    const before = quote(st0, 'vinyl/privacy/6/chai-gray/nd/8')
    const plan = planVinylColor(st0, inputFromColor(st0, 'chai-gray')!, { ...opts, key: 'chai-gray' })
    const after = quote(plan.state, 'vinyl/privacy/6/chai-gray/nd/8')
    const line = (c: typeof after, name: string) => c.materials.items.find(i => i.item.trim() === name)
    // 14 sections and 1 gate leaf: 15 section kits.
    expect(line(after, '*Vinyl, Chai Gray, Picket Stiffener')).toMatchObject({ qty: 45, unitCost: 5.85 })
    expect(line(after, RAIL_INSERT_8)).toMatchObject({ qty: 15, unitCost: 8.15 })
    expect(line(after, '*Vinyl, Chai Gray, Section, 6x8')).toMatchObject({ qty: 15, unitCost: 184 })
    expect(line(before, '*Vinyl, Chai Gray, Picket Stiffener')).toMatchObject({ qty: 45, unitCost: 0 })
    // Integer cents: 45 x $5.85 + 15 x $8.15 more material, nothing else moved.
    expect(Math.round(after.materialCost * 100) - Math.round(before.materialCost * 100)).toBe(45 * 585 + 15 * 815)
    // No longer "included in" the section kit.
    expect(plan.state.items.find(i => i.name === '*Vinyl, Chai Gray, Picket Stiffener')!.includedIn).toBeUndefined()
    const opt = (plan.state.fenceCatalog.materials.find(m => m.key === 'vinyl')!.dims.find(d => d.key === 'color')!.options.find(o => o.key === 'chai-gray'))!
    expect(opt.color!.form!.stiffeners).toEqual({ picket: { perSection: { '6x8': 3 }, perLeaf: 3 }, rail: { perSection: { '6x8': 1 }, perLeaf: 1 } })
    expect(opt.color!.form!.contents!['6x8']).toMatchObject({ picketStiffeners: 0, railStiffeners: 0 })
  })
})

describe('a per piece color, both widths', () => {
  const withStiff: VinylColorInput = {
    ...CLAY,
    stiffeners: {
      picket: { cents: 599, perSection: { '6x6': 2, '6x8': 3 }, perLeaf: 2 },
      rail: { cents: 400, perSection: { '6x6': 1, '6x8': 1 }, perLeaf: 0 },
    },
  }

  test('the counts go into each kit: sections by width, gate leaves per leaf, the best price fence by run width', () => {
    const plan = planVinylColor(baseState(), withStiff, opts)
    const k6 = kitOf('vinyl/privacy/6/test-clay/nd/6', plan.state.kits), k8 = kitOf('vinyl/privacy/6/test-clay/nd/8', plan.state.kits)
    const auto = kitOf('vinyl/privacy/6/test-clay/nd/auto', plan.state.kits)
    expect(qty(k6, 'section', '*Vinyl, Test Clay, Picket Stiffener')).toBe(2)
    expect(qty(k6, 'section', '*Vinyl, Test Clay, Rail Stiffener')).toBe(1)
    expect(qty(k8, 'section', '*Vinyl, Test Clay, Picket Stiffener')).toBe(3)
    // An 8 ft rail's stiffener is White's rail insert: one line, at the form's count (not White's copied one as well).
    expect(qty(k8, 'section', RAIL_INSERT_8)).toBe(1)
    expect(lines(k8, 'section', RAIL_INSERT_8)).toBe(1)
    expect(qty(k8, 'section', '*Vinyl, Test Clay, Rail Stiffener')).toBe(0)
    expect(qty(k6, 'walkGate', '*Vinyl, Test Clay, Picket Stiffener')).toBe(2)
    expect(qty(k6, 'dblGate', '*Vinyl, Test Clay, Picket Stiffener')).toBe(4)
    expect(qty(k6, 'walkGate', '*Vinyl, Test Clay, Rail Stiffener')).toBe(0)
    expect(qty(auto, 'section', '*Vinyl, Test Clay, Picket Stiffener')).toBe(2)
    expect(qty(auto, 'section8', '*Vinyl, Test Clay, Picket Stiffener')).toBe(3)
    expect(plan.state.items.find(i => i.name === '*Vinyl, Test Clay, Picket Stiffener')!.unitCost).toBe(5.99)
    expect(plan.state.items.find(i => i.name === '*Vinyl, Test Clay, Rail Stiffener')!.unitCost).toBe(4)
    // The shared insert's price is Inventory's, not the form's.
    expect(plan.state.items.find(i => i.name === RAIL_INSERT_8)!.unitCost).toBe(8.15)
  })

  test('priced on the quote: 6 ft sections, 2 picket and 1 rail stiffener each, 2 per gate leaf', () => {
    const plan = planVinylColor(baseState(), withStiff, opts)
    const calc = quote(plan.state, 'vinyl/privacy/6/test-clay/nd/6')
    const line = (name: string) => calc.materials.items.find(i => i.item.trim() === name)
    expect(calc.sections).toBe(18) // 9 + 9: per run
    expect(line('*Vinyl, Test Clay, Picket Stiffener')).toMatchObject({ qty: 18 * 2 + 2, unitCost: 5.99 })
    expect(line('*Vinyl, Test Clay, Rail Stiffener')).toMatchObject({ qty: 18, unitCost: 4 })
  })

  test('the form opens with what was saved, and unticking takes them out of every kit', () => {
    const plan = planVinylColor(baseState(), withStiff, opts)
    const back = inputFromColor(plan.state, 'test-clay')!
    expect(back.stiffeners).toEqual(withStiff.stiffeners)
    const off = planVinylColor(plan.state, { ...back, stiffeners: { picket: null, rail: null } }, { ...opts, key: 'test-clay' })
    for (const k of off.state.kits.filter(k => k.madeFor === 'vinyl:color:test-clay')) {
      for (const kind of ['section', 'section8', 'walkGate', 'dblGate'] as const) {
        expect(qty(k, kind, '*Vinyl, Test Clay, Picket Stiffener'), `${k.name} ${kind}`).toBe(0)
        expect(qty(k, kind, RAIL_INSERT_8), `${k.name} ${kind}`).toBe(0)
      }
    }
  })
})

describe('the form says what is missing', () => {
  test('a ticked stiffener needs its price and at least one count', () => {
    const p = formProblems({ ...CLAY, stiffeners: { picket: { cents: null, perSection: { '6x6': 0, '6x8': 0 }, perLeaf: 0 }, rail: null } })
    expect(p).toContain('Enter the picket stiffener price.')
    expect(p.some(x => /Picket stiffener is ticked but none go/.test(x))).toBe(true)
    const blank = formProblems({ ...CLAY, stiffeners: { picket: { cents: 599, perSection: { '6x6': 2 }, perLeaf: NaN }, rail: null } })
    expect(blank).toContain('Picket stiffener: enter how many in a 6x8 section (0 if none).')
    expect(blank).toContain('Picket stiffener: enter how many in a gate leaf (0 if none).')
    // Only in 8 ft rails: White's rail insert, no price of its own to enter.
    expect(formProblems({ ...CLAY, stiffeners: { picket: null, rail: { cents: null, perSection: { '6x6': 0, '6x8': 1 }, perLeaf: 0 } } })).toEqual([])
  })
})
