/**
 * Deposit + balance = the total, to the penny, everywhere (Jonathan, Oct 28 2026:
 * "on every proposal and contract, deposit plus balance equals the total exactly").
 *
 * One cents function makes the deposit (lib/paymentMath.ts depositOf) and the
 * balance is always the total less it (finalOf). Checked here with the real code:
 * - the deposit invoice signing makes, and the Final (contract − the others);
 * - the proposal page's deposit (server render) and the deposit its inline script
 *   shows when the customer taps another option (the script run on a stand-in page);
 * - the contract PDF's deposit line (the PDF's own words);
 * - whole dollar and cents prices, odd cents, 50 / 33 / 30 / 100 / 12.5 / 37 / 1 %,
 *   a discount, change orders added and taken off after signing.
 *
 * Before this fix the page rounded a cents quote's deposit to the dollar ($7,113.83
 * at 50%: page $3,557, invoice $3,556.92) and the contract PDF worked it in floating
 * dollars ($5,000.11 at 50%: PDF $2,500.05, invoice $2,500.06).
 *
 * Jonathan, Oct 29 2026 (D1): customers pay what they saw, the whole dollar the
 * proposal shows. A quote signed from then on is billed and its contract printed
 * that way (lib/customerDollars.ts); one signed before keeps its cents.
 */

import { describe, test, expect } from 'vitest'
import { depositOf, finalOf, moneyText, shownDollarCents, customerDepositCents } from '../src/server/lib/paymentMath'
import { renderProposal, depositCents, depositText, optionPriceHtml } from '../src/server/routes/proposal.js'
import { contractPdf } from '../src/server/lib/contractPdf'
import { pdfText } from './pdfText'

/** "$7,825.63" or "$4,457" back to cents. */
const centsOfText = (t: string) => {
  const m = /^\$([\d,]+)(?:\.(\d\d))?$/.exec(t)
  if (!m) throw new Error(`not money: ${t}`)
  return Number(m[1].replace(/,/g, '')) * 100 + Number(m[2] ?? 0)
}

const CENTS_PRICES = [1, 2, 3, 29, 99, 101, 201, 333, 500_011, 711_383, 891_427, 999_999, 1_565_125, 500_027, 1_000_001, 12_345_678]
const WHOLE_PRICES = [100, 500_100, 891_400, 999_900, 1_000_000, 1_565_100, 2_000_300]
const PCTS = [50, 33, 30, 100, 12.5, 37, 1]

describe('the deposit invoice and the Final add up to the contract, to the cent', () => {
  test('every price and percent: deposit + final = contract, neither below 0', () => {
    for (const pct of PCTS) {
      for (const [prices, whole] of [[CENTS_PRICES, false], [WHOLE_PRICES, true]] as const) {
        for (const c of prices) {
          const dep = depositOf(c, pct, whole)
          const fin = finalOf(c, [dep])
          expect(dep + fin, `${c} at ${pct}%`).toBe(c)
          expect(dep).toBeGreaterThanOrEqual(0)
          expect(fin).toBeGreaterThanOrEqual(0)
          if (whole) { expect(dep % 100).toBe(0); expect(fin % 100).toBe(0) }
        }
      }
    }
  })

  test('the odd cents named: $15,651.25, $9,999.99 and one cent', () => {
    expect([depositOf(1_565_125, 50), finalOf(1_565_125, [depositOf(1_565_125, 50)])]).toEqual([782_563, 782_562])
    expect([depositOf(999_999, 33), finalOf(999_999, [depositOf(999_999, 33)])]).toEqual([330_000, 669_999])
    expect([depositOf(999_999, 30), finalOf(999_999, [depositOf(999_999, 30)])]).toEqual([300_000, 699_999])
    expect([depositOf(1, 50), finalOf(1, [depositOf(1, 50)])]).toEqual([1, 0])
    expect([depositOf(1, 30), finalOf(1, [depositOf(1, 30)])]).toEqual([0, 1])
    // 100%: all deposit, the Final is $0.
    expect([depositOf(1_565_125, 100), finalOf(1_565_125, [depositOf(1_565_125, 100)])]).toEqual([1_565_125, 0])
  })

  test('change orders and adjustments after signing: the deposit stays, the Final takes the change; invoices still add up', () => {
    for (const c of [...CENTS_PRICES.filter(x => x > 10_000), ...WHOLE_PRICES]) {
      const dep = depositOf(c, 50, c % 100 === 0)
      for (const change of [+12_345, +100_000, -27, -45_000, +1, -1]) {
        const contract = c + change
        if (contract < dep) continue
        const fin = finalOf(contract, [dep])
        expect(dep + fin, `${c} ${change}`).toBe(contract)
      }
    }
    // Taken off below the deposit already invoiced: the Final is $0, never negative; the rest is a credit on the balance
    // (lib/contractBilling.ts settleIn), so the invoices are over the contract by exactly that credit.
    expect(finalOf(100_000, [250_000])).toBe(0)
  })
})

