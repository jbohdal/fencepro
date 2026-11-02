/**
 * Job costing: the real labor cost (Jonathan, Nov 2 2026). The rule every
 * reader uses, the form's total and override, and what a new entry fills in.
 */

import { describe, test, expect } from 'vitest'
import { crewTotalCents, crewLineCents, entryLaborCents, laborBasis, laborShown, oldHoursCents, plLaborCents, resultOf, estMargin } from '../../web/src/jobCostLabor'
import { workOutPrefill, type PrefillInput } from '../src/server/lib/jobCostPrefill'

const quote = { laborCost: 769, adjLaborHrs: 0 }

describe('labor cost of a saved entry', () => {
  test('the saved labor cost is the cost: hours never change it, at any number', () => {
    for (const actualLaborHrs of [0, 1, 40, 999]) {
      expect(entryLaborCents({ actualLaborCostCents: 76900, crew: [], actualLaborHrs }, quote)).toBe(76900)
    }
  })
  test('a saved cost beats the crew lines (an override stays)', () => {
    const crew = [{ name: 'Danny', hours: 8, rate: 25 }]
    expect(entryLaborCents({ actualLaborCostCents: 50000, crew, actualLaborHrs: 8 }, quote)).toBe(50000)
  })
  test('a saved cost of $0 is a saved cost, not missing', () => {
    expect(laborBasis({ actualLaborCostCents: 0, crew: [] })).toBe('saved')
    expect(entryLaborCents({ actualLaborCostCents: 0, crew: [], actualLaborHrs: 10 }, quote)).toBe(0)
  })
  test('old entry with crew lines: the crew total, as it always showed', () => {
    const e = { crew: [{ name: 'Danny', hours: 1, rate: 770 }], actualLaborHrs: 0 }
    expect(laborBasis(e)).toBe('crew')
    expect(entryLaborCents(e, quote)).toBe(77000)
  })
  test('old entry with no crew: the old number until Jonathan OKs the fix, and it is marked', () => {
    const e = { crew: [], actualLaborHrs: 10 }
    expect(laborBasis(e)).toBe('hours')
    expect(entryLaborCents(e, quote)).toBe(22000) // no quoted hours: 10 x $22
    expect(entryLaborCents(e, { laborCost: 500, adjLaborHrs: 20 })).toBe(25000) // 10 x $25
    expect(oldHoursCents({ actualLaborHrs: 0 }, quote)).toBe(0)
  })
  test('crew pay adds up in whole cents', () => {
    expect(crewLineCents({ hours: 7.5, rate: 22.33 })).toBe(16748)
    expect(crewTotalCents([{ name: 'A', hours: 7.5, rate: 22.33 }, { name: 'B', hours: 8, rate: 20 }])).toBe(32748)
    expect(crewTotalCents(null)).toBe(0)
  })
})

describe('the form: total and override', () => {
  const f = { typed: false, typedCents: 0, crewCents: 0, baseCents: 76900 }
  test('prefill, until a crew total flows in', () => {
    expect(laborShown(f)).toBe(76900)
    expect(laborShown({ ...f, crewCents: 64000 })).toBe(64000)
  })
  test('a typed number stays whatever the crew adds up to', () => {
    expect(laborShown({ ...f, typed: true, typedCents: 70000, crewCents: 64000 })).toBe(70000)
  })
  test('crew taken off again: back to the prefill', () => {
    expect(laborShown({ ...f, crewCents: 0 })).toBe(76900)
  })
})

describe('profit and margin', () => {
  test('Kristi Murphy at the estimate: price less cost', () => {
    expect(resultOf(891427, 499199)).toEqual({ priceCents: 891427, costCents: 499199, profitCents: 392228, marginPct: 44 })
  })
  test('no price: margin 0, never a division by zero', () => {
    expect(resultOf(0, 100).marginPct).toBe(0)
  })
  test('the estimate is on the same footing: a job right on estimate shows the same margin', () => {
    const q = { finalPrice: 8914.27, totalCOGS: 4991.99, gmPct: 0.35 }
    expect(estMargin(q)).toBeCloseTo((8914.27 - 4991.99) / 8914.27, 6)
    expect(estMargin({ finalPrice: 9000, totalCOGS: 0, gmPct: 0 })).toBe(0)
  })
})

describe('the P&L', () => {
  test('uses the saved labor cost, not hours', () => {
    expect(plLaborCents({ actualLaborCostCents: 76900, actualLaborHrs: 100 }, 25, false)).toBe(76900)
  })
  test('old entries read as before: crew lines, else hours at the man hour rate', () => {
    expect(plLaborCents({ crew: [{ hours: 2, rate: 30 }], actualLaborHrs: 100 }, 25, false)).toBe(6000)
    expect(plLaborCents({ actualLaborHrs: 10 }, 25, false)).toBe(25000)
  })
  test('a sub job with its bill linked is not counted twice', () => {
    expect(plLaborCents({ actualLaborCostCents: 76900, laborKind: 'sub' }, 25, true)).toBe(0)
    expect(plLaborCents({ actualLaborCostCents: 76900, laborKind: 'sub' }, 25, false)).toBe(76900)
    expect(plLaborCents({ actualLaborCostCents: 76900, laborKind: 'crew' }, 25, true)).toBe(76900)
  })
})

