/**
 * Where the floating "Feedback" button sits over an open card, quote or job
 * window: a spot where it covers no button, link or field.
 *
 * Over a window the button floats (FeedbackButton.tsx FeedbackOverWindow). A
 * fixed corner covered real controls on an iPhone: the card window's
 * "Customer page" button and the quote builder's camera button (iPhone
 * Simulator and e2e/field.mjs, Oct 26 2026). On a phone (under 768 px) it is a
 * narrow tab on the screen's left edge: the windows keep a 16 px side gutter,
 * so it can only touch the outer edge of a control, never its middle, even
 * while the window scrolls under it. On a wider screen it tries a few spots, low
 * on the screen first, and takes the first one with nothing tappable under it,
 * else the edge tab.
 */

export interface Spot { left: number; top: number; width: number; height: number; tab?: boolean }

/** The full size button (44 px tall, "Feedback" with its icon) and the edge tab. */
export const BUTTON = { width: 112, height: 44 }
export const TAB = { width: 22, height: 64 }
/** Under this width the button is always the edge tab. */
export const PHONE_MAX = 767

/**
 * The spots to try, in order, for a viewport `vw` x `vh`. `bottomInset` is
 * what is fixed along the bottom (a phone's tab bar, about 76 px).
 */
export function spotsFor(vw: number, vh: number, bottomInset = 0): Spot[] {
  const { width: w, height: h } = BUTTON
  const m = 12
  const low = vh - bottomInset - h - m
  const right = vw - w - m
  const rows = [low, Math.round(vh * 0.62), Math.round(vh * 0.45), Math.round(vh * 0.3)]
  const out: Spot[] = []
  for (const top of rows) {
    out.push({ left: m, top, width: w, height: h })
    out.push({ left: right, top, width: w, height: h })
  }
  return out.filter(s => s.top >= m && s.left >= 0 && s.left + s.width <= vw)
}

/** The edge tab on the left edge (inside the side gutter), `at` of the way down: half way first. */
export function edgeTab(vh: number, at = 0.5): Spot {
  return { left: 0, top: Math.round(vh * at - TAB.height / 2), width: TAB.width, height: TAB.height, tab: true }
}
const TAB_AT = [0.5, 0.36, 0.64, 0.22, 0.78]

/** Points to look under, inside a spot (corners in a little, the middle, the edges' middles). */
export function probePoints(s: Spot): Array<[number, number]> {
  const xs = [s.left + 3, s.left + s.width / 2, s.left + s.width - 3]
  const ys = [s.top + 3, s.top + s.height / 2, s.top + s.height - 3]
  return xs.flatMap(x => ys.map(y => [x, y] as [number, number]))
}

/** The first spot `isFree` accepts; else the first free edge tab; else the edge tab half way down. A phone: the edge tab only. */
export function pickSpot(spots: Spot[], isFree: (s: Spot) => boolean, vh: number, vw = 1024): Spot {
  const tabs = TAB_AT.map(a => edgeTab(vh, a))
  if (vw <= PHONE_MAX) return tabs.find(isFree) ?? tabs[0]
  return spots.find(isFree) ?? tabs.find(isFree) ?? tabs[0]
}

/** What counts as something a person taps: buttons, links, fields, a signature box, and anything marked as a button. */
export const TAPPABLE = 'button, a[href], input, select, textarea, label, summary, canvas, [role="button"], [role="tab"], [role="link"], [role="option"], [role="switch"], [role="checkbox"], [contenteditable="true"], [onclick]'

/** A screen the customer holds (signing on our phone): no staff button over it at all. */
export const CUSTOMER_HOLDS = '[data-customer-holds]'
