/**
 * Business state cache — single source of truth for the catch-all
 * /api/business-state singleton (Phase 8 bundles + checklists + contracts,
 * Phase 9 finance + automations + settings + email templates + budget).
 *
 * Each sub field is exposed via a get / patch helper so the consumer
 * stores (bundleStore, contractStore, checklistStore, settingsStore, etc.)
 * stay tiny and just bridge to this module.
 */

import { isSignedIn, fetchWithAuth } from './crmAuth'
import { createVersionedFlusher, versionedSave } from './syncGuard'
import { deepEqual } from './merge3'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { serverVersionOf } from './docVersions'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')
const EVT = 'fencepro:business-state:updated'

type BusinessFields = {
  bundles: any[]
  quoteOptions: any[]
  contractSections: any[]
  jobChecklists: Record<string, any>
  defaultMilestones: string[]
  plEntries: any[]
  balanceSheet: any[]
  cashFlowManual: any[]
  automations: any[]
  emailTemplates: Record<string, any>
  settings: any
  config: any
  budget: any
  pendingOrders: any[]
  purchaseOrders: any[]
  invoices: any[]
  payments: any[]
  statements: any[]
  pullSheets: any[]
}

const DEFAULT: BusinessFields = {
  bundles: [],
  quoteOptions: [],
  contractSections: [],
  jobChecklists: {},
  defaultMilestones: [],
  plEntries: [],
  balanceSheet: [],
  cashFlowManual: [],
  automations: [],
  emailTemplates: {},
  settings: {},
  config: {},
  budget: {},
  pendingOrders: [],
  purchaseOrders: [],
  invoices: [],
  payments: [],
  statements: [],
  pullSheets: [],
}

let cache: BusinessFields = { ...DEFAULT }
let initPromise: Promise<void> | null = null
let hydrated = false

async function call<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T }> {
  const token = isSignedIn()
  if (!token) return { ok: false }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/business-state`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return { ok: false }
    const json = await res.json().catch(() => ({}))
    if (!json?.success) return { ok: false }
    return { ok: true, data: json.data as T }
  } catch { return { ok: false } }
}

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch {} }

function pickBusiness(d: any): BusinessFields {
  const next: BusinessFields = { ...DEFAULT }
  for (const k of Object.keys(DEFAULT) as (keyof BusinessFields)[]) {
    const v = d?.[k]
    if (v !== undefined && v !== null) (next as any)[k] = v
  }
  return next
}

// Only the fields that changed are sent, and every save is version checked:
// if another tab or device saved first, this tab's change is put on top of
// the newest copy and saved again (see syncGuard).
const flusher = createVersionedFlusher<BusinessFields>({
  name: 'Settings and business data',
  isHydrated: () => hydrated,
  get: () => cache,
  apply: next => { cache = pickBusiness(next); emit() },
  save: async (state, version, base) => {
    // An answer to an earlier save said the server's record is newer than this tab's copy (the server writes
    // it itself as part of other saves: a signed proposal or a new job adds the job's checklist and Sales Order;
    // docVersions.ts). Take the newest copy first and put this change on top of it, the same merge as after a
    // 409, without sending a save the server would refuse. Read only now, when there is something to save:
    // the record is large, and a phone that saves nothing to it does not download it again.
    if (serverVersionOf('business') > version) {
      const r = await call<BusinessFields>('GET')
      const v = typeof (r.data as any)?.version === 'number' ? (r.data as any).version : -1
      if (r.ok && r.data && v > version) return { status: 'stale', server: pickBusiness(r.data), version: v }
    }
    const patch: Record<string, unknown> = {}
    for (const k of Object.keys(DEFAULT) as (keyof BusinessFields)[]) {
      if (!deepEqual(state[k], base[k])) patch[k] = state[k]
    }
    return versionedSave(`${AUTH_API}/api/business-state`, 'PATCH', patch, version, pickBusiness)
  },
})
function scheduleFlush() { flusher.schedule() }

export function initBusinessState(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await call<BusinessFields>('GET')
    if (!r.ok || !r.data) return
    const next = pickBusiness(r.data)
    const version = typeof (r.data as any).version === 'number' ? (r.data as any).version : 0
    cache = next
    flusher.loaded(cache, version)
    hydrated = true
    emit()
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once business state has loaded from the server. */
export function isBusinessStateHydrated(): boolean { return hydrated }

/**
 * Read Settings and business data again from the server: the server changed
 * them itself (Settings → Price List → Vinyl Colors saves the color, its
 * fences and parts in one go). Skipped while a change made here is waiting to
 * be saved; that save is merged with the server copy anyway.
 */
export async function refreshBusinessState(): Promise<void> {
  if (!hydrated || flusher.isDirty()) return
  const r = await call<BusinessFields>('GET')
  if (!r.ok || !r.data || flusher.isDirty()) return
  const version = typeof (r.data as any).version === 'number' ? (r.data as any).version : 0
  cache = pickBusiness(r.data)
  flusher.loaded(cache, version)
  emit()
}

export function getBusinessField<K extends keyof BusinessFields>(key: K): BusinessFields[K] {
  return cache[key]
}

export function setBusinessField<K extends keyof BusinessFields>(key: K, value: BusinessFields[K]): void {
  cache[key] = value
  emit()
  scheduleFlush()
}

/**
 * Resolves true once every change made here has reached the server (the
 * short wait before sending included), false if that takes longer than `ms`
 * (no signal: the change stays queued and is sent later).
 */
export function whenBusinessStateSaved(ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms
  return new Promise(res => {
    const tick = () => {
      if (!flusher.isDirty()) { res(true); return }
      if (Date.now() > end) { res(false); return }
      setTimeout(tick, 120)
    }
    // The change is queued only after the short wait, so look a moment later.
    setTimeout(tick, 60)
  })
}

export const BUSINESS_STATE_UPDATED_EVENT = EVT
