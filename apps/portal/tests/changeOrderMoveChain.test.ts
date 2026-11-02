/**
 * The next change order on a move or repair (Nov 2 2026). Its one price
 * difference line is the new work's price minus the job as it stands, so what
 * the contract holds and the work shown does not must not be handed back: CO-1
 * +$805, CO-2 a gate at $921 came out +$116 (a repair: +$707 then +$707 came
 * out $0). A change order from the builder now keeps its work, so the next one
 * opens on it (changeOrderMoveWork.db.test.ts); here, what the line is compared
 * with when one kept none.
 */
import { describe, test, expect } from 'vitest'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'
import { noWorkNote, workOffContract, type EarlierOrder } from '../../web/src/changeOrderPricing'
import type { QuoteCalcInput } from '../../web/src/quoteCalc'

const input = (ft: number, walkGates = 0) => ({ style: { name: 'Move' }, runs: [{ ft, rail: 'auto' }], corners: 0, ends: 2, walkGates, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {} }) as unknown as QuoteCalcInput
const signed = (ft: number, walkGates: number, finalPrice: number) => ({ id: 'q', fenceStyle: 'Move', runs: [ft], corners: 0, ends: 2, walkGates, dblGates: 0, tearOutSections: 0, tearOutGates: 0, sections: 3, finalPrice }) as never
const draft = (work: { ft: number; walk: number; contract: number }, now: QuoteCalcInput, priceNow: number, orders: EarlierOrder[] = []) => changeOrderDraft({
  signed: signed(work.ft, work.walk, work.contract), current: now, signedOverrides: {}, styles: [{ name: 'Move' }] as never, priceNow, sectionsNow: 3, simple: true, earlier: { orders, sold: { walkGates: 0, dblGates: 0 } as never },
})
const total = (d: { lines: Array<{ amountCents: number }> }) => d.lines.reduce((t, l) => t + l.amountCents, 0)
const kept: EarlierOrder = { number: 1, status: 'approved', work: {}, lines: [{ description: "Price difference at today's prices", amountCents: 80000 }], scope: { footageFt: 20 } }
const typed = (number: number, cents: number, status = 'approved'): EarlierOrder => ({ number, status, lines: [{ description: 'Haul off the old slab', amountCents: cents }], scope: null })
const old = (number: number, cents: number): EarlierOrder => ({ number, status: 'approved', lines: [{ description: 'Add 20 ft of fence (100 ft to 120 ft)', amountCents: 0 }, { description: "Price difference at today's prices", amountCents: cents }], scope: { footageFt: 20 } })

describe('the price difference on a move or repair', () => {
  test('CO-1 +20 ft $800 kept its work, CO-2 a gate $300: +$300, never -$500', () => {
    const d = draft({ ft: 120, walk: 0, contract: 5800 }, input(120, 1), 6100, [kept])
    expect(d.lines.map(l => l.description)).toEqual(['Add 1 walk gate', "Price difference at today's prices"])
    expect(total(d)).toBe(30000)
  })

  test('a gate CO-1 added and CO-2 takes out: the contract holds its charge, so it credits in full', () => {
    const gate: EarlierOrder = { ...kept, scope: { walkGates: 1 }, lines: [{ description: 'Add 1 walk gate', amountCents: 0 }, { description: "Price difference at today's prices", amountCents: 35000 }] }
    expect(total(draft({ ft: 100, walk: 1, contract: 5350 }, input(100, 0), 5000, [gate]))).toBe(-35000)
  })

  test('a typed change order stays on the job: its price is not handed back', () => {
    expect(total(draft({ ft: 100, walk: 0, contract: 5100 }, input(100, 1), 5300, [typed(1, 10000)]))).toBe(30000)
    // A typed credit is not billed again either.
    expect(total(draft({ ft: 100, walk: 0, contract: 4900 }, input(100, 1), 5300, [typed(1, -10000)]))).toBe(30000)
  })

  test('one still open or void is not in the price compared with, so nothing comes off for it', () => {
    expect(total(draft({ ft: 100, walk: 0, contract: 5000 }, input(100, 1), 5300, [typed(1, 10000, 'void'), typed(2, 10000, 'draft')]))).toBe(30000)
  })

  test('an old one that changed the work and kept none: the price stays as it was, compared with the contract', () => {
    // The change put in again, as the note says: its own change only.
    expect(total(draft({ ft: 100, walk: 0, contract: 5800 }, input(120, 1), 6100, [old(1, 80000)]))).toBe(30000)
    // Not put in: as today, and the note says so before it is saved.
    expect(total(draft({ ft: 100, walk: 0, contract: 5800 }, input(100, 1), 5300, [old(1, 80000)]))).toBe(-50000)
  })

  test('a repair\'s old one, with only its "Changes to the work" line, reads as one that changed the work', () => {
    const o: EarlierOrder = { number: 1, status: 'approved', lines: [{ description: "Changes to the work, at today's prices", amountCents: 70700 }], scope: null }
    expect(workOffContract([o]).unknown.map(x => x.number)).toEqual([1])
  })
})

describe('what the person is told', () => {
  test('nothing when every change order kept its work', () => expect(noWorkNote([kept, typed(2, 10000, 'void')])).toBeNull())

  test('an old one: which, how much, and what to do', () => {
    expect(noWorkNote([old(1, 80500)])).toBe('CO-1 (+$805) changed this job before change orders on a move or repair kept their work, so it is not in the work shown here, but the contract holds its price. Put that change in here first, or this change order takes the $805 back.')
  })

  test('a typed one: its price stays', () => {
    expect(noWorkNote([typed(2, 10000)])).toBe('CO-2 (+$100) was typed: its price stays on the job and is not part of this change. It is not in the work shown here.')
  })
})
