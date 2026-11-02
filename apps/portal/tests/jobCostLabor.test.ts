/**
 * Job costing: the real labor cost (Jonathan, Nov 2 2026). The rule every
 * reader uses, the form's total and override, and what a new entry fills in.
 */

import { describe, test, expect } from 'vitest'
import { costRow, crewTotalCents, crewLineCents, entryLaborCents, laborBasis, laborShown, oldHoursCents, plJobLabor, resultOf, type JobCostEntry } from '../../web/src/jobCostLabor'
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
  test('an old entry saved for another reason stays old: its number holds, hours do not move it, it stays on the fix list', () => {
    const e = { crew: [], actualLaborHrs: 99, frozenOldLaborCents: 22000 }
    expect(laborBasis(e)).toBe('hours')
    expect(entryLaborCents(e, quote)).toBe(22000)
    expect(laborBasis({ ...e, crew: [{ name: 'D', hours: 1, rate: 50 }] })).toBe('hours')
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
  test('a sub job: crew lines do not replace the sub amount unless typed', () => {
    expect(laborShown({ ...f, crewCents: 64000, crewFlows: false })).toBe(76900)
    expect(laborShown({ ...f, typed: true, typedCents: 64000, crewCents: 64000, crewFlows: false })).toBe(64000)
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
})

describe('one saved entry against its quote (Job Costing and the customer tab)', () => {
  const kristi = { finalPrice: 8914.27, totalCOGS: 4991.99, laborCost: 769, adjLaborHrs: 0, customerName: 'Kristi Murphy' }
  const entry = { crew: [], actualLaborHrs: 0, actualLaborCostCents: 110000, actualMaterialCost: 4222.99, actualOtherCosts: 0 }
  test('Kristi: estimate on the same footing as the actual', () => {
    const r = costRow(entry, kristi)
    expect([r.estCents, r.actualCents, r.varianceCents]).toEqual([499199, 532299, 33100])
    expect(r.estGM!.toFixed(3)).toBe('0.440')
    expect(r.actGM!.toFixed(3)).toBe('0.403')
  })
  test('old entries use the one rule, never a flat $22 on the crew lines', () => {
    const r = costRow({ ...entry, actualLaborCostCents: undefined, crew: [{ name: 'D', hours: 1, rate: 770 }] }, kristi)
    expect(r.laborCents).toBe(77000)
  })
  test('a quote with no cost: no estimate, no 100% margin; typed costs still count as actual', () => {
    const q = { finalPrice: 9000, totalCOGS: 0, laborCost: 0, adjLaborHrs: 0 }
    const typed = costRow({ ...entry, actualLaborCostCents: 100000, actualMaterialCost: 2000 }, q)
    expect([typed.hasEstimate, typed.estCents, typed.estGM, typed.varianceCents]).toEqual([false, null, null, null])
    expect(typed.actGM!.toFixed(3)).toBe('0.667')
    const empty = costRow({ ...entry, actualLaborCostCents: 0, actualMaterialCost: 0 }, q)
    expect([empty.hasActual, empty.actGM]).toEqual([false, null])
  })
})

describe('the P&L: labor counts once and nothing vanishes', () => {
  const quotes = [{ id: 'q1', laborCost: 600, adjLaborHrs: 20 }]
  const jobs = [{ id: 'j1', quoteId: 'q1' }]
  const e = (x: Partial<JobCostEntry>): JobCostEntry => ({ id: 'e', quoteId: 'q1', completionDate: '2026-10-05', actualLaborHrs: 0, crew: [], actualMaterialCost: 0, actualOtherCosts: 0, notes: '', ...x })
  const bill = (category: string, totalCents: number, status = 'paid') => ({ jobId: 'j1', category, status, totalCents })
  const run = (records: JobCostEntry[], bills: any[] = [], extra: Record<string, unknown> = {}) => plJobLabor({ records, quotes, jobs, bills, takeoffs: [], inPeriod: () => true, ...extra })
  test('no bill: the entry, in Direct Labor', () => {
    expect(run([e({ actualLaborCostCents: 76900, actualLaborHrs: 100, laborKind: 'sub' })])).toEqual({ directLabor: 76900, subcontractors: 0 })
  })
  test('sub deposit: $500 entry + $100 Subcontractor bill reads $500, in Subcontractors (the bill is $100 of it)', () => {
    expect(run([e({ actualLaborCostCents: 50000, laborKind: 'sub' })], [bill('subcontractor', 10000)])).toEqual({ directLabor: 0, subcontractors: 40000 })
  })
  test('the bill is larger: nothing added', () => {
    expect(run([e({ actualLaborCostCents: 50000, laborKind: 'sub' })], [bill('subcontractor', 80000)])).toEqual({ directLabor: 0, subcontractors: 0 })
  })
  test('crew job: $1,000 entry + $600 Labor bill counts once, in Direct Labor', () => {
    expect(run([e({ actualLaborCostCents: 100000, laborKind: 'crew' })], [bill('labor', 60000)])).toEqual({ directLabor: 40000, subcontractors: 0 })
  })
  test('old entry, no laborKind: hours $250 + $750 bill counts once', () => {
    const r = run([e({ actualLaborHrs: 250 / 30 })], [bill('subcontractor', 75000)])
    expect(r).toEqual({ directLabor: 0, subcontractors: 0 })
  })
  test('a void or draft bill is not a bill', () => {
    expect(run([e({ actualLaborCostCents: 50000 })], [bill('subcontractor', 10000, 'void'), bill('labor', 10000, 'draft')]).directLabor).toBe(50000)
  })
  test('one rule with the screen: an old entry reads the same number on both, and a gone quote adds nothing', () => {
    const old = e({ actualLaborHrs: 40 }) // 40 x ($600 / 20) = $1,200
    expect(run([old]).directLabor).toBe(entryLaborCents(old, quotes[0]))
    expect(run([old]).directLabor).toBe(120000)
    expect(run([e({ quoteId: 'gone', actualLaborHrs: 5 })]).directLabor).toBe(0)
  })
  test('a crew takeoff replaces the hand entry, and a Labor bill on it counts once', () => {
    const takeoffs = [{ jobId: 'j1', quoteId: 'q1', installDate: '2026-10-05', crewLaborCostCents: 70000 }]
    expect(run([e({ actualLaborCostCents: 99900 })], [], { takeoffs }).directLabor).toBe(70000)
    expect(run([], [bill('labor', 60000)], { takeoffs }).directLabor).toBe(10000)
  })
  test('out of the period: nothing', () => {
    expect(run([e({ actualLaborCostCents: 100 })], [], { inPeriod: () => false }).directLabor).toBe(0)
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
  test('a sub bill on the job does not read as no bill at all', () => {
    const p = workOutPrefill({ ...base, bills: [bill('subcontractor', 10000)], orders: [{ status: 'pending', totalCostCents: 400000 }] })
    expect(p.material.words).toMatch(/No materials bill/)
    expect(p.material.words).not.toMatch(/vendor bill/i)
  })
  test('a quote with no cost says so; it does not claim a $0 estimate', () => {
    const p = workOutPrefill({ ...base, quote: { ...base.quote, laborCents: 0, materialCents: 0 } })
    expect(p.labor.words).toMatch(/no labor \$ on file/)
    expect(p.material.words).toMatch(/no material cost on file/)
  })
  test('a crew job with a labor bill: the wording says it counts once', () => {
    const p = workOutPrefill({ ...base, quote: { ...base.quote, laborMode: 'hourly' }, bills: [bill('labor', 60000)] })
    expect(p.labor.note).toMatch(/counts once/)
  })
  test('a bill filed as Other is not counted as material, and it is said', () => {
    const p = workOutPrefill({ ...base, bills: [bill('other', 5000)] })
    expect(p.material.source).toBe('quote')
    expect(p.material.note).toMatch(/\$50\.00/)
  })
})
