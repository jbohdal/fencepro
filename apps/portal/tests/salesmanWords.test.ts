/** The owner's message after Change, and a name's possessive (review, Oct 30 2026). */
import { describe, test, expect } from 'vitest'
import { changeWords } from '../../web/src/salesmanWords'
import { possessive } from '../../web/src/personName'

describe('the owner\'s message after changing a customer\'s Salesman', () => {
  test('she keeps the customer by a signed quote; what moved is named', () => {
    expect(changeWords({ to: 'AUD Sales', was: 'Christa Feagin', customer: 'Dana', quotesMoved: 1, visitsMoved: 1, wasKeeps: 1 }))
      .toBe('AUD Sales is the Salesman of Dana now. Christa Feagin keeps Dana because of the signed quote; the open quote and the visit went to AUD Sales.')
  })
  test('she no longer has the customer', () => {
    expect(changeWords({ to: 'AUD Sales', was: 'Christa Feagin', customer: 'Dana', quotesMoved: 2, visitsMoved: 0, wasKeeps: 0 }))
      .toBe('AUD Sales is the Salesman of Dana now. Christa Feagin no longer has Dana. The 2 open quotes went to AUD Sales.')
    expect(changeWords({ to: 'AUD Sales', was: 'Christa Feagin', customer: 'Dana', quotesMoved: 0, visitsMoved: 0, wasKeeps: 0 }))
      .toBe('AUD Sales is the Salesman of Dana now. Christa Feagin no longer has Dana.')
  })
  test('nobody had it', () => {
    expect(changeWords({ to: 'Christa Feagin', was: '', customer: 'Dana', quotesMoved: 0, visitsMoved: 0, wasKeeps: 0 })).toBe('Christa Feagin is the Salesman of Dana.')
  })
  test('possessive: a name ending in s takes only the apostrophe', () => {
    expect(possessive('AUD Sales')).toBe("AUD Sales'")
    expect(possessive('Christa Feagin')).toBe("Christa Feagin's")
  })
})
