/**
 * D3 and D4 (Jonathan, Oct 29 2026), the pure parts: the commission a quote
 * carries (the same cents the app shows, web salesmanCommission.ts), when a
 * quote save keeps the stored rep (lib/quotesFollowCustomer.ts), and where
 * the Salesman choice starts (lib/salesmanChoice.ts, web salesmanChoice.ts).
 */
import { describe, test, expect } from 'vitest'
import { quoteCommissionCents, quoteRepKept, samePerson } from '../src/server/lib/quotesFollowCustomer'
import { preselectFor } from '../src/server/lib/salesmanChoice'
import { savedCommission } from '../../web/src/salesmanCommission'
import { preselectOf, startsOnSelf, isOfficeStart } from '../../web/src/salesmanStart'

describe('the commission a quote carries', () => {
  const shapes = [
    { name: 'reviewer\'s $13,407, Salesman on', q: { hasSalesman: true, finalPrice: 13407, totalCOGS: 7000, gmPct: (13407 - 7000 - 1206.63) / 13407 } },
    { name: 'own % kept on the quote', q: { hasSalesman: false, finalPrice: 8000, totalCOGS: 4000, gmPct: 0.41, pricing: { commissionPct: 0.09 } } },
    { name: 'a repair\'s own commission', q: { hasSalesman: true, finalPrice: 900, totalCOGS: 300, gmPct: 0.5, work: { priced: { commissionCents: 8100 } } } },
    { name: 'switch off', q: { hasSalesman: false, finalPrice: 8000, totalCOGS: 4000, gmPct: 0.5 } },
    { name: 'no price', q: { hasSalesman: true, finalPrice: 0, totalCOGS: 0, gmPct: 0 } },
  ]
  for (const { name, q } of shapes) {
    test(`${name}: the same cents the app shows`, () => {
      expect(quoteCommissionCents(q)).toBe(savedCommission(q as any)?.cents ?? 0)
    })
  }
  test('the reviewer\'s quote: $1,206.63', () => expect(quoteCommissionCents(shapes[0].q)).toBe(120663))
})

describe('the same person as a rep is written', () => {
  test('full name, any case and spaces, or the first name alone on either side', () => {
    expect(samePerson('Christa Feagin', ' christa  feagin ')).toBe(true)
    expect(samePerson('Christa', 'Christa Feagin')).toBe(true)
    expect(samePerson('Christa Feagin', 'christa')).toBe(true)
    expect(samePerson('Christa Feagin', 'Christa Smith')).toBe(false)
    expect(samePerson('', 'Christa')).toBe(false)
    expect(samePerson('Jb', 'Jonathan Bohdal')).toBe(false)
  })
})

describe('a quote save keeps the stored rep', () => {
  const open = { salesRep: 'Sam Smith', status: 'DRAFT', soldAt: null, acceptedAt: null, crmContactId: 'c1' }
  test('an older copy sends the old rep for an open quote of the same customer, whose Salesman is the stored rep: kept', () => {
    expect(quoteRepKept({ existing: open, sentRep: 'Christa Feagin', sentContactId: 'c1', customerRep: 'sam smith' })).toBe(true)
    expect(quoteRepKept({ existing: { ...open, status: 'SENT' }, sentRep: 'Christa Feagin', sentContactId: undefined, customerRep: 'Sam Smith' })).toBe(true)
  })
  test('not kept: the same rep, a blank one, a sold, accepted or lost quote, another customer, or a quote whose rep is not its customer\'s', () => {
    expect(quoteRepKept({ existing: open, sentRep: ' sam  SMITH ', sentContactId: 'c1', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: open, sentRep: '', sentContactId: 'c1', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: { ...open, status: 'SOLD' }, sentRep: 'Christa', sentContactId: 'c1', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: { ...open, soldAt: new Date() }, sentRep: 'Christa', sentContactId: 'c1', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: { ...open, acceptedAt: new Date() }, sentRep: 'Christa', sentContactId: 'c1', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: { ...open, status: 'LOST' }, sentRep: 'Christa', sentContactId: 'c1', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: open, sentRep: 'Christa', sentContactId: 'c2', customerRep: 'Sam Smith' })).toBe(false)
    expect(quoteRepKept({ existing: { ...open, crmContactId: null }, sentRep: 'Christa', sentContactId: undefined, customerRep: null })).toBe(false)
    expect(quoteRepKept({ existing: open, sentRep: 'Christa', sentContactId: 'c1', customerRep: 'Christa' })).toBe(false)
  })
})

describe('where the Salesman choice starts (D4)', () => {
  const people = [
    { id: 'o', name: 'Jonathan Bohdal', role: 'super_admin', email: 'o@example.invalid' },
    { id: 'a', name: 'Alex Admin', role: 'admin', email: 'a@example.invalid' },
    { id: 'c', name: 'Christa Feagin', role: 'sales_rep', email: 'c@example.invalid' },
  ]
  test('the owner, an admin and a Salesman start on themselves', () => {
    expect(preselectFor(people, 'o')?.name).toBe('Jonathan Bohdal')
    expect(preselectFor(people, 'a')?.name).toBe('Alex Admin')
    expect(preselectFor(people, 'c')?.name).toBe('Christa Feagin')
  })
  test('the office (not a choice) starts on the owner, found by role; with no owner login, the first admin; with neither, nobody', () => {
    expect(preselectFor(people, 'office')?.name).toBe('Jonathan Bohdal')
    expect(preselectFor(people.slice(1), 'office')?.name).toBe('Alex Admin')
    expect(preselectFor(people.slice(2), 'office')).toBeNull()
  })
})

describe('the web choice: where it starts and what it says (D4)', () => {
  const choices = [
    { id: 'o', name: 'Jonathan Bohdal', role: 'super_admin', me: false, preselected: true },
    { id: 'c', name: 'Christa Feagin', role: 'sales_rep', me: false },
  ]
  test('starts on the server\'s word; an older server\'s list starts on the person entering', () => {
    expect(preselectOf({ choices, mine: 'Opal Office', canChange: true, preselect: 'Jonathan Bohdal' })).toBe('Jonathan Bohdal')
    expect(preselectOf({ choices: [{ ...choices[1], me: true }], mine: 'Christa Feagin', canChange: false })).toBe('Christa Feagin')
  })
  test('only the owner, admins and Salesmen start on themselves', () => {
    expect(['super_admin', 'admin', 'sales_rep', 'office_staff', 'manager'].map(startsOnSelf)).toEqual([true, true, true, false, false])
  })
  test('the office: no words on its start (the owner); picking someone else gets them; the Salesman always gets them', () => {
    expect(isOfficeStart(' jonathan  bohdal', 'office_staff', 'Jonathan Bohdal')).toBe(true)
    expect(isOfficeStart('Christa Feagin', 'office_staff', 'Jonathan Bohdal')).toBe(false)
    expect(isOfficeStart('Jonathan Bohdal', 'office_staff', '')).toBe(false)
    expect(isOfficeStart('Christa Feagin', 'sales_rep', 'Christa Feagin')).toBe(false)
  })
})
