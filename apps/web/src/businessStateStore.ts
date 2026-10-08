/**
 * Business state cache — single source of truth for the catch-all
 * /api/business-state singleton (Phase 8 bundles + checklists + contracts,
 * Phase 9 finance + automations + settings + email templates + budget).
 *
 * Each sub field is exposed via a get / patch helper so the consumer
 * stores (bundleStore, contractStore, checklistStore, settingsStore, etc.)
 * stay tiny and just bridge to this module.
 */

import { getAccessToken, fetchWithAuth } from './crmAuth'
import { createFlusher, legacyMigrationEnabled } from './syncGuard'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')
const EVT = 'fencepro:business-state:updated'
const MIGRATION_FLAG = 'fencepro_business_state_db_migrated_v1'

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
let pendingPatch: Partial<BusinessFields> = {}

async function call<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T }> {
  const token = getAccessToken()
  if (!token) return { ok: false }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/business-state`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return { ok: false }
    const json = await res.json().catch(() => ({}))
    if (!json?.success) return { ok: false }
    return { ok: true, data: json.data as T }
  } catch { return { ok: false } }
}

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch {} }

// Only the fields that changed are sent. A patch that fails to send is put
// back so the next attempt still carries it.
const flusher = createFlusher({
  name: 'Settings and business data',
  isHydrated: () => hydrated,
  send: async () => {
    const patch = pendingPatch
    if (Object.keys(patch).length === 0) return true
    pendingPatch = {}
    const r = await call('PATCH', patch)
    if (!r.ok) pendingPatch = { ...patch, ...pendingPatch }
    return r.ok
  },
})
function scheduleFlush() { flusher.schedule() }

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

const LEGACY_KEYS = [
  'fencepro_bundles', 'fencepro_quote_options', 'fencepro_contract_sections',
  'fencepro_job_checklists', 'fencepro_default_milestones', 'fencepro_pl_entries',
  'fencepro_bs_entries', 'fencepro_email_templates', 'fencepro_config', 'fencepro_budget',
]

const LEGACY_SOURCES: Array<[keyof BusinessFields, string]> = [
  ['bundles', 'fencepro_bundles'],
  ['quoteOptions', 'fencepro_quote_options'],
  ['contractSections', 'fencepro_contract_sections'],
  ['jobChecklists', 'fencepro_job_checklists'],
  ['defaultMilestones', 'fencepro_default_milestones'],
  ['plEntries', 'fencepro_pl_entries'],
  ['balanceSheet', 'fencepro_bs_entries'],
  ['emailTemplates', 'fencepro_email_templates'],
  ['config', 'fencepro_config'],
  ['budget', 'fencepro_budget'],
  ['pendingOrders', 'fencepro_pending_orders'],
  ['purchaseOrders', 'fencepro_purchase_orders'],
  ['invoices', 'fencepro_invoices'],
  ['payments', 'fencepro_payments'],
  ['statements', 'fencepro_statements'],
  ['pullSheets', 'fencepro_customer_pullsheets'],
]

/**
 * Optional, opt in (see legacyMigrationEnabled). Copies old browser only data
 * up to the server, field by field, and ONLY into fields the server has empty.
 *
 * The previous version sent every field on the first login from any browser,
 * with an empty value for anything that browser did not have. Logging in from
 * a second computer, or after clearing the browser, wiped settings, bundles,
 * invoices, payments and the rest on the server.
 */
async function migrateLocalBusinessOnce(server: Partial<BusinessFields>): Promise<Partial<BusinessFields>> {
  if (!legacyMigrationEnabled()) return {}
  if (localStorage.getItem(MIGRATION_FLAG) === '1') return {}
  if (!getAccessToken()) return {}
  const patch: Partial<BusinessFields> = {}
  for (const [field, key] of LEGACY_SOURCES) {
    let local: unknown
    try { const raw = localStorage.getItem(key); local = raw ? JSON.parse(raw) : undefined } catch { local = undefined }
    if (isEmptyValue(local)) continue
    if (!isEmptyValue((server as any)[field])) continue
    ;(patch as any)[field] = local
  }
  if (Object.keys(patch).length === 0) {
    localStorage.setItem(MIGRATION_FLAG, '1')
    return {}
  }
  const r = await call('PATCH', patch)
  if (!r.ok) return {}
  localStorage.setItem(MIGRATION_FLAG, '1')
  return patch
}

export function initBusinessState(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await call<BusinessFields>('GET')
    if (!r.ok || !r.data) return
    const next: BusinessFields = { ...DEFAULT }
    for (const k of Object.keys(DEFAULT) as (keyof BusinessFields)[]) {
      const v = (r.data as any)[k]
      if (v !== undefined && v !== null) (next as any)[k] = v
    }
    let migrated: Partial<BusinessFields> = {}
    try { migrated = await migrateLocalBusinessOnce(next) } catch {}
    cache = { ...next, ...migrated }
    hydrated = true
    emit()
    // Old browser copies are only cleared once they have been moved up.
    // fencepro_config and fencepro_budget stay: they are live mirrors that
    // configStore and BudgetPage keep fresh for inline readers.
    if (legacyMigrationEnabled() && localStorage.getItem(MIGRATION_FLAG) === '1') {
      const KEEP_AS_MIRROR = new Set(['fencepro_config', 'fencepro_budget'])
      try {
        for (const k of LEGACY_KEYS) {
          if (KEEP_AS_MIRROR.has(k)) continue
          localStorage.removeItem(k)
        }
      } catch {}
    }
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once business state has loaded from the server. */
export function isBusinessStateHydrated(): boolean { return hydrated }

export function getBusinessField<K extends keyof BusinessFields>(key: K): BusinessFields[K] {
  return cache[key]
}

export function setBusinessField<K extends keyof BusinessFields>(key: K, value: BusinessFields[K]): void {
  cache[key] = value
  pendingPatch[key] = value as any
  emit()
  scheduleFlush()
}

export const BUSINESS_STATE_UPDATED_EVENT = EVT
