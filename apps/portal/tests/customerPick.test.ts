/**
 * The quote builder's Customer name step offers customers on file, and a new
 * customer's Save follows the import rule (audit #44, Oct 28 2026; web
 * src/customerPick.ts): same phone or email and the same name goes on that
 * customer; another name is a new customer with a Possible match. A phone or
 * email typed that they have none of is added to them; one where they have
 * another is not saved and is named in the dialog (audit #48).
 */

import { describe, test, expect } from 'vitest'
import { customersMatching, decideNewCustomer, sameName, contactToAdd, quoteDraftAddress, serviceAddressShown } from '../../web/src/customerPick'
import { sameName as serverSameName } from '../src/server/lib/customerImport'

const c = (id: string, firstName: string, lastName: string, phone = '', email = '', serviceAddress = '') => ({ id, firstName, lastName, phone, email, serviceAddress })
const ON_FILE = [
  c('a', 'Ann', 'Lee', '(352) 555-0100', 'ann@example.invalid', '1 Oak St'),
  c('b', 'Hector', 'Valle', '352-555-0199', ''),
  c('c', 'Annie', 'Leeds', '', 'aleeds@example.invalid'),
  c('d', 'Bob', 'Smith', '3525550123', ''),
]

describe('Customer name step: customers on file as typed', () => {
  test('by name, any order, any capitals; nothing under 2 letters', () => {
    expect(customersMatching(ON_FILE, 'a')).toEqual([])
    expect(customersMatching(ON_FILE, 'ann lee').map(x => x.id)).toEqual(['a', 'c'])
    expect(customersMatching(ON_FILE, 'LEE ANN').map(x => x.id)).toEqual(['a', 'c'])
    expect(customersMatching(ON_FILE, 'hector').map(x => x.id)).toEqual(['b'])
    expect(customersMatching(ON_FILE, 'Zed Nobody')).toEqual([])
  })
  test('by phone digits or email', () => {
    expect(customersMatching(ON_FILE, '555-0199').map(x => x.id)).toEqual(['b'])
    expect(customersMatching(ON_FILE, 'aleeds@').map(x => x.id)).toEqual(['c'])
  })
  test('at most the limit', () => {
    expect(customersMatching(ON_FILE, '352', 2)).toHaveLength(2)
  })
  test('names that start with what was typed come first, even past the limit', () => {
    const people = [
      { id: 'o', firstName: 'Steven', lastName: 'Ojohn' },
      { id: 'j1', firstName: 'John', lastName: 'Ruiz' },
      { id: 'j2', firstName: 'Ann', lastName: 'Johnson' },
    ]
    expect(customersMatching(people, 'john').map(x => x.id)).toEqual(['j1', 'j2', 'o'])
    expect(customersMatching(people, 'john', 2).map(x => x.id)).toEqual(['j1', 'j2'])
  })
})

describe('Save of a new customer whose phone or email is on file', () => {
  test('same name: the quote goes on them', () => {
    expect(decideNewCustomer({ first: 'ann', last: 'LEE' }, [ON_FILE[0]])).toEqual({ kind: 'attach', to: ON_FILE[0] })
  })
  test('another name: a new customer with a Possible match (Hector Pritoni vs Hector Valle)', () => {
    expect(decideNewCustomer({ first: 'Hector', last: 'Pritoni' }, [ON_FILE[1]])).toEqual({ kind: 'new_possible', matches: [ON_FILE[1]] })
  })
  test('several, exactly one by name: that one; none by name: new with Possible matches', () => {
    expect(decideNewCustomer({ first: 'Bob', last: 'Smith' }, [ON_FILE[1], ON_FILE[3]])).toEqual({ kind: 'attach', to: ON_FILE[3] })
    expect(decideNewCustomer({ first: 'Joe', last: 'Bloggs' }, [ON_FILE[1], ON_FILE[3]])).toMatchObject({ kind: 'new_possible' })
  })
  test('nothing on file: new', () => {
    expect(decideNewCustomer({ first: 'Ann', last: 'Lee' }, [])).toEqual({ kind: 'new' })
  })
  test('"same name" is the server import rule', () => {
    const pairs: Array<[string, string, string, string]> = [
      ['John', 'StClair', 'John', 'St. Clair'], ['Elsa', 'Ipus', 'Roger & Elsa', 'Ipus'], ['Nonito', 'Palencia Jr.', 'Nonito', 'Palencia'],
      ['Ant', 'G', 'Anthony', 'Gonzalez'], ['Jennifer', 'D', 'Jennifer', ''], ['Ted', 'miiler', 'Ted', 'Miller'], ['Hector', 'Pritoni', 'Hector', 'Valle'],
    ]
    for (const [f1, l1, f2, l2] of pairs) {
      expect(sameName({ first: f1, last: l1 }, { first: f2, last: l2 })).toBe(serverSameName({ first: f1, last: l1 }, { first: f2, last: l2 }))
    }
  })
})

describe('Put on the customer on file: the phone or email typed (audit #48)', () => {
  test('one they have none of is added; the same one (any format) is nothing', () => {
    // Hector Valle, found by phone, has no email.
    expect(contactToAdd(ON_FILE[1], { phone: '(352) 555-0199', email: ' hv@example.invalid ' })).toEqual({ add: { email: 'hv@example.invalid' }, kept: [] })
    // Annie Leeds, found by email (any case), has no phone.
    expect(contactToAdd(ON_FILE[2], { phone: '352 555 0444', email: 'ALeeds@Example.invalid' })).toEqual({ add: { phone: '352 555 0444' }, kept: [] })
    expect(contactToAdd(ON_FILE[0], { phone: '3525550100', email: 'ann@example.invalid' })).toEqual({ add: {}, kept: [] })
    expect(contactToAdd(ON_FILE[1], { phone: '', email: '' })).toEqual({ add: {}, kept: [] })
  })
  test('another one where they have theirs: kept, never overwritten', () => {
    expect(contactToAdd(ON_FILE[0], { phone: '(352) 555-0100', email: 'ann.new@example.invalid' })).toEqual({ add: {}, kept: [{ what: 'email', typed: 'ann.new@example.invalid', theirs: 'ann@example.invalid' }] })
    expect(contactToAdd(ON_FILE[0], { phone: '352-555-0777', email: 'ann@example.invalid' })).toEqual({ add: {}, kept: [{ what: 'phone', typed: '352-555-0777', theirs: '(352) 555-0100' }] })
  })
})

describe('Save of a new quote starts with the address it is drawn on (audit #52, review Oct 28 2026)', () => {
  test('the Yard step\'s aerial address, else the saved draft\'s, else none', () => {
    expect(quoteDraftAddress('  7 Pine Ln, Ocala, FL ', '')).toBe('7 Pine Ln, Ocala, FL')
    expect(quoteDraftAddress('7 Pine Ln, Ocala, FL', '12 Oak Rd')).toBe('7 Pine Ln, Ocala, FL')
    expect(quoteDraftAddress(undefined, '12 Oak Rd')).toBe('12 Oak Rd')
    expect(quoteDraftAddress('', null)).toBe('')
  })
  test('Service Address follows Property address until something is typed in it', () => {
    expect(serviceAddressShown(null, '7 Pine Ln')).toBe('7 Pine Ln')
    expect(serviceAddressShown(null, '7 Pine Lane, Ocala')).toBe('7 Pine Lane, Ocala')
    expect(serviceAddressShown('PO Box 4', '7 Pine Ln')).toBe('PO Box 4')
    // Typed and cleared: stays cleared (emptied on purpose).
    expect(serviceAddressShown('', '7 Pine Ln')).toBe('')
  })
})
