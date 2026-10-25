/**
 * A part's name as the crew reads it on a pull sheet or crew packet. The
 * Inventory item keeps its own name; only the words shown change.
 *
 * "*Vinyl, Gate, Hinge" is bought and priced as a PAIR of hinges: one per
 * gate leaf at every height, 2 hinges on each leaf (Jonathan, Oct 25, 2026).
 * Shown as "... (pair)" so 1 on the sheet is not read as one hinge.
 */

const PAIRS = /^\*{0,3}\s*Vinyl, Gate, Hinge\s*$/i

/** True for a part that is one pair (the vinyl gate hinge). */
export const isPairPart = (name: string) => PAIRS.test(name || '')

/** The part name with " (pair)" after it when it is a pair; otherwise as it is. */
export function partWithPair(name: string): string {
  return isPairPart(name) && !/\(pair\)\s*$/i.test(name) ? `${name} (pair)` : name
}