describe('what a new entry fills in', () => {
  const base: PrefillInput = {
    quote: { laborCents: 76900, materialCents: 422299, laborMode: 'subcontractor' }, settingsLaborMode: 'subcontractor',
    takeoff: null, bills: [], invoices: [], orders: [],
  }
  const bill = (category: string, totalCents: number, billNumber = 'B1') => ({ billNumber, category, totalCents })

  test('a sub job with nothing recorded: the quote, and it says so', () => {
    const p = workOutPrefill(base)
    expect([p.sub, p.labor.cents, p.labor.source, p.material.cents, p.material.source]).toEqual([true, 76900, 'quote', 422299, 'quote'])
    expect(p.material.words).toMatch(/quote estimate/i)
  })
  test('"Sub paid $" on the takeoff fills Paid to sub', () => {
    const p = workOutPrefill({ ...base, takeoff: { mode: 'sub', subPaidCents: 77000, crewHours: 0 } })
    expect([p.labor.cents, p.labor.source]).toEqual([77000, 'takeoff'])
  })
  test('a sub bill on the job fills it; several are added', () => {
    const p = workOutPrefill({ ...base, bills: [bill('subcontractor', 40000), bill('subcontractor', 30000, 'B2')] })
    expect([p.labor.cents, p.labor.source]).toEqual([70000, 'bills'])
    expect(p.labor.words).toContain('B1, B2')
  })
  test('takeoff and bill are the same pay: never added, and a difference is said out loud', () => {
    const p = workOutPrefill({ ...base, takeoff: { mode: 'sub', subPaidCents: 77000, crewHours: 0 }, bills: [bill('subcontractor', 70000)] })
    expect(p.labor.cents).toBe(77000)
    expect(p.labor.note).toMatch(/\$700\.00/)
    const same = workOutPrefill({ ...base, takeoff: { mode: 'sub', subPaidCents: 77000, crewHours: 0 }, bills: [bill('subcontractor', 77000)] })
    expect(same.labor.note).toBe('')
  })
  test('sub job or crew job, in order', () => {
    expect(workOutPrefill({ ...base, quote: { ...base.quote, laborMode: 'hourly' } }).sub).toBe(false)
    expect(workOutPrefill({ ...base, quote: { ...base.quote, laborMode: 'hourly' }, bills: [bill('subcontractor', 100)] }).sub).toBe(true)
    expect(workOutPrefill({ ...base, quote: { ...base.quote, laborMode: 'hourly' }, takeoff: { mode: 'sub', subPaidCents: null, crewHours: 0 } }).sub).toBe(true)
    expect(workOutPrefill({ ...base, quote: { ...base.quote, laborMode: null }, takeoff: { mode: 'crew', subPaidCents: null, crewHours: 8 } }).sub).toBe(false)
    const old = workOutPrefill({ ...base, quote: { ...base.quote, laborMode: null } })
    expect(old.sub).toBe(true)
    expect(old.kindWhy).toMatch(/Settings/)
  })
  test('a crew job keeps the quote labor; a labor bill is mentioned, not used', () => {
    const p = workOutPrefill({ ...base, quote: { ...base.quote, laborMode: 'hourly' }, bills: [bill('labor', 5000)] })
    expect([p.labor.cents, p.labor.source]).toEqual([76900, 'quote'])
    expect(p.labor.note).toMatch(/\$50\.00/)
  })
  test('material: the Sales Order when there is no bill, and it says it is not billed prices', () => {
    const p = workOutPrefill({ ...base, orders: [{ status: 'pending', totalCostCents: 400000 }] })
    expect([p.material.cents, p.material.source]).toEqual([400000, 'sales_order'])
    expect(p.material.words).toMatch(/not marked ordered yet/)
  })
  test('material: a bill and a Sales Order are never added; bills win and the screen says the app cannot tell', () => {
    const p = workOutPrefill({ ...base, bills: [bill('materials', 450000)], orders: [{ status: 'ordered', totalCostCents: 422299 }] })
    expect([p.material.cents, p.material.source]).toEqual([450000, 'bills'])
    expect(p.material.note).toMatch(/cannot tell/)
  })
  test('material: a job lot invoice with no bill counts with the bills', () => {
    const p = workOutPrefill({ ...base, bills: [bill('materials', 100000)], invoices: [{ invoiceNumber: 'I9', totalCents: 5000 }] })
    expect(p.material.cents).toBe(105000)
  })
  test('a bill filed as Other is not counted as material, and it is said', () => {
    const p = workOutPrefill({ ...base, bills: [bill('other', 5000)] })
    expect(p.material.source).toBe('quote')
    expect(p.material.note).toMatch(/\$50\.00/)
  })
})
