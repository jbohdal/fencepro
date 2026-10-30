/**
 * A name typed in one box ("Customer name" in the quote builder) carried into
 * New Customer's First and Last Name (review, Oct 27 2026): split on the last
 * space, so "Mary Ann Smith" is Mary Ann / Smith and "Cher" is Cher / "".
 */
export function splitOnLastSpace(full: string | null | undefined): { firstName: string; lastName: string } {
  const s = String(full ?? '').replace(/\s+/g, ' ').trim()
  const at = s.lastIndexOf(' ')
  return at < 0 ? { firstName: s, lastName: '' } : { firstName: s.slice(0, at), lastName: s.slice(at + 1) }
}

/** A name's possessive: "AUD Sales'" for a name ending in s, else "Christa Feagin's" (review, Oct 30 2026). */
export const possessive = (name: string): string => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`)
