/**
 * Saving a whole record with a version check.
 *
 * The server keeps a version number on every record that is saved whole. A
 * save sends the version this tab started from; if another tab or device
 * saved in the meantime the server refuses it and hands back its newest copy.
 * This module then puts the local change on top of that copy (see merge3)
 * and saves again, so neither side's change is lost.
 */

import { deepEqual, merge3 } from './merge3'

export type SaveResult<T> =
  | { status: 'saved'; version: number }
  | { status: 'stale'; server: T; version: number }
  | { status: 'failed' }
  /** The server refused it for this login's role; `server` is its copy, to put the screen back. */
  | { status: 'refused'; message: string; server?: T; version?: number }

/** What a push came to: saved (true), not reached (false), or refused for the login's role. */
export type PushResult = boolean | { refused: string }

export interface VersionedDocOptions<T> {
  /** The local copy as it is right now. */
  get: () => T
  /** Replace the local copy (after another device's changes were merged in). */
  apply: (next: T) => void
  /** Send `state`, saying which server version it was built on. `base` is the
   *  server's copy at that version, for stores that send only what changed. */
  save: (state: T, baseVersion: number, base: T) => Promise<SaveResult<T>>
  /** Told each time a refused save was merged; `problems` lists anything that could not be reapplied. */
  onMerged?: (info: { problems: string[]; overlap: boolean }) => void
}

export interface VersionedDoc<T> {
  /** Call when the record has loaded from the server. */
  loaded: (server: T, version: number) => void
  version: () => number
  /** Save until the server and this tab agree. False when the server could not be reached; { refused } when the role may not make this change (the local copy is put back to the server's). */
  push: () => Promise<PushResult>
}

const clone = <T>(v: T): T => (v === undefined ? (null as unknown as T) : JSON.parse(JSON.stringify(v)))
const MAX_ROUNDS = 6

/** The top level fields that differ (a record); '*' for anything that is not a plain record. */
function changedKeys(a: unknown, b: unknown): string[] {
  const rec = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!rec(a) || !rec(b)) return deepEqual(a, b) ? [] : ['*']
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  return [...keys].filter(k => !deepEqual((a as any)[k], (b as any)[k]))
}

export function createVersionedDoc<T>(opts: VersionedDocOptions<T>): VersionedDoc<T> {
  let base: T = clone(opts.get())
  let version = 0

  return {
    loaded(server, v) { base = clone(server); version = v },
    version: () => version,
    async push() {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const sent = clone(opts.get())
        if (deepEqual(sent, base)) return true        // nothing of mine to send
        const r = await opts.save(sent, version, base)
        if (r.status === 'failed') return false
        if (r.status === 'refused') {
          if (r.server !== undefined) {
            base = clone(r.server)
            if (typeof r.version === 'number') version = r.version
            opts.apply(clone(r.server))
          }
          return { refused: r.message }
        }
        if (r.status === 'saved') {
          base = sent
          version = r.version
          if (deepEqual(clone(opts.get()), sent)) return true
          continue                                     // edited again while that save was in flight
        }
        // Refused: someone else saved first. Put my change on top of their copy and go again.
        const mine = clone(opts.get())
        const { merged, problems } = merge3(base, mine, r.server)
        // Did the other save change the same parts as mine? (Top level fields of a record; anything else: yes.)
        const overlap = changedKeys(base, mine).some(k => changedKeys(base, r.server as T).includes(k))
        base = clone(r.server)
        version = r.version
        opts.apply(merged)
        opts.onMerged?.({ problems, overlap })
      }
      return false
    },
  }
}
