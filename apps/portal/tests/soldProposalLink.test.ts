/**
 * A quote sold in the app before the customer signed its proposal link
 * (audit fix, Oct 27 2026): the link shows only the sold option, the one to
 * sign; sold for a fence no longer on the proposal, nothing can be signed
 * there (call us). Once signed on the link: only the signed option, with
 * Accepted and the signed contract near the top (review Oct 27 2026). A
 * refused signing names the fence that stands and the number to call.
 */

import { describe, test, expect } from 'vitest'
import { renderProposal, signedOptionOf, refusalText } from '../src/server/routes/proposal.js'
import { sameFenceAs } from '../../web/src/proposalOptions'

const opt = (label: string, fenceStyle: string, finalPrice: number, sheet = [{ item: label, qty: 1 }]) => ({ label, fenceStyle, finalPrice, perFoot: 0, sections: 19, snapshot: { pullSheet: sheet } })
const P = {
  version: 1, company: { name: 'Getter Done Fence', phone: '3528442677' }, customer: { name: 'Pat Test', address: '1 Oak Ln' },
  depositPct: 50, recommended: 0, terms: [{ key: 'permits', title: 'Permits', text: 'Customer gets the permit.' }],
  options: [opt('Dig set', 'DS', 6093), opt('No dig', 'ND', 7363), opt('Tan no dig', 'TND', 7924)],
}
const q = { customerName: 'Pat Test', customerAddress: '', acceptedAt: null, fenceStyle: 'ND', finalPrice: 7363 }

describe('the option a quote sold in the app was sold for', () => {
  test('its style at its price; its shown twin when hidden as the same fence; -1 when not on the proposal', () => {
    expect(signedOptionOf(P.options, q, sameFenceAs(P.options))).toBe(1)
    const twin = [...P.options, opt('Best price', 'AUTO', 7363)]
    twin[3].snapshot = P.options[1].snapshot
    expect(signedOptionOf(twin, { fenceStyle: 'AUTO', finalPrice: 7363 }, sameFenceAs(twin))).toBe(1)
    expect(signedOptionOf(P.options, { fenceStyle: 'ND', finalPrice: 7000 }, sameFenceAs(P.options))).toBe(-1)
  })
})

describe('the proposal link of a quote already sold in the app', () => {
  test('only the sold option shows, the one to sign; the others and their prices are not on the page', () => {
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: 1 })
    expect(html).toMatch(/data-option="1">\s*<input type="radio" name="option" value="1" checked>/)
    expect(html.match(/data-option="/g)).toHaveLength(1)
    expect(html).not.toContain('Dig set')
    expect(html).not.toContain('Tan no dig')
    expect(html).not.toContain('$6,093')
    expect(html).not.toContain('$7,924')
    expect(html).toContain('<h2>Your fence</h2>')
    expect(html).toContain('data-sold-option>Your fence')
    expect(html).toContain('data-sold-note>Your fence was signed with us for <b>No dig</b> at <b>$7,363</b>.')
    expect(html).toContain('To change to a different option, please call us at')
    expect(html).toContain('(352) 844 2677')
    expect(html).toContain('>Accept my fence</button>')
    // No "Save $" or "Recommended" to tempt a pick that cannot be signed.
    expect(html).not.toContain('Save $')
    expect(html).not.toContain(' more</span>')
    expect(html).not.toContain('Recommended')
    // The deposit is the sold option's.
    expect(html).toContain('50% to schedule: <b>$3,682</b>')
    expect(html).toContain('id="sig"')
  })

  test('sold for a fence no longer on the proposal: no options, nothing to sign, the fence as signed and call us', () => {
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: -1, soldLabel: 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig' })
    expect(html).toContain('data-already-signed')
    expect(html).toContain('Your fence was already signed with us for <b>White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig</b> at <b>$7,363</b>. To make a change, please call us at')
    expect(html).not.toContain('id="accept"')
    expect(html).not.toContain('id="sig"')
    expect(html).not.toContain("getElementById('go')")
    expect(html).not.toContain('data-option="')
    expect(html).not.toContain('id="deposit"')
    // Said near the top: before the terms.
    expect(html.indexOf('data-already-signed')).toBeLessThan(html.indexOf('data-proposal-terms'))
  })

  test('not sold: every option can be picked, as before', () => {
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [] })
    expect(html.match(/data-option="/g)).toHaveLength(3)
    expect(html).not.toMatch(/value="\d" (checked)?disabled/)
    expect(html).toContain('<h2>Your options</h2>')
    expect(html).toContain('Save $1,270')
    expect(html).toContain('>Accept the selected option</button>')
    expect(html).toContain('Choose an option above')
    expect(html).not.toContain('data-refused')
  })
})

describe('the proposal link once the customer signed it', () => {
  const accepted = { ...q, acceptedAt: new Date('2026-10-20T15:00:00Z'), acceptedBy: 'Pat Test', chosenOption: 1, status: 'SOLD' }

  test('only the signed option shows, no "Save $"; Accepted and the signed contract come before the options', () => {
    const html = renderProposal(accepted, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [] })
    expect(html.match(/data-option="/g)).toHaveLength(1)
    expect(html).toMatch(/data-option="1">\s*<input type="radio" name="option" value="1" checked disabled>/)
    expect(html).not.toContain('Dig set')
    expect(html).not.toContain('Tan no dig')
    expect(html).not.toContain('Save $')
    expect(html).not.toContain(' more</span>')
    expect(html).not.toContain('Recommended')
    expect(html).toContain('<h2>Your fence</h2>')
    expect(html).toContain('Accepted by Pat Test on October 20, 2026: No dig at $7,363.')
    const top = html.indexOf('data-accepted')
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(html.indexOf('data-option="1"'))
    expect(html.indexOf('data-contract-pdf')).toBeLessThan(html.indexOf('data-option="1"'))
    expect(html).not.toContain('id="accept"')
    expect(html).not.toContain('id="sig"')
  })

  test('back from a refused signing: why and the number to call, first; the plain address again', () => {
    const html = renderProposal(accepted, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], refused: true })
    expect(html).toContain('data-refused role="alert"><p>This proposal was already accepted for No dig. To make a change, please call us at (352) 844 2677.</p>')
    expect(html.indexOf('data-refused')).toBeLessThan(html.indexOf('data-accepted'))
    expect(html).toContain("history.replaceState(null,'',location.pathname+location.hash)")
    const sold = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: 1, refused: true })
    expect(sold).toContain('Your fence was already signed for No dig. To change it, please call us at (352) 844 2677.')
    // Refused on a page opened before: the page reloads to show what stands, not an error under the button.
    expect(sold).toContain("else if(j.reload){location.replace(location.pathname+'?refused=1')}")
  })
})

describe('what a customer is told when a signing is refused', () => {
  test('the fence that stands and the number to call', () => {
    expect(refusalText('signed', 'Tan no dig', '3527894314')).toBe('Your fence was already signed for Tan no dig. To change it, please call us at (352) 789 4314.')
    expect(refusalText('accepted', 'No dig', '(352) 844-2677')).toBe('This proposal was already accepted for No dig. To make a change, please call us at (352) 844 2677.')
    expect(refusalText('accepted', '', '')).toBe('This proposal was already accepted. To make a change, please call us.')
  })
})
