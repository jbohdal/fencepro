/**
 * "The owner moved this to Sam" (review, Oct 30 2026). A Salesman's open quote, job or customer that the owner
 * moved to someone else answers 404 with code MOVED and that person's name (portal lib/salesScope.ts
 * movedAnswer). Every answer passes here (crmAuth.ts fetchWithAuth, authFetch): the app shell says it once and
 * reads her lists again, and a screen that would say "check the connection" says this instead.
 */

export const MOVED_EVENT = 'ezbiz:moved'
const SHOWN_FOR_MS = 60_000
let last: { message: string; at: number; id: string } | null = null

/** The sentence of a MOVED answer, or null. */
export function movedMessage(json: unknown): string | null {
  const j = json as { code?: unknown; error?: unknown } | null
  return j && j.code === 'MOVED' && typeof j.error === 'string' ? j.error : null
}

/** An answer's body: when it is a MOVED one, remember it and tell the app (once in a few seconds). */
export function noteMoved(json: unknown): void {
  const message = movedMessage(json)
  if (!message) return
  const id = typeof (json as { movedId?: unknown }).movedId === 'string' ? (json as { movedId: string }).movedId : ''
  const again = last && last.message === message && last.id === id && Date.now() - last.at < 5_000
  last = { message, at: Date.now(), id }
  if (again) return
  try { window.dispatchEvent(new CustomEvent(MOVED_EVENT, { detail: { message, id } })) } catch { /* no window (tests) */ }
}

/** The last MOVED sentence, if one came in the last minute (a screen that failed to load shows it). */
export function recentMoved(): string | null {
  return last && Date.now() - last.at < SHOWN_FOR_MS ? last.message : null
}

/** A 404 answer: read its body (a copy) for MOVED without using it up. */
export function peekMoved(res: Response): void {
  if (res.status !== 404 || typeof res.clone !== 'function') return
  void res.clone().json().then(noteMoved, () => {})
}
