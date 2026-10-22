/**
 * The Pullsheets tab's entries (lib/customerPullSheets.ts): a saved pull sheet
 * in cents, the change order note, and the quantities only copy a Salesman or
 * Installer gets (no cost anywhere in it).
 */
import { describe, test, expect } from 'vitest'
import { linesFromSheet, changeNoteOf, quantitiesOnly, type PullSheetEntry } from '../src/server/lib/customerPullSheets.js'
import { redactCosts } from '../src/server/lib/costRedact.js'

describe('customer pull sheets', () => {
  test('a saved pull sheet (dollars) becomes lines in cents; money only lines are marked', () => {
    expect(linesFromSheet([
      { item: 'ND, Donut', qty: 42, unitCost: 4.12, total: 173.04 },
      { item: 'Wood material', qty: 1, unitCost: 250, total: 250, moneyOnly: true },
      { item: '', qty: 3, unitCost: 1, total: 3 },
      null,
    ])).toEqual([
      { item: 'ND, Donut', qty: 42, unitCostCents: 412, totalCostCents: 17304 },
      { item: 'Wood material', qty: 1, moneyOnly: true, unitCostCents: 25000, totalCostCents: 25000 },
    ])
  })

  test('an approved change order that changed the work is named, with what it changed', () => {
    const note = changeNoteOf([{ number: 2, approvedAt: new Date('2026-10-21T15:00:00Z'), reason: 'Add a gate', scope: { footageFt: 20, walkGates: 1, dblGates: 0, sections: 3 }, lines: [] }])
    expect(note).toBe('Change order CO-2 (approved October 21, 2026): +20 ft, +3 sections, +1 walk gate. This pull sheet is as signed and does not include that change.')
    expect(changeNoteOf([{ number: 1, approvedAt: null, reason: '', scope: null, lines: [{ id: 'a', description: 'Remove 8 ft', amountCents: -40000 }] }])).toMatch(/^Change order CO-1: Remove 8 ft\./)
    expect(changeNoteOf([])).toBeNull()
  })

  test('quantities only: no unit cost, total or money only line, here or in the Final takeoff', () => {
    const e: PullSheetEntry = {
      id: 'j_1', kind: 'job', quoteId: 'q1', jobId: '1', style: 'White Vinyl Privacy', footageFt: 96, sections: 12, status: 'Signed', archived: false, date: '2026-10-20',
      source: 'Frozen at signing', changeNote: null, packetToken: null, totalCostCents: 42554,
      lines: [{ item: 'Post', qty: 13, unitCostCents: 1350, totalCostCents: 17550 }, { item: 'Wood material', qty: 1, moneyOnly: true, unitCostCents: 25004, totalCostCents: 25004 }],
      finalTakeoff: { status: 'approved', installDate: '2026-10-30', submittedBy: 'Crew', approvedBy: 'Jonathan', materialCostCents: 16200, costFrozen: true,
        lines: [{ item: 'Post', plannedQty: 13, usedQty: 12, shopReturnQty: 1, vendorReturnQty: 0, extra: false, note: '', unitCostCents: 1350, totalCostCents: 16200 }] },
    }
    const [q] = quantitiesOnly([e])
    expect(q.lines).toEqual([{ item: 'Post', qty: 13 }])
    expect(q.finalTakeoff!.lines).toEqual([{ item: 'Post', plannedQty: 13, usedQty: 12, shopReturnQty: 1, vendorReturnQty: 0, extra: false, note: '' }])
    const text = JSON.stringify(q)
    expect(text).not.toMatch(/Cost|Cents|1350|25004|16200|42554/)
    // The answer filter every limited login goes through leaves it as it is (nothing left to take out).
    expect(redactCosts(q)).toEqual(JSON.parse(text))
  })
})
