/**
 * Prices only for a Salesman or Installer (lib/costRedact.ts, lib/quotePricing.ts):
 * what the server sends them has no cost, and what they send never replaces
 * a saved cost.
 */

import { describe, test, expect } from 'vitest'
import { redactCosts, restoreCosts, hidesCosts } from '../src/server/lib/costRedact'
import { keepSavedCosts, requestFrom } from '../src/server/lib/quotePricing'
import { can as serverCan } from '../src/server/lib/permissions'

const quote = {
  id: 'q1', fenceStyle: "CL - 4' Galv", finalPrice: 5243.05, sections: 22,
  materialCost: 1333.01, laborCost: 900, tearOutCost: 0, totalCOGS: 2233.01, gmPct: 0.41,
  pullSheet: [{ item: 'Pipe, Galv, 1-5/8" X 8\' (SS40)', qty: 11, unitCost: 16.49, total: 181.39, costSource: 'inventory' }],
  pricing: { priceMethod: 'cost_factor', costFactor: 0.56, subRate: 23, overheadPct: 30, finalPrice: 5000, laborMode: 'subcontractor' },
  work: { type: 'repair', repair: { items: { replacePost: 2 } }, priced: { lines: [{ key: 'm', cents: 3298 }], materialCents: 3298, priceCents: 35000 }, description: 'Replace 2 posts' },
  proposal: { version: 1, options: [{ label: 'A', fenceStyle: "CL - 4' Galv", finalPrice: 5243.05, perFoot: 24, sections: 22, snapshot: { materialCost: 1333.01, pullSheet: [] } }] },
}

describe('who sees costs', () => {
  test('owner, admin, manager and office see costs; Salesman and Installer do not', () => {
    for (const r of ['super_admin', 'admin', 'manager', 'office_staff']) { expect(serverCan(r, 'costs.view')).toBe(true); expect(hidesCosts(r)).toBe(false) }
    for (const r of ['sales_rep', 'field_crew']) { expect(serverCan(r, 'costs.view')).toBe(false); expect(hidesCosts(r)).toBe(true) }
    // Not a CRM login (a customer, a portal login, no login): left to its own route.
    for (const r of [null, undefined, 'customer', 'support_agent']) expect(hidesCosts(r as any)).toBe(false)
  })
})

describe('reading: dates stay dates', () => {
  // A Salesman's card window drew a note's createdAt that had come out as {} and blanked the app (walkthrough, Oct 24, 2026).
  test('a Date is sent as its ISO text, not {}', () => {
    const at = new Date('2026-10-24T18:30:00Z')
    const r = redactCosts({ notes: [{ id: 'n1', body: 'Has 2 dogs', createdAt: at, updatedAt: at, deletedAt: null }], when: at }) as any
    expect(r.notes[0].createdAt).toBe('2026-10-24T18:30:00.000Z')
    expect(r.when).toBe('2026-10-24T18:30:00.000Z')
    expect(r.notes[0].deletedAt).toBeNull()
    // Something with its own JSON form is walked as that form, so a cost inside it still goes.
    expect(redactCosts({ x: { toJSON: () => ({ price: 5, unitCost: 2 }) } })).toEqual({ x: { price: 5 } })
  })
})

