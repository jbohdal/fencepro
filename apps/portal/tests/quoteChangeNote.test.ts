/**
 * The quote window's line for a signed quote whose job a change order changed
 * (apps/web/src/quoteChangeNote.ts; walkthrough recheck, Oct 27 2026).
 */
import { describe, test, expect } from 'vitest'
import { quoteChangeNote, type ChangeOrderForNote } from '../../web/src/quoteChangeNote'

const co = (o: Partial<ChangeOrderForNote> & { number: number }): ChangeOrderForNote =>
  ({ status: 'approved', approvedAt: '2026-10-27T15:00:00.000Z', signedAt: '2026-10-27T16:00:00.000Z', contractRev: o.number + 1, totalCents: 35_400, work: null, jobWork: null, ...o })

describe('quoteChangeNote', () => {
  test('no approved change order: nothing to say', () => {
    expect(quoteChangeNote([], 411_300)).toBeNull()
    expect(quoteChangeNote([co({ number: 1, status: 'sent' }), co({ number: 2, status: 'void' }), co({ number: 3, status: 'needs_ok' })], 411_300)).toBeNull()
  })

  test('a drawing change order: the job now, and the pull sheet revision', () => {
    const n = quoteChangeNote([co({ number: 1, work: { footage: 316, sections: 32 } })], 411_300)!
    expect(n.text).toBe("Changed by CO-1 (signed 10/27): the job now has 316 ft, 32 sections. The job's pull sheet is rev 2.")
    expect(n.pullSheetRev).toBe(2)
    expect(n.pullSheetText).toContain("The job's pull sheet is rev 2, with CO-1 in it")
  })

  test('two: the newest with work decides (its work after the merge), both named; one approved verbally says not signed yet', () => {
    const n = quoteChangeNote([
      co({ number: 2, approvedAt: '2026-10-29T15:00:00.000Z', signedAt: null, contractRev: 3, work: { footage: 300, sections: 30 }, jobWork: { footage: 326, sections: 33 } }),
      co({ number: 1, work: { footage: 316, sections: 32 } }),
    ], 411_300)!
    expect(n.text).toBe("Changed by CO-1 (signed 10/27) and CO-2 (approved 10/29, not signed yet): the job now has 326 ft, 33 sections. The job's pull sheet is rev 3.")
    expect(n.pullSheetRev).toBe(3)
  })

  test('typed lines only: the contract price, the pull sheet as signed', () => {
    const n = quoteChangeNote([co({ number: 1, totalCents: 25_000 })], 411_300)!
    expect(n.text).toBe('Changed by CO-1 (signed 10/27): the contract is now $4,363. The fence and the pull sheet are as signed.')
    expect(n.pullSheetRev).toBeNull()
  })

  test('the revision with no contract revision kept: one more than the change orders with work', () => {
    expect(quoteChangeNote([co({ number: 1, contractRev: null, work: { footage: 10, sections: 2 } })], 0)!.pullSheetRev).toBe(2)
  })
})
