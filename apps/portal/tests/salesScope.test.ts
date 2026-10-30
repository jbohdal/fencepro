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

  test('quotes: the rep decides; a quote with no rep is hers when she wrote it or its customer is hers', () => {
    expect([...scope.quoteIds].sort()).toEqual(['q-assigned', 'q-mine'])
    // A quote whose rep names someone else is theirs, even on the Salesman's own customer (Oct 29 2026).
    expect(scope.quoteIds.has('q-owner-on-my-customer')).toBe(false)
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

  test('a customer the Salesman entered and gave to someone else is theirs (the Salesman choice, Oct 28 2026)', () => {
    const given = buildSalesScope({
      ...base,
      contacts: [
        { id: 'c-entered-blank', ownerId: me, salesRep: '' },
        { id: 'c-entered-mine', ownerId: me, salesRep: 'christa' },
        { id: 'c-entered-given', ownerId: me, salesRep: 'Sam Other' },
      ],
      quotes: [], jobs: [], cards: [], appointments: [],
    })
    expect([...given.contactIds].sort()).toEqual(['c-entered-blank', 'c-entered-mine'])
    expect(inSalesScope('contacts', given, { id: 'x', ownerId: me, salesRep: 'Sam Other' })).toBe(false)
    expect(inSalesScope('contacts', given, { id: 'y', ownerId: me, salesRep: null })).toBe(true)
  })

  test('after a move (Jonathan, Oct 29 2026): unsold quotes leave her list; signed ones whose rep is still her stay, with their customer', () => {
    // Cleo was the Salesman's; the owner moved her to Sam: the open quotes went with her (D3), the sold one and its job stayed.
    const moved = buildSalesScope({
      ...base,
      contacts: [
        { id: 'c-cleo', ownerId: me, salesRep: 'Sam Other' },
        { id: 'c-dan', ownerId: me, salesRep: 'Sam Other' },
        { id: 'c-eve', ownerId: 'u-owner', salesRep: 'Christa Feagin' },
      ],
      quotes: [
        { id: 'q-cleo-draft', ownerId: me, salesRep: 'Sam Other', crmContactId: 'c-cleo' },
        { id: 'q-cleo-sold', ownerId: me, salesRep: 'Christa Feagin', crmContactId: 'c-cleo' },
        { id: 'q-dan-draft', ownerId: me, salesRep: 'Sam Other', crmContactId: 'c-dan' },
        { id: 'q-dan-sold-moved', ownerId: me, salesRep: 'Sam Other', crmContactId: 'c-dan' },
        { id: 'q-eve-draft-moved', ownerId: me, salesRep: 'Jonathan Bohdal', crmContactId: 'c-eve' },
        { id: 'q-eve-sold', ownerId: 'u-owner', salesRep: 'Christa', crmContactId: 'c-eve' },
      ],
      jobs: [
        { id: 'j-cleo', quoteId: 'q-cleo-sold', crmContactId: 'c-cleo', salesRep: 'Christa Feagin' },
        { id: 'j-dan-moved', quoteId: 'q-dan-sold-moved', crmContactId: 'c-dan', salesRep: 'Sam Other' },
      ],
      // A finished card and a past visit of hers left on Dan: neither keeps him.
      cards: [{ customerId: 'c-dan', assignedRep: 'Christa' }],
      appointments: [{ crmContactId: 'c-dan', assignedToUserId: me, assignedTo: 'Christa Feagin' }],
    })
    expect([...moved.quoteIds].sort()).toEqual(['q-cleo-sold', 'q-eve-sold'])
    expect([...moved.jobIds]).toEqual(['j-cleo'])
    // Cleo stays through her sold quote; Dan (everything moved) leaves; Eve is hers.
    expect([...moved.contactIds].sort()).toEqual(['c-cleo', 'c-eve'])
    expect(moved.directContactIds.has('c-cleo')).toBe(false)
    // One record opened by id: the rep on it decides, not who wrote it.
    expect(inSalesScope('quotes', moved, { id: 'q-cleo-draft', ownerId: me, salesRep: 'Sam Other', crmContactId: 'c-cleo' })).toBe(false)
    expect(inSalesScope('quotes', moved, { id: 'q-cleo-sold', ownerId: me, salesRep: 'Christa Feagin', crmContactId: 'c-cleo' })).toBe(true)
    // Moved since the scope was read: out at once.
    expect(inSalesScope('quotes', moved, { id: 'q-cleo-sold', ownerId: me, salesRep: 'Sam Other', crmContactId: 'c-cleo' })).toBe(false)
    expect(inSalesScope('jobs', moved, { id: 'j-cleo', quoteId: 'q-cleo-sold', crmContactId: 'c-cleo', salesRep: 'Sam Other' })).toBe(false)
    expect(inSalesScope('jobs', moved, { id: 'j-dan-moved', quoteId: 'q-dan-sold-moved', crmContactId: 'c-dan', salesRep: 'Sam Other' })).toBe(false)
    // Her card left on Dan is not shown; one on Cleo (still on her list) is.
    expect(inSalesScope('pipeline', moved, { id: 'k-dan', customerId: 'c-dan', assignedRep: 'Christa' })).toBe(false)
    expect(inSalesScope('pipeline', moved, { id: 'k-cleo', customerId: 'c-cleo', assignedRep: 'Sam Other' })).toBe(true)
    expect(inSalesScope('contacts', moved, { id: 'c-dan', ownerId: me, salesRep: 'Sam Other' })).toBe(false)
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
