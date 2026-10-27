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
 *
 * Oct 27 2026 recheck (quote builder from Today's visit, iPhone 13): the tab
 * was drawn 48 px wide (the phone rule that gives every labelled button 48 px)
 * and covered the "No gate" button and the "Customer name" label. The tab is
 * now 14 px, inside the 16 px gutter, and held to that size; it tries both
 * edges at many heights, a label or any text under it counts as covered too,
 * and when every spot is covered it is not shown (never over a control).
 */

export interface Spot { left: number; top: number; width: number; height: number; tab?: boolean; side?: 'left' | 'right' }

/** The full size button (44 px tall, "Feedback" with its icon) and the edge tab. */
export const BUTTON = { width: 112, height: 44 }
export const TAB = { width: 14, height: 64 }
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

/** The edge tab inside the side gutter, `at` of the way down (half way first); on the left edge, or the right one when `vw` is given. */
export function edgeTab(vh: number, at = 0.5, vw?: number): Spot {
  const top = Math.round(vh * at - TAB.height / 2)
  return vw ? { left: vw - TAB.width, top, width: TAB.width, height: TAB.height, tab: true, side: 'right' }
    : { left: 0, top, width: TAB.width, height: TAB.height, tab: true }
}
const TAB_AT = [0.5, 0.36, 0.64, 0.22, 0.78, 0.43, 0.57, 0.29, 0.71, 0.15, 0.85]
/** Every edge tab to try, in order: left then right at each height. */
export function edgeTabs(vh: number, vw: number): Spot[] {
  return TAB_AT.flatMap(a => [edgeTab(vh, a), edgeTab(vh, a, vw)])
}

/** Points to look under, inside a spot: its edges and inside, every 8 px or so down (a 14 px label fits between none). */
export function probePoints(s: Spot): Array<[number, number]> {
  const xs = [s.left + 1, s.left + s.width / 2, s.left + s.width - 1]
  const rows = Math.max(3, Math.ceil(s.height / 8) + 1)
  const ys = Array.from({ length: rows }, (_, i) => s.top + 1 + ((s.height - 2) * i) / (rows - 1))
  return xs.flatMap(x => ys.map(y => [x, y] as [number, number]))
}

/**
 * The first spot `isFree` accepts; else the first free edge tab. A phone: the edge tabs only. Null when
 * nothing is free: the button is not shown rather than put over a control.
 */
export function pickSpot(spots: Spot[], isFree: (s: Spot) => boolean, vh: number, vw = 1024): Spot | null {
  const tabs = edgeTabs(vh, vw)
  if (vw <= PHONE_MAX) return tabs.find(isFree) ?? null
  return spots.find(isFree) ?? tabs.find(isFree) ?? null
}

/** What counts as something a person taps: buttons, links, fields, a signature box, and anything marked as a button. */
export const TAPPABLE = 'button, a[href], input, select, textarea, label, summary, canvas, [role="button"], [role="tab"], [role="link"], [role="option"], [role="switch"], [role="checkbox"], [contenteditable="true"], [onclick]'

/** Words a person reads as a label (a heading over a field): covered when the button is over them. */
export const LABELS = 'label, legend, h1, h2, h3, h4, h5, h6, th, dt'

/** A screen the customer holds (signing on our phone): no staff button over it at all. */
export const CUSTOMER_HOLDS = '[data-customer-holds]'
