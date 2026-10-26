/**
 * A website lead's sides as they are shown: "Run 1 side 1: 281 ft". Notes
 * written before Oct 26, 2026 said "281 ft (measured)" for a side drawn on the
 * aerial photo (nobody measured it on site) and "(typed, photo said 270 ft)"
 * for one the customer typed; they are shown in today's words. Display only:
 * the stored note is never rewritten (round 2 review, Oct 26 2026).
 *
 * Pure: the server (notes, the timeline, new leads) and the web app use it.
 */

const SIDE = /^(\s*Run \d+ side \d+: [\d.]+ ft) \((measured|typed, photo said ([\d.]+) ft)\)[ \t]*$/gm

export function plainSideWords(text: string): string
export function plainSideWords(text: string | null | undefined): string | null | undefined
export function plainSideWords(text: string | null | undefined): string | null | undefined {
  if (!text || !text.includes(' side ')) return text
  return text.replace(SIDE, (_all, side: string, how: string, photoFt?: string) =>
    how === 'measured' ? side : `${side} (typed by the customer; the photo said ${photoFt} ft)`)
}
