/**
 * Jonathan, Nov 2 2026: "Commission only applies when an actual Salesman
 * (Christa or another salesman login) is the rep." (lib/commissionRule.ts, web
 * salesmanCommission.ts, pricingEngine.ts.)
 */
import { describe, test, expect } from 'vitest'
import { repRulesOut, withoutCommission, withCommission, gmPctAtSigning, carriesCommission, commissionOnMove, signedMoveChangesCommission, hasCommissionFigures, type RuleLogin } from '../src/server/lib/commissionRule'
import { commissionWords, confirmQuestion, movedNote } from '../src/server/lib/salesmanMove'
import { lockedChanges } from '../src/server/lib/quoteLock'
import { calculatePrice, type PriceInputs, type PricingSettings } from '../../web/src/pricingEngine'
import { isSalesmanRep, salesmanSwitchDefault, clearedCommission, savedCommission } from '../../web/src/salesmanCommission'

const TEAM = [{ name: 'Jonathan Bohdal', role: 'super_admin' }, { name: 'Christa Feagin', role: 'sales_rep' }, { name: 'Pat Office', role: 'office_staff' }]

const login = (id: string, firstName: string, lastName: string, role: string, extra: Partial<RuleLogin> = {}): RuleLogin => ({ id, firstName, lastName, role, status: 'active', wasSalesman: false, ...extra })
const ALL = [login('o', 'Jonathan', 'Bohdal', 'super_admin'), login('p', 'Pat', 'Office', 'office_staff'), login('m', 'Mo', 'Manager', 'manager'), login('c', 'Christa', 'Feagin', 'sales_rep')]

describe('never on a guess: commission comes off only when the rep is positively not a Salesman', () => {
  test('a current owner, office or manager login, by full name, first name or initials', () => {
    for (const rep of ['Jonathan Bohdal', 'jonathan', 'Jb', 'JB', 'Pat Office', 'Pat', 'Mo Manager']) expect(repRulesOut(rep, null, ALL), rep).toBe(true)
  })
  test('blank: only on a quote made by such a login', () => {
    expect(repRulesOut('', 'o', ALL)).toBe(true)
    expect(repRulesOut('  ', 'p', ALL)).toBe(true)
    expect(repRulesOut('', 'c', ALL)).toBe(false)
    expect(repRulesOut('', 'gone', ALL)).toBe(false)
    expect(repRulesOut('', null, ALL)).toBe(false)
  })
  test('a Salesman by any spelling, or any name that is no login, keeps what it has', () => {
    for (const rep of ['Christa Feagin', 'Christa', 'CF', 'Christa F', 'Christa F.', 'C. Feagin', 'Feagin', 'C.F.', 'C F', 'Crista Feagin', 'Christa/Jb', 'Somebody Else']) expect(repRulesOut(rep, 'o', ALL), rep).toBe(false)
  })
  test('a Salesman who left, was renamed or changed role keeps it', () => {
    const left = [ALL[0]]
    expect(repRulesOut('Christa Feagin', 'o', left)).toBe(false)
    const roleChanged = [ALL[0], login('c', 'Christa', 'Feagin', 'office_staff', { wasSalesman: true })]
    expect(repRulesOut('Christa Feagin', 'o', roleChanged)).toBe(false)
    expect(repRulesOut('', 'c', roleChanged)).toBe(false)
    expect(repRulesOut('Christa Feagin', 'o', [ALL[0], login('c', 'Christa', 'Married', 'sales_rep')])).toBe(false)
  })
  test('a name two logins share: a Salesman among them keeps it; an inactive login or an Installer is not proof', () => {
    expect(repRulesOut('Jonathan', null, [...ALL, login('j2', 'Jonathan', 'Second', 'sales_rep')])).toBe(false)
    expect(repRulesOut('Pat Office', null, [login('p', 'Pat', 'Office', 'office_staff', { status: 'disabled' })])).toBe(false)
    expect(repRulesOut('Ivan Crew', null, [login('i', 'Ivan', 'Crew', 'field_crew')])).toBe(false)
  })
})

