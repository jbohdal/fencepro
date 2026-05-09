/**
 * Sales pipeline store — in memory cache backed by /api/pipeline.
 *
 * Replaces `localStorage.fencepro_pipeline` (the canonical pipeline state of
 * leads + stages). UI prefs like collapsed stages, view mode, sort, and
 * analytics-open in SalesPipelineBoard remain in localStorage on purpose —
 * those are per-browser preferences, not company canonical data.
 */

import { getAccessToken } from './crmAuth'
import { toast } from './toast'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')
const EVT = 'fencepro:pipeline:updated'
const LEGACY_KEY = 'fencepro_pipeline'
const MIGRATION_FLAG = 'fencepro_pipeline_db_migrated_v1'

let cache: { leads: any[]; stages: any[] } = { leads: [], stages: [] }
let initPromise: Promise<void> | null = null

async function call<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = getAccessToken()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetch(`${AUTH_API}/api/pipeline`, {
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

async function migrateLocalPipelineOnce(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) {
      localStorage.setItem(MIGRATION_FLAG, '1')
      return
    }
    const blob = JSON.parse(raw)
    if (!blob || (!blob.leads?.length && !blob.stages?.length)) {
      localStorage.setItem(MIGRATION_FLAG, '1')
      return
    }
    const r = await call<any>('PUT', { leads: blob.leads || [], stages: blob.stages || [] })
    if (r.ok) {
      localStorage.setItem(MIGRATION_FLAG, '1')
      toast.info('Pipeline synced to cloud', `${(blob.leads || []).length} leads migrated.`)
    }
  } catch {}
}

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch {} }

export function initPipeline(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try { await migrateLocalPipelineOnce() } catch {}
    const r = await call<{ leads: any[]; stages: any[] }>('GET')
    if (r.ok && r.data) {
      cache = { leads: Array.isArray(r.data.leads) ? r.data.leads : [], stages: Array.isArray(r.data.stages) ? r.data.stages : [] }
      emit()
    }
    try { localStorage.removeItem(LEGACY_KEY) } catch {}
  })()
  return initPromise
}

export function getPipeline(): { leads: any[]; stages: any[] } {
  return cache
}

export function savePipeline(leads: any[], stages: any[]): void {
  cache = { leads, stages }
  emit()
  call('PUT', { leads, stages }).catch(() => {})
}

export const PIPELINE_UPDATED_EVENT = EVT
