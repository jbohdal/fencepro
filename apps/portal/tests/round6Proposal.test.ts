/**
 * Round 6 review, Oct 27 2026, without a database: what the customer reads.
 *   3. a repair proposal says repair (one option: no "Choose an option above"; the warranty runs from the
 *      repair date; Property and Access says the day of the repair);
 *   4. sold in the app but never signed by the customer: "agreed with us", not "signed";
 *   5. a best price fence is "6 ft or 8 ft panels", never the office's "(best price)" tag, on the
 *      proposal, the signed page and the contract, and the sold link names it as the signed page does.
 */

import { describe, test, expect } from 'vitest'
import { renderProposal, refusalText, standingOptionOf } from '../src/server/routes/proposal.js'
import { acceptedOptionText } from '../src/server/lib/contractPdf.js'
import { customerFenceName } from '../src/server/lib/customerFenceName.js'
import { termsForRepair, REPAIR_ACCESS_DAY, STOCK_ACCESS_DAY } from '../src/server/lib/contractTerms.js'
import { warrantyTextForRepair, warrantyForStyle, defaultWarrantySettings, ONE_YEAR_TEXT } from '../../web/src/warranties'
import { proposalTerms } from '../../web/src/contractTerms'

const opt = (label: string, fenceStyle: string, finalPrice: number, extra: Record<string, unknown> = {}) => ({ label, fenceStyle, finalPrice, perFoot: 0, sections: 0, snapshot: { pullSheet: [{ item: label, qty: 1 }] }, ...extra })
const company = { name: 'Getter Done Fence', phone: '3527894314' }
const q = { customerName: 'Pat Test', customerAddress: '1 Oak Ln', acceptedAt: null, fenceStyle: 'REPAIR', finalPrice: 450 }

describe('a repair proposal says repair', () => {
  const repair = {
    version: 1, kind: 'repair', description: 'Replace a post', company, customer: { name: 'Pat Test' }, depositPct: 0, recommended: 0,
    terms: termsForRepair(proposalTerms(null)),
    options: [opt('Fence repair', 'REPAIR', 450, { warranty: { id: 'one-year-workmanship', name: '1 year workmanship', text: warrantyTextForRepair(ONE_YEAR_TEXT), term: 'years', years: 1 } })],
  }

  test('one option: nothing to choose', () => {
    const html = renderProposal(q, repair as any, 'tok', 'n', [], null, '', { start: 0, hidden: [] })
    expect(html).not.toContain('Choose an option above')
    expect(html).toContain('data-one-option>Type your name and sign with your finger to accept it.')
    expect(html).toContain('>Accept this proposal</button>')
    expect(html).toContain('<h2>Your price</h2>')
  })

  test('two options still ask to choose', () => {
    const two = { ...repair, options: [...repair.options, opt('New fence instead', 'WV', 5000)] }
    const html = renderProposal(q, two as any, 'tok', 'n', [], null, '', { start: 0, hidden: [] })
    expect(html).toContain('Choose an option above')
    expect(html).toContain('>Accept the selected option</button>')
  })

  test('the warranty runs from the repair date, as the contract says; Property and Access says the day of the repair', () => {
    const html = renderProposal(q, repair as any, 'tok', 'n', [], null, '', { start: 0, hidden: [] })
    expect(html).toContain('Workmanship is warranted for 1 year from the repair date against defects in workmanship.')
    expect(html).not.toMatch(/installation/i)
    expect(html).toContain(REPAIR_ACCESS_DAY)
    expect(html).toContain('Repair work is per the items listed above.')
  })

  test('Settings → Warranties give a repair its words with the repair date; a new fence and a move keep theirs', () => {
    const s = defaultWarrantySettings()
    expect(warrantyForStyle(s, { name: 'x' }, 'repair')?.text).toContain('from the repair date')
    expect(warrantyForStyle(s, { name: 'x' }, 'move')?.text ?? '').not.toContain('repair date')
    expect(warrantyTextForRepair('Installation date starts it. 2 years from the install date.')).toBe('The repair date starts it. 2 years from the repair date.')
    expect(warrantyTextForRepair('Covers our installation work.')).toBe('Covers our installation work.')
  })

  test('only the stock Property and Access words change; words typed instead stay', () => {
    const t = termsForRepair([{ key: 'property_access', title: 'Property and Access', text: `Gates unlocked ${STOCK_ACCESS_DAY}.` }, { key: 'property_access', title: 'P', text: 'Typed by Jonathan.' }])
    expect(t.map(x => x.text)).toEqual([`Gates unlocked ${REPAIR_ACCESS_DAY}.`, 'Typed by Jonathan.'])
  })
})

