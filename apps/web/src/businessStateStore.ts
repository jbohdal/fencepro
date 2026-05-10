/**
 * Business state cache — single source of truth for the catch-all
 * /api/business-state singleton (Phase 8 bundles + checklists + contracts,
 * Phase 9 finance + automations + settings + email templates + budget).
 *
 * Each sub field is exposed via a get / patch helper so the consumer
 * stores (bundleStore, contractStore, checklistStore, settingsStore, etc.)
 * stay tiny and just bridge to this module.
 */

import { getAccessToken } from './crmAuth'

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
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingPatch: Partial<BusinessFields> = {}

async function call<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T }> {
  const token = getAccessToken()
  if (!token) return { ok: false }
  try {
    const res = await fetch(`${AUTH_API}/api/business-state`, {
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

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    const patch = pendingPatch
    pendingPatch = {}
    flushTimer = null
    call('PATCH', patch).catch(() => {})
  }, 250)
}

const LEGACY_KEYS = [
  'fencepro_bundles', 'fencepro_quote_options', 'fencepro_contract_sections',
  'fencepro_job_checklists', 'fencepro_default_milestones', 'fencepro_pl_entries',
  'fencepro_bs_entries', 'fencepro_email_templates', 'fencepro_config', 'fencepro_budget',
]

async function migrateLocalBusinessOnce(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    const tryParse = (key: string, fallback: any) => {
      try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
    }
    const patch: Partial<BusinessFields> = {
      bundles: tryParse('fencepro_bundles', []),
      quoteOptions: tryParse('fencepro_quote_options', []),
      contractSections: tryParse('fencepro_contract_sections', []),
      jobChecklists: tryParse('fencepro_job_checklists', {}),
      defaultMilestones: tryParse('fencepro_default_milestones', []),
      plEntries: tryParse('fencepro_pl_entries', []),
      balanceSheet: tryParse('fencepro_bs_entries', []),
      emailTemplates: tryParse('fencepro_email_templates', {}),
      config: tryParse('fencepro_config', {}),
      budget: tryParse('fencepro_budget', {}),
      pendingOrders: tryParse('fencepro_pending_orders', []),
      purchaseOrders: tryParse('fencepro_purchase_orders', []),
      invoices: tryParse('fencepro_invoices', []),
      payments: tryParse('fencepro_payments', []),
      statements: tryParse('fencepro_statements', []),
      pullSheets: tryParse('fencepro_customer_pullsheets', []),
    }
    const r = await call('PATCH', patch)
    if (r.ok) localStorage.setItem(MIGRATION_FLAG, '1')
  } catch {}
}

export function initBusinessState(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try { await migrateLocalBusinessOnce() } catch {}
    const r = await call<BusinessFields>('GET')
    if (r.ok && r.data) {
      cache = { ...DEFAULT }
      for (const k of Object.keys(DEFAULT) as (keyof BusinessFields)[]) {
        const v = (r.data as any)[k]
        if (v !== undefined && v !== null) (cache as any)[k] = v
      }
      emit()
    }
    // Drop the migrated keys EXCEPT the ones used by inline-localStorage readers
    // scattered through the codebase (configStore + BudgetPage maintain those
    // mirrors via their own getters).
    const KEEP_AS_MIRROR = new Set(['fencepro_config', 'fencepro_budget'])
    try {
      for (const k of LEGACY_KEYS) {
        if (KEEP_AS_MIRROR.has(k)) continue
        localStorage.removeItem(k)
      }
    } catch {}
  })()
  return initPromise
}

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
