/**
 * Where the Salesman choice starts (D4, Jonathan, Oct 29 2026: "Office
 * entries default to me, and the Salesman choice lets the office pick
 * someone else."). Pure: salesmanChoice.ts and SalesmanPicker.tsx use it,
 * the portal tests call it directly.
 */

export interface SalesmanOption { id: string; name: string; role: string; me: boolean; preselected?: boolean }
export interface SalesmanList { choices: SalesmanOption[]; mine: string; canChange: boolean; preselect?: string }

/** Roles whose own entries start on themselves (they are Salesman choices); every other login starts on the owner. */
export const startsOnSelf = (role: string | null | undefined): boolean => role === 'sales_rep' || role === 'super_admin' || role === 'admin'

/** Where the choice starts: the server's word, else the one marked, else (an older server) the person entering. */
export function preselectOf(list: SalesmanList): string {
  if (typeof list.preselect === 'string') return list.preselect
  return (list.choices.find(c => c.preselected) ?? list.choices.find(c => c.me))?.name ?? ''
}

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The office's own start (the owner) needs no words under the choice; picking someone else does. */
export const isOfficeStart = (picked: string, role: string | null | undefined, preselect: string | null | undefined): boolean =>
  role !== 'sales_rep' && !!norm(preselect) && norm(preselect) === norm(picked)
