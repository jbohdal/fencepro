/**
 * A sent quote's Price step shows the tiers the customer's proposal shows (review Oct 27 2026: Carlton Williams'
 * sent best price quote read Good $8,780 under "Tiers as they were when this proposal was sent", priced at today's
 * dig set costs, while his proposal said Good $9,407; Better matched at $10,549).
 *
 * The builder now reads a sent proposal's tiers from the options frozen on it (web/src/sentTiers.ts sentTierCards)
 * while the fence is unchanged, never priced again; once the fence is changed the line over them says these are new
 * prices and what a save does (sentTiersNote). Nothing here reprices a proposal.
 *
 * Read only: the dev database's Settings, Inventory, kits, Good / Better / Best and its sent quotes. Nothing is saved.
 */

import 'dotenv/config'
import { describe, test, expect } from 'vitest'
import { sentTiersNote } from '../../web/src/sentTiers'

describe('the line over a sent quote\'s tiers says what they are', () => {
  test('unchanged: the prices on the customer\'s proposal', () => {
    expect(sentTiersNote({ asSent: true, fenceChanged: false, signed: false, sentPricesChanged: false })).toEqual({ kind: 'sent', text: 'As sent: the prices on the customer\'s proposal.' })
    expect(sentTiersNote({ asSent: true, fenceChanged: false, signed: true, sentPricesChanged: false }).text).toBe('As signed: the prices on the customer\'s proposal.')
  })
  test('the yard changed: never "as sent"; new prices, and what saving does', () => {
    const n = sentTiersNote({ asSent: false, fenceChanged: true, signed: false, sentPricesChanged: false })
    expect(n.kind).toBe('changed')
    expect(n.text).not.toMatch(/\bas (they were when )?sent\b/i)
    expect(n.text).toMatch(/new prices/)
    expect(n.text).toMatch(/keeps the sent prices until this quote is saved; saving puts these new prices on it\.$/)
    // The quote's own price moved too: the save asks first.
    expect(sentTiersNote({ asSent: false, fenceChanged: true, signed: false, sentPricesChanged: true }).text).toMatch(/unless you keep the sent prices when asked/)
    // Signed: the proposal stays; a change order carries the change.
    const s = sentTiersNote({ asSent: false, fenceChanged: true, signed: true, sentPricesChanged: false })
    expect(s.text).toMatch(/signed proposal does not change; the change goes on a change order/)
    expect(s.text).not.toMatch(/\bas signed\b/i)
  })
  test('no tier words in the line (it is staff only, but kept plain)', () => {
    for (const asSent of [true, false]) for (const fenceChanged of [true, false]) for (const signed of [true, false]) {
      expect(sentTiersNote({ asSent, fenceChanged, signed, sentPricesChanged: false }).text).not.toMatch(/\b(Good|Better|Best)\b/)
    }
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a sent quote\'s builder tiers are the proposal\'s (dev database, read only)', async () => {
  const { pricingWithData } = await import('../src/server/lib/estimates.js')
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { styleRecords } = await import('../src/server/lib/ownTier.js')
  const { proposalPage } = await import('../src/server/routes/proposal.js')
  const { customerFenceName, railsOf } = await import('../src/server/lib/customerFenceName.js')
  const { sentTierCards } = await import('../../web/src/sentTiers')

  /** Every tier card the customer's page shows: tier key → price in cents and the fence name (routes/proposal.ts). */
  async function customerCards(p: any, q: any): Promise<Record<string, { cents: number; name: string }>> {
    const { p: shown, view } = await proposalPage({ accountId: q.accountId, acceptedAt: null, fenceStyle: q.fenceStyle, finalPrice: q.finalPrice, status: q.status, soldAt: q.soldAt ?? null, firstViewedAt: q.firstViewedAt ?? null, viewCount: q.viewCount ?? 0 }, p)
    const out: Record<string, { cents: number; name: string }> = {}
    const at = (view.order ?? shown.options.map((_: unknown, i: number) => i)).filter((i: number) => !view.hidden.includes(i))
    for (const i of at) {
      const o = shown.options[i]
      const key = o?.tier?.key
      if (!key || out[key]) continue
      out[key] = { cents: Math.round(o.finalPrice * 100), name: customerFenceName(o.label, railsOf(o as any, o.fenceStyle === q.fenceStyle ? q.runRails : null)) }
    }
    return out
  }
  const builderCards = (p: any, q: any, styleOf: any) =>
    Object.fromEntries(Object.entries(sentTierCards(p, q, styleOf)).map(([k, c]) => [k, { cents: Math.round(c.price * 100), name: c.label }]))

  test('the example: Carlton\'s yard, sent when dig set cost more; every tier reads the proposal\'s price, not today\'s', async () => {
    const { m, data } = await pricingWithData()
    const accountId = (await resolveIntakeAccountId())!
    const sets = (await prisma.proposalTierSet.findMany({})).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
    const tierSet = sets.find(s => s.category.trim().toLowerCase() === 'vinyl') ?? null
    expect(tierSet, 'the dev database has a vinyl Good / Better / Best').toBeTruthy()
    // 260 ft of white vinyl privacy, best price, no dig: seven runs, a walk gate and a double gate.
    const STYLE = 'WV-Auto ND Privacy'
    const runs = [3.5, 3, 87, 90, 64, 6.25, 6.25]
    const req = {
      fenceStyle: STYLE, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners: 4, ends: 6, walkGates: 1, dblGates: 1,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new' as const,
      tierSet, tierPrefs: { off: [], swap: {} },
    }
    const job = m.quoteJobFor(data, req)
    const live: Record<string, number> = Object.fromEntries(job.tiers.filter((t: any) => t.option).map((t: any) => [t.spec.key, Math.round(t.option.finalPrice * 100)]))
    expect(Object.keys(live).sort()).toEqual(['best', 'better', 'good'])
    // The proposal as it went out: Good priced when dig set cost $627 more than today (the review's $9,407 against $8,780).
    const options = job.proposalOptions.map((o: any) => (!o.tier && o.fenceStyle === STYLE ? { ...o, finalPrice: job.totals.price }
      : o.tier?.key === 'good' ? { ...o, finalPrice: o.finalPrice + 627, perFoot: Math.round(((o.finalPrice + 627) / 260) * 100) / 100 } : { ...o }))
    const p: any = { version: 1, options, recommended: 1, tierSet, tierPrefs: req.tierPrefs }
    const q = { accountId, fenceStyle: STYLE, status: 'SENT', finalPrice: job.totals.price, runRails: job.calc.perRunRail, viewCount: 1 }
    const styleOf = await styleRecords()
    for (const sentBeforeFolding of [true, false]) {
      // Sent before folding existed (no fold frozen, as Carlton's), or folded when saved before sending.
      const sent = sentBeforeFolding ? p : { ...p, ownTier: m.ownTierToStamp(p, { fenceStyle: STYLE }, null, false, styleOf) }
      const builder = builderCards(sent, q, styleOf)
      const customer = await customerCards(sent, q)
      expect(builder).toEqual(customer)
      expect(Object.keys(builder).sort()).toEqual(['best', 'better', 'good'])
      // Good: the proposal's price, not today's (the bug: the builder showed today's).
      expect(builder.good.cents).toBe(live.good + 62700)
      expect(builder.good.cents).not.toBe(live.good)
    }
  }, 60_000)

  test('every sent or signed quote in the dev database: the builder\'s as sent tiers are the customer\'s cards', async () => {
    const styleOf = await styleRecords()
    const quotes = await prisma.savedQuote.findMany({ where: { deletedAt: null, OR: [{ status: { in: ['SENT', 'SOLD'] } }, { shareToken: { not: null } }] } })
    let checked = 0
    for (const q of quotes) {
      const p: any = q.proposal
      if (!p?.tierSet || !Array.isArray(p.options) || !p.options.some((o: any) => o?.tier?.key)) continue
      if (q.work && ['move', 'repair'].includes((q.work as any).type)) continue
      const builder = builderCards(p, q, styleOf)
      const customer = await customerCards(p, q)
      // A tier the page hides as the same fence as an earlier card shows that card's price on the builder (the same fence, the same price).
      for (const [k, c] of Object.entries(customer)) expect(builder[k], `${q.customerName} ${k}`).toEqual(c)
      checked++
    }
    expect(checked).toBeGreaterThan(5)
  }, 120_000)
})
