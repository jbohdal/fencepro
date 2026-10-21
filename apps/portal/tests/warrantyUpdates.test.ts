/**
 * Warranty updates, the parts that need no database (lib/warrantyUpdates.ts):
 * which option a signed quote was signed for, the names in the customer's
 * note, the proposal shown with an update's warranties (prices and the stored
 * proposal untouched), and the proposal page with the note keeping everything
 * the open tracking and the Accept button rely on.
 */

import { describe, test, expect } from 'vitest'
import { signedIndex, changedNames, withUpdateWarranties, type UpdateOption } from '../src/server/lib/warrantyUpdates.js'
import { renderProposal } from '../src/server/routes/proposal.js'
import * as W from '../../web/src/warranties'

const LIFE = { id: W.LIFETIME_ID, name: 'Lifetime Craftsmanship Warranty', text: W.LIFETIME_TEXT, term: 'lifetime' as const }
const ONE = { id: W.ONE_YEAR_ID, name: '1 Year Workmanship Warranty', text: W.ONE_YEAR_TEXT, term: 'years' as const, years: 1 }
const opt = (label: string, fenceStyle: string, finalPrice: number) => ({ label, fenceStyle, finalPrice, perFoot: finalPrice / 150, sections: 19 })
const proposal = () => ({
  version: 1, warranty: W.ONE_YEAR_TEXT, recommended: 0, depositPct: 50,
  options: [opt('Dig set', "WV-DS 6'x8' Privacy", 10655.85), opt('No dig', "WV-ND 6'x8' Privacy", 12900.91), opt('Tan no dig', "TV-ND 6'x8' Privacy", 14814.7)],
})
const row = (index: number | null, warranty: any, before: any, changed: boolean): UpdateOption => ({ index, label: '', fenceStyle: '', finalPrice: 0, warranty, before, changed })

describe('warranty updates', () => {
  test('the signed option: the accepted one, else the option of the quote\'s style, else none', () => {
    const p = proposal()
    expect(signedIndex({ proposal: p, chosenOption: 1, fenceStyle: "TV-ND 6'x8' Privacy" })).toBe(1)
    expect(signedIndex({ proposal: p, chosenOption: null, fenceStyle: "TV-ND 6'x8' Privacy" })).toBe(2)
    expect(signedIndex({ proposal: p, chosenOption: 9, fenceStyle: 'Something else' })).toBeNull()
    expect(signedIndex({ proposal: null, chosenOption: null, fenceStyle: "TV-ND 6'x8' Privacy" })).toBeNull()
  })

  test('the note names the warranties that changed (each once), else what they have', () => {
    expect(changedNames([row(0, ONE, ONE, false), row(1, LIFE, ONE, true), row(2, LIFE, ONE, true)])).toBe('Lifetime Craftsmanship Warranty')
    expect(changedNames([row(0, ONE, ONE, false)])).toBe('1 Year Workmanship Warranty')
  })

  test('the proposal shown with the update\'s warranties: prices identical, the stored proposal untouched', () => {
    const p = proposal()
    const before = JSON.stringify(p)
    const shown = withUpdateWarranties(p, [row(0, ONE, ONE, false), row(1, LIFE, ONE, true), row(2, LIFE, ONE, true)])
    expect(JSON.stringify(p)).toBe(before)
    expect(shown.options.map(o => o.finalPrice)).toEqual(p.options.map(o => o.finalPrice))
    expect(shown.options.map((o: any) => o.warranty.name)).toEqual([ONE.name, LIFE.name, LIFE.name])
  })

  test('the page with the note keeps the option cards, the signature box and Accept', () => {
    const p = withUpdateWarranties(proposal(), [row(0, ONE, ONE, false), row(1, LIFE, ONE, true), row(2, LIFE, ONE, true)])
    const html = renderProposal({ customerName: 'Test', customerAddress: '', acceptedAt: null }, p as any, 'tok123', 'nonce', [], null, '<section class="notice" data-wu-note><p>Note</p></section>')
    expect(html).toContain('<main class="wrap"><section class="notice" data-wu-note>')
    expect([...html.matchAll(/class="opt[^"]*" data-option="(\d)"/g)].map(m => m[1])).toEqual(['0', '1', '2'])
    expect(html).toContain('id="sig"')
    expect(html).toContain('id="accept"')
    expect(html).toContain("fetch('tok123/accept'")
    expect([...html.matchAll(/data-warranty-badge>([^<]+)</g)].map(m => m[1])).toEqual([ONE.name, LIFE.name, LIFE.name])
  })
})
