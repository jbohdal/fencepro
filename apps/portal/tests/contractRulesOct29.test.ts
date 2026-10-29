/**
 * Jonathan's Oct 29 2026 answers, the rules without a database:
 *   D2  "0% or blank deposit means no deposit invoice at signing. Honor what
 *       the proposal says." The contract's Payment Terms say the proposal's
 *       own deposit (it said "A 50% deposit" whatever the proposal asked).
 *   #32 "Getter Done Fence obtains all required permits. Permit fees are
 *       billed separately at cost." in place of the customer getting the permit.
 *   The moment the rules began: a contract signed before keeps its words and
 *   cents (lib/customerDollars.ts onCustomerDollars).
 * The schedule and the stored contract on the dev database: contractRulesOct29.db.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { termsAsAsked, askedDepositPct, stampTerms, proposalTerms, contractSectionsOf, DEFAULT_CONTRACT_SECTIONS, PERMIT_SENTENCE, OLD_PERMIT_SENTENCE } from '../../web/src/contractTerms'
import { askedDepositPct as serverAsked, customerDepositCents, shownDollarCents } from '../src/server/lib/paymentMath'
import { depositPctOf } from '../src/server/lib/contractBilling'
import { onCustomerDollars, signedAtOf } from '../src/server/lib/customerDollars'
import { contractPdf } from '../src/server/lib/contractPdf'
import { pdfText } from './pdfText'

const LIVE_SECTIONS = [
  { key: 'payment_terms', title: 'Payment Terms', body: 'A 50% deposit is required to schedule the project. The remaining balance is due upon completion. We accept cash, check, ACH, and major credit cards.', visible: true },
  { key: 'permits', title: 'Permits', body: 'Unless noted otherwise, the customer is responsible for obtaining any required permits. If a permit is denied after materials are ordered, any non-refundable costs will be billed.', visible: true },
]
const textOf = (terms: Array<{ key: string; text: string }>, key: string) => terms.find(t => t.key === key)!.text

describe('the contract says the deposit the proposal asks (D2)', () => {
  test('0, blank or not a percent asks none; 1 to 100 asks that', () => {
    for (const f of [askedDepositPct, serverAsked]) {
      expect([0, null, undefined, '', ' ', NaN, -5, 101, 'abc'].map(v => f(v as any))).toEqual(Array(9).fill(null))
      expect([50, 30, '25', 100, 12.5].map(v => f(v as any))).toEqual([50, 30, 25, 100, 12.5])
    }
  })

  test('Payment Terms as Settings has them on live: 50% stays, 30% says 30%, none says no deposit and the full price on completion', () => {
    const terms = proposalTerms(LIVE_SECTIONS)
    expect(textOf(termsAsAsked(terms, 50), 'payment_terms')).toBe(LIVE_SECTIONS[0].body)
    expect(textOf(termsAsAsked(terms, 30), 'payment_terms')).toBe('A 30% deposit is required to schedule the project. The remaining balance is due upon completion. We accept cash, check, ACH, and major credit cards.')
    for (const none of [0, undefined, '']) {
      expect(textOf(termsAsAsked(terms, none), 'payment_terms')).toBe('No deposit is required to schedule the project. The full price is due upon completion. We accept cash, check, ACH, and major credit cards.')
    }
    // Run twice: the same words.
    const once = termsAsAsked(terms, 0)
    expect(termsAsAsked(once, 0)).toEqual(once)
    // Words typed in place of the stock sentence stay as typed.
    const typed = [{ key: 'payment_terms', title: 'Payment Terms', text: 'Half down, half on completion.' }]
    expect(termsAsAsked(typed, 0)).toEqual(typed)
  })

  test('a draft saved with 0% freezes "No deposit" on its proposal; a sent one keeps what it went out with', () => {
    const out = stampTerms({ depositPct: 0, options: [{}] }, LIVE_SECTIONS, null, false) as any
    expect(textOf(out.terms, 'payment_terms')).toMatch(/^No deposit is required/)
    const sent = stampTerms({ depositPct: 0, options: [{}] }, LIVE_SECTIONS, { terms: [{ key: 'payment_terms', title: 'Payment Terms', text: 'As sent.' }] }, true) as any
    expect(sent.terms).toEqual([{ key: 'payment_terms', title: 'Payment Terms', text: 'As sent.' }])
  })

  test('the schedule: the proposal\'s percent; 0 or blank none; a quote with no proposal at all the standard 50%', () => {
    expect(depositPctOf({ proposal: { depositPct: 30, options: [{}] } })).toBe(30)
    expect(depositPctOf({ proposal: { depositPct: 0, options: [{}] } })).toBe(0)
    expect(depositPctOf({ proposal: { options: [{}] } })).toBe(0)
    expect(depositPctOf({ proposal: null })).toBe(50)
    expect(depositPctOf(null)).toBe(50)
    expect(customerDepositCents(892_046, 0, false)).toBe(0)
    expect(customerDepositCents(892_046, null, true)).toBe(0)
  })
})

describe('permits: Getter Done Fence obtains them (#32)', () => {
  test('the new sentence in Settings (the default and the stock words saved on live), the rest of the section kept', () => {
    expect(PERMIT_SENTENCE).toBe('Getter Done Fence obtains all required permits. Permit fees are billed separately at cost.')
    const def = DEFAULT_CONTRACT_SECTIONS.find(s => s.key === 'permits')!.body
    expect(def).toBe(`${PERMIT_SENTENCE} If a permit is denied after materials are ordered, any non-refundable costs will be billed.`)
    expect(def).not.toContain(OLD_PERMIT_SENTENCE)
    expect(contractSectionsOf(LIVE_SECTIONS).find(s => s.key === 'permits')!.body).toBe(def)
    expect(textOf(proposalTerms(LIVE_SECTIONS), 'permits')).toBe(def)
    // Permit words Jonathan typed himself stay as typed.
    expect(contractSectionsOf([{ key: 'permits', title: 'Permits', body: 'We pull the permit.', visible: true }]).find(s => s.key === 'permits')!.body).toBe('We pull the permit.')
  })

  test('a proposal frozen with the old sentence and not yet signed reads the new one', () => {
    const frozen = [{ key: 'permits', title: 'Permits', text: LIVE_SECTIONS[1].body }]
    expect(textOf(termsAsAsked(frozen, 50), 'permits')).toBe(`${PERMIT_SENTENCE} If a permit is denied after materials are ordered, any non-refundable costs will be billed.`)
  })
})

describe('a contract signed before the rules began opens as it was signed', () => {
  const from = new Date('2026-10-29T18:00:00Z')
  test('signed when: first sold (never cleared), else accepted; not signed is on the new rules', () => {
    expect(onCustomerDollars({ acceptedAt: null, soldAt: null, status: 'SENT' }, from)).toBe(true)
    expect(onCustomerDollars({ acceptedAt: new Date('2026-10-29T19:00:00Z'), soldAt: new Date('2026-10-29T19:00:00Z') }, from)).toBe(true)
    expect(onCustomerDollars({ acceptedAt: new Date('2026-10-21T15:00:00Z'), soldAt: new Date('2026-10-21T15:00:00Z') }, from)).toBe(false)
    // Sold in the app before, accepted on the link after: an old contract.
    expect(onCustomerDollars({ acceptedAt: new Date('2026-10-30T15:00:00Z'), soldAt: new Date('2026-10-20T15:00:00Z') }, from)).toBe(false)
    expect(signedAtOf({ acceptedAt: new Date('2026-10-30T15:00:00Z'), soldAt: new Date('2026-10-20T15:00:00Z') })!.toISOString()).toBe('2026-10-20T15:00:00.000Z')
    // Sold with no date at all (before "ever sold" was recorded): old.
    expect(onCustomerDollars({ acceptedAt: null, soldAt: null, status: 'SOLD' }, from)).toBe(false)
  })

  test('the PDF prints the terms it is given: an old contract its frozen words, a new one the new words', async () => {
    const base = {
      company: { name: 'Co', phone: '', email: '', address: '' }, customerName: 'Pat', address: '1 Oak Ln', optionLabel: 'White vinyl privacy', tierLabel: '',
      footageFt: 0, gatesText: '', included: [], includedNote: '', depositNote: '', description: '', warranty: null, installDate: null, price: 5532.39, depositPct: 50,
      acceptedBy: 'Pat', acceptedAt: new Date('2026-10-21T15:00:00Z'), signedHow: 'link' as const, signature: null, signedRecord: null,
    }
    const frozen = proposalTerms([]).map(t => (t.key === 'permits' ? { ...t, text: LIVE_SECTIONS[1].body } : t))
    const old = pdfText(await contractPdf({ ...base, terms: frozen }))
    expect(old).toContain('the customer is responsible for obtaining any required permits')
    expect(old).toContain('Price $5,532.39')
    expect(old).toContain('50% to schedule: $2,766.20')
    const now = pdfText(await contractPdf({ ...base, shownDollars: true, terms: termsAsAsked(frozen, 50) }))
    expect(now).toContain('Getter Done Fence obtains all required permits.')
    expect(now).not.toContain('the customer is responsible for obtaining')
    expect(now).toContain(`Price $${(shownDollarCents(553_239) / 100).toLocaleString('en-US')}.00`)
    expect(now).toContain('50% to schedule: $2,766.00')
  })
})
