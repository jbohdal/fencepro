/**
 * Who may do what. The one place the rule lives; every route asks `can()`.
 *
 *   super_admin (Jonathan, the owner), admin   everything
 *   manager                                     everything except users, system tools and
 *                                               deleting records (Archive instead)
 *   office_staff                                runs the office: schedule, billing, vendors,
 *                                               stock counts, permits, crew links, quotes;
 *                                               may remove operational entries (schedule
 *                                               entries, rain days, photos, files, notes);
 *                                               archives customers, cards and jobs.
 *                                               Not settings, prices, users, automations,
 *                                               and never customers, quotes, jobs or cards.
 *   sales_rep                                   quotes and proposals, customers and leads,
 *                                               notes, appointments, moving pipeline cards,
 *                                               photos; archives customers and cards.
 *                                               Nothing else changes, nothing is deleted.
 *   field_crew                                  as sales_rep, but no quote writes either
 *                                               (photos, notes, walkthroughs, job checklists).
 *
 * A role not listed (a customer token) may do none of it.
 */

import { verifyStaffBearer } from './secrets.js'

export type StaffRole = 'super_admin' | 'admin' | 'manager' | 'office_staff' | 'sales_rep' | 'field_crew'

export type Action =
  /** Settings: BusinessState config and templates, schedule working days, ops stages, style photos. */
  | 'settings.change'
  /**
   * The company's lists everything is filed by: Pipeline Stages, Lead Sources
   * and Customer Tags (Settings). Owner and admin only (Jonathan, Oct 20, 2026).
   */
  | 'lists.change'
  /** Prices: inventory items and costs, material kits, Fill in, Good Better Best tier sets, pricing rules. */
  | 'prices.change'
  /** Invite, resend invites, change roles or status, delete users, sign sessions out. */
  | 'users.manage'
  /** System tools, admin pages, scheduled deletions, audit log. */
  | 'system'
  /** Automation rules and stage rules. */
  | 'automations.change'
  /**
   * Deleting records: customers, quotes, jobs, pipeline cards, catalog items,
   * vendors and bills. Owner and admin only (Oct 20, 2026): a delete goes to
   * Settings > Deleted Records, where they can restore it (lib/deletion.ts).
   */
  | 'records.delete'
  /** Archive and unarchive a customer, card or job: the everyday, reversible way off the boards. */
  | 'records.archive'
  /** Removing operational entries: schedule entries, rain days, photos and media, documents, files, notes. */
  | 'ops.delete'
  /** The crew schedule (jobs on the board, rain days). */
  | 'schedule.change'
  /** Invoices, payments, statements, purchase orders, vendors and bills. */
  | 'billing.change'
  /** P&L, balance sheet, cash flow, budget. */
  | 'finance.change'
  /** Create and edit quotes, send proposals. */
  | 'quotes.change'
  /** Permits (staging). */
  | 'permits.change'
  /** Crew install packets (links for the crew). */
  | 'packets.change'
  /** Stock counts, locations and stock movements (not prices). */
  | 'inventory.stock'
  /** Bulk import of old browser data (customers, quotes, jobs, notes). */
  | 'records.import'
  /**
   * See costs: material and labor cost, sub rates, wages, overhead, margins,
   * profit, Target Profit, commission and "where every dollar goes". Without
   * it (Salesman, Installer) the server sends prices only (lib/costRedact.ts).
   */
  | 'costs.view'
  /**
   * Vendor invoices: upload them, fix and match their lines, OK a big price
   * change, undo one; see vendor price history. Owner, admin, manager and
   * office; never a Salesman or Installer (they see no costs).
   */
  | 'invoices.manage'
  /**
   * Record a payment from a customer and hand them the receipt (Oct 21, 2026):
   * owner, admin, manager, office and Salesman (in the field). A Salesman's
   * payment waits in "Payments to confirm"; confirming and voiding are
   * billing.change (owner and office).
   */
  | 'payments.record'
  /** Change an invoice's amount or the contract amount (an adjustment line): owner and admin only. */
  | 'billing.amounts'

const FULL: Action[] = [
  'settings.change', 'prices.change', 'automations.change', 'records.archive', 'ops.delete',
  'schedule.change', 'billing.change', 'finance.change', 'quotes.change', 'permits.change',
  'packets.change', 'inventory.stock', 'records.import', 'costs.view', 'invoices.manage', 'payments.record',
]

