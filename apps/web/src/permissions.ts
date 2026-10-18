/**
 * What the signed in login may do, for the screens: buttons a role may not use
 * are hidden or switched off. The server makes the same decision for every
 * save (apps/portal/src/server/lib/permissions.ts); this copy only decides
 * what to show. tests/permissionsMirror.test.ts keeps the two tables equal.
 */

import { useSyncExternalStore } from 'react'

export type CrmRole = 'super_admin' | 'admin' | 'manager' | 'office_staff' | 'sales_rep' | 'field_crew'

export type Action =
  | 'settings.change' | 'prices.change' | 'users.manage' | 'system' | 'automations.change'
  | 'records.delete' | 'ops.delete' | 'schedule.change' | 'billing.change' | 'finance.change'
  | 'quotes.change' | 'permits.change' | 'packets.change' | 'inventory.stock' | 'records.import'

const FULL: Action[] = [
  'settings.change', 'prices.change', 'automations.change', 'records.delete', 'ops.delete',
  'schedule.change', 'billing.change', 'finance.change', 'quotes.change', 'permits.change',
  'packets.change', 'inventory.stock', 'records.import',
]

export const ALLOWED: Record<CrmRole, ReadonlySet<Action>> = {
  super_admin: new Set([...FULL, 'users.manage', 'system']),
  admin: new Set([...FULL, 'users.manage', 'system']),
  manager: new Set(FULL),
  office_staff: new Set(['ops.delete', 'schedule.change', 'billing.change', 'quotes.change', 'permits.change', 'packets.change', 'inventory.stock']),
  sales_rep: new Set(['quotes.change']),
  field_crew: new Set([]),
}

/** The same sentences the server answers with. */
export const REFUSAL: Record<Action, string> = {
  'settings.change': 'Your role cannot change settings. Ask Jonathan.',
  'prices.change': 'Your role cannot change prices. Ask Jonathan.',
  'users.manage': 'Only the owner or an admin can manage users.',
  'system': 'Only the owner or an admin can use this.',
  'automations.change': 'Your role cannot change automations. Ask Jonathan.',
  'records.delete': 'Your role cannot delete records. Ask Jonathan.',
  'ops.delete': 'Your role cannot delete this. Ask Jonathan.',
  'schedule.change': 'Your role cannot change the crew schedule. Ask Jonathan.',
  'billing.change': 'Your role cannot change billing. Ask Jonathan.',
  'finance.change': 'Your role cannot change the books. Ask Jonathan.',
  'quotes.change': 'Your role cannot change quotes. Ask Jonathan.',
  'permits.change': 'Your role cannot change permits. Ask Jonathan.',
  'packets.change': 'Your role cannot change crew links. Ask Jonathan.',
  'inventory.stock': 'Your role cannot change inventory. Ask Jonathan.',
  'records.import': 'Your role cannot import records. Ask Jonathan.',
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
