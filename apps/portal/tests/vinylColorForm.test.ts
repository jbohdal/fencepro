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
        posts: { '6': { cornerCents: 3000, endCents: 3100, lineCents: 3200, blankCents: 3300 }, '8': { cornerCents: 4000, endCents: 4100, lineCents: 4200 } },
        capCents: 300, uprightCents: 1200, gate8Cents: 40000,
        sections: {
          '6x6': { costCents: 15000, pickets: 11, rails: 2, railFt: 6, picketStiffeners: 0, railStiffeners: 0, uChannels: 2 },
          '6x8': { costCents: 18000, pickets: 15, rails: 2, railFt: 8, picketStiffeners: 0, railStiffeners: 1, uChannels: 2 },
          '8x6': { costCents: 20000, pickets: 11, rails: 3, railFt: 6, picketStiffeners: 0, railStiffeners: 0, uChannels: 2 },
          '8x8': { costCents: 24000, pickets: 15, rails: 3, railFt: 8, picketStiffeners: 0, railStiffeners: 1, uChannels: 2 },
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
      // rail stiffener (White's insert), truss screws, and 3 picket stiffeners White has no line for (6).
      expect(cc.section).toBe(w.section! + 1)
      expect(c.kits.section).toEqual([
        { part: '*Vinyl, Chai Gray, Picket', qty: 15, fallbackCost: 0 },
        { part: "*Vinyl, Chai Gray, Rail, 8'", qty: 2, fallbackCost: 0 },
        { part: '*Vinyl, Chai Gray, Picket Stiffener', qty: 3, fallbackCost: 0 },
        { part: '*Vinyl, Chai Gray, Rail Stiffener', qty: 1, fallbackCost: 0 },
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
    for (const [part, qty] of [['*Vinyl, Chai Gray, Picket', 225], ["*Vinyl, Chai Gray, Rail, 8'", 30], ['*Vinyl, Chai Gray, Picket Stiffener', 45], ['*Vinyl, Chai Gray, Rail Stiffener', 15], ['*Vinyl, Chai Gray, U Channel', 30]] as const) {
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
