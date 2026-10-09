/**
 * cloudStorage — a drop in for localStorage whose data lives on the server.
 *
 * Several modules kept real company data in the browser's localStorage (job
 * costing actuals, change orders, operations stage setup, site plans, file
 * lists, suppliers, the customer activity feed, import templates). That data
 * existed on one computer only and was lost with the browser profile.
 *
 * This keeps the same getItem / setItem shape those modules already use, so
 * moving one over is a one word change, but reads come from a copy loaded at
 * login and writes go to /api/kv (one row per key per company).
 *
 * Rules, same as the other stores (see syncGuard):
 *   - nothing is written until the copy has loaded from the server
 *   - failed writes are retried and reported
 *   - every key is version checked: if another tab or device saved it first,
 *     this tab's change is put on top of the newest value and saved again
 *
 * Browser preferences (which view is open, collapsed columns) stay in real
 * localStorage on purpose: they are per person per device.
 */

import { fetchWithAuth, getAccessToken } from './crmAuth'
import { createVersionedFlusher, versionedSave, legacyMigrationEnabled, type VersionedFlusher } from './syncGuard'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')
const EVT = 'ezbiz:cloud-storage:updated'

/** Every key that lives in cloudStorage. A key not listed here is refused. */
export const CLOUD_KEYS = [
  'fencepro_ops_stages',
  'fencepro_jobcosting',
  'fencepro_changeorders',
  'fencepro_quote_shares',
  'fencepro_customer_activity',
  'fencepro_inv_suppliers',
  'fencepro_import_templates',
  'fencepro_import_log',
  'fencepro_imported_quotes',
  'fencepro_files',
  'fencepro_siteplans',
  'fencepro_staging',
] as const
export type CloudKey = typeof CLOUD_KEYS[number]
const KEY_SET = new Set<string>(CLOUD_KEYS)

let cache: Record<string, unknown> = {}
let hydrated = false
let initPromise: Promise<void> | null = null
const flushers = new Map<string, VersionedFlusher<unknown>>()

function emit(key: string) {
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { key } })) } catch {}
}

const putKey = (key: string, value: unknown, version: number) =>
  versionedSave<unknown>(`${AUTH_API}/api/kv/${key}`, 'PUT', { value: value ?? null }, version, d => d ?? null)

function flusherFor(key: string): VersionedFlusher<unknown> {
  let f = flushers.get(key)
  if (!f) {
    f = createVersionedFlusher<unknown>({
      name: LABELS[key as CloudKey] || 'Your changes',
      isHydrated: () => hydrated,
      debounceMs: 300,
      get: () => cache[key] ?? null,
      apply: next => {
        if (next === null || next === undefined) delete cache[key]
        else cache[key] = next
        emit(key)
      },
      save: (state, version) => putKey(key, state, version),
    })
    flushers.set(key, f)
  }
  return f
}

const LABELS: Record<CloudKey, string> = {
  fencepro_ops_stages: 'Operations stages',
  fencepro_jobcosting: 'Job costing',
  fencepro_changeorders: 'Change orders',
  fencepro_quote_shares: 'Quote share links',
  fencepro_customer_activity: 'Customer activity',
  fencepro_inv_suppliers: 'Suppliers',
  fencepro_import_templates: 'Import templates',
  fencepro_import_log: 'Import log',
  fencepro_imported_quotes: 'Imported quotes',
  fencepro_files: 'Customer files',
  fencepro_siteplans: 'Site plans',
  fencepro_staging: 'Staging',
}

/** Load every key for the company. Called once after login. */
export function initCloudStorage(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (!getAccessToken()) return
    let data: Record<string, unknown> | null = null
    let versions: Record<string, number> = {}
    try {
      const res = await fetchWithAuth(`${AUTH_API}/api/kv`)
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        if (json?.success && json.data && typeof json.data === 'object') {
          data = json.data
          if (json.versions && typeof json.versions === 'object') versions = json.versions
        }
      }
    } catch { /* stays unloaded */ }
    if (!data) return
    cache = data
    // A key that is not on the server yet is at version 0.
    for (const key of CLOUD_KEYS) flusherFor(key).loaded(cache[key] ?? null, versions[key] ?? 0)
    hydrated = true

    // Optional, opt in: move this browser's old copies up, but only for keys
    // the server does not have yet. Nothing on the server is overwritten.
    if (legacyMigrationEnabled()) {
      for (const key of CLOUD_KEYS) {
        if (cache[key] !== undefined) continue
        try {
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const parsed = JSON.parse(raw)
          const r = await putKey(key, parsed, 0)
          if (r.status === 'saved') { cache[key] = parsed; flusherFor(key).loaded(parsed, r.version) }
        } catch { /* skip this key */ }
      }
    }
    emit('*')
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once cloudStorage has loaded from the server. */
export function isCloudStorageHydrated(): boolean { return hydrated }

export const CLOUD_STORAGE_UPDATED_EVENT = EVT

function check(key: string): void {
  if (!KEY_SET.has(key)) throw new Error(`cloudStorage: "${key}" is not a registered key`)
}

/** Same contract as localStorage: a JSON string, or null when nothing is saved. */
export const cloudStorage = {
  getItem(key: CloudKey | string): string | null {
    check(key)
    const v = cache[key]
    return v === undefined || v === null ? null : JSON.stringify(v)
  },
  setItem(key: CloudKey | string, value: string): void {
    check(key)
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch { parsed = value }
    cache[key] = parsed
    emit(key)
    flusherFor(key).schedule()
  },
  removeItem(key: CloudKey | string): void {
    check(key)
    delete cache[key]
    emit(key)
    flusherFor(key).schedule()
  },
}
