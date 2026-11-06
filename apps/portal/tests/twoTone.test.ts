/**
 * Two tone vinyl privacy (web/src/twoTone.ts; Jonathan, Nov 5 2026): frame
 * (posts, caps, rails, gate uprights and caps, rail inserts) of one per piece
 * color, infill (pickets, U trim, picket stiffeners) of another, built from
 * the frame color's fence with the infill color's infill lines; same
 * quantities as a one color fence; held, naming the parts, until priced.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { estimateConfig, planTwoToneFor, followedRatesByStyle } from '../../web/src/estimate'
import { calculateQuote } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { kitSetFor, setSavedKitSets, type KitSet } from '../../web/src/materialKits'
import { DEFAULT_CATALOG, plainName, resolveFenceStyles, stripDerived, type FenceCatalog } from '../../web/src/fenceCatalog'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { twoToneColors, isInfillPart } from '../../web/src/twoTone'

const prices: Record<string, number> = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const base = () => {
  const cfg = estimateConfig({})
  return { ...cfg, fenceStyles: cfg.fenceStyles.map(s => { const c: any = { ...s }; delete c.label; delete c.held; delete c.jobLot; delete c.followed; return c }), fenceCatalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as FenceCatalog }
}
const made = () => planTwoToneFor(base() as any)
const resolved = (cfg: any, price = priceSourceFromMap(prices)) => resolveFenceStyles(cfg.fenceStyles, cfg.fenceCatalog, price)
const kit = (name: string) => { const k = kitSetFor(name); if (!k || k === 'archived') throw new Error(`no kit ${name}`); return k as KitSet }
const parts = (k: KitSet, kind: keyof KitSet['kits']) => (k.kits[kind] ?? []).map(p => `${p.part}×${p.qty}`)

beforeAll(() => { setMaterialPriceSource(priceSourceFromMap(prices)); setSavedKitSets(() => []) })
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('two tone vinyl', () => {
  test('a fence for each frame and infill pair of the per piece colors, size and set method; plain names as the customer reads them', () => {
    const plan = made()
    // White and Tan (per piece) both ways, 6x6, 6x8 and best price, No dig and Dig set: 12, less the best price No dig
    // pair, since this company has no Tan best price No dig fence (a pair needs both one color fences).
    expect(plan.added.length).toBe(10)
    expect(plan.added).not.toContain('twotone/6/white/tan/nd/auto')
    expect(plan.catalog).toBe(true)
    const cfg = plan.config as any
    expect(plainName(cfg.fenceCatalog, { material: 'twotone', choices: { height: '6', frame: 'white', infill: 'tan', install: 'nd', width: '8' } }))
      .toBe('Two Tone Vinyl Privacy, White frame, Tan pickets, 6 ft tall, 8 ft sections, No dig')
    // Run again: nothing more.
    const again = planTwoToneFor(cfg)
    expect([again.added, again.catalog]).toEqual([[], false])
    // Nothing copied that should follow: no Target Profit or sub rate of its own.
    const s = cfg.fenceStyles.find((x: any) => x.name === 'twotone/6/tan/white/ds/6')
    expect([s.targetProfitPct, s.subRate, s.madeFrom]).toEqual([undefined, undefined, "TV-DS 6'x6' Privacy"])
  })

  test('labor and Target Profit follow the frame fence as it is now, unless set on the two tone fence', () => {
    const cfg = made().config as any
    const set = (name: string, patch: object) => { cfg.fenceStyles = cfg.fenceStyles.map((x: any) => (x.name === name ? { ...x, ...patch } : x)) }
    // The frame fence changes: its own Target Profit 17%, a sub rate of $9.50 a foot, more man hours.
    set("TV-DS 6'x6' Privacy", { ownProfitPct: 17, subRate: 9.5, sectionsPerMH: 0.7 })
    let r = resolved(cfg)
    const two = () => r.find(x => x.name === 'twotone/6/tan/white/ds/6')!
    const frame = () => r.find(x => x.name === "TV-DS 6'x6' Privacy")!
    expect(two().followed?.targetProfitPct?.value).toBe(17)
    expect(two().followed?.subRate?.value).toBe(9.5)
    expect(two().sectionsPerMH).toBe(0.7)
    expect(estimateConfig(cfg).fenceStyles.find(x => x.name === 'twotone/6/tan/white/ds/6')!.margin).toBe(estimateConfig(cfg).fenceStyles.find(x => x.name === "TV-DS 6'x6' Privacy")!.margin)
    // Its own number on the two tone fence wins: Target Profit 20%, sub $11.
    set('twotone/6/tan/white/ds/6', { ownProfitPct: 20, subRate: 11 })
    r = resolved(cfg)
    expect(two().ownProfitPct).toBe(20)
    expect(two().subRate).toBe(11)
    expect(two().followed?.subRate).toBeUndefined()
    expect(frame().subRate).toBe(9.5)
    // The server's job costing reads the same numbers.
    const byStyle = followedRatesByStyle(cfg)
    expect(byStyle['twotone/6/tan/white/ds/6']?.subRate).toBeUndefined()
    expect(byStyle['twotone/6/tan/white/ds/8']?.subRate?.value ?? null).toBe(cfg.fenceStyles.find((x: any) => x.name === "TV-DS 6'x8' Privacy").subRate ?? byStyle["TV-DS 6'x8' Privacy"]?.subRate?.value ?? null)
  })

  test('copies left on fences made before they followed are taken off; a different number stays', () => {
    const cfg = made().config as any
    cfg.fenceStyles = cfg.fenceStyles.map((x: any) => x.name === 'twotone/6/white/tan/nd/8' ? { ...x, targetProfitPct: 14 } : x.name === 'twotone/6/white/tan/nd/6' ? { ...x, subRate: 99 } : x)
    const again = planTwoToneFor(cfg)
    expect(again.cleaned).toBe(true)
    const after = (again.config as any).fenceStyles
    expect(after.find((x: any) => x.name === 'twotone/6/white/tan/nd/8').targetProfitPct).toBeUndefined()
    expect(after.find((x: any) => x.name === 'twotone/6/white/tan/nd/6').subRate).toBe(99)
  })

  test('a Settings save keeps the Target Profit read from the frame fence off the two tone fence; its own number is saved', () => {
    const cfg = made().config as any
    cfg.fenceStyles = cfg.fenceStyles.map((x: any) => (x.name === "WV-ND 6'x8' Privacy" ? { ...x, targetProfitPct: 14 } : x.name === 'twotone/6/white/tan/ds/8' ? { ...x, ownProfitPct: 20 } : x))
    const r = resolved(cfg)
    // On the screen it reads the frame fence's 14...
    expect(r.find(x => x.name === 'twotone/6/white/tan/nd/8')!.targetProfitPct).toBe(14)
    // ...but what Settings saves (configStore.ts saveConfig) leaves it to follow the frame fence.
    const saved = stripDerived(r)
    expect(saved.find(x => x.name === 'twotone/6/white/tan/nd/8')!.targetProfitPct).toBeUndefined()
    expect(saved.find(x => x.name === 'twotone/6/white/tan/ds/8')!.ownProfitPct).toBe(20)
    expect(saved.find(x => x.name === "WV-ND 6'x8' Privacy")!.targetProfitPct).toBe(14)
    // Nothing for the two tone sync to clean after such a save.
    expect(planTwoToneFor({ ...cfg, fenceStyles: saved } as any).cleaned).toBe(false)
  })

  test('White frame, Tan infill: posts, caps, rails, uprights and gate caps White; pickets and U trim Tan; same quantities', () => {
    const cfg = made().config as any
    resolved(cfg)
    const two = kit('twotone/6/white/tan/nd/8'), white = kit("WV-ND 6'x8' Privacy"), tan = kit("TV-ND 6'x8' Privacy")
    for (const kind of Object.keys(white.kits) as Array<keyof KitSet['kits']>) {
      // Every frame line is White's, every infill line Tan's, in the same counts.
      expect(parts(two, kind).filter(p => !isInfillPart(p))).toEqual(parts(white, kind).filter(p => !isInfillPart(p)))
      expect(parts(two, kind).filter(p => isInfillPart(p))).toEqual(parts(tan, kind).filter(p => isInfillPart(p)))
    }
    expect(parts(two, 'section').some(p => /Tan, Picket/.test(p))).toBe(true)
    expect(parts(two, 'section').some(p => /White, Rail/.test(p))).toBe(true)
    expect(parts(two, 'section').some(p => /White, Picket/.test(p))).toBe(false)
    // The other way round: Tan frame, White infill.
    const back = kit('twotone/6/tan/white/nd/8')
    expect(parts(back, 'section').some(p => /White, Picket/.test(p)) && parts(back, 'section').some(p => /Tan, Rail/.test(p))).toBe(true)
  })

  test('priced: the White fence with its pickets and U trim at Tan prices, nothing else moved; best price and dig set too', () => {
    const cfg = made().config as any
    const styles = resolved(cfg)
    const q = (name: string) => calculateQuote({
      style: styles.find(s => s.name === name)!, runs: [{ ft: 100, rail: 'auto' }], corners: 0, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    })
    for (const [two, frame, infill] of [['twotone/6/white/tan/nd/8', "WV-ND 6'x8' Privacy", "TV-ND 6'x8' Privacy"], ['twotone/6/tan/white/ds/6', "TV-DS 6'x6' Privacy", "WV-DS 6'x6' Privacy"]]) {
      const a = q(two), f = q(frame), i = q(infill)
      const money = (c: typeof a, infillOnly: boolean) => Math.round(c.materials.items.filter(l => isInfillPart(l.item) === infillOnly).reduce((t, l) => t + l.total, 0) * 100)
      expect(a.sections).toBe(f.sections)
      expect(money(a, false)).toBe(money(f, false))
      expect(money(a, true)).toBe(money(i, true))
      expect(a.priced.laborCost).toBe(f.priced.laborCost)
      expect(a.priced.price).toBeGreaterThan(0)
    }
    // Best price (6 or 8 ft per run) prices too.
    const auto = q('twotone/6/white/tan/ds/auto')
    expect(auto.priced.price).toBeGreaterThan(0)
    expect(auto.materials.items.some(l => /Tan, Picket/.test(l.item)) && auto.materials.items.some(l => /White, Post/.test(l.item))).toBe(true)
  })

  test('held until every part is priced, naming the parts', () => {
    const cfg = made().config as any
    const tanPicket = Object.keys(prices).find(n => /^\*?Vinyl, Tan, Picket/.test(n))!
    const without = priceSourceFromMap({ ...prices, [tanPicket]: 0 })
    const s = resolved(cfg, (n: string) => { const v = without(n); return v === 0 ? 0 : v }).find(x => x.name === 'twotone/6/white/tan/nd/8')!
    expect(s.held).toContain(tanPicket)
    expect(resolved(cfg).find(x => x.name === 'twotone/6/white/tan/nd/8')!.held).toBeUndefined()
  })

  test('only colors priced per piece: a color sold by the section (Chai Gray) is not a frame or infill choice', () => {
    const cat = JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as FenceCatalog
    const dim = cat.materials.find(m => m.key === 'vinyl')!.dims.find(d => d.isColor)!
    dim.options.push({ key: 'chai-gray', label: 'Chai Gray', copiedFrom: 'white', color: { words: ['Chai Gray'], pricing: 'piece', form: { mode: 'section', sizes: ['6x8'], methods: ['nd'], samePostPrice: true, items: {}, madeOn: '2026-10-21' } } } as any)
    dim.options.push({ key: 'slate', label: 'Slate', copiedFrom: 'white', color: { words: ['Slate'], pricing: 'part', form: { mode: 'piece', sizes: ['6x6'], methods: ['nd'], samePostPrice: true, items: {}, madeOn: '2026-11-05' } } } as any)
    expect(twoToneColors(cat.materials.find(m => m.key === 'vinyl')).map(o => o.key)).toEqual(['white', 'tan', 'slate'])
  })
})
