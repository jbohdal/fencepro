/**
 * A quote sold in the app before the customer signed its proposal link
 * (audit fix, Oct 27 2026): the link shows the sold option as the only one to
 * sign, the others "Not available"; sold for a fence no longer on the
 * proposal, nothing can be signed there (call us).
 */

import { describe, test, expect } from 'vitest'
import { renderProposal, signedOptionOf } from '../src/server/routes/proposal.js'
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
  test('the sold option is the one to sign; the others are shown as not available and cannot be picked', () => {
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: 1 })
    expect(html).toMatch(/data-option="1">\s*<input type="radio" name="option" value="1" checked>/)
    expect(html).toMatch(/data-option="0" data-not-available>\s*<input type="radio" name="option" value="0" disabled>/)
    expect(html).toMatch(/data-option="2" data-not-available>\s*<input type="radio" name="option" value="2" disabled>/)
    expect(html.match(/data-not-available/g)).toHaveLength(2)
    expect(html).toContain('Not available: your fence was already signed for No dig.')
    expect(html).toContain('data-sold-note>Your fence was signed with us for <b>No dig</b> at <b>$7,363</b>.')
    expect(html).toContain('To change to a different option, please call us at')
    expect(html).toContain('>Accept my fence</button>')
    // No "Save $" or "Recommended" to tempt a pick that cannot be signed.
    expect(html).not.toContain('Save $')
    expect(html).not.toContain('Recommended')
    // The deposit is the sold option's.
    expect(html).toContain('50% to schedule: <b>$3,682</b>')
    expect(html).toContain('id="sig"')
  })

  test('sold for a fence no longer on the proposal: nothing to sign, call us', () => {
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: -1 })
    expect(html).toContain('data-already-signed')
    expect(html).toContain('Your fence was already signed with us. To make a change, please call us at')
    expect(html).not.toContain('id="accept"')
    expect(html).not.toContain('id="sig"')
    expect(html).not.toContain("getElementById('go')")
    expect(html.match(/data-not-available/g)).toHaveLength(3)
  })

  test('not sold: every option can be picked, as before', () => {
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [] })
    expect(html).not.toContain('data-not-available')
    expect(html).not.toMatch(/value="\d" (checked)?disabled/)
    expect(html).toContain('>Accept the selected option</button>')
    expect(html).toContain('Choose an option above')
  })
})
