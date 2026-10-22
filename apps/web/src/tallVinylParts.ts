/**
 * 8 ft tall vinyl section parts in Inventory (Jonathan, Oct 21, 2026). An 8
 * ft tall section is listed by its parts (materialCalculator
 * TALL_VINYL_SECTION) and priced by the piece, so the parts are $0 on the
 * pull sheet; the ones Inventory has no item for (4 ft pickets, 4 ft U
 * channels, mid rails) are made as catalog items at $0, marked as included in
 * the 8 ft tall section price, for each color that has an 8 ft tall fence.
 * Items already there (the color's 6 and 8 ft rails, White's rail insert) are
 * left exactly as they are. Pure: the server runs it once per company
 * (portal lib/tallVinylParts.ts).
 */

import type { FenceStyle } from './configStore'
import type { InvItem } from './fenceCatalog'
import { isTallVinyl, styleChoicesOf } from './fenceCatalog'
import { normalizeItemName } from './materialCalculator'
import { kitSetFor, type KitSet } from './materialKits'
import { TALL_INCLUDED } from './vinylColorForm'

/** madeFor on the items made here (not a choice tag: removing a choice never takes them). */
export const TALL_PARTS_TAG = 'tall-vinyl-parts'

/** Missing 8 ft tall section parts, made as $0 items included in the section price. */
export function planTallVinylParts(state: { fenceStyles: FenceStyle[]; items: InvItem[]; kits: KitSet[] }): { items: InvItem[]; added: string[] } {
  const items = [...state.items]
  const have = new Set(items.map(i => normalizeItemName(i.name)))
  const added: string[] = []
  for (const s of state.fenceStyles) {
    if (s.isActive === false || !isTallVinyl(styleChoicesOf(s))) continue
    const set = kitSetFor(s.name, state.kits)
    if (!set || set === 'archived' || set.mismatch) continue
    for (const kind of ['section', 'section8'] as const) for (const p of set.kits[kind] ?? []) {
      const key = normalizeItemName(p.part)
      if (have.has(key)) continue
      const color = p.part.match(/^\*Vinyl, ([^,]+),/)?.[1]
      items.push({
        id: `inv_tall8_${key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`, name: p.part, unitCost: 0,
        category: color ? `Vinyl ${color}` : 'Vinyl', status: 'active', madeFor: TALL_PARTS_TAG, includedIn: TALL_INCLUDED.section,
      })
      have.add(key)
      added.push(p.part)
    }
  }
  return { items, added }
}
