/**
 * Searching Inventory by typing (Needs a match, Price history): every word
 * typed must be in the item's name or number, in any order, with punctuation
 * left out. "bolt 3/8" finds 'G, Bolt, 3/8" x 3" w/ Nut'; so do "3/8 bolt",
 * "bolt/nut 3/8" and "bol 3/8". A fraction (3/8) or a decimal (11.5) stays
 * one word, and a number typed is a whole number on the item ("x 3" is not
 * the 3 of 3/8).
 */

/** Lower case, punctuation as spaces; a slash or dot between two digits is kept. */
export function searchText(s: string): string {
  const t = s.toLowerCase()
    .replace(/(\d)\/(?=\d)/g, '$1\u0001')
    .replace(/(\d)\.(?=\d)/g, '$1\u0002')
    .replace(/[^a-z0-9\u0001\u0002]+/g, ' ')
    .replace(/\u0001/g, '/')
    .replace(/\u0002/g, '.')
    .trim()
  return ` ${t} `
}

/** The words of a search. */
export const searchWords = (q: string): string[] => searchText(q).trim().split(' ').filter(Boolean)

/** True when every word of the search is in the name or the item number. */
export function matchesSearch(item: { name: string; sku?: string | null }, q: string): boolean {
  const want = searchWords(q)
  if (!want.length) return false
  const hay = searchText(`${item.name} ${item.sku ?? ''}`)
  // A number is a whole word ("3" is not the 3 of 3/8); other words can be the start of one ("bol").
  return want.every(w => (/^[\d/.]+$/.test(w) ? hay.includes(` ${w} `) : hay.includes(w)))
}

/** Inventory items for a search, at most `n`. */
export function searchInventory<T extends { name: string; sku?: string | null }>(items: T[], q: string, n = 8): T[] {
  if (!searchWords(q).length) return []
  return items.filter(i => matchesSearch(i, q)).slice(0, n)
}
