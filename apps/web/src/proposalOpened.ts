/**
 * "Opened 3× · last 2h ago" on a pipeline card and its window, from the
 * server's count of customer opens of the proposal sent (staff views never
 * count; server lib/proposalViewRules.ts). Null when no proposal was sent, so a
 * card without one shows nothing (and is no taller).
 */

export interface Opened { count: number; lastAt: string | null }

/** "just now", "5m ago", "2h ago", "3d ago". */
export function agoWords(at: string | null | undefined, now = Date.now()): string {
  const t = at ? Date.parse(at) : NaN
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function openedBadgeText(opened: Opened | null | undefined, now = Date.now()): string | null {
  if (!opened) return null
  if (!(opened.count > 0)) return 'Not opened yet'
  const ago = agoWords(opened.lastAt, now)
  return `Opened ${opened.count}×${ago === 'just now' ? ' · just now' : ago ? ` · last ${ago}` : ''}`
}
