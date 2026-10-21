/**
 * What the signed in login may do, for the screens: buttons a role may not use
 * are hidden or switched off. The server makes the same decision for every
 * save (apps/portal/src/server/lib/permissions.ts); this copy only decides
 * what to show. tests/permissionsMirror.test.ts keeps the two tables equal.
 */

import { useSyncExternalStore } from 'react'

export type CrmRole = 'super_admin' | 'admin' | 'manager' | 'office_staff' | 'sales_rep' | 'field_crew'

export type Action =
  | 'settings.change'
  /** Pipeline Stages, Lead Sources and Customer Tags: owner and admin only. */
  | 'lists.change'
  | 'prices.change' | 'users.manage' | 'system' | 'automations.change'
  | 'records.delete' | 'records.archive' | 'ops.delete' | 'schedule.change' | 'billing.change' | 'finance.change'
  | 'quotes.change' | 'permits.change' | 'packets.change' | 'inventory.stock' | 'records.import'
  /** See costs, margins, sub rates and profit; Salesman and Installer see prices only (the server never sends them costs). */
  | 'costs.view'
  /** Vendor invoices: upload, review, match, OK, undo; vendor price history. Owner, admin, manager and office. */
  | 'invoices.manage'
  /** Record a customer's payment and hand them the receipt: owner, admin, manager, office and Salesman. */
  | 'payments.record'
  /** Change an invoice's amount or the contract amount: owner and admin only. */
  | 'billing.amounts'

const FULL: Action[] = [
  'settings.change', 'prices.change', 'automations.change', 'records.archive', 'ops.delete',
  'schedule.change', 'billing.change', 'finance.change', 'quotes.change', 'permits.change',
  'packets.change', 'inventory.stock', 'records.import', 'costs.view', 'invoices.manage', 'payments.record',
]

export const ALLOWED: Record<CrmRole, ReadonlySet<Action>> = {
  super_admin: new Set([...FULL, 'records.delete', 'users.manage', 'system', 'lists.change', 'billing.amounts']),
  admin: new Set([...FULL, 'records.delete', 'users.manage', 'system', 'lists.change', 'billing.amounts']),
  manager: new Set(FULL),
  office_staff: new Set(['records.archive', 'ops.delete', 'schedule.change', 'billing.change', 'quotes.change', 'permits.change', 'packets.change', 'inventory.stock', 'costs.view', 'invoices.manage', 'payments.record']),
  sales_rep: new Set(['quotes.change', 'records.archive', 'payments.record']),
  field_crew: new Set([]),
}

/** The same sentences the server answers with. */
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

export function roleCan(role: string | null | undefined, action: Action): boolean {
  const set = ALLOWED[role as CrmRole]
  return !!set && set.has(action)
}

// The signed in login's role. Until sign in it is unknown, and nothing is allowed.
let current: string | null = null
const listeners = new Set<() => void>()

/** Called once the login is known (and with null on sign out). */
export function setSignedInRole(role: string | null) {
  current = role
  listeners.forEach(f => { try { f() } catch { /* a screen going away */ } })
}
export function signedInRole(): string | null { return current }

/** May the signed in login do this? */
export function can(action: Action): boolean { return roleCan(current, action) }

/** Owner, admin and manager: nothing is held back from them but users and system tools. */
export function isFullRole(role: string | null = current): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'manager'
}

/** For screens: re-renders when the login changes. */
export function useCan(action: Action): boolean {
  return useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f) } }, () => roleCan(current, action), () => false)
}
