/**
 * Job costing math (lib/jobCostingMath.ts): the quoted cost at signing, the
 * actual cost from a takeoff (used x landed cost, job lot invoices first,
 * returns not a job cost, sub or crew labor), the comparison, the report.
 */

import { describe, test, expect } from 'vitest'
import {
  quotedCostOf, linesFromQuoted, laborFromQuoted, actualCostOf, subPaidOf, compare, jobLotUnitCosts, groupReport, partTrends, partsOf, otherQuotedMaterial,
  subRateFor, findItemId, marginOf, type TakeoffLine, type UnitCost, type ReportJob,
} from '../src/server/lib/jobCostingMath'
import { isCostKey, redactCosts } from '../src/server/lib/costRedact'

const inventory = [
  { id: 'post', name: 'Vinyl Post 5x5', unitCost: 13.5 },
  { id: 'picket', name: 'Vinyl Picket', unitCost: 2.79 },
  { id: 'concrete', name: 'Concrete 50 lb', unitCost: 6.5 },
  { id: 'panel', name: 'Vinyl Panel 6x8', unitCost: 85 },
]
const quote = {
  id: 'q1', fenceStyle: 'WV-ND 6x8 Privacy', salesRep: 'Jonathan Bohdal', sections: 10, runs: [40, 40],
  materialCost: 544, laborCost: 240, tearOutCost: 0, totalCOGS: 784, finalPrice: 1500,
  pullSheet: [
    { item: 'Vinyl Post 5x5', qty: 10, unitCost: 13.5, total: 135, costSource: 'inventory' },
    { item: 'Vinyl Picket', qty: 100, unitCost: 2.79, total: 279, costSource: 'inventory' },
    { item: 'Concrete 50 lb', qty: 20, unitCost: 6.5, total: 130, costSource: 'inventory' },
  ],
  pricing: { laborMode: 'subcontractor', subUnit: 'section' }, work: null,
}
const pricing = { laborMode: 'subcontractor', subUnit: 'section', manHourRate: 25, subRateByCategory: { Vinyl: 24 } }
const quoted = quotedCostOf(quote, { inventory, pricing, style: { name: 'WV-ND 6x8 Privacy', category: 'Vinyl' }, signedVia: 'proposal', signedAt: new Date('2026-10-01T15:00:00Z') })

describe('quoted cost at signing', () => {
  test('the pull sheet as priced, in cents, matched to Inventory', () => {
    expect(quoted.lines.map(l => [l.part, l.inventoryItemId, l.qty, l.unitCostCents, l.totalCostCents])).toEqual([
      ['Vinyl Post 5x5', 'post', 10, 1350, 13500], ['Vinyl Picket', 'picket', 100, 279, 27900], ['Concrete 50 lb', 'concrete', 20, 650, 13000],
    ])
    expect([quoted.priceCents, quoted.materialCents, quoted.laborCents, quoted.tearOutCents, quoted.totalCents]).toEqual([150000, 54400, 24000, 0, 78400])
    expect(quoted.labor).toEqual({ mode: 'sub', subUnit: 'section', subUnits: 10, subRateCostCents: 2400, hourlyCostCents: 2500 })
    expect(quoted.footage).toBe(80)
  })
  test('material on the quote that is not a pull sheet line is kept apart (a move\'s disposal)', () => {
    const q = quotedCostOf({ ...quote, materialCost: 594, totalCOGS: 834 }, { inventory, pricing, signedVia: 'app', signedAt: new Date() })
    expect(otherQuotedMaterial(q)).toBe(5000)
  })
  test('a move or repair (priced lines) is flat labor; the job type is kept', () => {
    const q = quotedCostOf({ ...quote, work: { type: 'repair' } }, { inventory, pricing, signedVia: 'app', signedAt: new Date() })
    expect(q.jobType).toBe('repair')
    expect(q.labor.mode).toBe('flat')
  })
  test('the sub rate: the quote\'s own, the style\'s, its category\'s, the default', () => {
    expect(subRateFor({ category: 'Vinyl' }, pricing, 30)).toBe(30)
    expect(subRateFor({ category: 'Vinyl', subRate: 26 }, pricing)).toBe(26)
    expect(subRateFor({ category: 'Vinyl' }, pricing)).toBe(24)
    expect(subRateFor({ category: 'Aluminum' }, { ...pricing, subRateDefault: 18 })).toBe(18)
    expect(subRateFor(undefined, {})).toBe(0)
  })
  test('Inventory names match ignoring case and spaces', () => {
    expect(findItemId(inventory, 'vinyl  picket')).toBe('picket')
    expect(findItemId(inventory, 'Something else')).toBeNull()
  })
})

