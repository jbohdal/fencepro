/**
 * Chain link hook ties and dig set post names (Jonathan, Oct 2026).
 *
 *   - Hook ties are counted per section: 3 on the line post at 4 ft plus 1 for
 *     every foot of extra height, plus 6 on the top rail = 9 / 10 / 11 per
 *     section at 4 / 5 / 6 ft. Boxes of 100, rounded up once per job. New
 *     quotes, moves (reinstalled sections) and repairs (replaced or repaired
 *     sections). Commercial keeps its own count.
 *   - The 12 dig set post parts get "0.055 wall" and the diameter of the no dig
 *     post they replace; every kit line follows the rename; dig set stays not
 *     available for quoting until priced; half a bag of concrete per post is
 *     a kit line, rounded up per job.
 */

import { describe, test, expect, afterEach } from 'vitest'
import fs from 'fs'
import { DEFAULT_CATALOG, materialOf, type FenceCatalog } from '../../web/src/fenceCatalog'
import { planChainDigSet, planChainDigSetPipesAndTies } from '../../web/src/chainDigSet'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, inventoryPriceSource, legacyCalculateMaterialsDetailed, calculateMaterialsDetailed, chainHookTiesPerSection } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, countsFor, linesFromKitSet, KIT_KINDS, type KitSet } from '../../web/src/materialKits'
import { isQuotable } from '../../web/src/styleAvailability'
import { priceRepair, priceMove, moveRepairSettings, repairPartChoices } from '../../web/src/moveRepair'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import type { FenceStyle } from '../../web/src/configStore'

