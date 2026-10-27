/**
 * A quote's number as the quote window and the printable quote show it
 * ("Quote #DFFD02": the last 6 of its id, capitals), and finding a quote by it
 * in Search (audit Oct 26 2026: "#DFFD02" found nothing).
 */

export const quoteNumber = (id: string): string => (id || '').slice(-6).toUpperCase()

/** Does what was typed ("#DFFD02", "dffd02", "DFFD") name this quote's number? At least 4 letters or digits. */
export function matchesQuoteNumber(id: string, typed: string): boolean {
  const t = typed.trim().replace(/^#/, '').toUpperCase()
  return /^[A-Z0-9]{4,6}$/.test(t) && quoteNumber(id).includes(t)
}