/** The worked example in the report: a full job with an extra, a broken panel, returns and a job lot invoice. */
function takeoffOfExample(): TakeoffLine[] {
  const lines = linesFromQuoted(quoted.lines, k => `t1:${k}`)
  const set = (part: string, patch: Partial<TakeoffLine>) => { const i = lines.findIndex(l => l.part === part); lines[i] = { ...lines[i], ...patch } }
  set('Vinyl Post 5x5', { usedQty: 11 })                                  // one more post than the pull sheet
  set('Vinyl Picket', { usedQty: 95, shopReturnQty: 5 })                   // 5 pickets back to the shop
  set('Concrete 50 lb', { usedQty: 22, vendorReturnQty: 3 })               // 2 more bags used; 3 unopened back to the vendor
  lines.push({ id: 't1:x1', key: null, part: 'Vinyl Panel 6x8', inventoryItemId: 'panel', plannedQty: 0, usedQty: 1, shopReturnQty: 0, vendorReturnQty: 0, extra: true, reason: 'broken', note: 'Cracked unloading', photoClientId: 'photo-1234' })
  return lines
}
const landed: Record<string, UnitCost> = { post: { cents: 1400, source: 'inventory' }, picket: { cents: 279, source: 'inventory' }, panel: { cents: 8500, source: 'invoice', invoiceId: 'inv-9' } }

