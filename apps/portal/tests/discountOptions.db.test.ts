/**
 * A discount on the main option only (Jonathan, Nov 2 2026): "A discount on one option must never change the price of
 * the other options." Dave Diamond's draft: $5,000 off Better also took $5,000 off Good and Best. The ± dollar adjustment
 * is the main option's; every other option is priced as with none, on the server's save, the minimum job price check,
 * the customer page, and signing another option (quote, job, deposit, Sales Order and contract at its own price).
 *
 * Against the dev database (DEV_DB=1; refuses any other): its Settings, Inventory, kits and tier sets, and one throwaway
 * quote, signed and removed by id. Nothing is sent (tests run with the outbound gate shut).
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('a discount on the main option only (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { dataFor, withServerCosts } = await import('../src/server/lib/quotePricing.js')
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { stampQuoteWarranties } = await import('../src/server/lib/warranties.js')
  const { acceptQuote, proposalPage, renderProposal, optionPriceHtml } = await import('../src/server/routes/proposal.js')
  const { contractForQuote } = await import('../src/server/lib/contractPdf.js')
  const { optionSeen } = await import('../src/server/lib/optionSeen.js')
  const { orderBasisFor } = await import('../src/server/lib/salesOrders.js')
  const { checkDiscountMinimum } = await import('../src/server/lib/discountMinimum.js')

  const ALUM = 'Alum - ND - Emily - 48', CHAIN = "CL - 4' Galv", BLACK = "CL - 4' Black"
  const RUNS = [25, 33, 57, 14]
  const OFF = -50000
  let accountId = '', data: any, m: any, sets: any[] = []
  const setOf = (c: string) => sets.find(s => s.category === c)

  /** Aluminum, Good swapped to chain link, Best added as chain link black: three options of mixed styles. */
  const request = (overrides: any = {}) => ({
    fenceStyle: ALUM, runs: RUNS.map(ft => ({ ft, rail: 'auto' as const })), corners: 2, ends: 4, walkGates: 1, dblGates: 1, gateWidths: { walk: [4], dbl: [8] },
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0, overrides, jobType: 'new' as const,
    tierSet: setOf('Aluminum'), tierPrefs: { off: [], swap: { good: CHAIN }, added: [{ key: 'added1', style: BLACK }] },
  })
  const job = (r: any) => m.quoteJobFor(data, r, null)
  const priceOf = (j: any, style: string) => j.proposalOptions.find((o: any) => o.fenceStyle === style)

  beforeAll(async () => {
    accountId = (await resolveIntakeAccountId())!
    m = await pricingModule()
    data = await dataFor(accountId)
    sets = (await prisma.proposalTierSet.findMany({ where: { accountId } })).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
  })

  test('$500 off the main option: the main option is $500 lower, every other option exactly as with none', () => {
    const plain = job(request()), off = job(request({ priceAdjustmentCents: OFF, showDiscountOnProposal: true }))
    expect(off.proposalOptions.map((o: any) => o.fenceStyle).sort()).toEqual([ALUM, BLACK, CHAIN].sort())
    expect(plain.proposalOptions.length).toBe(3)
    expect(off.totals.price).toBe(plain.totals.price - 500)
    for (const o of off.proposalOptions) {
      const was = plain.proposalOptions.find((x: any) => x.fenceStyle === o.fenceStyle && x.tier?.key === o.tier?.key)
      if (o.fenceStyle === ALUM) expect([o.finalPrice, o.adjustmentCents]).toEqual([was.finalPrice - 500, OFF])
      else expect(o, o.label).toEqual(was)
    }
    for (const t of off.tiers.filter((x: any) => x.style?.name !== ALUM)) expect(t.option).toEqual(plain.tiers.find((x: any) => x.spec.key === t.spec.key).option)
  })

  test('a Salesman\'s save priced on the server: the same; the minimum check finds nothing under it', async () => {
    const r = request({ priceAdjustmentCents: OFF, showDiscountOnProposal: true })
    const j = job(r)
    const out = await withServerCosts(accountId, { priceRequest: r, proposal: { version: 1, options: j.proposalOptions.map((o: any) => ({ ...o, finalPrice: 1, snapshot: undefined })) } }, null)
    const plain = job(request())
    expect(out.finalPrice).toBe(plain.totals.price - 500)
    for (const o of out.proposal.options) {
      if (o.fenceStyle === ALUM) { expect(o.adjustmentCents).toBe(OFF); continue }
      expect(o.adjustmentCents).toBeUndefined()
      expect(o.finalPrice).toBe(priceOf(plain, o.fenceStyle).finalPrice)
    }
    expect(out.proposal.showDiscount).toBe(true)
    expect(await checkDiscountMinimum(accountId, 'sales_rep', {}, out, null)).toEqual({ kind: 'ok' })
  })

  describe('the customer signs an option that is not the main one', () => {
    const tag = `disc-${crypto.randomUUID().slice(0, 8)}`
    let id = '', token = '', chain: any, mainOpt: any
    beforeAll(async () => {
      const r = request({ priceAdjustmentCents: OFF, showDiscountOnProposal: true })
      const j = job(r)
      const options = j.proposalOptions.map((o: any) => (o.fenceStyle === ALUM ? { ...o, finalPrice: j.totals.price, adjustmentCents: j.totals.adjustmentCents } : { ...o }))
      const p: any = await stampQuoteWarranties(accountId, { version: 1, options, recommended: 1, wholeDollar: true, depositPct: 25, showDiscount: true, tierPrefs: r.tierPrefs, tierSet: r.tierSet, footageFt: RUNS.reduce((a, b) => a + b, 0), gatesText: '1 walk gate', included: [] }, null, false)
      chain = p.options.find((o: any) => o.fenceStyle === CHAIN)
      mainOpt = p.options.find((o: any) => o.fenceStyle === ALUM)
      token = `${tag}-token`
      const q = await prisma.savedQuote.create({ data: {
        accountId, customerName: `Discount ${tag}`, customerPhone: '', customerEmail: '', customerAddress: '1 Test Way', date: '2026-11-02', status: 'SENT',
        fenceStyle: ALUM, runs: RUNS, runRails: ['6ft', '6ft', '6ft', '6ft'], sections: j.calc.sections, corners: 2, ends: 4, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0,
        adjLaborHrs: 0, hasSalesman: true, priceAdjust: 0, materialCost: j.totals.materialCost, laborCost: j.totals.laborCost, tearOutCost: 0, totalCOGS: j.totals.totalCOGS, finalPrice: j.totals.price, gmPct: j.totals.gmPct,
        pullSheet: j.pullSheet, pricing: j.pricing, layout: { yard: null, runSections: j.calc.perRunSections }, proposal: p, shareToken: token, notes: '', leadSource: '', salesRep: '',
      } as any })
      id = q.id
    })
    afterAll(async () => {
      if (!id) return
      const jobs = await prisma.savedJob.findMany({ where: { quoteId: id }, select: { id: true } })
      for (const t of ['paymentSchedule', 'jobQuotedCost', 'signedDocument']) await (prisma as any)[t].deleteMany({ where: { quoteId: id } }).catch((e: Error) => console.error(t, e.message))
      await prisma.savedJob.deleteMany({ where: { id: { in: jobs.map(x => x.id) } } }).catch(() => {})
      await prisma.savedQuote.delete({ where: { id } }).catch(() => {})
      for (const row of await prisma.businessState.findMany({ where: { accountId }, select: { id: true, pendingOrders: true } })) {
        const list = (Array.isArray(row.pendingOrders) ? row.pendingOrders : []) as any[]
        const keep = list.filter(o => o?.quoteId !== id)
        if (keep.length !== list.length) await prisma.businessState.update({ where: { id: row.id }, data: { pendingOrders: keep as any, version: { increment: 1 } } })
      }
      await prisma.crmContact.deleteMany({ where: { firstName: { startsWith: 'Discount' }, lastName: tag } }).catch(() => {})
    })

    test('the customer page: the Discount line on the main option only; the other option at its own price', async () => {
      const plain = job(request())
      expect(chain.finalPrice).toBe(priceOf(plain, CHAIN).finalPrice)
      expect(chain.adjustmentCents).toBeUndefined()
      const q = await prisma.savedQuote.findUnique({ where: { id } })
      const { p, view } = await proposalPage(q as any, q!.proposal as any)
      const html = renderProposal(q, p, token, 'n', [], null, '', view)
      expect(optionPriceHtml(p, mainOpt)).toContain('Discount −$500')
      expect(optionPriceHtml(p, chain)).not.toContain('Discount')
      expect(html).toContain(optionPriceHtml(p, chain))
      expect(html).toContain('Discount −$500')
      expect(html.match(/data-discount/g)?.length).toBe(1)
    })

    test('signed: quote, job, deposit, Sales Order and contract at the chain link\'s own price, no discount on the record', async () => {
      const q = await prisma.savedQuote.findUnique({ where: { id } })
      const at = (q!.proposal as any).options.findIndex((o: any) => o.fenceStyle === CHAIN)
      const out = await acceptQuote(q, { option: at, seen: optionSeen((q!.proposal as any).options[at]), name: 'Test Customer' } as any)
      expect(out.status).toBe(200)
      const s = (await prisma.savedQuote.findUnique({ where: { id } })) as any
      expect([s.fenceStyle, s.finalPrice]).toEqual([CHAIN, chain.finalPrice])
      expect(s.pricing.priceAdjustmentCents).toBeUndefined()
      expect(s.pricing.showDiscountOnProposal).toBeUndefined()
      const jb = await prisma.savedJob.findFirst({ where: { quoteId: id } })
      expect(jb!.contractValue).toBe(chain.finalPrice)
      const plan = await prisma.paymentSchedule.findFirst({ where: { quoteId: id } })
      expect(plan?.signedCents).toBe(Math.round(chain.finalPrice * 100))
      expect(plan?.depositPct).toBe(25)
      const qc = await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId: id } } })
      expect(qc).toMatchObject({ fenceStyle: CHAIN, priceCents: Math.round(chain.finalPrice * 100) })
      const so = await orderBasisFor(accountId, id)
      expect(so!.styleName).toMatch(/Chain Link/i)
      expect(await contractForQuote(s)).toBeTruthy()
    })
  })
})
