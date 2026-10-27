/**
 * Review Oct 27 2026 (round 7), without a database: what the customer reads.
 *   1. "What's included" leaves out zero counts and says "end posts" when there are no gates;
 *   2. the contract's Fence line is the plain fence name, never the tier word;
 *   3. a best price fence says the panels its runs used ("8 ft panels"), "6 ft and 8 ft panels" only when mixed;
 *   4. a repair contract names the fence repaired, and does not say its description twice;
 *   5. the sold link says "Your fence" once.
 */

import { describe, test, expect } from 'vitest'
import { renderProposal } from '../src/server/routes/proposal.js'
import { contractPdf, contractFenceName, acceptedOptionText, type ContractInput } from '../src/server/lib/contractPdf.js'
import { customerFenceName, customerIncluded, panelWidthsOf, railsOf } from '../src/server/lib/customerFenceName.js'
import { includedFacts, postsFact } from '../../web/src/proposal'
import { pdfText } from './pdfText'

const company = { name: 'Getter Done Fence', phone: '3528442677' }
const AUTO = 'White Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), No dig'
const EIGHT = 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig'
const opt = (label: string, fenceStyle: string, finalPrice: number, snapshot: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ label, fenceStyle, finalPrice, perFoot: 0, sections: 15, snapshot: { pullSheet: [], ...snapshot }, ...extra })

describe('1. the posts line of What\'s included', () => {
  test('new proposals: no zero counts; end posts with no gates', () => {
    expect(postsFact(0, 2, false)).toBe('2 end posts')
    expect(postsFact(2, 3, true)).toBe('2 corner posts and 3 end and gate posts')
    expect(postsFact(1, 0, false)).toBe('1 corner post')
    expect(postsFact(0, 0, false)).toBe('')
    const facts = includedFacts({ footageFt: 120, corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 })
    expect(facts).toEqual(['120 ft of new fence, all materials and installation', '2 end posts'])
  })

  test('a proposal saved with the old words reads the same way, on the page and the contract', () => {
    const p = { included: ['120 ft of new fence, all materials and installation', '0 corner posts and 2 end and gate posts'], gatesText: 'no gates' }
    expect(customerIncluded(p)).toEqual(['120 ft of new fence, all materials and installation', '2 end posts'])
    expect(customerIncluded({ ...p, gatesText: '1 walk gate' })[1]).toBe('2 end and gate posts')
    expect(customerIncluded({ included: ['2 corner posts and 1 end and gate post'], gatesText: '1 walk gate' })).toEqual(['2 corner posts and 1 end and gate post'])
    const html = renderProposal({ customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'WV', finalPrice: 5000 }, { version: 1, company, options: [opt(EIGHT, 'WV', 5000)], ...p } as any, 'tok', 'n')
    expect(html).toContain('<li>2 end posts</li>')
    expect(html).not.toContain('0 corner posts')
  })
})

describe('3. a best price fence by the panels its runs used', () => {
  test('one width, both widths, or not known', () => {
    expect(panelWidthsOf(['8ft'])).toEqual(['8'])
    expect(panelWidthsOf(['8ft', '6ft', '8ft'])).toEqual(['6', '8'])
    expect(panelWidthsOf(['auto', '8ft'])).toEqual([])
    expect(customerFenceName(AUTO, ['8ft'])).toBe(EIGHT)
    expect(customerFenceName(AUTO, ['6ft', '6ft'])).toBe('White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig')
    expect(customerFenceName(AUTO, ['6ft', '8ft'])).toBe('White Vinyl Privacy, 6 ft tall, 6 ft and 8 ft panels, No dig')
    expect(customerFenceName(AUTO)).toBe('White Vinyl Privacy, 6 ft tall, 6 ft or 8 ft panels, No dig')
    expect(customerFenceName(EIGHT, ['6ft'])).toBe(EIGHT)
  })

  test('the option\'s own picks first, else the quote\'s', () => {
    expect(railsOf({ snapshot: { runRails: ['8ft'] } }, ['6ft'])).toEqual(['8ft'])
    expect(railsOf({ snapshot: {} }, ['6ft'])).toEqual(['6ft'])
  })

  test('the proposal page names it by its runs', () => {
    const P = { version: 1, company, options: [opt(AUTO, 'WVAUTO', 5000, { runRails: ['8ft'] })] }
    const html = renderProposal({ customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'WVAUTO', finalPrice: 5000 }, P as any, 'tok', 'n')
    expect(html).toContain(`<span class="optlabel">${EIGHT}</span>`)
    expect(html).not.toContain('6 ft or 8 ft')
  })
})