const ALLOWED: Record<StaffRole, ReadonlySet<Action>> = {
  super_admin: new Set([...FULL, 'records.delete', 'users.manage', 'system', 'lists.change', 'billing.amounts']),
  admin: new Set([...FULL, 'records.delete', 'users.manage', 'system', 'lists.change', 'billing.amounts']),
  manager: new Set(FULL),
  office_staff: new Set(['records.archive', 'ops.delete', 'schedule.change', 'billing.change', 'quotes.change', 'permits.change', 'packets.change', 'inventory.stock', 'costs.view', 'invoices.manage', 'payments.record']),
  sales_rep: new Set(['quotes.change', 'records.archive', 'payments.record']),
  field_crew: new Set([]),
}

export function can(role: string | null | undefined, action: Action): boolean {
  const set = ALLOWED[role as StaffRole]
  return !!set && set.has(action)
}

/** Owner, admin and manager: no limits beyond users and system. */
export function isFullRole(role: string | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'manager'
}

export const REFUSAL: Record<Action, string> = {
  'settings.change': 'Your role cannot change settings. Ask Jonathan.',
  'lists.change': 'Only the owner or an admin can change the pipeline stages, lead sources and tags.',
  'prices.change': 'Your role cannot change prices. Ask Jonathan.',
  'users.manage': 'Only the owner or an admin can manage users.',
  'system': 'Only the owner or an admin can use this.',
  'automations.change': 'Your role cannot change automations. Ask Jonathan.',
  'records.delete': 'Only the owner or an admin can delete. Archive it instead, or ask Jonathan.',
  'records.archive': 'Your role cannot archive records. Ask Jonathan.',
  'ops.delete': 'Your role cannot delete this. Ask Jonathan.',
  'schedule.change': 'Your role cannot change the crew schedule. Ask Jonathan.',
  'billing.change': 'Your role cannot change billing. Ask Jonathan.',
  'finance.change': 'Your role cannot change the books. Ask Jonathan.',
  'quotes.change': 'Your role cannot change quotes. Ask Jonathan.',
  'permits.change': 'Your role cannot change permits. Ask Jonathan.',
  'packets.change': 'Your role cannot change crew links. Ask Jonathan.',
  'inventory.stock': 'Your role cannot change inventory. Ask Jonathan.',
  'records.import': 'Your role cannot import records. Ask Jonathan.',
  'costs.view': 'Your role sees prices, not costs. Ask Jonathan.',
  'invoices.manage': 'Only the owner and the office can see vendor invoices. Ask Jonathan.',
  'payments.record': 'Your role cannot record payments. Ask Jonathan.',
  'billing.amounts': 'Only the owner or an admin can change an invoice amount or the contract amount.',
}

/** The CRM role on a request. Routes behind requireAuth carry it as crmRole (the portal role is in role). */
export function roleOf(req: any): string | null {
  return req?.user?.crmRole ?? req?.user?.role ?? null
}

/** 403 with a plain sentence. `extra` carries the server's copy so the app can put the screen back. */
export function refuse(res: any, action: Action, extra: Record<string, unknown> = {}): void {
  res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: REFUSAL[action], ...extra })
}

/** Middleware: go on only if the signed in role may do `action`. */
export function requireCan(action: Action) {
  return (req: any, res: any, next: any) => {
    if (!can(roleOf(req), action)) { refuse(res, action); return }
    next()
  }
}

/** Middleware: go on if the role may do any one of `actions` (refused with the first one's sentence). */
export function requireAny(...actions: Action[]) {
  return (req: any, res: any, next: any) => {
    const role = roleOf(req)
    if (!actions.some(a => can(role, a))) { refuse(res, actions[0]); return }
    next()
  }
}

/**
 * For routes that also take a sync key or a customer's portal login: a staff
 * login is held to its role; anything else is left to the route's own check.
 */
export function requireStaffCan(action: Action) {
  return (req: any, res: any, next: any) => {
    const staff = verifyStaffBearer(req)
    if (staff && !can(staff.role, action)) { refuse(res, action); return }
    next()
  }
}

