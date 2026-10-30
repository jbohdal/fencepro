/**
 * The quote window's Preview (and the printable templates) say the deposit the
 * customer's link says (review Oct 29 2026: the Preview a salesman shows in
 * person said "A 50% deposit is required" while the link said no deposit).
 * Jonathan, Oct 29 2026, D2: "0% or blank deposit means no deposit invoice at
 * signing. Honor what the proposal says."
 *   - 0% or blank: "No deposit is required ... The full price is due upon completion."
 *   - 30%: "A 30% deposit is required ..."
 *   - a quote with no proposal: the standard 50%, as its payment schedule (lib/contractBilling.ts depositPctOf).
 *   - signed before the rules: as signed.
 * The server's answer (termsDepositOf, GET /api/saved-quotes/:id/deposit-terms) and the
 * phone's own (contractTerms.ts depositTermsOf, until the answer is in) agree.
 */

import { describe, test, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import { depositTermsOf, sectionsAsAsked, DEFAULT_CONTRACT_SECTIONS } from '../../web/src/contractTerms'
import { termsDepositOf, depositPctOf } from '../src/server/lib/contractBilling'

// Settings → Contract Templates as live has them (the stock Payment Terms), and the company; no browser here.
vi.mock('../../web/src/contractStore', async () => {
  const t = await import('../../web/src/contractTerms')
  return { getContractSections: () => t.DEFAULT_CONTRACT_SECTIONS, DEFAULT_CONTRACT_SECTIONS: t.DEFAULT_CONTRACT_SECTIONS }
})
vi.mock('../../web/src/configStore', () => ({ getConfig: () => ({ company: { name: 'Getter Done Fence', phone: '3528442677', email: '' }, fenceStyles: [] }) }))
;(globalThis as any).window ??= { location: { hostname: 'test', protocol: 'http:', origin: 'http://test' }, addEventListener: () => {}, removeEventListener: () => {} }
const { default: QuoteTemplateRenderer } = await import('../../web/src/QuoteTemplateRenderer')
const { TEMPLATES } = await import('../../web/src/quoteTemplatesStore')

const NONE = 'No deposit is required to schedule the project. The full price is due upon completion.'
const from = new Date('2026-10-29T20:00:00Z')

const quoteWith = (proposal: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'q-preview-1', customerName: 'Sarah Example', customerAddress: '1 Main St, Ocala, FL', fenceStyle: 'WV 6ft Privacy',
  runs: [100], corners: 1, ends: 2, walkGates: 1, dblGates: 0, finalPrice: 7113.83, status: 'SENT', date: '2026-10-29',
  proposal, ...extra,
}) as any

const proposalAt = (depositPct: unknown) => ({ depositPct, options: [{ label: 'White Vinyl Privacy', fenceStyle: 'WV 6ft Privacy', finalPrice: 7113.83 }] })

function preview(q: any): string {
  return renderToStaticMarkup(createElement(QuoteTemplateRenderer, { quote: q, template: TEMPLATES.premium, interactive: false }))
}

describe('the Preview says the proposal\'s deposit, as the customer\'s link', () => {
  test('0%: no deposit, the full price on completion; never "50%"', () => {
    const html = preview(quoteWith(proposalAt(0)))
    expect(html).toContain(NONE)
    expect(html).not.toMatch(/\d+% deposit is required/)
    expect(html).not.toContain('The remaining balance is due upon completion.')
  })

  test('blank: the same as 0%', () => {
    for (const blank of [undefined, null, '']) {
      const html = preview(quoteWith(proposalAt(blank)))
      expect(html).toContain(NONE)
      expect(html).not.toMatch(/\d+% deposit is required/)
    }
    // A proposal with no deposit field at all.
    const html = preview(quoteWith({ options: [{ label: 'x', fenceStyle: 'WV 6ft Privacy', finalPrice: 7113.83 }] }))
    expect(html).toContain(NONE)
  })

  test('30%: "A 30% deposit is required", the rest on completion', () => {
    const html = preview(quoteWith(proposalAt(30)))
    expect(html).toContain('A 30% deposit is required to schedule the project. The remaining balance is due upon completion.')
    expect(html).not.toContain('A 50% deposit')
    expect(html).not.toContain(NONE)
  })

  test('the server\'s answer wins over the phone\'s: as sent with the quote', () => {
    // The phone's copy still said 0%, the server says 30% (the proposal saved again on another phone).
    const html = preview({ ...quoteWith(proposalAt(0)), depositTerms: { asSigned: false, depositPct: 30 } })
    expect(html).toContain('A 30% deposit is required')
    // Signed before the rules: as signed (Settings' words).
    const old = preview({ ...quoteWith(proposalAt(0)), depositTerms: { asSigned: true, depositPct: null } })
    expect(old).toContain('A 50% deposit is required')
  })

  test('a quote with no proposal: the standard 50%, as its payment schedule', () => {
    const html = preview(quoteWith(null))
    expect(html).toContain('A 50% deposit is required')
    expect(depositPctOf({ proposal: null })).toBe(50)
  })
})

describe('the phone and the server read a quote\'s deposit the same', () => {
  const cases: Array<[string, unknown]> = [
    ['0%', proposalAt(0)], ['blank', proposalAt(undefined)], ['empty', proposalAt('')], ['30%', proposalAt(30)],
    ['no deposit field', { options: [{}] }], ['no proposal', null], ['no options', { depositPct: 30, options: [] }],
  ]
  test.each(cases)('%s', (_name, proposal) => {
    const unsigned = { proposal, status: 'SENT', acceptedAt: null, soldAt: null }
    expect(depositTermsOf(unsigned)).toEqual(termsDepositOf(unsigned, from))
  })

  test('signed before the rules: as signed; after: the proposal\'s', () => {
    const old = { proposal: proposalAt(0), status: 'SOLD', soldAt: new Date('2026-10-20T15:00:00Z'), acceptedAt: null }
    expect(termsDepositOf(old, from)).toEqual({ asSigned: true, depositPct: null })
    const now = { ...old, soldAt: new Date('2026-10-29T21:00:00Z') }
    expect(termsDepositOf(now, from)).toEqual({ asSigned: false, depositPct: null })
    expect(termsDepositOf({ ...now, proposal: proposalAt(30) }, from)).toEqual({ asSigned: false, depositPct: 30 })
  })

  test('only the stock sentence changes; words typed in its place stay', () => {
    const typed = [{ key: 'payment_terms', title: 'Payment Terms', body: 'Half down, half on completion.', visible: true }]
    expect(sectionsAsAsked(typed, { asSigned: false, depositPct: null })).toEqual(typed)
    const out = sectionsAsAsked(DEFAULT_CONTRACT_SECTIONS, { asSigned: false, depositPct: null })
    expect(out.find(s => s.key === 'payment_terms')!.body).toBe(`${NONE} We accept cash, check, ACH, and major credit cards.`)
    expect(out.filter(s => s.key !== 'payment_terms')).toEqual(DEFAULT_CONTRACT_SECTIONS.filter(s => s.key !== 'payment_terms'))
  })
})