describe('sold in the app, never signed by the customer', () => {
  const P = { version: 1, company, customer: { name: 'Pat Test' }, depositPct: 50, recommended: 0, terms: [], options: [opt('Dig set', 'DS', 6093), opt('No dig', 'ND', 7363)] }
  const sold = { ...q, fenceStyle: 'ND', finalPrice: 7363 }

  test('agreed with us, not signed', () => {
    const html = renderProposal(sold, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: 1 })
    expect(html).toContain('data-sold-note>Your fence was agreed with us for <b>No dig</b>')
    expect(html).not.toMatch(/was (already )?signed/)
    const none = renderProposal(sold, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: -1, soldLabel: 'Tan no dig' })
    expect(none).toContain('<h2>Already agreed</h2><p>Your fence was already agreed with us for <b>Tan no dig</b>')
    expect(refusalText('signed', 'No dig', '3527894314')).toBe('Your fence was already agreed with us for No dig. To change it, please call us at (352) 789 4314.')
  })

  test('signed on the link: still "accepted"', () => {
    expect(refusalText('accepted', 'No dig', '')).toBe('This proposal was already accepted for No dig. To make a change, please call us.')
  })
})

describe('a best price fence by its plain name', () => {
  const AUTO = 'White Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), No dig'
  const EIGHT = 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig'

  test('the customer name drops the office tag; anything else is as written', () => {
    expect(customerFenceName(AUTO)).toBe('White Vinyl Privacy, 6 ft tall, 6 ft or 8 ft panels, No dig')
    expect(customerFenceName(EIGHT)).toBe(EIGHT)
    expect(customerFenceName('Fence repair')).toBe('Fence repair')
  })

  test('the proposal, the sold link and the signed page all say "6 ft or 8 ft panels"; the price is the saved one', () => {
    // The best price option is the same fence as the 8 ft tier (sold through its twin card).
    const P = { version: 1, company, customer: { name: 'Pat Test' }, depositPct: 50, recommended: 0, terms: [], options: [opt(EIGHT, 'WV8', 7363, { tier: { key: 'better', label: 'Better' } }), opt(AUTO, 'WVAUTO', 7363)] }
    const open = renderProposal({ ...q, fenceStyle: 'WVAUTO', finalPrice: 7363 }, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [] })
    expect(open).toContain('6 ft or 8 ft panels')
    expect(open).not.toContain('best price')

    // proposalPage puts the standing fence's name on the twin card it is shown by.
    expect(standingOptionOf(P.options, { fenceStyle: 'WVAUTO', finalPrice: 7363 }, 0)).toBe(1)
    expect(standingOptionOf(P.options, { fenceStyle: 'WV8', finalPrice: 7363 }, 0)).toBe(0)
    const relabeled = { ...P, options: [{ ...P.options[0], label: AUTO }, P.options[1]] }
    const soldLink = renderProposal({ ...q, fenceStyle: 'WVAUTO', finalPrice: 7363 }, relabeled as any, 'tok', 'n', [], null, '', { start: 0, hidden: [1], sold: 0 })
    expect(soldLink).toContain('agreed with us for <b>White Vinyl Privacy, 6 ft tall, 6 ft or 8 ft panels, No dig</b> at <b>$7,363</b>')

    const signed = { ...q, fenceStyle: 'WVAUTO', finalPrice: 7363, acceptedAt: new Date('2026-10-27T15:00:00Z'), acceptedBy: 'Pat Test', chosenOption: 0, status: 'SOLD' }
    const page = renderProposal(signed, relabeled as any, 'tok', 'n', [], null, '', { start: 0, hidden: [] })
    expect(page).toContain('Pat Test on October 27, 2026: White Vinyl Privacy, 6 ft tall, 6 ft or 8 ft panels, No dig at $7,363.')
    // The contract's signed record names it the same (signed through the 8 ft twin card).
    expect(acceptedOptionText({ proposal: P, chosenOption: 0, fenceStyle: 'WVAUTO', finalPrice: 7363, acceptedAt: signed.acceptedAt } as any)).toBe('White Vinyl Privacy, 6 ft tall, 6 ft or 8 ft panels, No dig at $7,363.00')
  })
})
