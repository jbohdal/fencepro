/**
 * Unsent drafts and today's Target Profit, on the dev database (read only;
 * DEV_DB=1 and ezbiz_dev only). With Settings as saved, no draft takes a
 * different Target Profit when opened (one saved at another Overhead % takes
 * today's). With one number changed in memory (Dig
 * set's Target Profit +1 on vinyl, DRAFT_MARGIN_TRY to change another), it
 * lists every draft whose price would change on open: its id, fence, old and
 * new price; and, for drafts saved before the rule (no Target Profit saved
 * with them, so they keep theirs), the ones that would if they were stamped
 * with today's. Sent, signed and sold quotes are never in it.
 */

import 'dotenv/config'
import { describe, test, expect } from 'vitest'
import { estimateConfig, draftMarginFor } from '../../web/src/estimate'
import { calculateQuote } from '../../web/src/quoteCalc'
import { keepsCents } from '../../web/src/pricingEngine'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, type KitSet } from '../../web/src/materialKits'
import { catalogOf } from '../../web/src/fenceCatalog'
import { legacyProfit, isUnsentDraft } from '../../web/src/draftMargin'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('unsent drafts take today’s Target Profit (dev database, read only)', () => {
  test('no Settings change: none differs; Dig set +1: the drafts that would', async () => {
    const prisma = (await import('../src/server/lib/prisma.js')).default as any
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const accountId = top[0].accountId
    const business = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    const quotes = await prisma.savedQuote.findMany({
      where: { accountId, deletedAt: null }, orderBy: { id: 'asc' },
      select: { id: true, fenceStyle: true, runs: true, runRails: true, corners: true, ends: true, walkGates: true, dblGates: true, tearOutSections: true, tearOutGates: true, adjLaborHrs: true, hasSalesman: true, priceAdjust: true, pricing: true, layout: true, status: true, shareToken: true, acceptedAt: true, soldAt: true, firstViewedAt: true, viewCount: true, work: true, finalPrice: true },
    })
    setMaterialPriceSource(inventoryPriceSource(Array.isArray(inv?.items) ? inv.items : []))
    setSavedKitSets(() => (Array.isArray(inv?.kits) ? inv.kits : []) as KitSet[])
    try {
      // Dig set's Target Profit one point up, on a copy in memory (never saved).
      const changed = JSON.parse(JSON.stringify(business.config))
      changed.fenceCatalog = catalogOf(changed)
      const vinyl = changed.fenceCatalog.materials.find((m: any) => m.key === 'vinyl')
      const dsOpt = vinyl.dims.find((d: any) => d.key === 'install').options.find((o: any) => o.key === 'ds')
      const dsNow = estimateConfig(business.config).fenceStyles.find(s => s.name === "WV-DS 6'x8' Privacy")!.targetProfitPct!
      const tryPct = Number(process.env.DRAFT_MARGIN_TRY) || dsNow + 1
      dsOpt.rateDefaults = { ...(dsOpt.rateDefaults ?? {}), targetProfitPct: tryPct }
      const cfgNow = estimateConfig(business.config), cfgTry = estimateConfig(changed)

      const priceOf = (cfg: typeof cfgNow, q: any, costFactor?: number) => {
        const runs: number[] = Array.isArray(q.runs) ? q.runs.map(Number) : []
        const rails: any[] = Array.isArray(q.runRails) ? q.runRails : []
        const overrides = { ...(keepsCents(q) ? { ...(q.pricing ?? {}), wholeDollar: false } : (q.pricing ?? {})), ...(costFactor ? { costFactor } : {}) }
        return calculateQuote({
          style: cfg.fenceStyles.find(s => s.name === q.fenceStyle), runs: runs.map((ft, i) => ({ ft, rail: rails[i] ?? 'auto' })),
          corners: q.corners || 0, ends: q.ends || 0, walkGates: q.walkGates || 0, dblGates: q.dblGates || 0,
          ...(Number(q.layout?.teeLinePosts) > 0 ? { extraLinePosts: Number(q.layout.teeLinePosts) } : {}),
          tearOutSections: q.tearOutSections || 0, tearOutGates: q.tearOutGates || 0, extraLaborHrs: q.adjLaborHrs || 0,
          hasSalesman: !!q.hasSalesman, priceAdjust: q.priceAdjust || 0, pricing: cfg.pricing, overrides, optimizer: cfg.railOptimizer!,
        }).priced.price
      }

      const today = quotes.filter((q: any) => draftMarginFor(business.config, q))
      // Saved before the rule: the ones whose factor is today's Settings one, as if stamped with it.
      const styleNow = (q: any) => cfgNow.fenceStyles.find(s => s.name === q.fenceStyle)
      const stampable = quotes.filter((q: any) => isUnsentDraft(q) && !q.work && legacyProfit(q.pricing, styleNow(q)) !== null)
      const stampRows: string[] = []
      for (const q of stampable) {
        const stamped = { ...q, pricing: { ...q.pricing, targetProfitPct: legacyProfit(q.pricing, styleNow(q)) } }
        const d = draftMarginFor(changed, stamped)
        if (d) stampRows.push(`${q.id} | ${q.status} | ${cfgTry.fenceStyles.find(s => s.name === q.fenceStyle)?.label ?? q.fenceStyle} | Target Profit ${d.wasProfitPct}% → ${d.profitPct}% | $${priceOf(cfgNow, q).toFixed(2)} → $${priceOf(cfgTry, q, d.costFactor).toFixed(2)}`)
      }
      const unsent = quotes.filter((q: any) => isUnsentDraft(q))
      const keep = unsent.filter((q: any) => !stampable.includes(q))
      const drafts = quotes.filter((q: any) => q.status === 'DRAFT')
      const rows: string[] = []
      for (const q of quotes) {
        const d = draftMarginFor(changed, q)
        if (!d) continue
        rows.push(`${q.id} | ${q.status} | ${cfgTry.fenceStyles.find(s => s.name === q.fenceStyle)?.label ?? q.fenceStyle} | Target Profit ${d.wasProfitPct}% → ${d.profitPct}% | $${priceOf(cfgNow, q).toFixed(2)} → $${priceOf(cfgTry, q, d.costFactor).toFixed(2)}`)
      }
      console.log(`[draft margin] ${quotes.length} saved quotes, ${drafts.length} drafts. Settings as saved: ${today.length} would take another factor on open (today's Overhead %).`)
      console.log(`[draft margin] Dig set Target Profit ${dsNow}% → ${tryPct}% (in memory): ${rows.length} drafts would price differently on open:\n${rows.join('\n')}`)
      console.log(`[draft margin] ${unsent.length} unsent drafts: ${stampable.length} saved before the rule at today's Settings margin (they would follow once saved again, or stamped); ${keep.length} keep their own (typed, another price method, a move or repair, or a margin Settings no longer gives).`)
      console.log(`[draft margin] if those ${stampable.length} were stamped, Dig set ${dsNow}% → ${tryPct}% would change ${stampRows.length}:\n${stampRows.join('\n')}`)
      // Settings as saved: only an overhead change since a draft was saved moves it (overhead follows, Nov 3 2026).
      expect(today.filter((q: any) => { const d = draftMarginFor(business.config, q)!; return d.profitPct !== d.wasProfitPct }).map((q: any) => q.id)).toEqual([])
      expect(rows.every(r => r.split(' | ')[1] === 'DRAFT')).toBe(true)
    } finally {
      setMaterialPriceSource(null)
      setSavedKitSets(() => [])
    }
  }, 300_000)
})
