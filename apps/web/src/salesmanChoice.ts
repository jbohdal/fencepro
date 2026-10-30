/**
 * The Salesman choice (portal lib/salesmanChoice.ts; Jonathan, Oct 28 2026):
 * Add lead, New Customer and the quote's New Customer each ask who the
 * Salesman is (the owner, Christa or any other Salesman). It starts on the
 * person entering when that is the owner, an admin or a Salesman; the office
 * starts on the owner (D4, Oct 29 2026: "Office entries default to me, and
 * the Salesman choice lets the office pick someone else."). The server says
 * which (`preselect`). The list is read from the server once per sign in and
 * kept in memory only.
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { currentUser, signedInUserId } from './crmAuth'
import { signedInRole } from './permissions'
import { isOfficeStart, preselectOf, startsOnSelf, type SalesmanList } from './salesmanStart'

export { preselectOf, startsOnSelf, type SalesmanList, type SalesmanOption } from './salesmanStart'

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

/**
 * Until the list loads (or with no signal): the person entering alone when their own entries start on
 * themselves, so a save always has a Salesman. The office has no list to start on the owner from: it starts
 * blank, and the server gives a customer saved with no Salesman to the owner (portal defaultRepFor).
 */
export function onlyMe(): SalesmanList {
  const id = signedInUserId() ?? 'me'
  const role = signedInRole() ?? ''
  // Once entered, only the owner changes a Salesman (Oct 29 2026); the server's list says so for an admin too.
  const canChange = role === 'super_admin'
  if (!startsOnSelf(role)) return { choices: [], mine: myRepName(), canChange, preselect: '' }
  return { choices: [{ id, name: myRepName(), role, me: true, preselected: true }], mine: myRepName(), canChange, preselect: myRepName() }
}

let loaded: { userId: string | null; list: Promise<SalesmanList | null> } | null = null
/** The list once it has loaded for this sign in (for a save made without the picker on screen). */
let known: { userId: string | null; list: SalesmanList } | null = null

/** The Salesman a new customer gets when none was picked: where the choice starts (D4), '' to let the server decide. */
export function defaultRepNow(): string {
  const userId = signedInUserId()
  if (known && known.userId === userId) return preselectOf(known.list)
  return preselectOf(onlyMe())
}

export function loadSalesmen(): Promise<SalesmanList | null> {
  const userId = signedInUserId()
  if (loaded && loaded.userId === userId) return loaded.list
  const list = sendJson('GET', '/api/crm-contacts/salesmen').then(r => (r.result.ok && Array.isArray(r.json?.data?.choices) ? r.json.data as SalesmanList : null))
  loaded = { userId, list }
  // No answer (no signal): ask again next time.
  void list.then(l => { if (!l && loaded?.list === list) loaded = null; if (l) known = { userId, list: l } })
  return list
}

/**
 * May this login change a Salesman once entered (the customer's, one quote's, one job's)? The owner only
 * (Jonathan, Oct 29 2026: "owner only [...] Christa can't change it"): the server's word (portal
 * lib/salesmanChoice.ts isOwnerLogin), and until it answers, a super_admin login. The server refuses everyone
 * else whatever this says.
 */
export function useOwnerChangesSalesman(): boolean {
  const { list } = useSalesmen()
  return list ? !!list.canChange : signedInRole() === 'super_admin'
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
 * customer to someone else stops seeing them (portal lib/salesScope.ts); on
 * the quote's New Customer the quote's Sales rep is that person too, and the
 * rep on a quote decides who sees it (Oct 29 2026), so the quote and the
 * customer both leave the Salesman's list.
 */
export function choiceWords(picked: string, opts: { onQuote?: boolean; role?: string | null; preselect?: string } = {}): string {
  const name = picked.trim()
  if (!name || isMyRep(name)) return ''
  const role = opts.role ?? signedInRole()
  // The office's own start (the owner, D4) needs no words; picking someone else does.
  if (isOfficeStart(name, role, opts.preselect)) return ''
  if (role === 'sales_rep') {
    return opts.onQuote
      ? `${name} becomes this customer's Salesman and the quote's Sales rep. Once saved, this quote and customer leave your list, and only the owner can change it back.`
      : `${name} becomes the Salesman. Once saved, this customer leaves your list, and only the owner can change it back.`
  }
  return `${name} sees this customer as soon as it is saved.`
}
