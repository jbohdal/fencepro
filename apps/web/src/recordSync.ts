/**
 * Stable ids and ordered writes for the row based stores (customers, quotes,
 * jobs).
 *
 * The stores used to give a new record a short temporary id, send it to the
 * server, and swap in the server's id when the response came back. Anything
 * that had already pointed at the temporary id was left pointing at nothing:
 *   - a quote saved for a brand new customer was rejected by the database
 *     (the customer id on it did not exist yet) and was never saved at all
 *   - pipeline leads, job checklists, purchase orders and quote options saved
 *     under the temporary id were orphaned after the next reload
 *
 * Now the browser picks the permanent id (a UUID), the server keeps it, and
 * writes that depend on each other are sent in order.
 */

/** A permanent id for a new record. */
export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  // RFC 4122 v4 shape from Math.random, for very old browsers only.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const chains = new Map<string, Promise<unknown>>()
const depth = new Map<string, number>()

/**
 * Run `fn` after every earlier write for the same key has finished. Keys look
 * like "customer:<id>", "quote:<id>", "job:<id>". A failed write does not
 * block the ones behind it.
 */
export function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  depth.set(key, (depth.get(key) ?? 0) + 1)
  const run = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {}).finally(() => {
    const left = (depth.get(key) ?? 1) - 1
    if (left <= 0) { depth.delete(key); if (chains.get(key) === tail) chains.delete(key) }
    else depth.set(key, left)
  })
  chains.set(key, tail)
  return run
}

/** Resolves once every write queued so far for the key has finished. Never rejects. */
export function settled(key: string | null | undefined): Promise<void> {
  if (!key) return Promise.resolve()
  const p = chains.get(key)
  return p ? p.then(() => {}, () => {}) : Promise.resolve()
}

/** True while writes for the key are still queued or in flight. */
export function hasPendingWrites(key: string): boolean {
  return (depth.get(key) ?? 0) > 0
}

/**
 * Call from inside a running write: true when newer writes for the same key
 * are queued behind it. Used to avoid copying a server response over a newer
 * local edit.
 */
export function hasLaterWrites(key: string): boolean {
  return (depth.get(key) ?? 0) > 1
}
