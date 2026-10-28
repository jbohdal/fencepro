/**
 * The quote builder's Customer name step offers customers on file, and a new
 * customer's Save follows the import rule (audit #44, Oct 28 2026; web
 * src/customerPick.ts): same phone or email and the same name goes on that
 * customer; another name is a new customer with a Possible match.
 */

import { describe, test, expect } from 'vitest'
import { customersMatching, decideNewCustomer, sameName } from '../../web/src/customerPick'
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
