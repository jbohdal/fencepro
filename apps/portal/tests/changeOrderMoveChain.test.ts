/**
 * The next change order on a move or repair (Nov 2 2026). Its one price
 * difference line is the new work's price minus the job as it stands, so what
 * the contract holds and the work shown does not must not be handed back: CO-1
 * +$805, CO-2 a gate at $921 came out +$116 (a repair: +$707 then +$707 came
 * out $0). A change order from the builder now keeps its work, so the next one
 * opens on it (changeOrderMoveWork.db.test.ts); here, what the line is compared
 * with when one kept none, and how a change is said.
 */
import { describe, test, expect } from 'vitest'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'
import { noWorkCents, noWorkNote, voidGaps, type EarlierOrder, type WorkState } from '../../web/src/changeOrderPricing'
import { moveChangeWords, repairChangeWords, type RepairInputs } from '../../web/src/moveRepair'
import { whatChanged } from '../src/server/lib/changeOrderWork'
import type { QuoteCalcInput } from '../../web/src/quoteCalc'

const input = (ft: number, walkGates = 0) => ({ style: { name: 'Move' }, runs: [{ ft, rail: 'auto' }], corners: 0, ends: 2, walkGates, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {} }) as unknown as QuoteCalcInput
const signed = (ft: number, walkGates: number, finalPrice: number) => ({ id: 'q', fenceStyle: 'Move', runs: [ft], corners: 0, ends: 2, walkGates, dblGates: 0, tearOutSections: 0, tearOutGates: 0, sections: 3, finalPrice }) as never
const draft = (work: { ft: number; walk: number; contract: number }, now: QuoteCalcInput, priceNow: number, orders: EarlierOrder[] = [], workWords: string[] = []) => changeOrderDraft({
  signed: signed(work.ft, work.walk, work.contract), current: now, signedOverrides: {}, styles: [{ name: 'Move' }] as never, priceNow, sectionsNow: 3, simple: true, workWords, earlier: { orders, sold: signed(100, 0, 5000) },
})
const total = (d: { lines: Array<{ amountCents: number }> }) => d.lines.reduce((t, l) => t + l.amountCents, 0)
const state = { fenceStyle: 'Move', runs: [120], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 } as WorkState
const kept: EarlierOrder = { number: 1, status: 'approved', totalCents: 80000, work: state, lines: [{ description: "Price difference at today's prices" }], scope: { footageFt: 20 } }
const typed = (number: number, cents: number, status = 'approved'): EarlierOrder => ({ number, status, totalCents: cents, lines: [{ description: 'Haul off the old slab' }], scope: null })
const picked = (number: number, cents: number): EarlierOrder => ({ number, status: 'approved', totalCents: cents, lines: [{ description: '1 × Add a section', source: { ref: 'add:section' } }], scope: null })
const old = (number: number, cents: number): EarlierOrder => ({ number, status: 'approved', totalCents: cents, lines: [{ description: 'Add 20 ft of fence (100 ft to 120 ft)' }, { description: "Price difference at today's prices" }], scope: { footageFt: 20 } })

