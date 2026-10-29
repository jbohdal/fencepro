/**
 * What the Salesman's phone actually holds, by record and version (lost data
 * fix, Oct 29 2026).
 *
 * The business record and the per customer kv keys are saved back whole by
 * the Salesman's phone, with the entries of other people's customers left
 * out (lib/salesScopeRecords.ts). Which entries the phone left out was worked
 * out from the Salesman's scope at SAVE time. A customer given to the
 * Salesman after the phone loaded was then "in scope" but not on the phone,
 * so the save read as deleting that customer's pull sheets (reviewer, Oct 29:
 * Carlton Williams's pull sheets went 5 to 0, every request a 200).
 *
 * So the server remembers, for each Salesman, record and version, the entries
 * (by id, or by content when an entry has none) it handed that phone: the
 * copy in a read, a 409's newer copy, a refusal's copy, or, after the
 * Salesman's own save, what the phone sent (the phone keeps its sent copy as
 * its base; web versionedDoc.ts). A save may remove an entry only when it was
 * on the phone's copy of the version the save is built on. Nothing comes from
 * the phone's word.
 *
 *   sure: on every copy of that version handed to this login (two phones of
 *         the same Salesman read the same version under different scopes:
 *         only what both had may be removed).
 *   seen: on any copy of it (a change sent for one of these is the phone's).
 *
 * Kept in the server's memory: after a restart, or for a version not handed
 * to this login, the save is refused with a 409 and the current copy (the app
 * puts its change on that and saves again; web syncGuard.ts), never guessed.
 */

export interface Had {
  /** Per list (business record field, or 'value' for a kv key): entries on every copy handed out. */
  sure: Map<string, Set<string>>
  /** Per list: entries on any copy handed out. */
  seen: Map<string, Set<string>>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** JSON with keys sorted (the database reorders an object's keys). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

/** An entry's identity: its id (or share token), else its content. */
export function entryKey(e: unknown): string {
  if (isObj(e)) { const id = str(e.id) ?? str(e.token); if (id) return `id:${id}` }
  return `json:${canonical(e)}`
}

/** The identities of a list's entries (for a keyed object: its keys). */
export function keysOfList(list: unknown): Set<string> {
  if (Array.isArray(list)) return new Set(list.map(entryKey))
  if (isObj(list)) return new Set(Object.keys(list).map(k => `key:${k}`))
  return new Set()
}

const KEEP_VERSIONS = 4
const MAX_RECORDS = 2_000
const memory = new Map<string, Map<number, Had>>()
const slot = (userId: string, accountId: string, record: string) => `${userId}|${accountId}|${record}`

/** Remember that this copy (per list) of `record` at `version` was handed to this login. */
export function handedOut(userId: string, accountId: string, record: string, version: number, lists: Map<string, Set<string>>): void {
  handedOutHad(userId, accountId, record, version, { sure: lists, seen: lists })
}

/**
 * The same with a Had: after the Salesman's own save, the lists the save sent
 * are what the phone sent, and the others are what it held before (carried
 * over from the version the save was built on, both sure and seen).
 */
export function handedOutHad(userId: string, accountId: string, record: string, version: number, add: Had): void {
  const k = slot(userId, accountId, record)
  let byVersion = memory.get(k)
  if (!byVersion) {
    if (memory.size >= MAX_RECORDS) memory.delete(memory.keys().next().value as string)
    byVersion = new Map()
  } else memory.delete(k)
  memory.set(k, byVersion)                  // most recently used last
  let had = byVersion.get(version)
  if (!had) {
    had = { sure: new Map(), seen: new Map() }
    byVersion.set(version, had)
    while (byVersion.size > KEEP_VERSIONS) byVersion.delete(Math.min(...byVersion.keys()))
  }
  for (const [list, keys] of add.sure) {
    const sure = had.sure.get(list)
    had.sure.set(list, sure ? new Set([...sure].filter(x => keys.has(x))) : new Set(keys))
  }
  for (const [list, keys] of add.seen) {
    const seen = had.seen.get(list) ?? new Set<string>()
    for (const x of keys) seen.add(x)
    had.seen.set(list, seen)
  }
}

/**
 * What the phone holds after its own save: `sent` per list it sent (what the
 * merge took from it), every other list as at the version it was built on.
 */
export function afterOwnSave(base: Had, sent: Map<string, Set<string>>): Had {
  const sure = new Map(base.sure), seen = new Map(base.seen)
  for (const [list, keys] of sent) { sure.set(list, keys); seen.set(list, keys) }
  return { sure, seen }
}

/** What this login's copies of `record` at `version` held; null when not known (refuse with a 409). */
export function handedAt(userId: string, accountId: string, record: string, version: number): Had | null {
  return memory.get(slot(userId, accountId, record))?.get(version) ?? null
}

/** Nothing handed out yet (a record that is not there, version 0): the phone holds nothing. */
export const NOTHING: Had = { sure: new Map(), seen: new Map() }

/** One list's part of `had` (an unknown list: nothing). */
export function hadList(had: Had, list: string): { sure: Set<string>; seen: Set<string> } {
  return { sure: had.sure.get(list) ?? new Set(), seen: had.seen.get(list) ?? new Set() }
}

/** For the tests: forget everything. */
export function forgetHandedOut(): void { memory.clear() }
