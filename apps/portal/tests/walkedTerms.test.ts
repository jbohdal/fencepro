/**
 * A walked quote's contract (Jonathan, Nov 5 2026): "Installation is per the measurements and scope above. Final
 * fence layout is confirmed on site before install; any change in length, gates or layout is handled by a written
 * change order." A quote with a finished site plan keeps "per plan and scope above"; words typed in Settings stay.
 */
import { describe, test, expect } from 'vitest'
import { termsForWalked, isWalkedNoPlan, STOCK_SCOPE_OPENING, WALKED_SCOPE_OPENING } from '../src/server/lib/contractTerms'

const terms = [
  { key: 'scope_exclusions', title: 'Scope and Exclusions', text: `${STOCK_SCOPE_OPENING} Unless otherwise noted, the following are excluded: demolition.` },
  { key: 'payment', title: 'Payment', text: 'Due on completion.' },
] as any

describe('walked quote contract wording', () => {
  test('walked, no plan: the scope opening says measurements and the change order; the rest of the section and the other sections stay', () => {
    const out = termsForWalked(terms)
    expect(out[0].text).toBe(`${WALKED_SCOPE_OPENING} Unless otherwise noted, the following are excluded: demolition.`)
    expect(out[0].text.startsWith('Installation is per the measurements and scope above. Final fence layout is confirmed on site before install; any change in length, gates or layout is handled by a written change order.')).toBe(true)
    expect(out[1]).toEqual(terms[1])
  })
  test('words Jonathan typed in place of the stock opening stay', () => {
    const typed = [{ ...terms[0], text: 'All work per our discussion.' }] as any
    expect(termsForWalked(typed)[0].text).toBe('All work per our discussion.')
  })
  test('which quotes are walked without a plan', () => {
    expect(isWalkedNoPlan({ walk: { v: 1, lines: [] } })).toBe(true)
    expect(isWalkedNoPlan({ walk: { v: 1, lines: [] }, planDone: true })).toBe(false)
    expect(isWalkedNoPlan({ yard: { sides: [] } })).toBe(false)
    expect(isWalkedNoPlan(null)).toBe(false)
  })
})
