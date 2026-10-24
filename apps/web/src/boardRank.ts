/**
 * Hand placed card order on the sales pipeline (Manual order).
 *
 * A placed card carries a number (rank) in the stage it was placed in; smaller is higher up.
 * Cards nobody has placed yet have no number and come first, newest on top.
 *
 * Dropping a card gives it a number halfway between the two cards it lands between, so only
 * that card changes and only that card is saved. (Before Oct 23, 2026 a drop renumbered the
 * whole stage: one drop into No Answer saved ~1,100 cards, ~3.5 s on a phone over 4G.)
 * Other cards get a number only when they must:
 *   - dropped among cards that have none yet: those above the gap the card leaves get numbers,
 *     once (the next drops there are single cards again);
 *   - two numbers too close to split (after ~40 drops into the same gap): the stage is
 *     numbered again, rare.
 */

export interface RankedCard { id: string; stage: string; createdAt?: string; boardOrder?: { stage: string; rank: number } | null }

/** Room left between numbered cards, and given to a card put at the bottom. */
export const RANK_STEP = 1024
/** Two numbers closer than this are not split again; the stage is numbered afresh. */
const MIN_GAP = 1e-6

/** A card's hand placed position, which only counts in the stage it was placed in. */
export function rankOf(l: RankedCard): number | null {
  return l.boardOrder && l.boardOrder.stage === l.stage ? l.boardOrder.rank : null
}

/** Manual order: cards nobody has placed yet come first, newest on top, then the placed ones. */
export function byManualOrder(a: RankedCard, b: RankedCard): number {
  const ra = rankOf(a), rb = rankOf(b)
  if (ra === null && rb === null) return (b.createdAt || '').localeCompare(a.createdAt || '')
  if (ra === null) return -1
  if (rb === null) return 1
  return ra - rb
}

/**
 * The numbers to save when `movedId` is dropped at position `at` of `others` (the stage's other
 * cards in manual order, the moved card left out). Only the cards in the result change; usually
 * that is the moved card alone.
 */
export function ranksForDrop(others: RankedCard[], movedId: string, at: number): Map<string, number> {
  const at0 = Math.max(0, Math.min(at, others.length))
  const unplaced = others.findIndex(l => rankOf(l) !== null)
  const firstPlaced = unplaced === -1 ? others.length : unplaced   // cards [0, firstPlaced) have no number

  // Dropped among (or above) cards with no number: those cards must be numbered, since a card
  // with a number always sorts below every card without one. Number them above the first
  // placed card, keeping their order, and put the moved card among them.
  if (at0 < firstPlaced) {
    const ids = others.slice(0, firstPlaced).map(l => l.id)
    ids.splice(at0, 0, movedId)
    const below = firstPlaced < others.length ? rankOf(others[firstPlaced])! : (ids.length + 1) * RANK_STEP
    return new Map(ids.map((id, i) => [id, below - (ids.length - i) * RANK_STEP]))
  }

  const above = at0 > 0 ? rankOf(others[at0 - 1]) : null
  const below = at0 < others.length ? rankOf(others[at0]) : null
  let rank: number
  if (above === null && below === null) rank = 0
  else if (above === null) rank = below! - RANK_STEP
  else if (below === null) rank = above + RANK_STEP
  else {
    if (below - above < MIN_GAP * 2) return renumber(others, movedId, at0)
    rank = (above + below) / 2
  }
  return new Map([[movedId, rank]])
}

/** Number the whole stage afresh, the moved card at `at`. */
function renumber(others: RankedCard[], movedId: string, at: number): Map<string, number> {
  const ids = others.map(l => l.id)
  ids.splice(at, 0, movedId)
  return new Map(ids.map((id, i) => [id, (i + 1) * RANK_STEP]))
}
