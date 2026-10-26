/**
 * Round 3 recheck (Oct 26 2026): what an independent re-check found.
 */
import { describe, test, expect } from 'vitest'
import { jobRowTarget } from '../../web/src/customerPage'
import { canOpenOperations } from '../../web/src/permissions'

describe('a Jobs tab row opens what the login can see (item 1)', () => {
  test('the Salesman cannot open Operations; the office, the owner and the installer can', () => {
    expect(canOpenOperations('sales_rep')).toBe(false)
    for (const r of ['super_admin', 'admin', 'manager', 'office_staff', 'field_crew']) expect(canOpenOperations(r)).toBe(true)
    expect(canOpenOperations(null)).toBe(false)
  })
  test('the office: the job window in Operations', () => {
    expect(jobRowTarget({ jobId: 'j 1', canOpenOperations: true, quoteId: 'q1', quoteOnPhone: true, cardId: 'c1' }))
      .toEqual({ kind: 'operations', path: '/operations?job=j%201' })
  })
  test('the Salesman: the sold quote window (its change orders), never Operations', () => {
    expect(jobRowTarget({ jobId: 'j1', canOpenOperations: false, quoteId: 'q1', quoteOnPhone: true, cardId: 'c1' }))
      .toEqual({ kind: 'quote', quoteId: 'q1' })
  })
  test('the Salesman, the quote not on her phone: the pipeline card window', () => {
    expect(jobRowTarget({ jobId: 'j1', canOpenOperations: false, quoteId: 'q1', quoteOnPhone: false, cardId: 'c1' }))
      .toEqual({ kind: 'card', path: '/pipeline?card=c1' })
  })
  test('neither: no bounce, a word', () => {
    expect(jobRowTarget({ jobId: 'j1', canOpenOperations: false, quoteId: null, quoteOnPhone: false, cardId: null })).toEqual({ kind: 'none' })
  })
})