describe('actual cost', () => {
  const jobLot = jobLotUnitCosts([
    { invoiceId: 'jl-1', inventoryItemId: 'concrete', quantity: 10, landedCents: 5800 },  // 10 bags, $58.00 landed (tax and freight in)
    { invoiceId: 'jl-1', inventoryItemId: 'concrete', quantity: 30, landedCents: 18210 }, // 30 bags, $182.10 landed
    { invoiceId: 'jl-1', inventoryItemId: null, quantity: 1, landedCents: 999 },
  ])
  const unitCostOf = (l: TakeoffLine): UnitCost => (l.inventoryItemId && jobLot.get(l.inventoryItemId)) || (l.inventoryItemId && landed[l.inventoryItemId]) || { cents: 0, source: 'none' }
  const lines = takeoffOfExample()
  const actual = actualCostOf({ lines, labor: { mode: 'sub', subUnit: 'section', subUnits: 10, crew: [] }, installDate: '2026-10-14' }, {
    quoted, unitCostOf, hourlyCostCents: 2500, subRateCostCents: 0, otherLaborCostCents: 5000, frozen: true,
  })

  test('a job lot invoice\'s landed cost (line totals over quantity) replaces Inventory for its parts', () => {
    expect(jobLot.get('concrete')).toEqual({ cents: 600, source: 'job_lot', invoiceId: 'jl-1' }) // ($58.00 + $182.10) / 40 = $6.0025
    expect(jobLot.size).toBe(1)
  })
  test('material = used x landed cost; returns to the shop or the vendor are not a job cost', () => {
    expect(actual.lines.map(l => [l.part, l.usedQty, l.unitCostCents, l.totalCostCents, l.costSource])).toEqual([
      ['Vinyl Post 5x5', 11, 1400, 15400, 'inventory'],
      ['Vinyl Picket', 95, 279, 26505, 'inventory'],
      ['Concrete 50 lb', 22, 600, 13200, 'job_lot'],
      ['Vinyl Panel 6x8', 1, 8500, 8500, 'invoice'],
    ])
    expect(actual.materialCents).toBe(63605)
  })
  test('sub labor = sections paid x the sub rate the quote was priced with, plus other labor pay', () => {
    expect(actual.laborCents).toBe(29000)
    expect(actual.laborMath).toBe('10 sections paid × $24.00 + $50.00 other labor (sub rate saved at signing)')
    expect(actual.totalCents).toBe(92605)
  })
  test('crew labor = hours x the hourly rate', () => {
    const a = actualCostOf({ lines: [], labor: { mode: 'crew', subUnit: 'section', subUnits: 0, crew: [{ id: 'a', name: 'Al', hours: 9 }, { id: 'b', name: 'Bo', hours: 8.5 }] }, installDate: '2026-10-14' }, {
      quoted: null, unitCostOf, hourlyCostCents: 2500, subRateCostCents: 0, otherLaborCostCents: 0, frozen: false,
    })
    expect(a.laborCents).toBe(43750)
    expect(a.laborMath).toBe("17.5 crew hours × $25.00/hr (Settings' hourly rate today (none saved at signing))")
  })

  // Jonathan, Oct 20, 2026: labor uses the rates saved at signing, unless the takeoff records what the sub was paid.
  const crew = [{ id: 'a', name: 'Al', hours: 9 }, { id: 'b', name: 'Bo', hours: 8.5 }]
  test('sub labor uses the sub rate saved at signing, not Settings today', () => {
    // Settings now say $30 a section; the quote was signed at $24.
    const a = actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, crew: [] }, installDate: '2026-10-14' }, { quoted, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 0, frozen: false })
    expect(a.laborCents).toBe(24000)
    expect(a.laborMath).toBe('10 sections paid × $24.00 (sub rate saved at signing)')
  })
  test('"Sub paid $" on the takeoff replaces units x rate', () => {
    const a = actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, subPaidCents: 27550, crew: [] }, installDate: '2026-10-14' }, { quoted, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 1000, frozen: false })
    expect(a.laborCents).toBe(28550)
    expect(a.laborMath).toBe('Sub paid $275.50 + $10.00 other labor (entered on the takeoff)')
    // Blank (null) goes back to units x the rate saved at signing; $0 entered is $0 paid.
    expect(actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, subPaidCents: null, crew: [] }, installDate: '2026-10-14' }, { quoted, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 0, frozen: false }).laborCents).toBe(24000)
    expect(actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, subPaidCents: 0, crew: [] }, installDate: '2026-10-14' }, { quoted, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 0, frozen: false }).laborCents).toBe(0)
    // A crew job ignores a sub amount left on the takeoff.
    expect(actualCostOf({ lines: [], labor: { mode: 'crew', subUnit: 'section', subUnits: 0, subPaidCents: 27550, crew }, installDate: '2026-10-14' }, { quoted, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 0, frozen: false }).laborCents).toBe(43750)
  })
  test('crew hours use the hourly rate saved at signing (frozen), not Settings today', () => {
    const a = actualCostOf({ lines: [], labor: { mode: 'crew', subUnit: 'section', subUnits: 0, crew }, installDate: '2026-10-14' }, { quoted, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 0, frozen: false })
    expect(a.laborCents).toBe(43750) // 17.5 h x $25 saved at signing, not $40 today
    expect(a.laborMath).toBe('17.5 crew hours × $25.00/hr (hourly rate saved at signing)')
  })
  test('no quoted cost (signed before job costing): Settings today, said so', () => {
    const a = actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, crew: [] }, installDate: '2026-10-14' }, { quoted: null, unitCostOf, hourlyCostCents: 4000, subRateCostCents: 3000, otherLaborCostCents: 0, frozen: false })
    expect(a.laborCents).toBe(30000)
    expect(a.laborMath).toBe("10 sections paid × $30.00 (Settings' sub rate today (none saved at signing))")
  })
  test('subPaidOf: whole cents, blank is none', () => {
    expect([subPaidOf({}), subPaidOf({ subPaidCents: null }), subPaidOf({ subPaidCents: '' }), subPaidOf({ subPaidCents: 1234.4 }), subPaidOf({ subPaidCents: -5 }), subPaidOf({ subPaidCents: 0 })]).toEqual([null, null, null, 1234, null, 0])
  })
  test('tear out and other quoted material are carried as quoted', () => {
    const q = { ...quoted, tearOutCents: 9500, materialCents: quoted.materialCents + 1000, totalCents: quoted.totalCents + 10500 }
    const a = actualCostOf({ lines, labor: { mode: 'sub', subUnit: 'section', subUnits: 10, crew: [] }, installDate: '2026-10-14' }, { quoted: q, unitCostOf, hourlyCostCents: 2500, subRateCostCents: 0, otherLaborCostCents: 0, frozen: false })
    expect([a.tearOutCents, a.otherMaterialCents, a.totalCents]).toEqual([9500, 1000, 63605 + 24000 + 9500 + 1000])
  })

  test('quoted vs actual, line by line, with profit and margin', () => {
    const c = compare(quoted, actual, 150000)
    expect(c.rows.map(r => [r.part, r.plannedQty, r.usedQty, r.qtyDiff, r.quotedCostCents, r.actualCostCents, r.diffCostCents, r.extra])).toEqual([
      ['Vinyl Post 5x5', 10, 11, 1, 13500, 15400, 1900, false],
      ['Vinyl Picket', 100, 95, -5, 27900, 26505, -1395, false],
      ['Concrete 50 lb', 20, 22, 2, 13000, 13200, 200, false],
      ['Vinyl Panel 6x8', 0, 1, 1, 0, 8500, 8500, true],
    ])
    expect(c.rows[1].shopReturnQty).toBe(5)
    expect(c.rows[2].vendorReturnQty).toBe(3)
    expect(c.quoted).toMatchObject({ totalCents: 78400, profitCents: 71600, marginPct: 47.7 })
    expect(c.actual).toMatchObject({ totalCents: 92605, profitCents: 57395, marginPct: 38.3 })
    expect(c.diffCents).toBe(14205)
  })
  test('no takeoff: no actual (nothing guessed)', () => {
    const c = compare(quoted, null, 150000)
    expect(c.actual).toBeNull()
    expect(c.diffCents).toBeNull()
    expect(c.rows.every(r => r.usedQty === 0 && r.diffCostCents === 0)).toBe(true)
  })
  test('margin of nothing is 0', () => { expect(marginOf(0, 500)).toEqual({ profitCents: -500, marginPct: 0 }) })
})

