/**
 * The arithmetic behind PopMenu and ConfirmByTyping, kept free of React so it
 * can be unit tested (apps/portal/tests/popupPlace.test.ts).
 */

/** How close a popup may come to the edge of the screen, in px. */
export const POPUP_MARGIN = 8

/**
 * Where a desktop popup goes, given the button's box and the popup's size.
 * Pure, so it can be unit tested.
 */
export function placePopup(
  trigger: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
  align: 'start' | 'end' = 'end',
  gap = 4,
): { left: number; top: number; maxHeight: number } {
  const w = Math.min(size.width, view.width - 2 * POPUP_MARGIN)
  const fitsX = (l: number) => l >= POPUP_MARGIN && l + w <= view.width - POPUP_MARGIN
  const endLeft = trigger.right - w, startLeft = trigger.left
  let left = align === 'end' ? endLeft : startLeft
  if (!fitsX(left)) {
    const other = align === 'end' ? startLeft : endLeft
    left = fitsX(other) ? other : Math.min(Math.max(left, POPUP_MARGIN), view.width - POPUP_MARGIN - w)
  }
  const below = view.height - POPUP_MARGIN - (trigger.bottom + gap)
  const above = trigger.top - gap - POPUP_MARGIN
  let top: number, maxHeight: number
  if (size.height <= below) { top = trigger.bottom + gap; maxHeight = below }
  else if (size.height <= above) { top = trigger.top - gap - size.height; maxHeight = above }
  else if (below >= above) { top = trigger.bottom + gap; maxHeight = Math.max(below, 80) }
  else { maxHeight = Math.max(above, 80); top = trigger.top - gap - Math.min(size.height, maxHeight) }
  return { left: Math.round(left), top: Math.round(Math.max(POPUP_MARGIN, top)), maxHeight: Math.round(maxHeight) }
}

/** A typed name matches: capitals, spaces at the ends and double spaces inside don't matter. */
export function sameName(typed: string, name: string): boolean {
  const n = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return n(name) !== '' && n(typed) === n(name)
}