// Jonathan, Oct 29 2026 (D1): "Customers pay what they saw. On the 13 sent proposals, invoice the whole dollar
// amount shown, not the cents behind it." The page shows the whole dollar (shownDollarCents) and the deposit the
// schedule bills (customerDepositCents); the balance is the shown total less it. (Branch fix/deposit-balance-penny,
// ec020e6, went the other way, showing cents; it is not used.)
describe('the proposal page shows the whole dollar total and the deposit invoice signing makes', () => {
  const opt = (label: string, finalPrice: number, adjustmentCents?: number) => ({ label, fenceStyle: label, finalPrice, perFoot: 0, sections: 10, ...(adjustmentCents ? { adjustmentCents } : {}) })

  test('server render and depositText: every option, every percent, cents and whole dollar; deposit + balance = the total shown', () => {
    for (const pct of PCTS) {
      for (const c of CENTS_PRICES) {
        const dep = centsOfText(depositText({ depositPct: pct }, c / 100))
        expect(dep, `${c} ${pct}`).toBe(customerDepositCents(c, pct, false))
        // Whole dollars, never over the total shown, and the balance (shown total less it) whole dollars too.
        expect(dep % 100).toBe(0)
        const total = shownDollarCents(c)
        expect(dep).toBeLessThanOrEqual(total)
        expect(dep + finalOf(total, [dep])).toBe(total)
      }
      for (const c of WHOLE_PRICES) {
        expect(centsOfText(depositText({ depositPct: pct, wholeDollar: true }, c / 100))).toBe(depositOf(c, pct, true))
        // Whole dollar by the quote's pricing only (as the schedule and the contract read it): the same.
        expect(depositCents({ depositPct: pct }, c / 100, { wholeDollar: true })).toBe(depositOf(c, pct, true))
      }
    }
    // The case found: $7,113.83 shows $7,114, the deposit $3,557, the balance $3,557 (it was invoiced $3,556.92).
    expect(shownDollarCents(711_383)).toBe(711_400)
    expect(depositText({ depositPct: 50 }, 7113.83)).toBe('$3,557')
    expect(depositText({ depositPct: 50 }, 15651.25)).toBe('$7,826')
    expect(depositText({ depositPct: 50, wholeDollar: true }, 8914)).toBe('$4,457')
    expect(depositText({ depositPct: 50 }, 8914)).toBe('$4,457')
    // D2: 0% or blank asks no deposit.
    expect(depositCents({ depositPct: 0 }, 8914.27)).toBe(0)
    expect(depositCents({}, 8914.27)).toBe(0)
  })

  // The page as the customer gets it, its inline script run on a stand-in page: tapping each option.
  function tapEach(html: string, n: number): string[] {
    const m = /\(function\(\)\{\s*var opts=[\s\S]*?\}\)\(\);/.exec(html)
    if (!m) throw new Error('no option script on the page')
    const inputs = Array.from({ length: n }, (_v, i) => ({ checked: false, value: String(i), on: [] as Array<() => void>, addEventListener(_t: string, f: () => void) { this.on.push(f) } }))
    const opts = inputs.map(input => ({ classList: { toggle() {} }, querySelector: () => input }))
    const b = { textContent: '' }
    const el = () => ({ textContent: '', value: '', addEventListener() {}, getContext: () => ({}), getBoundingClientRect: () => ({}) })
    const document = {
      querySelectorAll: () => opts,
      querySelector: () => null,
      getElementById: (id: string) => (id === 'deposit' ? { querySelector: () => b, dataset: {} } : el()),
    }
    new Function('document', 'window', 'location', 'history', 'fetch', m[0])(document, {}, {}, {}, () => Promise.resolve())
    return inputs.map(inp => { inputs.forEach(x => { x.checked = x === inp }); inp.on.forEach(f => f()); return b.textContent })
  }

  test('a cents quote with three options: whole dollar prices, and the page and every tap show each option\'s deposit invoice', () => {
    const P = { version: 1, company: { name: 'Co', phone: '' }, customer: { name: 'Pat', address: '' }, depositPct: 33, recommended: 0, options: [opt('A', 15651.25), opt('B', 9999.99), opt('C', 5000.11)] }
    const q = { customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'A', finalPrice: 15651.25 }
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 0, hidden: [] })
    const want = [1_565_125, 999_999, 500_011].map(c => customerDepositCents(c, 33, false))
    expect(want).toEqual([516_500, 330_000, 165_000])
    expect(html).toContain('33% to schedule: <b>$5,165</b>')
    expect(tapEach(html, 3).map(centsOfText)).toEqual(want)
    // The price on the page is the whole dollar the customer pays, never the cents behind it.
    expect(html).toContain('<span class="price">$15,651</span>')
    expect(html).toContain('<span class="price">$10,000</span>')
    expect(html).toContain('<span class="price">$5,000</span>')
    expect(html).not.toMatch(/\$15,651\.25|\$9,999\.99/)
    // "Save $X" is the difference between the prices shown: $15,651 − $10,000.
    expect(html).toContain('Save $5,651')
    // The page's script no longer works a deposit out itself.
    expect(html).not.toMatch(/dataset\.pct/)
  })

  test('a whole dollar quote at 30%: every tap is the floored whole dollar deposit, the Final the rest', () => {
    const P = { version: 1, company: { name: 'Co', phone: '' }, customer: { name: 'Pat', address: '' }, depositPct: 30, wholeDollar: true, recommended: 1, options: [opt('A', 6093), opt('B', 7363), opt('C', 7924)] }
    const q = { customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'B', finalPrice: 7363 }
    const html = renderProposal(q, P as any, 'tok', 'n', [], null, '', { start: 1, hidden: [] })
    expect(html).toContain('30% to schedule: <b>$2,208</b>')
    const shown = tapEach(html, 3).map(centsOfText)
    expect(shown).toEqual([609_300, 736_300, 792_400].map(c => depositOf(c, 30, true)))
    for (const [i, c] of [609_300, 736_300, 792_400].entries()) expect(shown[i] + finalOf(c, [shown[i]])).toBe(c)
  })

  test('0% or blank deposit: no Deposit section on the page (D2)', () => {
    for (const depositPct of [0, undefined]) {
      const P = { version: 1, company: { name: 'Co', phone: '' }, customer: { name: 'Pat', address: '' }, depositPct, recommended: 0, options: [opt('A', 8920.46), opt('B', 7396.53)] }
      const html = renderProposal({ customerName: 'Pat', customerAddress: '', acceptedAt: null, fenceStyle: 'A', finalPrice: 8920.46 }, P as any, 'tok', 'n', [], null, '', { start: 0, hidden: [] })
      expect(html).not.toContain('<h2>Deposit</h2>')
      expect(html).toContain('<span class="price">$8,920</span>')
    }
  })

  test('a discount: list − discount = the final price, as shown', () => {
    // A cents quote, $8,914.27 after a −$500.40 adjustment: $9,415 − $501 = $8,914 (each rounded alone, the
    // Discount would read $500 and the lines would not add up).
    const html = optionPriceHtml({ showDiscount: true }, { finalPrice: 8914.27, adjustmentCents: -50_040 })
    expect(html).toContain('Price <s>$9,415</s>')
    expect(html).toContain('Discount −$501')
    expect(html).toContain('>$8,914</span>')
    expect(depositText({ depositPct: 50 }, 8914.27)).toBe('$4,457')
    // Whole dollar: unchanged, whole dollars.
    const w = optionPriceHtml({ showDiscount: true }, { finalPrice: 8914, adjustmentCents: -50_000 })
    expect(w).toContain('Price <s>$9,414</s>')
    expect(w).toContain('Discount −$500')
    // Every cents price and reduction: the three lines add up, and the price is the whole dollar shown.
    for (const c of CENTS_PRICES.filter(x => x > 10_000)) {
      for (const adj of [-1, -27, -50_040, -12_345, -99]) {
        const h = optionPriceHtml({ showDiscount: true }, { finalPrice: c / 100, adjustmentCents: adj })
        const [list, disc, fin] = [/<s>(\$[\d,]+)<\/s>/, /Discount −(\$[\d,]+)/, /data-final-price>(\$[\d,]+)</].map(r => centsOfText(r.exec(h)![1]))
        expect(list - disc, `${c} ${adj}`).toBe(fin)
        expect(fin).toBe(shownDollarCents(c))
      }
    }
  })
})