describe('takeoff starts from the pull sheet', () => {
  test('used = planned, labor as priced', () => {
    const l = linesFromQuoted(quoted.lines, k => `x:${k}`)
    expect(l.every(x => x.usedQty === x.plannedQty && !x.extra && x.id === `x:${x.key}`)).toBe(true)
    expect(laborFromQuoted(quoted.labor, { mode: 'crew', subUnit: 'section', subUnits: 0 })).toEqual({ mode: 'sub', subUnit: 'section', subUnits: 10, crew: [] })
    expect(laborFromQuoted(null, { mode: 'crew', subUnit: 'foot', subUnits: 0 }).mode).toBe('crew')
  })
  test('the crew\'s takeoff has no field the cost scrubber would take, and quantities survive it', () => {
    const line = takeoffOfExample()[0]
    expect(Object.keys(line).filter(isCostKey)).toEqual([])
    expect(redactCosts({ lines: [line], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, crew: [{ id: 'a', name: 'Al', hours: 8 }] } })).toEqual({ lines: [line], labor: { mode: 'sub', subUnit: 'section', subUnits: 10, crew: [{ id: 'a', name: 'Al', hours: 8 }] } })
  })
  test('every cost field in the quoted and actual cost is one the scrubber takes', () => {
    for (const k of ['unitCostCents', 'totalCostCents', 'subRateCostCents', 'hourlyCostCents', 'otherLaborCostCents', 'materialCents', 'laborCents', 'actualCost', 'crewLaborCostCents']) expect(isCostKey(k)).toBe(true)
  })
})

describe('report', () => {
  const job = (o: Partial<ReportJob>): ReportJob => ({ jobId: 'j', customerName: 'A', fenceStyle: 'WV', salesRep: 'Sam', month: '2026-10', priceCents: 100000, quotedCents: 60000, actualCents: 65000, takeoff: 'approved', parts: [], ...o })
  const jobs = [
    job({ jobId: '1', parts: [{ part: 'Post', plannedQty: 10, usedQty: 11 }, { part: 'Concrete', plannedQty: 20, usedQty: 18 }] }),
    job({ jobId: '2', salesRep: 'Lee', month: '2026-09', priceCents: 200000, quotedCents: 120000, actualCents: 110000, parts: [{ part: 'Post', plannedQty: 8, usedQty: 10 }] }),
    job({ jobId: '3', quotedCents: null, actualCents: null, takeoff: 'none' }),
    job({ jobId: '4', quotedCents: null, actualCents: 50000 }),
  ]
  test('totals add only jobs with a quoted cost and an approved takeoff; others are "No takeoff" or not costed', () => {
    const [all] = groupReport(jobs, () => 'All')
    expect(all).toMatchObject({ jobs: 4, costed: 2, noTakeoff: 1, priceCents: 300000, quotedCents: 180000, actualCents: 175000, diffCents: -5000, profitCents: 125000, marginPct: 41.7 })
  })
  test('by salesman and by month', () => {
    expect(groupReport(jobs, j => j.salesRep).map(g => [g.key, g.jobs, g.costed])).toEqual([['Sam', 3, 1], ['Lee', 1, 1]])
    expect(groupReport(jobs, j => j.month).map(g => [g.key, g.actualCents])).toEqual([['2026-10', 65000], ['2026-09', 110000]])
  })
  test('parts most often over or under the pull sheet', () => {
    expect(partTrends(jobs)).toEqual([
      { part: 'Post', jobs: 2, overJobs: 2, underJobs: 0, overQty: 3, underQty: 0, netQty: 3 },
      { part: 'Concrete', jobs: 1, overJobs: 0, underJobs: 1, overQty: 0, underQty: 2, netQty: -2 },
    ])
  })
  test('a part on two lines of one takeoff is one', () => {
    const l = takeoffOfExample()
    l.push({ ...l[0], id: 'dup', key: null, extra: true, plannedQty: 0, usedQty: 2 })
    expect(partsOf(l).find(p => p.part === 'Vinyl Post 5x5')).toEqual({ part: 'Vinyl Post 5x5', plannedQty: 10, usedQty: 13 })
  })
})