describe('a move', () => {
  const settings = { pct: 0.09, mode: 'included' }
  const q = { finalPrice: 10000, totalCOGS: 5600, gmPct: 0.35, hasSalesman: true, pricing: { costFactor: 0.56 }, proposal: { options: [{ fenceStyle: 'A', finalPrice: 10000, snapshot: { totalCOGS: 5600, gmPct: 0.35 } }] } }
  test('signed: nothing changes, whichever way', () => {
    expect(signedMoveChangesCommission()).toBe(false)
    expect(commissionOnMove(q, { signed: true, toRep: 'Jonathan Bohdal', logins: ALL, settings })).toEqual({ change: 'none', why: 'signed', fields: null })
    expect(commissionOnMove({ ...q, hasSalesman: false }, { signed: true, toRep: 'Christa Feagin', logins: ALL, settings }).change).toBe('none')
  })
  test('only what a move took off comes back: a switch turned off on purpose stays off', () => {
    const offOnPurpose = { ...q, hasSalesman: false, gmPct: 0.44 }
    expect(commissionOnMove(offOnPurpose, { signed: false, toRep: 'Christa Feagin', logins: ALL, settings })).toEqual({ change: 'none', why: 'same', fields: null })
    const off = commissionOnMove(q, { signed: false, toRep: 'Jonathan Bohdal', logins: ALL, settings })
    expect(off.fields!.pricing.commissionMovedOff).toBe(true)
    const on = commissionOnMove({ ...q, ...off.fields! }, { signed: false, toRep: 'Christa', logins: ALL, settings })
    expect(on.fields!.pricing).toEqual({ costFactor: 0.56 })
    // Moved off and then to someone who is no Salesman: still off, still recorded.
    expect(commissionOnMove({ ...q, ...off.fields! }, { signed: false, toRep: 'Pat Office', logins: ALL, settings }).change).toBe('none')
  })
  test('unsigned: off to the owner, back on to a Salesman, the same margin', () => {
    const off = commissionOnMove(q, { signed: false, toRep: 'Jonathan Bohdal', logins: ALL, settings })
    expect(off.change).toBe('off')
    const q2 = { ...q, ...off.fields! }
    expect(q2.gmPct).toBeCloseTo(0.44, 6)
    const on = commissionOnMove(q2, { signed: false, toRep: 'Christa Feagin', logins: ALL, settings })
    expect(on.change).toBe('on')
    expect(on.fields!.gmPct).toBeCloseTo(0.35, 6)
    expect(on.fields!.proposal.options[0].snapshot.gmPct).toBeCloseTo(0.35, 6)
    expect(on.fields!.proposal.options[0].finalPrice).toBe(10000)
  })
  test('commission is on the price before the adjustment and the rounding, as the engine has it', () => {
    const f = withCommission({ finalPrice: 9970, totalCOGS: 5600, pricing: { priceAdjustmentCents: -3000, roundingCents: 0 } }, 0.09)
    expect(f.gmPct).toBeCloseTo((9970 - 5600 - 900) / 9970, 6)
  })
  test('commission added on top of the price: never touched', () => {
    expect(commissionOnMove(q, { signed: false, toRep: 'Jonathan Bohdal', logins: ALL, settings: { pct: 0.09, mode: 'added' } })).toEqual({ change: 'none', why: 'added', fields: null })
    expect(commissionOnMove({ ...q, pricing: { commissionMode: 'added' } }, { signed: false, toRep: 'Jonathan Bohdal', logins: ALL, settings }).why).toBe('added')
  })
  test('an unknown rep: nothing changes', () => {
    expect(commissionOnMove(q, { signed: false, toRep: 'Somebody Else', logins: ALL, settings }).change).toBe('none')
  })
  test('the words say what happened', () => {
    expect(commissionWords({ change: 'none', why: 'signed', fields: null }, 80000, 'Christa Feagin')).toBe('Its commission stays with Christa Feagin.')
    expect(confirmQuestion('Christa', 'Jonathan', 80000, 'Christa Feagin')).toContain('Its $800.00 commission stays with Christa Feagin.')
    const line = movedNote('quote #A', 'Christa', 'Jonathan', 'Jonathan', true, commissionWords({ change: 'none', why: 'signed', fields: null }, 80000, 'Christa Feagin'))
    expect(line).toContain('(signed job; its commission stays with Christa Feagin)')
    expect(line).not.toContain('$')
    expect(movedNote('quote #A', 'Christa', 'Jonathan', 'Jonathan', false, 'Its commission is off: this person is not a Salesman.')).toContain('(not sold yet; its commission is off')
  })
})

