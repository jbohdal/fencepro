/**
 * Chain link gates and their hardware follow the takeoff sheet (TAKEOFF_RULES.md;
 * Jonathan, Oct 26, 2026: "Chain link: follow the sheet (gate leaf sizes, e.g.
 * 10 ft double gate = 2 × 4'x5', and the hardware counts)"; docs/DECISIONS.md).
 *
 * Sheet rows pinned here (TAKEOFF_RULES.md, chain link):
 *   Chainlink, {Galv|Black}, Gate, 1-3/8", {h}' x {w}'   1*addOnQty("Walk Gate - {w}'") + 2*addOnQty("Dbl Gate - {2w}'")
 *   {G|Black}, Hinge, Female, 1-3/8" x 5/8"             2 per walk gate + 6 per double gate
 *   {G|Black}, Hinge, Male, 2-3/8"                      2 per walk gate + 4 per double gate
 *   {G|Black}, Fork, PS, 1-3/8"                         anyAddOn(double gates)   once per job
 *   {G|Black}, Fork, PS, 2-1/2"                         anyAddOn(walk gates)     once per job
 *   {G|Black}, Collar, PS, 1-3/8" (Set of 2)            anyAddOn(every gate)     once per job
 *   G, Drop Rod, 24" (galv) / Drop Rod, 24", Black (4', 5' black) / Drop Rod, 48", Black (6' black)
 *                                                       anyAddOn(double gates)   once per job
 *   Comm, G, Com Drop Rod Assy. (commercial)            anyAddOn(double gates)   once per job
 *   {G|Black}, Bolt, 3/8" x 3" w/ Nut                   2*gateCount (a double gate counts 2)
 *   {G|Black}, Bolt, 3/8" x 2" w/ Nut                   $C$142 / $C$132: unresolved on the sheet, kept as
 *                                                       it was (2 per walk gate) until Jonathan gives the count
 * A typed gate count has no width: walk 4 ft, double 8 ft (two 4 ft leaves), as before.
 */

import { describe, test, expect, afterEach } from 'vitest'
import {
  calculateMaterialsDetailed, legacyCalculateMaterialsDetailed, gateSizes, setMaterialPriceSource,
} from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, kitSetFor, type KitSet } from '../../web/src/materialKits'
import { planChainDigSet, planChainGateKits, oldChainGateKits } from '../../web/src/chainDigSet'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { deriveLayout, gateWidthsOf, layoutForShape, teePostFor } from '../../web/src/yardLayout'
import { priceForStyle } from '../../web/src/widgetPricing'
import { calculateQuote } from '../../web/src/quoteCalc'
import { priceQuoteJob } from '../../web/src/quoteJob'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { priceRepair, priceMove, moveRepairSettings } from '../../web/src/moveRepair'
import type { FenceStyle } from '../../web/src/configStore'

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

const parts = (style: string, walk: number[], dbl: number[], widths = true, legacy = false) => {
  const input = {
    fenceStyle: style, runs: [62, 41], corners: 1, ends: 2 + walk.length * 2 + dbl.length * 2, walkGates: walk.length, dblGates: dbl.length,
    tearOutSections: 0, tearOutGates: 0, ...(widths ? { gateWidths: { walk, dbl } } : {}),
  }
  const r = legacy ? legacyCalculateMaterialsDetailed(input) : calculateMaterialsDetailed(input)
  const m = new Map<string, number>()
  for (const i of r.items) m.set(i.item, (m.get(i.item) ?? 0) + i.qty)
  return Object.assign(m, { warnings: r.warnings })
}