describe('2. the contract names the fence without the tier word', () => {
  const P = { version: 1, company, options: [opt(EIGHT, 'WV8', 7363, {}, { tier: { key: 'better', label: 'Better' } }), opt(AUTO, 'WVAUTO', 7363, { runRails: ['8ft'] })] }
  test('sold then signed, or signed on the link: the same plain name', () => {
    const viaTier = { proposal: P, chosenOption: 0, fenceStyle: 'WV8', finalPrice: 7363, acceptedAt: new Date() }
    expect(contractFenceName(viaTier as any, 0)).toBe(EIGHT)
    expect(acceptedOptionText(viaTier as any)).toBe(`${EIGHT} at $7,363.00`)
    // Signed through the 8 ft tier card for a best price quote: the standing best price fence, by its runs.
    expect(contractFenceName({ proposal: P, fenceStyle: 'WVAUTO', finalPrice: 7363 } as any, 0)).toBe(EIGHT)
  })

  test('the PDF\'s Fence line has no tier word, even when one is passed', async () => {
    const words = pdfText(await contractPdf(contract({ tierLabel: 'Better', optionLabel: EIGHT })))
    expect(words).toContain(EIGHT)
    expect(words).not.toContain('Better:')
  })
})

describe('4. a repair contract', () => {
  const P = { version: 1, kind: 'repair', description: 'Replace 1 post and 1 section.', included: ['Replace 1 post and 1 section.'], company, options: [opt('Repair', 'WV6', 450)] }
  test('names the fence repaired when the quote knows it', () => {
    expect(contractFenceName({ proposal: P, fenceStyle: 'WV6', finalPrice: 450 } as any, 0, 'White Vinyl Privacy, 6 ft tall')).toBe('Repair: White Vinyl Privacy, 6 ft tall')
    expect(contractFenceName({ proposal: P, fenceStyle: 'WV6', finalPrice: 450 } as any, 0, '')).toBe('Repair')
  })

  test('the description is said once (The work), not again under What\'s included', async () => {
    expect(customerIncluded(P)).toEqual([])
    const words = pdfText(await contractPdf(contract({ kind: 'repair', optionLabel: 'Repair: White Vinyl Privacy, 6 ft tall', description: P.description, included: customerIncluded(P), footageFt: 0 })))
    expect(words).toContain('Repair: White Vinyl Privacy, 6 ft tall')
    expect(words.split('Replace 1 post and 1 section.').length - 1).toBe(1)
    expect(words).not.toContain("What's included")
    const html = renderProposal({ customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'WV6', finalPrice: 450 }, P as any, 'tok', 'n')
    expect(html.split('Replace 1 post and 1 section.').length - 1).toBe(1)
  })
})

describe('5. the sold link says "Your fence" once', () => {
  test('the heading over the single card, no badge repeating it', () => {
    const P = { version: 1, company, options: [opt('Dig set', 'DS', 6093), opt('No dig', 'ND', 7363)] }
    const html = renderProposal({ customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'ND', finalPrice: 7363 }, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [], sold: 1 })
    expect(html.match(/>Your fence</g)).toHaveLength(1)
  })
})

function contract(extra: Partial<ContractInput> = {}): ContractInput {
  return {
    company: { name: 'Getter Done Fence', phone: '3528442677', email: 'office@example.invalid', address: '' },
    customerName: 'Pat Test', address: '1 Oak Ln', optionLabel: EIGHT, tierLabel: '', price: 7363, footageFt: 120, gatesText: 'no gates',
    included: [], includedNote: '', depositPct: 0, depositNote: '', description: '', warranty: null,
    installDate: null, acceptedBy: 'Pat Test', acceptedAt: new Date('2026-10-26T20:00:00Z'), signedHow: 'link', signature: null, terms: [], ...extra,
  }
}
