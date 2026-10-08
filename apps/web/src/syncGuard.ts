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