const RES: Array<{ style: string; finish: 'galv' | 'black'; h: 4 | 5 | 6 }> = [4, 5, 6].flatMap(h => [
  { style: `CL - ${h}' Galv`, finish: 'galv' as const, h: h as 4 | 5 | 6 },
  { style: `CL - ${h}' Black`, finish: 'black' as const, h: h as 4 | 5 | 6 },
])
const name = (finish: 'galv' | 'black', p: 'female' | 'male' | 'fork138' | 'fork212' | 'collar' | 'bolt3' | 'bolt2') => {
  const g = finish === 'galv'
  return {
    female: g ? 'G, Hinge, Female, 1-3/8" x 5/8"' : 'Black, Hinge, Female, 1-3/8" x 5/8"',
    male: g ? 'G, Hinge, Male, PS, 2-3/8"' : 'Black, Hinge, Male, 2-3/8"',
    fork138: g ? 'G, Fork, PS, 1-3/8"' : 'Black, Fork, PS, 1-3/8"',
    fork212: g ? 'G, Fork, PS, 2-1/2"' : 'Black, Fork, PS, 2-1/2"',
    collar: g ? 'G, Collar, PS, 1-3/8" (Set of 2)' : 'Black, Collar, PS, 1-3/8" (Set of 2)',
    bolt3: g ? 'G, Bolt, 3/8" x 3" w/ Nut' : 'Black, Bolt, 3/8" x 3" w/ Nut',
    bolt2: g ? 'G, Bolt, 3/8" x 2" w/ Nut' : 'Black, Bolt, 3/8" x 2" w/ Nut',
  }[p]
}
const leaf = (finish: 'galv' | 'black', h: number, w: number) => finish === 'galv'
  ? `Chainlink, Galv, Gate, 1-3/8", ${h}' x ${w}' (.055)` : `Chainlink, Black, Gate, 1-3/8", ${h}' x ${w}' (.065)`
const dropRod = (finish: 'galv' | 'black', h: number) => finish === 'galv' ? 'G, Drop Rod, 24"' : h === 6 ? 'Drop Rod, 48", Black' : 'Drop Rod, 24", Black'

describe('chain link gate leaves by width (sheet rows "Chainlink, ..., Gate, 1-3/8", {h}\' x {w}\'")', () => {
  test('10 ft double gate on 4 ft galvanized = 2 × 4\' x 5\' (Jonathan\'s example)', () => {
    const m = parts("CL - 4' Galv", [], [10])
    expect(m.get(`Chainlink, Galv, Gate, 1-3/8", 4' x 5' (.055)`)).toBe(2)
    expect(m.has(`Chainlink, Galv, Gate, 1-3/8", 4' x 4' (.055)`)).toBe(false)
  })

  test('every height and finish: walk 4/5/6 ft = one leaf that wide, double 8/10/12 ft = two leaves of half', () => {
    for (const { style, finish, h } of RES) {
      for (const [walk, dbl, w] of [[[4], [], 4], [[5], [], 5], [[6], [], 6], [[], [8], 4], [[], [10], 5], [[], [12], 6]] as Array<[number[], number[], number]>) {
        const m = parts(style, walk, dbl)
        expect(m.get(leaf(finish, h, w)), `${style} walk ${walk} dbl ${dbl}`).toBe(walk.length + dbl.length * 2)
        for (const other of [4, 5, 6].filter(x => x !== w)) expect(m.has(leaf(finish, h, other)), `${style} ${other}`).toBe(false)
      }
    }
  })

  test('a typed gate count (no width) keeps a 4 ft walk gate and an 8 ft double gate (two 4 ft leaves)', () => {
    const m = parts("CL - 5' Black", [5], [10], false)
    expect(m.get(leaf('black', 5, 4))).toBe(3)
    expect(gateSizes(1, 1)).toMatchObject({ walk4: 1, dbl8: 1, walk5: 0, dbl10: 0 })
  })

  test('a width the sheet has no row for is priced as the 4 ft / 8 ft gate and named on the quote', () => {
    const m = parts("CL - 4' Galv", [3.5], [14])
    expect(m.get(leaf('galv', 4, 4))).toBe(3)
    expect(m.warnings.join(' ')).toMatch(/No takeoff sheet row for a 3\.5 ft walk gate.*a 14 ft double gate/)
    // Vinyl gates do not go by width: no note there.
    const v = calculateMaterialsDetailed({ fenceStyle: "WV-ND 6'x6' Privacy", runs: [60], corners: 0, ends: 2, walkGates: 1, dblGates: 0, tearOutSections: 0, tearOutGates: 0, gateWidths: { walk: [3.5], dbl: [] } })
    expect(v.warnings.join(' ')).not.toMatch(/takeoff sheet row/)
  })

  test('widths are used only when there is one for every gate', () => {
    expect(gateSizes(2, 0, { walk: [5], dbl: [] })).toMatchObject({ walk4: 2, walk5: 0 })
    expect(gateSizes(1, 1, { walk: [5], dbl: [12] })).toMatchObject({ walk4: 0, walk5: 1, dbl8: 0, dbl12: 1 })
  })
})