/** Routes behind requireAuth: a CRM login is held to its role (a customer portal login keeps the route's own rule). */
export function requireCrmCan(action: Action) {
  return (req: any, res: any, next: any) => {
    const crmRole = req?.user?.crmRole
    if (crmRole && !can(crmRole, action)) { refuse(res, action); return }
    next()
  }
}

// ── Comparing what is sent with what is saved ─────────────────────────────────

/** Structural equality for JSON values (key order does not matter). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // undefined and null both mean "nothing" in a saved JSON document.
    return (a ?? null) === (b ?? null)
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]))
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  for (const k of keys) if (!sameJson(ao[k], bo[k])) return false
  return true
}

const idsOf = (list: unknown): string[] =>
  Array.isArray(list) ? list.map(x => (x && typeof x === 'object' ? (x as any).id : undefined)).filter((x): x is string => typeof x === 'string') : []

/** Ids in `before` that are not in `after`. */
export function removedIds(before: unknown, after: unknown): string[] {
  const kept = new Set(idsOf(after))
  return idsOf(before).filter(id => !kept.has(id))
}

// ── Business state: which document keys each kind of role may write ───────────

/** Settings documents. */
const SETTINGS_KEYS = new Set(['bundles', 'quoteOptions', 'contractSections', 'defaultMilestones', 'automations', 'emailTemplates', 'settings', 'config'])
/** The books. */
const FINANCE_KEYS = new Set(['plEntries', 'balanceSheet', 'cashFlowManual', 'budget'])
/** Billing and purchasing. */
const BILLING_KEYS = new Set(['invoices', 'payments', 'statements', 'purchaseOrders'])
/** Made when a quote is saved or sold (material list, pending order); the office works them too. */
const SALE_KEYS = new Set(['pendingOrders', 'pullSheets'])
/** Ticked by anyone on the job. */
const CHECKLIST_KEYS = new Set(['jobChecklists'])

export function businessKeyAction(key: string): Action | 'any' {
  if (SETTINGS_KEYS.has(key)) return 'settings.change'
  if (FINANCE_KEYS.has(key)) return 'finance.change'
  if (BILLING_KEYS.has(key)) return 'billing.change'
  if (SALE_KEYS.has(key)) return 'quotes.change'
  if (CHECKLIST_KEYS.has(key)) return 'any'
  return 'settings.change'
}

/**
 * A config change a limited role may still make: switching voice on or off in
 * the quote screen for themselves (config.voice.onFor holds user ids). Every
 * other part of config must be exactly as saved.
 */
function onlyOwnVoiceSwitch(before: any, after: any, userId: string | null): boolean {
  if (!userId) return false
  const strip = (c: any) => {
    if (!c || typeof c !== 'object') return c
    const { voice, ...rest } = c
    const { onFor, ...voiceRest } = (voice && typeof voice === 'object') ? voice : ({} as any)
    return { ...rest, voice: Object.keys(voiceRest).length ? voiceRest : null }
  }
  if (!sameJson(strip(before), strip(after))) return false
  const a = new Set<string>(Array.isArray(before?.voice?.onFor) ? before.voice.onFor : [])
  const b = new Set<string>(Array.isArray(after?.voice?.onFor) ? after.voice.onFor : [])
  for (const id of a) if (!b.has(id) && id !== userId) return false
  for (const id of b) if (!a.has(id) && id !== userId) return false
  return true
}

/**
 * The first thing in a business state patch this role may not change, or null.
 * Only keys whose value differs from what is saved count, so a patch that
 * carries an unchanged settings key is not refused for it.
 */
export function businessPatchRefusal(role: string | null, userId: string | null, current: Record<string, unknown> | null, patch: Record<string, unknown>): Action | null {
  if (isFullRole(role)) return null
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const before = current?.[key]
    if (sameJson(before, value)) continue
    const action = businessKeyAction(key)
    if (action === 'any') continue
    if (action === 'quotes.change' && (can(role, 'quotes.change') || can(role, 'billing.change'))) continue
    if (can(role, action)) continue
    if (key === 'config' && onlyOwnVoiceSwitch(before, value, userId)) continue
    return action
  }
  return null
}

// ── Pipeline board ──────────────────────────────────────────────────────────

