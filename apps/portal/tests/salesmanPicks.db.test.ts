/**
 * The Salesman's quote is priced on the server (Nov 2 2026: she never sees margin, so her phone no longer gets the
 * margin, Target Profit, overhead or sub rates the quote math needs). The server says which section width of her
 * fence prices lowest (`cheapest`, the same pick as the Better option's "whichever prices lower"), lists each fence
 * once in its best price width (`oneWidth`), and sends her material and labor costs, never margin.
 *
 * Read only: the dev database's Settings, Inventory, kits and Good / Better / Best. Nothing is saved.
 */

import 'dotenv/config'
import { describe, test, expect } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman\'s picks, priced on the server (dev database, read only)', async () => {
  const { pricingWithData } = await import('../src/server/lib/estimates.js')
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { redactCosts, hideFor } = await import('../src/server/lib/costRedact.js')

  const runs = [20, 95, 128, 95, 20]

  // Good and Better at "whichever width prices lower", as these checks were written: Jonathan set them to 8 ft
  // on Nov 2 2026 (Settings → Good / Better / Best), so they read the set that way instead of as saved
  // (tests/mixedOptions.db.test.ts checks the set as saved).
  const cheapestWidths = (s: any) => (s ? { ...s, tiers: s.tiers.map((t: any) => (t.key === 'best' ? t : { ...t, width: 'cheapest' })) } : s)
  const request = (fenceStyle: string, extra: Record<string, unknown> = {}) => ({
    fenceStyle, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners: 4, ends: 2, walkGates: 1, dblGates: 1,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0, overrides: {}, jobType: 'new' as const, ...extra,
  })

  test('the cheapest width of her fence is Better\'s fence at Better\'s price; each fence once in her lists', async () => {
    const { m, data } = await pricingWithData()
    const sets = (await prisma.proposalTierSet.findMany({})).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
    const tierSet = cheapestWidths(sets.find(s => s.category.trim().toLowerCase() === 'vinyl') ?? null)
    const ways = ['WV-Auto ND Privacy', "WV-ND 6'x6' Privacy", "WV-ND 6'x8' Privacy"]
    const first = m.quoteView(m.quoteJobFor(data, request(ways[0], { widthWays: ways, oneWidth: true, tierSet, tierPrefs: { off: [], swap: {} } })))
    expect(ways).toContain(first.cheapest)
    const job = m.quoteJobFor(data, request(first.cheapest, { widthWays: ways, oneWidth: true, tierSet, tierPrefs: { off: [], swap: {} } }))
    const view = m.quoteView(job)
    expect(view.cheapest).toBe(first.cheapest)
    const better = view.tiers.find((t: any) => t.spec.key === 'better')
    expect(better.styleName).toBe(first.cheapest)
    expect(Math.round(better.option.finalPrice * 100)).toBe(Math.round(view.price * 100))
    for (const w of ways) {
      const v = m.quoteView(m.quoteJobFor(data, request(w)))
      expect(Math.round(view.price * 100)).toBeLessThanOrEqual(Math.round(v.price * 100))
    }
    // Her lists: the best price fence, not its fixed widths; other materials as they are.
    expect(view.oneWidth).toContain('WV-Auto ND Privacy')
    expect(view.oneWidth).not.toContain("WV-ND 6'x8' Privacy")
    expect(view.oneWidth).not.toContain("WV-ND 6'x6' Privacy")
    expect(view.oneWidth.some((n: string) => n.startsWith('Alum'))).toBe(true)
    // Not asked: nothing said.
    const plain = m.quoteView(m.quoteJobFor(data, request('WV-Auto ND Privacy')))
    expect(plain.cheapest).toBeNull()
    expect(plain.oneWidth).toBeNull()
  }, 60_000)

  test('she gets material and labor costs and no margin; the Installer gets neither', async () => {
    const { m, data } = await pricingWithData()
    const view = m.quoteView(m.quoteJobFor(data, request('WV-Auto ND Privacy')))
    expect(view.costs.materialCost).toBeGreaterThan(0)
    expect(view.costs.laborCost).toBeGreaterThan(0)
    const text = JSON.stringify(view)
    for (const k of ['gmPct', 'grossMargin', 'targetProfitPct', 'costFactor', 'overheadPct', 'commission"', 'margin"']) expect(text, k).not.toContain(`"${k.replace('"', '')}"`)
    const crew = redactCosts(view, hideFor('field_crew')) as any
    expect(crew.costs).toBeUndefined()
  }, 60_000)
})