const prices: Record<string, number> = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const items = () => Object.entries(prices).map(([name, unitCost], i) => ({ id: `fx${i}`, name, unitCost, category: 'Fixture' }))
const STYLES: FenceStyle[] = JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES))
const GALV_TIE = 'Chainlink, Galv, Hardware, Hook Ties, 6-1/2" x 9ga (100)'
const BLACK_TIE = 'Chainlink, Black, Hardware, Hook Ties, 6-1/2" x 9ga, AL (100)'
const RES = ["CL - 4' Galv", "CL - 5' Galv", "CL - 6' Galv", "CL - 4' Black", "CL - 5' Black", "CL - 6' Black"]
const heightOf = (n: string) => Number(n.match(/(\d)'/)![1])
const tieOf = (n: string) => (/Black/.test(n) ? BLACK_TIE : GALV_TIE)
const job = (fenceStyle: string, runs: number[], corners = 0, ends = 2) => ({ fenceStyle, runs, corners, ends, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 })
const qtyOf = (r: { items: Array<{ item: string; qty: number }> }, part: string) => r.items.filter(i => i.item === part).reduce((t, i) => t + i.qty, 0)

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

function use(st: { fenceStyles: FenceStyle[]; fenceCatalog?: FenceCatalog | null; items: any[]; kits: any[] }) {
  setMaterialPriceSource(inventoryPriceSource(st.items))
  setSavedKitSets(() => st.kits)
  return estimateConfig({ fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog ?? undefined, pricing: { overheadPct: 30 } } as any)
}

describe('chain link hook ties per section', () => {
  test('9, 10 and 11 ties per section at 4, 5 and 6 ft', () => {
    expect([4, 5, 6].map(chainHookTiesPerSection)).toEqual([9, 10, 11])
  })

  test('the built in kits carry the ties in the section kit only, boxes of 100 rounded up once per job', () => {
    for (const name of RES) {
      const kit = builtInKitSet(name)!
      expect(kit.mismatch, name).toBeUndefined()
      const h = heightOf(name)
      const tie = tieOf(name)
      for (const k of KIT_KINDS) {
        const q = kit.kits[k]?.find(p => p.part === tie)?.qty
        expect(q, `${name} ${k} kit`).toBe(k === 'section' ? (h + 5) / 100 : undefined)
      }
      expect(kit.roundUp, name).toContain(tie)
    }
  })

  test('a 100 ft run at 4 ft: 10 sections, 90 ties, 1 box; the same from the old parts list and the kits', () => {
    const r = calculateMaterialsDetailed(job("CL - 4' Galv", [100]))
    expect(qtyOf(r, GALV_TIE)).toBe(1)
    expect(qtyOf(legacyCalculateMaterialsDetailed(job("CL - 4' Galv", [100])), GALV_TIE)).toBe(1)
    // Sections per run, 10 ft max: 37 + 120 + 52 ft = 4 + 12 + 6 = 22 sections.
    for (const name of RES) {
      const h = heightOf(name)
      const counts = countsFor(name, [37, 120, 52], { corners: 2, ends: 2, walkGates: 0, dblGates: 0 })
      expect(counts.section).toBe(22)
      const boxes = Math.ceil(22 * (h + 5) / 100) // 198, 220, 242 ties → 2, 3, 3 boxes
      expect(linesFromKitSet(builtInKitSet(name)!, counts).find(l => l.part === tieOf(name))?.qty, name).toBe(boxes)
      expect(qtyOf(calculateMaterialsDetailed(job(name, [37, 120, 52], 2, 2)), tieOf(name)), name).toBe(boxes)
    }
    // 111 ft at 6 ft: 12 sections × 11 = 132 ties → 2 boxes (was ceil((555 + 11 × 5) / 100) = 7).
    expect(qtyOf(calculateMaterialsDetailed(job("CL - 6' Black", [111])), BLACK_TIE)).toBe(2)
  })

  test('commercial chain link keeps its own count (5 per foot + 5 per line post)', () => {
    const r = legacyCalculateMaterialsDetailed(job("CL - Com 6'", [100]))
    // 100 ft at 10 ft sections: 9 line posts; ceil((500 + 45) / 100) = 6 boxes.
    expect(qtyOf(r, 'Chainlink, Galv, Hardware, Hook Ties, 8-1/4" x 9ga, AL (100)')).toBe(6)
  })

  test('moves: new ties on every reinstalled section; repairs: ties on repaired and replaced sections, none on a replaced post', () => {
    const cfg = use({ fenceStyles: STYLES, items: items(), kits: [] })
    const s = cfg.fenceStyles.find(x => x.name === "CL - 6' Galv")!
    const common = { style: s, pricing: cfg.pricing, settings: moveRepairSettings(null), overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0 }
    // 120 ft moved to a 120 ft line: 12 reinstalled sections × 11 = 132 ties → 2 boxes.
    const mv = priceMove(common, { oldFt: 120, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false, damagePct: 0 }, { runs: [120], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })
    const hw = mv.lines.find(l => l.key === 'hardware')!
    expect(hw.label).toBe('New ties and hog rings')
    expect(hw.parts!.find(p => p.item === GALV_TIE)?.qty).toBe(2)
    expect(mv.lines.find(l => l.key === 'newPosts')!.parts!.some(p => p.item === GALV_TIE)).toBe(false)
    // 50 ft: 5 sections × 11 = 55 → 1 box.
    const small = priceMove(common, { oldFt: 50, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false, damagePct: 0 }, { runs: [50], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })
    expect(small.lines.find(l => l.key === 'hardware')!.parts!.find(p => p.item === GALV_TIE)?.qty).toBe(1)

    expect(repairPartChoices(s).find(p => p.part === GALV_TIE)?.qty).toBe(0.11)
    const rep = priceRepair(common, { what: 'other', items: { repairSection: 2, replaceSection: 10, replacePost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' })
    expect(rep.lines.find(l => l.key === 'repairSection:parts')!.parts!.find(p => p.item === GALV_TIE)?.qty).toBe(1) // 22 ties
    expect(rep.lines.find(l => l.key === 'replaceSection:parts')!.parts!.find(p => p.item === GALV_TIE)?.qty).toBe(2) // 110 ties
    expect(rep.lines.find(l => l.key === 'replacePost:post')!.parts!.some(p => p.item === GALV_TIE)).toBe(false)
  })
})

/** A company as live and dev were before this change: dig set parts with no size, dig set kits on the old tie count. */
function oldState() {
  const tree: FenceCatalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG))
  const st = planChainDigSet({ fenceStyles: JSON.parse(JSON.stringify(STYLES)), fenceCatalog: tree, items: items(), kits: [] }).state
  const old = (n: string) => n.replace(/^(DS, Pipe, \w+, (?:Line|Terminal) Post), [^,]+ 0\.055 wall, /, '$1, ')
  for (const i of st.items) i.name = old(i.name)
  for (const k of st.kits) {
    const h = Number(k.styleName!.split('/')[1])
    for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) p.part = old(p.part)
    const tie = /black/.test(k.styleName!) ? BLACK_TIE : GALV_TIE
    k.kits.section = k.kits.section!.filter(p => p.part !== tie)
    k.kits.perFoot!.push({ part: tie, qty: 0.05, fallbackCost: 11 })
    k.kits.line!.splice(1, 0, { part: tie, qty: (h - 1) / 100, fallbackCost: 11 })
  }
  return { fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog, items: st.items, kits: st.kits as KitSet[] }
}

describe('dig set post names and saved kits', () => {
  test('the 12 parts get 0.055 wall and the no dig diameter; ids, prices and every kit line follow; ties move to the section kit', () => {
    const st = oldState()
    expect(st.items.filter(i => /^DS, Pipe, /.test(i.name)).map(i => i.name)).toContain("DS, Pipe, Galv, Line Post, 4' Chain Link")
    const ids = new Map(st.items.map(i => [i.id, i.name]))
    const plan = planChainDigSetPipesAndTies(st)
    expect(plan.skipped).toEqual([])
    expect(plan.renamed).toHaveLength(12)
    expect(plan.renamed.map(r => r.to).sort()).toEqual(['4', '5', '6'].flatMap(h => ['Galv', 'Blk'].flatMap(f => [
      `DS, Pipe, ${f}, Line Post, 1-5/8" 0.055 wall, ${h}' Chain Link`, `DS, Pipe, ${f}, Terminal Post, 2-1/2" 0.055 wall, ${h}' Chain Link`,
    ])).sort())
    // Same ids, still unpriced.
    for (const r of plan.renamed) {
      const it = plan.state.items.find(i => i.name === r.to)!
      expect(ids.get(it.id)).toBe(r.from)
      expect(it.unitCost).toBe(0)
    }
    // Every kit line names a part that is in Inventory; no old name left.
    const names = new Set(plan.state.items.map(i => i.name))
    for (const k of plan.state.kits) for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) {
      expect(names.has(p.part) || /Concrete/.test(p.part) || !/^DS, /.test(p.part), p.part).toBe(true)
      expect(p.part).not.toMatch(/^DS, Pipe, \w+, (Line|Terminal) Post, \d' Chain Link$/)
    }
    // One pipe line in each of the line, corner and end kits of the 6 dig set kits.
    expect(plan.kitLines).toHaveLength(18)
    // Ties now per section, the same as the built in kits.
    expect(plan.ties.sort()).toEqual(['chain/4/black/res/ds', 'chain/4/galv/res/ds', 'chain/5/black/res/ds', 'chain/5/galv/res/ds', 'chain/6/black/res/ds', 'chain/6/galv/res/ds'])
    for (const k of plan.state.kits) {
      const h = Number(k.styleName!.split('/')[1])
      const tie = /black/.test(k.styleName!) ? BLACK_TIE : GALV_TIE
      expect(k.kits.section!.find(p => p.part === tie)?.qty).toBe((h + 5) / 100)
      expect(k.kits.perFoot!.some(p => p.part === tie)).toBe(false)
      expect(k.kits.line!.some(p => p.part === tie)).toBe(false)
      // Half a bag of concrete per post, as a kit line, rounded up per job.
      for (const kind of ['line', 'corner', 'end'] as const) expect(k.kits[kind]!.find(p => p.part === 'Misc, Concrete')?.qty).toBe(0.5)
      expect(k.roundUp).toContain('Misc, Concrete')
    }
    // Run once: nothing more the second time.
    const again = planChainDigSetPipesAndTies(plan.state)
    expect([again.renamed, again.kitLines, again.ties, again.skipped]).toEqual([[], [], [], []])
  })

  test('after the rename: dig set still not available for quoting until priced, then priced with the new names', () => {
    const plan = planChainDigSetPipesAndTies(oldState())
    let cfg = use(plan.state)
    const ds = cfg.fenceStyles.find(s => s.name === 'chain/4/galv/res/ds')!
    expect(isQuotable(ds)).toBe(false)
    expect(ds.held).toBe('Dig set is waiting for prices on 2 parts in Inventory')
    const priced = plan.state.items.map(i => (/^DS, Pipe, Galv, .*, 4' Chain Link$/.test(i.name) ? { ...i, unitCost: 12.5 } : i))
    cfg = use({ ...plan.state, items: priced })
    const style = cfg.fenceStyles.find(s => s.name === 'chain/4/galv/res/ds')!
    expect(isQuotable(style)).toBe(true)
    const input: QuoteCalcInput = {
      style, runs: [100].map(ft => ({ ft, rail: 'auto' as const })), corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, overrides: {}, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    }
    const q = calculateQuote(input)
    expect(q.materials.items.find(i => i.item === `DS, Pipe, Galv, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`)?.qty).toBe(9)
    expect(q.materials.items.find(i => i.item === `DS, Pipe, Galv, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`)?.qty).toBe(2)
    expect(q.materials.items.find(i => i.item === GALV_TIE)?.qty).toBe(1)
    // 9 line + 2 end posts × 0.5 = 5.5 → 6 bags.
    expect(q.materials.items.find(i => i.item === 'Misc, Concrete')?.qty).toBe(6)
  })

  test('a saved kit whose ties were edited is left as it is; commercial and other styles are not touched', () => {
    const st = oldState()
    const k = st.kits.find(x => x.styleName === 'chain/5/galv/res/ds')!
    k.kits.perFoot!.find(p => p.part === GALV_TIE)!.qty = 0.06
    const com = { ...JSON.parse(JSON.stringify(builtInKitSet("CL - Com 6'"))), id: 'com', builtIn: false }
    st.kits.push(com)
    const plan = planChainDigSetPipesAndTies(st)
    expect(plan.ties).not.toContain('chain/5/galv/res/ds')
    expect(plan.skipped.join(' ')).toMatch(/chain\/5\/galv\/res\/ds: hook ties were edited/)
    expect(plan.state.kits.find(x => x.styleName === 'chain/5/galv/res/ds')!.kits.perFoot!.find(p => p.part === GALV_TIE)?.qty).toBe(0.06)
    expect(plan.state.kits.find(x => x.id === 'com')).toEqual(com)
  })

  test('new companies get the new names straight away (dig set seed)', () => {
    const tree: FenceCatalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG))
    expect(materialOf(tree, 'chain')).toBeTruthy()
    const plan = planChainDigSet({ fenceStyles: JSON.parse(JSON.stringify(STYLES)), fenceCatalog: tree, items: items(), kits: [] })
    expect(plan.items).toContain(`DS, Pipe, Blk, Terminal Post, 2-1/2" 0.055 wall, 6' Chain Link`)
    expect(planChainDigSetPipesAndTies(plan.state).renamed).toEqual([])
    expect(planChainDigSetPipesAndTies(plan.state).ties).toEqual([])
  })
})
