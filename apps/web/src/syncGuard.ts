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
import { fetchWithAuth, isSignedIn } from './crmAuth'
import { createVersionedDoc, type SaveResult, type PushResult } from './versionedDoc'
import { merge3 } from './merge3'
import { registerKind, enqueue, pendingFor } from './outbox'

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
  /** The server's copy this tab's changes are measured from. */
  base: () => T
  /** Some parts were read again from the server on their own: what they hold is not a change made here. */
  rebase: (parts: Partial<T>) => void
}

/**
 * A flusher for a record that is saved whole and version checked. Changes go
 * through the outbox: the newest copy and the server copy it was built on are
 * kept on the phone until the server has them, so closing the app or losing
 * signal loses nothing. If another tab or device saved first, or the app was
 * reopened before it was sent, the change is put on top of the newest server
 * copy (see versionedDoc and merge3) and saved again.
 */
interface DocSave { name: string; base: unknown; mine: unknown }
const docs = new Map<string, { push: () => Promise<PushResult>; isHydrated: () => boolean }>()
registerKind<DocSave>('doc.save', {
  what: op => `This change to ${op.payload.name.toLowerCase()}`,
  send: async op => {
    const d = docs.get(op.payload.name)
    // The module has not loaded yet on this visit: wait for it.
    if (!d || !d.isHydrated()) return { ok: false, status: 503 }
    const out = await d.push()
    if (out === true) return { ok: true }
    // Refused for this login's role: the copy on screen is already the server's again.
    if (out && typeof out === 'object') return { ok: false, status: 403, code: 'NOT_ALLOWED', error: out.refused }
    return { ok: false, status: 0 }
  },
})

export function createVersionedFlusher<T>(opts: {
  name: string
  isHydrated: () => boolean
  debounceMs?: number
  get: () => T
  apply: (next: T) => void
  save: (state: T, baseVersion: number, base: T) => Promise<SaveResult<T>>
}): VersionedFlusher<T> {
  const key = `doc:${opts.name}`
  let serverCopy: T | null = null
  const doc = createVersionedDoc<T>({
    get: opts.get, apply: opts.apply,
    save: async (state, v, base) => {
      const r = await opts.save(state, v, base)
      if (r.status === 'saved') serverCopy = r.server !== undefined ? JSON.parse(JSON.stringify(r.server ?? null)) : state
      if (r.status === 'refused' && r.server !== undefined) serverCopy = JSON.parse(JSON.stringify(r.server ?? null))
      return r
    },
    onLeftOut: leftOut => {
      try { window.dispatchEvent(new CustomEvent('ezbiz:reload-page-data')) } catch {}
      toast.info(`${opts.name} saved`, `${leftOut === 1 ? 'One entry was' : `${leftOut} entries were`} for a customer or quote that is no longer yours, so it was left as it is. Everything else is saved.`)
    },
    onMerged: ({ problems, overlap }) => {
      // A screen holding its own copy of this record needs to read it again.
      // One that can do so in place says so (useMergedRefresh); otherwise the
      // app shell remounts the open page.
      try {
        const handled = !window.dispatchEvent(new CustomEvent('ezbiz:merged-from-server', { detail: { name: opts.name }, cancelable: true }))
        if (!handled) window.dispatchEvent(new CustomEvent('ezbiz:reload-page-data'))
      } catch {}
      if (problems.length > 0) toast.error(`${opts.name}: not everything could be saved`, problems.join(' '))
      // Only when the other save touched the same part: the server's own saves alongside this one (a new job's
      // milestone list when a quote is marked Sold) are not "someone else" and need no word (Oct 25 2026).
      else if (overlap) toast.info(`${opts.name} updated`, 'Someone changed this on another phone or computer at the same time. Both changes are kept.')
    },
  })
  docs.set(opts.name, { push: () => doc.push(), isHydrated: opts.isHydrated })
  let timer: ReturnType<typeof setTimeout> | null = null
  let warnedNotLoaded = false
  const clone = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
  return {
    schedule() {
      if (!opts.isHydrated()) {
        if (!warnedNotLoaded) {
          warnedNotLoaded = true
          toast.error(`${opts.name} not saved`, `${opts.name} has not loaded yet, usually because of weak signal, so this change was not kept. Tap Try again at the top when there is signal, then make the change again.`)
        }
        return
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        // Kept with the server copy it was built on, so it can be merged after a reload.
        const waiting = pendingFor(key)[0]
        const base = waiting ? (waiting.payload as DocSave).base : clone(serverCopy)
        void enqueue<DocSave>({ key, kind: 'doc.save', payload: { name: opts.name, base, mine: clone(opts.get()) }, label: `${opts.name}: changes` })
      }, opts.debounceMs ?? 250)
    },
    isDirty: () => !!timer || pendingFor(key).length > 0,
    base: () => doc.base(),
    rebase: parts => {
      doc.rebase(parts)
      serverCopy = { ...(serverCopy as T), ...clone(parts) }
      // What waits on the phone moves with it, its base and its copy together: after a reload, what was read here is not a change made here.
      const waiting = pendingFor(key)[0]
      if (waiting) {
        const p = waiting.payload as DocSave
        const now = clone(opts.get()) as Record<string, unknown>
        p.base = { ...(p.base as object), ...clone(parts) }
        p.mine = { ...(p.mine as object), ...Object.fromEntries(Object.keys(parts as object).map(k => [k, now[k]])) }
      }
    },
    loaded: (server, version) => {
      doc.loaded(server, version)
      serverCopy = JSON.parse(JSON.stringify(server ?? null))
      // Changes kept on this phone from before (the app closed before they were sent): on top of the server copy.
      const waiting = pendingFor(key)[0]
      if (waiting) {
        const p = waiting.payload as DocSave
        const { merged } = merge3(p.base as T, p.mine as T, server)
        opts.apply(merged)
      }
    },
  }
}

/**
 * One version checked save. `body` is sent with `baseVersion` added. A refusal
 * (409 STALE_VERSION) comes back as { status: 'stale' } carrying the server's
 * current copy, shaped by `pick`.
 */
export async function versionedSave<T>(url: string, method: 'PUT' | 'PATCH', body: Record<string, unknown>, baseVersion: number, pick: (data: any) => T): Promise<SaveResult<T>> {
  if (!isSignedIn()) return { status: 'failed' }
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
    if (res.status === 403 && json?.code === 'NOT_ALLOWED') {
      const message = typeof json.error === 'string' ? json.error : 'Your login is not allowed to do this. Ask Jonathan.'
      return 'data' in json ? { status: 'refused', message, server: pick(json.data), version: typeof json.version === 'number' ? json.version : undefined } : { status: 'refused', message }
    }
    if (!res.ok || !json?.success) return { status: 'failed' }
    const version = typeof json.version === 'number' ? json.version : json.data?.version
    if (typeof version !== 'number') return { status: 'failed' }
    // Part of the save was not this login's to send (a Salesman's entry for a customer no longer hers): saved
    // without it; the answer is the copy as saved, which becomes this copy.
    if (typeof json.leftOut === 'number' && json.leftOut > 0 && 'data' in json) return { status: 'saved', version, server: pick(json.data), leftOut: json.leftOut }
    return { status: 'saved', version }
  } catch { return { status: 'failed' } }
}
