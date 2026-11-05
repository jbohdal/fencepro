/**
 * The quote builder's Price step and the customer's proposal show the same Better (review Oct 27 2026: the
 * Salesman drew 236 ft of white vinyl privacy 6 ft, a walk gate, best price, no dig; her Price step said
 * Better $8,593, all 8 ft sections; the unsent proposal's Better card said $8,409, 6 ft and 8 ft sections).
 *
 * A best price quote (6 or 8 ft sections, the cheaper per run) is shown on the proposal as the tier it is the
 * fence of, at the quote's price (web/src/proposalOptions.ts ownTierFold). The builder's tier card now shows
 * that too (web/src/tiers.ts ownTierKey). A sent proposal keeps the cards and prices it went out with.
 *
 * Read only: the dev database's Settings, Inventory, kits and Good / Better / Best. Nothing is saved.
 */

import 'dotenv/config'
import { describe, test, expect } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('builder Better = proposal Better for a best price quote (dev database, read only)', async () => {
  const { pricingWithData } = await import('../src/server/lib/estimates.js')
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { styleRecords } = await import('../src/server/lib/ownTier.js')
  const { proposalPage } = await import('../src/server/routes/proposal.js')
  const { customerFenceName, railsOf } = await import('../src/server/lib/customerFenceName.js')
  const { ownTierKey, frozenOwnTierKey } = await import('../../web/src/tiers')
  const { priceOption, optionLabel } = await import('../../web/src/proposal')
  const { proposalSent } = await import('../../web/src/proposalOptions')

  // 236 ft: five runs that pick 6 ft sections on the short returns and 8 ft on the rest, one walk gate, no dig.
  const runs = [12, 50, 112, 50, 12]
  const STYLE = 'WV-Auto ND Privacy'

  // Good and Better at "whichever width prices lower", as these checks were written: Jonathan set them to 8 ft
  // on Nov 2 2026 (Settings → Good / Better / Best), so they read the set that way instead of as saved
  // (tests/mixedOptions.db.test.ts checks the set as saved).
  const cheapestWidths = (s: any) => (s ? { ...s, tiers: s.tiers.map((t: any) => (t.key === 'best' ? t : { ...t, width: 'cheapest' })) } : s)

  async function setup() {
    const { m, data } = await pricingWithData()
    const sets = (await prisma.proposalTierSet.findMany({})).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
    const tierSet = cheapestWidths(sets.find(s => s.category.trim().toLowerCase() === 'vinyl') ?? null)
    const req = {
      fenceStyle: STYLE, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners: runs.length - 1, ends: 2, walkGates: 1, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0, overrides: {}, jobType: 'new' as const,
      tierSet, tierPrefs: { off: [], swap: {} },
    }
    const job = m.quoteJobFor(data, req)
    const view = m.quoteView(job)
    const styleOf = await styleRecords()
    // The proposal as a save keeps it (QuoteBuilder buildProposal / lib/quotePricing.ts withServerCosts): the tiers, then
    // the quote's own option at the quote's price.
    const options = job.proposalOptions.map((o: any) => (!o.tier && o.fenceStyle === STYLE ? { ...o, finalPrice: job.totals.price } : { ...o }))
    const p: any = { version: 1, options, recommended: Math.max(0, options.findIndex((o: any) => o.badge === 'Most popular')), tierSet, tierPrefs: req.tierPrefs }
    return { m, job, view, tierSet, styleOf, p }
  }

  /** The card the customer reads for a tier: its price (cents) and its fence name, as routes/proposal.ts shows it. */
  async function customerCard(m: any, p: any, q: any, key: string) {
    const accountId = (await resolveIntakeAccountId())!
    const { p: shown, view } = await proposalPage({ accountId, acceptedAt: null, fenceStyle: STYLE, finalPrice: q.finalPrice, status: q.status, firstViewedAt: null, viewCount: 0 }, p)
    // The cards shown, in order: a folded tier's place holds the quote's own option; hidden twins are left out.
    const shownAt = (view.order ?? shown.options.map((_: unknown, i: number) => i)).filter((i: number) => !view.hidden.includes(i))
    const at = shownAt.find((i: number) => shown.options[i]?.tier?.key === key)!
    expect(at, `a ${key} card`).toBeGreaterThanOrEqual(0)
    const o = shown.options[at]
    return { cents: Math.round(o.finalPrice * 100), name: customerFenceName(o.label, railsOf(o as any, o.fenceStyle === STYLE ? q.runRails : null)) }
  }

  test('the example: Better is the quote\'s own best price fence, the same price on the Price step and on the unsent proposal', async () => {
    const { m, job, view, tierSet, styleOf, p } = await setup()
    expect(tierSet, 'the dev database has a vinyl Good / Better / Best').toBeTruthy()
    // The yard really mixes, per run (ceil(footage / width) each run, summed).
    expect(new Set(job.calc.perRunRail.filter((_: unknown, i: number) => runs[i] > 0))).toEqual(new Set(['6ft', '8ft']))
    // Better's "whichever width prices lower" takes the best price mix (Nov 2 2026): it is the quote's own fence.
    const better = job.tiers.find((t: any) => t.spec.key === 'better')
    expect(better?.style?.name).toBe(STYLE)
    expect(Math.round(better.option.finalPrice * 100)).toBe(Math.round(job.totals.price * 100))
    // Nothing to fold: the builder shows Better as the main card at the quote's price.
    expect(view.ownTierKey).toBeNull()
    expect(ownTierKey(job.tiers, { ...priceOption(job.calcInput, job.style), finalPrice: job.totals.price }, n => styleOf(n), tierSet!.tiers)).toBeNull()
    const builderName = customerFenceName(optionLabel(STYLE), job.calc.perRunRail.filter((_: unknown, i: number) => runs[i] > 0))
    expect(builderName).toMatch(/6 ft and 8 ft sections/)
    // The proposal saved now (not sent): no fold frozen; Better's card is the quote's own price and sections.
    p.ownTier = m.ownTierToStamp(p, { fenceStyle: STYLE }, null, false, styleOf)
    expect(p.ownTier).toBeNull()
    const card = await customerCard(m, p, { finalPrice: job.totals.price, status: 'DRAFT', runRails: job.calc.perRunRail }, 'better')
    expect(card.cents).toBe(Math.round(job.totals.price * 100))
    expect(card.name).toBe(builderName)
    // And the Good and Best cards: the tier prices on both sides.
    for (const key of ['good', 'best']) {
      const t = job.tiers.find((x: any) => x.spec.key === key)
      if (!t?.option) continue
      if (t.option.fenceStyle === better.option.fenceStyle && t.option.finalPrice === better.option.finalPrice) continue
      const c = await customerCard(m, p, { finalPrice: job.totals.price, status: 'DRAFT', runRails: job.calc.perRunRail }, key)
      expect(c.cents, key).toBe(Math.round(t.option.finalPrice * 100))
    }
  }, 60_000)

  test('a proposal saved before (Better all 8 ft, the quote\'s own beside it) keeps its cards and prices once sent', async () => {
    const { m, job, p: now } = await setup()
    // The old way: Better was one width for the whole yard, the quote's own best price option a card of its own.
    const { data } = await (await import('../src/server/lib/estimates.js')).pricingWithData()
    const eight = data.config.fenceStyles.find((s: any) => s.name === "WV-ND 6'x8' Privacy")
    const betterOld = { ...priceOption(job.calcInput, eight), tier: { key: 'better' }, badge: 'Most popular' }
    const options = now.options.map((o: any) => (o.tier?.key === 'better' ? betterOld : o))
    options.push({ ...priceOption(job.calcInput, job.style), finalPrice: job.totals.price })
    const p: any = { ...now, options }
    const q = { fenceStyle: STYLE, status: 'SENT', finalPrice: job.totals.price, runRails: job.calc.perRunRail }
    expect(proposalSent(q)).toBe(true)
    // Nothing frozen: the cards it went out with (Better at all 8 ft), never repriced.
    expect(m.proposalFold(p, q)).toBeNull()
    const card = await customerCard(m, p, q, 'better')
    expect(card.cents).toBe(Math.round(betterOld.finalPrice * 100))
    expect(frozenOwnTierKey(p)).toBeNull()
    // Frozen when it was saved before sending: the folded card, as it went out.
    const frozen = { ...p, ownTier: m.ownTierToStamp(p, { fenceStyle: STYLE }, null, false) }
    expect(frozenOwnTierKey(frozen)).toBe('better')
    const card2 = await customerCard(m, frozen, q, 'better')
    expect(card2.cents).toBe(Math.round(job.totals.price * 100))
    // A save after sending keeps exactly the fold it went out with.
    expect(m.ownTierToStamp(p, { fenceStyle: STYLE }, p, true)).toBeNull()
    expect(m.ownTierToStamp(frozen, { fenceStyle: STYLE }, frozen, true)).toEqual(frozen.ownTier)
  }, 60_000)
})
