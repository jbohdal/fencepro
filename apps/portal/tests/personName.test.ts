/**
 * The quote builder's "Customer name" carried into New Customer's First and
 * Last Name, split on the last space (review, Oct 27 2026; web/src/personName.ts).
 */
import { describe, test, expect } from 'vitest'
import { splitOnLastSpace } from '../../web/src/personName'

describe('a typed customer name split for New Customer', () => {
  test('on the last space', () => {
    expect(splitOnLastSpace('Shawn Collins')).toEqual({ firstName: 'Shawn', lastName: 'Collins' })
    expect(splitOnLastSpace('Mary Ann Smith')).toEqual({ firstName: 'Mary Ann', lastName: 'Smith' })
    expect(splitOnLastSpace('  Mary   Ann  Smith ')).toEqual({ firstName: 'Mary Ann', lastName: 'Smith' })
  })
  test('one word or nothing', () => {
    expect(splitOnLastSpace('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
    expect(splitOnLastSpace('')).toEqual({ firstName: '', lastName: '' })
    expect(splitOnLastSpace(null)).toEqual({ firstName: '', lastName: '' })
  })
})