describe('chain link gate hardware (sheet rows)', () => {
  test('hinges, forks, collar, drop rod and bolts, every height and finish', () => {
    for (const { style, finish, h } of RES) {
      // 3 walk gates and 3 double gates (gateCount = 3 + 2*3 = 9)
      const m = parts(style, [4, 5, 6], [8, 10, 12])
      expect(m.get(name(finish, 'female')), style).toBe(2 * 3 + 6 * 3)
      expect(m.get(name(finish, 'male')), style).toBe(2 * 3 + 4 * 3)
      expect(m.get(name(finish, 'fork138')), style).toBe(1)
      expect(m.get(name(finish, 'fork212')), style).toBe(1)
      expect(m.get(name(finish, 'collar')), style).toBe(1)
      expect(m.get(dropRod(finish, h)), style).toBe(1)
      expect(m.get(name(finish, 'bolt3')), style).toBe(2 * 9)
      expect(m.get(name(finish, 'bolt2')), style).toBe(2 * 3) // unresolved on the sheet: kept
      // Only walk gates: the 2-1/2" fork and the collar, no 1-3/8" fork, no drop rod.
      const w = parts(style, [4, 4], [])
      expect([w.get(name(finish, 'fork212')), w.get(name(finish, 'collar')), w.get(name(finish, 'fork138')), w.get(dropRod(finish, h))], style).toEqual([1, 1, undefined, undefined])
      // Only a double gate: the 1-3/8" fork, collar and drop rod; no 2-1/2" fork, no 3/8" x 2" bolt.
      const d = parts(style, [], [10])
      expect([d.get(name(finish, 'fork138')), d.get(name(finish, 'collar')), d.get(dropRod(finish, h)), d.get(name(finish, 'fork212')), d.get(name(finish, 'bolt2'))], style)
        .toEqual([1, 1, 1, undefined, undefined])
      expect([d.get(name(finish, 'female')), d.get(name(finish, 'male')), d.get(name(finish, 'bolt3'))], style).toEqual([6, 4, 4])
      // No gates: none of it.
      const none = parts(style, [], [])
      for (const p of ['female', 'male', 'fork138', 'fork212', 'collar', 'bolt3', 'bolt2'] as const) expect(none.has(name(finish, p)), `${style} ${p}`).toBe(false)
    }
  })

  test('commercial: the same hardware rows, the Com drop rod, no gate leaf (the sheet has none)', () => {
    for (const style of ["CL - Com 6'", "CL - Com 6'+1'"]) {
      const m = parts(style, [4], [10])
      expect(m.get('G, Hinge, Female, 1-3/8" x 5/8"'), style).toBe(8)
      expect(m.get('G, Hinge, Male, PS, 2-3/8"'), style).toBe(6)
      expect(m.get('G, Fork, PS, 1-3/8"'), style).toBe(1)
      expect(m.get('G, Fork, PS, 2-1/2"'), style).toBe(1)
      expect(m.get('G, Collar, PS, 1-3/8" (Set of 2)'), style).toBe(1)
      expect(m.get('Comm, G, Com Drop Rod Assy.'), style).toBe(1)
      expect(m.get('G, Bolt, 3/8" x 3" w/ Nut'), style).toBe(6)
      expect([...m.keys()].some(p => /Chainlink, .*Gate, 1-3\/8"/.test(p)), style).toBe(false)
    }
  })

  test('kits give the same parts as the parts list, with widths', () => {
    for (const style of [...RES.map(r => r.style), "CL - Com 6'", "CL - Com 6'+1'"]) {
      expect(builtInKitSet(style)!.mismatch ?? '', style).toBe('')
      for (const [walk, dbl] of [[[5, 6], [12]], [[4], [8, 10]], [[], [12, 12]], [[6], []]] as Array<[number[], number[]]>) {
        const a = parts(style, walk, dbl, true, true), b = parts(style, walk, dbl)
        expect(Object.fromEntries(b), `${style} ${walk} ${dbl}`).toEqual(Object.fromEntries(a))
      }
    }
  })
})

describe('moves and repairs keep the once per job gate parts', () => {
  test('a replaced walk gate brings its collar and 2-1/2" fork; a rehung double gate its 1-3/8" fork', () => {
    const cfg = estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { overheadPct: 30 } } as any)
    const s = cfg.fenceStyles.find(x => x.name === "CL - 4' Galv")!
    const common = { style: s, pricing: cfg.pricing, settings: moveRepairSettings(null), overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0 }
    const qty = (r: { pullSheet: Array<{ item: string; qty: number }> }, p: string) => r.pullSheet.filter(i => i.item === p).reduce((t, i) => t + i.qty, 0)
    const rep = priceRepair(common, { what: 'storm', items: { replaceGate: 2 }, postType: 'nd', newPostCaps: false, gateKind: 'walk', debrisCleared: true })
    expect([qty(rep, leaf('galv', 4, 4)), qty(rep, 'G, Collar, PS, 1-3/8" (Set of 2)'), qty(rep, 'G, Fork, PS, 2-1/2"'), qty(rep, 'G, Hinge, Female, 1-3/8" x 5/8"')]).toEqual([2, 1, 1, 4])
    const re = priceRepair(common, { what: 'storm', items: { rehangGate: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'double', debrisCleared: true })
    expect([qty(re, 'G, Fork, PS, 1-3/8"'), qty(re, 'G, Hinge, Female, 1-3/8" x 5/8"'), qty(re, 'G, Collar, PS, 1-3/8" (Set of 2)')]).toEqual([1, 6, 0])
    const mv = priceMove(common, { oldFt: 100, oldWalkGates: 1, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false }, { runs: [100], corners: 0, ends: 4, walkGates: 1, dblGates: 0 })
    expect(qty(mv, 'G, Fork, PS, 2-1/2"')).toBe(1)
  })
})

describe('gate widths reach the quote', () => {
  const yard = () => {
    const y = layoutForShape('backyard')
    const len = [180, 600, 900, 600, 180]
    y.sides.forEach((s, i) => { s.lengthIn = len[i] })
    y.sides[1].gate = { type: 'walk', widthIn: 60, position: 'middle' }
    y.sides[2].gate = { type: 'double', widthIn: 120, position: 'middle' }
    return y
  }

  test('the drawing lists each gate width in feet', () => {
    const d = deriveLayout(yard(), 120)
    expect(d.walkGates).toBe(1)
    expect(d.dblGates).toBe(1)
    expect(d.gateWidthsFt).toEqual({ walk: [5], dbl: [10] })
    expect(gateWidthsOf(yard())).toEqual({ walk: [5], dbl: [10] })
    expect(gateWidthsOf(null)).toBeNull()
  })

  test('the quote builder and the server price a 10 ft double gate as two 4\' x 5\' leaves', () => {
    const cfg = estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { overheadPct: 30 } } as any)
    const style = cfg.fenceStyles.find(s => s.name === "CL - 4' Galv")!
    const d = deriveLayout(yard(), 120)
    const base = {
      runs: d.runs.map(r => ({ ft: r.ft, rail: 'auto' as const })), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {},
    }
    const q = calculateQuote({ ...base, style, gateWidths: d.gateWidthsFt, pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS })
    const get = (items: Array<{ item: string; qty: number }>, p: string) => items.filter(i => i.item === p).reduce((t, i) => t + i.qty, 0)
    expect(get(q.materials.items, leaf('galv', 4, 5))).toBe(3)
    expect(get(q.materials.items, leaf('galv', 4, 4))).toBe(0)
    // The server (phone quotes, change orders): from the saved drawing when no widths are sent.
    const job = priceQuoteJob(cfg, { ...base, fenceStyle: style.name, yard: yard(), jobType: 'new' } as any, 30)
    expect(get(job.calc.materials.items, leaf('galv', 4, 5))).toBe(3)
  })

  test('the website quote prices the drawn gate widths, the same price as the quote builder', () => {
    // e2e/widget-price-match.mjs found the website $18 to $121 under the builder on chain link (Oct 26, 2026):
    // its request left the gate widths out, so a 10 ft double gate was priced as two 4 ft leaves.
    const cfg = estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { overheadPct: 30 } } as any)
    const style = cfg.fenceStyles.find(s => s.name === "CL - 4' Galv")!
    const w = priceForStyle(cfg, 30, yard(), style)
    expect(w.req.gateWidths).toEqual({ walk: [5], dbl: [10] })
    const get = (items: Array<{ item: string; qty: number }>, p: string) => items.filter(i => i.item === p).reduce((t, i) => t + i.qty, 0)
    expect(get(w.job.calc.materials.items, leaf('galv', 4, 5))).toBe(3)
    // What the builder prices when it opens the saved quote: the same request read from the drawing.
    const d = deriveLayout(yard(), 120, { teeAs: teePostFor(style) })
    const builder = priceQuoteJob(cfg, { ...w.req, gateWidths: d.gateWidthsFt, corners: d.corners, ends: d.ends } as any, 30)
    expect(w.price).toBe(Math.round(builder.totals.price * 100) / 100)
    const typed = priceQuoteJob(cfg, { ...w.req, gateWidths: null } as any, 30)
    expect(w.job.totals.price).toBeGreaterThan(typed.totals.price)
  })
})

