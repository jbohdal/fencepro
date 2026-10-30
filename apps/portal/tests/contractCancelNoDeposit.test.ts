/**
 * Jonathan, Oct 29 2026 (late): "No deposit contracts: replace the sentence
 * with 'Once materials are ordered, their cost is non-refundable.'"
 *
 * On a contract, proposal or in-app Preview that asks no deposit (0% or
 * blank), Cancellation Policy's stock "The deposit is non-refundable once
 * materials are ordered." reads "Once materials are ordered, their cost is
 * non-refundable." With a deposit it stays. Words typed in its place stay as
 * typed. A contract signed before this rule keeps the sentence it was signed
 * with (its own moment, lib/customerDollars.ts NO_DEPOSIT_CANCEL_KEY).
 * Signed for real on the dev database: contractCancelNoDeposit.db.test.ts.
 */

import { describe, test, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import {
  termsAsAsked, stampTerms, proposalTerms, sectionsAsAsked, depositTermsOf, DEFAULT_CONTRACT_SECTIONS,
  DEPOSIT_CANCEL_SENTENCE, NO_DEPOSIT_CANCEL_SENTENCE,
} from '../../web/src/contractTerms'
import { termsDepositOf } from '../src/server/lib/contractBilling'
import { contractPdf } from '../src/server/lib/contractPdf'
import { pdfText } from './pdfText'

vi.mock('../../web/src/contractStore', async () => {
  const t = await import('../../web/src/contractTerms')
  return { getContractSections: () => t.DEFAULT_CONTRACT_SECTIONS, DEFAULT_CONTRACT_SECTIONS: t.DEFAULT_CONTRACT_SECTIONS }
})
vi.mock('../../web/src/configStore', () => ({ getConfig: () => ({ company: { name: 'Getter Done Fence', phone: '3528442677', email: '' }, fenceStyles: [] }) }))
;(globalThis as any).window ??= { location: { hostname: 'test', protocol: 'http:', origin: 'http://test' }, addEventListener: () => {}, removeEventListener: () => {} }
const { default: QuoteTemplateRenderer } = await import('../../web/src/QuoteTemplateRenderer')
const { TEMPLATES } = await import('../../web/src/quoteTemplatesStore')

// Settings → Contract Templates' Cancellation Policy as saved on live (Oct 29 2026).
const LIVE_CANCEL = 'The deposit is non-refundable once materials are ordered. Change orders requested after materials are ordered may incur additional costs. Cancellation within 3 days of signing is accepted with no penalty.'
const NEW_CANCEL = 'Once materials are ordered, their cost is non-refundable. Change orders requested after materials are ordered may incur additional costs. Cancellation within 3 days of signing is accepted with no penalty.'
const SECTIONS = [
  { key: 'payment_terms', title: 'Payment Terms', body: 'A 50% deposit is required to schedule the project. The remaining balance is due upon completion. We accept cash, check, ACH, and major credit cards.', visible: true },
  { key: 'cancellation', title: 'Cancellation Policy', body: LIVE_CANCEL, visible: true },
]
const cancelOf = (terms: Array<{ key: string; text: string }>) => terms.find(t => t.key === 'cancellation')!.text

describe('the sentence', () => {
  test('as Jonathan gave it; the stock one is what live and the defaults say', () => {
    expect(NO_DEPOSIT_CANCEL_SENTENCE).toBe('Once materials are ordered, their cost is non-refundable.')
    expect(DEPOSIT_CANCEL_SENTENCE).toBe('The deposit is non-refundable once materials are ordered.')
    expect(DEFAULT_CONTRACT_SECTIONS.find(s => s.key === 'cancellation')!.body).toBe(LIVE_CANCEL)
  })

  test('0% and blank: the new sentence, the rest of the section kept', () => {
    const terms = proposalTerms(SECTIONS)
    for (const none of [0, '0', undefined, null, '', ' ']) expect(cancelOf(termsAsAsked(terms, none))).toBe(NEW_CANCEL)
    // Run twice: the same words.
    const once = termsAsAsked(terms, 0)
    expect(termsAsAsked(once, 0)).toEqual(once)
  })

  test('30% (and 50%): the deposit sentence stays', () => {
    const terms = proposalTerms(SECTIONS)
    expect(cancelOf(termsAsAsked(terms, 30))).toBe(LIVE_CANCEL)
    expect(cancelOf(termsAsAsked(terms, 50))).toBe(LIVE_CANCEL)
  })

  test('words typed in place of the stock sentence stay as typed', () => {
    const typed = [{ key: 'cancellation', title: 'Cancellation Policy', text: 'No refunds once we order. Cancel within 3 days for free.' }]
    expect(termsAsAsked(typed, 0)).toEqual(typed)
    // Only the cancellation section: the same words elsewhere are not touched.
    const elsewhere = [{ key: 'scope_exclusions', title: 'Scope', text: DEPOSIT_CANCEL_SENTENCE }]
    expect(termsAsAsked(elsewhere, 0)).toEqual(elsewhere)
  })

  test('signed before this rule (cancellation: false): as signed, while the deposit wording still follows the earlier rule', () => {
    const out = termsAsAsked(proposalTerms(SECTIONS), 0, { cancellation: false })
    expect(cancelOf(out)).toBe(LIVE_CANCEL)
    expect(out.find(t => t.key === 'payment_terms')!.text).toMatch(/^No deposit is required/)
  })

  test('a draft saved with 0% freezes the new sentence; a sent one keeps what it went out with', () => {
    const out = stampTerms({ depositPct: 0, options: [{}] }, SECTIONS, null, false) as any
    expect(cancelOf(out.terms)).toBe(NEW_CANCEL)
    const at30 = stampTerms({ depositPct: 30, options: [{}] }, SECTIONS, null, false) as any
    expect(cancelOf(at30.terms)).toBe(LIVE_CANCEL)
    const sent = stampTerms({ depositPct: 0, options: [{}] }, SECTIONS, { terms: [{ key: 'cancellation', title: 'Cancellation Policy', text: LIVE_CANCEL }] }, true) as any
    expect(cancelOf(sent.terms)).toBe(LIVE_CANCEL)
  })
})

describe('the in-app Preview and the server\'s deposit terms', () => {
  const from = new Date('2026-10-29T20:00:00Z')        // the deposit rules (D2)
  const cancelFrom = new Date('2026-10-30T04:00:00Z')  // this rule, later
  const proposalAt = (depositPct: unknown) => ({ depositPct, options: [{ label: 'White Vinyl Privacy', fenceStyle: 'WV 6ft Privacy', finalPrice: 7113.83 }] })
  const quoteWith = (proposal: unknown, extra: Record<string, unknown> = {}) => ({
    id: 'q-cancel-1', customerName: 'Sarah Example', customerAddress: '1 Main St, Ocala, FL', fenceStyle: 'WV 6ft Privacy',
    runs: [100], corners: 1, ends: 2, walkGates: 1, dblGates: 0, finalPrice: 7113.83, status: 'SENT', date: '2026-10-29', proposal, ...extra,
  }) as any
  const preview = (q: any) => renderToStaticMarkup(createElement(QuoteTemplateRenderer, { quote: q, template: TEMPLATES.premium, interactive: false }))

  test('0% and blank: the Preview says the new sentence; 30% the deposit sentence', () => {
    for (const none of [0, undefined, '']) {
      const html = preview(quoteWith(proposalAt(none)))
      expect(html).toContain(NO_DEPOSIT_CANCEL_SENTENCE)
      expect(html).not.toContain(DEPOSIT_CANCEL_SENTENCE)
    }
    const html = preview(quoteWith(proposalAt(30)))
    expect(html).toContain(DEPOSIT_CANCEL_SENTENCE)
    expect(html).not.toContain(NO_DEPOSIT_CANCEL_SENTENCE)
  })

  test('the server says when a contract was signed before this rule; the Preview keeps its sentence then', () => {
    const unsigned = { proposal: proposalAt(0), status: 'SENT', acceptedAt: null, soldAt: null }
    expect(termsDepositOf(unsigned, from, cancelFrom)).toEqual({ asSigned: false, depositPct: null })
    expect(depositTermsOf(unsigned)).toEqual(termsDepositOf(unsigned, from, cancelFrom))
    // Signed between the deposit rules and this one: deposit as asked, cancellation as signed.
    const between = { ...unsigned, status: 'SOLD', soldAt: new Date('2026-10-30T02:00:00Z') }
    const d = termsDepositOf(between, from, cancelFrom)
    expect(d).toEqual({ asSigned: false, depositPct: null, cancellationAsSigned: true })
    const html = preview({ ...quoteWith(proposalAt(0)), depositTerms: d })
    expect(html).toContain('No deposit is required to schedule the project.')
    expect(html).toContain(DEPOSIT_CANCEL_SENTENCE)
    expect(html).not.toContain(NO_DEPOSIT_CANCEL_SENTENCE)
    // Signed after: the new sentence.
    const after = termsDepositOf({ ...between, soldAt: new Date('2026-10-30T05:00:00Z') }, from, cancelFrom)
    expect(after).toEqual({ asSigned: false, depositPct: null })
    expect(preview({ ...quoteWith(proposalAt(0)), depositTerms: after })).toContain(NO_DEPOSIT_CANCEL_SENTENCE)
    // Signed before every Oct 29 rule: as signed, all of it.
    const old = termsDepositOf({ ...between, soldAt: new Date('2026-10-20T15:00:00Z') }, from, cancelFrom)
    expect(old).toEqual({ asSigned: true, depositPct: null, cancellationAsSigned: true })
    expect(sectionsAsAsked(SECTIONS, old)).toEqual(SECTIONS)
  })

  test('the contract PDF prints the terms it is given', async () => {
    const base = {
      company: { name: 'Co', phone: '', email: '', address: '' }, customerName: 'Pat', address: '1 Oak Ln', optionLabel: 'White vinyl privacy', tierLabel: '',
      footageFt: 0, gatesText: '', included: [], includedNote: '', depositNote: '', description: '', warranty: null, installDate: null, price: 8920, depositPct: 0,
      acceptedBy: 'Pat', acceptedAt: new Date('2026-10-30T05:00:00Z'), signedHow: 'link' as const, signature: null, signedRecord: null, shownDollars: true,
    }
    const none = pdfText(await contractPdf({ ...base, terms: termsAsAsked(proposalTerms(SECTIONS), 0) }))
    expect(none.replace(/\s+/g, ' ')).toContain(NO_DEPOSIT_CANCEL_SENTENCE)
    expect(none).not.toContain('The deposit is non-refundable')
    const at30 = pdfText(await contractPdf({ ...base, depositPct: 30, terms: termsAsAsked(proposalTerms(SECTIONS), 30) }))
    expect(at30.replace(/\s+/g, ' ')).toContain(DEPOSIT_CANCEL_SENTENCE)
  })
})