describe('the builder\'s switch', () => {
  const saved = { id: 'q', status: 'SENT', hasSalesman: true }
  test('a saved quote opens as it was saved: the server\'s rule is asked at save', () => {
    for (const salesRep of ['Christa', 'CF', 'Christa F.', 'Jonathan Bohdal', '']) expect(salesmanSwitchDefault({ ...saved, salesRep }, 'super_admin', TEAM), salesRep).toBe(true)
  })
  test('a new quote for a Salesman\'s customer: on by full name, first name or initials', () => {
    for (const salesRep of ['Christa Feagin', 'Christa', 'CF']) { expect(isSalesmanRep(salesRep, TEAM), salesRep).toBe(true); expect(salesmanSwitchDefault({ salesRep }, 'super_admin', TEAM), salesRep).toBe(true) }
    expect(salesmanSwitchDefault({ salesRep: 'Jonathan Bohdal' }, 'super_admin', TEAM)).toBe(false)
  })
})

describe('the price', () => {
  const pricing: PricingSettings = { manHourRate: 25, commissionSalesman: 0.09, commissionNonSalesman: 0.05, commissionMode: 'included' } as any
  const input = (over: Partial<PriceInputs>): PriceInputs => ({
    sections: 30, footage: 180, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, materialCost: 5000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    style: { name: 'WV', margin: 0.56, sectionsPerMH: 1.5 } as any, pricing, overrides: {}, ...over,
  })
  test('commission included: the customer price is the same with it on or off; only the margin moves', () => {
    const on = calculatePrice(input({ hasSalesman: true })), off = calculatePrice(input({ hasSalesman: false }))
    expect(off.price).toBe(on.price)
    expect(off.totalCOGS).toBe(on.totalCOGS)
    expect(on.commissionAmt).toBeGreaterThan(0)
    expect(off.commissionAmt).toBe(0)
    expect(off.gmPct).toBeCloseTo((off.price - off.totalCOGS) / off.price, 6)
  })
  test('with no Salesman: $0, whatever Settings or the quote hold', () => {
    expect(calculatePrice(input({})).commissionPct).toBe(0)
    expect(calculatePrice(input({ overrides: { commissionPct: 0.09 } })).commissionAmt).toBe(0)
  })
  test('a Salesman quote does not move', () => {
    const on = calculatePrice(input({ hasSalesman: true }))
    expect(on.commissionPct).toBe(0.09)
    expect(on.gmPct).toBeCloseTo((on.price - on.totalCOGS - on.commissionAmt) / on.price, 6)
  })
})

describe('taking commission off a saved quote', () => {
  const opt = (fenceStyle: string, finalPrice: number, totalCOGS: number, gmPct: number) => ({ label: fenceStyle, fenceStyle, finalPrice, perFoot: 12, sections: 33, tier: { key: 'b', label: 'Better', blurb: 'x' }, snapshot: { totalCOGS, gmPct, materialCost: 1, pullSheet: [{ item: 'p' }] } })
  const q = { finalPrice: 8914.27, totalCOGS: 4991.99, hasSalesman: true, pricing: { costFactor: 0.56, overheadPct: 30, commissionPct: 0.09 }, proposal: { terms: ['t'], options: [opt('A', 8914.27, 4991.99, 0.35), opt('B', 7000, 4000, 0.3)] } }
  test('switch off, margin is price less cost, the quote\'s own commission gone', () => {
    const out = withoutCommission(q)
    expect(out.hasSalesman).toBe(false)
    expect(out.gmPct).toBeCloseTo(0.44, 3)
    expect(out.pricing).toEqual({ costFactor: 0.56, overheadPct: 30 })
    expect(carriesCommission({ ...q, ...out })).toBe(false)
  })
  test('never a price, a cost or a word a customer reads', () => {
    const out = withoutCommission(q) as any
    expect(Object.keys(out).sort()).toEqual(['gmPct', 'hasSalesman', 'pricing', 'proposal'])
    const sees = (p: any) => JSON.stringify(p.options.map(({ snapshot: _s, ...o }: any) => o))
    expect(sees(out.proposal)).toBe(sees(q.proposal))
    expect(out.proposal.terms).toEqual(['t'])
    expect(out.proposal.options[0].snapshot.gmPct).toBeCloseTo(0.44, 3)
    expect(out.proposal.options[1].snapshot.gmPct).toBeCloseTo(3000 / 7000, 6)
    expect(out.proposal.options[1].snapshot.totalCOGS).toBe(4000)
  })
  test('a move\'s or repair\'s saved commission goes to the margin', () => {
    const out = withoutCommission({ finalPrice: 1000, totalCOGS: 500, work: { type: 'repair', description: 'd', priced: { commissionCents: 9000, grossMarginCents: 41000, priceCents: 100000 } } }) as any
    expect(out.work.priced).toEqual({ commissionCents: 0, grossMarginCents: 50000, priceCents: 100000 })
    expect(out.work.description).toBe('d')
  })
})