describe('a contract signed before Oct 29 2026 prints the deposit invoice signing made, to the cent, as it was signed', () => {
  const base = {
    company: { name: 'Co', phone: '', email: '', address: '' }, customerName: 'Pat', address: '1 Oak Ln', optionLabel: 'White vinyl privacy', tierLabel: '',
    footageFt: 0, gatesText: '', included: [], includedNote: '', depositNote: '', description: '', warranty: null, installDate: null,
    acceptedBy: 'Pat', acceptedAt: new Date('2026-10-28T15:00:00Z'), signedHow: 'in_person' as const, signature: null, signedRecord: null, terms: [],
  }
  const cases: Array<[number, number, boolean]> = [[500_011, 50, false], [1_565_125, 50, false], [999_999, 33, false], [711_383, 37, false], [1_000_001, 12.5, false], [500_100, 50, true], [736_300, 30, true], [999_900, 33, true]]
  test.each(cases)('%i cents at %d%% (whole dollar %s)', async (c, pct, whole) => {
    const text = pdfText(await contractPdf({ ...base, price: c / 100, depositPct: pct, wholeDollar: whole } as any))
    const dep = depositOf(c, pct, whole)
    expect(text).toContain(`${pct}% to schedule: ${moneyText(dep)}`)
    expect(text).toContain(moneyText(c))
  })
})

