/**
 * Chain link no dig / dig set and the two option tier sets (Oct 2026).
 *
 *   - Line posts: 1-5/8" Schedule 40 (SS40) pipe on every line post,
 *     ceil(run / 10) - 1 per run, for every residential chain link height and
 *     finish, also on moves and repairs.
 *   - The existing chain link styles are the No dig choice, same internal
 *     names; a Dig set twin per residential style copies the no dig kits with
 *     new unpriced post parts and the aluminum dig set kit's concrete.
 *   - Dig set is not available for quoting until every part is priced, then
 *     switches on by itself.
 *   - Aluminum and chain link tier sets are two options: Dig set with concrete
 *     and No dig (Most popular).
 */

import { describe, test, expect, afterEach } from 'vitest'
import fs from 'fs'
import { DEFAULT_CATALOG, materialOf, styleLabel, type FenceCatalog } from '../../web/src/fenceCatalog'
import { planChainDigSet, digSetPostName, CONCRETE_FROM } from '../../web/src/chainDigSet'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, countsFor, linesFromKitSet } from '../../web/src/materialKits'
import { isQuotable } from '../../web/src/styleAvailability'
import { resolveTiers } from '../../web/src/tiers'
import { compareStyles } from '../../web/src/proposal'
import { priceRepair, priceMove, moveRepairSettings } from '../../web/src/moveRepair'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { startersFor, CHAIN_STARTER, ALUM_STARTER } from '../src/server/lib/tierStarters'
import type { FenceStyle } from '../../web/src/configStore'

const prices: Record<string, number> = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const items = () => Object.entries(prices).map(([name, unitCost], i) => ({ id: `fx${i}`, name, unitCost, category: 'Fixture' }))
const STYLES: FenceStyle[] = JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES))
// A saved choice tree as it was before Install (dev and any company that edited the tree).
const OLD_TREE = (): FenceCatalog => {
  const c: FenceCatalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG))
  const chain = materialOf(c, 'chain')!
  chain.dims = chain.dims.filter(d => d.key !== 'install')
  chain.nameTemplate = '{finish} Chain Link, {height}, {grade}'
  return c
}
const RES = ["CL - 4' Galv", "CL - 5' Galv", "CL - 6' Galv", "CL - 4' Black", "CL - 5' Black", "CL - 6' Black"]

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

function use(st: { fenceStyles: FenceStyle[]; fenceCatalog?: FenceCatalog | null; items: any[]; kits: any[] }) {
  setMaterialPriceSource(inventoryPriceSource(st.items))
  setSavedKitSets(() => st.kits)
  return estimateConfig({ fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog ?? undefined, pricing: { overheadPct: 30 } } as any)
}
const job = (style: any, cfg: any, runs = [37, 120, 52]): QuoteCalcInput => ({
  style, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners: 2, ends: 2, walkGates: 1, dblGates: 1,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, overrides: {}, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
})