describe('every copy of a move\'s or repair\'s commission', () => {
  const w = (type: string) => ({ type, description: 'd', priced: { commissionCents: 53227, grossMarginCents: 300000, priceCents: 591400 } })
  for (const type of ['move', 'repair']) test(`${type}: the screen's copies clear, the words and prices stay`, () => {
    const work = w(type), proposal = { terms: [], options: [{ label: 'x', finalPrice: 5914, snapshot: { totalCOGS: 1, work: w(type) } }, { label: 'New fence', finalPrice: 9000, snapshot: { totalCOGS: 1, work: null } }] }
    expect(hasCommissionFigures({ work })).toBe(true)
    expect(hasCommissionFigures({ proposal })).toBe(true)
    const out = clearedCommission(work, proposal)
    expect(out.work.priced).toEqual({ commissionCents: 0, grossMarginCents: 353227, priceCents: 591400 })
    expect(out.work.type).toBe(type)
    expect(out.proposal.options[0].snapshot.work!.priced.commissionCents).toBe(0)
    expect(out.proposal.options[0].finalPrice).toBe(5914)
    expect(out.proposal.options[1].snapshot.work).toBeNull()
    expect(hasCommissionFigures(out)).toBe(false)
    expect(savedCommission({ gmPct: 0.569, finalPrice: 5914, totalCOGS: 2549, hasSalesman: false, work: out.work })).toBeNull()
  })
})

describe('a signed quote\'s lock', () => {
  test('a move\'s record is not a price: a save without it is no change', () => {
    expect(lockedChanges({ pricing: { costFactor: 0.56, commissionMovedOff: true } }, { pricing: { costFactor: 0.56 } })).toEqual([])
    expect(lockedChanges({ pricing: { costFactor: 0.56, commissionMovedOff: true } }, { pricing: { costFactor: 0.5 } })).toEqual(['pricing'])
  })
})

describe('the margin saved at signing', () => {
  const own = { fenceStyle: 'WV', finalPrice: 12145, totalCOGS: 7061.44, gmPct: 0.41856 }
  test('a typed price, no commission: the true margin, not the list price\'s (Jaziel Ortiz: 44.00 → 41.86)', () => {
    expect(gmPctAtSigning(own, { fenceStyle: 'WV', finalPrice: 12145 }, { totalCOGS: 7061.44, gmPct: 0.44 })).toBeCloseTo(0.41856, 4)
  })
  test('a typed price with a Salesman: the commission saved on the quote stays out', () => {
    const q = { ...own, hasSalesman: true, gmPct: 0.33 }
    expect(gmPctAtSigning(q, { fenceStyle: 'WV', finalPrice: 12145 }, { totalCOGS: 7061.44, gmPct: 0.35 })).toBeCloseTo(0.33, 6)
  })
  test('another option of a Salesman quote stays as priced', () => {
    const q = { ...own, hasSalesman: true, gmPct: 0.33 }
    expect(gmPctAtSigning(q, { fenceStyle: 'Tan', finalPrice: 13000 }, { totalCOGS: 7300, gmPct: 0.35 })).toBe(0.35)
  })
  test('another option of a quote with no commission: price less cost', () => {
    expect(gmPctAtSigning(own, { fenceStyle: 'Tan', finalPrice: 10000 }, { totalCOGS: 5600, gmPct: 0.35 })).toBeCloseTo(0.44, 6)
  })
})
