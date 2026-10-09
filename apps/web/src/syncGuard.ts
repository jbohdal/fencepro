/**
 * Shared save plumbing for the stores that keep a whole module in one server
 * record (inventory, vendors, pipeline, business state).
 *
 * Those stores hold an in memory copy and write the whole copy back. That is
 * only safe if the copy came from the server first. This module enforces it:
 *
 *   1. Nothing is written until the store has loaded from the server. An
 *      unloaded copy is empty, and writing it would wipe the saved data.
 *   2. A failed save is not swallowed. It is retried, and the user is told.
 *   3. Leaving the page with unsaved changes asks for confirmation.
 */

import { toast } from './toast'
import { fetchWithAuth, getAccessToken } from './crmAuth'
import { createVersionedDoc, type SaveResult } from './versionedDoc'

export interface Flusher {
  /** Call after every change to the in memory copy. */
  schedule: () => void
  /** True while a change has not reached the server yet. */
  isDirty: () => boolean
}

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]
const dirtyStores = new Set<string>()
let unloadHooked = false

function hookUnload() {
  if (unloadHooked || typeof window === 'undefined') return
  unloadHooked = true
  window.addEventListener('beforeunload', e => {
    if (dirtyStores.size === 0) return
    e.preventDefault()
    e.returnValue = ''
  })
}

/** Names of modules with changes that have not reached the server. */
export function unsavedModules(): string[] {
  return [...dirtyStores]
}

export function createFlusher(opts: {
  /** Shown to the user: "Inventory", "Vendors", ... */
  name: string
  /** Has this store loaded from the server? */
  isHydrated: () => boolean
  /** Send the current state. Resolve true on success. */
  send: () => Promise<boolean>
  debounceMs?: number
}): Flusher {
  const debounceMs = opts.debounceMs ?? 250
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let warnedNotLoaded = false
  let warnedFailed = false
  hookUnload()

  async function run() {
    timer = null
    let ok = false
    try { ok = await opts.send() } catch { ok = false }
    if (ok) {
      attempt = 0
      dirtyStores.delete(opts.name)
      if (warnedFailed) {
        warnedFailed = false
        toast.success(`${opts.name} saved`, 'The connection is back and your changes are saved.')
      }
      return
    }
    if (!warnedFailed) {
      warnedFailed = true
      toast.error(`${opts.name} not saved`, 'The server could not be reached. Your changes are still on this screen and will be sent again automatically. Do not close this tab yet.')
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
    attempt++
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, delay)
  }

  return {
    schedule() {
      if (!opts.isHydrated()) {
        if (!warnedNotLoaded) {
          warnedNotLoaded = true
          toast.error(`${opts.name} not saved`, `${opts.name} has not loaded from the server, so this change was not saved. Reload the page and try again.`)
        }
        return
      }
      dirtyStores.add(opts.name)
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, debounceMs)
    },
    isDirty: () => dirtyStores.has(opts.name),
  }
}

export interface VersionedFlusher<T> extends Flusher {
  /** Call when the record has loaded from the server, with the version it came with. */
  loaded: (server: T, version: number) => void
}

/**
 * A flusher for a record that is saved whole and version checked. If another
 * tab or device saved first, the newest copy is fetched, this tab's change is
 * put on top of it and saved again (see versionedDoc and merge3), and the
 * user is told.
 */
export function createVersionedFlusher<T>(opts: {
  name: string
  isHydrated: () => boolean
  debounceMs?: number
  get: () => T
  apply: (next: T) => void
  save: (state: T, baseVersion: number, base: T) => Promise<SaveResult<T>>
}): VersionedFlusher<T> {
  const doc = createVersionedDoc<T>({
    get: opts.get, apply: opts.apply, save: opts.save,
    onMerged: ({ problems }) => {
      // A screen holding its own copy of this record needs to read it again.
      // One that can do so in place says so (useMergedRefresh); otherwise the
      // app shell remounts the open page.
      try {
        const handled = !window.dispatchEvent(new CustomEvent('ezbiz:merged-from-server', { detail: { name: opts.name }, cancelable: true }))
        if (!handled) window.dispatchEvent(new CustomEvent('ezbiz:reload-page-data'))
      } catch {}
      if (problems.length > 0) toast.error(`${opts.name}: not everything could be saved`, problems.join(' '))
      else toast.info(`${opts.name} updated`, 'Changes made on another tab or device were brought in, and your change was saved on top of them.')
    },
  })
  const flusher = createFlusher({ name: opts.name, isHydrated: opts.isHydrated, debounceMs: opts.debounceMs, send: () => doc.push() })
  return { ...flusher, loaded: doc.loaded }
}

/**
 * One version checked save. `body` is sent with `baseVersion` added. A refusal
 * (409 STALE_VERSION) comes back as { status: 'stale' } carrying the server's
 * current copy, shaped by `pick`.
 */
export async function versionedSave<T>(url: string, method: 'PUT' | 'PATCH', body: Record<string, unknown>, baseVersion: number, pick: (data: any) => T): Promise<SaveResult<T>> {
  if (!getAccessToken()) return { status: 'failed' }
  try {
    const res = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, baseVersion }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 409 && json?.code === 'STALE_VERSION') {
      return { status: 'stale', server: pick(json.data), version: typeof json.version === 'number' ? json.version : 0 }
    }
    if (!res.ok || !json?.success) return { status: 'failed' }
    const version = typeof json.version === 'number' ? json.version : json.data?.version
    return typeof version === 'number' ? { status: 'saved', version } : { status: 'failed' }
  } catch { return { status: 'failed' } }
}

/**
 * Moving old browser only data (from before the database existed) up to the
 * server is OFF unless it is switched on in this browser. EZ Biz starts from
 * a clean database; old test data sitting in a browser should not flow into
 * it by surprise. To switch it on for one browser, run in the console:
 *   localStorage.setItem('ezbiz_migrate_legacy_local_data', '1')
 * While it is off the old browser data is left exactly where it is.
 */
export function legacyMigrationEnabled(): boolean {
  try { return localStorage.getItem('ezbiz_migrate_legacy_local_data') === '1' } catch { return false }
}
