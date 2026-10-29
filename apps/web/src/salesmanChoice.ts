/**
 * The Salesman choice (portal lib/salesmanChoice.ts; Jonathan, Oct 28 2026):
 * Add lead, New Customer and the quote's New Customer each ask who the
 * Salesman is (the owner, Christa or any other Salesman), the person entering
 * preselected. The list is read from the server once per sign in and kept in
 * memory only.
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { currentUser, signedInUserId } from './crmAuth'
import { signedInRole } from './permissions'

export interface SalesmanOption { id: string; name: string; role: string; me: boolean }
export interface SalesmanList { choices: SalesmanOption[]; mine: string; canChange: boolean }

/** The signed in person's name as a rep is written ("Christa Feagin"). */
export function myRepName(): string {
  const u = currentUser()
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.replace(/\s+/g, ' ').trim() || u?.email || ''
}

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Is this rep name the signed in person? Full name or first name alone, any case (as the server's scope reads it). */
export function isMyRep(rep: string | null | undefined): boolean {
  const r = norm(rep)
  if (!r) return false
  const u = currentUser()
  return r === norm(myRepName()) || (!!u?.firstName && r === norm(u.firstName))
}

/** Until the list loads (or with no signal): the person entering alone, so a save always has a Salesman. */
export function onlyMe(): SalesmanList {
  const id = signedInUserId() ?? 'me'
  const role = signedInRole() ?? ''
  return { choices: [{ id, name: myRepName(), role, me: true }], mine: myRepName(), canChange: role !== 'sales_rep' && role !== 'field_crew' }
}

let loaded: { userId: string | null; list: Promise<SalesmanList | null> } | null = null

export function loadSalesmen(): Promise<SalesmanList | null> {
  const userId = signedInUserId()
  if (loaded && loaded.userId === userId) return loaded.list
  const list = sendJson('GET', '/api/crm-contacts/salesmen').then(r => (r.result.ok && Array.isArray(r.json?.data?.choices) ? r.json.data as SalesmanList : null))
  loaded = { userId, list }
  // No answer (no signal): ask again next time.
  void list.then(l => { if (!l && loaded?.list === list) loaded = null })
  return list
}

/** The list, or null while it loads; `failed` when the server could not be reached. */
export function useSalesmen(): { list: SalesmanList | null; failed: boolean } {
  const [state, setState] = useState<{ list: SalesmanList | null; failed: boolean }>({ list: null, failed: false })
  useEffect(() => {
    let live = true
    void loadSalesmen().then(l => { if (live) setState({ list: l, failed: !l }) })
    return () => { live = false }
  }, [])
  return state
}

/**
 * What the choice says under it, before saving. The Salesman who gives a
 * customer to someone else stops seeing them (portal lib/salesScope.ts),
 * except on a quote the Salesman made: the quote keeps its customer on the
 * Salesman's list.
 */
export function choiceWords(picked: string, opts: { onQuote?: boolean; role?: string | null } = {}): string {
  const name = picked.trim()
  if (!name || isMyRep(name)) return ''
  const role = opts.role ?? signedInRole()
  if (role === 'sales_rep') {
    return opts.onQuote
      ? `${name} becomes this customer's Salesman and the quote's Sales rep. You still see this quote and customer, because you made the quote.`
      : `${name} becomes the Salesman. Once saved, this customer leaves your list, and only the owner or the office can change it back.`
  }
  return `${name} sees this customer as soon as it is saved.`
}
