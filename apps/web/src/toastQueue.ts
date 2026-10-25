/**
 * Which toast is on screen: one at a time, oldest first (review, Oct 25,
 * 2026: three stacked toasts covered most of the yard drawing on a phone).
 * Each one's time starts when it is shown, so none goes unseen; the others
 * wait their turn.
 */

export interface QueuedToast { id: string; kind: 'success' | 'error' | 'info' | 'warning' }

export function shownToast<T extends QueuedToast>(msgs: T[]): { shown: T | null; waiting: number } {
  if (!msgs.length) return { shown: null, waiting: 0 }
  return { shown: msgs[0], waiting: msgs.length - 1 }
}

/** How long each kind stays (ms): short for news, longer for something to act on. */
export const TOAST_MS = { success: 3000, info: 3000, warning: 5000, error: 7000 } as const

/**
 * Where the toast sits: just above a bar at the bottom of the screen (the
 * quote's step and price bar), so it never covers the Next / Back buttons;
 * null when there is no such bar on screen (the default place is used).
 */
export function bottomAbove(barTop: number | null, viewportHeight: number, gap = 8): number | null {
  if (barTop == null || !Number.isFinite(barTop) || barTop <= 0 || barTop >= viewportHeight) return null
  return Math.round(viewportHeight - barTop + gap)
}
