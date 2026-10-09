/**
 * Sales pipeline store — in memory cache backed by /api/pipeline.
 *
 * Replaces `localStorage.fencepro_pipeline` (the canonical pipeline state of
 * leads + stages). UI prefs like collapsed stages, view mode, sort, and
 * analytics-open in SalesPipelineBoard remain in localStorage on purpose —
 * those are per-browser preferences, not company canonical data.
 */

import { getAccessToken, fetchWithAuth } from './crmAuth'
import { toast } from './toast'
import { createVersionedFlusher, versionedSave, legacyMigrationEnabled } from './syncGuard'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')
const EVT = 'fencepro:pipeline:updated'
const LEGACY_KEY = 'fencepro_pipeline'
const MIGRATION_FLAG = 'fencepro_pipeline_db_migrated_v1'

let cache: { leads: any[]; stages: any[] } = { leads: [], stages: [] }
let initPromise: Promise<void> | null = null
let hydrated = false

async function call<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = getAccessToken()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/pipeline`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: 'Session expired' }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error' }
  }
}

/** Optional, opt in. Old browser data only moves up if the server has no pipeline at all. */
async function migrateLocalPipelineOnce(server: { leads: any[]; stages: any[] }, version: number): Promise<{ leads: any[]; stages: any[] } | null> {
  if (!legacyMigrationEnabled()) return null
  if (localStorage.getItem(MIGRATION_FLAG) === '1') return null
  if (!getAccessToken()) return null
  if (server.leads.length || server.stages.length) { localStorage.setItem(MIGRATION_FLAG, '1'); return null }
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    const blob = raw ? JSON.parse(raw) : null
    if (!blob || (!blob.leads?.length && !blob.stages?.length)) {
      localStorage.setItem(MIGRATION_FLAG, '1')
      return null
    }
    const next = { leads: blob.leads || [], stages: blob.stages || [] }
    const r = await call<any>('PUT', { ...next, baseVersion: version })
    if (!r.ok) return null
    localStorage.setItem(MIGRATION_FLAG, '1')
    toast.info('Pipeline synced to cloud', `${next.leads.length} leads migrated.`)
    return next
  } catch { return null }
}

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch {} }

export function initPipeline(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await call<{ leads: any[]; stages: any[] }>('GET')
    if (!r.ok || !r.data) return
    let next = { leads: Array.isArray(r.data.leads) ? r.data.leads : [], stages: Array.isArray(r.data.stages) ? r.data.stages : [] }
    let version = typeof (r.data as any).version === 'number' ? (r.data as any).version : 0
    const migrated = await migrateLocalPipelineOnce(next, version)
    if (migrated) { next = migrated; version++ }
    cache = next
    flusher.loaded(next, version)
    hydrated = true
    emit()
    if (legacyMigrationEnabled() && localStorage.getItem(MIGRATION_FLAG) === '1') {
      try { localStorage.removeItem(LEGACY_KEY) } catch {}
    }
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once the pipeline has loaded from the server. */
export function isPipelineHydrated(): boolean { return hydrated }

// The whole pipeline is one server record. It is only written after it has
// loaded, and every save is version checked: if another tab or device saved
// first, this tab's change is put on top of the newest copy (see syncGuard).
type PipelineDoc = { leads: any[]; stages: any[] }
const pickPipeline = (d: any): PipelineDoc => ({ leads: Array.isArray(d?.leads) ? d.leads : [], stages: Array.isArray(d?.stages) ? d.stages : [] })
const flusher = createVersionedFlusher<PipelineDoc>({
  name: 'Sales pipeline',
  isHydrated: () => hydrated,
  debounceMs: 150,
  get: () => ({ leads: cache.leads, stages: cache.stages }),
  apply: next => { cache = pickPipeline(next); emit() },
  save: (state, version) => versionedSave(`${AUTH_API}/api/pipeline`, 'PUT', state, version, pickPipeline),
})

export function getPipeline(): { leads: any[]; stages: any[] } {
  return cache
}

export function savePipeline(leads: any[], stages: any[]): void {
  cache = { leads, stages }
  emit()
  flusher.schedule()
}

export const PIPELINE_UPDATED_EVENT = EVT