describe('reading: prices only', () => {
  test('a saved quote: every cost goes, every price stays', () => {
    const r = redactCosts(quote) as any
    for (const k of ['materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct']) expect(r[k]).toBeUndefined()
    expect(r.finalPrice).toBe(5243.05)
    expect(r.pullSheet[0]).toEqual({ item: quote.pullSheet[0].item, qty: 11, costSource: 'inventory' })
    expect(r.pricing).toEqual({ priceMethod: 'cost_factor', finalPrice: 5000, laborMode: 'subcontractor' })
    expect(r.work).toEqual({ type: 'repair', repair: { items: { replacePost: 2 } }, description: 'Replace 2 posts' })
    expect(r.proposal.options[0]).toEqual({ label: 'A', fenceStyle: "CL - 4' Galv", finalPrice: 5243.05, perFoot: 24, sections: 22 })
    const text = JSON.stringify(r)
    for (const v of ['1333.01', '16.49', '181.39', '0.56', '"subRate"', '2233.01', '3298']) expect(text).not.toContain(v)
    expect(quote.materialCost).toBe(1333.01)   // the input is not changed
  })
  test('Settings: rates, margins and the books go; the rest stays', () => {
    const business = {
      id: 'b', config: { company: { name: 'G' }, pricing: { laborMode: 'subcontractor', priceMethod: 'cost_factor', manHourRate: 25, subRateDefault: 23, subRateByCategory: { Vinyl: 23 }, overheadPct: 30, commissionSalesman: 0.1 },
        fenceStyles: [{ id: 's', name: 'WV', margin: 0.56, targetProfitPct: 14, subRate: 23, sectionsPerMH: 1.2, label: 'White' }], margins: { good: 0.34 },
        moveRepair: { minimumJobCents: 35000, pullNdLaborCents: 500, woodFactorPct: 115 } },
      plEntries: [{ amount: 1 }], balanceSheet: [], cashFlowManual: [], budget: { rent: 1 }, purchaseOrders: [{ total: 9 }], invoices: [{ total: 100 }],
    }
    const r = redactCosts(business) as any
    expect(r.config.pricing).toEqual({ laborMode: 'subcontractor', priceMethod: 'cost_factor' })
    expect(r.config.fenceStyles[0]).toEqual({ id: 's', name: 'WV', sectionsPerMH: 1.2, label: 'White' })
    expect(r.config.margins).toBeUndefined()
    expect(r.config.moveRepair).toEqual({ minimumJobCents: 35000 })
    for (const k of ['plEntries', 'balanceSheet', 'cashFlowManual', 'budget', 'purchaseOrders']) expect(r[k]).toBeUndefined()
    expect(r.invoices).toEqual([{ total: 100 }])   // a customer's invoice is a price
  })
  test('Inventory: unit costs and kit costs go, names and quantities stay', () => {
    const r = redactCosts({ items: [{ id: 'i', name: 'Pipe', unitCost: 16.49, category: 'CL' }], kits: [{ styleName: 'CL', kits: { line: [{ part: 'Pipe', qty: 1, fallbackCost: 16.49 }] } }] }) as any
    expect(r.items[0]).toEqual({ id: 'i', name: 'Pipe', category: 'CL' })
    expect(r.kits[0].kits.line[0]).toEqual({ part: 'Pipe', qty: 1 })
  })
})

describe('writing: a limited login never replaces a saved cost', () => {
  test('Settings sent back without costs (the voice switch): every cost is as saved; a cost they do send stays in, to be refused', () => {
    const saved = { pricing: { laborMode: 'subcontractor', subRateDefault: 23 }, fenceStyles: [{ id: 's', name: 'WV', margin: 0.56, subRate: 23 }, { id: 't', name: 'TV', margin: 0.5 }], voice: { onFor: [] } }
    const sent = { pricing: { laborMode: 'subcontractor' }, fenceStyles: [{ id: 't', name: 'TV' }, { id: 's', name: 'WV' }], voice: { onFor: ['u1'] } }
    expect(restoreCosts(sent, saved)).toEqual({
      pricing: { laborMode: 'subcontractor', subRateDefault: 23 },
      fenceStyles: [{ id: 't', name: 'TV', margin: 0.5 }, { id: 's', name: 'WV', margin: 0.56, subRate: 23 }],
      voice: { onFor: ['u1'] },
    })
    const cheaper = restoreCosts({ fenceStyles: [{ id: 's', name: 'WV', margin: 0.01 }] }, saved) as any
    expect(cheaper.fenceStyles[0]).toEqual({ id: 's', name: 'WV', margin: 0.01, subRate: 23 })
  })
  test('a quote saved without the server pricing it (a stage change): costs stay as saved', () => {
    const sent = { ...(redactCosts(quote) as any), status: 'SOLD', materialCost: 0, gmPct: 0, pullSheet: [] }
    const out = keepSavedCosts(sent, quote)
    for (const k of ['materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct', 'pullSheet']) expect(out[k]).toBeUndefined()
    expect(out.status).toBe('SOLD')
    expect(out.pricing).toEqual(quote.pricing)
    expect(out.work).toEqual(quote.work)
    expect(out.proposal).toEqual(quote.proposal)
  })
  test('the quote builder\'s request keeps the saved quote\'s cost choices and Overhead %; only prices come from the phone', () => {
    const { req, overheadPct } = requestFrom({ fenceStyle: "CL - 4' Galv", runs: [{ ft: 100, rail: 'auto' }], overrides: { priceMethod: 'manual', finalPrice: 6000, subRate: 1, costFactor: 0.99, laborCost: 1 } }, quote, () => null)
    expect(req.overrides).toEqual({ subRate: 23, costFactor: 0.56, priceMethod: 'manual', finalPrice: 6000 })
    expect(overheadPct).toBe(30)
    const fresh = requestFrom({ fenceStyle: 'WV', runs: [100], overrides: { subRate: 1 } }, null, () => null)
    expect(fresh.req.overrides).toEqual({})
    expect(fresh.overheadPct).toBeNull()
    expect(fresh.req.runs).toEqual([{ ft: 100, rail: 'auto' }])
  })
})