describe('saved chain link dig set kits take the sheet\'s gate kits (lib/chainGateKits.ts)', () => {
  const stateWithOldGates = () => {
    const st = planChainDigSet({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)) as FenceStyle[], items: [], kits: [] }).state
    // As saved on Oct 19, 2026: the no dig gate kits of the time.
    for (const set of st.kits) {
      const style = st.fenceStyles.find(s => s.name === set.styleName)!
      const old = oldChainGateKits(style.choices!.finish as 'galv' | 'black', Number(style.choices!.height))
      for (const k of ['walkGate5', 'walkGate6', 'dblGate10', 'dblGate12', 'anyGate', 'anyWalkGate', 'anyDblGate'] as const) delete set.kits[k]
      set.kits.walkGate = old.walkGate.map(([part, qty]) => ({ part, qty, fallbackCost: 1 }))
      set.kits.dblGate = old.dblGate.map(([part, qty]) => ({ part, qty, fallbackCost: 1 }))
    }
    return st
  }

  test('every dig set twin gets its no dig style\'s gate kits; an edited one is left; once is enough', () => {
    const st = stateWithOldGates()
    expect(st.kits.length).toBe(6)
    // One edited by hand: left as it is.
    st.kits[0].kits.walkGate![1].qty = 3
    const plan = planChainGateKits({ fenceStyles: st.fenceStyles, items: [], kits: st.kits })
    expect(plan.updated.length).toBe(5)
    expect(plan.skipped).toEqual([`${st.kits[0].name}: its gate kits were edited, left as they are`])
    for (const set of plan.state.kits.slice(1)) {
      const style = plan.state.fenceStyles.find(s => s.name === set.styleName)!
      const nd = kitSetFor(style.madeFrom!, []) as KitSet
      for (const k of ['walkGate', 'dblGate', 'walkGate5', 'walkGate6', 'dblGate10', 'dblGate12', 'anyGate', 'anyWalkGate', 'anyDblGate'] as const) {
        expect(set.kits[k], `${set.name} ${k}`).toEqual(nd.kits[k])
      }
      // Post kits (dig set pipe and concrete) untouched.
      expect(set.kits.corner).toEqual(st.kits.find(s => s.name === set.name)!.kits.corner)
    }
    const again = planChainGateKits({ fenceStyles: plan.state.fenceStyles, items: [], kits: plan.state.kits })
    expect(again.updated).toEqual([])
  })

  test('the dig set twin then prices gates like its no dig style', () => {
    const st = planChainGateKits({ ...(({ fenceStyles, kits }) => ({ fenceStyles, kits }))(stateWithOldGates()), items: [] }).state
    setSavedKitSets(() => st.kits as KitSet[])
    const twin = st.fenceStyles.find(s => s.madeFrom === "CL - 4' Galv")!
    const r = calculateMaterialsDetailed({ fenceStyle: twin.name, runs: [62, 41], corners: 1, ends: 4, walkGates: 0, dblGates: 1, tearOutSections: 0, tearOutGates: 0, sectionWidth: 10, gateWidths: { walk: [], dbl: [10] } })
    const m = new Map(r.items.map(i => [i.item, i.qty]))
    expect(m.get(leaf('galv', 4, 5))).toBe(2)
    expect(m.get('G, Hinge, Female, 1-3/8" x 5/8"')).toBe(6)
    expect(m.get('G, Drop Rod, 24"')).toBe(1)
  })
})
