/**
 * The prices the website quote showed the customer are the prices the
 * salesman's quote shows when the draft is opened (review, Oct 25, 2026: the
 * website said Good $9,346, the opened draft said Good $10,014). Read only:
 * the dev database's Settings, Inventory, kits and Good / Better / Best, a
 * yard drawn on the photo, priced as the website prices it and as the quote
 * builder prices the saved draft (its saved pricing choices included).
 */

import 'dotenv/config'
import { describe, test, expect } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('website prices = the opened draft\'s Good, Better, Best (dev database, read only)', async () => {
  const { pricingWithData } = await import('../src/server/lib/estimates.js')
  const { default: prisma } = await import('../src/server/lib/prisma.js')

  const at = { lat: 29.185118, lng: -82.134209 }
  const ft = (e: number, n: number) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
  const yards = {
    'backyard, one walk gate': [{ id: 'r1', pts: [ft(-30, 15), ft(-55, 15), ft(-55, 95), ft(55, 95), ft(55, 15), ft(30, 15)], start: 'house', end: 'house', typedFt: [null, null, 112, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }],
    'two walk gates': [{ id: 'r1', pts: [ft(-30, 15), ft(-55, 15), ft(-55, 95), ft(55, 95), ft(55, 15), ft(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, { type: 'walk', widthFt: 4, startFt: 30 }, null] }],
  }
  const picks = [
    { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' },
  ]

  test.each(Object.entries(yards))('%s: every option the customer could pick opens at the website\'s three prices', async (_name, runs) => {
    const { m, data } = await pricingWithData()
    const tierSets = (await prisma.proposalTierSet.findMany({})).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
    for (const pick of picks) {
      const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs }
      const yard = m.toYardLayout(drawing)
      const web = m.widgetPricesFor(data, yard, pick, tierSets)
      expect(web.options.length).toBeGreaterThan(0)
      const shown = Object.fromEntries(web.options.map((o: any) => [o.fenceStyle, Math.round(o.price * 100)]))
      for (const chosen of web.options) {
        // The draft as the website saves it (lib/widgetDrawQuote.ts): the chosen style, its price adjust,
        // and the pricing choices the job was priced with; the builder opens it with those as its overrides.
        const q = m.widgetQuoteFor(data, yard, chosen.fenceStyle, chosen.priceAdjust)
        const set = tierSets.find(t => t.category.trim().toLowerCase() === String(m.estimateStyles(data.config, data).find((s: any) => s.name === chosen.fenceStyle)?.category ?? '').trim().toLowerCase())
        const job = m.quoteJobFor(data, { ...q.req, overrides: { ...q.req.overrides, ...q.job.pricing }, tierSet: set ?? null })
        expect(Math.round(job.totals.price * 100)).toBe(shown[chosen.fenceStyle])
        const opened = Object.fromEntries((job.tiers ?? []).filter((t: any) => t.style && t.option && !t.sameAs).map((t: any) => [t.style.name, Math.round((t.style.name === chosen.fenceStyle ? job.totals.price : t.option.finalPrice) * 100)]))
        expect(opened, `opened with ${chosen.key}`).toEqual(shown)
      }
    }
  }, 60_000)
})
