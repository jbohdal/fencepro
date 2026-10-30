/**
 * Settings → Price List → Vinyl Colors (web/src/vinylColorForm.ts): a color
 * from one form, built from the White fences.
 *
 *   - every kit of a new color has White's lines, one for one: the same count
 *     as the White fence of that size (posts, gates, sections); per section,
 *     a section kit's lines are what the section includes, so the count is
 *     White's plus the parts White has no line for (Chai Gray: the picket
 *     stiffeners in a section; the stiffeners in a gate leaf's section kit);
 *   - a Chai Gray quote's pull sheet lists the kit contents at $0 and the
 *     section cost once per section (gate leaves included);
 *   - Undo leaves Settings, Inventory and kits exactly as before;
 *   - an edit writes new costs (price history) and changes no kit line of a
 *     cost-only edit; Remove archives.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, kitSetFor, KIT_KINDS, type KitSet } from '../../web/src/materialKits'
import { DEFAULT_CATALOG, resolveFenceStyles, type CatalogState, type InvItem } from '../../web/src/fenceCatalog'
import {
  planVinylColor, planUndoVinylColor, planArchiveVinylColor, inputFromColor, kitLineCounts, whitePartRole, formProblems,
  type VinylColorInput, type SizeKey,
} from '../../web/src/vinylColorForm'
import { CHAI_GRAY } from './fixtures/chaiGray'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
let n = 0
const opts = { today: '2026-10-21', newId: (p: string) => `${p}_t${++n}` }

function baseState(): CatalogState {
  const cfg = estimateConfig({})
  return { fenceStyles: cfg.fenceStyles.map(s => { const c = { ...s }; delete c.label; delete c.held; delete c.jobLot; return c }), fenceCatalog: clone(DEFAULT_CATALOG), items: [], kits: [] }
}
const white = (size: string, m: 'nd' | 'ds') => `WV-${m.toUpperCase()} ${size.replace('x', "'x")}' Privacy`
const kitOf = (name: string, sets: KitSet[]) => { const k = kitSetFor(name, sets); if (!k || k === 'archived') throw new Error(`no kit for ${name}`); return k }

beforeAll(() => { setSavedKitSets(() => []) })
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('the form', () => {
  test('says what is missing, in words', () => {
    const p = formProblems({ ...CHAI_GRAY, name: '', capCents: null, sections: { '6x8': { costCents: null } } })
    expect(p).toContain('Type the color name.')
    expect(p).toContain('Enter the post cap cost.')
    expect(p).toContain('Enter the 6x8 section cost.')
    expect(p.some(x => x.includes('picket count'))).toBe(true)
    expect(formProblems(CHAI_GRAY)).toEqual([])
    expect(formProblems({ ...CHAI_GRAY, name: 'White' })[0]).toMatch(/already a vinyl color/)
  })
})

describe('creating a color: the same takeoff rules (kit lines) as the White template, size by size', () => {
  const sizes: SizeKey[] = ['6x6', '6x8', '8x6', '8x8']
  for (const mode of ['piece', 'section'] as const) {
    test(`${mode === 'piece' ? 'per piece' : 'per section'}: every kit of every size and method`, () => {
      const st = baseState()
      const input: VinylColorInput = {
        name: 'Test Clay', mode, sizes, methods: ['nd', 'ds'], samePostPrice: false,
        // 8 ft tall: one post price and a section price per size (priced by the piece, Oct 21, 2026); its contents are not asked.
        posts: { '6': { cornerCents: 3000, endCents: 3100, lineCents: 3200, blankCents: 3300 }, '8': { allCents: 4000 } },
        capCents: 300, uprightCents: 1200, gate8Cents: 40000,
        sections: {
          '6x6': { costCents: 15000, pickets: 11, rails: 2, railFt: 6, picketStiffeners: 0, railStiffeners: 0, uChannels: 2 },
          '6x8': { costCents: 18000, pickets: 15, rails: 2, railFt: 8, picketStiffeners: 0, railStiffeners: 1, uChannels: 2 },
          '8x6': { costCents: 20000 },
          '8x8': { costCents: 24000 },
        },
        pieces: { picketCents: 300, rail6Cents: 700, rail8Cents: 1000, uTrimCents: 150 },
      }
      const plan = planVinylColor(st, input, opts)
      expect(plan.created.styles.length).toBe(8)
      for (const size of sizes) for (const m of ['nd', 'ds'] as const) {
        const w = kitOf(white(size, m), [])
        const name = `vinyl/privacy/${size.split('x')[0]}/test-clay/${m}/${size.split('x')[1]}`
        const c = kitOf(name, plan.state.kits)
        const wc = kitLineCounts(w), cc = kitLineCounts(c)
        expect(Object.keys(cc).sort(), `${name}: the same kits`).toEqual(Object.keys(wc).sort())
        for (const kind of KIT_KINDS) {
          if (!wc[kind]) continue
          // 8 ft tall: the same shape as White's, line for line, per piece or per section alike.
          if (size.startsWith('8')) { expect(cc[kind], `${name} ${kind} = White`).toBe(wc[kind]); continue }
          // Per section: White's section-part lines become the section kit's own lines.
          const sectionParts = (set: KitSet) => (set.kits[kind] ?? []).filter(p => ['picket', 'rail', 'uTrim', 'railInsert', 'sectionItem'].includes(whitePartRole(p.part).role)).length
          const kitLines = mode === 'section' && sectionParts(w) > 0
            ? (() => { const s = input.sections[(kind === 'walkGate' || kind === 'dblGate') && size.startsWith('6') ? '6x6' : size]!; return [s.pickets, s.rails, s.picketStiffeners, s.railStiffeners, s.uChannels].filter(x => (x ?? 0) > 0).length })()
            : 0
          const expected = mode === 'section' && sectionParts(w) > 0 ? wc[kind]! - sectionParts(w) + kitLines : wc[kind]!
          expect(cc[kind], `${name} ${kind}`).toBe(expected)
          // With contents that match White's section one for one, the counts are equal outright.
          if (mode === 'piece' || kind === 'corner' || kind === 'end' || kind === 'line' || kind === 'blank') expect(cc[kind], `${name} ${kind} = White`).toBe(wc[kind])
        }
        // Shared parts are White's, untouched.
        for (const kind of KIT_KINDS) for (const p of w.kits[kind] ?? []) {
          if (whitePartRole(p.part).role !== 'shared') continue
          expect(c.kits[kind]?.find(x => x.part === p.part)?.qty, `${name} ${kind} keeps ${p.part}`).toBe(p.qty)
        }
      }
    })
  }

  test('Chai Gray 6x8: posts and gates line for line with White; the section kit is what Jonathan says it includes', () => {
    const plan = planVinylColor(baseState(), CHAI_GRAY, opts)
    for (const m of ['nd', 'ds'] as const) {
      const w = kitLineCounts(kitOf(white('6x8', m), []))
      const c = kitOf(`vinyl/privacy/6/chai-gray/${m}/8`, plan.state.kits)
      const cc = kitLineCounts(c)
      for (const k of ['corner', 'end', 'line', 'blank'] as const) expect(cc[k], `${m} ${k}`).toBe(w[k])
      // White's section: picket, rail 8', U trim, rail insert, truss screws (5). Chai Gray: picket, rail 8', U channel,
      // rail stiffener (White's rail insert, the same part for every color: Jonathan, Oct 21), truss screws,
      // and 3 picket stiffeners White has no line for (6).
      expect(cc.section).toBe(w.section! + 1)
      expect(c.kits.section).toEqual([
        { part: '*Vinyl, Chai Gray, Picket', qty: 15, fallbackCost: 0 },
        { part: "*Vinyl, Chai Gray, Rail, 8'", qty: 2, fallbackCost: 0 },
        { part: '*Vinyl, Chai Gray, Picket Stiffener', qty: 3, fallbackCost: 0 },
        { part: "Vinyl, Rail Insert, 8'", qty: 1, fallbackCost: 0 },
        { part: '*Vinyl, Chai Gray, U Channel', qty: 2, fallbackCost: 0 },
        expect.objectContaining({ part: '*Vinyl, Truss, 8 x 3/4" (U-Trim)', qty: 6 }),
      ])
      // A gate leaf: White's leaf is a 6 ft section's parts (picket, 6' rail, U trim); Chai Gray's is one 6x8 section kit (5 lines).
      expect(cc.walkGate).toBe(w.walkGate! - 3 + 5)
      expect(cc.dblGate).toBe(w.dblGate! - 3 + 5)
      expect(c.kits.walkGate!.find(p => p.part === '*Vinyl, Chai Gray, Picket')!.qty).toBe(15)
      expect(c.kits.dblGate!.find(p => p.part === '*Vinyl, Chai Gray, Picket')!.qty).toBe(30)
    }
    const names = plan.created.items.map(i => i.name)
    expect(names).toEqual(expect.arrayContaining([
      '*Vinyl, Chai Gray, Section, 6x8', '*Vinyl, Chai Gray, Post, 5" x 5" x 78"', '*Vinyl, Chai Gray, Post, 5" x 5" x 102"',
      '*Vinyl, Chai Gray, Cap, 5"x5"', '*Vinyl, Chai Gray, Cap, Gate', '*Vinyl, Chai Gray, Upright',
    ]))
    expect(plan.created.styles.map(s => s.label)).toEqual([
      'Chai Gray Vinyl Privacy, 6 ft tall, 8 ft panels, No dig', 'Chai Gray Vinyl Privacy, 6 ft tall, 8 ft panels, Dig set',
    ])
    // Labor and profit from the White fence of the same size and method.
    for (const m of ['nd', 'ds'] as const) {
      const w = plan.state.fenceStyles.find(s => s.name === white('6x8', m))!
      const c = plan.state.fenceStyles.find(s => s.name === `vinyl/privacy/6/chai-gray/${m}/8`)!
      expect([c.sectionsPerMH, c.targetProfitPct, c.margin, c.mhPerWalkGate, c.mhPerDblGate, c.subRate, c.panelWidth]).toEqual([w.sectionsPerMH, w.targetProfitPct, w.margin, w.mhPerWalkGate, w.mhPerDblGate, w.subRate, 8])
    }
    // Every cost set is in cents, dated today.
    expect(plan.priced.map(p => [p.name, p.cents]).sort()).toEqual([
      ['*Vinyl, Chai Gray, Cap, 5"x5"', 386], ['*Vinyl, Chai Gray, Cap, Gate', 386], ['*Vinyl, Chai Gray, Post, 5" x 5" x 102"', 3892],
      ['*Vinyl, Chai Gray, Post, 5" x 5" x 78"', 3892], ['*Vinyl, Chai Gray, Section, 6x8', 18400], ['*Vinyl, Chai Gray, Upright', 1336],
    ].sort())
  })
})

describe('a Chai Gray quote', () => {
  test('the pull sheet lists the kit contents at $0 and carries the section cost once per section', () => {
    const plan = planVinylColor(baseState(), CHAI_GRAY, opts)
    const cfg = estimateConfig({ fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog } as any)
    setMaterialPriceSource(priceSourceFromMap(Object.fromEntries(plan.state.items.map((i: InvItem) => [i.name, i.unitCost]))))
    setSavedKitSets(() => plan.state.kits)
    const styles = resolveFenceStyles(cfg.fenceStyles, cfg.fenceCatalog!)
    const style = styles.find(s => s.name === 'vinyl/privacy/6/chai-gray/nd/8')!
    expect(style.held, 'fully priced, available for quoting').toBeUndefined()
    const calc = calculateQuote({
      style, runs: [{ ft: 50, rail: 'auto' }, { ft: 50, rail: 'auto' }], corners: 2, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer!,
    })
    const line = (name: string) => calc.materials.items.find(i => i.item === name)
    expect(calc.sections).toBe(14) // 7 + 7: per run
    // 14 sections + 1 gate leaf, each one section kit, at $184.00, once.
    expect(line('*Vinyl, Chai Gray, Section, 6x8')).toMatchObject({ qty: 15, unitCost: 184, total: 2760 })
    expect(calc.materials.items.filter(i => i.item.includes('Section, 6x8')).length).toBe(1)
    for (const [part, qty] of [['*Vinyl, Chai Gray, Picket', 225], ["*Vinyl, Chai Gray, Rail, 8'", 30], ['*Vinyl, Chai Gray, Picket Stiffener', 45], ["Vinyl, Rail Insert, 8'", 15], ['*Vinyl, Chai Gray, U Channel', 30]] as const) {
      expect(line(part), part).toMatchObject({ qty, unitCost: 0, total: 0 })
    }
    expect(line('*Vinyl, Chai Gray, Post, 5" x 5" x 78"')).toMatchObject({ qty: 16, unitCost: 38.92 })
    expect(line('*Vinyl, Chai Gray, Cap, 5"x5"')).toMatchObject({ qty: 16, unitCost: 3.86 })
    expect(line('*Vinyl, Chai Gray, Upright')).toMatchObject({ qty: 2, unitCost: 13.36 })
    // Nothing White on a Chai Gray fence except the shared rivets.
    expect(calc.materials.items.filter(i => /White/.test(i.item)).map(i => i.item)).toEqual(['*Vinyl, White, Rivet, 1"'])
    // The section cost is in the material cost once: no part line carries it again.
    const kitMoney = calc.materials.items.filter(i => i.item.startsWith('*Vinyl, Chai Gray,') && !i.item.includes('Section,')).filter(i => i.unitCost === 0).reduce((t, i) => t + i.total, 0)
    expect(kitMoney).toBe(0)
  })
})

describe('Jonathan\'s answers, Oct 21: the rail insert is shared, rivets can be another color', () => {
  const withInsert = (): CatalogState => ({ ...baseState(), items: [{ id: 'inv_ri', name: "Vinyl, Rail Insert, 8'", unitCost: 8.15, category: 'Vinyl White', status: 'active' } as InvItem, { id: 'inv_wr', name: '*Vinyl, White, Rivet, 1"', unitCost: 0.12, category: 'Vinyl White', status: 'active' } as InvItem] })
  const quote = (plan: ReturnType<typeof planVinylColor>) => {
    const cfg = estimateConfig({ fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog } as any)
    setMaterialPriceSource(priceSourceFromMap(Object.fromEntries(plan.state.items.map((i: InvItem) => [i.name, i.unitCost]))))
    setSavedKitSets(() => plan.state.kits)
    const style = resolveFenceStyles(cfg.fenceStyles, cfg.fenceCatalog!).find(s => s.name === 'vinyl/privacy/6/chai-gray/nd/8')!
    return calculateQuote({
      style, runs: [{ ft: 50, rail: 'auto' }, { ft: 50, rail: 'auto' }], corners: 2, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer!,
    })
  }

  test('the 8 ft rail stiffener is White\'s rail insert: not made again, not repriced, $0 inside the section kit', () => {
    const plan = planVinylColor(withInsert(), CHAI_GRAY, opts)
    expect(plan.created.items.map(i => i.name)).not.toContain("Vinyl, Rail Insert, 8'")
    expect(plan.created.items.map(i => i.name)).not.toContain('*Vinyl, Chai Gray, Rail Stiffener')
    expect(plan.priced.map(p => p.name)).not.toContain("Vinyl, Rail Insert, 8'")
    expect(plan.state.items.find(i => i.name === "Vinyl, Rail Insert, 8'")!.unitCost).toBe(8.15)
    const calc = quote(plan)
    expect(calc.materials.items.filter(i => i.item === "Vinyl, Rail Insert, 8'")).toEqual([expect.objectContaining({ qty: 15, unitCost: 0, total: 0 })])
    setMaterialPriceSource(null); setSavedKitSets(() => [])
  })

  test('rivets: White by default; another color makes its item at the price typed and swaps every rivet line', () => {
    expect(formProblems({ ...CHAI_GRAY, rivets: { color: 'Black', cents: null } })).toEqual(['Enter the rivet cost (each).'])
    expect(formProblems({ ...CHAI_GRAY, rivets: { color: ' ', cents: 60 } })).toEqual(['Type the rivet color, or keep White rivets.'])
    // A test price only (Jonathan: black rivets cost about 5 times White's).
    const plan = planVinylColor(withInsert(), { ...CHAI_GRAY, rivets: { color: 'Black', cents: 60 } }, opts)
    expect(plan.created.items).toContainEqual(expect.objectContaining({ name: '*Vinyl, Black, Rivet, 1"', cents: 60 }))
    for (const k of plan.state.kits.filter(k => /chai-gray/.test(k.styleName))) {
      const parts = Object.values(k.kits).flat().map(p => p!.part)
      expect(parts).not.toContain('*Vinyl, White, Rivet, 1"')
      expect(parts).toContain('*Vinyl, Black, Rivet, 1"')
    }
    const calc = quote(plan)
    expect(calc.materials.items.filter(i => /White/.test(i.item))).toEqual([])
    expect(calc.materials.items.find(i => i.item === '*Vinyl, Black, Rivet, 1"')).toMatchObject({ unitCost: 0.6 })
    // The White fences keep White rivets.
    expect(Object.values(kitOf(white('6x8', 'nd'), plan.state.kits).kits).flat().map(p => p!.part)).toContain('*Vinyl, White, Rivet, 1"')
    // The edit form reads it back.
    expect(inputFromColor(plan.state, plan.key)!.rivets).toEqual({ color: 'Black', cents: 60 })
    setMaterialPriceSource(null); setSavedKitSets(() => [])
  })
})

describe('an 8 ft tall color (Jonathan, Oct 21, 2026): the same shape as White, priced by the piece', () => {
  const GRAY8: VinylColorInput = {
    ...CHAI_GRAY, sizes: ['6x8', '8x8'], posts: { '6': { allCents: 3892 }, '8': { allCents: 6500 } }, gate8Cents: 45000,
    sections: { ...CHAI_GRAY.sections, '8x8': { costCents: 41250 } },
  }

  test('the form asks one 8 ft post price and an 8x8 section price, not what the section includes', () => {
    expect(formProblems(GRAY8)).toEqual([])
    expect(formProblems({ ...GRAY8, posts: { ...GRAY8.posts, '8': {} } })).toEqual(['Enter the post price (8 ft tall).'])
    expect(formProblems({ ...GRAY8, sections: { ...GRAY8.sections, '8x8': { costCents: null } } })).toEqual(['Enter the 8x8 section price.'])
  })

  test('kits, catalog items at $0, the fences\' own prices, a quote, and the edit form', () => {
    const plan = planVinylColor(baseState(), GRAY8, opts)
    for (const m of ['nd', 'ds'] as const) {
      const name = `vinyl/privacy/8/chai-gray/${m}/8`
      const w = kitOf(white('8x8', m), [])
      const c = kitOf(name, plan.state.kits)
      expect(kitLineCounts(c), name).toEqual(kitLineCounts(w))
      expect(Object.fromEntries(c.kits.section!.map(p => [p.part, p.qty]))).toEqual({
        "*Vinyl, Chai Gray, Rail, 8'": 2, "*Vinyl, Chai Gray, Mid Rail, 8'": 1, "*Vinyl, Chai Gray, Picket, 4'": 30, "*Vinyl, Chai Gray, U Channel, 4'": 4, "Vinyl, Rail Insert, 8'": 2,
      })
      expect(c.kits.end!.map(p => p.part)).toContain('*Vinyl, Chai Gray, Post, 5" x 5", 8\' Privacy')
      // The gate is bought whole, as White's.
      expect(c.kits.walkGate!.map(p => p.part)).toContain('*Vinyl, Chai Gray, Gate, 8 x 4')
      expect(plan.state.fenceStyles.find(s => s.name === name)!.pieceCents).toEqual({ section: 41250, post: 6500, pricedOn: '2026-10-21' })
    }
    expect(plan.tallPrices.map(t => [t.name, t.sectionCents, t.postCents])).toEqual([['vinyl/privacy/8/chai-gray/nd/8', 41250, 6500], ['vinyl/privacy/8/chai-gray/ds/8', 41250, 6500]])
    // Its own new parts: catalog items at $0, included in the 8 ft tall section or post price; no 8x8 section item.
    const made = Object.fromEntries(plan.created.items.map(i => [i.name, i]))
    for (const n of ["*Vinyl, Chai Gray, Mid Rail, 8'", "*Vinyl, Chai Gray, Picket, 4'", "*Vinyl, Chai Gray, U Channel, 4'"]) expect(made[n], n).toMatchObject({ cents: null, includedIn: '8 ft tall section price' })
    expect(made['*Vinyl, Chai Gray, Post, 5" x 5", 8\' Privacy']).toMatchObject({ cents: null, includedIn: '8 ft tall post price' })
    expect(Object.keys(made).some(n => /Section, 8x8/.test(n))).toBe(false)
    expect(plan.priced.map(p => p.name)).not.toContain("*Vinyl, Chai Gray, Picket, 4'")

    // A quote: the section and post prices, every part at $0.
    const cfg = estimateConfig({ fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog } as any)
    setMaterialPriceSource(priceSourceFromMap(Object.fromEntries(plan.state.items.map((i: InvItem) => [i.name, i.unitCost]))))
    setSavedKitSets(() => plan.state.kits)
    const style = resolveFenceStyles(cfg.fenceStyles, cfg.fenceCatalog!).find(s => s.name === 'vinyl/privacy/8/chai-gray/nd/8')!
    expect(style.held).toBeUndefined()
    const calc = calculateQuote({
      style, runs: [{ ft: 48, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer!,
    })
    const pieces = Object.fromEntries(calc.materials.items.filter(i => i.jobLotPiece).map(i => [i.item, [i.qty, i.unitCost]]))
    expect(pieces).toEqual({ '8 ft tall Chai Gray: section, 8 ft wide': [6, 412.5], '8 ft tall Chai Gray: end post': [2, 65], '8 ft tall Chai Gray: line post': [5, 65] })
    expect(calc.materials.items.filter(i => !i.jobLotPiece).every(i => i.total === 0)).toBe(true)
    expect(calc.materials.items.find(i => i.item === "*Vinyl, Chai Gray, Picket, 4'")).toMatchObject({ qty: 180, unitCost: 0 })
    // With no prices it is not available for quoting.
    const bare = plan.state.fenceStyles.map(s => (s.name === 'vinyl/privacy/8/chai-gray/nd/8' ? { ...s, pieceCents: undefined } : s))
    const held = resolveFenceStyles(estimateConfig({ fenceStyles: bare, fenceCatalog: plan.state.fenceCatalog } as any).fenceStyles, plan.state.fenceCatalog).find(s => s.name === 'vinyl/privacy/8/chai-gray/nd/8')!
    expect(held.held).toMatch(/8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl/)
    setMaterialPriceSource(null); setSavedKitSets(() => [])

    // The edit form reads the prices back; a changed price is set on both fences, dated.
    const filled = inputFromColor(plan.state, plan.key)!
    expect(filled.posts['8']).toEqual({ allCents: 6500 })
    expect(filled.sections['8x8']).toEqual({ costCents: 41250 })
    const edit = planVinylColor(plan.state, { ...filled, sections: { ...filled.sections, '8x8': { costCents: 43000 } } }, { ...opts, today: '2026-11-02', key: plan.key })
    expect(edit.tallPrices.map(t => [t.sectionCents, t.prevSectionCents])).toEqual([[43000, 41250], [43000, 41250]])
    expect(edit.state.fenceStyles.find(s => s.name === 'vinyl/privacy/8/chai-gray/ds/8')!.pieceCents).toEqual({ section: 43000, post: 6500, pricedOn: '2026-11-02' })
    expect(edit.message).toMatch(/8 ft tall section and post prices set on 2 fences/)
  })
})

describe('undo, edit, remove (pure)', () => {
  test('undo leaves Settings, Inventory and kits exactly as before', () => {
    const st = baseState()
    st.items = [{ id: 'x1', name: 'Something else', unitCost: 2 }]
    st.kits = [{ id: 'k1', name: 'Saved', styleName: "WV-ND 6'x6' Privacy", kits: {}, roundUp: [] }]
    const before = clone(st)
    const plan = planVinylColor(st, CHAI_GRAY, opts)
    const back = planUndoVinylColor(plan.state, plan.key)
    expect(back.state).toEqual(before)
    expect(back.items.length).toBe(plan.created.items.length)
    expect(back.styles.sort()).toEqual(plan.created.styles.map(s => s.name).sort())
  })

  test('an edit writes new costs only for what changed, keeps the fences, and the form fills in from the color', () => {
    const plan = planVinylColor(baseState(), CHAI_GRAY, opts)
    const filled = inputFromColor(plan.state, plan.key)!
    expect(filled).toMatchObject({ name: 'Chai Gray', mode: 'section', sizes: ['6x8'], methods: ['nd', 'ds'], samePostPrice: true, capCents: 386, uprightCents: 1336 })
    expect(filled.posts['6']!.allCents).toBe(3892)
    expect(filled.sections['6x8']).toMatchObject({ costCents: 18400, pickets: 15, picketStiffeners: 3 })
    const edit = planVinylColor(plan.state, { ...filled, sections: { '6x8': { ...filled.sections['6x8']!, costCents: 19150 } } }, { ...opts, today: '2026-11-02', key: plan.key })
    expect(edit.priced).toEqual([expect.objectContaining({ name: '*Vinyl, Chai Gray, Section, 6x8', cents: 19150, prevCents: 18400 })])
    expect(edit.created.styles).toEqual([])
    expect(edit.state.fenceStyles).toEqual(plan.state.fenceStyles)
    expect(edit.state.items.find(i => i.name === '*Vinyl, Chai Gray, Section, 6x8')).toMatchObject({ unitCost: 191.5, priceUpdatedAt: '2026-11-02' })
  })

  test('remove archives the color, its fences and catalog items; restore brings them back', () => {
    const plan = planVinylColor(baseState(), CHAI_GRAY, opts)
    const off = planArchiveVinylColor(plan.state, plan.key, true)
    expect(off.styles.length).toBe(2)
    expect(off.state.fenceStyles.filter(s => s.choices?.color === 'chai-gray').every(s => s.isActive === false)).toBe(true)
    expect(off.state.items.filter(i => i.madeFor === 'vinyl:color:chai-gray').every(i => i.status === 'archived')).toBe(true)
    const on = planArchiveVinylColor(off.state, plan.key, false)
    expect(on.state).toEqual(plan.state)
  })
})
