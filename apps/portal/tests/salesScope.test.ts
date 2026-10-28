/**
 * The Salesman's scope (lib/salesScope.ts) and the slim quote list
 * (lib/quoteSlim.ts), without a database.
 */

import { describe, test, expect } from 'vitest'
import { buildSalesScope, inSalesScope, isMine } from '../src/server/lib/salesScope.js'
import { slimProposal, slimQuote, withHeavyParts } from '../src/server/lib/quoteSlim.js'

const me = 'u-sales'
const base = { userId: me, accountId: 'acc', names: ['Christa Feagin', 'Christa'] }

describe('the Salesman\'s scope', () => {
  const scope = buildSalesScope({
    ...base,
    contacts: [
      { id: 'c-mine', ownerId: me, salesRep: null },
      { id: 'c-rep', ownerId: 'u-owner', salesRep: ' christa  feagin ' },
      { id: 'c-other', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal' },
      { id: 'c-via-quote', ownerId: 'u-owner', salesRep: null },
      { id: 'c-card', ownerId: 'u-owner', salesRep: null },
      { id: 'c-visit', ownerId: 'u-owner', salesRep: null },
    ],
    quotes: [
      { id: 'q-mine', ownerId: me, salesRep: '', crmContactId: 'c-mine' },
      { id: 'q-assigned', ownerId: 'u-owner', salesRep: 'Christa', crmContactId: 'c-via-quote' },
      { id: 'q-owner-on-assigned-customer', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal', crmContactId: 'c-via-quote' },
      { id: 'q-owner-on-my-customer', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal', crmContactId: 'c-rep' },
      { id: 'q-other', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal', crmContactId: 'c-other' },
    ],
    jobs: [
      { id: 'j-of-my-quote', quoteId: 'q-assigned', crmContactId: 'c-via-quote', salesRep: '' },
      { id: 'j-other', quoteId: 'q-other', crmContactId: 'c-other', salesRep: 'Jonathan Bohdal' },
    ],
    cards: [{ customerId: 'c-card', assignedRep: 'Christa' }, { customerId: 'c-other', assignedRep: 'Jonathan' }],
    appointments: [{ crmContactId: 'c-visit', assignedToUserId: me, assignedTo: 'Christa Feagin' }],
  })

  test('the Salesman\'s own and assigned customers, and the customer of a quote assigned to the Salesman', () => {
    expect([...scope.contactIds].sort()).toEqual(['c-card', 'c-mine', 'c-rep', 'c-via-quote', 'c-visit'])
    expect(scope.contactIds.has('c-other')).toBe(false)
  })

  test('quotes: made by or assigned to the Salesman, and every quote of the Salesman\'s own customers', () => {
    expect([...scope.quoteIds].sort()).toEqual(['q-assigned', 'q-mine', 'q-owner-on-my-customer'])
    // A customer brought in by one assigned quote does not bring that customer's other quotes.
    expect(scope.quoteIds.has('q-owner-on-assigned-customer')).toBe(false)
    expect(scope.quoteIds.has('q-other')).toBe(false)
  })

  test('jobs, cards and appointments follow', () => {
    expect([...scope.jobIds]).toEqual(['j-of-my-quote'])
    expect(inSalesScope('pipeline', scope, { id: 'k1', customerId: 'c-other', assignedRep: 'Jonathan' })).toBe(false)
    expect(inSalesScope('pipeline', scope, { id: 'k2', customerId: 'c-via-quote' })).toBe(true)
    expect(inSalesScope('appointments', scope, { crmContactId: 'c-other', assignedToUserId: 'u-owner', assignedTo: 'Jonathan Bohdal' })).toBe(false)
    expect(inSalesScope('appointments', scope, { crmContactId: 'c-other', assignedToUserId: me })).toBe(true)
  })

  test('a record made a moment ago that names the Salesman is in scope; another person\'s is not', () => {
    expect(inSalesScope('contacts', scope, { id: 'new', ownerId: me })).toBe(true)
    expect(inSalesScope('quotes', scope, { id: 'new-q', ownerId: me, crmContactId: 'c-other' })).toBe(true)
    expect(inSalesScope('quotes', scope, { id: 'q-other', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal', crmContactId: 'c-other' })).toBe(false)
  })

  test('names: full or first, any case or spacing; never someone else\'s', () => {
    expect(isMine(scope, 'CHRISTA')).toBe(true)
    expect(isMine(scope, 'Christa  Feagin')).toBe(true)
    expect(isMine(scope, 'Christopher Lindsey')).toBe(false)
    expect(isMine(scope, '')).toBe(false)
  })
})

describe('the slim quote list', () => {
  const proposal = {
    version: 1, planSvg: '<svg>plan</svg>', recommended: 0, terms: [{ title: 'T', body: 'b' }],
    options: [
      { label: 'Better', fenceStyle: 'WV ND 6x8', finalPrice: 8409, perFoot: 52.1, sections: 20, warranty: { name: 'Lifetime' }, snapshot: { pullSheet: [{ item: 'Post', qty: 21 }], runRails: ['8ft'], materialCost: 3000 } },
      { label: 'Best', fenceStyle: 'TV ND 6x8', finalPrice: 9100.5, perFoot: 56, sections: 20, snapshot: { pullSheet: [{ item: 'Post', qty: 21 }] } },
    ],
  }

  test('no drawing and no option copies; every sent price, label, tier and warranty kept', () => {
    const s = slimProposal(proposal)
    expect(s.planSvg).toBeUndefined()
    expect(s.slim).toBe(true)
    expect(s.options.map((o: any) => o.snapshot)).toEqual([undefined, undefined])
    expect(s.options.map((o: any) => [o.label, o.fenceStyle, o.finalPrice, o.perFoot, o.sections])).toEqual(proposal.options.map(o => [o.label, o.fenceStyle, o.finalPrice, o.perFoot, o.sections]))
    expect(s.options[0].warranty).toEqual({ name: 'Lifetime' })
    expect(s.terms).toEqual(proposal.terms)
    // The quote's own fields are untouched.
    const q = slimQuote({ id: 'q', finalPrice: 8409, pullSheet: [{ item: 'Post' }], proposal })
    expect(q.finalPrice).toBe(8409)
    expect(q.pullSheet).toEqual([{ item: 'Post' }])
    expect(slimQuote({ id: 'q', proposal: null }).proposal).toBeNull()
  })

  test('sent back slim: the saved drawing and copies go back on, the mark comes off', () => {
    const back = withHeavyParts(slimProposal(proposal), proposal)
    expect(back).toEqual(proposal)
    // Not slim: as sent.
    const fresh = { ...proposal, planSvg: '<svg>new</svg>' }
    expect(withHeavyParts(fresh, proposal)).toBe(fresh)
    // An option whose price changed is not given the old copy.
    const changed = slimProposal(proposal)
    changed.options[1] = { ...changed.options[1], finalPrice: 9999 }
    expect(withHeavyParts(changed, proposal).options[1].snapshot).toBeUndefined()
    expect(withHeavyParts(changed, proposal).options[0].snapshot).toEqual(proposal.options[0].snapshot)
  })
})