describe('chain link line posts', () => {
  test('one 1-5/8" Schedule 40 pipe per line post: ceil(run / 10) - 1 per run, every height and finish', () => {
    for (const name of RES) {
      const kit = builtInKitSet(name)!
      expect(kit.mismatch, name).toBeUndefined()
      const h = name.match(/(\d)'/)![1]
      const pipe = `Pipe, ${/Black/.test(name) ? 'Blk' : 'Galv'}, 1-5/8" X ${({ 4: 8, 5: 9, 6: 10 } as any)[h]}' (SS40)`
      expect(kit.kits.line?.find(p => p.part === pipe)?.qty, `${name} line kit`).toBe(1)
      expect(kit.kits.end?.some(p => p.part === pipe), `${name} end kit`).toBe(false)
      // 37 + 120 + 52 ft: 4 + 12 + 6 = 22 sections, 3 + 11 + 5 = 19 line posts.
      const runs = [37, 120, 52]
      const counts = countsFor(name, runs, { corners: 2, ends: 2, walkGates: 0, dblGates: 0 })
      expect(counts.line).toBe(runs.reduce((t, ft) => t + Math.ceil(ft / 10) - 1, 0))
      expect(linesFromKitSet(kit, counts).find(l => l.part === pipe)?.qty).toBe(19)
    }
  })
  test('moves and repairs on chain link use the same line post pipe', () => {
    const cfg = use({ fenceStyles: STYLES, items: items(), kits: [] })
    const s = cfg.fenceStyles.find(x => x.name === "CL - 4' Galv")!
    const common = { style: s, pricing: cfg.pricing, settings: moveRepairSettings(null), overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0 }
    const rep = priceRepair(common, { what: 'storm', items: { replacePost: 2 }, postType: 'nd', newPostCaps: false, gateKind: 'walk', debrisCleared: true })
    expect(rep.pullSheet.find(i => i.item === `Pipe, Galv, 1-5/8" X 8' (SS40)`)?.qty).toBe(2)
    const mv = priceMove(common, { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false }, { runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })
    expect(mv.pullSheet.find(i => i.item === `Pipe, Galv, 1-5/8" X 8' (SS40)`)?.qty).toBe(9)
  })
})

describe('chain link dig set', () => {
  const st0 = () => ({ fenceStyles: JSON.parse(JSON.stringify(STYLES)), fenceCatalog: OLD_TREE(), items: items(), kits: [] as any[] })

  test('the saved tree gets Install; old chain link names end ", No dig"; six dig set twins with unpriced post parts and the aluminum dig set concrete', () => {
    const plan = planChainDigSet(st0())
    expect(plan.catalog).toBe(true)
    const chain = materialOf(plan.state.fenceCatalog!, 'chain')!
    expect(chain.dims.map(d => d.key)).toEqual(['height', 'finish', 'grade', 'install'])
    expect(chain.nameTemplate).toBe('{finish} Chain Link, {height}, {grade}, {install}')
    expect(plan.styles).toEqual(['chain/4/galv/res/ds', 'chain/5/galv/res/ds', 'chain/6/galv/res/ds', 'chain/4/black/res/ds', 'chain/5/black/res/ds', 'chain/6/black/res/ds'])
    // 0.055 wall, the diameter of the no dig post it replaces (Oct 2026).
    expect(plan.items.sort()).toEqual(['4', '5', '6'].flatMap(h => ['Galv', 'Blk'].flatMap(f => [`DS, Pipe, ${f}, Line Post, 1-5/8" 0.055 wall, ${h}' Chain Link`, `DS, Pipe, ${f}, Terminal Post, 2-1/2" 0.055 wall, ${h}' Chain Link`])).sort())
    expect(plan.state.items.filter(i => plan.items.includes(i.name)).every(i => i.unitCost === 0)).toBe(true)
    const alum = builtInKitSet(CONCRETE_FROM)!
    for (const c of plan.concrete) expect(alum.kits[c.kit]?.find(p => p.part === c.part)?.qty).toBe(c.qty)
    expect(plan.concrete.map(c => c.kit).sort()).toEqual(['corner', 'end', 'line'])
    // No dig kit, post pipes swapped, concrete added; everything else as it was.
    const nd = builtInKitSet("CL - 4' Galv")!
    const ds = plan.state.kits.find(k => k.styleName === 'chain/4/galv/res/ds')!
    expect(ds.kits.line!.map(p => p.part)).toEqual([...nd.kits.line!.map(p => (/^Pipe,/.test(p.part) ? digSetPostName(p.part, 'line', '4') : p.part)), 'Misc, Concrete'])
    expect(ds.kits.perFoot).toEqual(nd.kits.perFoot)
    expect(ds.kits.walkGate).toEqual(nd.kits.walkGate)
    expect(ds.roundUp).toContain('Misc, Concrete')
    // Same rates as the no dig style.
    const src = STYLES.find(s => s.name === "CL - 4' Galv")!
    const made = plan.state.fenceStyles.find(s => s.name === 'chain/4/galv/res/ds')!
    for (const k of ['category', 'margin', 'sectionsPerMH', 'mhPerWalkGate', 'mhPerDblGate'] as const) expect(made[k]).toEqual(src[k])
    // Twice: nothing more.
    const again = planChainDigSet(plan.state)
    expect([again.styles, again.items, again.kits, again.catalog]).toEqual([[], [], [], false])
    // Names.
    use(plan.state)
    expect(styleLabel("CL - 4' Galv")).toBe('Galvanized Chain Link, 4 ft, Residential, No dig')
    expect(styleLabel('chain/4/galv/res/ds')).toBe('Galvanized Chain Link, 4 ft, Residential, Dig set')
  })

  test('not available for quoting until every part is priced, then on by itself; no dig prices unchanged', () => {
    const before = use({ fenceStyles: STYLES, items: items(), kits: [] })
    const ndPrice = Object.fromEntries(RES.map(n => [n, calculateQuote(job(before.fenceStyles.find(s => s.name === n), before)).priced.price]))
    const plan = planChainDigSet(st0())
    let cfg = use(plan.state)
    for (const n of RES) expect(calculateQuote(job(cfg.fenceStyles.find(s => s.name === n), cfg)).priced.price, n).toBe(ndPrice[n])
    const ds = cfg.fenceStyles.find(s => s.name === 'chain/4/galv/res/ds')!
    expect(isQuotable(ds)).toBe(false)
    expect(ds.held).toBe('Dig set is waiting for prices on 2 parts in Inventory')
    // Price the 4 ft galvanized dig set posts: that one switches on, the others stay off.
    const priced = plan.state.items.map(i => (/^DS, Pipe, Galv, .*, 4' Chain Link$/.test(i.name) ? { ...i, unitCost: 12.5 } : i))
    cfg = use({ ...plan.state, items: priced })
    expect(isQuotable(cfg.fenceStyles.find(s => s.name === 'chain/4/galv/res/ds'))).toBe(true)
    expect(isQuotable(cfg.fenceStyles.find(s => s.name === 'chain/5/galv/res/ds'))).toBe(false)
    const q = calculateQuote(job(cfg.fenceStyles.find(s => s.name === 'chain/4/galv/res/ds'), cfg))
    // 19 line + 2 corner + 2 end posts at half a bag each, rounded up once.
    expect(q.materials.items.find(i => i.item === 'Misc, Concrete')!.qty).toBe(Math.ceil((19 + 4) * 0.5))
    expect(q.materials.items.find(i => i.item === `DS, Pipe, Galv, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`)!.qty).toBe(19)
  })

  test('compare options leave the dig set out until it is priced', () => {
    const plan = planChainDigSet(st0())
    const cfg = use(plan.state)
    const own = cfg.fenceStyles.find(s => s.name === "CL - 4' Galv")!
    expect(compareStyles(own, cfg.fenceStyles).map(s => s.name)).toEqual(["CL - 4' Galv", "CL - 4' Black"])
  })
})

describe('two options for aluminum and chain link', () => {
  test('starting sets: Dig set with concrete, No dig (Most popular); vinyl stays Good Better Best', () => {
    const s = startersFor({ fenceStyles: STYLES })
    const chain = s.find(x => x.key === 'chainlink')!, alum = s.find(x => x.key === 'aluminum')!, vinyl = s.find(x => x.key === 'vinyl')!
    for (const set of [chain, alum]) {
      expect(set.tiers.map(t => [t.name, t.install])).toEqual([['Dig set with concrete', 'dig-set'], ['No dig', 'no-dig']])
      expect(set.popular).toBe('better')
    }
    expect(vinyl.tiers.map(t => t.name)).toEqual(['Good', 'Better', 'Best'])
  })
  test('a chain link quote: No dig priced, Dig set held until priced; aluminum: both', () => {
    const plan = planChainDigSet({ fenceStyles: JSON.parse(JSON.stringify(STYLES)), fenceCatalog: null, items: items(), kits: [] })
    let cfg = use(plan.state)
    const cl = cfg.fenceStyles.find(s => s.name === "CL - 4' Galv")!
    let t = resolveTiers(job(cl, cfg), cfg.fenceStyles, { category: 'Chainlink', tiers: CHAIN_STARTER, popular: 'better' })
    expect(t[0].option).toBeUndefined()
    expect(t[0].reason).toBe('Galvanized, dig set, 4 ft tall chain link is not available for quoting yet: Dig set is waiting for prices on 2 parts in Inventory.')
    expect(t[1].style?.name).toBe("CL - 4' Galv")
    expect(t[1].popular).toBe(true)
    cfg = use({ ...plan.state, items: plan.state.items.map(i => (/^DS, /.test(i.name) ? { ...i, unitCost: 12.5 } : i)) })
    t = resolveTiers(job(cfg.fenceStyles.find(s => s.name === "CL - 4' Galv"), cfg), cfg.fenceStyles, { category: 'Chainlink', tiers: CHAIN_STARTER, popular: 'better' })
    expect(t.map(x => x.style?.name)).toEqual(['chain/4/galv/res/ds', "CL - 4' Galv"])
    const al = cfg.fenceStyles.find(s => s.name === 'Alum - ND - Emily - 48')!
    const a = resolveTiers(job(al, cfg), cfg.fenceStyles, { category: 'Aluminum', tiers: ALUM_STARTER, popular: 'better' })
    expect(a.map(x => [x.style?.name, x.popular])).toEqual([['Alum - DS - Emily - 48', false], ['Alum - ND - Emily - 48', true]])
  })
  test('the aluminum no dig kit has the steel I beam insert on every post', () => {
    const k = builtInKitSet('Alum - ND - Emily - 48')!
    for (const kind of ['corner', 'end', 'line'] as const) expect(k.kits[kind]!.some(p => /^I-Post, 2"/.test(p.part)), kind).toBe(true)
  })
})
