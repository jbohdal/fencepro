/**
 * Make main prices the new main option as its card showed (review Nov 2 2026): a draft saved with vinyl as main,
 * reopened, Make main on aluminum moved its card from $15,250 to $15,755 (+$505), and the server saved $15,755. The
 * saved quote's cost factor was vinyl's (0.604) and Make main changed only the style, so aluminum (its own 0.624) was
 * priced at vinyl's. The quote builder now takes the old main's margin off (proposal.ts pricingForMain), and the
 * server's Salesman path leaves the saved cost choices off another main style (quoteJob.ts mainFrom).
 *
 * Against the dev database (DEV_DB=1; refuses any other): its Settings, Inventory, kits and tier sets, and one throwaway
 * draft quote, removed by id. Nothing is sent (tests run with the outbound gate shut).
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('Make main keeps each card\'s price (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { dataFor, withServerCosts, quoteViewFor } = await import('../src/server/lib/quotePricing.js')
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { pricingForMain } = await import('../../web/src/proposal')

  const VINYL = "WV-ND 6'x6' Privacy", ALUM = 'Alum - ND - Emily - 48', CHAIN = "CL - 4' Galv"
  const RUNS = [25, 33, 57, 14]
  const OFF = -50000
  let accountId = '', data: any, m: any, sets: any[] = []
  const tag = `mm-${crypto.randomUUID().slice(0, 8)}`
  let id = '', saved: any

  /** Vinyl's tiers with aluminum and chain link added: three styles of three materials on one draft. */
  const prefs = { off: [], swap: {}, added: [{ key: 'added1', style: ALUM }, { key: 'added2', style: CHAIN }] }
  const body = (fenceStyle: string, overrides: any = {}) => ({
    fenceStyle, runs: RUNS.map(ft => ({ ft, rail: 'auto' as const })), corners: 2, ends: 4, walkGates: 1, dblGates: 1, gateWidths: { walk: [4], dbl: [8] },
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides, jobType: 'new' as const,
    tierSet: sets.find(s => s.category === 'Vinyl'), tierPrefs: prefs,
  })
  const job = (r: any) => m.quoteJobFor(data, r, null)
  const cardPrice = (j: any, style: string) => j.proposalOptions.find((o: any) => o.fenceStyle === style).finalPrice
  /** The quote builder's own pricing choices as text fields, from a saved quote's pricing. */
  const fields = (p: any) => ({ costFactor: p.costFactor != null ? String(p.costFactor) : '', finalPrice: '', laborCost: '', subRate: '', pricePerFoot: '' })
  const asOverrides = (f: Record<string, string>, extra: any = {}) => ({ ...(f.costFactor ? { costFactor: Number(f.costFactor) } : {}), ...(f.finalPrice ? { finalPrice: Number(f.finalPrice) } : {}), ...extra })
  const styleOf = (name: string) => data.config.fenceStyles.find((s: any) => s.name === name)

  beforeAll(async () => {
    accountId = (await resolveIntakeAccountId())!
    m = await pricingModule()
    data = await dataFor(accountId)
    sets = (await prisma.proposalTierSet.findMany({ where: { accountId } })).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
    const j = job(body(VINYL))
    const q = await prisma.savedQuote.create({ data: {
      accountId, customerName: `Make main ${tag}`, customerPhone: '', customerEmail: '', customerAddress: '1 Test Way', date: '2026-11-02', status: 'DRAFT',
      fenceStyle: VINYL, runs: RUNS, runRails: RUNS.map(() => '6ft'), sections: j.calc.sections, corners: 2, ends: 4, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0,
      adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0, materialCost: j.totals.materialCost, laborCost: j.totals.laborCost, tearOutCost: 0, totalCOGS: j.totals.totalCOGS, finalPrice: j.totals.price, gmPct: j.totals.gmPct,
      pullSheet: j.pullSheet, pricing: j.pricing, layout: { yard: null, runSections: j.calc.perRunSections }, notes: '', leadSource: '', salesRep: '',
    } as any })
    id = q.id
    saved = q
  })
  afterAll(async () => { if (id) await prisma.savedQuote.delete({ where: { id } }).catch(() => {}) })

  test('the cause: the saved vinyl factor put on aluminum prices it above its card', () => {
    const vinylFactor = saved.pricing.costFactor
    const open = job(body(VINYL, { costFactor: vinylFactor }))
    const alumCard = cardPrice(open, ALUM)
    const alumOwn = job(body(ALUM)).pricing.costFactor
    expect(vinylFactor).toBeLessThan(alumOwn)
    // What Make main did: the style changed, the factor stayed.
    const before = job(body(ALUM, { costFactor: vinylFactor }))
    expect(before.totals.price).toBeGreaterThan(alumCard)
    // $15,250 → $15,755 on the reviewer's draft is the same ratio: the price scales by 0.624 / 0.604.
    expect(Math.abs(before.totals.price - alumCard * alumOwn / vinylFactor)).toBeLessThanOrEqual(1)
  })

  test('the quote builder: Make main on each card is its card\'s price; Make main back is the price it opened at', () => {
    const opened = fields(saved.pricing)
    let typed = opened, kept: any = {}, main = VINYL
    const open = job(body(VINYL, asOverrides(opened)))
    expect(open.totals.price).toBe(saved.finalPrice)
    const cards = { [ALUM]: cardPrice(open, ALUM), [CHAIN]: cardPrice(open, CHAIN) }
    for (const to of [ALUM, CHAIN, VINYL, CHAIN, ALUM, VINYL]) {
      const shown = to === VINYL ? saved.finalPrice : cards[to]
      const next = pricingForMain(typed, kept, styleOf(main), styleOf(to), '')
      typed = next.typed; kept = next.kept; main = to
      const j = job(body(to, asOverrides(typed)))
      expect(j.totals.price, `${to}`).toBe(shown)
      // Every other card stays as it was on the quote as opened.
      for (const other of [ALUM, CHAIN]) if (other !== to) expect(cardPrice(j, other), `${other} with ${to} main`).toBe(cards[other])
    }
    expect(typed).toEqual(opened)
  })

  test('a margin the owner typed stays with vinyl: aluminum at its card, vinyl back at the typed margin', () => {
    const typedVinyl = { ...fields(saved.pricing), costFactor: '0.58' }
    const atTyped = job(body(VINYL, asOverrides(typedVinyl))).totals.price
    const card = cardPrice(job(body(VINYL, asOverrides(typedVinyl))), ALUM)
    const toAlum = pricingForMain(typedVinyl, {}, styleOf(VINYL), styleOf(ALUM), '')
    expect(job(body(ALUM, asOverrides(toAlum.typed))).totals.price).toBe(card)
    const back = pricingForMain(toAlum.typed, toAlum.kept, styleOf(ALUM), styleOf(VINYL), '')
    expect(back.typed.costFactor).toBe('0.58')
    expect(job(body(VINYL, asOverrides(back.typed))).totals.price).toBe(atTyped)
  })

  test('the dollar discount moves to the new main: aluminum is its card less $500', () => {
    const open = job(body(VINYL, asOverrides(fields(saved.pricing), { priceAdjustmentCents: OFF })))
    const card = cardPrice(open, ALUM)
    const next = pricingForMain(fields(saved.pricing), {}, styleOf(VINYL), styleOf(ALUM), '')
    const j = job(body(ALUM, asOverrides(next.typed, { priceAdjustmentCents: OFF })))
    expect(j.totals.price).toBe(card - 500)
    // Chain link, not the main option, takes none of it.
    expect(cardPrice(j, CHAIN)).toBe(cardPrice(open, CHAIN))
  })

  test('a Salesman\'s phone and save, priced on the server: the card\'s price, and back again the saved price', async () => {
    const open = await quoteViewFor(accountId, body(VINYL), id)
    expect(open.price).toBe(saved.finalPrice)
    const alumCard = open.tiers.find((t: any) => t.styleName === ALUM).option.finalPrice
    const chainCard = open.tiers.find((t: any) => t.styleName === CHAIN).option.finalPrice
    expect((await quoteViewFor(accountId, body(ALUM), id)).price).toBe(alumCard)
    expect((await quoteViewFor(accountId, body(CHAIN), id)).price).toBe(chainCard)
    expect((await quoteViewFor(accountId, body(VINYL), id)).price).toBe(saved.finalPrice)
    // With the discount, it moves to aluminum.
    expect((await quoteViewFor(accountId, body(ALUM, { priceAdjustmentCents: OFF }), id)).price).toBe(alumCard - 500)
    const out = await withServerCosts(accountId, { priceRequest: body(ALUM) }, saved)
    expect(out.finalPrice).toBe(alumCard)
    expect(out.pricing.costFactor).toBe(job(body(ALUM)).pricing.costFactor)
    expect(out.pricing.overheadPct).toBe(saved.pricing.overheadPct)
  })
})
