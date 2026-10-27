/**
 * What the customer reads and signs (audit Oct 26, 2026):
 *   - Settings → Contract Templates terms on the proposal and the signed
 *     contract, frozen on the proposal (a later edit changes no sent or signed one)
 *   - the company's address when Settings has it, no empty line when not
 *   - the IP on every copy of a contract signed on the link
 *   - a vinyl "best price" quote's own option that is Better's fence at
 *     Better's price shows once
 *   - the option selected when the page opens is the one the quote was made with
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { proposalTerms, stampTerms, frozenTerms, plainTermText, companyAddressOf, contractSectionsOf, DEFAULT_CONTRACT_SECTIONS } from '../../web/src/contractTerms'
import { sameFenceAs, shownOptions, startingOption, ownTierFold } from '../../web/src/proposalOptions'
import { priceOption } from '../../web/src/proposal'
import { renderProposal } from '../src/server/routes/proposal.js'
import { contractPdf, type ContractInput } from '../src/server/lib/contractPdf.js'
import { pdfText } from './pdfText'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import type { QuoteCalcInput, QuoteStyle } from '../../web/src/quoteCalc'

const SAVED = [
  { key: 'payment_terms', title: 'Payment Terms', body: 'A 50% deposit is required to schedule the project.<br>The balance is due upon completion.', visible: true },
  { key: 'warranty', title: 'Warranty', body: 'Workmanship 1 year.', visible: true },
  { key: 'permits', title: 'Permits', body: '<p>Customer gets the permit &amp; pays its fee.</p>', visible: true },
  { key: 'cancellation', title: 'Cancellation Policy', body: 'No refunds after materials are ordered.', visible: false },
]

describe('contract terms', () => {
  test('the shown sections but the warranty, word for word as plain text; a section never saved is its default', () => {
    const t = proposalTerms(SAVED)
    expect(t.map(x => x.key)).toEqual(['payment_terms', 'scope_exclusions', 'property_access', 'permits', 'dispute_resolution'])
    expect(t.find(x => x.key === 'warranty')).toBeUndefined()
    expect(t.find(x => x.key === 'cancellation')).toBeUndefined()
    expect(t.find(x => x.key === 'payment_terms')!.text).toBe('A 50% deposit is required to schedule the project.\nThe balance is due upon completion.')
    expect(t.find(x => x.key === 'permits')!.text).toBe('Customer gets the permit & pays its fee.')
    // Never saved: the default words, as Settings shows them.
    expect(t.find(x => x.key === 'dispute_resolution')!.text).toBe(DEFAULT_CONTRACT_SECTIONS.find(d => d.key === 'dispute_resolution')!.body)
    // Nothing saved at all: every default but the warranty.
    expect(proposalTerms(null).map(x => x.key)).toEqual(DEFAULT_CONTRACT_SECTIONS.filter(d => d.key !== 'warranty').map(d => d.key))
    expect(contractSectionsOf([])).toBe(DEFAULT_CONTRACT_SECTIONS)
    expect(plainTermText('<ul><li>One</li><li>Two</li></ul>')).toBe('• One\n• Two')
  })

  test('frozen on the proposal: a draft takes today\'s terms; a sent or signed one keeps the ones it went out with', () => {
    const draft = stampTerms({ version: 1, options: [] }, SAVED, null, false) as any
    expect(draft.terms.map((x: any) => x.key)).toContain('payment_terms')
    const edited = SAVED.map(s => s.key === 'payment_terms' ? { ...s, body: 'Paid in full up front.' } : s)
    const resaved = stampTerms({ version: 1, options: [], terms: [] }, edited, draft, true) as any
    expect(resaved.terms).toEqual(draft.terms)
    // Sent before terms were frozen: none kept (the page shows today's until it is signed, then they are frozen).
    expect((stampTerms({ version: 1, options: [] }, edited, { version: 1, options: [] }, true) as any).terms).toBeUndefined()
    expect(frozenTerms({ options: [] })).toBeNull()
    expect(frozenTerms(draft)).toEqual(draft.terms)
  })

  test('the company address only when Settings has a street, city or ZIP', () => {
    expect(companyAddressOf({ address: '123 Main St', city: 'Ocala', state: 'FL', zip: '34470' })).toBe('123 Main St, Ocala, FL 34470')
    expect(companyAddressOf({ address: '', city: '', state: 'FL', zip: '' })).toBe('')
    expect(companyAddressOf(null)).toBe('')
  })
})

// ── Options: the same fence twice, and the one selected at first ─────────────

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const st = (name: string, extra: Partial<QuoteStyle> = {}) => ({ name, category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, ...extra }) as QuoteStyle
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const input = (style: QuoteStyle): QuoteCalcInput => ({
  style, runs: [{ ft: 120 }, { ft: 96 }], corners: 1, ends: 3, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
})

describe('proposal options', () => {
  beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
  afterAll(() => setMaterialPriceSource(null))

  test('the quote\'s own "best price" option that is Better\'s fence at Better\'s price shows once; Better is selected at first', () => {
    const auto = st('WV-Auto ND Privacy', { autoRailMix: true, installMethod: 'no-dig', colorFamily: 'white' } as any)
    const eight = st("WV-ND 6'x8' Privacy", { panelWidth: 8 })
    const six = st("WV-ND 6'x6' Privacy")
    const ownOpt = priceOption(input(auto), auto)
    const better = priceOption(input(eight), eight)
    // The auto mix picked 8 ft panels on every run here: the same fence at the same price.
    expect(ownOpt.snapshot.runRails).toEqual(['8ft', '8ft'])
    expect(Math.round(ownOpt.finalPrice * 100)).toBe(Math.round(better.finalPrice * 100))
    const options = [{ ...better, tier: { key: 'better', label: 'Better', blurb: '' } }, { ...priceOption(input(six), six), tier: { key: 'best', label: 'Best', blurb: '' } }, ownOpt]
    expect(sameFenceAs(options)).toEqual([-1, -1, 0])
    expect(shownOptions(options)).toEqual([0, 1])
    // Selected at first: the quote's own option, shown by its twin (Better).
    expect(startingOption(options, { fenceStyle: auto.name, finalPrice: ownOpt.finalPrice }, 1)).toBe(0)
    // A different warranty or a different price is a different option.
    expect(sameFenceAs([better, { ...ownOpt, warranty: { name: 'Other' } }])).toEqual([-1, -1])
    expect(sameFenceAs([better, { ...ownOpt, finalPrice: ownOpt.finalPrice + 1 }])).toEqual([-1, -1])
  })

  test('a best price option cheaper than its tier is shown as that tier, in its place, at the quoted price (review Oct 27 2026)', () => {
    const o = (fenceStyle: string, finalPrice: number, key?: string) => ({ fenceStyle, finalPrice, ...(key ? { tier: { key } } : {}), snapshot: { pullSheet: [{ item: fenceStyle, qty: 1 }] } })
    const specs = [{ key: 'good', width: 'cheapest' }, { key: 'better', width: 'cheapest' }, { key: 'best', width: '6' }]
    // White no dig best price at $7,179 (6 and 8 ft panels per run) and Better, all 8 ft panels for the yard, at $7,363.
    const opts = [o("WV-DS 6'x8' Privacy", 6093, 'good'), o("WV-ND 6'x8' Privacy", 7363, 'better'), o("WV-ND 6'x6' Privacy", 7924, 'best'), o('WV-Auto ND Privacy', 7179)]
    const fold = ownTierFold(opts, { fenceStyle: 'WV-Auto ND Privacy' }, () => null, specs)
    expect(fold).toEqual({ own: 3, tier: 1 })
    // Three cards: Good, the quote's own in Better's place, Best. No price changes; the quote's own starts selected.
    expect(shownOptions(opts, fold)).toEqual([0, 3, 2])
    expect(startingOption(opts, { fenceStyle: 'WV-Auto ND Privacy', finalPrice: 7179 }, 1)).toBe(3)
    // A dig set best price is Good's fence.
    const ds = [...opts.slice(0, 3), o('WV-Auto DS Privacy', 5900)]
    expect(ownTierFold(ds, { fenceStyle: 'WV-Auto DS Privacy' }, () => null, specs)).toEqual({ own: 3, tier: 0 })
    // Not folded: a tier that takes one set width (Best, all 6 ft), another color, or a quote that is not a best price mix.
    expect(ownTierFold([o("WV-ND 6'x6' Privacy", 7924, 'best'), o('WV-Auto ND Privacy', 7179)], { fenceStyle: 'WV-Auto ND Privacy' }, () => null, specs)).toBeNull()
    expect(ownTierFold([o("TV-ND 6'x8' Privacy", 7900, 'better'), o('WV-Auto ND Privacy', 7179)], { fenceStyle: 'WV-Auto ND Privacy' }, () => null, specs)).toBeNull()
    expect(ownTierFold(opts, { fenceStyle: "WV-ND 6'x8' Privacy" }, () => null, specs)).toBeNull()
    // The same fence at the same price as Better (all 8 ft panels came out): hidden as before, nothing to fold.
    const same = [...opts.slice(0, 3), { ...o('WV-Auto ND Privacy', 7363), snapshot: opts[1].snapshot }]
    expect(ownTierFold(same, { fenceStyle: 'WV-Auto ND Privacy' }, () => null, specs)).toBeNull()
    expect(shownOptions(same)).toEqual([0, 1, 2])
  })

  test('selected at first: the option the quote was made with, else the recommended one', () => {
    const o = (fenceStyle: string, finalPrice: number) => ({ fenceStyle, finalPrice })
    const opts = [o('A', 6000), o('B', 7000), o('C', 8000)]
    expect(startingOption(opts, { fenceStyle: 'C', finalPrice: 8000 }, 1)).toBe(2)
    expect(startingOption(opts, { fenceStyle: 'A', finalPrice: 5900 }, 1)).toBe(0)
    expect(startingOption(opts, { fenceStyle: 'Z', finalPrice: 1 }, 1)).toBe(1)
  })
})

// ── The page ─────────────────────────────────────────────────────────────────

const SHEET = [{ item: 'Post', qty: 4, unitCost: 1, total: 4 }]
const PROPOSAL = {
  version: 1,
  company: { name: 'Getter Done Fence', phone: '3528442677', email: 'office@example.invalid', address: '123 Main St, Ocala, FL 34470' },
  customer: { name: 'Pat Test', address: '1 Oak Ln' },
  footageFt: 216, gatesText: '1 walk gate', included: [], includedNote: '', depositPct: 50, depositNote: '', financing: null,
  recommended: 1,
  options: [
    { label: 'Dig set', fenceStyle: 'DS', finalPrice: 6093, perFoot: 0, sections: 27, tier: { label: 'Good' }, snapshot: { pullSheet: [{ item: 'Pipe', qty: 1 }] } },
    { label: '8 ft panels, No dig', fenceStyle: 'ND8', finalPrice: 7363, perFoot: 0, sections: 27, tier: { label: 'Better' }, badge: 'Most popular', snapshot: { pullSheet: SHEET } },
    { label: '6 ft panels, No dig', fenceStyle: 'ND6', finalPrice: 7924, perFoot: 0, sections: 36, tier: { label: 'Best' }, snapshot: { pullSheet: [{ item: 'Post', qty: 5 }] } },
    { label: '6 or 8 ft panels (best price), No dig', fenceStyle: 'AUTO', finalPrice: 7363, perFoot: 0, sections: 27, snapshot: { pullSheet: [...SHEET].reverse() } },
  ],
  terms: [{ key: 'payment_terms', title: 'Payment Terms', text: 'A 50% deposit is required.\nBalance on completion.' }, { key: 'permits', title: 'Permits', text: 'Customer gets the permit & pays.' }],
}

describe('the proposal page', () => {
  test('the terms before the signature, the company address, the same fence once, the quote\'s own option selected', () => {
    const q = { customerName: 'Pat Test', customerAddress: '', acceptedAt: null, fenceStyle: 'AUTO', finalPrice: 7363 }
    const view = { hidden: [3], start: startingOption(PROPOSAL.options, q, 1) }
    const html = renderProposal(q, PROPOSAL as any, 'tok', 'n', [], null, '', view)
    expect(html).toContain('data-proposal-terms')
    expect(html).toContain('Payment Terms')
    expect(html).toContain('A 50% deposit is required.<br>Balance on completion.')
    expect(html).toContain('Customer gets the permit &amp; pays.')
    expect(html.indexOf('data-proposal-terms')).toBeLessThan(html.indexOf('id="accept"'))
    expect(html).toContain('By signing you accept this proposal and its terms above.')
    expect(html).toContain('data-company-address>123 Main St, Ocala, FL 34470<')
    expect(html.match(/data-option="/g)).toHaveLength(3)
    expect(html).not.toContain('6 or 8 ft panels (best price)')
    expect(html).toMatch(/data-option="1">\s*<input type="radio" name="option" value="1" checked/)
    // Save / more against the selected option (the quote's own, shown by Better): Good saves, Best costs more, Better says neither.
    expect(html).toContain('Save $1,270')
    expect(html).toContain('$561 more')
  })

  test('no address in Settings: no address line; no terms: no Terms section', () => {
    const p = { ...PROPOSAL, company: { ...PROPOSAL.company, address: '' }, terms: [] }
    const html = renderProposal({ customerName: 'Pat', customerAddress: '', acceptedAt: null }, p as any, 'tok', 'n')
    expect(html).not.toContain('data-company-address')
    expect(html).not.toContain('data-proposal-terms')
    // Without a view the recommended option is selected, and every option shows.
    expect(html.match(/data-option="/g)).toHaveLength(4)
  })
})

// ── The signed contract PDF ──────────────────────────────────────────────────

const contract = (extra: Partial<ContractInput> = {}): ContractInput => ({
  company: { name: 'Getter Done Fence', phone: '3528442677', email: 'office@example.invalid', address: '123 Main St, Ocala, FL 34470' },
  customerName: 'Pat Test', address: '1 Oak Ln', optionLabel: 'White Vinyl Privacy', tierLabel: 'Better', price: 7363, footageFt: 216, gatesText: '1 walk gate',
  included: [], includedNote: '', depositPct: 50, depositNote: '', description: '', warranty: { id: 'w', name: 'Lifetime Craftsmanship Warranty', text: 'Lifetime.' } as any,
  installDate: null, acceptedBy: 'Pat Test', acceptedAt: new Date('2026-10-26T20:00:00Z'), signedHow: 'link', signature: null,
  signedRecord: { at: new Date('2026-10-26T20:00:00Z'), ip: '198.51.100.7', accepted: 'Better: White Vinyl Privacy at $7,363.00' },
  terms: PROPOSAL.terms, ...extra,
})

describe('the signed contract PDF', () => {
  test('the terms as signed, the company address and the IP', async () => {
    const words = pdfText(await contractPdf(contract()))
    expect(words).toContain('Terms')
    expect(words).toContain('Payment Terms')
    expect(words).toContain('A 50% deposit is required.')
    expect(words).toContain('Customer gets the permit & pays.')
    expect(words).toContain('123 Main St, Ocala, FL 34470')
    expect(words).toContain('IP address')
    expect(words).toContain('198.51.100.7')
  })

  test('no address in Settings: nothing printed for it; no terms frozen: no Terms heading', async () => {
    const words = pdfText(await contractPdf(contract({ company: { name: 'Getter Done Fence', phone: '3528442677', email: '', address: '' }, terms: [] })))
    expect(words).not.toContain('Ocala, FL')
    expect(words).not.toContain('Payment Terms')
  })
})