/**
 * Adding cards and moving them is for everyone. Removing a card is deleting a
 * record. (The stage list is no longer saved with the board: it is Settings >
 * Pipeline Stages, /api/pipeline-stages; a list an old app still sends here is
 * ignored, not refused.)
 */
export function pipelineChangeRefusal(role: string | null, next: { removed: string[] }): Action | null {
  // Removing a card is a delete: owner and admin only, manager included (they archive instead).
  if (next.removed.length && !can(role, 'records.delete')) return 'records.delete'
  return null
}

// ── Inventory ───────────────────────────────────────────────────────────────

/** Fields of an inventory item that are its price. */
const isPriceField = (k: string) => /cost|price/i.test(k)
/** What a sale changes on an item: stock set aside for a sold job. */
const SALE_STOCK_FIELDS = new Set(['reservedQty'])

/**
 * Inventory is saved whole. Owner, admin and manager may change anything.
 * The office may change stock (counts, locations, movements, reorder points)
 * but no price, no kit, no bundle, and may not add or remove catalog items.
 * Everyone else may only set stock aside for a sold job (reservedQty).
 */
export function inventoryChangeRefusal(role: string | null, current: any, next: any): Action | null {
  // Removing a catalog item is a delete (it goes to Deleted Records): owner and admin only.
  const kept = new Set((Array.isArray(next?.items) ? next.items : []).map((i: any) => i?.id))
  if ((Array.isArray(current?.items) ? current.items : []).some((i: any) => i?.id && !kept.has(i.id)) && !can(role, 'records.delete')) return 'records.delete'
  if (isFullRole(role)) return null
  const office = can(role, 'inventory.stock')
  if (next.kits !== undefined && !sameJson(current?.kits ?? [], next.kits)) return 'prices.change'
  if (!sameJson(current?.bundles ?? [], next.bundles ?? [])) return 'prices.change'
  if (!office) {
    for (const k of ['locations', 'stockLevels', 'transactions']) {
      if (!sameJson(current?.[k] ?? [], next[k] ?? [])) return 'inventory.stock'
    }
  }
  const before = new Map<string, any>((Array.isArray(current?.items) ? current.items : []).map((i: any) => [i?.id, i]))
  const after: any[] = Array.isArray(next.items) ? next.items : []
  if (after.length !== before.size || after.some(i => !before.has(i?.id))) return 'prices.change'
  for (const item of after) {
    const was = before.get(item.id) ?? {}
    const keys = new Set([...Object.keys(was), ...Object.keys(item)])
    for (const k of keys) {
      if (sameJson(was[k], item[k])) continue
      if (isPriceField(k)) return 'prices.change'
      if (office) continue
      if (SALE_STOCK_FIELDS.has(k)) continue
      return 'inventory.stock'
    }
  }
  return null
}

// ── Account key value documents (/api/kv) ────────────────────────────────────

const KV_SETTINGS = new Set(['fencepro_ops_stages', 'fencepro_import_templates'])
/** Lists only their own routes save (/api/pipeline-stages, /api/option-lists); /api/kv refuses them for everyone. */
const KV_LISTS = new Set(['fencepro_pipeline_stages', 'fencepro_lead_sources', 'fencepro_customer_tags'])
const KV_PRICES = new Set(['fencepro_inv_suppliers'])
/** Lists whose entries are records (files, site plans, change orders): removing one is deleting it. */
const KV_RECORD_LISTS = new Set(['fencepro_files', 'fencepro_siteplans', 'fencepro_changeorders'])

export function kvChangeRefusal(role: string | null, key: string, current: unknown, next: unknown): Action | null {
  if (sameJson(current ?? null, next ?? null)) return null
  if ((next === null || next === undefined) && !can(role, 'records.delete')) return 'records.delete'
  if (KV_LISTS.has(key) && !can(role, 'lists.change')) return 'lists.change'
  if (isFullRole(role)) return null
  if (KV_SETTINGS.has(key)) return 'settings.change'
  if (KV_PRICES.has(key)) return 'prices.change'
  if (next === null || next === undefined) return 'records.delete'
  if (KV_RECORD_LISTS.has(key) && removedIds(current, next).length && !can(role, 'ops.delete')) return 'ops.delete'
  return null
}