describe('the price difference on a move or repair', () => {
  test('CO-1 +20 ft $800 kept its work, CO-2 a gate $300: +$300, never -$500', () => {
    const d = draft({ ft: 120, walk: 0, contract: 5800 }, input(120, 1), 6100, [kept])
    expect(d.lines.map(l => l.description)).toEqual(['Add 1 walk gate', "Price difference at today's prices"])
    expect(total(d)).toBe(30000)
  })

  test('a gate CO-1 added and CO-2 takes out: the contract holds its charge, so it credits in full', () => {
    const gate: EarlierOrder = { ...kept, totalCents: 35000, scope: { walkGates: 1 } }
    expect(total(draft({ ft: 100, walk: 1, contract: 5350 }, input(100, 0), 5000, [gate]))).toBe(-35000)
  })

  test('one with no work stays on the job: typed, picked or made earlier, its price is never handed back', () => {
    expect(total(draft({ ft: 100, walk: 0, contract: 5100 }, input(100, 1), 5300, [typed(1, 10000)]))).toBe(30000)
    expect(total(draft({ ft: 100, walk: 0, contract: 4900 }, input(100, 1), 5300, [typed(1, -10000)]))).toBe(30000)
    expect(total(draft({ ft: 100, walk: 0, contract: 5800 }, input(100, 1), 5300, [old(1, 80000)]))).toBe(30000)
    expect(total(draft({ ft: 100, walk: 0, contract: 5300 }, input(100, 1), 5300, [picked(1, 30000)]))).toBe(30000)
  })

  test('one still open or void is not in the price compared with, so nothing comes off for it', () => {
    expect(noWorkCents([typed(1, 10000, 'void'), typed(2, 10000, 'draft')])).toBe(0)
    expect(total(draft({ ft: 100, walk: 0, contract: 5000 }, input(100, 1), 5300, [typed(1, 10000, 'void'), typed(2, 10000, 'draft')]))).toBe(30000)
  })
})

