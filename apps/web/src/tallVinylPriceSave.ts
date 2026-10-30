/**
 * Settings → Price List → 8 ft tall vinyl, the save (TallVinylPrices.tsx):
 * the typed section and post prices onto each 8 ft tall fence's own
 * FenceStyle.pieceCents, in integer cents, dated. Pure (no browser code), so
 * the save is pinned through the real route in
 * apps/portal/tests/tallVinylSave.db.test.ts.
 */

import type { FenceStyle } from './configStore'

/** Cents as the box shows them: "412.50"; nothing saved shows an empty box. */
export const shownCents = (c: number | null | undefined) => (typeof c === 'number' && c > 0 ? (c / 100).toFixed(2) : '')

/** "$412.50" → 41250 (integer cents); blank → null; anything else → NaN. */
export function toCents(t: string): number | null {
  const s = String(t).replace(/[$,\s]/g, '')
  if (!s) return null
  const v = Number(s)
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : NaN
}

/** The box key for a fence's price. */
export const tallKey = (name: string, piece: 'section' | 'post') => `${name}|${piece}`

/**
 * The fences with the typed prices on them. `tall` are the 8 ft tall fences
 * shown (the rest pass through untouched). `bad` names the fences with
 * something typed that is not a price; nothing is saved then.
 */
export function applyTallPrices(fenceStyles: FenceStyle[], tall: FenceStyle[], typed: Record<string, string>, today: string, nameOf: (s: FenceStyle) => string = s => s.name):
  { fenceStyles: FenceStyle[]; bad: string[] } {
  const bad: string[] = []
  const names = new Set(tall.map(s => s.name))
  const next = fenceStyles.map(s => {
    if (!names.has(s.name)) return s
    const sec = toCents(typed[tallKey(s.name, 'section')] ?? ''), post = toCents(typed[tallKey(s.name, 'post')] ?? '')
    if (Number.isNaN(sec) || Number.isNaN(post)) { bad.push(nameOf(s)); return s }
    const was = s.pieceCents ?? {}
    if ((was.section ?? null) === sec && (was.post ?? null) === post) return s
    const out: FenceStyle = { ...s }
    if (sec === null && post === null) delete out.pieceCents
    else out.pieceCents = { section: sec, post, pricedOn: today }
    return out
  })
  return { fenceStyles: next, bad }
}
