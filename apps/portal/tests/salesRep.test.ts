/**
 * Which old quotes and jobs the Salesman is credited on (lib/salesRep.ts,
 * scripts/backfill-sales-rep.ts). A record that names a rep is never changed.
 */

import { describe, test, expect } from 'vitest'
import { pickRepBackfill, repName, sameName } from '../src/server/lib/salesRep'

const christa = { id: 'u-christa', firstName: 'Christa', lastName: 'Feagin' }
const q = (id: string, o: Partial<{ ownerId: string | null; crmContactId: string | null; salesRep: string }> = {}) =>
  ({ id, ownerId: o.ownerId ?? 'u-jonathan', crmContactId: o.crmContactId ?? null, salesRep: o.salesRep ?? '', customerName: `Cust ${id}`, status: 'SENT' })
const j = (id: string, o: Partial<{ quoteId: string | null; crmContactId: string | null; salesRep: string }> = {}) =>
  ({ id, quoteId: o.quoteId ?? null, crmContactId: o.crmContactId ?? null, salesRep: o.salesRep ?? '', customerName: `Cust ${id}` })

describe('names', () => {
  test('first and last, spaces tidied; compared without case', () => {
    expect(repName({ firstName: ' Christa', lastName: 'Feagin ' })).toBe('Christa Feagin')
    expect(sameName('Christa ', 'christa')).toBe(true)
    expect(sameName('', '')).toBe(false)
  })
})

describe('the backfill list', () => {
  const pick = (over: Partial<Parameters<typeof pickRepBackfill>[0]>) =>
    pickRepBackfill({ salesmen: [christa], quotes: [], jobs: [], cards: [], contacts: [], ...over })

  test('a blank quote she made is hers; its job follows', () => {
    const fixes = pick({ quotes: [q('q1', { ownerId: 'u-christa' })], jobs: [j('j1', { quoteId: 'q1' })] })
    expect(fixes.map(f => [f.kind, f.id, f.rep, f.why])).toEqual([
      ['quote', 'q1', 'Christa Feagin', 'she made the quote'],
      ['job', 'j1', 'Christa Feagin', 'its quote is hers'],
    ])
  })

  test('a rep already on the quote or job is never changed', () => {
    const fixes = pick({
      quotes: [q('q1', { ownerId: 'u-christa', salesRep: 'Jonathan Bohdal' }), q('q2', { ownerId: 'u-christa', salesRep: 'Christa' })],
      jobs: [j('j1', { quoteId: 'q1' }), j('j2', { quoteId: 'q2', salesRep: 'Christa' })],
    })
    expect(fixes).toEqual([])
  })

  test('a job whose quote names "Christa" (first name only) gets her full name', () => {
    const fixes = pick({ quotes: [q('q2', { salesRep: 'Christa ' })], jobs: [j('j2', { quoteId: 'q2' })] })
    expect(fixes).toEqual([expect.objectContaining({ kind: 'job', id: 'j2', rep: 'Christa Feagin' })])
  })

  test('the pipeline card names her: by its quote, or by the customer', () => {
    const fixes = pick({
      quotes: [q('q1'), q('q2', { crmContactId: 'c2' }), q('q3', { crmContactId: 'c3' })],
      cards: [{ quoteId: 'q1', assignedRep: 'Christa' }, { customerId: 'c2', assignedRep: 'Christa Feagin' }, { customerId: 'c3', assignedRep: 'Jonathan Bohdal' }],
    })
    expect(fixes.map(f => [f.id, f.why])).toEqual([['q1', 'her pipeline card'], ['q2', 'her pipeline card']])
  })

  test("the customer's rep is her, or she entered the customer", () => {
    const fixes = pick({
      quotes: [q('q1', { crmContactId: 'c1' }), q('q2', { crmContactId: 'c2' }), q('q3', { crmContactId: 'c3' })],
      contacts: [{ id: 'c1', salesRep: 'Christa', ownerId: 'u-jonathan' }, { id: 'c2', salesRep: '', ownerId: 'u-christa' }, { id: 'c3', salesRep: '', ownerId: 'u-jonathan' }],
    })
    expect(fixes.map(f => [f.id, f.why])).toEqual([['q1', "the customer's rep is her"], ['q2', 'she entered the customer']])
  })

  test("Jonathan's quotes and jobs stay as they are", () => {
    const fixes = pick({
      quotes: [q('q1'), q('q2', { salesRep: 'Jonathan Bohdal', crmContactId: 'c1' })],
      jobs: [j('j1', { quoteId: 'q1' }), j('j2', { quoteId: 'q2', crmContactId: 'c1' })],
      contacts: [{ id: 'c1', salesRep: '', ownerId: 'u-christa' }],
    })
    // q1 is blank but nothing ties it to her; j2's quote names Jonathan even though she entered the customer.
    expect(fixes).toEqual([])
  })

  test('no Salesman logins: nothing', () => {
    expect(pickRepBackfill({ salesmen: [], quotes: [q('q1', { ownerId: 'u-christa' })], jobs: [], cards: [], contacts: [] })).toEqual([])
  })
})