describe('how a change is said', () => {
  const repair = (items: RepairInputs['items']) => ({ what: 'other', items, postType: 'nd', newPostCaps: false, gateKind: 'walk' }) as RepairInputs

  test('a repair: words a customer reads, each item on its own', () => {
    expect(repairChangeWords(repair({ resetPost: 1 }), repair({ resetPost: 2 }))).toEqual(['Add 1 leaning post reset'])
    expect(repairChangeWords(repair({ resetPost: 3, replacePost: 1 }), repair({ resetPost: 1, replaceSection: 2 }))).toEqual(['Remove 2 leaning post resets', 'Remove 1 post replacement', 'Add 2 whole section replacements'])
  })

  test('one change of a repair carries the amount on its own line, not "Changes to the work"', () => {
    const d = draft({ ft: 100, walk: 0, contract: 5000 }, input(100), 5707, [], ['Add 1 leaning post reset'])
    expect(d.lines.map(l => [l.description, l.amountCents])).toEqual([['Add 1 leaning post reset', 70700]])
  })

  test('more than one: each said, one price difference line', () => {
    const d = draft({ ft: 100, walk: 0, contract: 5000 }, input(100), 5900, [], ['Add 1 leaning post reset', 'Add 1 post replacement'])
    expect(d.lines.map(l => [l.description, l.amountCents])).toEqual([['Add 1 leaning post reset', 0], ['Add 1 post replacement', 0], ["Price difference at today's prices", 90000]])
  })

  test('nothing to say in words: the general line, as before', () => {
    expect(draft({ ft: 100, walk: 0, contract: 5000 }, input(100), 5100).lines.map(l => l.description)).toEqual(["Changes to the work, at today's prices"])
  })

  test('every input that prices is said, never only the general line', () => {
    const r = repair({ resetPost: 1 })
    expect(repairChangeWords(r, { ...r, postType: 'ds' })).toEqual(['Old posts: no dig to dig set'])
    expect(repairChangeWords(r, { ...r, newPostCaps: true })).toEqual(['Add new post caps'])
    expect(repairChangeWords(r, { ...r, gateKind: 'double' })).toEqual(['Gate work is on a double gate, not a walk gate'])
    expect(repairChangeWords(r, { ...r, repairParts: [{ part: 'Rail', qty: 1 }] })).toEqual(['Change the parts used for the section repair'])
    const m = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd' as const, newPostCaps: false }
    expect(moveChangeWords(m, { ...m, oldPostType: 'ds' })).toEqual(['Old posts: no dig to dig set'])
    expect(moveChangeWords(m, { ...m, oldFt: 110 })).toEqual(['Old fence to move: 100 ft to 110 ft'])
    expect(moveChangeWords(m, { ...m, oldWalkGates: 1 })).toEqual(['Old walk gates: 0 to 1'])
    expect(moveChangeWords(m, { ...m, damagePct: 20 })).toEqual(['Damage allowance: standard to 20%'])
    expect(moveChangeWords(m, { ...m, oldSections: 15 })).toEqual(['Old sections: 15'])
    expect(moveChangeWords({ ...m, oldPosts: 30 }, m)).toEqual(['Old posts: back to the count from the old line'])
    expect(moveChangeWords({ ...m, oldSections: 12 }, { ...m, oldSections: 15 })).toEqual(['Old sections: 12 to 15'])
    expect(moveChangeWords(m, { ...m, replaceDbl: [true] })).toEqual(['Replace 1 double gate'])
  })

  test('a void\'s gap is its own line until the next change order after it, the total as it was', () => {
    const at = (d: string) => `2026-11-0${d}T12:00:00Z`
    const v: EarlierOrder = { number: 1, status: 'void', totalCents: -28200, voidGapCents: 42900, voidedAt: at('2'), createdAt: at('1') }
    const later: EarlierOrder = { ...kept, number: 2, createdAt: at('1') }
    const d = draft({ ft: 110, walk: 0, contract: 4191 }, input(112), 4640, [v, later])
    expect(d.lines.map(l => [l.description, l.amountCents])).toEqual([['Add 2 ft of fence (110 ft to 112 ft)', 0], ["Price difference at today's prices", 2000], ["Contract back to today's price after CO-1 was cancelled", 42900]])
    expect(total(d)).toBe(44900)
    expect(d.warnings?.[0]).toMatch(/Voiding CO-1 left the contract \$429 under/)
    // Shown once: a change order made after the void has it in.
    expect(voidGaps([v, later, { ...kept, number: 3, createdAt: at('3') }])).toEqual([])
    // A typed one voided has none.
    expect(voidGaps([typed(1, 10000, 'void')])).toEqual([])
  })

  test('a move input: said', () => {
    const m = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd' as const, newPostCaps: false }
    expect(moveChangeWords(m, { ...m, newPostCaps: true })).toEqual(['Add new post caps'])
    expect(moveChangeWords(m, m)).toEqual([])
  })

  test('the timeline and packet say the change, never the price difference line; typed words stay the person\'s', () => {
    expect(whatChanged({ scope: {}, lines: [{ description: 'Add 1 leaning post reset' }, { description: "Price difference at today's prices" }] })).toBe('Add 1 leaning post reset')
    expect(whatChanged({ scope: {}, lines: [{ description: "Changes to the work, at today's prices" }], reason: 'Customer asked' })).toBe('Customer asked')
    expect(whatChanged({ scope: null, lines: [{ description: 'Haul off the old slab' }] })).toBe('Haul off the old slab')
  })
})

describe('what the person is told', () => {
  test('nothing when every change order kept its work', () => expect(noWorkNote([kept, typed(2, 10000, 'void')])).toBeNull())

  test('which change, and that it must not go in twice; it never says to put it in', () => {
    const note = noWorkNote([old(1, 80500)])!
    expect(note).toBe('CO-1 (made earlier, +$805: Add 20 ft of fence (100 ft to 120 ft)) is on the contract but not in the work shown here, and stays off the pull sheet: the crew packet lists its words. Its price stays on the job and this change order does not touch it. Do not put it in here: that would count it twice.')
    expect(note).not.toMatch(/back\./)
  })

  test('an old credit is a credit, typed and picked are said apart, and the grammar counts', () => {
    expect(noWorkNote([old(1, -30000), typed(2, 10000), picked(3, 86400)])).toBe('CO-1 (made earlier, -$300: Add 20 ft of fence (100 ft to 120 ft)), CO-2 (typed, +$100: Haul off the old slab) and CO-3 (picked from the price list, +$864: 1 × Add a section) are on the contract but not in the work shown here, and stay off the pull sheet: the crew packet lists their words. Their prices stay on the job and this change order does not touch them. Do not put them in here: that would count them twice.')
  })
})
