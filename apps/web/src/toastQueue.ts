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
 * How long this toast stays: its kind's time, or longer for a long one, so its words can be read now that they
 * wrap in full (review Oct 28 2026: the duplicate phone notice on Save was cut off with "…" on a phone):
 * about a quarter second a word, at most 12 seconds. The × closes it sooner.
 */
export function toastMs(kind: QueuedToast['kind'], title: string, body?: string): number {
  const words = `${title} ${body ?? ''}`.trim().split(/\s+/).filter(Boolean).length
  return Math.max(TOAST_MS[kind], Math.min(12_000, 1500 + words * 250))
}

/**
 * Where the toast sits: just above a bar at the bottom of the screen (the
 * quote's step and price bar), so it never covers the Next / Back buttons;
 * null when there is no such bar on screen (the default place is used).
 */
export function bottomAbove(barTop: number | null, viewportHeight: number, gap = 8): number | null {
  if (barTop == null || !Number.isFinite(barTop) || barTop <= 0 || barTop >= viewportHeight) return null
  return Math.round(viewportHeight - barTop + gap)
}
