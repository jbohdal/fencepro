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
import { deepEqual, merge3 } from './merge3'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { serverVersionOf } from './docVersions'
import { notePricingPart, registerPricingReload } from './pricingFreshness'
import type { OverheadNow } from './liveOverheadMath'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')
const EVT = 'fencepro:business-state:updated'

type BusinessFields = {
  bundles: any[]
  quoteOptions: any[]
  contractSections: any[]
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
/**
 * The price-bearing parts (Settings and the budget, pricingFreshness.ts). They are read again on their own when
 * prices change, even while other changes made here are still waiting to go, so a change that cannot go yet never
 * keeps a quote on old prices (broken list #58).
 */
const PRICE_FIELDS = ['config', 'budget'] as const
let initPromise: Promise<void> | null = null
let hydrated = false

/**
 * Not read on a page load (audit #17, Oct 27 2026: this record was 3.9 MB on
 * every load of every phone):
 *   - every job's milestone list (the server's jobChecklists, 2.7 MB): no
 *     screen reads it from here; a job's milestones are read with the job
 *     (jobTruthApi.ts, /api/saved-jobs/:id/milestones). Never read or sent.
 *   - the Sales Orders (pendingOrders, 1 MB): read when a screen that shows
 *     them opens (needBusinessFields), and only then saved from this phone.
 * The server leaves them out when asked (?omit=, portal routes/business-state.ts).
 */
const LAZY: ReadonlyArray<keyof BusinessFields> = ['pendingOrders']
/** Lazy parts a screen asked for: read with the record from then on. */
const wanted = new Set<keyof BusinessFields>()
/** Lazy parts in the copy held here (the last read included them). */
const loadedLazy = new Set<keyof BusinessFields>()
const omitList = () => ['jobChecklists', ...LAZY.filter(f => !wanted.has(f))]
const stateUrl = () => `${AUTH_API}/api/business-state?omit=${omitList().join(',')}`

/**
 * Live overhead as the server worked it out from the budget and every job of
 * the company (portal lib/liveOverhead.ts), with each read of this record: the
 * one figure every phone prices with (a Salesman's phone holds only her own
 * jobs). Null until read, or for a login that sees no costs.
 */
let overheadNow: OverheadNow | null = null
const noteOverheadNow = (v: unknown) => { if (v && typeof v === 'object' && 'last12' in v) overheadNow = v as OverheadNow }
export function getOverheadNow(): OverheadNow | null { return overheadNow }

async function call<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T; part?: unknown }> {
  const token = isSignedIn()
  if (!token) return { ok: false }
  try {
    const res = await fetchWithAuth(stateUrl(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return { ok: false }
    const json = await res.json().catch(() => ({}))
    if (!json?.success) return { ok: false }
    // pricingPart: which copy of the price data this is (pricingFreshness.ts); overheadNow: the live overhead.
    if (method === 'GET') noteOverheadNow(json.overheadNow)
    return { ok: true, data: json.data as T, part: json.pricingPart }
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
      // A part not read here is never sent: the empty copy would replace the saved one.
      if (LAZY.includes(k) && !loadedLazy.has(k)) continue
      if (!deepEqual(state[k], base[k])) patch[k] = state[k]
    }
    return versionedSave(stateUrl(), 'PATCH', patch, version, pickBusiness)
  },
})
function scheduleFlush() { flusher.schedule() }

export function initBusinessState(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const asked = [...wanted]
    const r = await call<BusinessFields>('GET')
    if (!r.ok || !r.data) return
    for (const f of asked) loadedLazy.add(f)
    const next = pickBusiness(r.data)
    const version = typeof (r.data as any).version === 'number' ? (r.data as any).version : 0
    cache = next
    flusher.loaded(cache, version)
    notePricingPart('business', r.part)
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
  const asked = [...wanted]
  const r = await call<BusinessFields>('GET')
  if (!r.ok || !r.data || flusher.isDirty()) return
  for (const f of asked) loadedLazy.add(f)
  const version = typeof (r.data as any).version === 'number' ? (r.data as any).version : 0
  cache = pickBusiness(r.data)
  flusher.loaded(cache, version)
  notePricingPart('business', r.part)
  emit()
}

/**
 * Only Settings and the budget, read again while other changes made here are still waiting (or cannot go yet):
 * the server's copy is taken, with any Settings change made here and not saved yet put on top of it.
 */
async function refreshPriceFields(): Promise<void> {
  const r = await call<BusinessFields>('GET')
  if (!r.ok || !r.data) return
  const server = pickBusiness(r.data)
  const base = flusher.base()
  const next = { ...cache }
  for (const k of PRICE_FIELDS) next[k] = merge3(base[k], cache[k], server[k]).merged
  cache = next
  flusher.rebase({ config: server.config, budget: server.budget })
  notePricingPart('business', r.part)
  emit()
}

// Prices changed on the server (pricingFreshness.ts): Settings are read again.
registerPricingReload('business', async () => {
  if (!hydrated) { await initBusinessState(); return }
  // Changes waiting here (or stuck: refused, no signal) never hold the prices back.
  if (flusher.isDirty()) { await refreshPriceFields(); return }
  await refreshBusinessState()
  // A change made while that read was on its way: it skipped; the prices are taken on their own.
  if (flusher.isDirty()) await refreshPriceFields()
})

/**
 * A screen that shows a part not read on load (the Sales Orders) asks for it
 * here: the record is read again with it (and from then on). Resolves true
 * once it is here; false when it could not be read now (no signal, or a
 * change made here still on its way: it is asked again on the next read).
 */
export async function needBusinessFields(fields: Array<keyof BusinessFields>): Promise<boolean> {
  const lazy = fields.filter(f => LAZY.includes(f))
  for (const f of lazy) wanted.add(f)
  const have = () => lazy.every(f => loadedLazy.has(f))
  if (!hydrated) await initBusinessState()
  if (!hydrated) return false
  if (have()) return true
  if (flusher.isDirty()) await whenBusinessStateSaved()
  await refreshBusinessState()
  return have()
}

/** Has this part been read from the server (a lazy one only once a screen asked for it)? */
export function isBusinessFieldLoaded(field: keyof BusinessFields): boolean {
  return hydrated && (!LAZY.includes(field) || loadedLazy.has(field))
}

export function getBusinessField<K extends keyof BusinessFields>(key: K): BusinessFields[K] {
  return cache[key]
}

export function setBusinessField<K extends keyof BusinessFields>(key: K, value: BusinessFields[K]): void {
  // A part not read yet is not changed here (it would be saved as only this change).
  if (LAZY.includes(key) && !loadedLazy.has(key)) return
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
