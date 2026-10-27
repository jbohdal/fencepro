/**
 * A fence's name as the customer reads it, on the proposal link, the signed
 * page and the signed contract PDF. The office's plain name of a best price
 * fence carries an internal tag, "6 or 8 ft panels (best price)" (Settings →
 * Fence styles, the Panel width choice); the customer reads "6 ft or 8 ft
 * panels" (round 6 review, Oct 27 2026). Anything else is left as written.
 *
 * Pure, no imports. Only the words shown change: the saved quote, its option
 * labels and prices are never rewritten.
 */
export function customerFenceName(label: string | null | undefined): string {
  return String(label ?? '')
    .replace(/\b(\d+) or (\d+) ft panels\b/gi, (_m, a: string, b: string) => `${a} ft or ${b} ft panels`)
    .replace(/\s*\((?:best price|auto)\)/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