describe('a contract signed from Oct 29 2026 on prints the whole dollar total and deposit the customer saw (D1)', () => {
  const base = {
    company: { name: 'Co', phone: '', email: '', address: '' }, customerName: 'Pat', address: '1 Oak Ln', optionLabel: 'White vinyl privacy', tierLabel: '',
    footageFt: 0, gatesText: '', included: [], includedNote: '', depositNote: '', description: '', warranty: null, installDate: null,
    acceptedBy: 'Pat', acceptedAt: new Date('2026-10-29T15:00:00Z'), signedHow: 'link' as const, signature: null, signedRecord: null, terms: [], shownDollars: true,
  }
  const cases: Array<[number, number, boolean, number, number]> = [
    // price cents, deposit %, priced whole dollar, the total shown, the deposit shown
    [711_383, 50, false, 711_400, 355_700], [1_565_125, 50, false, 1_565_100, 782_600], [999_999, 33, false, 1_000_000, 330_000],
    [553_239, 50, false, 553_200, 276_600], [736_300, 30, true, 736_300, 220_800], [500_100, 50, true, 500_100, 250_000],
  ]
  test.each(cases)('%i cents at %d%% (whole dollar %s)', async (c, pct, whole, total, dep) => {
    const text = pdfText(await contractPdf({ ...base, price: c / 100, depositPct: pct, wholeDollar: whole } as any))
    expect(customerDepositCents(c, pct, whole)).toBe(dep)
    expect(text).toContain(`Price ${moneyText(total)}`)
    expect(text).toContain(`${pct}% to schedule: ${moneyText(dep)}`)
    if (total !== c) expect(text).not.toContain(moneyText(c))
  })
  test('0% or blank deposit: no Deposit line (D2)', async () => {
    for (const depositPct of [0, undefined]) {
      const text = pdfText(await contractPdf({ ...base, price: 8920.46, depositPct } as any))
      expect(text).toContain('Price $8,920.00')
      expect(text).not.toContain('to schedule')
    }
  })
})
