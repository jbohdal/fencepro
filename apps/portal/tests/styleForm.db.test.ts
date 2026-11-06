/**
 * Add a fence style like a vinyl color (web/src/styleForm.ts; Jonathan, Nov 5
 * 2026), on the dev database's Settings, Inventory and kits (read only: in
 * memory, nothing saved): a new aluminum style copying Emily has every Emily
 * fence (No dig, Dig set) with the same kit quantities; its own parts (named
 * for Emily: sections, gates, post pieces) new and $0, shared hardware the
 * same parts; held until they are priced, then on by itself; its pull sheet
 * the same quantities as Emily's; Archive and Bring back; Rename keeps the part
 * names.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { planStyleForm, planArchiveStyle, proposedParts, stylePartRows, planStylePrices } from '../../web/src/styleForm'
import { catalogOf, resolveFenceStyles, type CatalogState } from '../../web/src/fenceCatalog'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, KIT_KINDS, kitSetFor, type KitSet } from '../../web/src/materialKits'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a new aluminum style copying Emily (dev database, in memory)', () => {
  let st: CatalogState, cfg: any
  const ids = (() => { let n = 0; return (p: string) => `${p}_t${++n}` })()
  beforeAll(async () => {
    const prisma = (await import('../src/server/lib/prisma.js')).default as any
    const owner = await prisma.crmUser.findFirst({ where: { role: 'super_admin', crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } })
    const b = await prisma.businessState.findUnique({ where: { accountId: owner.crmAccountId } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId: owner.crmAccountId } })
    cfg = b.config
    st = { fenceStyles: cfg.fenceStyles, fenceCatalog: catalogOf(cfg), items: inv.items, kits: inv.kits }
  })
  afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

  const use = (s: CatalogState) => { setMaterialPriceSource(inventoryPriceSource(s.items as any)); setSavedKitSets(() => s.kits) }
  const resolved = (s: CatalogState) => { use(s); const c = { ...cfg, fenceStyles: s.fenceStyles, fenceCatalog: s.fenceCatalog }; return resolveFenceStyles(estimateConfig(c).fenceStyles as any, s.fenceCatalog, inventoryPriceSource(s.items as any)) }
  const quote = (s: CatalogState, name: string) => {
    const styles = resolved(s)
    const ec = estimateConfig({ ...cfg, fenceStyles: s.fenceStyles, fenceCatalog: s.fenceCatalog })
    return calculateQuote({ style: styles.find(x => x.name === name)!, runs: [{ ft: 62, rail: 'auto' }, { ft: 40, rail: 'auto' }], corners: 1, ends: 2, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: ec.pricing, optimizer: ec.railOptimizer ?? DEFAULT_RAIL_OPTIMIZER_SETTINGS } as any)
  }

  test('copies, own parts at $0 held, priced on by itself, same pull sheet quantities; rename; archive', () => {
    const parts = proposedParts(st, 'alum', 'emily', 'Picket Top')
    const own = parts.filter(p => p.mode === 'own')
    // Emily's own parts (sections, gates, post pieces) are its own; the shared hardware is not.
    expect(own.length).toBeGreaterThan(2)
    expect(own.every(p => /Emily/i.test(p.from) && /Picket Top/.test(p.name!) && !/Emily/.test(p.name!))).toBe(true)
    expect(parts.filter(p => p.mode === 'same').some(p => /Hinge|Latch|Hex|Concrete|I-Post/i.test(p.from))).toBe(true)

    const plan = planStyleForm(st, { material: 'alum', label: 'Picket Top', copyFrom: 'emily', parts }, { today: '2026-11-05', newId: ids })
    const emily = st.fenceStyles.filter(s => s.material === 'alum' && s.choices?.panel === 'emily' && s.isActive !== false).map(s => s.name)
    expect(plan.styles.length).toBe(emily.length)
    expect(plan.waiting.length).toBe(own.length)
    // Every copied kit: the same lines and quantities, an own part where Emily's was.
    for (const name of plan.styles) {
      const s = plan.state.fenceStyles.find(x => x.name === name)!
      const k = plan.state.kits.find(x => x.styleName === name && !x.archived)!
      const ek = kitSetFor(s.madeFrom!, st.kits) as KitSet
      for (const kind of KIT_KINDS) {
        expect((k.kits[kind] ?? []).map(l => l.qty), `${name} ${kind}`).toEqual((ek.kits[kind] ?? []).map(l => l.qty))
        expect((k.kits[kind] ?? []).map(l => l.part), `${name} ${kind}`).toEqual((ek.kits[kind] ?? []).map(l => own.find(p => p.from === l.part)?.name ?? l.part))
      }
    }
    // Held until its own parts are priced.
    const nd = plan.styles.find(n => /\/nd$/.test(n))!
    expect(resolved(plan.state).find(s => s.name === nd)!.held).toMatch(/waiting for prices/)

    // Priced on the form, at Emily's prices: on by itself; its pull sheet is Emily's, quantity for quantity.
    const rows = stylePartRows(st, 'alum', 'emily')
    const priced = parts.map(p => (p.mode === 'own' ? { ...p, cents: rows.find(r => r.part === p.from)!.cents ?? 1000 } : p))
    const again = planStyleForm(plan.state, { material: 'alum', label: 'Picket Top', copyFrom: 'emily', parts: priced }, { key: plan.key, today: '2026-11-05', newId: ids })
    expect(again.waiting).toEqual([])
    expect(again.priced.length).toBe(own.length)
    expect(resolved(again.state).find(s => s.name === nd)!.held).toBeUndefined()
    const mine = quote(again.state, nd), theirs = quote(again.state, again.state.fenceStyles.find(s => s.name === nd)!.madeFrom!)
    const qty = (q: any) => q.materials.items.map((l: any) => l.qty)
    expect(qty(mine)).toEqual(qty(theirs))
    expect(mine.materials.items.some((l: any) => /Picket Top/.test(l.item))).toBe(true)
    expect(Math.round(mine.materials.total * 100)).toBe(Math.round(theirs.materials.total * 100))

    // Rename: the style's name changes; its parts keep theirs.
    const renamed = planStyleForm(again.state, { material: 'alum', label: 'Picket Top Deluxe', copyFrom: 'emily', parts: priced }, { key: plan.key, today: '2026-11-05', newId: ids })
    expect(renamed.renamed).toEqual({ from: 'Picket Top', to: 'Picket Top Deluxe' })
    expect(renamed.items).toEqual([])
    expect(resolved(renamed.state).find(s => s.name === nd)!.label).toMatch(/Picket Top Deluxe/)

    // Archive: its fences off, kits and own parts archived; Bring back turns them on.
    const arch = planArchiveStyle(renamed.state, 'alum', plan.key, true)
    expect(arch.styles.length).toBe(plan.styles.length)
    expect(arch.items.length).toBe(own.length)
    const back = planArchiveStyle(arch.state, 'alum', plan.key, false)
    expect(back.styles.length).toBe(plan.styles.length)
    expect(resolved(back.state).find(s => s.name === nd)!.held).toBeUndefined()
    // A name already in use is refused; a price on the Price List is a dated cost.
    expect(() => planStyleForm(st, { material: 'alum', label: 'Emily', copyFrom: 'emily', parts: [] }, { today: '2026-11-05', newId: ids })).toThrow(/already/)
    const pl = planStylePrices(back.state, [{ part: own[0].name!, cents: 12345 }], '2026-11-06')
    expect(pl.priced[0]).toMatchObject({ name: own[0].name, cents: 12345 })
  })
})
