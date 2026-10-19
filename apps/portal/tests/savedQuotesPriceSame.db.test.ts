/**
 * Every saved quote prices the same, to the cent, before and after a change.
 *
 * Reads (never writes) the dev database (DEV_DB=1 and ezbiz_dev only; vitest
 * does not load this file anywhere else): the saved Settings, Inventory,
 * material kits, Good Better Best sets and every saved quote. Each quote is
 * priced the way the quote builder prices it (its own style, runs, rails,
 * posts, gates, tear out, extra hours, salesman, price adjust and its saved
 * pricing choices), and its yard is also priced on every fence style, through
 * Good Better Best and through Compare options. Recorded per quote: sections
 * (total and per run), the 6 / 8 ft choice per run, every pull sheet line
 * (part, quantity, unit cost, total), material, labor, tear out, cost, price,
 * commission, margin and man hours.
 *
 * PRICE_BASELINE=<file> SAVE_BASELINE=1 writes the results (run on the code
 * before a change); PRICE_BASELINE=<file> compares against them afterwards.
 * The file holds quote ids and numbers only, no customer details.
 */

import 'dotenv/config'
import fs from 'fs'
import { describe, test, expect } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote, widthComparison, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, type KitSet } from '../../web/src/materialKits'
import { resolveTiers, tierSetFor, type TierSet } from '../../web/src/tiers'
import { compareStyles, priceOption } from '../../web/src/proposal'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const file = process.env.PRICE_BASELINE

describe.skipIf(!process.env.DEV_DB || !onDev || !file)('every saved quote prices the same (dev database, read only)', () => {
  test('priced before = priced after, to the cent', async () => {
    const prisma = (await import('../src/server/lib/prisma.js')).default as any
    const business = await prisma.businessState.findFirst({ select: { accountId: true, config: true } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId: business.accountId }, select: { items: true, kits: true } })
    const sets = await prisma.proposalTierSet.findMany({ where: { accountId: business.accountId }, orderBy: { sortOrder: 'asc' } }) as TierSet[]
    const quotes = await prisma.savedQuote.findMany({
      where: { accountId: business.accountId }, orderBy: { id: 'asc' },
      select: { id: true, fenceStyle: true, runs: true, runRails: true, corners: true, ends: true, walkGates: true, dblGates: true, tearOutSections: true, tearOutGates: true, adjLaborHrs: true, hasSalesman: true, priceAdjust: true, pricing: true },
    })

    const cfg = estimateConfig(business.config)
    setMaterialPriceSource(inventoryPriceSource(Array.isArray(inv?.items) ? inv.items : []))
    const kits = (Array.isArray(inv?.kits) ? inv.kits : []) as KitSet[]
    setSavedKitSets(() => kits)
    // The fence styles as they were before the change: the 28 saved ones, by their codes.
    const styleNames: string[] = cfg.fenceStyles.map(s => s.name)

    const pick = (c: ReturnType<typeof calculateQuote>) => ({
      sections: c.sections, perRunSections: c.perRunSections, perRunRail: c.perRunRail,
      materialCost: c.materialCost,
      pullSheet: c.materials.items.map(i => [i.item, i.qty, i.unitCost, i.total]),
      laborCost: c.priced.laborCost, tearOutCost: c.priced.tearOutCost, totalCOGS: c.priced.totalCOGS,
      basePrice: c.priced.basePrice, price: c.priced.price, commissionAmt: c.priced.commissionAmt,
      grossMargin: c.priced.grossMargin, gmPct: c.priced.gmPct, manHours: c.priced.manHours, costFactor: c.priced.costFactor,
    })

    const out: Record<string, unknown> = {}
    let priced = 0, yards = 0
    for (const q of quotes) {
      const runs: number[] = Array.isArray(q.runs) ? q.runs.map(Number) : []
      const rails: Array<'auto' | '6ft' | '8ft'> = Array.isArray(q.runRails) ? q.runRails : []
      const base = (name: string): QuoteCalcInput => ({
        style: cfg.fenceStyles.find(s => s.name === name),
        runs: runs.map((ft, i) => ({ ft, rail: rails[i] ?? 'auto' })),
        corners: q.corners || 0, ends: q.ends || 0, walkGates: q.walkGates || 0, dblGates: q.dblGates || 0,
        tearOutSections: q.tearOutSections || 0, tearOutGates: q.tearOutGates || 0,
        extraLaborHrs: q.adjLaborHrs || 0, hasSalesman: !!q.hasSalesman, priceAdjust: q.priceAdjust || 0,
        pricing: cfg.pricing, overrides: q.pricing ?? undefined, optimizer: cfg.railOptimizer!,
      })
      const own = base(q.fenceStyle)
      const rec: Record<string, unknown> = { own: pick(calculateQuote(own)) }
      priced++
      if (runs.some(f => f > 0)) {
        yards++
        // The same yard on every style (by code), with the quote's choices but no typed price.
        const every: Record<string, unknown> = {}
        for (const name of styleNames) {
          const i = base(name)
          every[name] = pick(calculateQuote({ ...i, overrides: { ...(i.overrides ?? {}), finalPrice: undefined } }))
        }
        rec.everyStyle = every
        if (own.style) {
          rec.width = widthComparison(own, cfg.fenceStyles)
          rec.tiers = resolveTiers(own, cfg.fenceStyles, tierSetFor(sets, own.style))
            .map(t => [t.spec.key, t.style?.name ?? null, t.option?.finalPrice ?? null, t.option?.sections ?? null, t.reason ?? null, t.widthFt, t.otherWidth])
          rec.compare = compareStyles(own.style, cfg.fenceStyles).map(s => [s.name, priceOption(own, s).finalPrice])
        }
      }
      out[q.id] = rec
    }
    setMaterialPriceSource(null)
    setSavedKitSets(() => [])

    if (process.env.SAVE_BASELINE) {
      fs.writeFileSync(file!, JSON.stringify({ at: new Date().toISOString(), quotes: priced, yards, styles: styleNames, results: out }))
      console.log(`[baseline] ${priced} saved quotes, ${yards} yards on ${styleNames.length} styles written to ${file}`)
      return
    }
    const before = JSON.parse(fs.readFileSync(file!, 'utf8'))
    expect(styleNames.filter(n => before.styles.includes(n))).toEqual(before.styles)
    const ids = Object.keys(before.results)
    let diffs = 0
    const first: string[] = []
    for (const id of ids) {
      const a = JSON.stringify(before.results[id]), b = JSON.stringify(out[id])
      if (a !== b) { diffs++; if (first.length < 5) first.push(`${id}\n before ${a.slice(0, 600)}\n after  ${(b ?? 'missing').slice(0, 600)}`) }
    }
    console.log(`[same price] ${ids.length} saved quotes compared (${before.yards} yards on ${before.styles.length} styles, plus tiers, compare and 6/8 ft): ${diffs} differ`)
    expect(first.join('\n\n')).toBe('')
    expect(diffs).toBe(0)
    expect(ids.length).toBe(before.quotes)
  }, 600_000)
})
