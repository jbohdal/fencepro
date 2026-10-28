/**
 * The quote builder's Price step folds a best price quote into the tier the proposal shows it as
 * (web/src/tiers.ts ownTierKey, frozenOwnTierKey), so both read the same price (review Oct 27 2026:
 * Better $8,593 all 8 ft on the Price step, $8,409 6 ft and 8 ft on the unsent proposal).
 * The dev database version: builderProposalBetter.db.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { ownTierKey, frozenOwnTierKey } from '../../web/src/tiers'

describe('the quote builder shows the folded tier as the proposal does', () => {
  const t = (key: string, fenceStyle: string, finalPrice: number, width = 'cheapest') => ({
    spec: { key, name: key, install: 'same', width, color: 'same', text: '' }, category: 'Vinyl', popular: false, off: false, swapped: false, widthFt: 8, otherWidth: null,
    style: { name: fenceStyle }, option: { label: fenceStyle, fenceStyle, finalPrice, perFoot: 0, sections: 0, snapshot: { pullSheet: [{ item: fenceStyle, qty: 1 }] } },
  }) as any
  const tiers = [t('good', "WV-DS 6'x8' Privacy", 7022), t('better', "WV-ND 6'x8' Privacy", 8593), t('best', "WV-ND 6'x6' Privacy", 8724, '6')]
  const specs = tiers.map(x => ({ key: x.spec.key, width: x.spec.width }))
  const own = { label: 'own', fenceStyle: 'WV-Auto ND Privacy', finalPrice: 8409, perFoot: 0, sections: 0, snapshot: { pullSheet: [{ item: 'mix', qty: 1 }] } } as any

  test('a best price quote at $8,409 is Better on both sides; all 8 ft ($8,593) is not what the card says', () => {
    expect(ownTierKey(tiers, own, () => null, specs)).toBe('better')
    // The same fence as Better (all 8 ft came out: same parts, same price): nothing to fold, Better's own card shows.
    expect(ownTierKey(tiers, { ...own, finalPrice: 8593, snapshot: tiers[1].option.snapshot }, () => null, specs)).toBeNull()
    // Better left off the proposal: Good is dig set and Best all 6 ft, so nothing is folded.
    expect(ownTierKey([tiers[0], { ...tiers[1], off: true }, tiers[2]], own, () => null, specs)).toBeNull()
    expect(ownTierKey(tiers, null, () => null, specs)).toBeNull()
  })

  test('a sent proposal folds in the builder only as frozen on it when saved', () => {
    const options = [...tiers.map(x => ({ ...x.option, tier: { key: x.spec.key } })), own]
    expect(frozenOwnTierKey({ options })).toBeNull()
    expect(frozenOwnTierKey({ options, ownTier: null })).toBeNull()
    expect(frozenOwnTierKey({ options, ownTier: { own: 3, tier: 1 } })).toBe('better')
  })
})
